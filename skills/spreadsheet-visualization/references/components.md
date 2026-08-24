# Component kit reference

The three asset files are the whole frontend framework. No build step, no
external dependencies except Chart.js (CDN) when a composition uses
`ChartBlock`:

- `sheetsync.js`: `SheetStore` (data layer) + type-inference helpers
- `components.js`: the UI building blocks
- `base.css`: design tokens (`--ss-*`), block styles, layout utilities

A composed app is one HTML file that includes these three, creates a
`SheetStore`, and instantiates the blocks it needs. Copy all three next to
the composed HTML; the server serves that whole directory.

## SheetStore (sheetsync.js)

```js
const store = new SheetStore({ api: "", pollMs: 1000, loadingText: "Loading…", showLoading: true });
store.subscribe(fn)          // fn(store) called whenever data changed; returns unsubscribe
store.onStatus(fn)           // fn(connectedBool) on connect/disconnect transitions
store.onError(fn)            // fn(message) when a write is refused (locked file, etc); writes also throw
store.loaded                 // false until the first payload lands
store.start()                // begin polling (cheap /api/version; fetches only on change)
store.sheetNames()           // ["Orders", ...]
store.sheet(name)            // {headers, rows, formulas, meta, header_row}; rows carry _row (absolute file row)
store.isFormulaCell(sheet, rowIdx, column)
await store.saveCell(sheet, rowIdx, column, value)
await store.addRow(sheet, {col: value, ...})   // resolves to the new absolute file row
await store.deleteRow(sheet, rowIdx)
```

`start()` polls `/api/version`, and when it moves it fetches
`/api/changes?since=N` and replays the ops onto its local copy, so a
one-cell edit costs a couple of hundred bytes rather than the workbook. It
falls back to the full `/api/data` payload by itself when the server says
it can't describe the difference (first load, a page that was away too
long, a restarted server, a large external edit). Nothing in a composition
has to know which happened: `subscribe(fn)` fires either way, and
`store.sheet(name)` returns the same shape. `_applyChange` is the mirror of
`_apply` in `sync_server.py`; if you adapt one, adapt both.

Helpers: `inferFieldType(sheetData, column)` returns `"number" | "date" |
"checkbox" | "select" | "textarea" | "text"`. It picks `"textarea"` when the
sampled values contain a line break or average over 60 characters, which
catches notes and description columns without catching short labels.
`columnValues(sheetData, column)` returns sorted distinct strings (for select
options / filter dropdowns).

## Blocks (components.js)

Every block: `Block(containerEl, ...)` returns `{ el, destroy, ...extras }`.
All re-render automatically on store changes. `sheet` options accept a
string or a `() => string` thunk so tab-driven pages can switch sheets
without rebuilding blocks.

