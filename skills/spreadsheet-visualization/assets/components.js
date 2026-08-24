/*
 * components.js: UI building blocks for spreadsheet-backed apps.
 *
 * There is no fixed page structure. Each component renders into a container
 * element you give it and does one job. The composing page, written per
 * spreadsheet based on what the data is *for*, decides which blocks exist,
 * where they sit, and how they're wired together. Every component takes
 * (containerEl, store, opts) and returns an object with at least
 * { el, destroy }.
 *
 * Blocks:
 *   Tabs         switch between sheets (or any named views)
 *   MetaPanel    key/value strip for a sheet's metadata block
 *   StatTile     one aggregate number (sum/avg/count/custom) that stays live
 *   SearchBox    text input emitting a row-filter predicate
 *   DataGrid     paginated, sortable, editable, formula-aware table
 *   AddRow       standalone "create a record" button
 *   ChartBlock   Chart.js chart over sheet rows (requires chart.js loaded)
 *   FieldInput   one typed editor (text/number/date/select/checkbox/
 *                toggle/textarea)
 *   RecordForm   edit a single row as a form of FieldInputs
 *   Collapsible  expandable card, chainable into a step timeline
 *   SideNav      sticky anchor nav with scrollspy
 *   FlowChart    nodes joined by drawn SVG edges
 *   StatusDot    connection indicator for the store
 *
 * All DOM text is set via textContent (never innerHTML with data) so cell
 * values containing markup can't inject into the page.
 */

/* ---------------------------------------------------------------- helpers */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmtCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && !Number.isInteger(v)) return Math.round(v * 10000) / 10000;
  return v;
}

/* ------------------------------------------------------------------- Tabs */

function Tabs(container, items, { onSelect, active, variant } = {}) {
  const root = el("div", variant === "segmented" ? "ss-segmented" : "ss-tabs");
  let current = active ?? items[0];
  const render = () => {
    root.textContent = "";
    items.forEach(name => {
      const btn = el("button", name === current ? "active" : "", name);
      btn.onclick = () => { current = name; render(); onSelect && onSelect(name); };
      root.appendChild(btn);
    });
  };
  render();
  container.appendChild(root);
  return { el: root, get active() { return current; }, destroy: () => root.remove() };
}

/* -------------------------------------------------------------- MetaPanel */

function MetaPanel(container, store, { sheet } = {}) {
  const root = el("div", "ss-meta ss-panel");
  const render = () => {
    const meta = store.sheet(typeof sheet === "function" ? sheet() : sheet).meta || {};
    const keys = Object.keys(meta);
    root.style.display = keys.length ? "flex" : "none";
    root.textContent = "";
    keys.forEach(k => {
      const item = el("div", "ss-meta-item");
      item.appendChild(el("div", "ss-meta-label", k));
      item.appendChild(el("div", "ss-meta-value", String(meta[k])));
      root.appendChild(item);
    });
  };
  const unsub = store.subscribe(render);
  render();
  container.appendChild(root);
  return { el: root, refresh: render, destroy: () => { unsub(); root.remove(); } };
}

/* --------------------------------------------------------------- StatTile */

function StatTile(container, store, { label, sheet, compute, format } = {}) {
  const root = el("div", "ss-tile ss-panel");
  const valueEl = el("div", "ss-tile-value", "–");
  root.appendChild(valueEl);
  root.appendChild(el("div", "ss-tile-label", label || ""));
  const render = () => {
    const data = store.sheet(typeof sheet === "function" ? sheet() : sheet);
    let v;
    try { v = compute(data.rows, data); } catch { v = "–"; }
    valueEl.textContent = format ? format(v) : String(fmtCell(v));
  };
  const unsub = store.subscribe(render);
  render();
  container.appendChild(root);
  return { el: root, refresh: render, destroy: () => { unsub(); root.remove(); } };
}

/* Common aggregations so composing pages don't rewrite them each time. */
const agg = {
  sum: col => rows => rows.reduce((a, r) => a + (Number(r[col]) || 0), 0),
  avg: col => rows => rows.length ? rows.reduce((a, r) => a + (Number(r[col]) || 0), 0) / rows.length : 0,
  count: (col, value) => rows => value === undefined
    ? rows.length
    : rows.filter(r => String(r[col]) === String(value)).length,
  distinct: col => rows => new Set(rows.map(r => r[col]).filter(v => v != null && v !== "")).size,
};

/* -------------------------------------------------------------- SearchBox */

function SearchBox(container, { placeholder = "Search…", columns, onChange } = {}) {
  const wrap = el("div", "ss-search-wrap");
  const icon = el("span", "ss-search-icon");
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
  const input = el("input", "ss-search");
  input.type = "search";
  input.placeholder = placeholder;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { onChange(null); return; }
    onChange(row => {
      const keys = columns || Object.keys(row);
      return keys.some(k => k !== "_row" && String(row[k] ?? "").toLowerCase().includes(q));
    });
  });
  wrap.append(icon, input);
  container.appendChild(wrap);
  // .el is the <input> itself, not the wrapper. Existing compositions
  // already reach in via search.el.value, so that contract can't change.
  return { el: input, clear: () => { input.value = ""; onChange(null); }, destroy: () => wrap.remove() };
}

