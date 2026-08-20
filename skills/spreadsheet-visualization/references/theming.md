# Theming

A theme is a stylesheet loaded **after** `base.css` that redefines the
token contract and, only where tokens can't express an effect (hard
offset shadows, glows, dashed hairlines), adds scoped overrides of `ss-*`
classes. Components never change: they only reference tokens.

```html
<link rel="stylesheet" href="base.css">
<link rel="stylesheet" href="themes/cyberpunk.css">
```

A theme that only swaps colors is a palette, not a theme. The contract
spans six dimensions plus charts, and a real theme takes a position on
all of them:

| Dimension | Tokens |
|---|---|
| color | `--ss-bg` `--ss-panel` `--ss-border` `--ss-text` `--ss-muted` `--ss-accent` `--ss-accent-bg` `--ss-danger` `--ss-warn` `--ss-formula-bg` `--ss-th-bg` + `--ss-badge-{blue,amber,purple,green,red,gray}` |
| typography | `--ss-font-body` `--ss-font-display` `--ss-font-mono` `--ss-font-size` `--ss-heading-case` `--ss-heading-weight` `--ss-heading-tracking` |
| shape | `--ss-radius` `--ss-radius-sm` `--ss-border-w` |
| depth | `--ss-shadow` `--ss-shadow-pop` |
| density | `--ss-pad` `--ss-gap` |
| motion | `--ss-motion` (0s is a valid position; brutalist takes it) |
| charts | `--ss-chart-1` through `--ss-chart-6`: categorical slots in fixed order, never cycled |

`ChartBlock` reads chart slots, ink, grid, and surface tokens at render
time. After swapping a theme stylesheet at runtime, call `.refresh()` on
chart blocks so they repaint (see `theme-preview.html`).

## Shipped themes (`assets/themes/`)

- **brutalist**: black on white, zero radius, 2px borders, hard offset
  shadows, uppercase display, no motion, highlighter-yellow active state.
- **retro**: 70s print and hardware. Cream paper, mustard gold as the
  *primary* accent (avocado/rust/teal/plum supporting), bold geometric
  sans display against serif body, chunky beveled buttons (not pills),
  halftone dot texture, double-rule table headers.
- **lofi**: typewriter mono, lowercase headings, dashed hairlines,
  muted chrome.
- **cozy**: warm cafe. Latte creams, terracotta, 18px radii, soft
  shadows, generous padding, serif display.
- **cyberpunk**: near-black violet, neon pink accent, terminal type,
  glow instead of shadow, scanline texture on panels.

Plus `base.css` itself carries the neutral default (light) and a built-in
dark (`<html data-theme="dark">`). Don't stack `data-theme="dark"` with a
theme file; themes are self-contained.

The default theme's neutrals and shape scale are grounded against
shadcn/ui's documented default tokens. Not shadcn as a dependency (this
kit stays vanilla JS/DOM/CSS with no build step); only the *values* were
borrowed as a reference point: true 0-chroma grayscale for bg/panel/
border/text/muted rather than hex picked by eye (which had a faint,
unintentional blue-gray cast), a hairline card shadow instead of none,
and confirmation that `--ss-radius`/`--ss-radius-sm` (10px/6px) already
matched shadcn's `--radius`/`--radius-sm` scale. Re-validate the default
chart palette (`node validate_palette.js ... --surface <panel>`) if the
neutrals move again; a lighter or darker panel changes contrast headroom.

The built-in dark mode deliberately departs from shadcn's raw values one
step further: shadcn's own dark tokens are true near-black
(`oklch(0.145 0 0)`, about `#0a0a0a`) paired with near-white text
(`oklch(0.985 0 0)`, about `#fafafa`), which is faithful to the source but
reads as harsher and higher-glare than necessary once actually rendered at
scale, particularly on OLED. The shipped values are softened toward
Material Design's dark-surface convention instead: `--ss-bg: #121212`,
`--ss-panel: #1e1e1e`, `--ss-text: #e8e8e8`, without touching
`--ss-shadow`/`--ss-shadow-pop`. Re-validate the dark chart palette
against the new panel if these move again, same as above.

