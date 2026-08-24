# Formula handling and other limitations

## Legacy .xls files

openpyxl only handles the modern `.xlsx`/`.xlsm` XML-based format. It
cannot open or write the old binary `.xls` format (OLE2/BIFF) at all, and
there's no actively-maintained pure-Python library that can *write* that
old format either (xlrd, the read-only library used here, dropped even
`.xlsx` read support in v2.x and now only reads legacy `.xls`). Rather than
fail outright on a `.xls` file, or attempt some fragile legacy write path,
`convert_xls_to_xlsx` in `sync_server.py` reads it with `xlrd` and writes a
sibling `.xlsx` once on startup (skipped on subsequent runs if that `.xlsx`
is already newer than the source `.xls`, so live edits aren't discarded by
reconverting every time). The server then treats that `.xlsx` as the live
file going forward; the original `.xls` is left untouched. Excel date
serial numbers are converted to real `datetime` values during this step
(`xlrd.xldate_as_datetime`); without this they'd show up as raw floats
like `44143.0` instead of dates.

## How formula cells are shown

`sync_server.py` loads the workbook twice: once with `data_only=True` (gets
the last-*calculated* value Excel/LibreOffice cached the last time a human
saved the file) and once with `data_only=False` (gets the raw `=FORMULA(...)`
string). Formula cells render in the table with a highlighted background and
the formula text as a tooltip; they are not editable in the browser, since a
typed value would silently overwrite the formula.

## Why recalculation is not automatic

openpyxl (and most pure-Python spreadsheet libraries) can read and write
cells but cannot *evaluate* formulas; that's normally Excel's job, done at
save time. Two consequences:

- If the HTML frontend edits a cell that a formula elsewhere depends on, the
  formula's displayed value will be stale until the workbook is next
  opened and saved in Excel/LibreOffice (or `--recalc` is used, see below).
- A brand-new `.xlsx` created via openpyxl with formulas in it will show
  `None`/blank for those cells until something recalculates them.

## Options

1. **Let Excel be the source of truth for formulas.** Simplest and most
   reliable: tell the user to keep the workbook open in Excel while using the
   dashboard, or to leave the file closed but periodically resaved. The
   filesystem watcher in `sync_server.py` picks up the recalculated values
   the moment Excel writes the file.