/* --------------------------------------------------------------- DataGrid */

function DataGrid(container, store, opts = {}) {
  const {
    sheet,                    // string or () => string
    columns,                  // subset + order; default: all headers
    editable = true,          // false, true, or array of editable column names
    pageSize = 100,
    deletable = false,
    addable = false,
    onRowClick,               // (row) => void, e.g. to open a RecordForm
    format = {},              // {column: v => string} display formatters
    types = {},               // {column: "select"|"checkbox"|...} per-column override of inferFieldType, as in RecordForm
    // Every string this block renders, so a page built on a non-English
    // spreadsheet isn't stuck with English chrome next to French data.
    // range gets (from, to, total), matches gets (n).
    labels = {},
  } = opts;
  const L = {
    add: "+ Add row",
    range: (from, to, total) => `${from}–${to} of ${total}`,
    matches: n => `${n} match${n === 1 ? "" : "es"}`,
    ...labels,
  };

  const root = el("div", "ss-grid");
  const toolbar = el("div", "ss-grid-toolbar");
  const pagerEl = el("div", "ss-pager");
  const scroller = el("div", "ss-grid-scroll");
  const table = el("table", "ss-table");
  scroller.appendChild(table);
  toolbar.appendChild(pagerEl);
  root.appendChild(toolbar);
  root.appendChild(scroller);

  let page = 0;
  let filter = null;
  let sortCol = null, sortDir = 1;

  const sheetName = () => (typeof sheet === "function" ? sheet() : sheet);
  const isEditable = col => editable === true || (Array.isArray(editable) && editable.includes(col));

  if (addable) {
    // Same control AddRow renders, so the two can't drift apart. A grid
    // that isn't editable can still carry this, and a page whose grid is
    // read-only can place AddRow wherever it belongs instead.
    AddRow(toolbar, store, { sheet, label: L.add });
  }

  function visibleRows() {
    const data = store.sheet(sheetName());
    let rows = filter ? data.rows.filter(filter) : data.rows.slice();
    if (sortCol) {
      rows.sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol];
        const an = Number(av), bn = Number(bv);
        if (!isNaN(an) && !isNaN(bn) && av !== "" && bv !== "") return (an - bn) * sortDir;
        return String(av ?? "").localeCompare(String(bv ?? "")) * sortDir;
      });
    }
    return rows;
  }

  function render() {
    const data = store.sheet(sheetName());
    const cols = columns || data.headers;
    const rows = visibleRows();
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    page = Math.min(page, pageCount - 1);

    // pager
    pagerEl.textContent = "";
    if (rows.length > pageSize) {
      const prev = el("button", "ss-btn", "‹");
      prev.disabled = page === 0;
      prev.onclick = () => { page--; render(); };
      const next = el("button", "ss-btn", "›");
      next.disabled = page >= pageCount - 1;
      next.onclick = () => { page++; render(); };
      pagerEl.append(prev, el("span", "", L.range(page * pageSize + 1, Math.min(rows.length, (page + 1) * pageSize), rows.length)), next);
    } else if (filter) {
      pagerEl.appendChild(el("span", "", L.matches(rows.length)));
    }

    // Column types for the inline picklist/checkbox editors, resolved once
    // per render rather than per cell, since inferFieldType samples rows.
    const colTypes = {};
    cols.forEach(h => { colTypes[h] = types[h] || inferFieldType(data, h); });

    // table
    table.textContent = "";
    const thead = el("thead");
    const headRow = el("tr");
    cols.forEach(h => {
      const th = el("th", sortCol === h ? (sortDir > 0 ? "sort-asc" : "sort-desc") : "", h);
      th.onclick = () => {
        if (sortCol === h) { sortDir = -sortDir; } else { sortCol = h; sortDir = 1; }
        render();
      };
      headRow.appendChild(th);
    });
    if (deletable) headRow.appendChild(el("th"));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    rows.slice(page * pageSize, (page + 1) * pageSize).forEach(row => {
      const tr = el("tr");
      if (onRowClick) {
        tr.classList.add("clickable");
        tr.onclick = e => { if (e.target.tagName !== "TD" || e.target.isContentEditable && document.activeElement === e.target) return; onRowClick(row); };
      }
      cols.forEach(h => {
        const td = el("td");
        const formula = data.formulas[`${row._row}:${h}`];
        const display = format[h] ? format[h](row[h]) : fmtCell(row[h]);
        if (formula) {
          td.className = "ss-formula";
          td.title = formula;
          td.textContent = display;
        } else if (isEditable(h) && colTypes[h] === "select") {
          // Native <select>, not a rebuilt one. A row's compact height
          // leaves no room for a custom arrow without fighting the cell
          // padding, and the native control already reads as a dropdown.
          const sel = document.createElement("select");
          sel.className = "ss-cell-select";
          const current = String(row[h] ?? "");
          const values = columnValues(data, h);
          // A cell holding a value outside the column's known set (stale
          // data, a typo) shows it as-is instead of silently snapping to
          // whichever option happens to be first.
          if (current && !values.includes(current)) values.unshift(current);
          values.forEach(v => sel.appendChild(new Option(v, v)));
          sel.value = current;
          sel.addEventListener("click", e => e.stopPropagation());
          sel.addEventListener("change", () => store.saveCell(sheetName(), row._row, h, sel.value));
          td.appendChild(sel);
        } else if (isEditable(h) && colTypes[h] === "checkbox") {
          // Same rebuilt checkbox FieldInput and RecordForm use, so a
          // boolean column looks identical in the grid and in a form.
          td.classList.add("ss-cell-check");
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.className = "ss-input";
          cb.checked = ["yes", "true", "1", "y"].includes(String(row[h] ?? "").trim().toLowerCase());
          cb.addEventListener("click", e => e.stopPropagation());
          cb.addEventListener("change", () => store.saveCell(sheetName(), row._row, h, cb.checked ? "Yes" : "No"));
          td.appendChild(cb);
        } else if (isEditable(h)) {
          td.contentEditable = "true";
          td.textContent = display;
          td.addEventListener("click", e => e.stopPropagation());
          td.addEventListener("blur", () => store.saveCell(sheetName(), row._row, h, td.textContent));
          td.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); td.blur(); } });
        } else {
          td.textContent = display;
        }
        tr.appendChild(td);
      });
      if (deletable) {
        const td = el("td", "ss-row-actions");
        const btn = el("button", "", "✕");
        btn.onclick = e => { e.stopPropagation(); store.deleteRow(sheetName(), row._row); };
        td.appendChild(btn);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  const unsub = store.subscribe(render);
  render();
  container.appendChild(root);
  return {
    el: root,
    refresh: render,
    setFilter(fn) { filter = fn; page = 0; render(); },
    setPage(p) { page = p; render(); },
    destroy: () => { unsub(); root.remove(); },
  };
}

