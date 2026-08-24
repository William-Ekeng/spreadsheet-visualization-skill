# Sync architecture review

Written 2026-08-24 after a session that fixed roughly a dozen individual
defects in `sync_server.py` and `sheetsync.js`. The fixes were real, but
they were patches on a design that doesn't hold up on a large file. This
is the case for reworking it in one deliberate pass rather than continuing
to patch.

## Measurements

Sample - Superstore.xls, converted to .xlsx: 3 sheets, 9,994 rows x 21
columns on the main sheet, 1.5 MB file, 5.9 MB of JSON.

| Operation | Cost |
|---|---|
| Cold read (`_get_sheets`) | 4.77s |
| Warm read (cache hit) | ~0ms |
| `write_cell` into the cached workbook | 198ms (first), ~2ms after |
| `append_row` into the cached workbook | 52ms |
| `delete_row` into the cached workbook | 424ms |
| `wb.save()` (the deferred flush) | 2.94s |
| **Re-read + re-serialize after any one edit** | **4.45s** |

The last row is the finding. Editing one cell costs the browser a full
workbook re-read and a 5.9 MB payload, because a change of any size
invalidates everything.

## What's actually wrong

**1. Two sources of truth, reconciled the expensive way.** The server
keeps a writable workbook in memory (`STATE["wb"]`, authoritative for
pending edits) *and* a read snapshot parsed from disk
(`STATE["cache"]`). After the server's own write, it flushes the first
to disk and re-parses the file into the second, at a cost of 4.35s, to
learn something it already knew. It just made the change. It could apply
that change to the read model directly and skip the disk round trip
entirely. This is the single biggest win available and it is not a
micro-optimisation.

**2. Sync is all-or-nothing.** `/api/data` returns every sheet and every
row. There is no "what changed since version N", no per-sheet fetch, no
row window. The polling design is sound (a cheap `/api/version` check,
refetch on change) but the refetch has one gear: everything. A one-cell
edit and a thousand-row import cost the same.

**3. The API has no notion of a page.** `DataGrid` shows 100 rows and the
server sends 9,994. Pagination, filtering and sorting all happen in the
browser over the full dataset, so the payload is set by the file's size
rather than by what is on screen.

**4. Reads hold the write lock.** `_get_sheets` takes the `FileLock` for
the whole 4.35s parse, so any write arriving during a refetch waits
behind it. With a browser tab polling, this is how a normally fast edit
occasionally takes seconds.

**5. Persistence is O(workbook), not O(change).** `wb.save()` rewrites
the entire file (2.94s here) whatever changed. Deferring the save so a
burst of edits costs one write helps a lot and is already in place; it
does not change the per-save cost. openpyxl has no incremental write, so
this is a floor unless the persistence layer changes.

**6. `delete_rows` is O(n).** 424ms on this sheet, because openpyxl
shifts every row below the deletion. Combined with the full re-read that
follows, deleting a row is the slowest interactive operation in the app,
which matches what testing showed.

**7. Self-write detection has been wrong twice.** The watcher has no
reliable way to distinguish the server's own save from an external edit,
and both previous attempts (a timestamp, then an mtime comparison) failed
because the event fires *during* a multi-second save. The current
bracket-the-write approach works, but the underlying problem is that
change detection is inferred from the filesystem rather than owned by the
component doing the writing.

## Direction worth considering

Not a plan, a starting point for the next session:

- **One in-memory model owns the truth while the server runs.** The file
  becomes a persistence target and an external-change source, not the
  thing every read re-derives from. The server's own edits update the
  model directly; nothing re-parses to discover them.
- **A change feed.** `/api/changes?since=N` returning only what moved.
  The full payload stays available for the initial load and for
  reconciliation after an external edit.
- **Windowed reads for large sheets.** Sheet, offset, limit, and let the
  server do the filtering and sorting it is better placed to do.
- **Reads shouldn't take the write lock.** A snapshot or a read-write
  lock would remove the contention stall.
- **External edits reconcile by diff.** On a watcher event, re-read and
  compare against the model rather than discarding everything.
- **Revisit persistence for large files.** If openpyxl's whole-file save
  is the floor, the options are to keep deferring aggressively, or to
  treat the spreadsheet as an import/export format with a faster store
  behind the live app. That is a product decision, not just a technical
  one, and it is worth taking deliberately.

## What is already fixed (don't redo)

Landed this session and verified: the phantom 16,384-column dimension,
header-row detection falling back to a blank row, read and write paths
disagreeing about headers, `read_only` parsing (30s to 2s), the cached
writable workbook, deferred saves, cached header lookups, numeric
coercion so numbers don't land as text, failed writes surfacing instead
of vanishing, `AddRow` decoupled from `DataGrid`, first-paint state, the
false "connected" indicator, and refusing browser-blocked ports.

The scaling problems above are what remains, and they are structural
rather than incidental.