| Block | Purpose | Key options / extras |
|---|---|---|
| `Tabs(el, items, opts)` | sheet/view switcher | `onSelect(name)`, `active`; extra: `.active` getter |
| `MetaPanel(el, store, opts)` | key/value strip from `sheet.meta` | `sheet`; hides itself when meta is empty; extra: `.refresh()` |
| `StatTile(el, store, opts)` | one live aggregate number | `label`, `sheet`, `compute(rows, sheetData)`, `format(v)`; extra: `.refresh()` |
| `SearchBox(el, opts)` | text search producing a row predicate | `columns` (limit searched fields), `onChange(predicateOrNull)`; renders a leading search icon; extra: `.clear()` |
| `DataGrid(el, store, opts)` | paginated sortable editable table | `sheet`, `columns` (subset+order), `editable` (bool or array of column names), `pageSize`, `deletable`, `addable`, `onRowClick(row)`, `format` ({col: fn}), `types` ({col: type}, overrides `inferFieldType` per column, same convention as `RecordForm`), `labels` ({add, range, matches}, see Language). An editable column typed `"select"` renders an inline dropdown of that column's distinct values; one typed `"checkbox"` renders the same checkbox `FieldInput` uses. Both write on change. Every other editable column stays a contentEditable text cell. Renders as one connected bordered card with horizontal-only row dividers (no vertical column lines); extras: `.setFilter(fn)`, `.setPage(n)`, `.refresh()` |
| `AddRow(el, store, opts)` | standalone "create a record" button | `sheet`, `label`, `values` (object or `(sheetData) => object`, seeds template defaults), `className`, `onAdded(row)` where `row` is the absolute file row just created. Independent of `DataGrid`: a read-only grid can still have an add control, and `onAdded` lets a page open a form on the new row. `DataGrid`'s `addable` renders this same block in its toolbar |
| `ChartBlock(el, store, opts)` | Chart.js chart | `sheet`, `x`, `y`, `type`, `aggregate` (`"sum"\|"avg"\|"count"` groups by x, usually what categorical charts want), `topN` (default 30), `controls` (adds type/x/y dropdowns), `label`, `centerText` (doughnut only, draws the live sum + label in the ring's center); extras: `.setFields(x, y)`, `.refresh()` |
| `FieldInput(el, opts)` | one typed editor | `type` (from `inferFieldType`, plus `"toggle"`, an on/off switch not offered by inference but usable directly), `value`, `options`; extras: `.get()`, `.set(v)`. `"textarea"` renders a multi-line `<textarea class="ss-input">` instead of the single-line `<input>`. It grows with its content from 80px to 320px, then scrolls; the browser's drag-resize handle is off, so height is always driven by the text. Commits on blur or Ctrl/Cmd+Enter, since plain Enter inserts a newline |
| `RecordForm(el, store, opts)` | edit one row as a form | `sheet`, `row`, `columns`, `types` (overrides), `onSaved(col, value)`; skips formula cells; autosaves per field as it commits (blur for text/number/date/textarea, change for select, click for toggle). No Save/Cancel, same live-sync convention as DataGrid |
| `StatusDot(el, store, opts)` | connection indicator | `labels` ({connected, reconnecting}); despite the name, renders an icon rather than a colored dot: a static checkmark (success green) when connected, a spinning loader (warn amber) while reconnecting. A color-only dot can't distinguish "connected" from "currently retrying"; an animated icon can. Respects `prefers-reduced-motion` (icon/color alone still carry the state without the spin). |
| `Collapsible(el, opts)` | expandable card / step timeline | `num`, `title`, `subtitle`, `tag` + `tagClass` (badge on the right), `open`, `content` (string, Node, or `(bodyEl) => void` to render data-bound blocks inside); extras: `.body`, `.setOpen(v)` |
| `SideNav(el, items)` | sticky sidebar nav with scrollspy | items: `[{label, target: "#section-id"}]`; highlights the section in view, smooth-scrolls on click |
| `FlowChart(el, opts)` | nodes connected by real drawn SVG edges (mermaid/mindmap-style, not text arrows) | `direction` (`"LR"`\|`"TB"`), `nodes: [{id, label, sub, variant}]`, `edges: [{from, to, label}]`; auto-layers nodes by longest path from a root so branches (a node with two children, or a shortcut edge) lay out correctly, not just a straight chain; extras: `.relayout()`, `.destroy()` |

`Tabs` renders two looks. Default (no `variant`) is an underline style: no
container chrome, plain-weight muted labels, and the active item gains
full text weight/color plus a bottom border in `currentColor`. Tab
selection is navigation state, not a status badge, so it's expressed with
weight/underline rather than a color fill. `variant: "segmented"` is a
boxed toggle: a bordered track (`--ss-th-bg`) holding plain-text items,
with the active item set apart as its own bordered pill (`--ss-panel` +
`--ss-shadow`). The pill itself is the separation; no extra divider
needed. Use segmented for a small binary/ternary mode switch
(Today/With-pipeline); default underline for everything else (sheet
switching, page sections).

`agg` shortcuts for StatTile: `agg.sum(col)`, `agg.avg(col)`,
`agg.count(col, value?)`, `agg.distinct(col)`. Example:
`compute: agg.sum("Sales")`.

## Layout, theming, and CSS-only primitives

`base.css` gives layout utilities, not a layout: `.ss-panel` (card),
`.ss-row` (flex row, wraps), `.ss-col`/`.ss-stack` (vertical), `.ss-grow`/
`.ss-shrink` (flex sizing), `.ss-muted`, and `.ss-doc` (two-column
sticky-nav + content grid for report/doc-style pages, collapses on
narrow screens). Arrange them however the app's purpose demands.

**Theming.** `base.css` is structure plus a token contract; a theme is a
stylesheet loaded after it that redefines the tokens. Five ship in
`themes/` (brutalist, retro, lofi, cozy, cyberpunk). The default follows
the reader's OS colour scheme; `<html data-theme="dark">` or
`data-theme="light">` forces one. Themes are single-look and ignore the
OS setting (see `theming.md`). ChartBlock reads its palette and ink
from tokens at render time, so themes restyle charts too. Full contract,
shipped themes, and the write-a-new-theme procedure (including the
mandatory chart-palette validation) are in `references/theming.md`.
Preview any theme against every block with `assets/theme-preview.html`.

**Scrollbars** are themed globally via a universal selector in
`base.css` (`scrollbar-color`/`-width` plus the `::-webkit-scrollbar-*`
pseudo-elements), reading `--ss-border`/`--ss-muted` for color and
`--ss-radius-sm` for the thumb's corner (sharp in brutalist, soft
everywhere else). This covers every overflow container automatically,
including the page itself, `DataGrid`'s inner scroll, and any future
scrollable block a composition adds, with nothing to opt into
per-component.