/* ------------------------------------------------------------------ AddRow
 * A standalone "create a record" control.
 *
 * Creating a record is a page-level capability, so it lives in its own
 * block rather than as a DataGrid flag. A composition often wants a
 * read-only grid (wide sheets and formatted money/date columns round-trip
 * badly through inline cells) and still needs a way to add a row.
 * RecordForm can't provide one, since it edits a row that already exists.
 *
 *   AddRow(el, store, {
 *     sheet: "Commandes",
 *     label: "+ Nouvelle commande",
 *     values: () => ({ Statut: "-", Montant: 0 }),   // seed template defaults
 *     onAdded: row => openForm(row),                  // row = absolute file row
 *   });
 */

function AddRow(container, store, { sheet, label = "+ Add row", values, className, onAdded } = {}) {
  const btn = el("button", className || "ss-btn ss-btn-primary", label);
  const sheetName = () => (typeof sheet === "function" ? sheet() : sheet);
  btn.onclick = async () => {
    const name = sheetName();
    const data = store.sheet(name);
    const seed = typeof values === "function" ? values(data) : values;
    // Default to a blank value per column so the new row is a real row the
    // grid will show, rather than an append the reader can't see.
    const payload = {};
    data.headers.forEach(h => { payload[h] = ""; });
    Object.assign(payload, seed || {});
    btn.disabled = true;
    try {
      const row = await store.addRow(name, payload);
      if (onAdded) onAdded(row);
    } finally {
      btn.disabled = false;
    }
  };
  container.appendChild(btn);
  return { el: btn, destroy: () => btn.remove() };
}

/* -------------------------------------------------------------- ChartBlock
 * Requires Chart.js to be loaded by the composing page (CDN script tag).
 * opts.x / opts.y fix the fields. opts.controls adds dropdowns to change
 * them. opts.aggregate ("sum"|"avg"|"count") groups rows by x first, which
 * is usually what a categorical chart actually wants. opts.centerText
 * (doughnut only) draws the live sum of the current data in the ring's
 * center, recomputed from whatever is actually plotted rather than being a
 * separate number that could drift from the chart.
 */

function _doughnutCenterTextPlugin(textColor, mutedColor, fontFamily) {
  return {
    id: "ssDoughnutCenterText",
    afterDraw(chart) {
      const { ctx, chartArea } = chart;
      const data = chart.data.datasets[0].data;
      const total = data.reduce((a, b) => a + (Number(b) || 0), 0);
      const cx = chartArea.left + chartArea.width / 2;
      const cy = chartArea.top + chartArea.height / 2;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = textColor;
      ctx.font = `700 22px ${fontFamily}`;
      ctx.fillText(total.toLocaleString(), cx, cy - 11);
      ctx.fillStyle = mutedColor;
      ctx.font = `400 12px ${fontFamily}`;
      ctx.fillText(chart.data.datasets[0].label || "", cx, cy + 12);
      ctx.restore();
    },
  };
}

