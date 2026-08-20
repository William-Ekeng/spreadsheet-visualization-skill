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
chart palette (the dataviz skill's `validate_palette.js`, see below) if the
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

## Traps the shipped themes already hit

Each of these was a real bug in a shipped theme. They share a shape: the
static render looked fine, so nothing flagged them until someone either
interacted with the page or computed a number.

**A token collapsed to the same value as another token kills the
interaction states derived from it.** brutalist sets `--ss-accent`,
`--ss-border`, and `--ss-text` all to pure black, which is the point of
the theme. Two `base.css` states derive their color from those tokens and
went invisible as a result: the focus ring (`border-color`/`box-shadow`
from `--ss-accent`) matched the input's own black border, and the switch's
checked track (`--ss-text`) matched its unchecked track (`--ss-border`).
Both are only visible while interacting, never in a screenshot. The fix is
a scoped override using the theme's highlighter yellow (`--ss-accent-bg`)
for both; see `themes/brutalist.css`. Any theme that gives two contract
tokens the same value must be checked by actually focusing an input and
flipping a switch.

**A hard-offset shadow the same color as its own fill is invisible.**
brutalist's black-filled elements (`ss-btn-primary`, a checked checkbox)
took the theme's plain black `--ss-shadow` like everything else, leaving no
edge between the element and its shadow, so the two read as one blob. They
now take a concrete gray (`#9c9c9c`). Yellow was tried first and read as
claiming the active/selected meaning highlighter yellow carries elsewhere
in the theme. Check a hard shadow's color against every fill a themed
element can take, not just the default panel fill.

**A hard-edged shadow behind a round element reads as a geometry mismatch
whatever its color.** The switch thumb is always a circle (`base.css`) and
brutalist's `--ss-shadow` is a sharp square-cornered offset, so the shadow
poked out from behind the knob. The thumb's shadow is now removed
(`.ss-switch-thumb { box-shadow: none; }`); the track's border and fill
carry the definition. Small round controls generally shouldn't take the
raised-card shadow that rectangular surfaces use.

**A shared base rule and a variant rule that touch different properties
don't compete, they both land.** This one was in `base.css`, so it hit
every theme. `.ss-btn-primary:hover` set only `opacity` while the generic
`.ss-btn:hover` set `background` unconditionally, and a primary button
matches both rules because it carries `.ss-btn` too. The CSS cascade picks
a single winner only among declarations of the *same* property. So the
generic background, meant for the plain outline button, pulled primary's
fill toward the panel color while its text, chosen to contrast the
original fill, stayed put: white on white. The generic hover rule is now
scoped with
`:not(.ss-btn-primary):not(.ss-btn-secondary):not(.ss-btn-ghost):not(.ss-btn-destructive)`.
Having each variant reset `background` to its own value was the other
option, and it fails: it hardcodes every variant's fill, which breaks for a
theme like retro that overrides primary's color entirely. Scope the base
rule to exclude the variants rather than relying on the variant to win.

**Near-black surfaces need much larger lightness jumps than intuition
suggests.** cyberpunk's first version measured, by the standard WCAG
relative-luminance formula:

- `--ss-border` 1.40:1 against `--ss-panel`, where WCAG 1.4.11 wants 3:1
  for non-text UI boundaries. Borders were invisible.
- `--ss-th-bg` 1.03:1 against `--ss-panel`. A table header didn't read as
  a different surface at all.
- `--ss-bg` and `--ss-panel` ~1.05:1 apart. Cards barely lifted off the
  page and the UI read as one dark mass.
- `--ss-danger` and `--ss-accent` on the *same hex*. Destructive and
  branded/highlighted collapsed into one signal.

The sRGB gamma curve compresses luminance hard in the shadows, so two
colors that look clearly different as swatches can measure ~1.05:1 apart
this close to black. Moving HSL lightness from 6% to 16% looks significant
on a slider and barely moves the ratio. Getting `--ss-bg`, `--ss-th-bg`,
and `--ss-panel` to read as three elevations took steps of roughly 6%, 15%,
and 26% at the same hue and saturation, each pair verified with the
formula. If a theme's surfaces sit within ~15% lightness of each other and
any of them dips below ~15%, compute the pairwise ratios instead of
trusting the swatches.

For a neon or dark theme specifically: prefer a soft near-black over true
black for the base surface, keep body and secondary text on plain light
neutrals since saturated neon often fails contrast as normal text, and
reserve neon for accents and CTAs. Don't glow everything. cyberpunk
originally applied a text-shadow to every badge, neutral ones included, and
to every StatTile number; the glow now covers only the meaningful badge
variants, and StatTile has none. Numbers meant for quick scanning shouldn't
have blurred edges in any theme.

- [20+ Cyberpunk Color Palette Combinations (+ Hex Codes)](https://www.media.io/color-palette/cyberpunk-color-palette.html)
- [Inclusive Dark Mode: Designing Accessible Dark Themes For All Users, Smashing Magazine](https://www.smashingmagazine.com/2025/04/inclusive-dark-mode-designing-accessible-dark-themes/)
- [The Designer's Guide to Dark Mode Accessibility](https://www.accessibilitychecker.org/blog/dark-mode-accessibility/)
- [Color contrast - Accessibility - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG/Perceivable/Color_contrast)

**Two themes can pass every contrast check individually and still not feel
distinct.** Distinctiveness is an identity-move overlap, and no WCAG number
sees it. retro read as a cozy variant because three separate
closest-available picks all landed in cozy's territory: `--ss-accent`
(`#c2410c`, burnt orange) in the same hue family as cozy's `#b45309`, the
identical `999px` pill radius on buttons, and Georgia for both body *and*
display, which is cozy's display face.

What reads as specifically *retro*, as opposed to vintage or midcentury or
just warm and rounded: thick bold sans-serif display type with high
contrast rather than elegant serif italics, which read closer to a vintage
almanac; avocado green and mustard yellow as the *primary* identity colors
with burnt orange demoted to support; halftone / Ben-Day dots as the era's
actual print-reproduction texture; and beveled raised borders (light
top-left, dark bottom-right, flipping on `:active`) as a tactile-hardware
device neither cozy's flat pills nor lofi's dashed rectangles use. The
display face is now a bold geometric sans against a serif body, the inverse
of cozy's pairing, so sharing "Georgia somewhere" no longer reads as
similar: the role swapped.

Re-deriving retro's chart palette took several tries. An even color-wheel
spread of plausibly-70s hues kept failing the CVD check, because
yellow-green family hues are hard to separate under deuteranopia. Adapting
cozy's already-validated hue skeleton worked where deriving six colors from
scratch didn't. The same pass also caught `--ss-muted` at 4.04:1 as text
and `--ss-border` at 1.74:1 as a border in retro, both under AA-ish targets
and both unflagged, because nobody had computed them. Run the numeric check
over the existing themes periodically, not only the one being edited.

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

   Two failure modes the shipped themes already ran into:
   - *Muted palettes fail.* "Lofi" grays read as gray to the validator
     too (chroma floor). Keep the UI chrome muted, but data marks need
     chroma. The vibe lives in the chrome, not the data ink.
   - *Neon palettes fail the other way.* Full #0ff neons blow past the
     dark lightness band; dim them into the readable band and let glows
     (`--ss-shadow`) supply the vibe.
4. Badge tokens are single colors per name; the tinted background is
   derived via `color-mix`. Pick them legible against `--ss-panel`.
5. **Surface and text contrast are computed too, not just charts.**
   Especially for a dark theme, and especially near black, where
   swatches that look clearly different can measure ~1.05:1 apart
   because sRGB gamma compresses shadow luminance hard (see the traps
   section above). At minimum, check with the standard WCAG
   relative-luminance formula:
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
   (see the traps section above). Convergence passes every contrast
   check, so this is the one step that has to be a manual side-by-side
   rather than a script: compare your theme's `--ss-accent` hue, button
   shape/radius, and font-family choices against every other shipped
   theme's. Two "closest available" picks landing in the same
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