**A lesson from brutalist, worth knowing before designing another
monochrome/high-contrast theme.** It sets `--ss-accent`, `--ss-border`,
and `--ss-text` all to the same pure black, which is exactly the point of
the theme. But two interaction states in `base.css` derive their color
from those tokens and quietly stopped working as a result: the focus
ring (`border-color`/`box-shadow` from `--ss-accent`) became
indistinguishable from the input's own already-black border, and the
switch's checked-track color (`--ss-text`) became identical to its
unchecked-track color (`--ss-border`). Both real, both only visible
*while interacting* (focus, toggle), never in a static screenshot, which
is why they went unnoticed initially. Fixed with a scoped override using
the theme's own highlighter yellow (`--ss-accent-bg`) for both cases;
see `themes/brutalist.css`. Any theme that collapses multiple contract
tokens to the same value should specifically check focus rings and the
switch/checkbox checked state by actually interacting with them, not
just eyeballing a static render.

Two more from the same round, worth checking on any theme:

- **A hard-offset shadow the same color as its own fill is invisible as a
  shadow.** brutalist's black-filled elements (`ss-btn-primary`, a checked
  checkbox) used the theme's plain black `--ss-shadow` like everything
  else, and a black shadow behind a black fill has no edge between "the
  element" and "its own shadow"; they read as one undifferentiated blob.
  Fixed by giving black-filled elements specifically a shadow in a
  concrete gray (`#9c9c9c`) instead. Yellow was tried first but read as
  claiming the "active/selected" meaning the highlighter yellow carries
  everywhere else in this theme (badge-accent, header sort arrows, focus
  rings), which a plain primary button or checked checkbox shouldn't
  imply; gray also just fits brutalism's raw-poured-concrete reference
  better. General rule for any hard-shadow theme: check the shadow color
  against every fill color a themed element can have, not just the
  default panel fill.
- **A hard-edged (unblurred) shadow behind a round element reads as a
  geometry mismatch regardless of color.** The switch thumb is always a
  circle (`base.css`); brutalist's `--ss-shadow` is a sharp, unblurred,
  square-cornered offset. A square shadow poking out from behind a
  circular knob looks off even when the color is fine. Small round
  controls generally shouldn't get the same raised-card shadow treatment
  as rectangular surfaces like buttons and panels. Fixed by removing the
  thumb's shadow entirely (`.ss-switch-thumb { box-shadow: none; }`); the
  track's own border and fill already carry enough definition.

