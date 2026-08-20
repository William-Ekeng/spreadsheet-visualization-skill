# Spreadsheet Visualization Skill

A [Claude Code](https://claude.com/claude-code) skill that turns a spreadsheet (`.xlsx` / `.xlsm` / `.xls` / `.csv`) into a live, editable HTML app. The spreadsheet file itself is the backend database.

A local Python server reads the file, serves it as JSON, watches it for external edits (someone editing it in Excel, say), and writes browser edits straight back to the file. Both sides read and write the same file, so the spreadsheet stays the single source of truth. There is no separate database.

## What it does

Tell Claude something like:

- "Turn my budget sheet into a webpage"
- "I want a nicer way to look at and edit this csv"
- "Build a UI on top of this spreadsheet"
- "Make me a tool to manage this inventory file"

Claude inspects the data, asks what you want to do with it, and composes a UI from the skill's building blocks instead of forcing every sheet into one fixed dashboard template. An inventory sheet gets search plus an editable grid and a record form. A budget gets stat tiles, a chart, and a compact grid. A reference list gets search over a trimmed read-only grid. A time log gets a fast-entry form with recent rows below.

Edits in the browser save straight back to the spreadsheet. Edits made in Excel show up in the browser.

## Installation

### As a Claude Code plugin (recommended)

```bash
/plugin marketplace add William-Ekeng/spreadsheet-visualization-skill
```

then

```bash
/plugin install spreadsheet-visualization@williamekeng
```

### Manual

Copy `skills/spreadsheet-visualization/` into your project's `.claude/skills/` directory, or `~/.claude/skills/` for all projects.

## Requirements

- [uv](https://docs.astral.sh/uv/) (recommended), or Python 3.9+ with pip. The server declares its dependencies (`flask`, `openpyxl`, `watchdog`, `filelock`) as PEP 723 inline metadata, so `uv run sync_server.py ...` installs everything on the fly and even downloads a Python interpreter if the machine has none.
- The spreadsheet file and the browser must be on the same machine (or LAN). The server needs direct filesystem access to the file.

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
      components.js      Component kit (grid, search, tiles, chart, forms)
      base.css           Shared styling
      themes/            Optional visual themes (lofi, cozy, retro, ...)
    references/          Deep-dive docs Claude loads on demand
```

## License

MIT
