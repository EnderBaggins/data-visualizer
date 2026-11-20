// tables.js — tables of points (v14.0, human 2026-11-13: "constructed dataset ... from points that I define from given
// datasets and given datatypes"; "lets not have it in dataset menus ... a new tab"; "I dont want to force it to have each
// row be a dataset ... allow dataset as a column ... each row is the point"; "I basically want the cast to cast a number and
// then that number isnt updated unless I cast again ... this is basically for long term results"; "tables are like
// variables so per desktop").
//
// A table (S.tables[name]) = {name, cols: [{key, label, src}], rows: [{id, dataset, picks: {dim: value}, v: {key: number}}]}.
// A row is one point: where it was measured (its dataset, and the picks of the curve it came from, e.g. r_max) and its
// numbers. Numbers get in by a cast (a fit's or a draw tool's card: "→ table"; a config number column) or by typing; a
// cast writes numbers, which change only when cast again. A column's `src` says where its numbers came from (shown on its
// header). A 1D plot can draw a table: a table line (line.tab = {table, y, by}) on a plot whose x axis is a table column
// (tabAxis), one marker per row, one curve per group of `by` (the dataset by default).
import { S, newId, runNames, store, runOf, axisInfo } from "./model.js";
import { samePoint } from "./results.js";                   // v14.4: the one "same dataset and picks"
import * as R from "./render.js";
import { el, select, askForm, askConfirm, askName, popover, closePopover } from "./ui.js";

let API = { toast() {}, changed() {}, newTablePlot() {}, highlight() {} };
export function setTablesApi(api) { API = { ...API, ...api }; }

// ---- the data ---------------------------------------------------------------------------------------------------------
export const tables = () => (S.tables ||= {});
export const tableOf = name => tables()[name] || null;
export const isTab = l => !!l?.tab;
const finite = x => typeof x === "number" && Number.isFinite(x);
// (v14.4: rows of the same dataset and picks: results.js samePoint, with a hand-typed table's tolerance 1e-6)
/** The pick dims rows carry (context columns after "dataset"), in order of first use. */
export function ctxDims(tb) { const s = new Set(); for (const r of tb.rows) for (const d of Object.keys(r.picks || {})) s.add(d); return [...s]; }
/** A context dim's column name ("r_max" …). */
export const dimLabel = d => axisInfo(d).label || d;
/** Every numeric column of a table: [key, label] (its own columns, then its numeric context dims). */
export function numericCols(tb) { return [...tb.cols.map(c => [c.key, c.label || c.key]), ...ctxDims(tb).map(d => [d, dimLabel(d)])]; }
/** A row's number in column `key` (its own, or a pick), NaN if none. */
export function cell(row, key) { const x = row.v?.[key] ?? row.picks?.[key]; return finite(x) ? x : NaN; }
export function colLabel(tb, key) { const c = tb?.cols.find(x => x.key === key); return c ? c.label || c.key : key === "dataset" ? "dataset" : dimLabel(key); }
/** A plot's x axis that is a table column: "tab:<table>/<key>". */
export const tabAxis = (table, key) => `tab:${encodeURIComponent(table)}/${key}`;
export function parseTabAxis(id) {
  if (typeof id !== "string" || !id.startsWith("tab:")) return null;
  const i = id.lastIndexOf("/");
  return i < 4 ? null : { table: decodeURIComponent(id.slice(4, i)), key: id.slice(i + 1) };
}
const GREEK = { α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "eps", ζ: "zeta", η: "eta", θ: "theta", κ: "kappa", λ: "lambda", μ: "mu", ν: "nu", ξ: "xi", π: "pi", ρ: "rho", σ: "sigma", τ: "tau", φ: "phi", χ: "chi", ψ: "psi", ω: "omega", Ω: "Omega", Ψ: "Psi", Φ: "Phi", "²": "2", "³": "3", "∥": "par" };
const slug = s => (String(s).replace(/./gu, ch => GREEK[ch] ?? ch).replace(/[^A-Za-z0-9_]+/g, "_").replace(/^(?=\d)/, "_").replace(/^_+|_+$/g, "") || "col");
function newColumn(tb, label, src) {
  let key = slug(label), k = 2;
  while (tb.cols.some(c => c.key === key) || key === "dataset") key = `${slug(label)}_${k++}`;
  const c = { key, label, src };
  tb.cols.push(c);
  return c;
}
/** The table named `name` (made if new). */
export function ensureTable(name) { const t = tables(); return (t[name] ||= { name, cols: [], rows: [] }); }
const nowText = () => new Date().toISOString().slice(0, 16).replace("T", " ");

