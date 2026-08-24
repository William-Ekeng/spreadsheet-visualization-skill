# Design-guidance A/B eval

Measures what the design references actually change. Two agents build an
app from the same spreadsheet with the same prompt and the same kit. The
only difference is whether the skill copy includes
`references/composition.md` and `references/design-fundamentals.md` (and
the `SKILL.md` hooks that route to them).

- **arm A** (control): `components.md`, `theming.md`,
  `formulas-and-limitations.md` only.
- **arm B** (treatment): the same plus the two design references.

Keeping the kit identical matters. When the server or `base.css` changes,
both arms must get the change, or the comparison measures the kit instead
of the guidance.

## Running a round

1. Copy `skills/spreadsheet-visualization/` twice, into `skill-before`
   and `skill-after`.
2. In `skill-before`, delete `references/composition.md` and
   `references/design-fundamentals.md`, then remove the four places
   `SKILL.md` routes to them: the prose pointer after the composition
   sketches, the reading gate in workflow step 3, the checklist gate in
   workflow step 4, and the two "Read next" entries. Grep for
   `composition.md` and `design-fundamentals.md` afterwards; nothing
   should match.
3. Give each arm its own copy of the spreadsheet, so their writes don't
   collide.
4. Launch two agents with identical prompts, differing only in skill
   path, output directory, and port. Tell neither that it is being
   compared, and bar both from other design skills.
5. Score with `./score.sh out-before/app.html out-after/app.html`, then
   **open both pages in a browser**.

## The input

Rounds 2-4 used `Suivi_des_commandes_comptoir_d'etivey.xlsx`, a real
French order-tracking workbook: 3 sheets, an 18-row ledger with 16
columns, a price reference, and a config sheet. It is not committed here
(it is the owner's business data). Any modest, well-formed workbook with
a numeric column and something to group it by will exercise the same
checks.

Round 1 used a 14-sheet workbook with ~2,000 styled-but-empty rows per
sheet. Both arms spent nearly their whole budget fixing the server
instead of composing, so that round is not comparable and is not
archived. It was still the most valuable run: it surfaced the phantom
16,384-column dimension, the 30s reads, and the sheet-ordering bug.

## Scoring

`score.sh` covers the countable checks. It cannot see the things that
have mattered most, which is the main lesson of this eval: **every
regression found so far was found by looking at the rendered pages, not
by the script.** The script tells you whether the page is disciplined.
Only the browser tells you whether it is usable.

Look for, at minimum:

- click a row: does the detail panel appear without scrolling?
- is every visible string in the data's language, kit defaults included?
- can a person do the file's real job, or only look at numbers?
- does the data lead the first screen, or does chrome?

## What the rounds found

| Round | Finding |
|---|---|
| 2 | Treatment arm shipped no chart at all. Restraint guidance was suppressing analysis. |
| 3 | Treatment arm rendered the detail form below the grid, so a row click put the response below the fold. Caused by `composition.md` superseding `SKILL.md`'s "side panel" guidance without carrying it over. |
| 3 | Treatment arm wrote zero orientation prose; the control wrote 200 characters of it. The header rule banned "taglines" and the restraint rules did the rest. |
| 3 | Treatment arm shipped English buttons in a French page, copied from a doc example. The kit also hardcoded English with no override. |
| 3 | Control built custom affordances (first-free-row add, hide-empty-rows filter, config-sheet dropdowns) in both runs; treatment built none in either. `composition.md` never said the blocks are not a ceiling. |

Every one of those is now fixed in the references or the kit. The
recurring cause is worth stating plainly: `composition.md` took over
decisions from `SKILL.md` and `components.md` and silently dropped parts
of what they said. When editing it, diff against those two first.

The control arm is noisy between identical runs (inline styles went 4 to
9 across rounds 2 and 3), so treat any single round as a signal, not a
result.
