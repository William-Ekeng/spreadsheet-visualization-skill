#!/usr/bin/env python3
"""
Live spreadsheet <-> HTML sync server.

Treats a spreadsheet file (.xlsx/.xlsm or .csv) as the backend database and
serves its contents as JSON over a small HTTP API. The HTML frontend polls
for changes and can write cells / rows back, which are saved straight to
the spreadsheet file. A filesystem watcher also detects edits made directly
in Excel/LibreOffice (or any other program) and reflects them on next poll.

This script is a *template* meant to be copied into a project and adapted:
adjust SHEET file path via --file, and tweak read_workbook/write_cell if the
target spreadsheet needs custom handling (merged cells, multiple header
rows, etc). The header row is auto-detected per sheet (first "wide" row),
so metadata rows commonly found above the real table in exported reports
(company name, report date, etc.) don't get misread as column headers.

Usage:
    python sync_server.py --file "budget.xlsx" --ui "app.html" --port 5000
    python sync_server.py --file "data.csv" --port 5000        # fallback UI
    python sync_server.py --file "legacy_report.xls" --port 5000

The server itself is UI-agnostic: it serves the composed HTML given via
--ui (plus its sibling js/css files) and exposes the spreadsheet as a JSON
API. What the page looks like is decided per-spreadsheet by whoever
composes it from the building blocks in assets/ (see SKILL.md).

Dependencies:
    pip install flask openpyxl watchdog filelock
    (openpyxl only needed for .xlsx/.xlsm files, not plain .csv;
    xlrd only needed for legacy .xls files -- pip install xlrd)

Legacy .xls files: openpyxl can't read or write the old binary Excel format
at all, and there's no actively-maintained pure-Python writer for it either.
Rather than fail outright or silently bolt on a fragile legacy writer, this
script converts a .xls to a sibling .xlsx once on startup (via xlrd) and
operates on that going forward -- the original .xls is left untouched. This
is a one-time, visible step (printed to the console), not something to do
quietly, since it changes which file is now the live source of truth.
"""

import argparse
import csv
import os
import re
import threading
import time
from pathlib import Path

from filelock import FileLock
from flask import Flask, jsonify, request, send_from_directory
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

app = Flask(__name__)

STATE = {
    "path": None,
    "lock_path": None,
    "version": 0,
    "last_self_write": 0.0,
    "recalc": False,
    "cache": None,
    "cache_version": -1,
    "ui_dir": None,
    "ui_file": None,
}


# ---------------------------------------------------------------------------
# Spreadsheet I/O (xlsx via openpyxl, csv via stdlib csv)
# ---------------------------------------------------------------------------

def _is_xlsx(path):
    return path.suffix.lower() in (".xlsx", ".xlsm")


def _is_legacy_xls(path):
    return path.suffix.lower() == ".xls"


def convert_xls_to_xlsx(path):
    """Read a legacy .xls (via xlrd) and write a sibling .xlsx (via openpyxl)
    with the same sheets/data, preserving dates. Returns the new path.
    Skips the conversion if that .xlsx already exists and is newer than the
    .xls, so re-running the server doesn't reconvert (and discard live
    edits already made to the .xlsx) every time.
    """
    import xlrd
    import openpyxl

    out_path = path.with_suffix(".xlsx")
    if out_path.exists() and out_path.stat().st_mtime >= path.stat().st_mtime:
        return out_path

    xls_wb = xlrd.open_workbook(path)
    out_wb = openpyxl.Workbook()
    out_wb.remove(out_wb.active)
    for name in xls_wb.sheet_names():
        sh = xls_wb.sheet_by_name(name)
        ws = out_wb.create_sheet(name)
        for r in range(sh.nrows):
            row_values = []
            for c in range(sh.ncols):
                cell = sh.cell(r, c)
                if cell.ctype == xlrd.XL_CELL_DATE:
                    row_values.append(xlrd.xldate_as_datetime(cell.value, xls_wb.datemode))
                else:
                    row_values.append(cell.value)
            ws.append(row_values)
    out_wb.save(out_path)
    return out_path