function ChartBlock(container, store, opts = {}) {
  const {
    sheet, x, y, type = "bar", aggregate = null, topN = 30,
    controls = false, label, centerText = false,
  } = opts;

  const root = el("div", "ss-chart");
  let xField = x, yField = y, chartType = type;
  let controlsEl = null;

  if (controls) {
    controlsEl = el("div", "ss-chart-controls");
    root.appendChild(controlsEl);
  }
  const canvas = document.createElement("canvas");
  root.appendChild(canvas);
  const note = el("div", "ss-chart-note");
  root.appendChild(note);

  let chart = null;
  const sheetName = () => (typeof sheet === "function" ? sheet() : sheet);

  function buildControls(headers) {
    controlsEl.textContent = "";
    const mk = (labelText, value, options, onChange) => {
      const wrap = el("label", "", labelText + " ");
      const sel = document.createElement("select");
      options.forEach(o => sel.appendChild(new Option(o, o)));
      sel.value = value;
      sel.onchange = () => onChange(sel.value);
      wrap.appendChild(sel);
      controlsEl.appendChild(wrap);
    };
    mk("Type", chartType, ["bar", "line", "pie", "doughnut", "scatter"], v => { chartType = v; render(); });
    mk("X", xField, headers, v => { xField = v; render(); });
    mk("Y", yField, headers, v => { yField = v; render(); });
  }

  function render() {
    const data = store.sheet(sheetName());
    if (!data.headers.length) return;
    if (controls) buildControls(data.headers);
    if (!xField || !yField) return;

    let points;
    if (aggregate) {
      const groups = new Map();
      for (const r of data.rows) {
        const key = String(r[xField] ?? "");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(Number(r[yField]) || 0);
      }
      points = [...groups.entries()].map(([k, vs]) => ({
        x: k,
        y: aggregate === "count" ? vs.length : aggregate === "avg" ? vs.reduce((a, b) => a + b, 0) / vs.length : vs.reduce((a, b) => a + b, 0),
      }));
    } else {
      points = data.rows.map(r => ({ x: fmtCell(r[xField]), y: Number(r[yField]) || 0 }));
    }

    if (points.length > topN) {
      points.sort((a, b) => b.y - a.y);
      note.textContent = `Top ${topN} of ${points.length} by ${yField}${aggregate ? ` (${aggregate})` : ""}`;
      points = points.slice(0, topN);
    } else {
      note.textContent = "";
    }

    // Colors come from the theme's token contract, read at render time so a
    // theme swap restyles charts too (call .refresh() after changing themes).
    // --ss-chart-1..N is a fixed categorical order. Multi-color forms
    // (pie/doughnut) walk it in order, single-series forms use slot 1 only.
    const css = getComputedStyle(document.documentElement);
    const palette = [];
    for (let i = 1; i <= 8; i++) {
      const v = css.getPropertyValue(`--ss-chart-${i}`).trim();
      if (v) palette.push(v);
    }
    if (!palette.length) palette.push(css.getPropertyValue("--ss-accent").trim() || "#2a78d6");
    const ink = css.getPropertyValue("--ss-muted").trim() || "#6b6b73";
    // A hairline gridline, not a visible ruled line. color-mix against the
    // muted ink at low strength self-scales in both themes the same way
    // DataGrid's row dividers do. --ss-border is sometimes too faint (see
    // base.css) and a flat --ss-text line would compete with the data.
    const gridColor = `color-mix(in srgb, ${ink} 15%, transparent)`;
    const fontBody = css.getPropertyValue("--ss-font-body").trim() || "sans-serif";
    const panel = css.getPropertyValue("--ss-panel").trim() || "#ffffff";
    const text = css.getPropertyValue("--ss-text").trim() || "#1c1c1f";
    const border = css.getPropertyValue("--ss-border").trim() || "#e2e2e6";
    const radiusSm = parseFloat(css.getPropertyValue("--ss-radius-sm")) || 6;
    const multiColor = chartType === "pie" || chartType === "doughnut";
    const colors = multiColor ? points.map((_, i) => palette[i % palette.length]) : palette[0];
    const isBar = chartType === "bar";
    const isLine = chartType === "line";

    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      type: chartType,
      data: {
        labels: points.map(p => p.x),
        datasets: [{
          label: label || yField,
          data: points.map(p => p.y),
          backgroundColor: colors,
          // A 2px panel-colored gap between adjacent fills: the secondary
          // encoding that makes near-CVD-floor palette pairs legible.
          borderColor: multiColor ? panel : colors,
          borderWidth: multiColor ? 2 : isLine ? 2 : undefined,
          fill: false,
          // Rounded bar tops, a gentle line curve, and no per-point dots.
          // These three knobs, not color, are what make a chart read as
          // designed rather than as default library output.
          // The radius is theme-aware rather than a hardcoded 4px:
          // brutalist sets --ss-radius-sm to 0 because sharp corners are
          // the point, and cozy sets it larger.
          borderRadius: isBar ? { topLeft: radiusSm, topRight: radiusSm, bottomLeft: 0, bottomRight: 0 } : undefined,
          borderSkipped: isBar ? false : undefined,
          barPercentage: isBar ? 0.6 : undefined,
          categoryPercentage: isBar ? 0.7 : undefined,
          tension: isLine ? 0.4 : undefined,
          pointRadius: isLine ? 3 : undefined,
          pointHoverRadius: isLine ? 5 : undefined,
          pointBackgroundColor: isLine ? palette[0] : undefined,
          pointBorderColor: isLine ? panel : undefined,
          pointBorderWidth: isLine ? 1.5 : undefined,
          cutout: chartType === "doughnut" ? "68%" : undefined,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
          // A single-series chart needs no legend box, since the title
          // already names it. Multi-color forms keep one for slice
          // identity, using small square swatches rather than Chart.js's
          // default circles, matching the tooltip below.
          legend: {
            display: multiColor,
            labels: { color: ink, font: { family: fontBody }, usePointStyle: true, pointStyle: "rect", boxWidth: 10, boxHeight: 10, padding: 16 },
          },
          tooltip: {
            enabled: true,
            backgroundColor: panel, titleColor: text, bodyColor: text,
            borderColor: border, borderWidth: 1, cornerRadius: radiusSm,
            padding: 10, boxPadding: 4, usePointStyle: true,
            titleFont: { family: fontBody, weight: "600" }, bodyFont: { family: fontBody },
          },
        },
        scales: multiColor ? {} : {
          // No vertical gridlines, no axis line, no tick marks. A light
          // horizontal ruling and muted labels carry the scale on their
          // own, so the bars or line stay the loudest thing on the canvas.
          x: {
            ticks: { color: ink, font: { family: fontBody } },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            ticks: { color: ink, font: { family: fontBody } },
            grid: { color: gridColor },
            border: { display: false },
          },
        },
      },
      plugins: chartType === "doughnut" && centerText ? [_doughnutCenterTextPlugin(text, ink, fontBody)] : [],
    });
  }

  const unsub = store.subscribe(render);
  render();
  container.appendChild(root);
  return {
    el: root,
    refresh: render,
    setFields(fx, fy) { xField = fx; yField = fy; render(); },
    destroy: () => { unsub(); if (chart) chart.destroy(); root.remove(); },
  };
}

