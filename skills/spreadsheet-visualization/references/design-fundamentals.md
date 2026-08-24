# Design fundamentals

The kit's blocks don't make a page read as designed on their own. A
composition can use every block correctly and still come out as slop
if the arrangement is wrong. This file is the taste layer, written for
an agent with no design background and no other design skill
installed.

Rules here come with numbers and checks. The numbers are defaults, not
physics: each rule that can be legitimately broken says when, in an
"Override" line. Breaking a rule without being able to state which
override applies means the rule stands.

## Recognize the defaults

Agents composing data apps fail in recurring ways. Check your plan
against these before building; if it matches one, that part was a
default, not a decision.

1. **Stacked control bands.** Tabs, then a search bar, then each
   filter dropdown, every one a full-width row. Five bands of chrome
   before any data.
2. **Panel fever.** Everything wrapped in a card, cards inside cards,
   until borders outnumber content.
3. **Chrome-heavy first screen.** Header, tile row, controls, and
   headings fill the viewport; the actual table starts below the fold.
4. **Tile inflation.** Six to eight stat tiles because the row looked
   sparse with three. Half of them are counts nobody asked for.
5. **Uniform emphasis.** Every section the same width, height, and
   weight. Nothing leads, so the eye has nowhere to start.

## The control bar

Failure 1, made into rules. All controls for a data region live in one
`.ss-row` inside the same panel as the data, not in stacked bands.

- **One control row per data region.** Never two stacked rows of
  controls over the same grid. Override: two data regions on one page
  each get their own bar, placed directly above their own data.
- **Order by scope**: view switcher, then search, then filters.
  Wider scope sits left.
- **Size controls to content.** Search 240 to 320px. A filter select
  120 to 200px. Never let a control stretch to fill the row: `.ss-row`
  stretches children evenly by default, so cap widths or the bar
  degenerates back into bands.
- **At most one search plus three filters per bar.** A fourth filter
  means the page is trying to be a query builder; use Tabs or a
  segmented control to split the view instead, or cut the least-used
  filter. Override: an explicitly exploratory page the user asked for.
- **The bar touches its data.** Same panel, one `--ss-gap` above the
  grid. A bar separated from its grid by other content is a mystery
  control.
- **Tabs sit above the bar, never inside it.** Switching views is
  navigation, not filtering.
- Check: count full-width control rows between the header and the
  data. The answer is 0 or 1 (tabs excluded).

## Hierarchy

One element leads each screen. In a data app the lead is the data:
the grid, the chart, the number the user came for. Chrome never
leads.

- **The lead is the largest element on first paint** and sits
  directly after the header (and control bar, if any).
- **Chrome uses at most three text sizes.** The kit's h1 (20px), h2
  (16px), and body cover it. A StatTile's 24px value is data, not
  chrome, and doesn't count. Adding a fourth chrome size means two
  levels are competing for the same rank.
- **Emphasis is rank, not seasoning.** Bold, size, and accent color
  mark the few things that outrank body text. If more than a third of
  the page is emphasized, nothing is.
- Check: shrink the page to a thumbnail or squint. You should still
  be able to point at the most important element. If two candidates
  tie, the sizes are wrong.

## Type

- **The floor is 12px for anything the composition sets.** Body text
  is `--ss-font-size` (14px default) and stays there; shrinking body
  text to fit more in is a density decision done wrong, use the
  density tokens instead. The kit itself goes below 12px in a few
  places (10px sort arrows, 11px on flow-chart sublabels and the
  collapse arrow); those are glyph-sized affordances, not text, and
  they don't license a composition to set 10px type.
- **Fonts belong to the theme.** A composition never loads or names
  its own font families; `--ss-font-body`, `--ss-font-display`, and
  `--ss-font-mono` are the whole vocabulary. Picking a font is
  theming, and goes through `theming.md`.
- **Prose gets a measure.** On explain and report pages, cap text
  blocks at 60 to 75 characters per line (`max-width: 65ch` is the
  safe default). Full-width paragraphs on a wide screen are
  unreadable, and tables earn full width, prose doesn't.
- Check: list the font sizes the composition itself declares, not the
  ones it inherits from `base.css`. Three or fewer beyond the tokens,
  none under 12px, and no family that isn't a token. If the page
  declares no sizes at all, that's the ideal, not a gap.

## Alignment and proximity

- **Edges line up.** Every block's left edge sits on the container's
  left line unless indentation encodes something. Count distinct left
  edges in the first viewport: three or fewer (container, indented
  group content, right-aligned actions). More means drift.
- **One vertical center per row.** Everything in a control bar aligns
  to the same middle. Kit inputs and buttons share a 36px height for
  exactly this; custom controls in the same row match it.