/** Cast numbers into a table. entries = [{run, d: {dim: value}, values: {label: number}}]; srcs = {label: source text};
 *  mode "fill" (a row with the same dataset and the same picks where both have them; else a new row) or "new". Columns
 *  are found by their label (made if new). Returns how many cells were written. */
export function castInto(name, entries, srcs, mode = "fill") {
  const tb = ensureTable(name), when = nowText();
  const col = label => tb.cols.find(c => (c.label || c.key) === label) || newColumn(tb, label, null);
  let n = 0;
  for (const e of entries) {
    const d = Object.fromEntries(Object.entries(e.d || {}).filter(([, x]) => finite(x)));
    let row = mode === "fill" ? tb.rows.find(r => r.dataset === e.run && samePoint({ d }, { d: r.picks || {} }, 1e-6)) : null;
    if (!row) { row = { id: newId(), dataset: e.run ?? null, picks: d, v: {} }; tb.rows.push(row); }
    else row.picks = { ...d, ...(row.picks || {}) };
    for (const [label, x] of Object.entries(e.values || {})) {
      if (!finite(x)) continue;
      const c = col(label);
      c.src = { text: srcs[label] ?? c.src?.text ?? "", when };
      row.v[c.key] = x; n++;
    }
  }
  return n;
}
/** The numeric config keys of the datasets. */
function confKeys() {
  const s = new Set();
  for (const r of Object.values(store.runs)) for (const [k, x] of Object.entries(r.conf || {})) if (typeof x === "number") s.add(k);
  return [...s].sort();
}
/** Fill config column c: each row's dataset's config number (rows without one: left empty). */
function castConfig(tb, c) {
  for (const r of tb.rows) {
    const x = store.runs[runOf(r.dataset)]?.conf?.[c.src.key];
    if (finite(x)) r.v[c.key] = x; else delete r.v[c.key];
  }
  c.src.when = nowText();
}

// ---- a 1D plot of a table --------------------------------------------------------------------------------------------
/** A table line: column `y` against the plot's x column, one curve per value of column `by` ("dataset"; "" = one). */
export const newTabLine = (table, y, by = "dataset") => ({ id: newId(), tab: { table, y, by }, run: null, label: null, color: null, dash: "solid", width: 1.2, visible: true, joined: false, size: 4, listColors: false });
const groupVal = (r, by) => (by === "dataset" ? r.dataset ?? "—" : finite(cell(r, by)) ? R.fmt(cell(r, by)) : "—");
export function tableExpansions(line) {
  const tb = tableOf(line.tab.table), by = line.tab.by ?? "dataset";
  if (!tb || !by) return [null];
  const groups = [...new Set(tb.rows.map(r => groupVal(r, by)))];
  return groups.length ? groups.map((g, k) => ({ tab: g, k, n: groups.length, label: String(g) })) : [null];
}
/** One curve of a table line: the rows of its group with a number in both columns, in rising x. */
export function tableCurve(s, line, sub) {
  const t = line.tab, tb = tableOf(t.table);
  if (!tb) return { error: `there is no table "${t.table}" (sidebar → Tables)` };
  const xk = parseTabAxis(s.xaxis)?.key;
  if (!xk) return { error: `the table line ${colLabel(tb, t.y)} needs a table column on x (⚙ → x)` };
  const by = t.by ?? "dataset";
  const pts = tb.rows.filter(r => !sub || groupVal(r, by) === sub.tab).map(r => ({ r, x: cell(r, xk), y: cell(r, t.y) }))
    .filter(o => finite(o.x) && finite(o.y)).sort((a, b) => a.x - b.x);
  const yl = colLabel(tb, t.y);
  return { curve: { line, src: null, isTab: true, xs: Float64Array.from(pts.map(o => o.x)), ys: Float64Array.from(pts.map(o => o.y)), rows: pts.map(o => o.r), table: tb.name,
    label: [yl, sub?.label].filter(Boolean).join(" · "), sub, subLabel: sub?.label ?? null,
    keyed: [["q", yl], ...(sub ? [["tab:" + by, sub.label]] : [])], listKey: sub ? "tab" : null } };
}
/** The text of a table point (its whole row), for the plot's hover. */
export function rowText(tb, row) {
  return [row.dataset ? `dataset ${row.dataset}` : null, ...ctxDims(tb).filter(d => finite(row.picks?.[d])).map(d => `${dimLabel(d)} ${R.fmt(row.picks[d])}`),
    ...tb.cols.filter(c => finite(row.v?.[c.key])).map(c => `${c.label || c.key} = ${R.fmt(row.v[c.key])}`)].filter(Boolean).join(" · ");
}
export const tabLineText = l => { const tb = tableOf(l.tab.table); return `${tb ? colLabel(tb, l.tab.y) : l.tab.y} (table ${l.tab.table})`; };