/* -------------------------------------------------------------- FieldInput
 * One typed editor. type comes from inferFieldType() or is passed
 * explicitly. Returns {el, get, set}. Pass onChange(value) to fire as soon
 * as this field commits its own edit: blur for text/number/date, change for
 * select/checkbox, click for toggle. Without onChange nothing fires and
 * .get() is the only way to read the value.
 */

function FieldInput(container, { type = "text", value = "", options = [], onChange } = {}) {
  let input;
  let autoGrow = null;
  if (type === "select") {
    input = document.createElement("select");
    options.forEach(o => input.appendChild(new Option(o, o)));
    input.value = String(value ?? "");
    input.classList.add("ss-input");
    if (onChange) input.addEventListener("change", () => onChange(input.value));
    container.appendChild(input);
  } else if (type === "checkbox") {
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = ["yes", "true", "1", "y"].includes(String(value).trim().toLowerCase());
    input.classList.add("ss-input");
    if (onChange) input.addEventListener("change", () => onChange(input.checked ? "Yes" : "No"));
    container.appendChild(input);
  } else if (type === "toggle") {
    // A boolean spreadsheet value (Yes/No, Active/Inactive) reads as an
    // on/off state you flip, so it gets a switch rather than a checkbox.
    // Same get/set("Yes"/"No") contract as the checkbox type, so callers
    // like RecordForm don't need to know which one they got.
    //
    // A <span>, not a <button>: some Chromium builds paint an experimental
    // native UA track for button[role="switch"] that overrides
    // background-color at the compositing layer. appearance:none doesn't
    // suppress it, only not being a form-control element does.
    const checked = ["yes", "true", "1", "y"].includes(String(value).trim().toLowerCase());
    input = document.createElement("span");
    input.className = "ss-switch";
    input.tabIndex = 0;
    input.setAttribute("role", "switch");
    input.setAttribute("aria-checked", String(checked));
    input.appendChild(el("span", "ss-switch-thumb"));
    const toggle = () => {
      const next = input.getAttribute("aria-checked") !== "true";
      input.setAttribute("aria-checked", String(next));
      if (onChange) onChange(next ? "Yes" : "No");
    };
    input.onclick = toggle;
    input.onkeydown = e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } };
    container.appendChild(input);
  } else if (type === "textarea") {
    input = document.createElement("textarea");
    input.value = value ?? "";
    input.rows = 3;
    input.classList.add("ss-input");
    // Height tracks the content, since base.css turns the drag handle off.
    // A fixed 3-row box would clip or inner-scroll on anything longer.
    autoGrow = () => {
      // Sets overflow explicitly rather than leaving it on overflow-y:auto.
      // Under a fractional device pixel ratio (the 0.667px border here is
      // the tell) scrollHeight and clientHeight round to the same integer
      // while the sub-pixel layout still overflows by a hair, so the
      // browser paints a scrollbar for content that visibly fits.
      // Measuring with scrolling off and deciding here avoids that.
      // maxHeight must be read in-DOM on every call. Read once before
      // appendChild it resolves to "none" and the cap silently never fires.
      const maxH = parseFloat(getComputedStyle(input).maxHeight) || Infinity;
      input.style.overflowY = "hidden";
      input.style.height = "auto";
      const border = input.offsetHeight - input.clientHeight; // border-box's border, since scrollHeight excludes it
      const contentHeight = input.scrollHeight + border;
      if (contentHeight > maxH) { input.style.height = maxH + "px"; input.style.overflowY = "auto"; }
      else { input.style.height = contentHeight + "px"; }
    };
    input.addEventListener("input", autoGrow);
    if (onChange) {
      input.addEventListener("blur", () => onChange(input.value));
      // Enter inserts a newline here, unlike single-line text, so only
      // Ctrl/Cmd+Enter commits. A multi-line field exists to hold line
      // breaks.
      input.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); input.blur(); } });
    }
    container.appendChild(input);
    // scrollHeight only means anything once the element has been laid out,
    // so the first measurement has to happen with it in the document.
    // RecordForm builds each field row detached and attaches it afterwards,
    // which would otherwise measure every dimension as 0 and leave a long
    // value clipped at min-height with overflow hidden. A microtask runs
    // after the caller's synchronous build finishes, by which point the row
    // is attached. The ResizeObserver below covers a page that defers
    // attachment past that point.
    if (input.isConnected) autoGrow();
    else queueMicrotask(() => { if (input.isConnected) autoGrow(); });
    // Typing isn't the only thing that changes the line count. A narrower
    // column wraps more lines, so re-measure when the width changes too:
    // a Collapsible opening, a layout breakpoint, a sidebar toggling.
    // Only width deltas count, or autoGrow's own height writes would
    // retrigger the observer.
    let lastWidth = input.getBoundingClientRect().width;
    const ro = new ResizeObserver(() => {
      const w = input.getBoundingClientRect().width;
      if (Math.abs(w - lastWidth) > 0.5) { lastWidth = w; autoGrow(); }
    });
    ro.observe(input);
    input._roDisconnect = () => ro.disconnect();
  } else {
    input = document.createElement("input");
    input.type = type === "number" ? "number" : type === "date" ? "date" : "text";
    if (type === "date" && value) {
      const d = new Date(value);
      if (!isNaN(d)) input.value = d.toISOString().slice(0, 10);
    } else {
      input.value = value ?? "";
    }
    input.classList.add("ss-input");
    if (onChange) {
      input.addEventListener("blur", () => onChange(input.value));
      input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
    }
    container.appendChild(input);
  }
  const isBoolType = type === "checkbox" || type === "toggle";
  const isChecked = () => type === "toggle" ? input.getAttribute("aria-checked") === "true" : input.checked;
  return {
    el: input,
    get: () => isBoolType ? (isChecked() ? "Yes" : "No") : input.value,
    set: v => {
      if (type === "toggle") input.setAttribute("aria-checked", String(!!v));
      else if (type === "checkbox") input.checked = !!v;
      else { input.value = v; if (autoGrow) autoGrow(); }
    },
    destroy: () => { input._roDisconnect && input._roDisconnect(); input.remove(); },
  };
}