- **Distance encodes relationship.** A label touches its field. A
  search box sits against the grid it filters, not near a chart it
  ignores. Spacing inside a group is always smaller than spacing
  between groups; when they're equal, grouping disappears and the
  page reads as a list of parts.
- **A response appears where the user is looking.** Anything opened by
  a click (a detail panel, an expanded row, an inline editor) belongs
  next to the thing that was clicked, within the same screenful. Put
  it at the bottom of the page and the click looks like it did
  nothing, because the result is below the fold. Side by side beats
  stacked for anything driven by a selection.
- Check: for any two adjacent elements, say in one sentence why they
  are neighbors. No sentence, wrong neighbors.

## Proportion

Chrome is small, data is big.

- **Before the data: one header line plus at most one control bar.**
  On a desktop viewport the data region starts within roughly 150px
  of the top. Override: monitor dashboards, where the tile row and
  chart *are* the data and the grid is the appendix.
- **Most first-paint pixels are content.** Grids, charts, and tile
  values count as content; headings, controls, and empty panels
  don't. If chrome wins the pixel count, the page is upside down.
- **Small things stay small.** A stat tile is a card around one
  number (the kit floors it at 140px wide), not a quarter-screen
  billboard. A section heading is one line, not a display headline.
  Big treatment spent on chrome is stolen from the data.

## Scroll and stickiness

Data apps mostly don't need page-level sticky chrome, because the kit
keeps pages short: `DataGrid` scrolls internally (capped height, its
own sticky header row), so the page itself often fits a viewport or
two.

- **Default: nothing sticks.** The header and control bar scroll away
  with the page. Prefer making the page shorter (internal grid
  scroll, tabs) over pinning chrome to compensate for length.
- **Stick only what must stay usable during a long scroll.** SideNav
  on report pages is the shipped case (already sticky). A control bar
  may stick when the page genuinely scrolls several viewports and the
  controls act on what's below. Override: nothing else. A sticky page
  header on a two-viewport page is decoration.
- **Whatever sticks stays one row tall** and must never cover a
  focused element or the target of an anchor jump. Sticky chrome is
  rent paid in viewport pixels on every scroll; keep the rent low.
- **No entrance choreography.** Scroll-triggered fade-ins, slide
  reveals, and staggered appearances are landing-page moves; in a
  data tool they delay the data and read as decoration. Content is
  simply there on load. Motion in a data app is feedback: hover,
  active, an updating value, the StatusDot spinner. Fading or sliding
  is acceptable only for something appearing in response to the
  user's own action (a detail panel opening), never for content
  arriving on scroll.
- Check: count sticky elements outside the kit's own (grid header,
  SideNav). Zero or one. Count scroll-triggered animations. Zero.

## Density and rhythm

- **One spacing scale, repeated.** `--ss-gap` between blocks, the
  blocks' own internal spacing inside. An element floating at an odd
  one-off distance reads as a mistake even when it was deliberate.
- **Empty space is a tool.** It separates groups and lets the lead
  element lead. Don't fill a sparse area with an extra tile, label,
  or decoration; sparse and clear beats full and noisy.
- **Density is a per-page decision, made once.** A dense operational
  grid page may tighten `--ss-pad`/`--ss-gap` a few px; a report page
  may loosen them. Never mix a dense section and an airy section on
  the same page without a reason you can state.

## Restraint

When unsure, subtract. Slop is almost always additive: each extra
control, badge, border, and label felt justified alone, and together
they bury the page.

- **The remove-one pass.** After composing, remove the one element
  you were least sure about and look again. If the page got worse,
  put it back. It usually doesn't.
- **Decoration never fixes a weak layout.** If the page feels bland,
  the cure is hierarchy and spacing, not more boxes, icons, or color.
- **Every element earns its place by what it lets the user do or
  know.** "The row looked empty" is not a job. Anything on the page
  that has no job comes off.
- **Subtract chrome, not answers, and never orientation.** Restraint
  applies to decoration, duplicate controls, and boxes around boxes.
  It does not apply to two things. First, analysis: a page that drops
  the one chart the data was asking for isn't restrained, it's
  incomplete, and the user is back to reading numbers off a grid,
  which is what they had in Excel. Second, and more often missed,
  orientation: the sentence explaining that edits write straight to
  the file, or that these columns edit inline and those open a panel.
  Those lines look like chrome in a screenshot and read as essential
  the first time someone uses the page. A minimal-looking page that
  leaves the user guessing which cells are editable is not clean, it's
  unfinished. When the cut is between two ways of saying the same
  thing, cut. When it's between saying something and saying nothing,
  say it.
