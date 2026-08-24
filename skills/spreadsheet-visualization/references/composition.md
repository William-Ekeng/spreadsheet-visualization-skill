# Composing the page

`components.md` covers what each block does and how to call it.
`design-fundamentals.md` covers the design literacy that applies to
any page. This doc covers composing the kit into a page for a
particular spreadsheet. Read all three before writing `app.html`.

Two kinds of content here, and they carry different weight.

The **hard rules** below are hygiene: accessibility, token discipline,
state handling, honest copy. They hold whatever the file looks like,
and they're checkable, so they're worth being absolute about.

Everything after them is **guidance**: what the blocks are good at,
what tends to work, and which mechanisms bite. Spreadsheets are
strange in ways no rule anticipates, and you can see the file. When
guidance and the file disagree, follow the file and say why. A
composition that is obviously right for this data does not become
wrong by departing from a heuristic here.

## Hard rules

Nine rules, all checkable, none dependent on what the spreadsheet
happens to look like.

1. **Every color, font, radius, and spacing value comes from `--ss-*`
   tokens.** No raw hex, no one-off font sizes, no hand-tuned margins
   sitting next to the token system. Raw hex is a bug even when it
   looks right today, because the next theme swap breaks it silently.
   A per-app accent is one line: override the token in the page's own
   `<style>`, not an inline color.
2. **Contrast is computed, never eyeballed.** 4.5:1 for text and small
   icons, 3:1 for UI boundaries, measured against the surface
   underneath. Shipped themes are already validated. This matters when
   a composition adds its own color: check what sits on it (`theming.md`
   has the traps).
3. **Every interactive element has visible hover, focus-visible, and
   active states.** Kit blocks already have them. Custom HTML doesn't:
   a `<button class="ss-btn">` is covered, a bare styled `<div>` is
   not. Never remove an outline without a focus-visible replacement.
4. **Reduced motion is honored.** Custom animation touches only
   `transform` and `opacity`, and respects `prefers-reduced-motion` the
   same way `base.css` already does for its own transitions.
5. **Every composition handles loading, empty, and disconnected
   states.** A composition with only the happy path is unfinished, not
   minimal. The States section below splits what the kit already
   covers from what you still owe.
6. **One accent per composition, locked. Color only carries meaning,
   never decoration.** No second accent creeping in halfway down the
   page. Badges stay neutral unless they mean pass, fail, warn, or
   branded (`components.md` has the exact rules). Charts take their
   colors from the fixed `--ss-chart-*` slots.
7. **Semantic HTML first.** `<button>` for actions, `<a>` for
   navigation, `<label>` on every input, `<table>` for tabular data. No
   `<div>` with a click handler. Kit blocks already comply; custom
   parts must too.
8. **Real content survives.** Long values truncate or wrap on purpose.
   Numbers get `format` functions for money, dates, and thousands
   separators. Test against the sheet's actual longest and shortest
   values, not placeholder text. There's no excuse: the real data is
   right there.
9. **Done means exercised.** Tab through the page. Focus an input.
   Resize the window. Edit a cell in the browser and watch it land in
   the file; edit the file and watch the browser update. This is
   SKILL.md's workflow step 4. The checklist at the end of this doc is
   how you run it.

## Choosing blocks

You are deciding here, not looking up an answer. What follows is what
this kit's blocks are good and bad at, plus the mechanical facts that
are easy to discover too late. None of it outranks the spreadsheet in
front of you: if the file says otherwise, the file wins. A guideline
that produces something obviously worse for this data was the wrong
guideline for this data.

Where a note below sounds like a rule, it is reporting a mechanism,
not issuing an order.

**Grid editing vs a detail form.** Inline editing is direct and fast
for short rows. Two mechanical limits decide it more often than taste:
a sheet wide enough to scroll horizontally makes in-cell editing
awkward, and a textarea-typed column renders in the grid as a
single-line contentEditable cell, so line breaks cannot be entered
inline at all. A `RecordForm` gives that column a real growing
textarea, and typed date/number inputs besides. The two combine well:
narrow columns editable in the grid, the rest in the form.

