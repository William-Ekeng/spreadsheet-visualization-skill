/*
 * sheetsync.js: data layer for spreadsheet-backed UIs. No UI opinions.
 *
 * Wraps the sync_server.py JSON API in a small observable store:
 *
 *   const store = new SheetStore();
 *   store.subscribe(() => render(store.sheet("Orders")));
 *   store.start();
 *   ...
 *   await store.saveCell("Orders", 12, "Quantity", 5);
 *
 * The store polls a cheap /api/version endpoint and only fetches the full
 * payload when the version moved, either from this page's own writes or
 * from someone editing the file directly in Excel. Subscribers therefore
 * only fire when the data actually changed.
 */

class SheetStore {
  constructor({ api = "", pollMs = 1000, loadingText = "Loading…", showLoading = true } = {}) {
    this.api = api;
    this.pollMs = pollMs;
    // False until the first payload lands. A page that builds its blocks
    // inside subscribe() renders nothing at all until then, so the store
    // puts up its own placeholder rather than leaving a blank page that
    // looks broken. Pass showLoading:false to own that moment yourself.
    this.loaded = false;
    this.loadingText = loadingText;
    this.showLoading = showLoading;
    this._loadingEl = null;
    this._statusSeen = false;
    this._lastFlushError = null;
    this.version = -1;
    this.sheets = {};
    this.connected = false;
    this._subs = new Set();
    this._statusSubs = new Set();
    this._errorSubs = new Set();
    this._running = false;
  }

  /* --- subscriptions ---------------------------------------------------- */

  subscribe(fn) {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  onStatus(fn) {
    this._statusSubs.add(fn);
    return () => this._statusSubs.delete(fn);
  }

  // Called when a write is refused (most often Excel holding the file lock
  // on Windows). Worth subscribing to even if every call site also catches:
  // a write that fails silently looks exactly like one that worked, and the
  // user goes on typing into a file that is not being updated.
  onError(fn) {
    this._errorSubs.add(fn);
    return () => this._errorSubs.delete(fn);
  }

  // fetch() only rejects on network failure: an HTTP 500 from a locked file
  // resolves normally, so a write that never landed looks like one that did.
  // Every write goes through here, which turns that into a thrown error.
  async _write(url, init) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (networkError) {
      this._failed(networkError.message || "the server is unreachable");
      throw networkError;
    }
    if (!res.ok) {
      // The server sends {error: "..."} for the cases worth showing a
      // person (a locked file, most often). Fall back to the status only.
      const body = await res.json().catch(() => null);
      const err = new Error(body && body.error ? body.error : `Write refused (HTTP ${res.status}).`);
      this._failed(err.message);
      throw err;
    }
    return res.json().catch(() => ({}));
  }

  _failed(message) {
    this._errorSubs.forEach(fn => fn(message));
  }

  _emit() { this._subs.forEach(fn => fn(this)); }

  _setStatus(ok) {
    // Emit on the first result even when it matches the initial value.
    // connected starts false, so without this a page whose first poll
    // fails sees no transition and keeps whatever its indicator rendered
    // optimistically, leaving an unreachable server looking connected.
    if (ok !== this.connected || !this._statusSeen) {
      this._statusSeen = true;
      this.connected = ok;
      this._statusSubs.forEach(fn => fn(ok));
    }
  }

  /* --- data access ------------------------------------------------------ */

  sheetNames() { return Object.keys(this.sheets); }

  sheet(name) {
    return this.sheets[name] || { headers: [], rows: [], formulas: {}, meta: {}, header_row: 1 };
  }

  isFormulaCell(sheetName, rowIdx, column) {
    return !!this.sheet(sheetName).formulas[`${rowIdx}:${column}`];
  }

  /* --- polling ---------------------------------------------------------- */

  async start() {
    if (this._running) return;
    this._running = true;
    if (this.showLoading && !this.loaded) this._mountLoading();
    await this._tick();
  }