**CSS-only primitives** (no JS constructor, just markup):

- Badges/pills: `<span class="ss-badge">Source · git</span>`. Default is
  a quiet neutral pill: no color, no dot, never. A dot never earns its
  place (it repeats what color/text already say); if a badge genuinely
  needs a visual marker, use an icon (an inline SVG or `<img>` child;
  `.ss-badge svg` is already sized/spaced for it), not a dot. Color is
  reserved for variants that carry real meaning: `ss-badge-destructive`
  (red: errors, absent, blocked), `ss-badge-success` (green: pass,
  deployed, positive), `ss-badge-warning` (amber: needs attention),
  `ss-badge-accent` (the theme's accent color: a highlighted/branded tag,
  not a status). A badge is a status/type signal, not decoration. If a
  label doesn't mean pass/fail/warn/branded, it stays neutral.
  `Collapsible`'s `tag`/`tagClass` options render through this same
  primitive.
- Fact tables: `<table class="ss-facts">` with a `FACT | VALUE | SOURCE`
  header. Spec-sheet style definition rows; wrap values in `<code>`.
  Same horizontal-only divider treatment as DataGrid; wrap it in a
  `.ss-panel` for the outer border. It doesn't self-wrap; ChartBlock and
  other content-only blocks follow the same convention.
- Buttons: `<button class="ss-btn">`. The base is the outline look
  (bordered, panel background); modifiers layer a fill on top.
  `ss-btn-primary` is a strong inverted fill: background swaps to
  `--ss-text`, text swaps to `--ss-bg`, so it's automatically
  near-black-on-white in a light theme and white-on-near-black in a dark
  one, with no light/dark branching needed. This is *the* call-to-action;
  use it sparingly. `ss-btn-secondary` is a muted solid fill derived as
  `color-mix(--ss-muted 16%, --ss-panel)`. It is deliberately *not*
  `--ss-th-bg`: that token is tuned per-theme for the table-header
  context specifically and collided black-on-black in brutalist when it
  was tried there first. `ss-btn-ghost` is fully transparent until hover,
  for the least emphasis. `ss-btn-destructive` is a solid `--ss-danger`
  fill, for an actual destructive action (same "color means something"
  rule as badges). Add `ss-btn-icon` for a same-height square icon-only
  button (pairs with any fill modifier); size the icon itself via
  `.ss-btn-icon svg` (already set to 16px).