**Where a detail panel opens.** Beside the grid, not below it. This
one is worth treating as firm because it was observed failing: with
the form rendered underneath, clicking a row puts the response below
the fold, so the click appears to do nothing and the user scrolls past
the whole table to find it, then back to pick another row. An
`.ss-row` holding the grid (`.ss-grow`) and a 320-420px panel handles
it, and wraps to stacked on narrow screens by itself.

**What's editable.** `DataGrid` defaults to `editable: true`, so this
is one of the few places where *not* deciding still produces a
decision. Worth an explicit thought either way: which columns should a
person be able to change, and does the sheet lose something if they
change the wrong one. Formula cells protect themselves regardless.

**Aggregates: tiles or a chart.** StatTiles suit a handful of
independent numbers; a chart answers a question about distribution or
trend that a grid can't show at a glance. A doughnut with `centerText`
already displays its own total, so a StatTile repeating that number is
duplication. If the sheet has a numeric column and something to group
it by, there is usually a question worth answering; whether it earns a
chart on this page is yours to judge.

**Chart form follows the question.** Bar compares categories, line
shows a trend over an ordered axis, scatter relates two numeric
fields. Pie and doughnut stay readable to about five or six slices
before the palette repeats. `aggregate` groups by x, which is what
categorical data almost always wants; ungrouped categorical charts
plot one bar per row. `topN` (default 30) trims long tails and prints
what it dropped. `controls` turns a chart into an exploration tool,
which is right when exploring is the point and noise when it isn't.

Two things about charts are not judgment calls, because they're
hygiene: give every chart a visible heading (single-series charts hide
their legend, and `label` only reaches tooltips), and let colors come
from the `--ss-chart-*` tokens rather than hardcoded values, so a
theme swap repaints them. After swapping themes at runtime, call
`.refresh()`.