// ---- casting from a tool card (fit, draw) ----------------------------------------------------------------------------
/** The "→ table" form. `entries` as castInto (values by candidate key); `cands` = [[key, label, checked, source text]]. */
export async function castForm(entries, cands) {
  if (!entries.length) { API.toast("nothing to cast yet: the values appear after the plot is drawn", true); return; }
  const names = Object.keys(tables());
  const tSel = select([...names.map(n => [n, n]), ["", "new table…"]], names.at(-1) ?? "", () => { newName.style.display = tSel.value ? "none" : ""; });
  const newName = el("input", { type: "text", size: 16, placeholder: "table name", value: names.length ? "" : "results", style: names.length ? "display:none" : "" });
  const picks = cands.map(([k, lab, on]) => ({ k, box: el("input", { type: "checkbox", checked: !!on }), name: el("input", { type: "text", size: 12, value: lab }) }));
  const mode = select([["fill", "fill the rows of the same dataset (and r_max …)"], ["new", "always new rows"]], "fill", () => {});
  const ok = await askForm("Cast to a table", [
    el("div", { class: "pop-row" }, el("span", { class: "lab" }, "table"), tSel, newName),
    el("div", { class: "dim" }, "columns (by name: an existing name writes into that column)"),
    ...picks.map(p => el("div", { class: "pop-row" }, el("label", { class: "chk" }, p.box, ""), p.name)),
    el("div", { class: "pop-row" }, el("span", { class: "lab" }, "rows"), mode),
    el("div", { class: "dim" }, `${entries.length} value${entries.length === 1 ? "" : "s"} (one per curve). The numbers stay as they are until you cast again.`)], "cast");
  if (!ok) return;
  const name = (tSel.value || newName.value || "").trim();
  if (!name) { API.toast("a table name, please", true); return; }
  const chosen = picks.filter(p => p.box.checked && p.name.value.trim());
  if (!chosen.length) { API.toast("tick at least one column", true); return; }
  const srcs = Object.fromEntries(chosen.map(p => [p.name.value.trim(), cands.find(c => c[0] === p.k)[3]]));
  const rows = entries.map(e => ({ run: e.run, d: e.d, values: Object.fromEntries(chosen.map(p => [p.name.value.trim(), e.values[p.k]])) }));
  const n = castInto(name, rows, srcs, mode.value);
  API.changed();
  API.toast(`${n} number${n === 1 ? "" : "s"} cast to table "${name}" (sidebar → Tables)`);
}

// ---- the Tables tab ----------------------------------------------------------------------------------------------------
// v14.7 (human 2026-11-13: "for tables when i click it its actually a popup box so I dont have this awkward scrolling";
// boxes follow RULES P5): the tab lists the tables; a table's rows open in its card (title bar, ×, drag, Esc), at full
// width; the card scrolls inside only when the table is taller than the window, with the column names kept in view.
let CARD = null;                                         // the open table card: {name, box}
export function tablesTab() {
  const all = Object.values(tables());
  const out = [el("div", { class: "sbsec", title: "points you cast from tools (a fit's or a draw tool's card: → table) or type; saved with the desktop" }, "tables")];
  if (!all.length) out.push(el("div", { class: "dim vsub" }, "No table yet. On a fit's card (or a draw tool that reads each curve) click \"→ table\", or make an empty one."));
  for (const tb of all) out.push(el("div", { class: "vline tabhead" },
    el("button", { class: "linkish", title: "open the table (its rows, columns, rename, delete)", onclick: e => openTable(tb.name, e) }, `▦ ${tb.name}`),
    el("span", { class: "dim" }, ` ${tb.rows.length} × ${tb.cols.length}`),
    el("button", { class: "tog", title: "a new 1D plot of this table (pick the x and y columns)", onclick: () => plotForm(tb) }, "plot…"),
    el("button", { class: "tog", title: "copy the table as CSV", onclick: () => copyCSV(tb) }, "CSV")));
  out.push(el("button", { class: "sbadd", onclick: async e => {
    const at = { clientX: e.clientX, clientY: e.clientY };
    const n = (await askName("New table name:", "results"))?.trim();
    if (!n) return;
    if (tables()[n]) { API.toast(`there is already a table "${n}"`, true); return; }
    ensureTable(n); API.changed(); openTable(n, at);
  } }, "+ table"));
  return out;
}
/** Open table `name` in its card, at the click. */
function openTable(name, e) {
  const box = popover(e.clientX, e.clientY, cardContent(name));
  box.classList.add("tabcard");
  CARD = { name, box };
}
/** Fill the open card again from the desktop (after an edit, a cast, undo). Waits a moment so a Tab between cells lands
 *  first, then gives the focus back to the same cell. */