/* -------------------------------------------------------------- RecordForm
 * Edit one row as a labelled form. Field types are inferred per column
 * unless overridden via opts.types. Autosaves per field as soon as it
 * commits, the same live-sync convention as DataGrid's inline editing.
 * There is no batched Save/Cancel, because a spreadsheet-backed form has
 * nothing meaningful to cancel: the moment a field commits, it is already
 * written to the file. onSaved(col, value), if given, fires after each
 * field's write completes.
 */

function RecordForm(container, store, { sheet, row, columns, types = {}, onSaved } = {}) {
  const root = el("div", "ss-form ss-panel");
  const sheetName = typeof sheet === "function" ? sheet() : sheet;
  const data = store.sheet(sheetName);
  const cols = columns || data.headers;

  cols.forEach(col => {
    if (store.isFormulaCell(sheetName, row._row, col)) return; // formulas are not hand-editable
    const t0 = types[col] || inferFieldType(data, col);
    // A boolean reads as an on/off switch here, not a checkbox. See
    // FieldInput's "toggle" type. Its field row is laid out horizontally
    // (label left, switch right) rather than label-above-control, since a
    // compact switch reads better inline with its label.
    const t = t0 === "checkbox" ? "toggle" : t0;
    const fieldWrap = el("div", "ss-form-field" + (t === "toggle" ? " ss-form-field-toggle" : ""));
    fieldWrap.appendChild(el("label", "ss-form-label", col));
    FieldInput(fieldWrap, {
      type: t,
      value: row[col],
      options: t === "select" ? columnValues(data, col) : [],
      onChange: async v => {
        if (String(v) === String(row[col] ?? "")) return;
        row[col] = v; // keep the diff baseline current for repeated edits in one session
        await store.saveCell(sheetName, row._row, col, v);
        onSaved && onSaved(col, v);
      },
    });
    root.appendChild(fieldWrap);
  });

  container.appendChild(root);
  return { el: root, destroy: () => root.remove() };
}