2. **`--recalc` flag.** `sync_server.py --recalc` fills in formula cells
   that have no cached value using the optional
   [`formulas`](https://pypi.org/project/formulas/) package
   (`uv run --with formulas` or `pip install formulas`). Mainly useful
   for a workbook that's never been opened in real Excel, one built with
   openpyxl say, where every formula cell would otherwise show blank.
   This is deliberately display-only and read-only: the computed values
   are merged into the JSON the frontend sees and are never written back
   to the spreadsheet file. The alternative, asking `formulas` to rewrite
   the xlsx directly, rebuilds the *entire* workbook from only the cells
   touched during evaluation. On a real file that silently drops data and
   formatting outside the formula dependency graph, and since openpyxl
   can't store a formula and a cached value in the same cell the way
   Excel does, it also permanently replaces the formula with a plain
   number. That is not a risk worth taking for a recalculate flag, so
   `--recalc` never touches the file on disk. Verify this still holds if
   `_formula_solution_for`/`_formula_solution_lookup` are modified.
   `formulas` supports a useful subset of Excel functions (arithmetic,
   lookups, common aggregations) but not everything: complex array
   formulas, volatile functions (`NOW()`, `RAND()`), and some newer Excel
   functions will fail silently per-cell and leave that cell blank rather
   than error the whole request.
3. **Precompute derived columns instead of formulas.** For apps that
   mainly need calculated fields (e.g. profit margin = (revenue - cost) /
   revenue), computing them in JavaScript in the composed page from the
   raw columns is simpler and harder to break (a `format`
   function on DataGrid, a `compute` on StatTile, or a derived column
   built before rendering) than fighting with formula recalculation at
   all. Prefer this when the "formula" is simple arithmetic over
   columns already in the sheet.

## Before adapting the template

- **Header row detection.** `sync_server.py` auto-detects the header row per
  xlsx sheet (`_detect_header_row`) as the first "wide" row, meaning one
  populated across roughly half or more of the sheet's columns, within the
  first 30 rows, rather than assuming row 1. This is specifically to handle
  a very common real-world pattern: exported reports (financial data pulls,
  analytics tools, etc.) that prepend a handful of narrow "label, value"
  metadata rows (Company, Report Date, RIC, ...) before the actual table.
  Those metadata rows are captured separately as `sheet.meta` and rendered
  in an info panel above the table rather than being dropped. The CSV
  reader does *not* do this detection; it always treats the first CSV row
  as the header, since CSVs rarely carry this kind of preamble. If a sheet
  has merged header cells, a multi-row header, or simply no row that's
  "wide" relative to the rest (e.g. a very sparse table), the heuristic can
  guess wrong. Check `sheet.header_row` in the `/api/data` response
  against the actual file before trusting it, and adjust
  `_detect_header_row`/`read_workbook`/`_xlsx_headers` if needed.
- **Declared vs. real sheet extent.** `ws.max_row`/`ws.max_column` report
  the range the file *declares*, which Excel routinely writes far larger
  than the data. A template whose columns were formatted wholesale, or that
  keeps a filler cell far down the sheet to pin the table's shape, commonly
  declares the full 16,384 columns and a couple of thousand rows while
  holding five real ones. `_used_bounds` (editable mode) and
  `_used_bounds_from_rows` (read-only mode) measure the real extent from
  the cells that hold values instead. Trusting the declared number breaks
  three things at once: header detection never finds a "wide" row so every
  sheet falls back to row 1, the parse walks 16,384 columns per row and
  invents thousands of `colN` headers, and appends land below the reserved
  block, outside whatever ranges the workbook's totals sum over. Rows with
  no values at all are skipped, so a reserved block with a formula filled
  down it doesn't flood the grid; `append_row` targets the first row whose
  non-formula cells are empty, which is the row after the data on an
  ordinary list and the next free slot inside the block on a template.
- **Read speed on styled workbooks.** `read_workbook` loads in openpyxl's
  `read_only` mode, which streams the sheet XML rather than building a full
  cell model. On a workbook with thousands of pre-formatted rows that is
  the difference between ~15s and ~0.05s per load (the real case that
  prompted this went from 30s to 2s end to end). Writes still need the
  editable model, so `_writable_workbook` keeps one open between edits and
  a background thread warms it at startup; otherwise the user's first edit
  pays a ~20s parse. That cached workbook is dropped whenever the watcher
  sees an external change, because saving a copy parsed before someone
  else's edit would silently revert it.
- **Saving is deferred.** `wb.save()` rewrites the whole file whatever
  changed (~2.9s on a 10k-row sheet), so an edit updates the in-memory
  workbook and `_schedule_flush` writes once after a short quiet period.
  A burst of edits costs one save. Anything that re-reads the file flushes
  first, so the deferral is invisible to the browser, and a save that fails
  is reported on the next `/api/version` poll rather than on the request
  that made the edit. The window is small but real: a hard kill within it
  loses the last edits. `sync_server.py` flushes on shutdown for the
  ordinary case.
- **Sheet order.** Flask sorts dict keys when serializing by default, which
  would hand the frontend a workbook's sheets alphabetically. Order is
  meaningful (a workbook of month sheets is in calendar order, not
  Août/Avril/Décembre), so the server turns that off. Compositions can rely
  on `store.sheetNames()` matching the workbook's own tab order.
- **Concurrency.** Writes are guarded with a `filelock` so the HTML frontend
  and a human editing in Excel don't corrupt the file mid-save, but Excel
  itself locks the file while open on Windows. Writes from the API will
  fail with a permission error until the human closes or saves the file.
  Surface this to the user rather than treating it as a bug.
- **Polling, not push.** `SheetStore` polls a cheap `/api/version` endpoint
  (default every 1s) and only fetches the full `/api/data` payload when the
  version actually changed; the server likewise caches the parsed sheet and
  only re-reads from disk when its own writes or the filesystem watcher
  bump the version. This keeps steady-state polling cheap even on
  multi-thousand-row sheets (a ~5,000-row xlsx dropped from ~1.6s to ~0.15s
  per poll once cached in testing) without needing websockets. `DataGrid`
  paginates (`pageSize`, default 100) since rendering thousands of
  `contenteditable` DOM rows at once is sluggish to scroll even though the
  data loads fine; `ChartBlock` caps at the top `topN` (default 30) rows
  by the Y value, since more bars/points than that stop being readable.
- **Multiple sheets.** The API always returns every sheet in the workbook;
  the composed page picks which to show (e.g. via Tabs). For very large
  workbooks with many sheets, consider adding a `?sheet=` query param to
  `/api/data` to avoid serializing sheets nobody is viewing.
- **Chart fields are the composer's decision.** ChartBlock takes explicit
  `x`/`y`. When composing, pick a label-like column for X and an actual
  measure for Y, not a numeric-but-meaningless identifier (row numbers,
  postal codes, phone numbers). With a categorical X that repeats across
  rows, pass `aggregate: "sum"` (or `"avg"`/`"count"`) so the chart groups
  by category instead of plotting one point per row. Only enable
  `controls: true` when the user should be able to explore fields
  themselves.
- **ChartBlock's visual language** (rounded bar tops, no vertical
  gridlines, a hairline horizontal grid, square legend/tooltip swatches,
  a smooth line curve with hidden points, a slim doughnut ring) is
  grounded against shadcn/ui's chart gallery, the same borrowed-values
  approach as the default theme and buttons. Not a dependency, just the
  reference the numbers came from. Every one of these reads from theme
  tokens at render time (bar corner radius from `--ss-radius-sm`, grid/ink
  color from `--ss-muted`, tooltip chrome from `--ss-panel`/`--ss-border`),
  so a theme swap restyles charts correctly without any chart-specific
  code in the theme files. Confirmed in brutalist, where bars render
  perfectly square (`--ss-radius-sm: 0`) rather than inheriting a
  hardcoded round corner that would have fought the theme's whole
  aesthetic. This intentionally covers the *shared* visual language across
  chart types, not shadcn's full catalog (stacked bars, negative-value
  bars, an interactive stat-tile header, per-chart tooltip formatter
  variants, radial charts). Those are compositions to build to spec on
  top of ChartBlock/StatTile/Collapsible as needed, not baked into the
  block itself.
