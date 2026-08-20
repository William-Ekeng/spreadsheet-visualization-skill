---
name: spreadsheet-visualization
description: Turn a spreadsheet (.xlsx/.xlsm/.xls/.csv) into a live, editable HTML app, with the spreadsheet file itself acting as the backend database and a local Python server keeping the composed HTML frontend and the file in sync in both directions. Use this whenever the user wants to visualize, dashboard, or build a webpage/UI/tool for a spreadsheet, wants to edit spreadsheet data through a browser instead of Excel, or asks for a "live" or "synced" view of a spreadsheet — even if they don't use the word "dashboard" explicitly (e.g. "turn my budget sheet into a webpage", "I want a nicer way to look at and edit this csv", "build a UI on top of this spreadsheet", "make me a tool to manage this inventory file"). Not for one-off static exports/reports (use the xlsx or pdf skill instead) or for spreadsheet-to-spreadsheet transforms with no HTML involved.
---

# Spreadsheet Visualization

Turns a spreadsheet into the backend of a small local web app: a Python
server (`scripts/sync_server.py`) reads the spreadsheet file, serves its
contents as JSON, watches the file for external edits (e.g. someone editing
it directly in Excel), and accepts writes from the browser that get saved
straight back into the file. Because both sides read/write the same file,
the spreadsheet is always the single source of truth — there is no separate
database to keep consistent.

This only works when the spreadsheet file and the browser are on the same
machine (or same LAN, if the server is bound to a non-localhost address) —
the server needs direct filesystem access to the spreadsheet.

## The core idea: compose the UI, don't reuse a template

A spreadsheet's purpose can't be predicted from its file format. An orders
sheet wants search and filters; a budget wants stat tiles and a category
chart; a contact list wants a searchable grid with a record-edit form; a
returns log mostly wants fast append. One fixed dashboard layout serves
none of these well.

So the skill ships **building blocks, not a page**: a data-sync layer
(`assets/sheetsync.js`), a component kit (`assets/components.js` — grid,
search, tabs, stat tiles, chart, typed field inputs, record form, status
indicator), and shared styling (`assets/base.css`). Your job is to write
one composed HTML file per spreadsheet that arranges the right blocks for
what this data is *for* — informed by inspecting the data and by what the
user says they want. The server is UI-agnostic and serves whatever
composition it's pointed at via `--ui`.

Let the spreadsheet's purpose drive the layout. Ask the user what they
want to *do* with the data if it isn't obvious — "manage inventory",
"track spending", "look up customers" each imply different blocks. A few
purpose → composition sketches:

- **Manage/edit records** (inventory, CRM, task list): SearchBox + DataGrid
  (editable, addable, deletable), optionally `onRowClick` → RecordForm in a
  side panel for wide sheets where in-cell editing is clumsy.
- **Monitor numbers** (budget, sales, KPIs): a row of StatTiles
  (`agg.sum`/`agg.avg`) + ChartBlock with `aggregate: "sum"` grouped by the
  category column + a compact read-only DataGrid.
- **Look things up** (reference lists, logs): SearchBox + read-only
  DataGrid with `columns` trimmed to what matters; no add/delete noise.
- **Append entries** (time log, expenses): RecordForm-style inputs for a
  new row at the top, recent entries in a DataGrid below.

- **Explain/report** (a narrative page over the data: exec summary,
  process doc, deep-dive): mostly custom HTML — hero, prose sections,
  `.ss-doc` two-column layout with SideNav scrollspy — with data-bound
  islands: a `ss-facts` table filled from the store, StatTiles, a
  ChartBlock behind a segmented toggle, Collapsible cards whose tags are
  computed from the data. Dark theme via `<html data-theme="dark">`.

The kit is themeable: five themes ship in `assets/themes/` (brutalist,
retro, lofi, cozy, cyberpunk) as token-contract stylesheets loaded after
`base.css`, restyling every block including chart palettes. If the user
names a vibe, link the matching theme (or write one — see
`references/theming.md`, including the mandatory chart-palette
validation); with no vibe stated, stay on the neutral default and
mention themes exist.

Mix freely — most real apps are 2–3 of these on one page or split across
Tabs. The blocks are not a ceiling: compositions are plain HTML, so
polished bespoke pages are in scope — use the kit for the data-bound
parts and ordinary HTML/CSS for everything else. Read
`references/components.md` for the full API of every block, the CSS-only
primitives (badges, flow chips, fact tables), theming, and the wiring
patterns (search→grid, row→form, tabs→everything).

## Workflow

1. **Inspect the spreadsheet first.** Open it (or use openpyxl/csv in a
   throwaway script) to see: sheet names, whether there's a metadata block
   above the real header row (common in exported reports — the server
   auto-detects the typical case), which columns hold formulas, column
   types, and roughly how many rows there are. This — plus the user's
   stated intent — determines the composition. Don't skip to writing HTML.

2. **Check dependencies.** The server needs `flask`, `openpyxl` (for
   .xlsx/.xlsm), `watchdog`, and `filelock`:
   ```bash
   pip install flask openpyxl watchdog filelock
   ```
   Legacy `.xls` file? Also `pip install xlrd` — the server converts it to
   a sibling `.xlsx` once on startup (openpyxl can't touch the old binary
   format) and tells the user; the original is left untouched. Formula
   cells that need live recalculation? See
   `references/formulas-and-limitations.md` before promising anything —
   support is partial and display-only (`--recalc`).

3. **Compose the app.** Create an app directory (or reuse the
   spreadsheet's), copy in `sheetsync.js`, `components.js`, `base.css`
   from this skill's `assets/`, and write an `app.html` that composes the
   blocks for this spreadsheet's purpose. `assets/example-app.html` shows
   the minimal composition shape (store → blocks → `store.start()`); it is
   also the server's fallback UI when `--ui` isn't given, but a real
   deliverable should almost always be a purpose-built composition, not
   the fallback. Load Chart.js via CDN only if the composition uses
   ChartBlock. Formula cells render read-only automatically; `_row` on
   each row is the absolute file row used by all write APIs.

4. **Run it and verify in a browser:**
   ```bash
   python sync_server.py --file "path/to/spreadsheet.xlsx" --ui "path/to/app.html" --port 5000
   ```
   Open `http://127.0.0.1:5000` and actually exercise the app: the blocks
   render with real data, an edit in the browser lands in the file, an
   edit to the file (or in Excel) shows up in the browser within a second
   or two, and the purpose-specific interactions (search, form save,
   filter) behave. Don't report done without exercising both sync
   directions.

5. **Tell the user about limitations that apply to their spreadsheet** —
   most commonly: formula cells are read-only in the browser and may show
   stale values until the workbook is resaved in Excel (see the reference
   doc), and Excel locks the file while open on Windows so browser edits
   will fail until it's closed or saved.

## What the server already handles

Don't rebuild these — they're in `sync_server.py` and the store: file
locking (browser vs. Excel write races), external-edit detection via
filesystem watcher, version-gated polling so unchanged data is never
refetched or re-parsed (a ~5,000-row sheet polls in ~0.15s), header-row
auto-detection for exports with metadata blocks above the table (surfaced
as `sheet.meta` for MetaPanel), formula-cell detection, legacy `.xls`
conversion, and CSV support.

## Read next

- `references/components.md` — full API for `SheetStore` and every block,
  plus wiring patterns. Read this before composing.
- `references/formulas-and-limitations.md` — formula recalculation limits
  and the `--recalc` flag, header-detection edge cases,
  concurrency/locking behavior, scaling notes. Read before telling a user
  their formulas will "just work" live, or when a sheet has an unusual
  layout.