def _detect_header_row(rows_iter, max_col, scan_limit=30):
    """Many real-world exports (financial reports, analytics tools, etc.)
    prepend a handful of key/value metadata rows ("Company", "Download
    Date", ...) before the actual table header. A plain "row 1 is the
    header" assumption misreads those as data. Heuristic: the header row is
    the first row, within the first `scan_limit` rows, that is "wide" --
    populated across most of the sheet's columns -- since metadata rows are
    narrow (typically a label + one value) by comparison.
    """
    threshold = max(3, max_col * 0.5)
    for i, row in enumerate(rows_iter[:scan_limit], start=1):
        nonnull = sum(1 for c in row if c.value is not None)
        if nonnull >= threshold:
            return i
    return 1  # fallback: no wide row found, assume header row 1


def _extract_meta(rows_before_header):
    """Turn narrow "label, value" rows preceding the header into a flat
    dict, so that context (company name, report date, etc.) isn't silently
    dropped -- it's useful to surface in the dashboard even though it isn't
    part of the tabular data.
    """
    meta = {}
    for row in rows_before_header:
        vals = [c.value for c in row if c.value is not None]
        if len(vals) == 2:
            meta[str(vals[0])] = vals[1] if not hasattr(vals[1], "isoformat") else vals[1].isoformat()
    return meta


