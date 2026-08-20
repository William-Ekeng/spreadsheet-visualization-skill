# Spreadsheet Visualization Skill

A [Claude Code](https://claude.com/claude-code) skill that turns a spreadsheet (`.xlsx` / `.xlsm` / `.xls` / `.csv`) into a **live, editable HTML app** — with the spreadsheet file itself acting as the backend database.

A local Python server reads the file, serves it as JSON, watches it for external edits (e.g. someone editing it in Excel), and writes browser edits straight back to the file. Both sides read and write the same file, so the spreadsheet is always the single source of truth — no separate database.

## What it does

Tell Claude something like:

- *"Turn my budget sheet into a webpage"*
- *"I want a nicer way to look at and edit this csv"*
- *"Build a UI on top of this spreadsheet"*
- *"Make me a tool to manage this inventory file"*

Claude inspects the data, asks what you want to *do* with it, and composes a purpose-built UI from the skill's building blocks — rather than forcing every sheet into one fixed dashboard template:

- **Manage/edit records** (inventory, CRM, tasks) → search + editable grid + record form
- **Monitor numbers** (budget, sales, KPIs) → stat tiles + chart + compact grid
- **Look things up** (reference lists, logs) → search + trimmed read-only grid
- **Append entries** (time log, expenses) → fast-entry form + recent-rows grid

Edits in the browser save straight back to the spreadsheet; edits made in Excel show up in the browser.

## Installation

### As a Claude Code plugin (recommended)

```bash
/plugin marketplace add williamekeng/spreadsheet-visualization-skill
```

then

```bash
/plugin install spreadsheet-visualization@williamekeng
```

### Manual

Copy `skills/spreadsheet-visualization/` into your project's `.claude/skills/` directory (or `~/.claude/skills/` for all projects).

## Requirements

- Python 3.9+ with `openpyxl` (for Excel formats; CSV works with the standard library)
- The spreadsheet file and the browser must be on the same machine (or LAN) — the server needs direct filesystem access to the file

## Repository layout

```
.claude-plugin/          Plugin + marketplace manifests
skills/
  spreadsheet-visualization/
    SKILL.md             The skill definition Claude reads
    scripts/
      sync_server.py     Local server: file <-> JSON <-> browser, two-way sync
    assets/
      sheetsync.js       Browser data-sync layer
      components.js      Component kit (grid, search, tiles, chart, forms…)
      base.css           Shared styling
      themes/            Optional visual themes (lofi, cozy, retro, …)
    references/          Deep-dive docs Claude loads on demand
```

## License

MIT
