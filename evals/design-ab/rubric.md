# A/B scoring rubric

Written before inspecting either output. Mostly countable, so the
comparison is measurement rather than after-the-fact judgment.

Variable under test: the design references only. Both arms share
identical assets (base.css, components.js, sheetsync.js, themes) and
an identical prompt. Arm A (before) has components.md +
formulas-and-limitations.md + theming.md. Arm B (after) adds
design-fundamentals.md + composition.md and the step 3/4 gates.

## Countable checks (grep/inspect app.html)

| # | Check | Target | Source rule |
|---|---|---|---|
| 1 | Full-width control rows between header and data | 0 or 1 | fundamentals: control bar |
| 2 | Controls sharing one `.ss-row` | yes | fundamentals: control bar |
| 3 | Uncapped control widths in the bar | 0 | fundamentals: size to content |
| 4 | Nested `.ss-panel` depth | max 1 | composition: group once |
| 5 | Raw hex colors in app.html | 0 | composition rule 1 |
| 6 | Non-token font-family declarations | 0 | fundamentals: type |
| 7 | Distinct font-size values declared | <= 5, none < 12px | fundamentals: type |
| 8 | Charts with a visible title heading | all | composition: charts |
| 9 | Hardcoded Chart.js colors | 0 | composition: charts |
| 10 | StatTile count (if used) | 2-5 | composition: tiles |
| 11 | `editable:` set deliberately (not defaulted) | explicit | composition: editable |
| 12 | StatusDot present | yes | composition: states |
| 13 | Empty / zero-match state handled | yes | composition: states |
| 14 | Page width constrained (max-width + centered) | yes | composition: shell |
| 15 | Sticky elements beyond kit's own | 0 or 1 | fundamentals: scroll |
| 16 | Scroll-triggered entrance animations | 0 | fundamentals: scroll |
| 17 | Clickable `<div>` / unlabeled inputs | 0 | composition rule 7 |

## Judgment calls (recorded, not scored)

- Does the data lead the first screen, or does chrome?
- Is the arrangement specific to this sheet, or generic for any sheet?
- Did the agent choose a purpose archetype, or default to tabs+grid?

## Recording

Score each arm independently against the table before comparing.
Note any rule an arm satisfies by luck rather than by instruction, and
any rule that made the output worse (over-constraint is a real risk
worth catching).
