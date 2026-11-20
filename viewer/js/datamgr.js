// datamgr.js — the data manager page. v6.0 (human 2026-10-07: "a side tool that allows me to easily make up the data
// for the visualizer … as a webpage"); v6.1: datasets as columns, rows selectable, editable groups; v6.2 (human:
// "I want this to work more like a filesystem … drag a measurement to another group and then drag groups around …
// drag around columns in the same way"): drag and drop for columns, rows → groups, groups; click a name to rename it
// (like the visualizer's titles); ⋯ or right-click for actions; raw fields copied from a dataset's own dumps.
// Data: `python -m datamgr status --json` via serve.py; computing, copying, deleting and renaming need serve.py's token.
const $ = id => document.getElementById(id);
// hover boxes (v8.4): every title shows quickly, styled like the viewer's
let tipEl = null, tipFor = null, tipTimer = 0;
function hideTip() { clearTimeout(tipTimer); tipEl?.remove(); tipEl = null; tipFor = null; }
document.addEventListener("mouseover", e => {
  const t = e.target.closest?.("[title], [data-tip]");
  if (!t || t === tipFor) return;
  if (t.hasAttribute("title")) { const v = t.getAttribute("title"); t.removeAttribute("title"); if (v) t.dataset.tip = v; }
  if (!t.dataset.tip) return;
  hideTip(); tipFor = t;
  tipTimer = setTimeout(() => {
    if (tipFor !== t || !t.isConnected) return;
    tipEl = document.createElement("div"); tipEl.className = "tipbox"; tipEl.textContent = t.dataset.tip; document.body.append(tipEl);
    const r = t.getBoundingClientRect(), b = tipEl.getBoundingClientRect();
    let y = r.bottom + 6; if (y + b.height > innerHeight - 4) y = Math.max(4, r.top - b.height - 6);
    tipEl.style.left = Math.max(4, Math.min(r.left, innerWidth - b.width - 6)) + "px"; tipEl.style.top = y + "px";
  }, 300);
});
document.addEventListener("mouseout", e => { if (tipFor && !tipFor.contains(e.relatedTarget)) hideTip(); });
for (const ev of ["mousedown", "keydown", "wheel"]) document.addEventListener(ev, hideTip, true);
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (k === "class") e.className = v; else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}
function toast(msg, warn = false) {
  const t = $("toast"); t.textContent = msg; t.classList.toggle("warn", warn); t.style.opacity = 1;
  clearTimeout(t._h); t._h = setTimeout(() => (t.style.opacity = 0), warn ? 8000 : 3500);
}
const fmtMB = x => (x >= 1000 ? (x / 1000).toFixed(2) + " GB" : (x >= 100 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(2)) + " MB");