Both tables' row dividers use `color-mix(--ss-text N%, transparent)`
rather than the flatter `--ss-border` token. `--ss-border` alone (10%
white in the default dark theme, matching shadcn/ui's own value) reads as
barely-there once actually rendered on a table; mixing against `--ss-text`
keeps the line self-scaling and legible in both light and dark without a
dedicated token. brutalist restores full cell-boxed borders as a
deliberate override (bold grid lines are that theme's whole vocabulary);
lofi's dashed override still applies since it only touches border-style.

**Inputs, labels, and MetaPanel** are grounded against shadcn/ui's Input/
Label/Checkbox source. Not the library itself; the same borrowed-values
approach as the default theme's neutrals:

- `.ss-input`/`.ss-search`/`select.ss-input` share a fixed 36px height,
  the same height `.ss-btn` uses, so an input and a button sitting side
  by side line up, the same
  hairline `--ss-shadow` buttons/panels use, and a focus state that's a
  border-color change plus a soft 3px glow ring
  (`color-mix(--ss-accent 35%, transparent)`) rather than a plain outline.
- The checkbox is a rebuilt control, not the native browser widget:
  `appearance: none`, a 16px rounded square, and, when checked, a masked
  SVG checkmark icon. The checked fill reuses the button-primary pair
  (`--ss-text` background, `--ss-bg` icon), not `--ss-accent`. Text and
  bg are chosen to contrast with each other by definition in every theme,
  where an accent color's contrast against its own fill isn't guaranteed
  (some themes' accents are light-on-light).
- `.ss-form-label` (and `FieldInput`'s paired labels) dropped the old
  12px-muted-caps treatment for shadcn's actual Label convention: regular
  `--ss-font-size`, `font-weight: 500`, full `--ss-text` color. A label
  is not a muted eyebrow; it's the same weight class as the value it
  names.
- `MetaPanel` follows the same correction: label is plain `--ss-muted`
  text at body size (no uppercase/letter-spacing), value is
  `font-weight: 500` in `--ss-text`. shadcn's typography scale has no
  small-caps-eyebrow convention, so this stopped inventing one.

**The blocks are not a ceiling.** A composed page is plain HTML. For
doc/report-style pages (hero typography, prose sections, custom cards),
write ordinary HTML/CSS and use the kit only where content is data-bound:
a `store.subscribe` that fills a fact table, StatTiles inside a
Collapsible body, a ChartBlock behind a segmented toggle. Anything with
no matching block gets built directly on `SheetStore` and still syncs
live.

## First paint

Reading a workbook takes a moment, and a page that builds its blocks
inside `subscribe()` renders nothing at all until data arrives. A bare
header with a connected badge beside it reads as "loaded fine, nothing
here", which is worse than a blank page because it asserts success.

`SheetStore` handles this itself: `start()` mounts a `.ss-loading`
overlay and removes it when the first payload lands. It fades in after
0.35s, so a fast local read never flashes it, and it carries
`role="status"` / `aria-live="polite"`. Set the wording with
`loadingText` (match the data's language), or pass
`showLoading: false` to own the moment yourself and use `store.loaded`
to branch.

`StatusDot` reports the store's real state rather than assuming
success, so a page that can't reach the server shows "reconnecting"
instead of claiming to be connected.

## Language

Every string the kit renders defaults to English, and a spreadsheet's
data is often not. Mixing them ("Close" beside "Fermer", "3 matches"
under "Commandes") reads as unfinished, and it is: the composition
never chose a language.

Decide once, from the data and the user, then carry it everywhere,
through the kit's own labels and through every string the page writes
itself. Keep them in one object at the top of the composition
(`const t = { close: "Fermer", add: "+ Nouvelle commande", ... }`)
rather than scattered through the file, so nothing is missed and the
language is visible in one place. Column names always stay exactly as
the file spells them, typos included; they are data, not copy.

The overridable strings:

| Block | Option | Defaults |
|---|---|---|
| `SearchBox` | `placeholder` | `"Search…"` |
| `DataGrid` | `labels: {add, range, matches}` | `"+ Add row"`, `` (from,to,total) => `${from}–${to} of ${total}` ``, `` n => `${n} match${n===1?"":"es"}` `` |
| `StatusDot` | `labels: {connected, reconnecting}` | `"connected"`, `"reconnecting…"` |

`range` and `matches` are functions so a language can put the numbers
where its grammar wants them. Everything else the user reads (buttons,
headings, empty states, the close control on a detail panel) is
written by the composition, so it is language-correct only if you make
it so.

## Wiring patterns

Adding a record when the grid is read-only. `addable` is a `DataGrid`
option, but creating a record is a page-level capability, so a
composition that makes its grid read-only would otherwise have no way
to add one, and `RecordForm` only edits rows that already exist. Use
`AddRow` anywhere on the page, and open the form on what it created:

```js
AddRow(barEl, store, {
  sheet: "Commandes",
  label: "+ Nouvelle commande",
  values: () => ({ Statut: "-", Montant: 0 }),   // template defaults
  onAdded: row => {
    const fresh = store.sheet("Commandes").rows.find(r => r._row === row);
    if (fresh) RecordForm(detailEl, store, { sheet: "Commandes", row: fresh });
  },
});
```


Search feeding a grid: `SearchBox(el, { onChange: f => grid.setFilter(f) })`.

Grid row opening a detail form. `onSaved` fires after *each* field
autosaves, not once at the end (there's no "done editing" moment), so
don't use it to close the panel. A separate explicit close control, or
clicking another row, is what ends the editing session:
```js
const grid = DataGrid(gridEl, store, { sheet: "Contacts", onRowClick: row => {
  detailEl.textContent = "";
  const closeBtn = document.createElement("button");
  closeBtn.className = "ss-btn"; closeBtn.textContent = t.close;  // page's own language, see Language below
  closeBtn.onclick = () => detailEl.textContent = "";
  detailEl.appendChild(closeBtn);
  RecordForm(detailEl, store, { sheet: "Contacts", row });
}});
```

Tabs driving everything: keep `let active = "Orders"` in page scope, pass
`sheet: () => active` to each block, and in the tab's `onSelect` set
`active` and call `.refresh()` on blocks that need it.

Custom filter dropdown (no dedicated block needed; it's just a select
feeding `setFilter`):
```js
const sel = document.createElement("select");
["All", ...columnValues(store.sheet("Orders"), "Region")].forEach(v => sel.add(new Option(v)));
sel.onchange = () => grid.setFilter(sel.value === "All" ? null : r => r.Region === sel.value);
```

Multiple filters on one grid: `setFilter` replaces the whole predicate, so
either combine conditions into one function, or, if the filters are
mutually exclusive (a search box vs. a category dropdown), have each
clear the other's *input* without firing its callback. `search.clear()`
fires `onChange(null)`; if that callback also resets your dropdown you get
a feedback loop where the dropdown's filter is immediately undone. Setting
`search.el.value = ""` clears the text silently and avoids the loop.