/* ------------------------------------------------------------- Collapsible
 * Expandable card: header row (optional number, title, subtitle, right-side
 * tag) + a body that shows when open. Body content: a string, a Node, or a
 * function (bodyEl) => void so data-bound blocks can render inside it.
 * Chain them for step timelines like deploy pipelines or process docs.
 */

function Collapsible(container, { num, title, subtitle, tag, tagClass = "", open = false, content } = {}) {
  const root = el("div", "ss-collapse" + (open ? " open" : ""));
  const head = el("div", "ss-collapse-head");
  if (num !== undefined) head.appendChild(el("div", "ss-collapse-num", String(num)));
  head.appendChild(el("span", "ss-collapse-title", title));
  if (subtitle) head.appendChild(el("span", "ss-collapse-sub", subtitle));
  head.appendChild(el("span", "ss-collapse-spacer"));
  if (tag) head.appendChild(el("span", `ss-badge ${tagClass}`.trim(), tag));
  head.appendChild(el("span", "ss-collapse-arrow", "▼"));
  root.appendChild(head);

  const body = el("div", "ss-collapse-body");
  if (typeof content === "function") content(body);
  else if (content instanceof Node) body.appendChild(content);
  else if (content !== undefined) body.textContent = String(content);
  root.appendChild(body);

  head.onclick = () => root.classList.toggle("open");
  container.appendChild(root);
  return {
    el: root,
    body,
    setOpen: v => root.classList.toggle("open", v),
    destroy: () => root.remove(),
  };
}

/* ----------------------------------------------------------------- SideNav
 * Sticky sidebar of anchor links with scrollspy: the entry whose target
 * section is currently in view gets the active highlight. items:
 * [{label, target: "#section-id"}]. Clicking scrolls smoothly.
 */