export function refreshTableCard() {
  if (!CARD) return;
  setTimeout(() => {
    if (!CARD?.box.isConnected) { CARD = null; return; }
    const a = document.activeElement, k = CARD.box.contains(a) ? a.dataset?.k : null;
    CARD.box.replaceChildren(...cardContent(CARD.name));
    if (k) { const f = [...CARD.box.querySelectorAll("[data-k]")].find(x => x.dataset.k === k); f?.focus(); f?.select?.(); }
  });
}
function cardContent(name) {
  const tb = tableOf(name);
  if (!tb) return [el("div", { class: "pop-title" }, `table ${name}`), el("div", { class: "dim" }, "This table no longer exists.")];
  const dims = ctxDims(tb), changed = () => API.changed();
  const th = (label, title, onclick) => el("th", { title }, onclick ? el("button", { class: "linkish", onclick }, label) : label);
  const header = el("tr", {}, el("th", {}, ""), th("dataset", "where the point was measured"), ...dims.map(d => th(dimLabel(d), `the curve's ${dimLabel(d)}`)),
    ...tb.cols.map(c => th(c.label || c.key, `${c.src?.text || "typed"}${c.src?.when ? `\ncast ${c.src.when}` : ""}\n\nclick: rename, re-cast, delete`, e => columnMenu(tb, c, e))));
  const numIn = (k, v, set) => el("input", { type: "text", size: 6, class: "tabnum", "data-k": k, value: finite(v) ? R.fmt(v) : "", onchange: e => {
    const t = e.target.value.trim(), x = Number(t);
    if (t === "") set(undefined); else if (finite(x)) set(x); else { e.target.classList.add("bad"); return; }
    changed();
  } });
  const body = tb.rows.map(r => el("tr", {},
    el("td", {}, el("button", { class: "vdel", title: "delete this row", onclick: () => { tb.rows.splice(tb.rows.indexOf(r), 1); changed(); } }, "×")),
    el("td", {}, select([["", "—"], ...runNames().map(n => [n, n]), ...(r.dataset && !runNames().includes(r.dataset) ? [[r.dataset, r.dataset]] : [])], r.dataset ?? "", v => { r.dataset = v || null; changed(); }, { class: "tabsel", "data-k": `${r.id}:dataset` })),
    ...dims.map(d => el("td", {}, numIn(`${r.id}:p:${d}`, r.picks?.[d], x => { r.picks ||= {}; if (x === undefined) delete r.picks[d]; else r.picks[d] = x; }))),
    ...tb.cols.map(c => el("td", {}, numIn(`${r.id}:v:${c.key}`, r.v?.[c.key], x => { r.v ||= {}; if (x === undefined) delete r.v[c.key]; else r.v[c.key] = x; })))));
  const add = el("div", { class: "tabadd" },
    el("button", { class: "tog", onclick: () => { tb.rows.push({ id: newId(), dataset: null, picks: {}, v: {} }); changed(); } }, "+ row"),
    select([["", "+ column…"], ["typed", "typed (empty)"], ...confKeys().map(k => ["conf:" + k, `config: ${k}`])], "", async v => {
      if (!v) return;
      if (v === "typed") { const n = (await askName("Column name:", ""))?.trim(); if (n) { newColumn(tb, n, { text: "typed" }); changed(); } return; }
      const key = v.slice(5), c = newColumn(tb, key, { kind: "config", key, text: `config number ${key} of each row's dataset` });
      castConfig(tb, c); changed();
    }, { class: "tabsel", title: "a column of a config number (read from each row's dataset now; re-cast to read again), or an empty one to type into" }));
  return [el("div", { class: "pop-title" }, `table ${tb.name}`),
    el("div", { class: "pop-row" }, el("span", { class: "dim" }, `${tb.rows.length} row${tb.rows.length === 1 ? "" : "s"} × ${tb.cols.length} column${tb.cols.length === 1 ? "" : "s"}`),
      el("button", { class: "tog", title: "a new 1D plot of this table (pick the x and y columns)", onclick: () => plotForm(tb) }, "plot…"),
      el("button", { class: "tog", title: "copy the table as CSV", onclick: () => copyCSV(tb) }, "CSV"),
      el("button", { class: "tog", onclick: async () => {
        const n = (await askName("Table name:", tb.name))?.trim();
        if (!n || n === tb.name) return;
        if (tables()[n]) { API.toast(`there is already a table "${n}"`, true); return; }
        const old = tb.name; renameTable(old, n); if (CARD?.name === old) CARD.name = n; API.changed(true);
      } }, "rename"),
      el("button", { class: "tog", onclick: async () => {
        if (!(await askConfirm(`Delete table ${tb.name} (${tb.rows.length} rows)? Plots of it show nothing.`, "delete"))) return;
        delete tables()[tb.name]; API.changed(true);
      } }, "delete")),
    el("div", { class: "tabwrap" }, el("table", { class: "outtab tabgrid" }, el("thead", {}, header), el("tbody", {}, ...body))), add];
}
function columnMenu(tb, c, e) {
  popover(e.clientX, e.clientY, [el("div", { class: "pop-title" }, c.label || c.key),
    el("div", { class: "dim" }, `${c.src?.text || "typed"}${c.src?.when ? ` · cast ${c.src.when}` : ""}`),
    el("div", { class: "pop-row" }, el("button", { onclick: async () => { closePopover(); const n = (await askName("Column name:", c.label || c.key))?.trim(); if (n) { c.label = n; API.changed(); } } }, "rename"),
      c.src?.kind === "config" ? el("button", { title: "read every row's config number again", onclick: () => { castConfig(tb, c); closePopover(); API.changed(); } }, "re-cast") : null,
      el("button", { onclick: async () => { closePopover(); if (!(await askConfirm(`Delete column ${c.label || c.key} of table ${tb.name}?`, "delete"))) return;
        tb.cols.splice(tb.cols.indexOf(c), 1); for (const r of tb.rows) delete r.v?.[c.key]; API.changed(); } }, "delete")),
    c.src?.kind === "config" ? null : el("div", { class: "dim" }, "To update these numbers, cast again from the tool's card (same table and column name).")], { over: true });
}
/** Rename a table everywhere (its plots' lines and x axes follow). */
function renameTable(old, nw) {
  const t = tables(), tb = t[old];
  delete t[old]; tb.name = nw; t[nw] = tb;
  for (const p of S.panels) for (const st of [p.settings, ...Object.values(S.groups || {}).map(g => g.settings)]) {
    if (!st) continue;
    for (const l of st.lines || []) if (l.tab?.table === old) l.tab.table = nw;
    const a = parseTabAxis(st.xaxis);
    if (a?.table === old) st.xaxis = tabAxis(nw, a.key);
  }
}
async function plotForm(tb) {
  const cols = numericCols(tb);
  if (cols.length < 1) { API.toast("the table has no numeric column yet", true); return; }
  const x0 = cols.find(([k]) => tb.cols.some(c => c.key === k && c.src?.kind === "config"))?.[0] ?? cols[0][0];
  const y0 = tb.cols.find(c => c.key !== x0 && c.src?.kind !== "config")?.key ?? cols.find(([k]) => k !== x0)?.[0];
  const xs = select(cols, x0, () => {});
  const ys = cols.map(([k, lab]) => ({ k, box: el("input", { type: "checkbox", checked: k === y0 }), lab }));
  const by = select([["dataset", "dataset"], ["", "nothing (one colour)"], ...cols], "dataset", () => {});
  const ok = await askForm(`Plot table ${tb.name}`, [
    el("div", { class: "pop-row" }, el("span", { class: "lab" }, "x"), xs),
    el("div", { class: "dim" }, "y (one line each)"), ...ys.map(y => el("label", { class: "chk" }, y.box, y.lab)),
    el("div", { class: "pop-row" }, el("span", { class: "lab" }, "colour by"), by)], "plot");
  if (!ok) return;
  const chosen = ys.filter(y => y.box.checked && y.k !== xs.value);
  if (!chosen.length) { API.toast("tick a y column (not the x one)", true); return; }
  API.newTablePlot(tb.name, xs.value, chosen.map(y => y.k), by.value);
}
function copyCSV(tb) {
  const dims = ctxDims(tb), q = s => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s);
  const csv = [["dataset", ...dims.map(dimLabel), ...tb.cols.map(c => c.label || c.key)].map(q).join(","),
    ...tb.rows.map(r => [r.dataset ?? "", ...dims.map(d => (finite(r.picks?.[d]) ? r.picks[d] : "")), ...tb.cols.map(c => (finite(r.v?.[c.key]) ? r.v[c.key] : ""))].map(x => q(String(x))).join(","))].join("\n");
  navigator.clipboard?.writeText(csv).then(() => API.toast(`table ${tb.name} copied as CSV (${tb.rows.length} rows)`), () => API.toast("could not copy (the browser refused)", true));
}