**Tabs, sections, and other surfaces.** Tabs read as peer content, so
what you put in one is a claim about rank. Sections read as parts of
one page. A `Collapsible` or an icon-button panel reads as secondary
or configuration. A workbook's sheets often aren't peers (a lookup
list feeding dropdowns isn't the same rank as the ledger it feeds),
and matching the surface to the role is usually more useful than
mapping one tab per sheet. Whether a reference sheet is worth showing
at all, and whether it should be editable, depends on whether someone
maintains it by hand: if they do, they will want to see it and change
it.

**Blocks with narrow uses.** `MetaPanel` hides itself when a sheet has
no metadata block, so it costs nothing where it doesn't apply.
`FlowChart` draws nodes and edges and needs data shaped that way.
`SideNav` with `.ss-doc` suits long prose pages. `SearchBox` earns its
place once a sheet outgrows a screenful, and its `columns` option
keeps noisy fields out of matching.

**Never render an instruction the page can't carry out.** This one is
firm, and it is about promises rather than layout. Reference sheets
often carry a maintenance note written for someone sitting in Excel
("to add a product, insert a row in the list above"). Displayed beside
a list with no way to add a row, it is a broken promise. Either make
the surface do what the note says, or say where the work actually
happens. Text lifted out of a spreadsheet is content, not interface
copy.

## Build what the sheet needs

Everything above is a menu of blocks, and reading only that leads to a
page that configures blocks instead of doing the job. The blocks cover
the shapes that recur across spreadsheets. They do not cover what any
particular spreadsheet is *for*, and the gap is where a page stops
being a viewer and becomes a tool.

Ask what a person actually does with this file, then check whether a
block does it. Where none does, build it: a composed page is plain
HTML, and `store.saveCell`/`addRow`/`deleteRow` are available to
anything you write. Custom controls sync exactly like blocks do.

Real examples from this kind of workbook:

- An order template reserves hundreds of pre-formatted rows. `addable:
  true` appends after them; what the user wants is the next free row
  inside the block. That's a custom button calling `addRow` after
  finding the first empty row.
- The same template shows a wall of blank reserved rows. A "hide empty
  rows" checkbox feeding `setFilter` makes it usable, and no block
  offers it.
- A config sheet holds the dropdown values the main sheet validates
  against. Reading it to populate a select is a few lines and turns
  free-text typing into picking from the file's own list. Do both:
  feed the dropdowns from it *and* give it a config-shaped surface, as
  above, so the values are traceable to the sheet they came from.

The constraints still apply to anything you build: token colors and
spacing, visible focus states, semantic elements, a label on every
input. "Not a ceiling" is about scope, not about lowering the bar.

## The page shell

`base.css` gives the body 24px padding and no width limit. The
composition owns the rest.

- **Give the page a width.** `base.css` sets none, so text runs the
  full monitor unless the composition decides otherwise. Around
  1100-1200px centred suits most pages; a wide table may want all of
  it, prose wants less.
- **Header: identity, status, and what this thing writes to.** An `h1`
  naming what the app is for, "Warehouse inventory," not "data.xlsx,"
  with `StatusDot` beside it in an `.ss-row`. `h1` renders at 20px.
  This is app chrome, not a marketing hero: no oversized display type,
  no eyebrows, no slogans. One quiet line under the title is not a
  slogan and belongs there: name the file and say edits are written
  straight into it ("commandes.xlsx, every change is saved directly to
  the file"). A person typing into a web page has no way of knowing
  their keystrokes are rewriting a spreadsheet on disk, and that is
  the one thing about this app they most need to know.
- **Section order follows the archetype.** Manage and lookup: controls
  (search, filters, tabs) sit directly above the grid they drive.
  Monitor: tiles, then chart, then the detail grid last. Append: the
  entry form on top, recent rows below. Explain: hero prose, then
  `.ss-doc` with SideNav. In every case the most-used element goes
  first. Nothing sits above it that the user scrolls past on every
  visit.
- **Group with the panel, once.** `.ss-panel` groups a control with
  the block it drives, search plus grid. DataGrid and `ss-facts`
  tables are already bordered cards. Don't nest panels for effect: one
  level of grouping, then flat.
- **Tiles work in a short row.** `.ss-row` wraps them on narrow
  screens by itself. Past a handful they stop reading as headline
  numbers and start reading as a table, which the grid already does
  better.
- **Spacing is the token.** `.ss-stack` between sections, `.ss-row`
  within them, `--ss-gap` everywhere. If you're typing `margin-top:
  13px`, stop and use the utilities. A dashboard with many tiles or a
  dense grid can tighten `--ss-pad`/`--ss-gap` a few px in the page's
  own `<style>`; that reads as intentional density, not clutter. A
  report or explain page wants the default or more room, not less.
- **Touch targets.** Any interactive element the composition adds
  directly, a custom button, a custom filter control, needs at least a
  44×44px hit area. Kit controls handle their own. `DataGrid`'s
  row-delete button is the one deliberate exception: compact by design
  for a dense table, not meant as a touch target.

Charts and grids handle their own responsiveness. The shell's job is
the width cap, `.ss-row` (it wraps on its own), and a check at phone
width before calling it done. `.ss-doc` collapses itself below 800px.

## States

The kit handles some states. The composition owes the rest.

- **First paint.** Blocks render before the first payload arrives, so
  sheet names are unknown at construction time. Use the
  subscribe-then-refresh pattern from `example-app.html`: set the
  active sheet once data lands, then call `.refresh()` on the blocks.
  Don't assume data exists at t=0.
- **Connection.** Every composition includes `StatusDot` in the
  header. It already distinguishes connected from reconnecting. Don't
  hide it, don't rebuild it.
- **Empty sheet.** An addable grid still shows its Add row button, so
  a manage app starts usable even with zero rows. A read-only
  composition needs to say something instead, "No rows yet, add
  entries in the spreadsheet," not render a bare panel.
- **Zero matches.** The grid's pager already prints "0 matches" when a
  filter is active, so search never strands the user silently. Custom
  data-bound islands, a facts table filled by `store.subscribe`, owe
  the same courtesy.
- **Failed writes.** On Windows, Excel holding the file lock makes
  browser edits fail until it's closed. The server answers 423 with a
  plain-language message, and `saveCell`/`addRow`/`deleteRow` throw it
  rather than resolving quietly. Subscribe with `store.onError(fn)` and
  show what it gives you: a write that fails invisibly looks exactly
  like one that worked, so the user keeps typing into a file nothing is
  reaching. Mention the limitation in what you tell them at the end
  (SKILL.md step 5).
- **Formula cells.** Already read-only, with the formula shown as a
  tooltip. Nothing to build here, just leave the columns visible
  instead of hiding them. The values still matter to the reader.

## Voice

Copy is part of the composition, not an afterthought.

- **Write every word in the data's language.** A French spreadsheet
  gets a French interface: "Fermer", not "Close"; "+ Nouvelle
  commande", not "+ Add row". This is the easiest thing on the page to
  get wrong, because the kit's own defaults are English and so is
  every example in these docs. Copying an example string verbatim is
  how a French page ends up with an English button. The kit's strings
  are overridable (`SearchBox`'s `placeholder`, `DataGrid`'s and
  `StatusDot`'s `labels`; see the Language section of
  `components.md`), so decide the language once, keep the strings in
  one object at the top of the page, and pass them in. Column names
  are the exception: they stay exactly as the file spells them, typos
  included, because they're data.
- Buttons say what they do: "Add row," "Save," "Delete," not "Submit"
  or "Go." Use one label per action across the whole page; don't call
  the same action "Add row" in the grid and "New entry" in a form.
- **Only promise what the page can do.** Any instruction on screen has
  to be performable on that screen, or it has to say where the work
  happens instead. A note telling the user to add a row, sitting on a
  list with no Add control, is worse than no note at all. This applies
  to text copied out of the spreadsheet too: the file's own notes were
  written for someone in Excel, and they are content, not
  ready-to-use interface copy.
- Empty and error states give direction, not apology. "No rows yet,
  add entries in the spreadsheet," not "Oops, nothing here!" A failed
  write says what happened and what to do: "Couldn't save, close the
  file in Excel and try again," not a raw error message.
- Plain verbs, sentence case, second person when addressing the user
  directly. Cut filler like "please note" or "simply click."
- **Say how editing works, once, where it happens.** A composed page
  mixes editable and read-only columns, inline cells and a detail
  panel, for reasons the user cannot see. One muted line under the
  grid earns its place: which columns edit inline, that clicking a row
  opens the rest, that formula columns are read-only and why. Without
  it people click a locked cell, conclude the page is broken, and go
  back to Excel. This is orientation, not decoration, and the
  restraint rules don't apply to it: cut it only when the page is so
  simple that every column behaves the same way.

## Anti-patterns

Each of these is the composer following a shipped default instead of
deciding. Recognizable, and worth naming so you catch them in your own
work before someone else does. Arrangement-level slop (stacked
control bands, chrome outweighing data, no focal element) is covered
in `design-fundamentals.md`; these are the kit-specific tells.

- Every column editable because that's `DataGrid`'s default, not
  because every column should be.
- A second accent color for "just this one button" or "this needs to
  stand out."
- Kit blocks holding one radius scale while custom HTML the page adds
  uses a different one.
- Three StatTiles padded out to five because a row of two looked
  sparse.
- A FlowChart, Collapsible, or SideNav added because it looks
  impressive, not because the sheet's data is a process, a report, or
  long enough to need one.
- A small-caps eyebrow label above every section for rhythm, saying
  nothing the heading didn't already say.
- An oversized `h1` and tagline on what is app chrome, not a landing
  page.
- Placeholder text left as the only label a user ever sees.

## Before reporting done

This is the verification pass, so it lists what can actually be
checked rather than restating the guidance above. Report findings
tersely, `app.html:112 - second accent introduced`, the same format as
a code review.

1. Tokens: no raw hex, no ad hoc font sizes, radii, or margins.
2. Contrast: any color the composition introduced, checked against the
   surface it sits on.
3. Keyboard: tab reaches every control, focus is visible everywhere,
   nothing traps.
4. Motion: custom animation guarded for reduced motion, and no
   scroll-triggered entrances.
5. States: first paint, empty sheet, zero matches, StatusDot present.
6. Color meaning: one accent, badges neutral unless semantic, charts
   titled and colored from tokens.
7. Markup: no clickable divs, every input labelled.
8. Content: the sheet's longest real value displays sanely, numbers
   formatted.
9. Width: checked at phone width and full width, no horizontal page
   scroll.
10. Selection: click a row and confirm the detail panel appears
    without scrolling.
11. Language: every visible string in the data's language, kit label
    defaults included. Column names keep the file's spelling.
12. Promises: every instruction on screen is performable on that
    screen, or names where it is.
13. Sync: an edit in the browser lands in the file, an external edit
    shows up in the browser.

Then look at the page and ask whether you would use it to do this
file's job. That question catches things no list does, and it is the
one that has caught the most.