function SideNav(container, items) {
  const root = el("nav", "ss-sidenav");
  const links = new Map();
  items.forEach(({ label, target }) => {
    const a = el("a", "", label);
    a.href = target;
    a.onclick = e => {
      e.preventDefault();
      document.querySelector(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    links.set(target.replace(/^#/, ""), a);
    root.appendChild(a);
  });

  const observer = new IntersectionObserver(entries => {
    // Highlight the topmost visible section.
    const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (!visible.length) return;
    links.forEach(a => a.classList.remove("active"));
    links.get(visible[0].target.id)?.classList.add("active");
  }, { rootMargin: "-10% 0px -70% 0px" });
  items.forEach(({ target }) => {
    const sec = document.querySelector(target);
    if (sec) observer.observe(sec);
  });
  if (links.size) links.values().next().value.classList.add("active");

  container.appendChild(root);
  return { el: root, destroy: () => { observer.disconnect(); root.remove(); } };
}

/* -------------------------------------------------------------- FlowChart
 * A small diagram of nodes connected by real drawn edges: SVG paths with
 * arrowheads, measured from actual DOM positions, not text arrows between
 * chips. It handles branching, not just a straight chain. Nodes are
 * arranged into layers by longest path from a root, so a node with two
 * children, or an edge that skips a layer, lays out correctly.
 *
 *   FlowChart(el, {
 *     direction: "LR",                                    // or "TB"
 *     nodes: [
 *       { id: "laptop", label: "Laptop" },
 *       { id: "dev", label: "DEV", variant: "accent" },
 *       { id: "git", label: "git (maybe, later)", variant: "ghost" },
 *     ],
 *     edges: [
 *       { from: "laptop", to: "dev" },
 *       { from: "dev", to: "uat", label: "on approve" },
 *     ],
 *   });
 *
 * Node opts: id (required), label, sub (small muted line under label),
 * variant: "default" | "accent" | "ghost".
 * Re-lays-out automatically on container resize (font/theme changes count,
 * since they resize nodes); call .relayout() manually after mutating
 * .nodes/.edges in place.
 */

function FlowChart(container, { direction = "LR", nodes = [], edges = [] } = {}) {
  const stage = el("div", "ss-flowchart");
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  const markerId = "ss-flow-arrow-" + Math.random().toString(36).slice(2, 9);
  svg.innerHTML = `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:var(--ss-muted)"/></marker></defs>`;
  const grid = el("div", "ss-flow-grid" + (direction === "TB" ? " tb" : ""));
  stage.append(svg, grid);
  container.appendChild(stage);

  const nodeEls = new Map();
  const labelEls = [];

  function layerOf() {
    // Longest path from any root (a node with no incoming edges), which
    // handles branches and edges that skip a layer without overlapping
    // columns. Any node the walk never reaches, which means the edge list
    // has a cycle, keeps its initial layer 0 and still renders.
    const incoming = new Map(nodes.map(n => [n.id, 0]));
    edges.forEach(e => incoming.set(e.to, (incoming.get(e.to) || 0) + 1));
    const layer = new Map(nodes.map(n => [n.id, 0]));
    const queue = nodes.filter(n => !incoming.get(n.id)).map(n => n.id);
    const remaining = new Map(incoming);
    while (queue.length) {
      const id = queue.shift();
      edges.filter(e => e.from === id).forEach(e => {
        layer.set(e.to, Math.max(layer.get(e.to) || 0, (layer.get(id) || 0) + 1));
        remaining.set(e.to, remaining.get(e.to) - 1);
        if (remaining.get(e.to) === 0) queue.push(e.to);
      });
    }
    return layer;
  }

  function render() {
    grid.textContent = "";
    nodeEls.clear();
    const layer = layerOf();
    const maxLayer = Math.max(0, ...nodes.map(n => layer.get(n.id) || 0));
    for (let l = 0; l <= maxLayer; l++) {
      const col = el("div", "ss-flow-col");
      nodes.filter(n => (layer.get(n.id) || 0) === l).forEach(n => {
        const box = el("div", "ss-flow-node" + (n.variant && n.variant !== "default" ? ` ${n.variant}` : ""));
        box.appendChild(document.createTextNode(n.label ?? n.id));
        if (n.sub) box.appendChild(el("span", "ss-flow-sub", n.sub));
        col.appendChild(box);
        nodeEls.set(n.id, box);
      });
      grid.appendChild(col);
    }
    drawEdges();
  }

  function drawEdges() {
    const paths = svg.querySelectorAll("path.edge");
    paths.forEach(p => p.remove());
    labelEls.forEach(l => l.remove());
    labelEls.length = 0;

    const stageRect = stage.getBoundingClientRect();
    svg.setAttribute("width", stageRect.width);
    svg.setAttribute("height", stageRect.height);

    edges.forEach(e => {
      const fromEl = nodeEls.get(e.from), toEl = nodeEls.get(e.to);
      if (!fromEl || !toEl) return;
      const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
      let x1, y1, x2, y2;
      if (direction === "TB") {
        x1 = a.left + a.width / 2 - stageRect.left; y1 = a.bottom - stageRect.top;
        x2 = b.left + b.width / 2 - stageRect.left; y2 = b.top - stageRect.top;
      } else {
        x1 = a.right - stageRect.left; y1 = a.top + a.height / 2 - stageRect.top;
        x2 = b.left - stageRect.left; y2 = b.top + b.height / 2 - stageRect.top;
      }
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("class", "edge");
      const d = direction === "TB"
        ? (Math.abs(x1 - x2) < 1 ? `M${x1},${y1} L${x2},${y2}` : `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`)
        : (Math.abs(y1 - y2) < 1 ? `M${x1},${y1} L${x2},${y2}` : `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`);
      path.setAttribute("d", d);
      path.setAttribute("marker-end", `url(#${markerId})`);
      path.setAttribute("style", "fill:none;stroke:var(--ss-border);stroke-width:1.5px");
      svg.appendChild(path);

      if (e.label) {
        const lbl = el("span", "ss-flow-edge-label", e.label);
        lbl.style.left = `${(x1 + x2) / 2}px`;
        lbl.style.top = `${(y1 + y2) / 2}px`;
        stage.appendChild(lbl);
        labelEls.push(lbl);
      }
    });
  }

  render();
  // Layout depends on measured node sizes (font, padding, theme), so
  // redraw edges whenever the stage resizes, not just once on init.
  const ro = new ResizeObserver(() => requestAnimationFrame(drawEdges));
  ro.observe(stage);

  return {
    el: stage,
    relayout: render,
    destroy: () => { ro.disconnect(); stage.remove(); },
  };
}

/* -------------------------------------------------------------- StatusDot
 * Despite the name, kept for API stability, this renders an icon rather
 * than a dot: a static checkmark when connected, a spinning loader while
 * reconnecting. A color-only dot can't tell "connected" apart from
 * "currently retrying". An animated icon can.
 */

const _STATUS_ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>';
const _STATUS_ICON_SPINNER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/></svg>';

function StatusDot(container, store, { labels } = {}) {
  const L = { connected: "connected", reconnecting: "reconnecting…", ...labels };
  const wrap = el("span", "ss-status");
  const icon = el("span", "ss-status-icon");
  const text = el("span", "", L.connected);
  wrap.append(icon, text);
  const render = ok => {
    icon.innerHTML = ok ? _STATUS_ICON_CHECK : _STATUS_ICON_SPINNER;
    wrap.classList.toggle("stale", !ok);
    text.textContent = ok ? L.connected : L.reconnecting;
  };
  // Render what the store actually knows rather than assuming success.
  // Until the first poll answers, that is "not connected yet", which is
  // true; the store's loading overlay covers this moment on a healthy page.
  render(store.connected === true);
  const unsub = store.onStatus(render);
  container.appendChild(wrap);
  return { el: wrap, destroy: () => { unsub(); wrap.remove(); } };
}
