# Sync architecture review

Written 2026-08-24 after a session that fixed roughly a dozen individual
defects in `sync_server.py` and `sheetsync.js`. The fixes were real, but
they were patches on a design that doesn't hold up on a large file. This
was the case for reworking it in one deliberate pass rather than
continuing to patch.

The rework landed the same day. What follows is the case as it was made,
then what changed, then what is still true.

## Measurements

Sample: a Superstore-shaped workbook, 3 sheets, 9,994 rows x 21 columns on
the main sheet, 1.2 MB file, 5.6 MB of JSON. Both columns measured over
HTTP the way the browser drives it, back to back on the same machine.

| Operation | Before | After |
|---|---|---|
| Cold `GET /api/data` (first load) | 9.12s | 8.46s |
| Warm `GET /api/data` | 0.285s | 0.073s |
| Cell edit, until the browser has the new data | 8.29s | 0.007s |
| Row append, same | 8.48s | 0.072s |
| Row delete, same | 9.19s | 0.623s |
| Bytes moved per edit | 5.6 MB | ~200 B |

The third row was the finding. Editing one cell cost the browser a full
workbook re-read and a 5.6 MB payload, because a change of any size
invalidated everything.

## What was wrong

**1. Two sources of truth, reconciled the expensive way.** The server kept
a writable workbook in memory (`STATE["wb"]`, authoritative for pending
edits) *and* a read snapshot parsed from disk (`STATE["cache"]`). After
its own write it flushed the first to disk and re-parsed the file into the
second, to learn something it already knew. It just made the change.

*Fixed.* `STATE["sheets"]` is the read model and owns the truth while the
server runs. A write applies to it directly. The file is a persistence
target and a source of external change, not the thing every read
re-derives from. This is where nearly all of the win above comes from.

**2. Sync was all-or-nothing.** `/api/data` returned every sheet and every
row. There was no "what changed since version N". The polling design was
sound (a cheap `/api/version` check, refetch on change) but the refetch
had one gear: everything.

*Fixed.* Every change is recorded as an op in a bounded log, and
`/api/changes?since=N` replays it. A page a poll behind fetches the cells
that moved. The full payload is still there for the first load and for the
cases the server will not describe as ops: a page further behind than the
log, a restarted server, or a change large enough that sending the sheet
is the smaller answer.

**3. The API has no notion of a page.** `DataGrid` shows 100 rows and the
server sends 9,994. Pagination, filtering and sorting all happen in the
browser over the full dataset, so the payload is set by the file's size
rather than by what is on screen.

*Still true.* See "What is still open".

**4. Reads held the write lock.** `_get_sheets` took the `FileLock` for
the whole parse, so a write arriving during a refetch waited behind it.
With a browser tab polling, that is how a normally fast edit occasionally
took seconds.

*Fixed.* Reads take `MODEL_LOCK` and nothing else, and it is a leaf: it is
never held across anything slow, and nothing waits on another lock while
holding it. Parsing and saving happen under `LOAD_LOCK` and `WB_LOCK`,
which block other writes and never block reads.

**5. Persistence is O(workbook), not O(change).** `wb.save()` rewrites the
entire file whatever changed. Deferring the save so a burst of edits costs
one write helps a lot and was already in place; it does not change the
per-save cost. openpyxl has no incremental write.

*Still true, and no longer on the interactive path.* The save used to bump
the version, sending every open tab back for a fresh payload. It doesn't
any more: readers have seen the change since it was applied to the model,
and landing it on disk shows them nothing new. The save is now invisible
to the browser unless it fails, which is still reported on the next poll.

**6. `delete_rows` is O(n).** openpyxl shifts every row below the
deletion. Combined with the full re-read that followed, deleting a row was
the slowest interactive operation in the app.

*Half fixed.* The re-read is gone, so a delete went from ~9s to ~0.6s. The
remaining 0.6s is openpyxl shifting rows, and it is a floor.

**7. Self-write detection has been wrong twice.** The watcher has no
reliable way to distinguish the server's own save from an external edit,
and both previous attempts (a timestamp, then an mtime comparison) failed
because the event fires *during* a multi-second save.

*Unchanged.* The bracket-the-write approach still works and still infers
from the filesystem what the writer knows for certain. See "What is still
open".

## What the rework did

- **One in-memory model owns the truth while the server runs.**
  `STATE["sheets"]`, with the file behind it.
- **Every change is an op.** `cell`, `row_upsert`, `row_delete`, `sheet`,
  `reset`. `_apply` in `sync_server.py` and `_applyChange` in
  `sheetsync.js` are the same automaton over two copies of the data, which
  is why they have to change together, in the same commit, forever.
- **A change feed.** `/api/changes?since=N`, backed by a 400-entry log.
- **External edits reconcile by diff.** A watcher event debounces, re-reads
  the file once, and diffs against the model. An edit made in Excel to two
  cells reaches the browser as two cell ops, not 5.6 MB. Past
  `MAX_DIFF_OPS` for one sheet, the sheet itself is sent instead; a
  workbook that gained or lost a sheet resets.
- **Reads never take a lock anything slow is holding.** See 4 above.
- **The full payload is encoded once per version.** A second tab, or a
  page reload, gets a cached body rather than a fresh 5.6 MB encode.
- **Warming loads through the same path a write uses.** The startup
  warm-up used to parse the writable workbook on its own while a first
  edit parsed a second copy of it, which made warming slower than not
  warming. It now loads through `_writable_workbook` under `WB_LOCK`.

Verified with the workbook above and a template-shaped one (metadata
preamble, formula column, reserved block): the browser's replay of the
change feed is byte-identical to a full fetch across cell writes,
appends, deletes, bursts, a stale page catching up, and an external edit;
and after 150 concurrent writes from six writers with a poller running,
the served model still equals a fresh parse of the file, row for row.

## What is still open

- **No windowed reads.** Point 3 above. The server sends every row of every
  sheet, and the components filter, sort and paginate in the browser over
  the full set. Fixing it properly means the server owning filter and sort,
  which changes what `store.sheet(name).rows` means for every composed page
  ever generated. That is a deliberate break to plan, not a patch to slip
  in. The change feed removes the per-edit cost of the full payload, which
  was the urgent half.
- **Whole-file saves.** Point 5. Off the interactive path, still the floor
  for how fast an edit reaches Excel.
- **`delete_rows` is O(n).** Point 6.
- **Change detection is still inferred from the filesystem.** Point 7. The
  component doing the writing knows what it wrote; the watcher guesses. One
  gap follows directly: an external edit that lands while our own edits are
  still unsaved is ignored, and the next flush writes over it. The window
  is short (`FLUSH_DELAY`, plus the save) and the alternative is a merge
  policy, which is a product decision.
- **The model is held in memory.** A workbook's worth of Python dicts, plus
  the encoded payload cache, plus the writable workbook. Fine for the files
  this is built for; it is the thing that would give first on a very large
  one.