**A fourth bug, this one in `base.css` itself, not a theme.** It affected
every theme, not just brutalist, and is worth understanding since it's a
CSS cascade trap that's easy to reintroduce: `.ss-btn-primary:hover` and
`.ss-btn-destructive:hover` originally set only `opacity`, while the
generic `.ss-btn:hover` set `background` unconditionally. Since both
rules matched a primary button (it carries `.ss-btn` too) and declared
*different* properties, both applied. CSS cascade only picks a
single winner when multiple matching rules declare the *same* property;
declarations for different properties from different matching rules all
apply regardless of specificity or order. The generic rule's background
(meant only for the plain outline button) pulled a primary button's fill
toward the panel color on hover, while its text, chosen to contrast the
*original* fill, stayed put, producing white-on-white. Fixed by scoping
the generic hover rule with `:not(.ss-btn-primary):not(.ss-btn-secondary):not(.ss-btn-ghost):not(.ss-btn-destructive)`
rather than trying to have each variant "reset" background back to its
own value (which would need to hardcode each variant's fill color and
break for a theme like retro that overrides primary's color entirely).
The general lesson: when a shared base rule and a variant-specific rule
both attach to the same element but touch different CSS properties, they
don't compete. They both land, and the base rule can silently corrupt a
variant's carefully-chosen color pairing. Scope the base rule to exclude
the variants; don't rely on the variant to "win."

**A lesson from cyberpunk: near-black surfaces need much bigger lightness
jumps than intuition suggests, and "looks dark and moody" is not the same
check as "is actually readable."** The first version of this theme was
flagged as barely readable, and computing actual WCAG contrast (standard
relative-luminance formula) on its tokens confirmed it wasn't just a
subjective complaint:

- `--ss-border` was 1.40:1 against `--ss-panel` (WCAG 1.4.11 wants 3:1 for
  non-text UI boundaries). Borders were essentially invisible.
- `--ss-th-bg` was 1.03:1 against `--ss-panel`. A table header didn't
  read as a different surface at all.
- `--ss-bg` and `--ss-panel` were only ~1.05:1 apart, so cards barely
  lifted off the page and the whole UI read as one undifferentiated dark
  mass.
- `--ss-danger` and `--ss-accent` were the *same hex*. Destructive and
  "this is branded/highlighted" collapsed into one signal, which is a
  legibility failure in the sense that matters most: you can't tell two
  different meanings apart.

The fix wasn't nudging hex values by eye a second time; that's what
produced the original numbers. Two colors that look obviously different
as swatches can still measure ~1.05:1 apart in real contrast once you're
this close to black, because the sRGB gamma curve compresses luminance
hard in the shadows: going from HSL lightness 6% to 16% (a jump that
looks significant on a lightness slider) barely moves the contrast ratio
at all. Getting `--ss-bg`, `--ss-th-bg`, and `--ss-panel` to actually
read as three distinct elevations took lightness steps of roughly 6%,
15%, and 26% at the same hue/saturation, each pair verified independently
with the contrast formula, not assumed from the HSL numbers looking
reasonable. If a theme's surfaces are all within ~15% lightness of each
other and any of them dip below ~15%, don't trust the swatches. Compute
the pairwise ratios.

Background research pulled in for this pass, worth reading before
designing another neon/dark theme: prefer a soft near-black over true
black for the base surface (glare and eye strain, not just aesthetics);
keep body and secondary text on plain light neutrals rather than neon and
reserve neon for accents/CTAs specifically, since saturated neon color
often fails WCAG contrast when used as normal text; and don't glow
everything. The original theme applied a text-shadow to every badge
(including neutral ones with nothing to signal) and to every StatTile
number, which research on neon UI flags as exactly the kind of overuse
that causes visual fatigue and dilutes the signal glow is supposed to
carry. Fixed by scoping the badge glow to only the meaningful color
variants and dropping the StatTile glow entirely. Numbers meant for quick
scanning shouldn't have blurred edges regardless of theme.

- [20+ Cyberpunk Color Palette Combinations (+ Hex Codes)](https://www.media.io/color-palette/cyberpunk-color-palette.html)
- [Inclusive Dark Mode: Designing Accessible Dark Themes For All Users, Smashing Magazine](https://www.smashingmagazine.com/2025/04/inclusive-dark-mode-designing-accessible-dark-themes/)
- [The Designer's Guide to Dark Mode Accessibility](https://www.accessibilitychecker.org/blog/dark-mode-accessibility/)
- [Color contrast - Accessibility - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG/Perceivable/Color_contrast)

**A lesson from retro: two themes in the same warm/rounded neighborhood
can pass every contrast check individually and still not feel distinct
from each other**, because distinctiveness isn't a contrast problem at
all. It's an *identity-move overlap* problem, invisible to any WCAG
number. Retro was flagged as reading like a cozy/lofi variant, and
comparing the tokens confirmed it: `--ss-accent` (`#c2410c`, burnt orange)
sat in the same hue family as cozy's `--ss-accent` (`#b45309`), close
enough to read as the same idea in different lighting; buttons used the
identical `999px` pill radius as cozy; and both body *and* display fonts
were Georgia, the same face cozy uses for its display. None of that fails
a contrast check. It's three separate "closest available choice" picks
that all happened to land in cozy's territory, and nobody had compared
retro against its neighbors token-by-token until asked to.

Background research on what specifically reads as *retro* (not vintage,
not midcentury, not just "warm and rounded") rather than eyeballing a
mood board: thick/bold sans-serif display type with high contrast, not
elegant serif italics (serif italics read closer to a vintage almanac,
which is part of why the original overlapped with cozy); a palette
anchored in avocado green and mustard yellow as the *primary* identity
colors, with burnt orange demoted to a supporting tone rather than the
headline color; halftone/Ben-Day dots as the era's actual print
reproduction texture, not a generic decorative pattern; and beveled/raised
borders (light top-left, dark bottom-right, flipping on `:active` to read
as pressed) as a distinct tactile-hardware device that neither cozy's
flat pills nor lofi's flat dashed rectangles use. Applied as: mustard
became the primary accent; avocado/rust/teal/plum became the supporting
palette (re-validated with the chart tool: the first few attempts at an
even color-wheel spread of "plausibly 70s" hues kept failing the CVD
check, since yellow-green family hues are notoriously hard to separate
under deuteranopia, and the fix was adapting cozy's *already-validated*
hue skeleton rather than re-deriving six colors from scratch); buttons
became chunky beveled rounded-rects instead of pills; and the display
face became a bold geometric sans while body stayed serif, the *inverse*
of cozy's sans-body/serif-display pairing, so even sharing "Georgia
somewhere" no longer reads as similar, because the role swapped.

While re-deriving the palette, also caught (same rigor as the cyberpunk
pass): `--ss-muted` measured 4.04:1 as text and `--ss-border` measured
1.74:1 as a border in the *original* retro. Both quietly under typical
AA-ish targets despite never being flagged, simply because nobody had
computed them. Worth remembering: run the numeric check on every
existing theme occasionally, not only the one currently being fixed.
These bugs don't announce themselves.

- [Retro Color Palettes for a Nostalgic Design](https://www.designyourway.net/blog/retro-color-palettes/)
- [Retro Website Design: A Guide for Authentic 70s-90s Aesthetics](https://eknojistudio.com/retro-website-design/)
- [Turn Modern Design into Retro with These 8 Vintage Styles](https://www.manypixels.co/blog/inspiration/retro-design)
- [Retro Graphic Design: 20th Century Style Guide](https://yougotprints.com/blogs/news/retro-graphic-design-20th-century-style-guide)

## Writing a new theme: procedure

1. Copy the shipped theme closest in spirit; rename.
2. Take a position on every dimension in the contract, not just color.
   The fastest tell of a lazy theme is default radius/shadow/type with new
   colors.
3. **Chart palette is computed, not eyeballed.** The six `--ss-chart-*`
   values are a categorical palette and must pass the dataviz skill's
   validator against your theme's panel color (charts sit on panels):

   ```bash
   node <dataviz-skill>/scripts/validate_palette.js "#hex1,...,#hex6" --mode light --surface "<--ss-panel value>"
   ```

   (`--mode dark` for dark surfaces.) Fix FAILs by adjusting lightness/
   saturation and by reordering so confusable hue families are never
   adjacent (orange/green and pink/green are the classic deutan
   collisions). WARNs in the CVD 6-8 band are acceptable only because
   ChartBlock draws a 2px surface gap between multi-color fills.

   Lessons already paid for, encoded in the shipped themes:
   - *Muted palettes fail.* "Lofi" grays read as gray to the validator
     too (chroma floor). Keep the UI chrome muted, but data marks need
     chroma. The vibe lives in the chrome, not the data ink.
   - *Neon palettes fail the other way.* Full #0ff neons blow past the
     dark lightness band; dim them into the readable band and let glows
     (`--ss-shadow`) supply the vibe.
4. Badge tokens are single colors per name; the tinted background is
   derived via `color-mix`. Pick them legible against `--ss-panel`.
5. **Surface and text contrast are computed too, not just charts.**
   Especially for a dark theme, and especially near black (see the
   cyberpunk lesson above: swatches that look clearly different can
   measure ~1.05:1 apart once you're this close to black, because sRGB
   gamma compresses shadow luminance hard). At minimum, check with the
   standard WCAG relative-luminance formula:
   - `--ss-bg` vs `--ss-panel` vs `--ss-th-bg`: each pair should be
     clearly distinguishable, not just "different hex." For dark themes
     that means bigger lightness jumps than intuition suggests. Nudging
     5-10% on an HSL slider does almost nothing near black; expect to
     need steps more like 6%, 15%, 26%.
   - `--ss-border` vs `--ss-panel`: at least 3:1 (WCAG 1.4.11, non-text
     UI boundaries) or it reads as no border at all.
   - `--ss-text`/`--ss-muted` vs `--ss-panel`, and `--ss-accent`/
     `--ss-danger`/`--ss-warn`/each `--ss-badge-*` vs `--ss-panel`: at
     least 4.5:1 (WCAG AA, normal text) for anything that renders as text
     or a small icon (StatusDot's icons count).
   - `--ss-danger` and `--ss-accent` should not be the same value.
     Destructive and "branded/highlighted" are different meanings and
     need different colors, independent of contrast math.
6. **Check against sibling themes, not just against default.** A
   contrast-clean theme can still fail by *converging* with a neighbor
   (see the retro lesson above). None of the individual choices below
   fail a contrast check, so this is the one step that has to be a manual
   side-by-side, not a script: compare your theme's `--ss-accent` hue,
   button shape/radius, and font-family choices against every other
   shipped theme's. Two "closest available" picks landing in the same
   territory is enough to make two themes read as variants of each other.
7. Open `assets/theme-preview.html` (serve it, don't file://) and switch
   to your theme: every block should visibly belong to it. If a block
   still looks like the default theme, you missed a dimension it uses.
8. Scoped overrides last, and only for what tokens can't say. Keep them
   few; every override is a maintenance point when components evolve.

## Applying themes when composing

- If the user names a vibe ("make it feel cozy", "cyberpunk it"), link
  the matching theme; if none fits, write one with the procedure above.
- If no vibe is given, the neutral default is the right call. Don't
  impose a strong aesthetic uninvited. Mention that themes exist.
- Per-app tweaks on top of a theme (e.g. this app's accent should be
  green) are one-line token overrides in the composed page's own
  `<style>`, after the theme link, not edits to the theme file.