  /* --- first paint -------------------------------------------------------
   * Reading a large workbook takes a moment, and during it a composed page
   * commonly shows only its static header. A connected status beside no
   * content reads as "loaded fine, there's nothing here", which is worse
   * than showing nothing at all: it asserts success. This is the store's
   * job because it is the only thing running before any block exists.
   */

  _mountLoading() {
    if (this._loadingEl || typeof document === "undefined") return;
    const box = document.createElement("div");
    box.className = "ss-loading";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.textContent = this.loadingText;
    (document.body || document.documentElement).appendChild(box);
    this._loadingEl = box;
  }

  _unmountLoading() {
    if (this._loadingEl) { this._loadingEl.remove(); this._loadingEl = null; }
  }

  stop() { this._running = false; }

  async refresh() {
    const res = await fetch(`${this.api}/api/data`);
    const data = await res.json();
    this.version = data.version;
    this.sheets = data.sheets;
    this.loaded = true;
    this._unmountLoading();
    this._emit();
  }

  async _tick() {
    try {
      const res = await fetch(`${this.api}/api/version`);
      const { version, error } = await res.json();
      this._setStatus(true);
      // A save is deferred so a burst of edits costs one write, which means
      // a failure surfaces here rather than on the request that made the
      // edit. Report it once per occurrence.
      if (error && error !== this._lastFlushError) { this._lastFlushError = error; this._failed(error); }
      if (!error) this._lastFlushError = null;
      if (version !== this.version) await this.refresh();
    } catch {
      this._setStatus(false);
    } finally {
      if (this._running) setTimeout(() => this._tick(), this.pollMs);
    }
  }

  /* --- writes ------------------------------------------------------------
   * Each write bumps the server version; the next poll refetches, so all
   * components (including in other open tabs) converge on the file state.
   */

  async saveCell(sheet, row, column, value) {
    await this._write(`${this.api}/api/cell`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheet, row, column, value }),
    });
  }

  // Resolves to the absolute file row that was created, so a caller can
  // act on it (open a form on it, highlight it) instead of guessing.
  async addRow(sheet, values) {
    const body = await this._write(`${this.api}/api/rows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheet, values }),
    });
    return body.row;
  }

  async deleteRow(sheet, rowIdx) {
    await this._write(`${this.api}/api/rows/${encodeURIComponent(sheet)}/${rowIdx}`, { method: "DELETE" });
  }
}

/* Column type inference, so form and input components can pick sensible
 * editors without the composing page declaring every column's type by hand.
 * Returns one of: "number" | "date" | "checkbox" | "select" | "textarea" |
 * "text".
 */
function inferFieldType(sheetData, column, sampleSize = 40) {
  const values = sheetData.rows.slice(0, sampleSize)
    .map(r => r[column])
    .filter(v => v !== null && v !== undefined && v !== "");
  if (!values.length) return "text";

  const boolWords = new Set(["yes", "no", "true", "false", "0", "1", "y", "n"]);
  if (values.every(v => boolWords.has(String(v).trim().toLowerCase()))) return "checkbox";

  if (values.every(v => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))))) return "number";

  // Server serialises xlsx dates as RFC1123-ish strings ("Sun, 08 Nov 2020 00:00:00 GMT")
  if (values.every(v => typeof v === "string" && !isNaN(Date.parse(v)) && /\d{4}/.test(v))) return "date";

  const distinct = new Set(values.map(v => String(v)));
  if (distinct.size <= 12 && distinct.size < Math.max(2, values.length / 2)) return "select";

  // Notes and description columns read badly in a single-line input. An
  // embedded line break, or values long enough to be prose rather than a
  // label, means the multi-line editor is the better fit.
  const avgLen = values.reduce((a, v) => a + String(v).length, 0) / values.length;
  if (values.some(v => String(v).includes("\n")) || avgLen > 60) return "textarea";

  return "text";
}

/* Distinct values of a column (for select editors and filter dropdowns). */
function columnValues(sheetData, column) {
  const seen = new Set();
  for (const r of sheetData.rows) {
    const v = r[column];
    if (v !== null && v !== undefined && v !== "") seen.add(String(v));
  }
  return [...seen].sort();
}