def read_workbook(path, recalc=False):
    """Return {sheet_name: {"headers": [...], "rows": [ {col: value}, ... ],
    "formulas": {(row_idx, col): "=..."}, "meta": {...}, "header_row": N }}.
    The header row is auto-detected per sheet rather than assumed to be row 1
    -- see _detect_header_row.

    If `recalc` is True, formula cells that have no cached value yet (most
    commonly: a workbook built with openpyxl rather than ever saved by real
    Excel, so Excel never wrote a cached result) are filled in using the
    `formulas` package as a *display-only* enrichment of the JSON response --
    see _formula_solution_for for why this never touches the file on disk.
    """
    path = Path(path)
    if _is_xlsx(path):
        import openpyxl

        wb_values = openpyxl.load_workbook(path, data_only=True)
        wb_formulas = openpyxl.load_workbook(path, data_only=False)
        solution = _formula_solution_for(path) if recalc else None
        sheets = {}
        for name in wb_values.sheetnames:
            ws_v = wb_values[name]
            ws_f = wb_formulas[name]
            rows_iter = list(ws_v.iter_rows(values_only=False))
            if not rows_iter:
                sheets[name] = {"headers": [], "rows": [], "formulas": {}, "meta": {}, "header_row": 1}
                continue
            header_row_idx = _detect_header_row(rows_iter, ws_v.max_column)
            meta = _extract_meta(rows_iter[: header_row_idx - 1])
            header_cells = rows_iter[header_row_idx - 1]
            headers = [c.value if c.value is not None else f"col{i}" for i, c in enumerate(header_cells)]
            rows = []
            formula_cells = {}
            for r_idx, row in enumerate(rows_iter[header_row_idx:], start=header_row_idx + 1):
                record = {"_row": r_idx}
                for c_idx, cell in enumerate(row):
                    header = headers[c_idx]
                    record[header] = cell.value
                    f_cell = ws_f.cell(row=r_idx, column=c_idx + 1)
                    if isinstance(f_cell.value, str) and f_cell.value.startswith("="):
                        formula_cells[f"{r_idx}:{header}"] = f_cell.value
                        if record[header] is None and solution is not None:
                            record[header] = _formula_solution_lookup(solution, name, c_idx + 1, r_idx)
                rows.append(record)
            sheets[name] = {"headers": headers, "rows": rows, "formulas": formula_cells, "meta": meta, "header_row": header_row_idx}
        return sheets
    else:
        with open(path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            headers = reader.fieldnames or []
            rows = []
            for r_idx, record in enumerate(reader, start=2):
                record["_row"] = r_idx
                rows.append(record)
        return {path.stem: {"headers": headers, "rows": rows, "formulas": {}, "meta": {}, "header_row": 1}}


def _xlsx_headers(ws):
    """Locate the header row the same way read_workbook does and return its
    column names, so writes land in the right column even when the sheet
    has metadata rows before the real header.
    """
    rows_iter = list(ws.iter_rows(values_only=False))
    header_row_idx = _detect_header_row(rows_iter, ws.max_column)
    return [c.value for c in rows_iter[header_row_idx - 1]]


def write_cell(path, sheet, row_idx, column, value):
    path = Path(path)
    if _is_xlsx(path):
        import openpyxl

        wb = openpyxl.load_workbook(path, data_only=False)
        ws = wb[sheet]
        headers = _xlsx_headers(ws)
        col_idx = headers.index(column) + 1
        ws.cell(row=row_idx, column=col_idx, value=value)
        wb.save(path)
    else:
        rows = []
        with open(path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            headers = reader.fieldnames
            for r_idx, record in enumerate(reader, start=2):
                if r_idx == row_idx:
                    record[column] = value
                rows.append(record)
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=headers)
            writer.writeheader()
            writer.writerows(rows)


def append_row(path, sheet, values):
    path = Path(path)
    if _is_xlsx(path):
        import openpyxl

        wb = openpyxl.load_workbook(path, data_only=False)
        ws = wb[sheet]
        headers = _xlsx_headers(ws)
        ws.append([values.get(h, "") for h in headers])
        wb.save(path)
    else:
        with open(path, newline="", encoding="utf-8-sig") as f:
            headers = csv.DictReader(f).fieldnames
        with open(path, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=headers)
            writer.writerow(values)


def delete_row(path, sheet, row_idx):
    path = Path(path)
    if _is_xlsx(path):
        import openpyxl

        wb = openpyxl.load_workbook(path, data_only=False)
        ws = wb[sheet]
        ws.delete_rows(row_idx)
        wb.save(path)
    else:
        rows = []
        with open(path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            headers = reader.fieldnames
            for r_idx, record in enumerate(reader, start=2):
                if r_idx != row_idx:
                    rows.append(record)
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=headers)
            writer.writeheader()
            writer.writerows(rows)


_FORMULA_SOLUTION_KEY_RE = re.compile(r"^'\[[^\]]*\](?P<sheet>.*)'!(?P<ref>[A-Z]+\d+)$")


def _formula_solution_for(path):
    """Evaluate every formula in the workbook using the optional `formulas`
    package and return its raw solution dict (cell-ref -> computed value),
    or None if the package isn't installed or evaluation fails outright
    (unsupported functions, circular refs, etc. -- individual unsupported
    cells are handled per-lookup in _formula_solution_lookup instead).

    Deliberately read-only: earlier this recalculated by asking `formulas`
    to *rewrite the xlsx* (`ExcelModel.write`), which turned out to rebuild
    the entire workbook from only the cells it touched during evaluation --
    on a real file that silently dropped data/formatting outside the
    formula dependency graph, and permanently replaced formula cells with
    plain numbers (openpyxl has no way to write a cached value alongside a
    formula the way Excel does, so there's no non-destructive way to persist
    this to the file at all). Using it purely to enrich the JSON response
    the browser sees -- without ever touching the file on disk -- avoids
    that risk entirely, at the cost of the recalculated value not being
    visible if the user opens the raw file directly in Excel.
    """
    try:
        import numpy as np
        import formulas

        xl = formulas.ExcelModel().loads(str(path)).finish()
        raw = xl.calculate()
        # Index once by (SHEET, CELLREF) rather than re-scanning the whole
        # solution per formula cell -- a real workbook can have thousands.
        indexed = {}
        for key, ranges in raw.items():
            m = _FORMULA_SOLUTION_KEY_RE.match(key)
            if not m:
                continue
            try:
                value = np.ravel(ranges.value)[0]
                indexed[(m.group("sheet").strip().upper(), m.group("ref"))] = value.item() if hasattr(value, "item") else value
            except Exception:
                continue
        return indexed
    except Exception:
        return None


def _formula_solution_lookup(solution, sheet_name, col_idx, row_idx):
    import openpyxl.utils

    cell_ref = f"{openpyxl.utils.get_column_letter(col_idx)}{row_idx}"
    return solution.get((sheet_name.strip().upper(), cell_ref))


# ---------------------------------------------------------------------------
# Filesystem watcher: detect edits made outside our own writes (e.g. a human
# editing the file directly in Excel) and bump the version so pollers refresh
# ---------------------------------------------------------------------------

class _ChangeHandler(FileSystemEventHandler):
    def on_modified(self, event):
        if event.src_path and Path(event.src_path).resolve() == Path(STATE["path"]).resolve():
            # Ignore the modification event our own write_cell/append_row just caused
            if time.time() - STATE["last_self_write"] > 0.75:
                STATE["version"] += 1


def start_watcher(path):
    observer = Observer()
    observer.schedule(_ChangeHandler(), str(Path(path).parent), recursive=False)
    observer.daemon = True
    observer.start()
    return observer


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------

def _get_sheets():
    """Re-parsing a multi-thousand-row workbook (twice, for values + formulas)
    takes over a second on real-world files. Since the frontend polls
    frequently but the file usually hasn't changed between polls, cache the
    parsed result and only re-read from disk when the version counter moved
    (from our own write or the file watcher noticing an external edit).
    """
    if STATE["cache"] is None or STATE["cache_version"] != STATE["version"]:
        with FileLock(STATE["lock_path"]):
            STATE["cache"] = read_workbook(STATE["path"], recalc=STATE["recalc"])
        STATE["cache_version"] = STATE["version"]
    return STATE["cache"]


@app.get("/api/version")
def api_version():
    """Cheap endpoint for the frontend to poll frequently without paying the
    cost of re-serializing the whole sheet when nothing has changed.
    """
    return jsonify({"version": STATE["version"]})


@app.get("/api/data")
def api_data():
    return jsonify({"version": STATE["version"], "sheets": _get_sheets()})


@app.post("/api/cell")
def api_cell():
    body = request.get_json(force=True)
    with FileLock(STATE["lock_path"]):
        STATE["last_self_write"] = time.time()
        write_cell(STATE["path"], body["sheet"], int(body["row"]), body["column"], body["value"])
        STATE["version"] += 1
    return jsonify({"ok": True, "version": STATE["version"]})


@app.post("/api/rows")
def api_add_row():
    body = request.get_json(force=True)
    with FileLock(STATE["lock_path"]):
        STATE["last_self_write"] = time.time()
        append_row(STATE["path"], body["sheet"], body["values"])
        STATE["version"] += 1
    return jsonify({"ok": True, "version": STATE["version"]})


@app.delete("/api/rows/<sheet>/<int:row_idx>")
def api_delete_row(sheet, row_idx):
    with FileLock(STATE["lock_path"]):
        STATE["last_self_write"] = time.time()
        delete_row(STATE["path"], sheet, row_idx)
        STATE["version"] += 1
    return jsonify({"ok": True, "version": STATE["version"]})


@app.get("/")
def index():
    return send_from_directory(STATE["ui_dir"], STATE["ui_file"])


@app.get("/<path:fname>")
def ui_static(fname):
    """Serve sibling files of the composed UI (sheetsync.js, components.js,
    base.css, images, ...) so a composed app is just a directory of plain
    files next to each other. /api/* routes are registered above and take
    precedence over this catch-all.
    """
    return send_from_directory(STATE["ui_dir"], fname)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True, help="Path to the .xlsx/.xlsm/.csv/.xls spreadsheet")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--ui", help="Path to the composed HTML UI to serve at / -- its directory is also served as static files, so keep sheetsync.js/components.js/base.css next to it")
    parser.add_argument("--recalc", action="store_true", help="Fill in formula cells that have no cached value yet using the `formulas` package, for display only -- never written to the file (pip install formulas)")
    args = parser.parse_args()

    path = Path(args.file).resolve()
    if not path.exists():
        raise SystemExit(f"File not found: {path}")

    if args.ui:
        ui_path = Path(args.ui).resolve()
        if not ui_path.exists():
            raise SystemExit(f"UI file not found: {ui_path}")
    else:
        # Fall back to the bundled example composition (generic grid+search).
        ui_path = Path(__file__).parent.parent / "assets" / "example-app.html"
    STATE["ui_dir"] = str(ui_path.parent)
    STATE["ui_file"] = ui_path.name

    if _is_legacy_xls(path):
        print(f"{path.name} is a legacy .xls file -- openpyxl can't read or write that format.")
        new_path = convert_xls_to_xlsx(path)
        print(f"Converted to {new_path.name} (original left untouched). Serving the .xlsx from now on.")
        path = new_path

    STATE["path"] = path
    STATE["lock_path"] = str(path) + ".lock"
    STATE["recalc"] = args.recalc

    observer = start_watcher(path)
    print(f"Serving {path.name} live at http://127.0.0.1:{args.port}")
    print("Edit the file in Excel or in the browser -- both sides stay in sync.")
    try:
        app.run(host="127.0.0.1", port=args.port, threaded=True)
    finally:
        observer.stop()


if __name__ == "__main__":
    main()
