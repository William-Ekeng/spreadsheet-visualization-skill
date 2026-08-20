# Agent guide

This repository is an installable Claude Code plugin containing agent skills.
This file tells coding agents how to work on the repo itself.

## What this repo is

A skills repo, structured like a plugin marketplace:

- `skills/<skill-name>/` is one directory per skill. Each contains a `SKILL.md`
  (the definition the agent reads), plus optional `scripts/`, `assets/`, and
  `references/` directories.
- `.claude-plugin/plugin.json` is the plugin manifest. Every shipped skill must
  be listed in its `skills` array.
- `.claude-plugin/marketplace.json` lets users add this repo as a plugin
  marketplace with `/plugin marketplace add`.
- `README.md` is the human-facing docs. Every shipped skill gets a section here.

The repo currently ships one skill, spreadsheet-visualization. It turns a
spreadsheet file into a live, editable HTML app with two-way sync between the
browser and the file, via a local Python server.

## Rules for working on skills

### Adding a skill

1. Create `skills/<skill-name>/SKILL.md` with YAML frontmatter (`name`,
   `description`). The `description` is what triggers the skill. Write it as
   what it does, when to use it, and when NOT to use it, with concrete example
   phrasings a user might say.
2. Register it in `.claude-plugin/plugin.json`'s `skills` array.
3. Add a section to the top-level `README.md`.
4. Run `claude plugin validate . --strict` and fix anything it reports.

### Modifying a skill

- `SKILL.md` is instructions for an agent, not documentation for a human.
  Keep it imperative, front-load the workflow, and push deep detail into
  `references/*.md` files that the agent loads on demand.
- Keep `SKILL.md` under ~500 lines. Split anything bigger into references.
- Renaming a skill directory means updating `plugin.json`, `marketplace.json`
  keywords if relevant, and the README. All three, in the same commit.

### Removing or deprecating a skill

Remove it from `plugin.json` and the README in the same commit that deletes
or moves the directory. Never leave the manifest pointing at a path that
does not exist.

## Skill-specific notes: spreadsheet-visualization

- `scripts/sync_server.py` must stay dependency-light. Its dependencies
  (`flask`, `openpyxl`, `watchdog`, `filelock`) are declared three places
  that must stay in sync: the PEP 723 inline metadata at the top of the
  file, the docstring's dependency note, and SKILL.md's runtime step.
  Adding a dependency means updating all three in the same commit and
  having a strong reason; `xlrd` and `formulas` stay optional.
- `assets/sheetsync.js`, `assets/components.js`, and `assets/base.css` are
  building blocks that generated apps link to. Treat their public APIs
  (component names, function signatures, CSS custom properties) as stable;
  breaking them breaks every previously generated app.
- Themes in `assets/themes/` only override CSS custom properties defined in
  `base.css`. They must not introduce new selectors that components depend on.
- The `references/` docs (`components.md`, `theming.md`,
  `formulas-and-limitations.md`) must be updated in the same commit as any
  change to the assets or server they describe.

## Repo hygiene

- Never commit runtime artifacts: `*.log`, `__pycache__/`, packaged `*.skill`
  bundles. They are gitignored; keep it that way.
- Line endings are LF, enforced by `.gitattributes`.
- Do not use em-dashes anywhere in the repo. Use periods or commas instead.
- Version bumps happen in `.claude-plugin/plugin.json` (semver). Bump the
  patch version for fixes, minor for new capability, major for breaking
  changes to the assets' public API.
- Commit messages: imperative mood, subject line under 72 characters, body
  explains why rather than what.

## Validation checklist before pushing

1. `claude plugin validate . --strict` passes.
2. Every entry in `plugin.json`'s `skills` array points at an existing
   directory containing a `SKILL.md`.
3. README, manifest, and `skills/` contents agree with each other.