// ---- the token: serve.py prints a link carrying it; it is kept here, and serve.py keeps the same one (v6.2) ------
const TK = "aptvis.dmtoken";
const m0 = location.hash.match(/token=([\w-]+)/);
if (m0) { localStorage.setItem(TK, m0[1]); history.replaceState(null, "", location.pathname); }
const token = () => localStorage.getItem(TK) || "";
function tokenBox() {
  const box = $("tokenbox");
  if (token()) { box.replaceChildren(h("span", { class: "dim", title: "changes need the token serve.py printed; this browser keeps it" }, "token ✓")); return; }
  const inp = h("input", { type: "text", size: 26, placeholder: "token from serve.py's terminal" });
  box.replaceChildren(h("span", { class: "warn", title: "other users of the server can reach serve.py: the token shows a change comes from you" },
    "changes need the token (once): "), inp,
    h("button", { onclick: () => { if (inp.value.trim()) { localStorage.setItem(TK, inp.value.trim()); tokenBox(); } } }, "use"));
}
async function post(what, body) {
  if (!token()) { toast("paste the token from serve.py's terminal first (top right) — needed once", true); return { ok: false, error: "no token" }; }
  const r = await fetch(`../api/dm/${what}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Token": token() }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (r.status === 403) { localStorage.removeItem(TK); tokenBox(); }
  return j;
}

// ---- state ------------------------------------------------------------------------------------------------------
let ST = null, JOBS = [];
const selected = new Set();
const COLS = "aptvis.dm.cols";                                         // {order: [...], hidden: [...]} per browser
const colPrefs = () => { try { return JSON.parse(localStorage.getItem(COLS)) || {}; } catch { return {}; } };
const saveCols = p => localStorage.setItem(COLS, JSON.stringify(p));
const STATE_CLASS = { "up to date": "s-up", "made before the data manager (kept)": "s-kept", "out of date (method changed)": "s-out",
  "raw field": "s-raw", "raw field (copied from the dumps)": "s-raw", "derived data (stored only)": "s-derived" };

// v11.4 (human 2026-11-12: "on the all datasets list pick multiple to do things like archive or delete"; "can it also
// show how many desktops that dataset is used in"): datasets ticked in the list (SEL) take the same actions at once;
// USED: dataset -> the saved desktops (views/desktops) that use it (a panel's or line's dataset, a dataset variable)
const SEL = new Set();
let USED = null, OPEN_USES = new Set();
async function loadUsage() {
  const used = new Map(), add = (n, d) => { if (!used.has(n)) used.set(n, new Set()); used.get(n).add(d); };
  const scan = (obj, add1) => {
    const walk = o => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k === "run" && typeof v === "string" && !v.startsWith("$")) add1(v); walk(v); }
    };
    walk(obj);
    for (const v of Object.values(obj?.vars || {})) if (v?.type === "dataset") for (const r of [].concat(v.value ?? [])) if (typeof r === "string") add1(r);
  };
  try {
    const r = await fetch("../api/views", { cache: "no-store" }), j = r.ok ? await r.json() : {};
    await Promise.all((j.desktops || []).map(async x => {
      try { const o = await (await fetch(`../views/desktops/${encodeURIComponent(x.name)}.json`, { cache: "no-store" })).json(); scan(o, n => add(n, x.name)); }
      catch { /* unreadable desktop: not counted */ }
    }));
  } catch { /* no serve.py views: counts unknown */ }
  OPEN_USES = new Set();
  try { const s = localStorage.getItem("aptvis.v5.state"); if (s) scan(JSON.parse(s), n => OPEN_USES.add(n)); } catch { /* none */ }
  USED = new Map([...used].map(([k, v]) => [k, [...v].sort()]));
  renderTree();
}
const usedText = n => {
  const u = USED?.get(n) || [];
  return (u.length ? `used in ${u.length} saved desktop${u.length > 1 ? "s" : ""}: ${u.join(", ")}` : USED ? "in no saved desktop" : "")
    + (OPEN_USES.has(n) ? `${u.length || USED ? "; " : ""}also in the desktop open in this browser` : "");
};
async function load() {
  $("info").textContent = "reading…";
  try {
    const r = await fetch("../api/dm/status", { cache: "no-store" }), j = await r.json();
    if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    ST = j;
    projectWords();
    const mb = j.rows.reduce((a, x) => a + x.MB, 0);
    $("info").textContent = `${j.methods.length} methods · ${j.datasets.length} datasets · ${fmtMB(mb)} stored · ${j.store}`;
    for (const n of [...SEL]) if (!j.datasets.some(d => d.name === n)) SEL.delete(n);   // (removed meanwhile)
    render();
    loadUsage();
  } catch (e) {
    $("info").textContent = "";
    $("grid").replaceChildren(h("div", { class: "warn" }, `Could not read the data manager: ${e.message}. It needs the newer serve.py (restart it) and the datamgr package.`));
  }
}
function render() { renderTree(); renderMain(); renderMethods(); renderYaxes(); renderErrors(); renderSelBar(); focusFromHash(); }
// v8.1 tabs (UI review §4.5): Data (the grid: the place to compute) · Methods · y-axis groups
function showTab(t) {
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.tab === t);
  for (const s of ["data", "methods", "yaxes"]) $(`tab-${s}`).hidden = s !== t;
  localStorage.setItem("dm.tab", t);
}
document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
showTab(localStorage.getItem("dm.tab") || "data");
/** v8.1 (UI review §4.5): the viewer's "not cached" links open this page on the cell (#focus=quantity|dataset). */
let focused = null;
function focusFromHash() {
  const m = /focus=([^|]+)\|(.+)$/.exec(location.hash);
  if (!m || focused === location.hash) return;
  focused = location.hash;
  const q = decodeURIComponent(m[1]), run = decodeURIComponent(m[2]);
  if (VIEW.kind !== "all") setView({ kind: "all" });                 // (v8.24: the cell is in the whole grid)
  const td = [...document.querySelectorAll("td.cell")].find(t => t.dataset.q === q && t.dataset.run === run);
  showTab("data");
  if (!td) return toast(`${q} × ${run} is not in the grid (is the dataset column hidden, or the method missing?)`, true);
  td.scrollIntoView({ block: "center", inline: "center" });
  td.classList.add("flash");
  setTimeout(() => { const b = td.getBoundingClientRect(); cellMenu({ pageX: b.left + scrollX, pageY: b.bottom + scrollY }, q, run, rowsModel().by.get(`${q}|${run}`) || null); }, 350);
}

// ---- model -------------------------------------------------------------------------------------------------------
function columns() {
  const p = colPrefs(), names = ST.datasets.map(d => d.name);
  const order = [...(p.order || []).filter(n => names.includes(n)), ...names.filter(n => !(p.order || []).includes(n))];
  return { order, shown: order.filter(n => !(p.hidden || []).includes(n)), hidden: order.filter(n => (p.hidden || []).includes(n)) };
}
function setCols(fn) { const p = colPrefs(); fn(p); saveCols(p); renderTree(); renderMain(); }
const dsInfo = n => ST.datasets.find(d => d.name === n) || { name: n };
/** What a dataset is (v8.19, human 2026-11-03: "when I hover over dataset it says whats what"): its card's line from the
 *  project's about file (`python -m datamgr about`) and its page (free text or a link; the word before it is the
 *  project's page.about_label, e.g. "wiki"). */
const PAGE = () => ST?.project?.page || {};
const aboutLabel = () => PAGE().about_label || "page";
const aboutText = n => { const d = dsInfo(n); return [d.about ? `${n}: ${d.about}` : n, d.page ? `${aboutLabel()}: ${d.page.replace(/^projects\//, "")}` : ""].filter(Boolean).join("\n"); };
function rowsModel() {
  const by = new Map(ST.rows.map(r => [`${r.quantity}|${r.run}`, r])), meth = new Map(ST.methods.map(x => [x.name, x]));
  const names = [...new Set([...ST.methods.map(x => x.name), ...ST.rows.map(r => r.quantity)])];
  const isRaw = n => !meth.has(n) && ST.rows.some(r => r.quantity === n && r.raw);
  const groupOf = n => ST.groups.of[n] || meth.get(n)?.group || (isRaw(n) ? "raw fields" : "no method (stored only)");
  const order = [...ST.groups.order];
  for (const n of names) if (!order.includes(groupOf(n))) order.push(groupOf(n));
  const label = n => ST.groups.labels?.[n] || meth.get(n)?.label || ST.rows.find(r => r.quantity === n)?.label || n;
  names.sort((a, b) => (order.indexOf(groupOf(a)) - order.indexOf(groupOf(b))) || label(a).localeCompare(label(b)));
  return { by, meth, names, groupOf, order: order.filter(g => names.some(n => groupOf(n) === g)), label, isRaw };
}
const computable = n => ST.methods.some(x => x.name === n) || ST.rows.some(r => r.quantity === n && r.raw);
// v11.5 (human 2026-11-12: "make folders a view for the grid and the methods tab so everything is much cleaner"): one
// folder (a cache preset) at a time shows only its quantities, in the grid and on the Methods tab; "all" shows every one.
const FOLDER_KEY = "dm.folder";
const folderNow = () => { const f = localStorage.getItem(FOLDER_KEY) || ""; return ST?.groups?.presets?.[f] ? f : ""; };
/** Is quantity n in the folder shown? (A folder naming a family holds its members.) */
function inFolder(n) {
  const f = folderNow();
  if (!f) return true;
  const qs = ST.groups.presets[f], fam = ST.methods.find(x => x.name === n)?.family;
  return qs.includes(n) || (fam && qs.includes(fam));
}
function folderBar(axes = false) {
  const ps = Object.keys(ST.groups?.presets || {}), cur = folderNow();
  const set = f => { localStorage.setItem(FOLDER_KEY, f); renderMain(); renderMethods(); };   // (the grid or a dataset's page)
  // v11.6: and on the grid, chips for what the quantities are over (their axes)
  const M = axes ? rowsModel() : null, axs = axes ? [...new Set(M.names.filter(rowLive).map(axesOf))].sort((a, b) => axRank(a) - axRank(b)) : [], aNow = axesNow();
  const setA = a => { localStorage.setItem(AXES_KEY, a); renderMain(); };
  if (!ps.length && !axs.length) return "";
  return h("div", { class: "folderbar" },
    ps.length ? [h("span", { class: "dim", title: "show only one folder's quantities (folders: the cache presets)" }, "folder:"),
      h("button", { class: "small" + (cur ? "" : " on"), onclick: () => set("") }, "all"),
      ps.map(p => h("button", { class: "small" + (cur === p ? " on" : ""), title: ST.groups.presets[p].join(", "), onclick: () => set(cur === p ? "" : p) }, p))] : null,
    axs.length > 1 ? [h("span", { class: "dim", style: "margin-left:12px", title: "show only quantities over these axes (what they can be drawn against)" }, "axes:"),
      h("button", { class: "small" + (aNow ? "" : " on"), onclick: () => setA("") }, "all"),
      axs.map(a => h("button", { class: "small" + (aNow === a ? " on" : ""), onclick: () => setA(aNow === a ? "" : a) }, a))] : null);
}
const simRuns = () => ST.datasets.filter(d => d.kind !== "derived").map(d => d.name);

// ---- drag and drop -----------------------------------------------------------------------------------------------
const DT = { col: "application/x-dm-col", rows: "application/x-dm-rows", group: "application/x-dm-group", ds: "application/x-dm-ds", dsgroup: "application/x-dm-dsgroup" };
let dragging = null;                                              // {type, value}: dataTransfer can't be read on dragover
function dragStart(e, type, value) {
  dragging = { type, value };
  e.dataTransfer.setData(DT[type], JSON.stringify(value));
  e.dataTransfer.effectAllowed = "move";
  document.body.classList.add("dragging-" + type);
}
function dragEnd() { dragging = null; document.body.className = document.body.className.replace(/\bdragging-\w+/g, "").trim(); clearMarks(); }
document.addEventListener("dragend", dragEnd);
function clearMarks() { for (const el of document.querySelectorAll(".drop-before,.drop-after,.dropin")) el.classList.remove("drop-before", "drop-after", "dropin"); }
function dropZone(el, accepts, onOver, onDrop) {
  el.addEventListener("dragover", e => { if (!dragging || !accepts.includes(dragging.type)) return; e.preventDefault(); clearMarks(); onOver(e, el); });
  el.addEventListener("dragleave", () => el.classList.remove("drop-before", "drop-after", "dropin"));
  el.addEventListener("drop", e => { if (!dragging || !accepts.includes(dragging.type)) return; e.preventDefault(); const d = dragging; dragEnd(); onDrop(e, el, d); });
}
const half = (e, el, horizontal) => { const r = el.getBoundingClientRect(); return horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2; };
async function moveRows(names, group) {
  const j = await post("group", { action: "set", names, group });
  toast(j.ok ? `${names.length > 1 ? names.length + " quantities" : names[0]} → "${group}"` : `could not: ${j.error}`, !j.ok);
  if (j.ok) { selected.clear(); load(); }
}

// ---- the grid ---------------------------------------------------------------------------------------------------
// v11.6 (human 2026-11-12: "for the data tab I want the sections to not show TYPE anymore but show the groups", the
// folders; "there may be a better way to show TYPE"): the grid's sections are the folders, then "not in a folder"; a
// quantity in two folders is listed in both ("also in"). What a quantity is over is a badge read from its axes (θ·r,
// r_max, r_max·s, θ_foot, r_out, time only, z): the axes decide what it can be drawn against. Rows are sorted by it, and
// chips filter by it. Dropping rows on a folder heading adds them to that folder; on "not in a folder", takes them out of
// every folder. (The old type groups — maps, Data OF field line, … — still order the visualizer's menus: a row's ⋯.)
// 2026-11-20 (the framework split): the badge words, their order and colours come from the project (status JSON:
// project.page.axis_badges / badge_order / badge_colors); without them, an axis is named by its catalogue label
// (status JSON "axes") and coloured from a fixed palette in the order badges are first seen.
const AX_NICE = () => PAGE().axis_badges || Object.fromEntries(Object.entries(ST?.axes || {}).map(([k, a]) => [k, a.label || k]));
const AX_ORDER = () => PAGE().badge_order || [];
const AX_PALETTE = ["#2f6fd0", "#2a8a4a", "#7a4bc0", "#1a8a8a", "#c06a10", "#9a7bc0", "#8a5a3a", "#b03060"];
const axSeen = [];
function axColor(a) {
  const c = PAGE().badge_colors;
  if (c) return c[a];
  if (a === "time only") return "#777";
  if (!axSeen.includes(a)) axSeen.push(a);
  return AX_PALETTE[axSeen.indexOf(a) % AX_PALETTE.length];
}
function axesOf(n) {
  const r = ST.rows.find(x => x.quantity === n), m = ST.methods.find(x => x.name === n);
  const dims = r ? r.dims : m ? (m.axes[0] === "time" ? m.axes : ["time", ...m.axes]) : [];
  const nice = AX_NICE(), sp = dims.filter(d => d !== "time"), t = sp.map(d => nice[d] || d).join("·");
  return !sp.length ? (dims.includes("time") ? "time only" : "one number") : dims.includes("time") ? t : `${t}, no time`;
}
const axRank = a => { const i = AX_ORDER().indexOf(a); return i < 0 ? 99 : i; };
/** A row worth listing: it can be computed, or a dataset that is not archived stores it (the old s/s_max set lives only
 *  in an archived dataset: it leaves the grid with it). */
const rowLive = n => computable(n) && ST.methods.some(x => x.name === n) || ST.rows.some(r => r.quantity === n && !dsInfo(r.run).archived);
const axBadge = a => h("span", { class: "axb", style: `color:${axColor(a) || "#666"};border-color:${axColor(a) || "#bbb"}`,
  title: a === "time only" ? "one number per output" : `over ${a}${a.includes("no time") ? "" : " at every output"}: what it can be drawn against` }, a);
const AXES_KEY = "dm.axes";
const axesNow = () => localStorage.getItem(AXES_KEY) || "";
const famOfQ = n => ST.methods.find(x => x.name === n)?.family;
const inPreset = (n, qs) => qs.includes(n) || (!!famOfQ(n) && qs.includes(famOfQ(n)));
const foldersOf = n => Object.entries(ST.groups?.presets || {}).filter(([, qs]) => inPreset(n, qs)).map(([f]) => f);
async function setFolder(f, names) { const j = await post("meta", { action: "preset", preset: f, names }); if (!j.ok) toast(j.error, true); return j.ok; }
async function addToFolder(f, names) {
  if (await setFolder(f, [...new Set([...(ST.groups.presets[f] || []), ...names])])) {
    toast(`${names.length > 1 ? names.length + " quantities" : names[0]} → folder "${f}"`); selected.clear(); load();
  }
}
async function outOfFolders(names, only = null) {
  const ps = Object.entries(ST.groups?.presets || {}).filter(([f]) => !only || f === only);
  const next = ps.map(([f, qs]) => [f, qs.filter(q => !names.some(n => n === q || famOfQ(n) === q))]).filter(([, qs], i) => qs.length !== ps[i][1].length);
  if (!next.length) return;
  const emptied = next.filter(([, qs]) => !qs.length).map(([f]) => f);
  if (emptied.length && !confirm(`That empties the folder${emptied.length > 1 ? "s" : ""} ${emptied.join(", ")}, which then goes away. Go on?`)) return;
  for (const [f, qs] of next) await setFolder(f, qs);
  toast(`${names.length > 1 ? names.length + " quantities" : names[0]} out of ${only ? `"${only}"` : "every folder"}`); selected.clear(); load();
}
function renderGrid() {
  // v8.24: a dataset group's grid shows only its datasets, and only quantities one of them has (unless asked)
  const G = gridColumns(), { shown, hidden } = G, M = rowsModel(), body = [], allRows = localStorage.getItem(ALLROWS) === "1";
  const presets = Object.entries(ST.groups?.presets || {}), byFolder = presets.length > 0, fNow = folderNow(), aNow = axesNow();
  const keep = n => rowLive(n) && (!G.group || allRows || shown.some(r => M.by.has(`${n}|${r}`))) && (!aNow || axesOf(n) === aNow);
  const order = (a, b) => axRank(axesOf(a)) - axRank(axesOf(b)) || M.label(a).localeCompare(M.label(b));
  const sections = byFolder                                  // [title, quantities, folder | null]
    ? [...presets.filter(([f]) => !fNow || f === fNow).map(([f, qs]) => [f, M.names.filter(n => inPreset(n, qs)), f]),
       ...(fNow ? [] : [["not in a folder", M.names.filter(n => !foldersOf(n).length), null]])]
    : M.order.map(g => [g, M.names.filter(n => M.groupOf(n) === g), null]);
  for (const [title, all, folder] of sections) {
    const inG = all.filter(keep).sort(order);
    if (!inG.length && (G.group || fNow || aNow || !folder)) continue;
    const head = h("tr", { class: "sec" }, h("td", { colspan: shown.length + 2 },
      h("span", { class: "grp", title: folder ? `folder: ${(ST.groups.presets[folder] || []).join(", ")}` : "" }, title), h("span", { class: "dim" }, ` · ${inG.length}`),
      byFolder ? h("span", { class: "dim hint" }, folder ? "drop quantities here to add them to this folder" : "drop quantities here to take them out of every folder") : null));
    if (byFolder) dropZone(head, ["rows"], (e, el) => el.classList.add("dropin"), (e, el, d) => (folder ? addToFolder(folder, d.value) : outOfFolders(d.value)));
    body.push(head);
    for (const n of inG) {
      const rowMB = ST.rows.filter(r => r.quantity === n).reduce((a, r) => a + r.MB, 0), also = folder ? foldersOf(n).filter(f => f !== folder) : [];
      const rowhead = h("td", { class: "rowhead", oncontextmenu: e => { e.preventDefault(); rowMenu(e, n); } },
        h("span", { class: "handle", title: "drag onto a folder heading to add it there (all ticked rows if this one is ticked)" }, "⠿"),
        axBadge(axesOf(n)),
        h("span", { class: "name", title: "click to rename (only the shown name changes)", onclick: e => renameLabel(e, n) }, M.label(n)),
        h("button", { class: "more", title: "actions: folders, menu section, …", onclick: e => rowMenu(e, n) }, "⋯"),
        h("div", { class: "dim" }, `${n}${M.isRaw(n) ? " · raw field" : ""}${rowMB ? " · " + fmtMB(rowMB) : ""}${also.length ? ` · also in: ${also.join(", ")}` : ""}`));
      const tr = h("tr", { class: selected.has(n) ? "selrow" : null },
        h("td", { class: "pick" }, h("input", { type: "checkbox", checked: selected.has(n) || null, onchange: e => { e.target.checked ? selected.add(n) : selected.delete(n); renderGrid(); renderSelBar(); } })),
        rowhead,
        shown.map(run => {
          const r = M.by.get(`${n}|${run}`);
          if (!r) return h("td", { class: "cell s-none", "data-q": n, "data-run": run, onclick: e => cellMenu(e, n, run, null), title: "not stored" }, computable(n) ? "—" : "");
          const full = r.outputs && r.layout !== "static" ? `${r.steps}/${r.outputs}` : `${r.steps}`;
          return h("td", { class: `cell ${STATE_CLASS[r.state] || "s-other"}`, "data-q": n, "data-run": run, onclick: e => cellMenu(e, n, run, r), title: `${r.state} · ${r.layout} · ${r.dims.join(" × ")}\n${healthText(r)}` },
            full, h("div", { class: "dim" }, fmtMB(r.MB)));
        }));
      rowhead.draggable = true;
      rowhead.addEventListener("dragstart", e => dragStart(e, "rows", selected.has(n) ? [...selected] : [n]));
      if (folder) dropZone(tr, ["rows"], (e, el) => el.classList.add("dropin"), (e, el, d) => !d.value.every(v => inPreset(v, ST.groups.presets[folder] || [])) && addToFolder(folder, d.value));
      body.push(tr);
    }
  }
  const newGroup = h("tr", { class: "newgroup" }, h("td", { colspan: shown.length + 2 }, byFolder ? "＋ drop quantities here to make a new folder" : "＋ drop quantities here to put them in a new group"));
  dropZone(newGroup, ["rows"], (e, el) => el.classList.add("dropin"), (e, el, d) => {
    renameBox(e, "", byFolder ? "name of the new folder" : "name of the new group", async v => { if (!byFolder) return moveRows(d.value, v); if (await setFolder(v, d.value)) { selected.clear(); load(); } });
  });
  body.push(newGroup);

  const ths = shown.map(n => {
    const d = dsInfo(n), mb = ST.rows.filter(r => r.run === n).reduce((a, r) => a + r.MB, 0);
    const th = h("th", { class: "colhead", title: `${aboutText(n)}\n\n${d.kind || ""} · ${d.path || d.note || ""}\ndrag to reorder · click the name to rename · ⋯ / right-click: actions`,
      oncontextmenu: e => { e.preventDefault(); colMenu(e, n); } },
      h("span", { class: "name", onclick: e => renameDataset(e, n) }, n), h("button", { class: "more", title: "actions", onclick: e => colMenu(e, n) }, "⋯"),
      h("div", { class: "dim" }, `${d.kind === "derived" ? "derived" : (d.outputs ?? "?") + " outputs"} · ${fmtMB(mb)}`),
      (d.tags || []).length || d.follow ? h("div", {}, (d.tags || []).map(t => h("span", { class: "tagchip" }, t)),
        d.follow ? h("span", { class: "follow", title: `new outputs are computed automatically: ${d.follow === "stored" ? "everything stored for it" : d.follow.join(", ")}` }, "↻ follow") : null) : null);
    th.draggable = true;
    th.addEventListener("dragstart", e => dragStart(e, "col", n));
    dropZone(th, ["col"], (e, el) => el.classList.add(half(e, el, true) ? "drop-after" : "drop-before"), (e, el, dd) => {
      if (dd.value === n) return;
      const after = half(e, el, true);
      setCols(p => { const o = columns().order.filter(x => x !== dd.value); o.splice(o.indexOf(n) + (after ? 1 : 0), 0, dd.value); p.order = o; });
    });
    return th;
  });
  const vis = M.names.filter(inFolder);                  // (v11.5: the folder shown)
  const head = h("tr", {}, h("th", { class: "pick" }, h("input", { type: "checkbox", title: "select every row shown", checked: (vis.length && vis.every(n => selected.has(n))) || null,
      onchange: e => { vis.forEach(n => e.target.checked ? selected.add(n) : selected.delete(n)); renderGrid(); renderSelBar(); } })),
    h("th", { class: "corner" }, "quantity ", h("button", { class: "small", onclick: e => addDatasetForm(e), title: "add a dataset (a column) from a folder" }, "+ dataset"),
      // v6.3 (human 2026-10-13: "the total storage cost in the top left box")
      h("div", { class: "total", title: "everything stored for the visualizer: every dataset, hidden columns included" },
        `total ${fmtMB(ST.rows.reduce((a, r) => a + r.MB, 0))}`)), ths);
  $("grid").replaceChildren(folderBar(true),
    G.group ? h("div", { class: "gridhead" }, h("b", {}, G.group), h("span", { class: "dim" }, ` · ${shown.length} dataset${shown.length === 1 ? "" : "s"} · quantities none of them has are left out `),
      h("label", { class: "chk", title: "show every quantity, to compute one for these datasets" }, h("input", { type: "checkbox", checked: allRows || null,
        onchange: e => { localStorage.setItem(ALLROWS, e.target.checked ? "1" : "0"); renderGrid(); } }), " show them"),
      h("button", { class: "small", onclick: e => cacheForm(e, shown.filter(n => dsInfo(n).kind !== "derived"), `the datasets of ${G.group}`) }, "cache for all of them…")) : "",
    hidden.length ? h("div", { class: "hiddenbar" }, "hidden datasets: ", hidden.map(n => h("button", { class: "small", title: "show it again", onclick: () => setCols(p => { p.hidden = (p.hidden || []).filter(x => x !== n); }) }, n))) : "",
    h("table", {}, h("thead", {}, head), h("tbody", {}, body)));
}

// ---- dataset groups (v8.24, human 2026-11-09: "I like the collapsible dataset groups"; "there may be some particular
// datas that I cache for one dataset and not for others so I think the current dataviewer of the grid isn't the best
// way of doing that"; "my main gripe isn't slowness its managing things"). Left: a tree of dataset groups (fold them;
// drag datasets onto a group, group headings to reorder). A group opens the grid of just its datasets, quantities none
// of them has hidden; a dataset opens its own page (only what it has); archived datasets sit in their own section and
// leave the visualizer's menus. Groups are only how datasets are listed: nothing is recomputed. ---------------------
const VIEW_KEY = "aptvis.dm.view", FOLD_KEY = "aptvis.dm.folded", ALLROWS = "aptvis.dm.allrows";
let VIEW = (() => { try { return JSON.parse(localStorage.getItem(VIEW_KEY)) || { kind: "all" }; } catch { return { kind: "all" }; } })();
function setView(v) { VIEW = v; localStorage.setItem(VIEW_KEY, JSON.stringify(v)); closePop(); renderTree(); renderMain(); }
const folded = () => { try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '["__archived"]')); } catch { return new Set(["__archived"]); } };
function toggleFold(key) { const f = folded(); if (f.has(key)) f.delete(key); else f.add(key); localStorage.setItem(FOLD_KEY, JSON.stringify([...f])); renderTree(); }
const groupKey = g => g || "__none";
/** {groups: [[group, [datasets]]] in the saved order ("" = no group, last), archived: [datasets]}. */
function dsGroups() {
  const order = ST.dataset_groups || [], by = new Map(), archived = [];
  for (const d of ST.datasets) {
    if (d.archived) { archived.push(d.name); continue; }
    const g = d.group || "";
    if (!by.has(g)) by.set(g, []);
    by.get(g).push(d.name);
  }
  const at = g => (g === "" ? 1e9 : order.includes(g) ? order.indexOf(g) : 1e6);
  return { groups: [...by.keys()].sort((a, b) => at(a) - at(b) || a.localeCompare(b)).map(g => [g, by.get(g)]), archived };
}
const mbOf = n => ST.rows.filter(r => r.run === n).reduce((a, r) => a + r.MB, 0);
function renderTree() {
  if (!ST) return;
  const { groups, archived } = dsGroups(), f = folded(), ord = columns().order;
  const sorted = ns => [...ns].sort((a, b) => ord.indexOf(a) - ord.indexOf(b));
  const item = n => {
    const d = dsInfo(n), u = USED?.get(n)?.length || 0, ut = usedText(n);
    const it = h("div", { class: "td" + (VIEW.kind === "dataset" && VIEW.name === n ? " on" : "") + (SEL.has(n) ? " sel" : ""),
      title: `${aboutText(n)}${ut ? "\n" + ut : ""}\n\nclick: its page · tick: select several (actions below the list) · drag onto a group to move it (ticked ones move together) · right-click: actions`,
      onclick: () => setView({ kind: "dataset", name: n }), oncontextmenu: e => { e.preventDefault(); colMenu(e, n); } },
      h("input", { type: "checkbox", class: "tsel", checked: SEL.has(n) || null, title: "select (several: actions below the list)",
        onclick: e => e.stopPropagation(), onchange: e => { if (e.target.checked) SEL.add(n); else SEL.delete(n); renderTree(); } }),
      h("span", {}, n), d.follow ? h("span", { class: "follow", title: "following: new outputs are computed automatically" }, " ↻") : null,
      h("span", { class: "dim" }, ` ${fmtMB(mbOf(n))}`),
      u || OPEN_USES.has(n) ? h("span", { class: "dim uses", title: ut }, ` · ${u ? `${u} desktop${u > 1 ? "s" : ""}` : "open desktop"}`) : null);
    it.draggable = true;
    it.addEventListener("dragstart", e => dragStart(e, "ds", SEL.has(n) ? [...SEL] : [n]));
    return it;
  };
  const head = (g, ns, key, label) => {
    const open = !f.has(key);
    const hd = h("div", { class: "tg" + (VIEW.kind === "group" && VIEW.name === key ? " on" : "") },
      h("span", { class: "fold", title: open ? "fold" : "unfold", onclick: () => toggleFold(key) }, open ? "▾" : "▸"),
      h("span", { class: "gname", title: "click: the grid of just these datasets", onclick: () => setView({ kind: "group", name: key }) }, label),
      h("span", { class: "dim" }, ` ${ns.length}`),
      h("button", { class: "more", title: "group actions", onclick: e => groupMenu(e, g, ns, key) }, "⋯"));
    dropZone(hd, ["ds", "dsgroup"], (e, el) => el.classList.add(dragging.type === "ds" ? "dropin" : half(e, el) ? "drop-after" : "drop-before"), async (e, el, dd) => {
      if (dd.type === "ds") return key === "__archived" ? archive(dd.value, true) : moveDatasets(dd.value, g);
      if (dd.value === g || !g) return;
      const order = (ST.dataset_groups || []).filter(x => x !== dd.value), at = order.indexOf(g) + (half(e, el) ? 1 : 0);
      const j = await post("datasets", { action: "move-group", group: dd.value, index: Math.max(0, at) });
      if (j.ok) load(); else toast(j.error, true);
    });
    if (g) { hd.draggable = true; hd.addEventListener("dragstart", e => dragStart(e, "dsgroup", g)); }
    return [hd, open ? h("div", { class: "tkids" }, sorted(ns).map(item)) : null];
  };
  $("dstree").replaceChildren(h("div", { class: "tree" },
    h("div", { class: "tg all" + (VIEW.kind === "all" ? " on" : ""), title: "the grid of every dataset (archived and hidden ones left out)", onclick: () => setView({ kind: "all" }) },
      h("span", { class: "gname" }, "all datasets"), h("span", { class: "dim" }, ` ${ST.datasets.length - archived.length}`)),
    groups.map(([g, ns]) => head(g, ns, groupKey(g), g || (groups.length > 1 ? "no group" : "datasets"))),
    archived.length ? head("", archived, "__archived", "archived") : null,
    tagBlock(f, item, sorted),                                              // v11.8
    SEL.size ? selBar() : null,
    h("div", { class: "tfoot" },
      h("button", { class: "small", title: "a new group: name it and tick its datasets", onclick: e => newGroupForm(e) }, "+ group"),
      h("button", { class: "small", title: `groups from the names (${PAGE().suggest_example || "names that share a first word: run-a, run-b, …"}) for the datasets in no group`, onclick: e => suggestForm(e) }, "suggest…"),
      h("button", { class: "small", title: "add a dataset from a folder", onclick: e => addDatasetForm(e) }, "+ dataset"))));
}
function renderMain() {
  if (!ST) return;
  if (VIEW.kind === "dataset" && ST.datasets.some(d => d.name === VIEW.name)) return renderDataset(VIEW.name);
  renderGrid();
}
/** The grid's columns: a group's datasets, or every dataset but the hidden and archived ones. */
function gridColumns() {
  const c = columns(), { groups, archived } = dsGroups();
  if (VIEW.kind === "tag") {                                               // v11.8: the datasets with this tag
    const ns = taggedWith(VIEW.name);
    return { shown: c.order.filter(n => ns.includes(n)), hidden: [], group: "#" + VIEW.name };
  }
  if (VIEW.kind === "group") {
    const ns = VIEW.name === "__archived" ? archived : groups.find(([g]) => groupKey(g) === VIEW.name)?.[1];
    if (ns) return { shown: c.order.filter(n => ns.includes(n)), hidden: [], group: VIEW.name === "__archived" ? "archived" : VIEW.name === "__none" ? "no group" : VIEW.name };
  }
  return { shown: c.shown.filter(n => !archived.includes(n)), hidden: c.hidden.filter(n => !archived.includes(n)), group: null };
}
// v11.8 (human 2026-11-12: "a secondary folder setup that doesn't really affect much else but that I can link datasets
// that have similar phenomena"): tags — any number per dataset (its card), across the groups. The list shows each tag
// with its datasets (unfolded on demand); a tag's grid is its datasets; the ticked datasets can be tagged together; the
// visualizer's dataset lists can follow a tag ("#tag": every dataset with it, now and later).
const tagsOf = n => dsInfo(n).tags || [];
const allTagsDM = () => [...new Set(ST.datasets.filter(d => !d.archived).flatMap(d => d.tags || []))].sort();
const taggedWith = t => ST.datasets.filter(d => !d.archived && (d.tags || []).includes(t)).map(d => d.name);
function tagBlock(f, item, sorted) {
  const ts = allTagsDM();
  if (!ts.length) return null;
  return [h("div", { class: "tg tagshead", title: "tags: a second way to group datasets (by what they show), across the groups — set on a dataset's card, or tick datasets → tag…" },
      h("span", { class: "gname" }, "tags"), h("span", { class: "dim" }, ` ${ts.length}`)),
    ts.map(t => {
      const key = "+#" + t, open = f.has(key), ns = taggedWith(t);        // (folded unless opened)
      return [h("div", { class: "tg" + (VIEW.kind === "tag" && VIEW.name === t ? " on" : "") },
          h("span", { class: "fold", title: open ? "fold" : "show its datasets", onclick: () => toggleFold(key) }, open ? "▾" : "▸"),
          h("span", { class: "gname", title: "click: the grid of just these datasets", onclick: () => setView({ kind: "tag", name: t }) }, "#" + t),
          h("span", { class: "dim" }, ` ${ns.length}`)),
        open ? h("div", { class: "tkids" }, sorted(ns).map(item)) : null];
    })];
}
/** Tag / untag the datasets `ns` (their cards; notes kept). */
function tagForm(e, ns) {
  const ts = allTagsDM(), add = new Set(), drop = new Set();
  const inp = h("input", { type: "text", size: 22, placeholder: "new tag, e.g. cycles" });
  const row = t => {
    const have = ns.filter(n => tagsOf(n).includes(t)).length, cb = h("input", { type: "checkbox", checked: have === ns.length || null });
    cb.indeterminate = have > 0 && have < ns.length;
    cb.addEventListener("change", () => { add.delete(t); drop.delete(t); (cb.checked ? add : drop).add(t); });
    return h("label", { title: `${have} of the ${ns.length} have it` }, cb, " #" + t);
  };
  pop(e, [h("b", {}, `tags of ${ns.length > 1 ? ns.length + " datasets" : ns[0]}`), h("div", { class: "runs col" }, ts.map(row)),
    h("div", { class: "row" }, "new", inp),
    h("div", { class: "row" }, h("button", { class: "on", onclick: async () => {
      const nt = inp.value.trim().replace(/^#/, "");
      if (nt) { if (/[,\n]/.test(nt) || nt.length > 30) return toast("a tag: one word or phrase, no commas, at most 30 characters", true); add.add(nt); }
      if (!add.size && !drop.size) return closePop();
      closePop();
      const bad = [];
      for (const n of ns) {
        const cur = tagsOf(n), next = [...cur.filter(t => !drop.has(t)), ...[...add].filter(t => !cur.includes(t))];
        if (next.join(",") === cur.join(",")) continue;
        const j = await post("meta", { action: "card", name: n, notes: dsInfo(n).notes || "", tags: next.join(", ") });
        if (!j.ok) bad.push(`${n}: ${j.error}`);
      }
      toast(bad.length ? `could not: ${bad.join("; ")}` : "tags saved (the visualizer's lists that follow a tag pick them up on reload)", !!bad.length);
      load();
    } }, "save"), h("button", { onclick: closePop }, "cancel"))]);
  inp.focus();
}
/** v11.4: what the ticked datasets can do together. */
function selBar() {
  const ns = [...SEL].sort(), arch = ns.filter(n => dsInfo(n).archived), live = ns.filter(n => !dsInfo(n).archived);
  const mb = ns.reduce((a, n) => a + mbOf(n), 0);
  return h("div", { class: "tsel-bar" },
    h("div", { class: "dim" }, `${ns.length} selected · ${fmtMB(mb)} stored`),
    h("div", { class: "row" },
      live.length ? h("button", { class: "small", title: "stored data is kept; the visualizer's menus leave them out (un-archive any time)", onclick: () => archive(live, true) }, `archive${arch.length ? ` ${live.length}` : ""}`) : null,
      arch.length ? h("button", { class: "small", title: "back into the visualizer's menus", onclick: () => archive(arch, false) }, `un-archive${live.length ? ` ${arch.length}` : ""}`) : null,
      h("button", { class: "small", title: "put them in one group", onclick: e => pop(e, [h("b", {}, `group of the ${ns.length} selected`), groupSelect(ns, null)]) }, "group…"),
      h("button", { class: "small", title: "tags: what they show (several per dataset, across the groups)", onclick: e => tagForm(e, ns) }, "tag…"),
      h("button", { class: "small", title: "remove them from the list; their stored data is deleted (asks first)", onclick: () => removeMany(ns) }, "remove…"),
      h("button", { class: "small", onclick: () => { SEL.clear(); renderTree(); } }, "clear")));
}
async function removeMany(ns) {
  const mb = ns.reduce((a, n) => a + mbOf(n), 0), inUse = ns.filter(n => USED?.get(n)?.length || OPEN_USES.has(n));
  const msg = [`Remove ${ns.length} dataset${ns.length > 1 ? "s" : ""} from the list${mb > 0 ? ` AND delete their stored data (${fmtMB(mb)})` : ""}? This cannot be undone.`,
    ns.join(", "),
    inUse.length ? `\nStill used in desktops: ${inUse.map(n => `${n} (${usedText(n)})`).join("; ")}. Those plots would show "not cached".` : "",
    "\n(Archiving keeps the data and only takes them out of the visualizer's menus.)"].filter(Boolean).join("\n");
  if (!confirm(msg)) return;
  const bad = [];
  for (const n of ns) {
    const j = await post("datasets", { action: "remove", name: n, drop_data: ST.rows.some(r => r.run === n) });
    if (!j.ok) bad.push(`${n}: ${j.error}`); else SEL.delete(n);
  }
  toast(bad.length ? `could not remove ${bad.join("; ")}` : `removed ${ns.length} dataset${ns.length > 1 ? "s" : ""}`, !!bad.length);
  load();
}
async function moveDatasets(names, group) {
  const j = await post("datasets", { action: "group", names, group });
  if (!j.ok) return toast(`could not: ${j.error}`, true);
  const arch = names.filter(n => dsInfo(n).archived);                 // into a group = back from the archive
  if (arch.length) await post("datasets", { action: "archive", names: arch, archived: false });
  toast(`${names.length > 1 ? names.length + " datasets" : names[0]} → ${group ? `"${group}"` : "no group"}`);
  load();
}
async function archive(names, on) {
  const j = await post("datasets", { action: "archive", names, archived: on });
  toast(j.ok ? `${names.length > 1 ? names.length + " datasets" : names[0]} ${on ? "archived: stored data kept, the visualizer's menus leave it out" : "back from the archive"}` : `could not: ${j.error}`, !j.ok);
  if (j.ok) load();
}
/** A menu to put a dataset in a group (or a new one). */
function groupSelect(names, cur) {
  return h("select", { title: "its group (only how datasets are listed)", onchange: e => {
      const v = e.target.value;
      if (v === "__new") { const r = e.target.getBoundingClientRect(); return renameBox({ pageX: r.left + scrollX, pageY: r.bottom + scrollY }, "", "name of the new group", g => moveDatasets(names, g)); }
      moveDatasets(names, v);
    } },
    h("option", { value: "", selected: !cur || null }, "(no group)"),
    (ST.dataset_groups || []).map(g => h("option", { value: g, selected: cur === g || null }, g)),
    h("option", { value: "__new" }, "＋ new group…"));
}
function groupMenu(e, g, ns, key) {
  const sims = ns.filter(n => dsInfo(n).kind !== "derived"), arch = key === "__archived";
  const label = arch ? "archived" : g || "datasets in no group";
  pop(e, [h("b", {}, label), h("div", { class: "dim" }, `${ns.length} datasets · ${fmtMB(ns.reduce((a, n) => a + mbOf(n), 0))}`),
    h("button", { onclick: () => setView({ kind: "group", name: key }) }, "show their grid"),
    sims.length && !arch ? h("button", { onclick: ev => cacheForm(ev, sims, `every dataset in ${label}`) }, "cache for every dataset in it…") : null,
    g ? h("button", { onclick: ev => renameBox(ev, g, `rename group "${g}"`, async v => {
      const j = await post("datasets", { action: "rename-group", old: g, new: v });
      toast(j.ok ? `renamed to "${v}"` : j.error, !j.ok);
      if (j.ok) { if (VIEW.kind === "group" && VIEW.name === g) setView({ kind: "group", name: v }); load(); }
    }) }, "rename…") : null,
    arch ? h("button", { onclick: () => { closePop(); archive(ns, false); } }, "bring them all back")
      : h("button", { title: "stored data is kept; the visualizer's menus leave them out", onclick: () => { closePop(); archive(ns, true); } }, "archive them all"),
    g ? h("button", { title: "the datasets stay, in no group", onclick: () => { closePop(); moveDatasets(ns, ""); } }, "ungroup") : null]);
}
/** A new group: its name and the datasets in it. */
function newGroupForm(e) {
  const name = h("input", { type: "text", size: 24, placeholder: "e.g. b06 scan" }), ticks = new Set();
  const { groups } = dsGroups();
  const list = h("div", { class: "runs col" }, groups.map(([g, ns]) => [h("div", { class: "dim" }, g || "no group"),
    ns.map(n => h("label", { title: aboutText(n) }, h("input", { type: "checkbox", onchange: ev => { if (ev.target.checked) ticks.add(n); else ticks.delete(n); } }), " ", n))]));
  pop(e, [h("b", {}, "new dataset group"), h("div", { class: "row" }, "name", name), list,
    h("div", { class: "row" }, h("button", { class: "on", onclick: () => {
      const g = name.value.trim();
      if (!g) return toast("name the group", true);
      if (!ticks.size) return toast("tick its datasets (a group holds at least one)", true);
      closePop(); moveDatasets([...ticks], g);
    } }, "make it"), h("button", { onclick: closePop }, "cancel"))]);
  name.focus();
}
/** Groups suggested from the names (the data manager reads them; nothing changes until "make ticked"). */
async function suggestForm(e) {
  const box = pop(e, [h("b", {}, "suggested groups"), h("div", { class: "dim" }, "reading the names…")]);
  const j = await post("datasets", { action: "suggest" });
  if (!j.ok) return box.replaceChildren(h("b", {}, "suggested groups"), h("div", { class: "warn" }, j.error));
  const sug = Object.entries(j.groups || {});
  if (!sug.length) return box.replaceChildren(h("b", {}, "suggested groups"), h("div", { class: "dim" }, "nothing to suggest: no two datasets in no group share a first word"));
  const rows = sug.map(([g, ns]) => ({ on: h("input", { type: "checkbox", checked: true }), name: h("input", { type: "text", size: 18, value: g }), ns }));
  box.replaceChildren(h("b", {}, "suggested groups"), h("div", { class: "dim" }, "for the datasets in no group, from their names; rename before making them"),
    ...rows.map(r => h("div", { class: "row" }, r.on, r.name, h("span", { class: "dim" }, r.ns.join(", ")))),
    h("div", { class: "row" }, h("button", { class: "on", onclick: async () => {
      const pick = rows.filter(r => r.on.checked && r.name.value.trim());
      if (!pick.length) return toast("tick at least one", true);
      closePop();
      for (const r of pick) { const k = await post("datasets", { action: "group", names: r.ns, group: r.name.value.trim() }); if (!k.ok) toast(`${r.name.value}: ${k.error}`, true); }
      toast(`made ${pick.length} group${pick.length > 1 ? "s" : ""}`); load();
    } }, "make ticked"), h("button", { onclick: closePop }, "cancel")));
}
/** Cache quantities for some datasets: the methods not (fully, up to date) stored in them, by group; folders (presets)
 *  switch their quantities on and off; the ticks can be saved as a folder (v8.24, human: "Use preset" — a set cached in
 *  one click; v11.3: folders). */
function cacheForm(e, runs, what) {
  const M = rowsModel(), presets = Object.entries(ST.groups.presets || {});
  const full = (q, r) => { const x = M.by.get(`${q}|${r}`); return !!x && x.state !== "out of date (method changed)" && (x.layout === "static" || !x.outputs || x.steps >= x.outputs); };
  const cand = ST.methods.map(x => x.name).filter(q => runs.some(r => !full(q, r))), ticks = new Set();
  // v8.25: a family is one entry (its members are computed together); ticking it caches the family
  const famOf = new Map(ST.methods.filter(x => x.family).map(x => [x.name, x.family])), famInfo = f => (ST.families || []).find(x => x.name === f);
  const keys = [...new Set(cand.map(q => famOf.get(q) || q))], first = k => cand.find(q => (famOf.get(q) || q) === k);
  const box = h("div", { class: "runs col" }), count = h("span", { class: "dim" });
  // v11.3 (human 2026-11-12: "a folder containing things related to driving, another related to gaps another to duty
  // cycles … I can select which folder to cache from (if folders overlap it only caches ones of course)"): presets are
  // the folders; each switches on and off, and the ticks are the union of the folders that are on (each quantity once)
  const on = new Set(), keysOf = qs => [...new Set(qs.map(q => famOf.get(q) || q))].filter(k => keys.includes(k));
  // a folder may hold dump fields (Rho_e, pair_produced, …): not methods, so not in the list; copied when not stored
  const isMethod = new Set([...ST.methods.map(x => x.name), ...famOf.values()]);
  const rawOf = qs => qs.filter(q => !isMethod.has(q) && runs.some(r => !full(q, r)));
  let raw = new Set();
  const toggle = (p, btn) => {
    if (on.has(p)) {
      on.delete(p);
      const keep = new Set(presets.filter(([o]) => on.has(o)).flatMap(([, qs]) => keysOf(qs)));
      for (const k of keysOf(ST.groups.presets[p] || [])) if (!keep.has(k)) ticks.delete(k);
    } else {
      on.add(p);
      for (const k of keysOf(ST.groups.presets[p] || [])) ticks.add(k);
    }
    raw = new Set(presets.filter(([o]) => on.has(o)).flatMap(([, qs]) => rawOf(qs)));
    btn.classList.toggle("on", on.has(p));
    fill();
  };
  const counted = () => (count.textContent = `${ticks.size} ticked` + (raw.size ? ` + copied from the dumps: ${[...raw].join(", ")}` : ""));
  const fill = () => (counted(), box.replaceChildren(...M.order.flatMap(g => {
    const ks = keys.filter(k => M.groupOf(first(k)) === g);
    return ks.length ? [h("div", { class: "dim" }, g), ...ks.map(k => {
      const fam = famInfo(k), q = first(k);
      return h("label", { title: fam ? `family ${k}: ${fam.members.join(", ")} (computed together)` : `${k}${M.meth.get(k)?.description ? "\n" + M.meth.get(k).description : ""}` },
        h("input", { type: "checkbox", checked: ticks.has(k) || null, onchange: ev => { if (ev.target.checked) ticks.add(k); else ticks.delete(k); counted(); } }), " ",
        fam ? `${fam.label} (family of ${fam.members.length})` : M.label(k),
        h("span", { class: "dim" }, runs.length > 1 ? `  stored in ${runs.filter(r => M.by.has(`${q}|${r}`)).length} of ${runs.length}` : M.by.has(`${q}|${runs[0]}`) ? "  (partly / out of date)" : ""));
    })] : [];
  })));
  fill();
  pop(e, [h("b", {}, `cache for ${what}`),
    cand.length ? null : h("div", { class: "dim" }, "every method is stored and up to date here"),
    presets.length ? h("div", { class: "row" }, h("span", { class: "dim", title: "each folder switches its quantities on or off; a quantity in two folders is computed once" }, "folders:"),
      presets.map(([p, qs]) => {
        const left = keysOf(qs).length + rawOf(qs).length;
        const btn = h("button", { class: "small", disabled: !left || null, onclick: () => toggle(p, btn),
          title: `${qs.join(", ")}\n${left ? `${left} not stored (or not complete) here` : "all stored and up to date here"}` }, p);
        return h("span", { class: "preset" }, btn, h("button", { class: "small", title: `delete the folder "${p}"`, onclick: async () => {
          if (!confirm(`Delete the folder "${p}"? (Nothing stored changes.)`)) return;
          const j = await post("meta", { action: "preset", preset: p, names: [] }); toast(j.ok ? `folder "${p}" deleted` : j.error, !j.ok); if (j.ok) { closePop(); load(); }
        } }, "×"));
      }), count) : null,
    box,
    h("div", { class: "row" },
      h("button", { class: "on", onclick: () => { if (!ticks.size && !raw.size) return toast("tick at least one quantity", true); closePop(); startCache([...ticks, ...raw], runs, "", false); } }, "compute ticked"),
      h("button", { title: "remember the ticked quantities as a folder, for the next dataset", onclick: ev => {
        if (!ticks.size) return toast("tick the folder's quantities first", true);
        const names = [...ticks];
        renameBox(ev, "", `folder of ${names.length} quantities: its name`, async v => { const j = await post("meta", { action: "preset", preset: v, names }); toast(j.ok ? `folder "${v}" saved` : j.error, !j.ok); if (j.ok) load(); });
      } }, "save ticks as a folder…"),
      h("button", { onclick: closePop }, "cancel"))]);
}
/** A dataset's own page: what it is, what is stored for it (only that), and what to do with it. */
function renderDataset(n) {
  const d = dsInfo(n), M = rowsModel(), mine = ST.rows.filter(r => r.run === n), sim = d.kind !== "derived";
  // v11.6.2 (human 2026-11-12: "you didnt change the grid form for looking at individual dataset"): as the grid — sections
  // are the folders (then "not in a folder"; a quantity in two is in both, "also in"), the axes as a badge, rows sorted by
  // it, and the folder / axes chips filter it
  const presets = Object.entries(ST.groups?.presets || {}), fNow = folderNow(), aNow = axesNow();
  const shownR = mine.filter(r => !aNow || axesOf(r.quantity) === aNow);
  const order = (a, b) => axRank(axesOf(a.quantity)) - axRank(axesOf(b.quantity)) || M.label(a.quantity).localeCompare(M.label(b.quantity));
  const byG = (presets.length
    ? [...presets.filter(([f]) => !fNow || f === fNow).map(([f, qs]) => [f, shownR.filter(r => inPreset(r.quantity, qs)), f]),
       ...(fNow ? [] : [["not in a folder", shownR.filter(r => !foldersOf(r.quantity).length), null]])]
    : M.order.map(g => [g, shownR.filter(r => M.groupOf(r.quantity) === g), null])).filter(([, rs]) => rs.length);
  const rows = byG.flatMap(([g, rs, folder]) => [h("tr", { class: "sec" }, h("td", { colspan: 4 }, g, h("span", { class: "dim" }, ` · ${rs.length}`))),
    ...rs.sort(order).map(r => { const also = folder ? foldersOf(r.quantity).filter(f => f !== folder) : []; return h("tr", {},
      h("td", { title: `${r.quantity}\nclick the state for actions` }, M.label(r.quantity),
        h("div", { class: "dim" }, r.quantity + (also.length ? ` · also in: ${also.join(", ")}` : ""))),
      h("td", { class: `cell ${STATE_CLASS[r.state] || "s-other"}`, title: `${r.state} · ${r.layout}\n${healthText(r)}`, onclick: e => cellMenu(e, r.quantity, n, r) },
        r.layout === "static" ? "one array" : r.outputs ? `${r.steps}/${r.outputs}` : `${r.steps}`),
      h("td", { class: "nw", title: r.dims.join(" × ") }, axBadge(axesOf(r.quantity))),
      h("td", { class: "dim nw" }, fmtMB(r.MB))); })]);
  $("grid").replaceChildren(h("div", { class: "dspage" },
    h("div", { class: "dshead" }, h("span", { class: "dsname name", title: "click to rename", onclick: e => renameDataset(e, n) }, n), groupSelect([n], d.group || ""),
      d.archived ? h("span", { class: "tagchip" }, "archived") : null, d.follow ? h("span", { class: "follow" }, "↻ following") : null,
      (d.tags || []).map(t => h("span", { class: "tagchip" }, t))),
    aboutDiv(n, true),
    h("div", { class: "dim" }, `${d.kind} · ${d.path || d.note || ""}${d.outputs != null ? ` · ${d.outputs} outputs` : ""} · ${mine.length} quantities · ${fmtMB(mbOf(n))}`),
    h("div", { class: "row dsbtns" },
      sim ? h("button", { class: "on", title: "the quantities not stored (or not complete) here; presets", onclick: e => cacheForm(e, [n], n) }, "cache more…") : null,
      sim ? h("button", { onclick: e => rawFields(e, n) }, "raw fields…") : null,
      h("button", { onclick: e => cardForm(e, n) }, "card…"),
      sim ? h("button", { onclick: e => followForm(e, n) }, d.follow ? "↻ following…" : "↻ follow…") : null,
      h("button", { onclick: e => compareForm(e, n) }, "compare config…"),
      d.group ? h("button", { onclick: () => setView({ kind: "group", name: d.group }) }, `grid of "${d.group}"`) : null,
      h("button", { title: d.archived ? "back into the visualizer's menus" : "stored data is kept; the visualizer's menus leave it out", onclick: () => archive([n], !d.archived) }, d.archived ? "un-archive" : "archive"),
      h("button", { onclick: e => colMenu(e, n) }, "more…")),
    mine.length ? folderBar(true) : null,
    mine.length && !rows.length ? h("div", { class: "dim" }, "nothing stored here in this folder / for these axes") : null,
    mine.length && rows.length ? h("table", { class: "dstable" },
      h("thead", {}, h("tr", {}, h("th", {}, "quantity"),                              // v11.4.2: the columns say what they are
        h("th", { title: "outputs stored / outputs the dataset has (colour: the state; click it for actions)" }, "outputs"),
        h("th", { title: "what the stored numbers are over" }, "axes"), h("th", { title: "on disk in the store" }, "size"))),
      h("tbody", {}, rows)) : mine.length ? null : h("div", { class: "dim" }, sim ? "nothing stored yet: cache more…" : "nothing stored")));
}

// ---- pop-ups ----------------------------------------------------------------------------------------------------
let popEl = null;
function closePop() { popEl?.remove(); popEl = null; }
document.addEventListener("mousedown", e => { if (popEl && !popEl.contains(e.target)) closePop(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closePop(); });
function pop(e, kids) {
  closePop();
  popEl = h("div", { class: "pop", style: `left:${Math.min(e.pageX, scrollX + innerWidth - 360)}px;top:${e.pageY + 8}px` }, kids);
  document.body.append(popEl);
  return popEl;
}
/** A small text box like the visualizer's title editor: Enter applies, Escape cancels. */
function renameBox(e, value, title, apply, extra = []) {
  const inp = h("input", { type: "text", size: 30, value });
  const go = async () => { const v = inp.value.trim(); if (!v || v === value) return closePop(); closePop(); await apply(v); };
  inp.addEventListener("keydown", ev => { if (ev.key === "Enter") go(); });
  pop(e, [h("b", {}, title), inp, h("div", { class: "row" }, h("button", { class: "on", onclick: go }, "rename"), h("button", { onclick: closePop }, "cancel"), extra)]);
  inp.focus(); inp.select();
}
function renameLabel(e, n) {
  const M = rowsModel(), own = ST.methods.find(x => x.name === n)?.code_label;
  renameBox(e, M.label(n), `shown name of ${n}`, async v => { const j = await post("group", { action: "label", name: n, label: v }); toast(j.ok ? `shown as "${v}"` : j.error, !j.ok); if (j.ok) load(); },
    ST.groups.labels?.[n] ? [h("button", { onclick: async () => { closePop(); const j = await post("group", { action: "label", name: n, label: "" }); if (j.ok) load(); } }, `↺ ${own || n}`)] : []);
}
function renameDataset(e, n) {
  renameBox(e, n, `rename dataset ${n}`, async v => {
    if (!confirm(`Rename ${n} to ${v}? Its stored data moves with it. Saved visualizer desktops that use "${n}" will need the new name (pick it in their dataset menus).`)) return;
    const j = await post("datasets", { action: "rename", name: n, new: v }); toast(j.ok ? `renamed to ${v}` : j.error, !j.ok);
    if (j.ok) { setCols(p => { p.order = (p.order || []).map(x => (x === n ? v : x)); p.hidden = (p.hidden || []).map(x => (x === n ? v : x)); }); load(); }
  });
}
/** Health of a stored quantity (v8.1, UI review §4.7): method version, when written, outputs, NaN fraction, size. */
function healthText(r) {
  const out = r.layout === "static" ? "one array" : `${r.steps}${r.outputs ? ` of ${r.outputs}` : ""} outputs` + (r.steps ? ` (steps ${r.first}–${r.last})` : "")
    + (r.outputs && r.layout !== "static" && r.steps < r.outputs ? ` · ${r.outputs - r.steps} missing` : "");
  return [out, `NaN ${r.nan == null ? "not recorded" : (100 * r.nan).toFixed(r.nan < 0.01 ? 2 : 0) + " %"}`, fmtMB(r.MB),
    `written ${r.made ? r.made.replace("T", " ") : "before 2026-10-14 (not recorded)"}`, `version ${r.version || "?"}`].join(" · ");
}
function cellMenu(e, name, run, r) {
  const sim = dsInfo(run).kind !== "derived", raw = r?.raw || rowsModel().isRaw(name);
  pop(e, [h("b", {}, `${name} · ${run}`),
    r ? [h("div", { class: "dim" }, r.state), h("div", { class: "health" }, healthText(r))] : h("div", { class: "dim" }, "not stored"),
    computable(name) && sim ? h("button", { onclick: () => { closePop(); startCache([name], [run], "", false); } }, raw ? (r ? "copy the missing outputs" : "copy it from the dumps") : (r ? "compute the missing outputs" : "compute it")) : h("div", { class: "dim" }, sim ? "no saved method: it can't be computed here" : "derived data: nothing to compute"),
    computable(name) && sim && r ? h("button", { onclick: () => { closePop(); if (confirm(`Redo every output of ${name} for ${run}?`)) startCache([name], [run], "", true); } }, raw ? "copy everything again" : "recompute everything") : null,
    r ? h("button", { onclick: () => { closePop(); dropIt([name], [run]); } }, `delete it (${fmtMB(r.MB)})…`) : null,
    h("a", { href: "index.html", target: "_blank" }, "open the visualizer")]);
}
function rowMenu(e, name) {
  const M = rowsModel(), stored = ST.rows.filter(r => r.quantity === name), mb = stored.reduce((a, r) => a + r.MB, 0);
  pop(e, [h("b", {}, M.label(name)), h("div", { class: "dim" }, `${name} · stored for ${stored.length} dataset${stored.length === 1 ? "" : "s"} · ${fmtMB(mb)}`),
    computable(name) ? h("button", { onclick: () => { closePop(); startCache([name], simRuns(), "", false); } }, "fill in the missing outputs for every dataset") : null,
    computable(name) && stored.length ? h("button", { onclick: () => { closePop(); if (confirm(`Redo ${name} for every dataset?`)) startCache([name], simRuns(), "", true); } }, "redo everything, every dataset") : null,
    stored.length ? h("button", { onclick: () => { closePop(); dropIt([name], stored.map(r => r.run)); } }, `delete it in every dataset (${fmtMB(mb)})…`) : null,
    h("button", { onclick: ev => renameLabel(ev, name) }, "rename (shown name)…"),
    folderPicker([name]),                                                 // v11.6
    groupPicker([name])]);
}
/** v11.6: which folders the quantities are in (tick / untick), and a new folder. */
function folderPicker(names) {
  const ps = Object.keys(ST.groups?.presets || {});
  return h("div", { class: "col" }, h("span", { class: "dim" }, "folders:"),
    ps.map(f => h("label", {}, h("input", { type: "checkbox", checked: names.every(n => inPreset(n, ST.groups.presets[f])) || null,
      onchange: e => { closePop(); if (e.target.checked) addToFolder(f, names); else outOfFolders(names, f); } }), " ", f)),
    h("button", { class: "small", onclick: ev => renameBox(ev, "", "name of the new folder", async v => { closePop(); if (await setFolder(v, names)) { selected.clear(); load(); } }) }, "＋ new folder…"));
}
function groupPicker(names) {
  const M = rowsModel(), all = [...new Set([...ST.groups.order, ...M.order])];
  const sel = h("select", {}, all.map(g => h("option", { value: g }, g)), h("option", { value: "__new" }, "＋ new group…"));
  sel.value = M.groupOf(names[0]);
  return h("div", { class: "row", title: "the section the visualizer's quantity menus list it under" }, "menu section", sel, h("button", { onclick: async ev => {
    if (sel.value === "__new") return renameBox(ev, "", "name of the new group", v => moveRows(names, v));
    closePop(); moveRows(names, sel.value);
  } }, "move"));
}
function colMenu(e, n) {
  const d = dsInfo(n), stored = ST.rows.filter(r => r.run === n), mb = stored.reduce((a, r) => a + r.MB, 0);
  pop(e, [h("b", {}, n), aboutDiv(n),
    h("div", { class: "dim" }, `${d.kind} · ${d.path || d.note || ""}${d.outputs != null ? ` · ${d.outputs} outputs` : ""} · ${stored.length} quantities, ${fmtMB(mb)}`),
    h("div", { class: "row" }, "group", groupSelect([n], d.group || ""),                                   // v8.24
      h("button", { onclick: () => { closePop(); archive([n], !d.archived); } }, d.archived ? "un-archive" : "archive")),
    h("button", { onclick: () => setView({ kind: "dataset", name: n }) }, "its page"),
    h("button", { onclick: ev => cardForm(ev, n) }, "card: notes, tags, config…"),
    h("button", { onclick: ev => compareForm(ev, n) }, "compare its config with another dataset…"),
    d.kind !== "derived" ? h("button", { onclick: ev => followForm(ev, n) }, d.follow ? "↻ following: change / stop…" : "↻ follow (compute new outputs automatically)…") : null,
    h("button", { onclick: () => { closePop(); setCols(p => { p.hidden = [...new Set([...(p.hidden || []), n])]; }); } }, "hide"),
    h("button", { onclick: ev => renameDataset(ev, n) }, "rename…"),
    d.kind !== "derived" ? h("button", { onclick: ev => rawFields(ev, n) }, "raw fields from its dumps…") : null,
    d.kind !== "derived" ? h("button", { onclick: () => { closePop(); const all = ST.methods.map(x => x.name);
      if (confirm(`Compute every method's missing outputs for ${n} (${all.length} methods)? Maps take ~100 MB each.`)) startCache(all, [n], "", false); } }, "compute every method's missing outputs…") : null,
    h("button", { onclick: async () => { closePop();
      if (!confirm(stored.length ? `Remove dataset ${n} AND delete its ${stored.length} stored quantities (${fmtMB(mb)})? This cannot be undone.` : `Remove dataset ${n} from the list?`)) return;
      const j = await post("datasets", { action: "remove", name: n, drop_data: stored.length > 0 });
      toast(j.ok ? `removed ${n}` : `could not: ${j.error}`, !j.ok); if (j.ok) load(); } }, stored.length ? `remove (deletes ${fmtMB(mb)})…` : "remove from the list")]);
}
/** A dataset's card (v8.1, UI review §4.8): notes, tags, its recorded config numbers and what is stored. */
function cardForm(e, n) {
  const d = dsInfo(n), stored = ST.rows.filter(r => r.run === n);
  const notes = h("textarea", { rows: 4, placeholder: "what this dataset is, what it showed, what is wrong with it …" }); notes.value = d.notes || "";
  const tags = h("input", { type: "text", size: 36, value: (d.tags || []).join(", "), placeholder: "no-pairs, cooling, profile-test" });
  const conf = Object.entries(d.conf || {}).map(([k, v]) => `${k} = ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`).join(" · ");
  pop(e, [h("div", { class: "card" }, h("b", {}, `${n} — card`),
    h("div", { class: "dim" }, `${d.kind} · ${d.path || d.note || ""}${d.outputs != null ? ` · ${d.outputs} outputs` : ""}`),
    aboutDiv(n, true),
    h("div", {}, "notes"), notes, h("div", { class: "row" }, "tags", tags),
    conf ? h("div", { class: "dim" }, `config: ${conf}`) : null,
    h("div", { class: "dim" }, `stored: ${stored.map(r => r.quantity).join(", ") || "nothing yet"}`),
    h("div", { class: "row" }, h("button", { class: "on", onclick: async () => {
      const j = await post("meta", { action: "card", name: n, notes: notes.value, tags: tags.value });
      toast(j.ok ? `card of ${n} saved` : `could not: ${j.error}`, !j.ok); if (j.ok) { closePop(); load(); }
    } }, "save"), h("button", { onclick: closePop }, "cancel")))]);
  notes.focus();
}
/** The card's about line in a pop-up (with its page). */
function aboutDiv(n, page = false) {
  const d = dsInfo(n);
  return d.about ? h("div", { class: "about", title: PAGE().about_title || "from the project's about file (python -m datamgr about)" },
    d.about + (page && d.page ? `  (${aboutLabel()}: ${d.page.replace(/^projects\//, "")})` : "")) : null;
}
/** Compare a dataset's config with another's (v8.19, human 2026-11-03): only the numbers that differ (output_dir left
 *  out). Config numbers only: a code change without a config switch does not show. */
const manifests = new Map();
const manifestOf = n => {
  if (!manifests.has(n)) manifests.set(n, fetch(`../data/${encodeURIComponent(n)}/manifest.json`).then(r => (r.ok ? r.json() : null)).catch(() => null));
  return manifests.get(n);
};
function compareForm(e, n) {
  const out = h("div", {}), f = v => (v === undefined || v === null ? "—" : Array.isArray(v) ? `[${v.join(", ")}]` : String(v));
  const show = async b => {
    if (!b) { out.replaceChildren(); return; }
    const [ma, mb] = await Promise.all([manifestOf(n), manifestOf(b)]), A = ma?.conf_all, B = mb?.conf_all;
    if (!A || !B) { out.replaceChildren(h("div", { class: "dim" }, `no config numbers recorded for ${A ? b : n} (python -m datamgr conf)`)); return; }
    const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter(k => k !== "output_dir" && JSON.stringify(A[k]) !== JSON.stringify(B[k])).sort();
    out.replaceChildren(keys.length ? h("table", { class: "mt" }, h("tr", {}, h("th", {}, "setting"), h("th", { title: aboutText(n) }, n), h("th", { title: aboutText(b) }, b)),
      keys.map(k => h("tr", {}, h("td", {}, k), h("td", {}, f(A[k])), h("td", {}, f(B[k])))))
      : h("div", { class: "dim" }, "the same config numbers (a code change would not show here)"));
  };
  const sel = h("select", { onchange: ev => show(ev.target.value) }, h("option", { value: "" }, "compare with…"),
    ST.datasets.filter(d => d.name !== n).map(d => h("option", { value: d.name, title: aboutText(d.name) }, d.name)));
  pop(e, [h("div", { class: "card" }, h("b", {}, `${n} — compare config`), aboutDiv(n), h("div", { class: "row" }, sel), out,
    h("div", { class: "row" }, h("button", { onclick: closePop }, "close")))]);
}
/** Follow a running simulation (v8.1, UI review §4.6): serve.py computes the chosen quantities for its new outputs. */
function followForm(e, n) {
  const d = dsInfo(n), stored = [...new Set(ST.rows.filter(r => r.run === n).map(r => r.quantity))].filter(computable);
  const cur = d.follow === "stored" ? new Set(stored) : new Set(d.follow || []);
  const all = h("input", { type: "checkbox", checked: d.follow === "stored" || !d.follow || null });
  const boxes = stored.map(q => h("label", {}, h("input", { type: "checkbox", value: q, checked: cur.has(q) || null }), " ", rowsModel().label(q)));
  pop(e, [h("div", { class: "card" }, h("b", { title: "every 5 minutes serve.py looks for new outputs and computes these for them (a job each time); restart serve.py once" }, `follow ${n} ⓘ`),

    h("label", { class: "row" }, all, "everything stored for it (also quantities added later)"),
    h("div", { class: "runs" }, boxes),
    h("div", { class: "row" },
      h("button", { class: "on", onclick: async () => {
        const pick = boxes.map(b => b.querySelector("input")).filter(i => i.checked).map(i => i.value);
        const names = all.checked ? "stored" : pick.length ? pick : null;
        if (!names) return toast("tick something, or press stop", true);
        const j = await post("meta", { action: "follow", name: n, names }); toast(j.ok ? `${n}: following` : `could not: ${j.error}`, !j.ok); if (j.ok) { closePop(); load(); }
      } }, "follow"),
      d.follow ? h("button", { onclick: async () => { const j = await post("meta", { action: "follow", name: n, names: null }); toast(j.ok ? `${n}: not following` : j.error, !j.ok); if (j.ok) { closePop(); load(); } } }, "stop") : null,
      h("button", { onclick: closePop }, "cancel")))]);
}
/** The 2D fields in a dataset's own dumps: copy the ticked ones into the store (not a computation). */
async function rawFields(e, n) {
  const box = pop(e, [h("b", {}, `raw fields of ${n}`), h("span", { class: "dim" }, "reading its dumps…")]);
  const j = await post("fields", { run: n });
  if (!j.ok) { box.replaceChildren(h("b", {}, `raw fields of ${n}`), h("div", { class: "warn" }, j.error)); return; }
  const have = new Set(ST.rows.filter(r => r.run === n).map(r => r.quantity));
  const maps = ST.rows.filter(r => r.run === n && r.layout === "per_step" && r.steps), d = dsInfo(n);
  const perOut = maps.length ? maps[0].MB / maps[0].steps : 0.52, est = fmtMB(perOut * (d.outputs || 0));
  const boxes = j.fields.map(f => h("label", { title: have.has(f) ? "stored already" : `copy ${f} for every output (≈ ${est})` },
    h("input", { type: "checkbox", value: f, checked: have.has(f) || null, disabled: have.has(f) || null }), " ", f));
  box.replaceChildren(h("b", {}, `raw fields of ${n}`), h("div", { class: "dim", title: `the 2D datasets in its fld.*.h5 dumps, copied as they are (float16 per output) — no computing` }, `≈ ${est} each`),
    h("div", { class: "runs" }, boxes),
    h("div", { class: "row" }, h("button", { class: "on", onclick: () => {
      const pick = boxes.map(b => b.querySelector("input")).filter(i => i.checked && !i.disabled).map(i => i.value);
      if (!pick.length) return toast("tick at least one field", true);
      closePop(); startCache(pick, [n], "", false);
    } }, "copy ticked"), h("button", { onclick: closePop }, "cancel")));
}
function addDatasetForm(e) {
  const path = h("input", { type: "text", size: 52, value: ST.data_root || "" });
  const list = h("div", { class: "runs col" }, h("span", { class: "dim" }, "paste a folder and list its runs"));
  const doScan = async () => {
    list.replaceChildren(h("span", { class: "dim" }, "listing…"));
    const j = await post("scan", { path: path.value.trim() });
    if (!j.ok) { list.replaceChildren(h("span", { class: "warn" }, j.error)); return; }
    if (!j.runs.length) { list.replaceChildren(h("span", { class: "dim" }, `no ${ST.project?.runs_word || "runs"} there`)); return; }
    list.replaceChildren(...j.runs.map(r => h("div", { class: "row", "data-path": r.path },
      h("input", { type: "checkbox", disabled: r.registered_as ? true : null }), h("input", { type: "text", size: 22, value: r.registered_as || r.name, disabled: r.registered_as ? true : null }),
      h("span", { class: "dim" }, `${r.outputs ?? 0} outputs${r.registered_as ? ` · already added as ${r.registered_as}` : ""}`))));
  };
  path.addEventListener("keydown", ev => { if (ev.key === "Enter") doScan(); });
  pop(e, [h("b", {}, "add datasets (columns)"), h("div", { class: "row" }, path, h("button", { onclick: doScan }, "list runs")), list,
    h("div", { class: "row" }, h("button", { class: "on", onclick: async () => {
      const picks = [...list.querySelectorAll("div.row")].filter(r => r.querySelector("input[type=checkbox]")?.checked)
        .map(r => ({ path: r.dataset.path, name: r.querySelector("input[type=text]").value.trim() }));
      if (!picks.length) return toast("tick at least one run", true);
      closePop();
      for (const p of picks) { const j = await post("datasets", { action: "add", name: p.name, path: p.path, kind: "simulation" }); if (!j.ok) toast(`${p.name}: ${j.error}`, true); }
      toast(`added ${picks.map(p => p.name).join(", ")}`); load();
    } }, "add ticked"), h("button", { onclick: closePop }, "cancel")),
    ]);
}
function renderSelBar() {
  if (!ST) return;
  const names = [...selected];
  if (!names.length) { $("selbar").replaceChildren(); $("selbar").style.display = "none"; return; }
  const rows = ST.rows.filter(r => selected.has(r.quantity)), mb = rows.reduce((a, r) => a + r.MB, 0);
  $("selbar").style.display = "flex";
  $("selbar").replaceChildren(h("b", {}, `${names.length} selected`), h("span", { class: "dim" }, "drag one of them onto a folder heading to add them all"),
    h("button", { onclick: () => startCache(names.filter(computable), simRuns(), "", false) }, "fill in missing (every dataset)"),
    rows.length ? h("button", { onclick: () => dropIt(names, [...new Set(rows.map(r => r.run))]) }, `delete in every dataset (${fmtMB(mb)})…`) : null,
    h("button", { onclick: e => pop(e, [h("b", {}, "folders of the selected rows"), folderPicker(names)]) }, "folders…"),
    h("button", { onclick: e => pop(e, [h("b", {}, "the visualizer's menu section of the selected rows"), groupPicker(names)]) }, "menu section…"),
    h("button", { onclick: () => { selected.clear(); renderGrid(); renderSelBar(); } }, "clear"));
}

// ---- methods -----------------------------------------------------------------------------------------------------
function renderMethods() {
  const where = n => [...new Set(ST.rows.filter(r => r.quantity === n).map(r => r.run))];
  const groups = [...new Set(ST.methods.map(x => x.yaxis))].sort();
  const rows = ST.methods.filter(x => inFolder(x.name)).map(x => {
    const code = h("tr", { style: "display:none" }, h("td", { colspan: 6 }, h("pre", { class: "code" }, x.source || "(no source)"), h("div", { class: "dim" }, x.description || "")));
    const renamed = x.label !== x.code_label, ws = where(x.name);
    return [h("tr", {},
      h("td", {}, h("b", {}, x.label), renamed ? h("div", { class: "over", title: "renamed on this page; the code says otherwise" }, `code: ${x.code_label} `,
          x.path ? h("button", { class: "small", title: "write the shown name into the method's code (nothing is recomputed)", onclick: async () => {
            if (!confirm(`Write "${x.label}" as the label in ${x.path}? Only the @dm.register line changes; nothing is recomputed.`)) return;
            const j = await post("meta", { action: "push-label", name: x.name }); toast(j.ok ? "written into the code" : `could not: ${j.error}`, !j.ok); if (j.ok) load(); } }, "→ code") : null) : null,
        h("div", { class: "dim" }, x.name)),
      h("td", {}, h("span", { class: "linkish", title: "click to move it to another y-axis group", onclick: e => yaxisForm(e, [x.name], x.yaxis, groups) }, x.yaxis),
        x.yaxis !== x.code_yaxis ? h("div", { class: "over" }, `code: ${x.code_yaxis}`) : null, x.units ? h("div", { class: "dim" }, x.units) : null),
      h("td", { class: "dim" }, x.axes.join(" × ")),
      h("td", { class: "dim" }, x.group, x.family ? h("div", { title: "a family's member: computed and cached with the family" }, `family ${x.family}`) : null),
      h("td", { class: "dim" }, ws.length ? ws.join(", ") : "not stored", h("div", {}, x.version)),
      h("td", {}, h("button", { class: "small", onclick: () => { code.style.display = code.style.display === "none" ? "" : "none"; } }, "code"),
        x.path ? null : h("span", { class: "warn" }, " not saved"))), code];
  });
  const fams = (ST.families || []).filter(f => !folderNow() || f.members.some(inFolder));
  $("methods").replaceChildren(folderBar(), h("table", { class: "mt" },
    h("thead", {}, h("tr", {}, ["quantity", "y-axis group", "axes", "group", "stored in · version", ""].map(t => h("th", {}, t)))), h("tbody", {}, rows)),
    // v8.25: families (one computation, several stored members) and derived quantities (computed in the viewer)
    fams.length ? [h("h2", {}, "Families"), h("table", { class: "mt" }, h("tbody", {}, fams.map(f => h("tr", {},
      h("td", {}, h("b", {}, f.label), h("div", { class: "dim" }, f.name)), h("td", {}, f.members.join(", ")), h("td", { class: "dim" }, f.axes.join(" × ")),
      h("td", { class: "dim" }, f.version, f.path ? null : h("span", { class: "warn" }, " not saved"))))))] : null,
    h("h2", { title: "defined in the visualizer (Expressions → every desktop); computed when drawn, never cached" }, "Derived quantities (computed in the viewer)"),
    h("div", { id: "derived" }, h("span", { class: "dim" }, "reading…")));
  fetch("../views/library/derived.json", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(j => {
    const lines = String(j?.text || "").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    $("derived").replaceChildren(lines.length ? h("table", { class: "mt" }, h("tbody", {}, lines.map(l => { const [lhs, ...rest] = l.split("="); return h("tr", {}, h("td", {}, h("b", {}, lhs.trim())), h("td", {}, h("code", {}, rest.join("=").split("#")[0].trim())), h("td", { class: "dim" }, (l.split("#")[1] || "").trim())); })))
      : h("span", { class: "dim" }, "none yet: in the visualizer, Expressions → ＋ → for: every desktop"));
  }).catch(() => $("derived").replaceChildren(h("span", { class: "dim" }, "could not read views/library/derived.json")));
}
function yaxisForm(e, names, cur, groups) {
  const inp = h("input", { type: "text", size: 28, value: cur, list: "yax-list" });
  pop(e, [h("b", { title: "quantities in one group share a y axis in the visualizer · empty = the code's group · nothing is recomputed" }, `y-axis group of ${names.join(", ")} ⓘ`), inp, h("datalist", { id: "yax-list" }, groups.map(g => h("option", { value: g }))),

    h("div", { class: "row" }, h("button", { class: "on", onclick: async () => {
      const j = await post("meta", { action: "yaxis", names, group: inp.value.trim() }); toast(j.ok ? "moved" : `could not: ${j.error}`, !j.ok); if (j.ok) { closePop(); load(); }
    } }, "set"), h("button", { onclick: closePop }, "cancel"))]);
  inp.focus(); inp.select();
}
/** y-axis groups (v8.1, UI review §4.2): each group, its units, the quantities in it (one physical quantity should
 *  be one group: two groups that hold the same thing can be merged by moving the quantities). */
function renderYaxes() {
  const by = new Map();
  for (const x of ST.methods) { if (!by.has(x.yaxis)) by.set(x.yaxis, []); by.get(x.yaxis).push(x); }
  const yu = ST.groups.yunits || {}, all = [...by.keys()].sort();
  $("yaxes").replaceChildren(h("table", { class: "mt" }, h("thead", {}, h("tr", {}, ["y-axis group", "units", "quantities"].map(t => h("th", {}, t)))),
    h("tbody", {}, [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([g, xs]) => {
      const codeUnits = [...new Set(xs.map(x => x.code_units).filter(Boolean))];
      const units = h("input", { type: "text", size: 12, value: yu[g] || "", placeholder: codeUnits.join(" / ") || "none" });
      units.addEventListener("change", async () => { const j = await post("meta", { action: "yunits", group: g, units: units.value.trim() }); toast(j.ok ? `${g}: units ${units.value.trim() || "(none)"}` : `could not: ${j.error}`, !j.ok); if (j.ok) load(); });
      return h("tr", {}, h("td", {}, h("b", {}, g)),
        h("td", {}, units, codeUnits.length > 1 ? h("div", { class: "warn" }, `the methods say ${codeUnits.join(" vs ")}`) : null),
        h("td", {}, xs.map(x => h("div", {}, h("span", { class: "linkish", title: "move to another y-axis group", onclick: e => yaxisForm(e, [x.name], g, all) }, x.label),
          h("span", { class: "dim" }, ` ${x.name}${x.code_units ? " · " + x.code_units : ""}`)))));
    }))));
}
function renderErrors() {
  const errs = Object.entries(ST.load_errors || {});
  $("errors").replaceChildren(...(errs.length ? [h("h2", { class: "warn" }, "Method files that did not load"), ...errs.map(([f, e]) => h("div", { class: "warn" }, `${f}: ${e}`))] : []));
}

// ---- jobs ---------------------------------------------------------------------------------------------------------
async function startCache(names, runs, steps, rewrite) {
  if (!names.length || !runs.length) return toast("nothing to do", true);
  const j = await post("cache", { names, runs, steps, rewrite });
  if (!j.ok) return toast(`could not start: ${j.error}`, true);
  toast(`started: ${names.length > 3 ? names.length + " quantities" : names.join(", ")} for ${runs.length > 3 ? runs.length + " datasets" : runs.join(", ")}`);
  pollJobs(true);
}
async function dropIt(names, runs) {
  const rows = ST.rows.filter(r => names.includes(r.quantity) && runs.includes(r.run)), mb = rows.reduce((a, r) => a + r.MB, 0);
  if (!rows.length) return;
  if (!confirm(`Delete ${rows.length} stored ${rows.length > 1 ? "quantities" : "quantity"} (${fmtMB(mb)}): ${names.join(", ")} in ${runs.join(", ")}? This cannot be undone.`)) return;
  const j = await post("drop", { names, runs });
  toast(j.ok ? `deleted ${rows.length} (${fmtMB(mb)})` : `delete failed: ${j.error || j.out}`, !j.ok);
  selected.clear(); load();
}
// Jobs (v8, human 2026-10-14: "when I compute new things it adds to jobs and then this just clutters, jobs don't seem
// to go away"): jobs at work are listed in full; a finished job shrinks to one line and goes away by itself after
// 10 minutes (a failed or stopped one stays until you clear it); "clear" hides the finished ones now. The last jobs
// stay readable under "earlier jobs". Hidden ids are remembered in this browser only.
const active = j => j.state === "running" || j.state === "waiting";
const HIDE_KEY = "dm.hiddenJobs";
const hiddenJobs = () => { try { return new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || "[]")); } catch { return new Set(); } };
function hideJobs(ids) { const s = hiddenJobs(); ids.forEach(i => s.add(i)); localStorage.setItem(HIDE_KEY, JSON.stringify([...s].slice(-300))); renderJobs(); }
const ago = t => { const m = Math.round((Date.now() / 1000 - t) / 60); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const jobWhat = j => `${j.methods.length > 4 ? j.methods.length + " quantities" : j.methods.join(", ")} · ${j.runs.join(", ")}`;
function jobLog(j) { return h("pre", { class: "code", style: "display:none" }, (j.log || []).join("\n") + (j.error ? "\n" + j.error : "")); }
function renderJobs() {
  const hid = hiddenJobs(), now = Date.now() / 1000;
  const run = JOBS.filter(active);
  const fin = JOBS.filter(j => !active(j) && !hid.has(j.id) && (j.state !== "done" || now - (j.updated || 0) < 600));
  const rest = JOBS.filter(j => !active(j) && !fin.includes(j));
  const full = j => {
    const frac = j.total ? j.done / j.total : 0, log = jobLog(j);
    return h("div", { class: "job" }, h("b", {}, j.methods.length > 4 ? `${j.methods.length} quantities` : j.methods.join(", ")), h("span", {}, j.runs.join(", ")),
      h("div", { class: "bar" + (j.state === "waiting" ? " wait" : "") }, h("div", { style: `width:${(100 * frac).toFixed(0)}%` })),
      h("span", { class: "dim" }, j.state === "waiting" ? `waiting: another job is writing ${j.run || "this dataset"} (one job per dataset at a time)`
        : `${j.run || ""} ${j.done}/${j.total}` + (j.eta_s ? ` · ~${Math.ceil(j.eta_s / 60)} min left` : "")),
      h("button", { onclick: async () => { const r = await post("cancel", { job: j.id }); toast(r.ok ? "cancelling…" : r.error, !r.ok); } }, "cancel"),
      h("button", { onclick: () => { log.style.display = log.style.display === "none" ? "block" : "none"; } }, "log"), log);
  };
  const line = (j, hide = true) => {
    const log = jobLog(j), bad = j.state !== "done";
    return h("div", { class: "jobline" + (bad ? " bad" : "") }, h("span", { class: bad ? "warn" : "ok" }, bad ? "✗" : "✓"),
      h("span", {}, jobWhat(j)), h("span", { class: "dim" }, `${j.state} ${ago(j.updated || j.started)}` + (j.error ? ` · ${j.error.slice(0, 120)}` : "")),
      h("button", { class: "small", onclick: () => { log.style.display = log.style.display === "none" ? "block" : "none"; } }, "log"),
      hide ? h("button", { class: "small", title: "hide this job", onclick: () => hideJobs([j.id]) }, "×") : null, log);
  };
  const parts = [];
  if (run.length || fin.length) parts.push(h("h2", {}, "Jobs", fin.length ? h("button", { class: "small", style: "margin-left:10px", onclick: () => hideJobs(fin.map(j => j.id)) }, `clear ${fin.length} finished`) : null));
  parts.push(...run.map(full), ...fin.map(j => line(j)));
  if (rest.length) parts.push(h("details", { class: "oldjobs" }, h("summary", { class: "dim" }, `earlier jobs (${rest.length})`), ...rest.map(j => line(j, false))));
  $("jobs").replaceChildren(...parts);
}
let pollTimer = null, wasRunning = false;
async function pollJobs(soon = false) {
  clearTimeout(pollTimer);
  try { const r = await fetch("../api/dm/jobs", { cache: "no-store" }); JOBS = (await r.json()).jobs || []; } catch { JOBS = []; }
  renderJobs();
  const running = JOBS.some(active);
  if (wasRunning && !running) load();
  wasRunning = running;
  pollTimer = setTimeout(pollJobs, running || soon ? 2000 : 10000);
}

/** The page's words from the project (2026-11-20): title and the how-to (project.json "page"; generic without one). */
const HOWTO = `import datamgr as dm                           # (the folder holding datamgr on sys.path; the project: DATAMGR_PROJECT)

@dm.register(axes=dm.reader_class().grid_axes, label="my map", yaxis="my map")   # axes: dm.AXES names or dm.Axis(...)
def my_map(data):                                     # data = the run at one output (what your reader loads)
    return data.some_field * 2

dm.check(my_map, "DATASET")                    # 3 outputs: small plot, numbers, cost of caching it all
dm.save(my_map)                                # -> <project>/methods/my_map.py (shows up here)
dm.cache("my_map", runs=["DATASET"])           # or "compute" on this page (Data tab)

ds = dm.dataset("DATASET")                     # read what is stored: its quantities are attributes
ds.my_map.at(t=10)                             # maps: one output at a time`;
function projectWords() {
  const title = PAGE().title || "data manager";
  document.title = title;
  $("pagetitle").textContent = title;
  $("howto").textContent = ST?.project?.howto || HOWTO;
}
$("howto").textContent = HOWTO;
$("reload").onclick = load;
tokenBox(); load(); pollJobs();
