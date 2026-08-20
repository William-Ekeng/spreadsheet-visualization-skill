/*
 * sheetsync.js -- data layer for spreadsheet-backed UIs. No UI opinions.
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
 * payload when the version moved (either from this page's own writes or
 * from someone editing the file directly in Excel), so subscribers are only
 * called when data genuinely changed.
 */

class SheetStore {
  constructor({ api = "", pollMs = 1000 } = {}) {
    this.api = api;
    this.pollMs = pollMs;
    this.version = -1;
    this.sheets = {};
    this.connected = false;
    this._subs = new Set();
    this._statusSubs = new Set();
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

  _emit() { this._subs.forEach(fn => fn(this)); }

  _setStatus(ok) {
    if (ok !== this.connected) {
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
    await this._tick();
  }

  stop() { this._running = false; }

  async refresh() {
    const res = await fetch(`${this.api}/api/data`);
    const data = await res.json();
    this.version = data.version;
    this.sheets = data.sheets;
    this._emit();
  }

  async _tick() {
    try {
      const res = await fetch(`${this.api}/api/version`);
      const { version } = await res.json();
      this._setStatus(true);
      if (version !== this.version) await this.refresh();
    } catch (e) {
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
    await fetch(`${this.api}/api/cell`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheet, row, column, value }),
    });
  }

  async addRow(sheet, values) {
    await fetch(`${this.api}/api/rows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheet, values }),
    });
  }

  async deleteRow(sheet, rowIdx) {
    await fetch(`${this.api}/api/rows/${encodeURIComponent(sheet)}/${rowIdx}`, { method: "DELETE" });
  }
}

/* Column type inference -- lets form/input components pick sensible editors
 * without the composing page having to declare every column's type by hand.
 * Returns one of: "number" | "date" | "checkbox" | "select" | "text".
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
