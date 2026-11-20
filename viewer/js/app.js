// app.js — visualizer v4: a free-floating desktop of panels (2D / 1D) and FIGURES (linked panels docked into
// a tight apt_fig-like grid), desktop zoom, settings in a floating box joined to its panel by a line, time +
// playback with background precaching, undo/redo, saved desktops / panel setups. v5: variables in a left
// sidebar (vars.js, measure.js) and "copy with another dataset". See ../../FORMAT.md and the wiki pages
// aperture4/visualizer (requirements) + aperture4/visualizer-concepts.
import { Store, Run, parseExpressionText, parseAnalyticText, setVarValue, compileAnalytic } from "./data.js";
import * as R from "./render.js";
import { timeLine, isTimeLine, S, setStore, store, eff, timeInfo, ctxPanel, srcOf, firstRun, settings1D, settings2D, newPanel, cloneFresh, defaultDesktop,
  groupOf, membersOf, linkPanels, unlinkPanel, isLinked, toggleLink, migrate, isSpherical, runOf, runLabel, isRef, refsIn, listRefs, runsText, newVarName, bindRun,
  newGroupColor, newId, runNames, styleNow, STYLE_DEFAULTS, numOf, setSectionOrder, setFolders, listOf, isAn, isFn,
  SCOPE_FAMILIES, familyKeys, familyOf, scopeOf, panelRun, axisLabel, axisCatalog, anDefault,
  familyScope, axisSig, yAxisId, ownY, ownOnJoin, shareKeys, sharersOf, runsOf as runsOfRef, splitKind, lineKind, freeToolName, newTool, num1 } from "./model.js";
import { render2D, attach2D, followSource2D, axesFor, cbarIsTop, margins2D } from "./panel2d.js";
import { render1D, attach1D, followSources1D, setAutoChange, normSmooth } from "./panel1d.js";
import { onResult, getResult } from "./results.js";        // v14.4: the change bus
import { nameTaken } from "./model.js";
import { setTablesApi, newTabLine, tabAxis, tableOf, colLabel, refreshTableCard } from "./tables.js";   // v14.0 (v14.7: + the table card)
import { setCycApi, newCycLine, CYC_WHAT, isPerCurve, curveDim } from "./cycleplots.js";   // v14.1
import { setLineoutApi, newLoLine, loGeom, loDefault, loPositions, loValueAt } from "./lineout.js";   // v14.2
import { lineReads } from "./linekinds.js";   // v14.4: which plots read a tool, output or table
import { toolValues, DESKTOP_SCHEMA, desktopFields } from "./model.js";   // v14.4: + the desktop schema
import { settings2DBox, settings1DBox, changeQuantity2D, quantityGroups2DFor, section, quickBox, addTool, openToolEditor, toolList, TOOLS, TOOL_FOLDERS, toolWhere, canHaveTool, toolProblem, copyProblem, copyToolTo, removeToolById, setToolShown } from "./settings.js";
import { groupedSelect, datasetChips } from "./lines.js";
import { el, select, num, check, toggle, dialog, popover, closePopover, askName, askConfirm, askForm } from "./ui.js";
import { runSelect, renderSidebar, refreshVarValues, setVarsApi, numRef, parseNumRef, runRefTip } from "./vars.js";
import { updateMeasured, clearMeasured } from "./measure.js";
import { openNewPanel } from "./newpanel.js";
import { formulaToLatex, formulaNames, renderMath, editLatex, latexToFormula, editSymbol, symbolKey } from "./latex.js";
// v8.9: the equation editor (MathLive, vendor/mathlive), loaded the first time an equation box opens
let mlP = null;
function loadMathLive() {
  return (mlP ??= import(new URL("../vendor/mathlive/mathlive.min.mjs", import.meta.url).href).then(m => {
    const MF = m.MathfieldElement || window.MathfieldElement;
    MF.fontsDirectory = new URL("../vendor/mathlive/fonts/", import.meta.url).href;
    MF.soundsDirectory = null;
    return MF;
  }).catch(e => { mlP = null; throw e; }));
}
import { apiAvailable, listViews, saveView, loadView, deleteView, validName, setRoot, hasFeature, apiUrl, loadLibrary, saveLibrary, browserLibrary, forgetBrowserLibrary } from "./views.js";
import { initCacheable, canTag, tagForm } from "./cacheable.js";
import { loadPlugins, failedPlugins, pluginMigrations, pluginPlotMenu, setCoreApi } from "./plugins.js";   // v14.9 (DECISIONS D18; v15.1: + plot menu, D20)

const params = new URLSearchParams(location.search);
// v5.2: its own key, so a frozen older version opened in the same browser can't overwrite (or drop panels of) the
// working layout; the v3 key is read once as a fallback. PREV_KEY keeps the desktop before a switch.
const STATE_KEY = "aptvis.v5.state", PREV_KEY = "aptvis.v5.state.prev";
setStore(new Store(params.get("data") || "../data/", (Number(localStorage.getItem("aptvis.cacheMB")) || 1200) * 1e6));
// v7: analytic maps read number / measured variables by name (their values now)
setVarValue(n => (["number", "measured", "config", "fit"].includes(S.vars?.[n]?.type) ? listOf("$" + n) : undefined));
setRoot(store.base);                     // views/ + api/ live next to data/ (works behind proxies, from versions/)
const live = new Map();                  // panel id -> {panel, root, wrap, canvas, status, last, ...render caches}
const figEls = new Map();                // group id -> figure element
let playing = false, settingsFor = null; // id of the panel whose settings box is open
// v8.22 (human 2026-11-04: "oh i like the concept of shift click"): shift-click plots to select them; a setting changed
// for one selected plot is set in every selected plot of the same kind (settingsCtx). Not a plot's lines or tools.
const SEL = new Set(), NO_MULTI = new Set(["lines", "tools", "ownTools", "hideShared"]);
window.aptvis = { S, store, live, render: p => requestRender(p), undo: () => undo(), redo: () => redo(), layout: () => layout(), sel: SEL };

const $ = id => document.getElementById(id);
function markSel() {
  for (const id of [...SEL]) if (!S.panels.some(p => p.id === id)) SEL.delete(id);
  for (const [id, L] of live) L.root.classList.toggle("selected", SEL.has(id));
  let bar = $("selbar");
  if (!SEL.size) { bar?.remove(); return; }
  if (!bar) { bar = el("div", { id: "selbar" }); document.body.append(bar); }
  const kinds = new Set([...SEL].map(id => S.panels.find(p => p.id === id)?.type));
  bar.replaceChildren(SEL.size === 1 ? "1 plot selected · shift-click more plots to change their settings together"
    : `${SEL.size} plots selected: a setting you change for one is set in every selected ${kinds.size > 1 ? "plot of the same kind (maps / 1D)" : kinds.has("2d") ? "map" : "1D plot"} · shift-click adds or removes · Esc clears`,
    el("button", { onclick: clearSel }, "clear"));
}
function toggleSel(panel) { if (SEL.has(panel.id)) SEL.delete(panel.id); else SEL.add(panel.id); markSel(); }
function clearSel() { if (!SEL.size) return; SEL.clear(); markSel(); }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; localStorage.setItem(STATE_KEY, JSON.stringify(S)); recordHistory(); }, 300);
}
/** Keep the working desktop before it is replaced (new / example / open): "desktops…" can restore it. */
function keepPrevious() { try { localStorage.setItem(PREV_KEY, JSON.stringify(S)); } catch { /* storage full: skip */ } }
async function restorePrevious() {
  const prev = localStorage.getItem(PREV_KEY);
  if (!prev) { toast("no previous desktop kept"); return; }
  if (!(await saveBeforeSwitch())) return;
  keepPrevious();                                        // swap: restoring again goes back
  try { Object.assign(S, JSON.parse(prev)); } catch { toast("the kept desktop could not be read", true); return; }
  migrateDesktop();                                       // v14.4: the one migration pipeline
  closeSettings(); syncControls(); applyExpressions(false); rebuildAll(); save();
  toast("previous desktop restored (restore again to swap back)");
}
/** Group colours go into style attributes and the connector SVG: only accept #rrggbb (stored-markup guard). */
function sanitize() {
  for (const g of Object.values(S.groups || {})) {
    if (!/^#[0-9a-fA-F]{6}$/.test(g.color || "")) g.color = "#2f6fd0";
    // v7.2: a v5.12 figure's pan & zoom per column / row (window keys made every panel's own + g.viewMode) becomes
    // the pan & zoom family's scope
    if (g.viewMode === "col" || g.viewMode === "row") {
      g.scope = { ...(g.scope || {}), view: g.viewMode }; delete g.viewMode;
      const keys = familyKeys("view");
      for (const p of membersOf(g.id)) p.link.own = p.link.own.filter(k => !keys.includes(k));
    }
  }
}
/** Next free id above every panel / line / tool id and every group id ("g12"). */
function bumpNextId(extra = 0) {
  const nums = [...JSON.stringify({ p: S.panels, g: S.groups, t: S.tables }).matchAll(/"id":"?g?(\d+)/g)].map(m => Number(m[1]));
  S.nextId = Math.max(S.nextId || 1, extra || 0, 1 + Math.max(0, ...nums));
}
function toast(msg, warn = false) {
  const t = $("toast"); t.textContent = msg; t.classList.toggle("warn", warn); t.style.opacity = 1;
  clearTimeout(t._h); t._h = setTimeout(() => (t.style.opacity = 0), warn ? 7000 : 3000);
}
function savedWhere(where, what) {
  if (where === "server") toast(`${what} saved to views/ on the server`);
  else toast(`${what} saved in THIS BROWSER only — the viewer can't reach serve.py's save API. Open it through serve.py (see README).`, true);
  $("saveinfo").textContent = where === "server" ? "saving to views/ on the server" : "⚠ serve.py not reachable: saving to this browser only";
}
async function guarded(what, fn) {
  try { return await fn(); }
  catch (e) { console.error(e); toast(`${what} failed: ${e.message}`, true); }
}

// ---- undo / redo ------------------------------------------------------------------------------------------
const UNDO = [], REDO = [];
let lastSnap = null;
// v14.4: an undo step holds the schema's undo fields (model.js DESKTOP_SCHEMA)
const snapshot = () => JSON.stringify(Object.fromEntries(desktopFields(f => f.undo).map(k => [k, S[k] ?? DESKTOP_SCHEMA[k].empty()])), (k, v) => (k === "ui" ? undefined : v));
function recordHistory() {
  const s = snapshot();
  if (s === lastSnap) return;
  if (lastSnap !== null) { UNDO.push(lastSnap); if (UNDO.length > 200) UNDO.shift(); REDO.length = 0; }
  lastSnap = s;
}
function restore(snap) {
  const o = JSON.parse(snap), exprChanged = o.expressions !== S.expressions || (o.analytics ?? "") !== (S.analytics ?? "");
  for (const k of desktopFields(f => f.undo)) S[k] = o[k] ?? DESKTOP_SCHEMA[k].empty();   // v14.4: the schema's undo fields
  lastSnap = snap;
  if (exprChanged) { $("expr").value = S.expressions; applyExpressions(false); }
  rebuildAll(); refreshTableCard();                                    // v14.7: an open table card shows the restored table
  localStorage.setItem(STATE_KEY, JSON.stringify(S));
}
function undo() { clearTimeout(saveTimer); recordHistory(); if (!UNDO.length) return toast("nothing to undo"); REDO.push(lastSnap); restore(UNDO.pop()); }
function redo() { if (!REDO.length) return toast("nothing to redo"); UNDO.push(lastSnap); restore(REDO.pop()); }

// ---- time ------------------------------------------------------------------------------------------------
/** The desktop's timeline: every time the panels' runs have, inside the time range (v5.12, model.js timeInfo). */
const allTimes = () => timeInfo().times;
function timeIndex(T = allTimes()) {
  let best = 0;
  T.forEach((t, i) => { if (Math.abs(t - S.t) < Math.abs(T[best] - S.t)) best = i; });
  return best;
}
function updateTimeBar() {
  const info = timeInfo(), T = info.times, k = timeIndex(T), sl = $("tslider");
  if (T.length && (S.t < T[0] || S.t > T.at(-1))) S.t = T[k];          // a new time range moved the time inside it
  sl.max = Math.max(0, T.length - 1); sl.value = k;
  $("tlabel").textContent = T.length ? `t = ${R.fmt(T[k])}   (${k + 1}/${T.length})` : "no time axis";
  const b = $("trange");
  b.textContent = info.empty ? "⏱ no times in range" : info.limited ? `⏱ ${R.fmt(T[0])} – ${R.fmt(T.at(-1))}` : "⏱ all times";
  b.classList.toggle("on", info.limited);
}
function setTimeIndex(k) {
  const T = allTimes();
  if (!T.length) return;
  S.t = T[Math.max(0, Math.min(T.length - 1, k))];
  updateTimeBar(); renderAll(); save();
}
let playGen = 0;                                         // a newer play() retires an older loop (pause→play race)
async function play() {
  if (playing) { playing = false; playGen++; $("play").textContent = "▶"; save(); return; }   // the retired loop exits silently
  const gen = ++playGen;
  playing = true; $("play").textContent = "⏸";
  while (playing && gen === playGen) {
    const t0 = performance.now(), T = allTimes();
    let k = timeIndex(T) + 1;
    if (k >= T.length) { if (!S.loop) break; k = 0; }
    S.t = T[k]; updateTimeBar();
    await renderAll();                                   // waits for every frame: nothing is dropped
    await new Promise(r => setTimeout(r, Math.max(0, 1000 / S.fps - (performance.now() - t0))));
  }
  if (gen !== playGen) return;
  playing = false; $("play").textContent = "▶"; save();
}

// ---- background precaching ----------------------------------------------------------------------------------
/** Per-step sources the panels follow, with the columns (r band) they need: [{src, cols}], one per run +
 *  quantity (v5.1: panels zoomed differently need the union of their columns; null = the whole frame). */
function followedSources() {
  const seen = new Map();
  for (const p of S.panels) {
    const list = p.type === "2d" ? followSource2D(p, live.get(p.id)) : followSources1D(p).map(src => ({ src, cols: null }));
    for (const { src, cols } of list) add(src, cols);
  }
  // (v8.27 also loaded Ψ ahead for field-line length variables; v10.0: lengths are the stored ones — nothing extra)
  return [...seen.values()];
  function add(src, cols) {
    if (!src.perStep) return;
    const k = `${src.run.name}/${src.name}`, o = seen.get(k);
    if (!o) seen.set(k, { src, cols });
    else o.cols = o.cols && cols ? [Math.min(o.cols[0], cols[0]), Math.max(o.cols[1], cols[1])] : null;
  }
}
// Precaching can be paused (human 2026-10-02): frames then load only when they are shown. Kept per browser.
let prefetchOn = localStorage.getItem("aptvis.prefetch") !== "off";
function setPrefetch(on) {
  prefetchOn = on; localStorage.setItem("aptvis.prefetch", on ? "on" : "off");
  const b = $("prefetch");
  b.textContent = on ? "⏸ precache" : "▶ precache"; b.classList.toggle("on", !on);
  b.title = on ? "pause loading frames ahead in the background" : "resume loading frames ahead in the background";
}
const inflight = new Map();                               // read-ahead jobs on their way: key -> promise
const sleep = ms => new Promise(r => setTimeout(r, ms));
function netText() {
  const n = store.net, r = n.rate();
  return n.active || r > 0.01 ? ` · ↓ ${n.active} · ${r.toFixed(2)} MB/s` : "";
}
async function prefetchLoop() {
  for (;;) {
    await sleep(playing ? 15 : 60);
    if (store.net.offline) { await sleep(500); continue; }
    if (!prefetchOn) {
      $("cache").textContent = `cache ${Math.round(store.cache.bytes / 1e6)}/${Math.round(store.cache.max / 1e6)} MB · precaching paused` + netText();
      await sleep(500);
      continue;
    }
    const srcs = followedSources();
    const share = ({ src, cols }) => (src.isExpr ? (src.ops.find(o => o.banded)?.colsShare(cols) ?? 1) : src.banded ? src.colsShare(cols) : 1);
    const perStep = srcs.reduce((a, f) => a + f.src.frameBytes * share(f) * (f.src.isExpr ? 1 + f.src.ops.length : 1), 0);
    const win = Math.max(4, Math.floor(0.8 * store.cache.max / Math.max(perStep, 1)));
    // time first (v5.1): every quantity of the next step before the step after, so playback can move on.
    // Readout in STEPS (v5.2: "precached 152/1040" counted run x quantity x step and was misread).
    const jobs = [];
    let steps = 0, ready = 0;
    // v5.12: walk the desktop's timeline (inside the time range, wrapping when looping); a run that has ended
    // keeps its last frame, so it needs nothing new
    const T = allTimes(), k0 = timeIndex(T), kmax = srcs.length ? Math.min(win, T.length) : 0;
    for (let k = 0; k < kmax; k++) {
      let kk = k0 + k;
      if (kk >= T.length) { if (!S.loop) break; kk -= T.length; }
      let all = true;
      for (const { src, cols } of srcs) {
        const i = src.indexAt(T[kk]);
        if (!src.isCached(i, cols)) { all = false; jobs.push([src, i, cols]); }
      }
      steps++; if (all) ready++;
    }
    $("cache").textContent = `cache ${Math.round(store.cache.bytes / 1e6)}/${Math.round(store.cache.max / 1e6)} MB` +
      (steps ? ` · ready ahead ${ready}/${steps} steps` + (win < T.length ? " (cache limit)" : "") : "") + netText();
    if (!jobs.length) { await sleep(400); continue; }
    // v5.2: keep up to 4 downloads in flight (measured 1.0 -> 1.5 MB/s through the port forward); the frame on
    // screen goes first (high priority, data.js Net)
    for (const [src, i, cols] of jobs) {
      if (inflight.size >= store.net.lowMax) break;
      const key = `${src.run.name}/${src.name}/${i}`;
      if (inflight.has(key)) continue;
      const job = (src.isExpr ? src.frame(i, false, cols, "low") : src.compactFrame(i, false, cols, "low"))
        .catch(e => console.warn("prefetch", e)).finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    await Promise.race([sleep(300), ...inflight.values()]);
  }
}

// ---- rendering: a linked group is drawn together (shared colour / y ranges) -----------------------------------
const busy = new Map();
let measuredMs = 0;                                       // time in updateMeasured (the movie breakdown, v8.16)
// v14.3.2: a figure's 1D plots and its maps are separate units (each draw handles one type; a mixed figure's other type was
// skipped when the time slider moved)
const unitOf = p => (groupOf(p) ? `g:${p.link.group}:${p.type}` : `p:${p.id}`);
async function renderAll() {
  try { if (await updateMeasured()) refreshVarValues(); } catch (e) { console.warn("measured variables", e); }
  const seen = new Set(), out = [];
  // v8.5: in focus mode the thumbnails redraw every 4th frame while playing (the focused plot every frame)
  const thin = playing && playTick++ % 4 !== 0;
  const focusUnits = thin ? new Set(S.panels.filter(p => blockKeyOf(p) === focusKey).map(unitOf)) : null;
  for (const p of S.panels) { const u = unitOf(p); if (!seen.has(u)) { seen.add(u); if (thin && !focusUnits.has(u)) continue; out.push(requestRender(p)); } }
  // v5.2: the time label says when the pictures are still on their way (it used to run ahead silently)
  const slow = setTimeout(() => $("tlabel").classList.add("waiting"), 250);
  try { return await Promise.all(out); } finally { clearTimeout(slow); $("tlabel").classList.remove("waiting"); }
}
/** After a measured variable changed: redraw the other plots that use one (tools / picks following it). */
function renderMeasuredUsers(exceptUnit) {
  const names = new Set(Object.values(S.vars).filter(v => v.type === "measured" || v.type === "fit").map(v => v.name)), seen = new Set([exceptUnit]);
  for (const p of S.panels) {
    const u = unitOf(p);
    if (seen.has(u) || ![...refsIn(eff(p))].some(n => names.has(n))) continue;
    seen.add(u); requestRender(p);
  }
}
/** v14.3.2: redraw the plots with these ids, one request per draw unit (a mixed figure: its 1D plots and its maps). */
function renderIds(ids) {
  const seen = new Set(), out = [];
  for (const id of ids) { const p = S.panels.find(q => q.id === id); if (!p || !live.has(p.id) || seen.has(unitOf(p))) continue; seen.add(unitOf(p)); out.push(requestRender(p)); }
  return Promise.all(out);
}
async function requestRender(panel) {
  const unit = unitOf(panel), b = busy.get(unit);
  if (b) { b.again = true; return b.p; }
  const st = { again: false };
  // v8.15.2: a draw that hangs (data that never arrives) no longer blocks this plot for good: after 20 s it stops counting
  // as busy, so the next request draws again (the old one may still finish and draw)
  const dog = setTimeout(() => { if (busy.get(unit) === st) { busy.delete(unit); st.stale = true; console.warn("draw still waiting after 20 s:", unit); } }, 20000);
  st.p = (async () => {
    try {
      do {
        st.again = false;
        // v8.16: during a movie, as in playback, the other plots that use measured variables are not redrawn every
        // frame (they are once it ends); the time spent here is counted for the movie's breakdown
        const m0 = performance.now();
        try { if (await updateMeasured()) { refreshVarValues(); if (!playing && !movieBusy) renderMeasuredUsers(unit); } } catch (e) { console.warn("measured variables", e); }
        measuredMs += performance.now() - m0;
        R.setStyle(styleNow());                         // desktop style (v5.8; sizes may follow variables)
        const g = groupOf(panel);
        // v5.2: a figure whose shared-axis flags went stale (e.g. one plot zoomed its own y) is rebuilt first
        if (g && g.figure && figStale(g)) { rebuildFigure(g, false); st.again = true; continue; }
        const list = (g ? membersOf(g.id) : [panel]).filter(p => live.has(p.id) && p.type === panel.type);
        const members = list.map(p => ({ panel: p, L: live.get(p.id) }));
        try { if ((await (panel.type === "2d" ? render2D(members) : render1D(members))) === true) st.again = true; }   // v6.3: outside legend resized
        catch (e) { console.error(e); for (const m of members) m.L.status.textContent = `⚠ ${e.message}`; }
      } while (st.again && !st.stale);
    } finally { clearTimeout(dog); if (busy.get(unit) === st) busy.delete(unit); }   // same tick as the last "again" check: no lost update
  })();
  busy.set(unit, st);
  await st.p; scheduleLayout();
}
function usedColors() {
  const out = [];
  const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (typeof o.color === "string" && o.color.startsWith("#")) out.push(o.color); Object.values(o).forEach(walk); } };
  walk([S.panels.map(p => p.settings), Object.values(S.groups).map(g => g.settings)]);
  return out;
}
const api = {
  changed(panel, rebuild = true) { if (syncScoped(panel)) rebuild = true; if (rebuild) rebuildPanel(panel); else requestRender(panel); updateTimeBar(); save(); renderSidebar(); },
  usedColors,
  /** v11.0 (human 2026-11-10: "click to set … like a choice for measuring where cursor click sets some things", default
   *  off): a click (no drag) on `panel`'s plot at (X, Y), in its axes' coordinates as drawn. Its settings' click = {x, y}:
   *  "time" moves the time slider (to the nearest output), "$name" sets that number variable. True if it set anything. */
  lineout: (panel, X, Y, add) => lineoutClick(panel, X, Y, add),         // v14.2
  cursor(panel, X, Y) {
    const c = eff(panel).click;
    if (!c) return false;
    let t = null, vars = false;
    for (const [axis, val] of [["x", X], ["y", Y]]) {
      const target = c[axis];
      if (!target || !Number.isFinite(val)) continue;
      if (target === "time") t = val;
      else if (isRef(target)) { const v = S.vars?.[target.slice(1)]; if (v?.type === "number") { v.value = Number(val.toPrecision(5)); vars = true; } }
    }
    if (t !== null) {
      const T = allTimes();
      if (T.length) { let k = 0; T.forEach((x, i) => { if (Math.abs(x - t) < Math.abs(T[k] - t)) k = i; }); S.t = T[k]; }
    }
    if (t === null && !vars) return false;
    updateTimeBar(); if (vars) { renderSidebar(); refreshSettings(); }
    renderAll(); save();
    return true;
  },
  /** a variable was created / changed / renamed / deleted: redraw everything (datasets can change dims) */
  varsChanged(rebuild = true) { if (rebuild) rebuildAll(); else renderSidebar(); save(); },
  /** v8.30: lines whose y axis differs from `panel`'s (a slope / rate line of a plain plot, …) go into a new 1D plot right
   *  after it (after its figure): the same x axis, x function, x label and zoom; y axis `ykind`. */
  plotBeside(panel, lines, ykind) {
    const s = eff(panel), ns = settings1D(s.xaxis, panelRun(s, "1d") ?? lines[0]?.run, ykind);
    Object.assign(ns, { lines, xfn: s.xfn ?? null, logx: !!s.logx, view: s.view ? { ...s.view } : null, labels: { ...(ns.labels || {}), xlabel: s.labels?.xlabel ?? null } });
    spawnPlot(panel, newPanel("1d", ns));                 // v14.5: docked beside it (was: placed after it, not docked)
    toast(`new plot: y axis "${ykind}" (a line's y axis is its own: it does not share one with "${s.ykind}")`);
  },
};
/** Outline the plots that use a variable (hovering it in the sidebar). */
function highlight(ids) { for (const [id, L] of live) L.root.classList.toggle("varhl", !!ids && ids.includes(id)); }

// ---- the board and panel size (v8.0, human 2026-10-14: at 50 % zoom "the buttons on top of panels are TINY", panels
// "squish weirdly" on another screen, mouse zoom didn't work). The desktop is no longer scaled: it is a board of
// columns that fills the window. "zoom" now sets how wide a column is — smaller = more panels side by side — and
// text and buttons keep their size. Ctrl + wheel (mouse) and pinch (trackpad) change it; the browser's own page zoom
// stays on Ctrl + / −. Kept per browser. -----------------------------------------------------------------------
const GAP = 12, BASE_COL = 300, FIG_PAD = 12;           // FIG_PAD: a figure's border + padding, left + right
let zoom = Number(localStorage.getItem("aptvis.panelsize")) || 1;      // (not the old "aptvis.zoom": another meaning)
if (!(zoom >= 0.4 && zoom <= 2.5)) zoom = 1;
window.aptvisZoom = 1;                                    // canvases no longer draw at an extra scale
/** Width the desktop has: the window's width right of the sidebar (CSS px). */
const deskRoom = () => document.documentElement.clientWidth - $("deskwrap").offsetLeft - 10;
/** The board now: N columns of width cw (CSS px) filling the room; a column is about BASE_COL × zoom wide. */
function board() {
  const W = Math.max(320, deskRoom()), N = Math.max(1, Math.round((W - GAP) / (BASE_COL * zoom + GAP)));
  return { W, N, cw: (W - GAP * (N + 1)) / N };
}
const spanW = (span, B) => span * B.cw + (span - 1) * GAP;
let zoomRaf = 0;
function setZoom(z) {
  zoom = Math.max(0.4, Math.min(2.5, z));
  localStorage.setItem("aptvis.panelsize", zoom.toFixed(3));
  $("zoomval").textContent = Math.round(zoom * 100) + "%";
  if (!zoomRaf) zoomRaf = setTimeout(() => { zoomRaf = 0; layout(); placeSettings(); }, 16);   // one layout per frame of wheel events
}

// ---- figures: linked panels docked into one tight grid (rows of plots), like an apt_fig ----------------------
/** Rows of panel ids of a figure group; drops members that left, appends members not yet placed. */
function figRows(g) {
  const mem = membersOf(g.id).map(p => p.id);
  let rows = (g.rows || []).map(r => r.filter(id => mem.includes(id))).filter(r => r.length);
  const missing = mem.filter(id => !rows.some(r => r.includes(id)));
  if (missing.length) { if (rows.length) rows[rows.length - 1].push(...missing); else rows = [missing]; }
  g.rows = rows;
  return rows;
}
// v14.5.1 (architecture review Phase 3): every group is a figure (v8.22), and a plot dragged out of one is unlinked at once,
// so the old "free" state (linked but outside its figure) is gone; old desktops lose it in migrateLinks
const inFigure = p => { const g = groupOf(p); return !!(g && g.figure); };
function makeFigure(g, anchorPanel) {
  g.figure = true; g.cellWidth = g.cellWidth || anchorPanel.width;
  if (g.col == null) { g.col = anchorPanel.col ?? 0; g.cols = anchorPanel.cols; g.span = anchorPanel.span ?? 2; }    // v8: its place on the board
  g.rows = g.rows && g.rows.length ? g.rows : [[anchorPanel.id]];
}
function leaveFigure(p) {
  const g = groupOf(p);
  if (!g || !g.figure) return;
  g.rows = (g.rows || []).map(r => r.filter(id => id !== p.id)).filter(r => r.length);
  const left = g.rows.flat();
  if (left.length < 2) {                                         // a figure of one plot is a normal panel again
    for (const id of left) { const q = S.panels.find(x => x.id === id); if (q) { q.col = g.col; q.cols = g.cols; q.span = g.span; q.width = g.cellWidth || q.width; } }
    g.figure = false; delete g.rows; delete g.pos;
  }
}

// ---- panel DOM ---------------------------------------------------------------------------------------------
/** Settings that change what the panel's header / frame / cell look like need a rebuild; everything else
 *  (colours, limits, axes, view, tools, labels, picks, time, aspect) only a redraw (v5.2: a click went from ~1 s
 *  and 12 paints to one paint per map). Linking/unlinking a row also rebuilds. */
const REBUILD_KEYS = new Set(["run", "q", "lines", "cbarPos", "lockAspect", "tools", "ownTools"]);   // v12.0: tools (the 🛠 badge)
function settingsCtx(panel) {
  const c = ctxPanel(panel), touched = new Set(), set0 = c.set, toggle0 = c.toggleLink;
  // v8.22 (human 2026-11-04: "oh i like the concept of shift click"): with several plots shift-click selected, a
  // setting changed here is set in every selected plot of the same kind (maps / 1D) too; nothing stays tied afterwards
  const others = new Set();
  const alsoSel = (k, v, fn) => {
    if (SEL.size < 2 || !SEL.has(panel.id) || NO_MULTI.has(k)) return;
    for (const id of SEL) {
      const q = S.panels.find(x => x.id === id);
      if (!q || q === panel || q.type !== panel.type) continue;
      fn(ctxPanel(q), v === undefined ? undefined : JSON.parse(JSON.stringify(v))); others.add(q);
    }
  };
  c.set = (k, v) => { touched.add(k); set0(k, v); alsoSel(k, v, (qc, x) => qc.set(k, x)); };
  const setWith0 = c.setWith;
  c.setWith = (k, v, like) => { touched.add(k); setWith0(k, v, like); alsoSel(k, v, (qc, x) => qc.setWith(k, x, like)); };
  c.toggleLink = k => {
    touched.add("__link"); toggle0(k);
    const sc = c.scope(k);                       // v7.2: shared with its column / row again: take their value
    if (sc) { const peer = peersOf(panel, sc, k)[0]; if (peer) copyScoped(peer, panel, k); }
  };
  // v8.22: the 🔗 menu — the figure's plots, which of them share a key, share keys with exactly some of them
  const g0 = groupOf(panel);
  c.members = () => (g0 ? (g0.figure ? figRows(g0).flat().map(P_OF).filter(Boolean) : membersOf(g0.id)) : []);
  c.plotName = q => q.name || live.get(q.id)?.last?.auto?.title || panelType(q);
  c.sharers = k => (g0 ? sharersOf(g0, k).map(q => q.id) : []);
  c.peers = k => { const sc = c.scope(k); return sc ? peersOf(panel, sc, k) : []; };
  c.shareWith = (keys, ids) => { if (g0) { touched.add("__link"); shareKeys(g0, keys, ids, panel); } };
  c.familyScope = f => (g0 ? familyScope(g0, f) : "all");
  c.done = () => {
    const rebuild = !touched.size || [...touched].some(k => k === "__link" || REBUILD_KEYS.has(k));
    touched.clear();
    for (const q of others) api.changed(q, rebuild);
    others.clear();
    api.changed(panel, rebuild);
    if (!rebuild) refreshSettings();
  };
  c.usedColors = usedColors; c.panel = panel; c.api = api;
  c.lastAuto = () => live.get(panel.id)?.last?.auto;                    // v8.4: the automatic labels (✎ buttons)
  // v8.3: the sharing tag's menu sets the figure's rule for a family of settings (as the Sharing table does)
  c.familyOf = familyOf; c.isFigure = () => inFigure(panel);
  c.familyMode = f => { const g = groupOf(panel); return g ? familyMode(g, f) : "own"; };
  c.familyLabel = f => SCOPE_FAMILIES.find(x => x[0] === f)?.[1] || f;
  c.figureScope = (f, mode) => { const g = groupOf(panel); if (g) { setScope(g, f, mode); afterScope(g); } };
  c.lastView = () => {                                 // the window drawn last (placeholders of the typed window)
    const l = live.get(panel.id)?.last;
    return l ? { x0: l.ax.v0, x1: l.ax.v1, y0: Math.min(l.ay.v0, l.ay.v1), y1: Math.max(l.ay.v0, l.ay.v1) } : null;
  };
  return c;
}
/** Click-to-set pop-up (v8, human 2026-10-14): the settings of one thing on the plot (colour bar, x axis, y axis);
 *  changes apply at once and the pop-up follows them; the settings box keeps every row too. */
function quickEdit(panel, what, x, y) {
  const ctx = settingsCtx(panel), done0 = ctx.done, titles = { cbar: "colour bar", x: "x axis", y: "y axis" };
  const g = groupOf(panel);
  let box = null;
  const body = () => [
    el("div", { class: "pop-title" }, `${String(what).startsWith("fit:") ? "fit" : titles[what]} · ${panel.name || eff(panel).q || panel.type}`),
    g ? el("div", { class: "dim" }, "tinted rows are shared with the linked plots") : null,
    el("div", { class: "quick" }, quickBox(ctx, what)),
    el("div", { class: "pop-row" },
      el("button", { onclick: () => { closePopover(); if (settingsFor !== panel.id) toggleSettings(panel); } }, "all settings…"),
      el("button", { onclick: closePopover }, "done"))];
  ctx.done = () => {
    done0();
    // refill after the click that ended the edit has moved the focus, and give the focus back to the same field
    setTimeout(() => {
      if (!box?.isConnected) return;
      if (document.activeElement?.classList?.contains("lbl-in") && box.contains(document.activeElement)) return;   // v8.15.1: typing a label
      const fields = () => [...box.querySelectorAll("input, select, button")], i = fields().indexOf(document.activeElement);
      box.replaceChildren(...body());
      if (i >= 0) fields()[i]?.focus();
    });
  };
  box = popover(x, y, body());
}
api.quick = quickEdit;
function headerData(panel) {
  const c = ctxPanel(panel), s = eff(panel);
  if (panel.type === "2d") return [
    runSelect(s.run, v => { c.set("run", v); api.changed(panel); }, { q: s.q, title: "dataset (or a dataset variable)", class: "hsel" + (isRef(s.run) ? " bound" : "") }),
    groupedSelect(quantityGroups2DFor(s.run, s.q), s.q, v => { changeQuantity2D(c, v); api.changed(panel); }, { title: "quantity", class: "hsel q" }),
  ];
  return datasetChips(panel, api);
}
function linkBadge(panel) {
  const g = groupOf(panel);
  if (g) {
    return el("button", { class: "linkbadge", style: `border-color:${g.color};color:${g.color}`, title: "linked plots", onclick: e => groupPopover(g, e, panel) }, `🔗 ${membersOf(g.id).length}`);
  }
  return el("button", { class: "linkbadge off", title: "not linked\nto link: drag ⠿ onto a dock tab of another plot\nor ⋯ → linked copy" }, "🔗");
}
function groupPopover(g, e, panel = null) {
  const mem = membersOf(g.id);
  popover(e.clientX, e.clientY, [
    el("div", { class: "pop-title" }, `${mem.length} linked plots`),
    ...mem.map(p => el("div", {}, "• " + (p.name || p.type))),
    el("div", { class: "pop-row" },
      g.figure ? el("button", { title: "every plot becomes a plot of its own, keeping its current look (links stay inside a figure)",
        onclick: () => { closePopover(); dissolveFigure(g); for (const p of membersOf(g.id)) unlinkPanel(p); rebuildAll(); save(); } }, "split into separate plots")
               : el("button", { onclick: () => { closePopover(); makeFigure(g, mem[0]); g.rows = [mem.map(p => p.id)]; rebuildAll(); save(); } }, "make a figure (side by side)"),
      panel ? el("button", { onclick: () => { closePopover(); leaveFigure(panel); panel.pos = null; unlinkPanel(panel); rebuildAll(); save(); } }, "unlink this plot") : null),
    el("div", { class: "pop-row" }, el("button", { title: "copy all these linked plots with another dataset", onclick: () => { closePopover(); copyWithDataset(panel, g); } }, "⧉ copy with another dataset…")),
  ]);
}

/** One panel. inFig = drawn as a cell of a figure (compact header, no frame, no own resize corner). */
// ---- tools onto plots (v12.0, human 2026-11-12: "a tool drag that I drag to a plot and that turns on the tool (then a panel
// opens with important things to look at)"; "lets have it be both": drag, or click a tool then click a plot) -----------
let TOOL_DRAG = null, TOOL_ARMED = null, TOOL_COPY = null;      // v13.1: TOOL_COPY = {from: plot id, t} (a 🛠 row dragged)
const toolLabel = k => TOOLS.find(x => x[0] === k)?.[1] ?? k;
/** Mark the plots that can take tool `k` while it is dragged / armed (null: clear). v13.1: or, with `check` (ctx, plot) ->
 *  reason, a tool being copied from another plot ("can't <verb> here"). */
function markToolTargets(k, check = null, verb = null) {
  document.body.classList.toggle("tool-placing", !!k);
  for (const [pid, L] of live) {
    const p = S.panels.find(x => x.id === pid);
    const why = k && p ? (check ? check(settingsCtx(p), p) : toolProblem(settingsCtx(p), k)) : null;   // v12.0.1: refused plots say why
    L.root?.classList.toggle("tool-ok", !!k && !!p && !why);
    L.root?.classList.toggle("tool-no", !!k && !!p && !!why);
    if (L.root) { if (why) L.root.dataset.toolwhy = `can't ${verb ?? `add ${toolLabel(k)}`} here: ${why}`; else delete L.root.dataset.toolwhy; }
  }
}
/** v13.1: why the tool being copied (TOOL_COPY) cannot go on plot p, or null. */
const copyCheck = src => (ctx, p) => {
  if (p.id === src.from) return "it is already on this plot";
  const fp = S.panels.find(x => x.id === src.from);
  return copyProblem(ctx, src.t, fp ? settingsCtx(fp) : null);
};
function copyTool(panel, src) {
  const why = copyCheck(src)(settingsCtx(panel), panel);
  if (why) return toast(`can't copy it here: ${why}`, true);
  copyToolTo(settingsCtx(panel), src.t);
  toast(`copied to ${panel.name || panelType(panel)} (its 🛠 lists it; click it there to change it)`);
}
function placeTool(panel, k, ev) {
  const why = toolProblem(settingsCtx(panel), k);
  if (why) return toast(`can't add ${toolLabel(k)} here: ${why}`, true);
  const ctx = settingsCtx(panel), t = addTool(ctx, k);
  setTimeout(() => openToolEditor(settingsCtx(panel), t.id, ev), 60);     // its card, once the plot has the tool
}
/** v15.3 (public-release docs; human: people "may not know to ask for how tools work"): every tool — the core's and
 *  the plugins' — with its help, folder and where it goes; "place" arms it like a click in the Tools tab. The same list
 *  is written to TOOLS.md (tools/tools_md.mjs) for the repo. */
function helpDialog() {
  const items = TOOLS.map(([k, label, help, where, folder]) => ({ name: `${folder} · ${label}`, info: `${help} — on ${toolWhere(where)}`,
    actions: [["place", () => setTimeout(() => armTool(k), 0)]] }));
  dialog("Tools (Tools tab in the sidebar; hover anything for help)", items,
    [["how to use (HOWTOUSE.md)", () => window.open("../HOWTOUSE.md", "_blank")], ["bring your own data", () => window.open("../BRING_YOUR_DATA.md", "_blank")]]);
}
function toolDrag(k) { TOOL_DRAG = k; markToolTargets(k); }
function armTool(k) {
  TOOL_ARMED = k; markToolTargets(k);
  toast(`click a plot to add “${toolLabel(k)}” (Esc: cancel)`);
}
function disarmTool() { if (TOOL_ARMED) { TOOL_ARMED = null; markToolTargets(null); } }
document.addEventListener("keydown", e => { if (e.key === "Escape") disarmTool(); });
document.addEventListener("click", e => {                     // the click after "click a tool": onto that plot
  if (!TOOL_ARMED) return;
  if (e.target.closest(".toolpal")) return;                   // (choosing another tool re-arms)
  const hit = [...live].find(([, L]) => L.root?.contains(e.target)), panel = hit && S.panels.find(x => x.id === hit[0]);
  const k = TOOL_ARMED; disarmTool();
  if (!panel) return;
  e.preventDefault(); e.stopPropagation();
  placeTool(panel, k, e);
}, true);
/** The plot's tools as a small "🛠 n" button (none: nothing): click lists them; each opens its card. */
function toolsBadge(panel) {
  const list = toolList(settingsCtx(panel));
  if (!list.length) return null;
  return el("button", { class: "toolbadge", title: `tools on this plot:\n${list.map(x => "• " + x.text).join("\n")}\n\nclick: open one · add more: the sidebar's Tools tab (drag one onto the plot) or ⚙ → Tools`,
    onclick: e => popover(e.clientX, e.clientY, [el("div", { class: "pop-title" }, "tools on this plot"),
      ...toolList(settingsCtx(panel)).map(({ t, text }) => {
        // v13.1: drag a row onto another plot = copy the tool there (same look and settings)
        const b = el("button", { class: "linkish tooldrag" + (t.visible ? "" : " dim"), draggable: "true", title: "click: open its card · drag onto another plot: copy it there",
          onclick: ev => { closePopover(); openToolEditor(settingsCtx(panel), t.id, ev); } }, text);
        b.addEventListener("dragstart", e => {
          e.dataTransfer.setData("application/x-aptvis-toolcopy", String(t.id)); e.dataTransfer.effectAllowed = "copy";
          TOOL_COPY = { from: panel.id, t }; markToolTargets("copy", copyCheck(TOOL_COPY), "copy it");
        });
        b.addEventListener("dragend", () => { TOOL_COPY = null; markToolTargets(null); });
        // v14.2.2 (human 2026-11-13: "more in that dropdown than just the list (maybe the x to delete etc"): show / remove
        const shown = el("input", { type: "checkbox", checked: t.visible !== false, title: "shown (off: kept, not drawn)",
          onchange: ev => setToolShown(settingsCtx(panel), t.id, ev.target.checked) });
        const del = el("button", { class: "vdel", title: "remove this tool (a shared one: from every linked plot)", onclick: () => { closePopover(); removeToolById(settingsCtx(panel), t.id); } }, "×");
        return el("div", { class: "toolbadgerow" }, shown, b, del);
      }),
      el("div", { class: "dim", style: "margin-top:4px" }, "add: sidebar → Tools (drag onto the plot) or ⚙ → Tools · drag a tool above onto another plot: copy it")]) }, `🛠 ${list.length}`);
}
function buildPanel(panel, inFig = false) {
  const g = groupOf(panel), s = eff(panel);
  const root = el("div", { class: "panel" + (inFig ? " infig" : "") + (g && !inFig ? " islinked" : "") + (settingsFor === panel.id ? " editing" : "") + (SEL.has(panel.id) ? " selected" : ""),
    style: inFig ? `width:${g.cellWidth}px` : `width:${panel.width || 560}px;left:-10000px;top:0` + (g ? `;border-color:${g.color}` : "") });
  // v8.22: shift-click anywhere on the plot (not in a text box or menu) selects it; nothing else happens on that click
  for (const ev of ["pointerdown", "mousedown", "click"]) root.addEventListener(ev, e => {
    if (!e.shiftKey || e.button !== 0 || e.target.closest("input, select, textarea")) return;
    e.preventDefault(); e.stopPropagation();          // (a cancelled pointerdown also stops the mousedown that follows)
    // v14.2: shift-click on a map with a lineout, inside its plot: one more lineout there (not a selection)
    const L = live.get(panel.id), lp = L?.last;
    if (panel.type === "2d" && lp?.ax && e.target === L.canvas && (eff(panel).tools || []).some(t => t.type === "lineout" && t.visible !== false)) {
      const r = L.canvas.getBoundingClientRect(), x = (e.clientX - r.left) * (L.canvas.width / r.width), y = (e.clientY - r.top) * (L.canvas.height / r.height);
      if (x >= lp.plot.x && x <= lp.plot.x + lp.plot.w && y >= lp.plot.y && y <= lp.plot.y + lp.plot.h) { if (ev === "pointerdown") lineoutClick(panel, lp.ax.from(x), lp.ay.from(y), true); return; }
    }
    if (ev === "pointerdown") toggleSel(panel);
  }, true);
  const grip = el("span", { class: "grip", title: "drag to move · drop on a dock tab to join another plot" }, "⠿");
  grip.addEventListener("pointerdown", e => startDrag(e, { panel }));
  // v8.1 (UI review §A2): the header holds what identifies the panel and its data; everything else is in ⋯ (the
  // same menu as the settings box's) and in the small bar that appears over the plot (⚙ ⟲ PNG, §D1)
  // v8.2 (human 2026-10-15: "I need the settings as a one button click its the most important one"): ⚙ stays in the
  // header, one click; ⋯ holds the rest (PNG, movie, copies, template, remove)
  const gear = el("button", { class: "gear" + (settingsFor === panel.id ? " on" : ""), title: "settings", onclick: () => toggleSettings(panel) }, "⚙");
  const more = el("button", { class: "pmenu", title: "PNG, movie, copies, template, remove", onclick: e => panelMenu(panel, e) }, "⋯");
  root.append(inFig
    ? el("div", { class: "phead compact" }, grip, ...headerData(panel), toolsBadge(panel), gear, more)
    : el("div", { class: "phead" }, grip, el("span", { class: "badge" }, panel.type.toUpperCase()),
        el("input", { class: "pname", value: panel.name || "", placeholder: panel.type === "2d" ? "map" : "1D plot", onchange: e => { panel.name = e.target.value || null; save(); } }),
        ...headerData(panel), toolsBadge(panel), linkBadge(panel), gear, more));
  // v12.0: a tool dragged from the sidebar's Tools tab lands here
  // (v12.0.1: a refused plot takes the drop too, and says why)
  root.addEventListener("dragover", e => { if (TOOL_DRAG || TOOL_COPY) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
  root.addEventListener("drop", e => {
    if (TOOL_COPY && e.dataTransfer.getData("application/x-aptvis-toolcopy")) {     // v13.1: a tool copied from another plot
      e.preventDefault(); const src = TOOL_COPY; TOOL_COPY = null; markToolTargets(null); closePopover(); copyTool(panel, src); return;
    }
    const k = e.dataTransfer.getData("application/x-aptvis-tool");
    if (!k) return;
    e.preventDefault(); toolDrag(null); placeTool(panel, k, e);
  });
  if (!inFig) root.append(el("div", { class: "thumbname" }, panel.name || panelType(panel)));          // v8.5 (focus mode)
  const L = { panel, root, wrap: el("div", { class: "pwrap" }), canvas: el("canvas"), status: el("div", { class: "status" }), last: null, ac: new AbortController() };
  const tools = el("div", { class: "ptools" },
    el("button", { title: "reset the zoom (as a double-click on the plot)", onclick: () => resetView(panel) }, "⟲"),
    el("button", { title: "save as PNG (always light)", onclick: () => savePNG(panel) }, "PNG"));
  L.wrap.append(L.canvas, tools, L.status);
  root.append(L.wrap);
  if (!inFig) addResize(root, [panel], panel, L.canvas);
  (panel.type === "2d" ? attach2D : attach1D)(panel, L, api);
  // redraw on a real size change only (the render records the width it drew at)
  L.ro = new ResizeObserver(() => { const w = L.wrap.clientWidth; if (w && w === L.renderedW) return; requestRender(panel); });
  L.ro.observe(L.wrap);
  live.set(panel.id, L);
  return root;
}
/** Release what a panel registered outside itself (window listener, resize observer): v5.2 leak fix. */
function disposeL(L) { if (!L) return; L.ac?.abort(); L.ro?.disconnect(); }
const figROs = new Map();                                 // group id -> the figure's ResizeObserver

/** Which labels each plot of a figure can drop (human 2026-10-02: shared axes by default). A plot hides its
 *  y labels when its left neighbour has the same y axis (same axis quantity, scale and zoom), and its x labels
 *  when the plot below has the same x axis. */
function axisKeys(p) {
  const s = eff(p);
  if (p.type === "1d") return { x: JSON.stringify([s.xaxis, s.logx, s.view]), y: JSON.stringify([yAxisId(s), s.logy, s.abs, s.ylim, s.ymin, s.ymax, s.yview, ownY(p) ? p.id : null]) };   // v14.3.3
  const src = srcOf(s.run, s.q), [xd, yd] = src ? axesFor(s, src) : [s.xdim, s.ydim], merid = !!(src && isSpherical(src, xd, yd) && s.meridional);
  const v = s.view || {};
  return { x: JSON.stringify([xd, merid, merid ? [v, s.mirror] : [v.x0, v.x1], s.logx]), y: JSON.stringify([yd, merid, merid ? [v, s.mirror] : [v.y0, v.y1], s.logy]) };
}
function figFlags(g, rows) {
  const byId = id => S.panels.find(p => p.id === id), out = new Map();
  rows.forEach((r, i) => r.forEach((id, j) => {
    const p = byId(id), k = axisKeys(p), left = j > 0 ? byId(r[j - 1]) : null, below = rows[i + 1]?.[j] != null ? byId(rows[i + 1][j]) : null;
    out.set(id, {
      hideY: g.shareY !== false && !!left && left.type === p.type && axisKeys(left).y === k.y,
      hideX: g.shareX !== false && !!below && below.type === p.type && axisKeys(below).x === k.x,
      sideBySide: r.length > 1, refW: g.cellWidth,
    });
  }));
  return out;
}
/** Thin draggable gap between plots: changes the spacing of the whole figure (columns or rows). */
function gutter(g, kind) {
  const size = kind === "v" ? (g.gapX ?? 4) : (g.gapY ?? 4);
  const grab = el("div", { class: "grab", title: "drag to change the spacing of the whole figure" });
  const gut = el("div", { class: `gutter ${kind}`, style: kind === "v" ? `width:${size}px` : `height:${size}px` }, grab);
  grab.addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    const fig = figEls.get(g.id), x0 = e.clientX, y0 = e.clientY, s0 = size;
    const k = fig ? Number(getComputedStyle(fig).getPropertyValue("--k")) || 1 : 1;   // v8.9.2: unscaled px
    const move = ev => {
      const v = Math.max(0, Math.min(80, Math.round(s0 + (kind === "v" ? ev.clientX - x0 : ev.clientY - y0) / k)));
      if (kind === "v") g.gapX = v; else g.gapY = v;
      fig?.querySelectorAll(`.gutter.${kind}`).forEach(n => { n.style[kind === "v" ? "width" : "height"] = v + "px"; });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); layout(`g:${g.id}`); refreshSettings(); save(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  });
  return gut;
}

/** A figure: one frame, a header, and rows of plots; shared axes drop repeated labels so plots sit close. */
function buildFigure(g) {
  const rows = figRows(g), mem = rows.flat().map(id => S.panels.find(p => p.id === id)).filter(Boolean);
  const fig = el("div", { class: "figure", style: `left:-10000px;top:0;border-color:${g.color}` });
  const grip = el("span", { class: "grip", title: "drag the whole figure" }, "⠿");
  grip.addEventListener("pointerdown", e => startDrag(e, { group: g }));
  fig.append(el("div", { class: "fighead" }, grip,
    el("button", { class: "linkbadge", style: `border-color:${g.color};color:${g.color}`, onclick: e => groupPopover(g, e) }, `🔗 figure · ${mem.length}`),
    el("input", { class: "pname", value: g.name || "", placeholder: "figure", onchange: e => { g.name = e.target.value || null; save(); } }),
    el("button", { title: "copy this figure with another dataset (as new rows, or a separate figure)", onclick: () => copyWithDataset(null, g) }, "⧉ dataset"),
    el("button", { title: "save the whole figure as one PNG", onclick: () => saveFigurePNG(g) }, "PNG"),
    el("button", { title: "save the whole figure as a movie (mp4, made by ffmpeg on the server)", onclick: () => saveMovie(null, g) }, "🎬")));
  fig.append(el("div", { class: "thumbname" }, g.name || `figure · ${mem.map(p => p.name || panelType(p)).slice(0, 2).join(", ")}${mem.length > 2 ? " …" : ""}`));
  const grid = el("div", { class: "figgrid" }), flags = figFlags(g, rows);
  rows.forEach((r, i) => {
    if (i > 0) grid.append(gutter(g, "h"));
    const rowEl = el("div", { class: "figrow" });
    r.forEach((id, j) => {
      const p = S.panels.find(q => q.id === id);
      if (!p) return;
      if (j > 0) rowEl.append(gutter(g, "v"));
      const f = flags.get(id), cell = buildPanel(p, true), L = live.get(p.id);
      // equal plot areas: a cell is narrower by exactly the label / colour-bar space it doesn't need (style-aware)
      const full = margins2D(null, false), save2D = p.type === "2d" && cbarIsTop(eff(p), f) ? full.r - margins2D(null, true).r : 0;
      L.figSave = (f.hideY ? full.l - 8 : 0) + save2D;                 // label / colour-bar space this cell drops
      cell.style.width = g.cellWidth - L.figSave + "px";
      L.fig = f;
      rowEl.append(cell);
    });
    grid.append(rowEl);
  });
  fig.append(grid);
  addResize(fig, mem, mem[0], null, g);
  figROs.get(g.id)?.disconnect();
  const ro = new ResizeObserver(() => scheduleLayout()); ro.observe(fig); figROs.set(g.id, ro);
  figEls.set(g.id, fig);
  return fig;
}

/** The aspect setting is (plot height + 72 px of standard title/axis margins) / reference width, where the
 *  reference width is the panel width (or the figure's cell width). Lock and resize both use it, so locking
 *  keeps exactly the shape on screen (bug: it used the canvas ratio, which includes colour bars / margins). */
const aspectFor = (plotH, refW) => Math.max(0.15, Math.min(3, (plotH + 72) / Math.max(refW, 1)));
/** Resize corner + aspect lock for a free panel (or a whole figure: all plots get the new width). */
function addResize(box, panels, ref, canvas, g = null) {
  const c = ctxPanel(ref), locked = eff(ref).lockAspect;
  const toggleLock = () => {
    const last = live.get(ref.id)?.last;
    if (last) c.set("aspect", aspectFor(last.plotHcss, last.refWcss));    // keep the current shape
    c.set("lockAspect", !c.get("lockAspect")); rebuildAll(); save();
  };
  const lock = el("button", { class: "lockbtn" + (locked ? " on" : ""), title: locked ? "aspect ratio locked: resizing scales the plots (click to unlock)" : "aspect ratio free: drag the corner up/down to change it (click to lock the current shape)", onclick: toggleLock }, locked ? "🔒" : "🔓");
  const handle = el("div", { class: "resize", title: "drag to resize: left / right the width (it snaps to whole columns within 8 px), up / down the shape (unless 🔒)" });
  handle.addEventListener("pointerdown", e => {
    e.preventDefault(); try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    // v8: the width on the board's columns (v8.9.4: free, magnetic to whole columns); up / down the shape (aspect unlocked)
    const B = board(), last = live.get(ref.id)?.last, x0 = e.clientX, y0 = e.clientY, owner = g || ref;
    const span0 = Math.min(Math.max(1, owner.span || 1), B.N), w0 = spanW(span0, B);
    const node = g ? figEls.get(g.id) : live.get(ref.id)?.root;        // it stays in the column it is in now
    const kf = node ? Number(getComputedStyle(node).getPropertyValue("--k")) || 1 : 1;
    const refW0 = last?.refWcss || (g ? g.cellWidth : w0), plotH0 = last?.plotHcss || refW0 * 0.6;
    // v8.9.2 (human 2026-10-15: focus is "literally just a different way of displaying the figures"): in focus mode
    // the corner does what it does on the grid — columns left / right, shape up / down — in grid pixels (the screen's
    // over the scale); the focus layout then shows it at its scale, made smaller only if it would leave the screen
    const move = ev => {
      // v8.9.4 (human 2026-10-15: "my dragger clicks in huge increments in horizontal but goes smoothly in vertical"):
      // the width follows the pointer and snaps to whole columns only when it is close (v8.9.8: 8 px); in focus mode the
      // block stays centred, so it grows on both sides (×2) and the corner stays under the pointer
      let sp = Math.min(B.N, Math.max(1, (w0 + 2 * (ev.clientX - x0) / kf + GAP) / (B.cw + GAP)));
      sp = Math.abs(sp - Math.round(sp)) * (B.cw + GAP) < 8 ? Math.round(sp) : Math.round(sp * 100) / 100;
      if (sp !== owner.span) { owner.span = sp; scheduleLayout(); }
      if (!c.get("lockAspect")) {                                       // free: the plot follows the pointer down/up
        const refW = g ? g.cellWidth : spanW(sp, B);
        c.set("aspect", aspectFor(plotH0 * refW / refW0 + (ev.clientY - y0) / kf, refW));
        scheduleLayout();
        for (const p of panels) requestRender(p);
      }
    };
    const up = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); layout(); save(); };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up);
  });
  box.append(lock, handle);
}

function rebuildPanel(panel) {
  if (inFigure(panel)) rebuildFigure(groupOf(panel));
  else {
    const oldL = live.get(panel.id), old = oldL?.root;
    disposeL(oldL);
    const fresh = buildPanel(panel);
    if (old && old.isConnected) old.replaceWith(fresh); else $("desktop").append(fresh);
  }
  requestRender(panel); refreshSettings(); scheduleLayout();
}
function rebuildFigure(g, render = true) {
  for (const id of figRows(g).flat()) disposeL(live.get(id));
  const old = figEls.get(g.id), fresh = buildFigure(g);
  if (old && old.isConnected) old.replaceWith(fresh); else $("desktop").append(fresh);
  if (render) for (const id of figRows(g).flat()) { const p = S.panels.find(q => q.id === id); if (p) requestRender(p); }
}
/** Shared-axis flags computed now differ from the ones the figure was built with? */
function figStale(g) {
  for (const [id, f] of figFlags(g, figRows(g))) {
    const L = live.get(id);
    if (L?.fig && (L.fig.hideX !== f.hideX || L.fig.hideY !== f.hideY || L.fig.sideBySide !== f.sideBySide)) return true;
  }
  return false;
}
function rebuildAll() {
  R.setStyle(styleNow());
  for (const L of live.values()) disposeL(L);
  for (const ro of figROs.values()) ro.disconnect();
  live.clear(); figEls.clear(); figROs.clear();
  const nodes = [], done = new Set();
  for (const p of S.panels) {
    if (inFigure(p)) { const g = groupOf(p); if (!done.has(g.id)) { done.add(g.id); nodes.push(buildFigure(g)); } }
    else nodes.push(buildPanel(p));
  }
  $("desktop").replaceChildren(...nodes);
  $("dname").textContent = S.desktopName || "unsaved desktop";
  updateTimeBar(); renderAll(); scheduleLayout(); refreshSettings(); renderSidebar();
}
/** v14.0: a new 1D plot of a table: x = column `x`, one table line per y column, points coloured by `by`. */
function newTablePlot(table, x, ys, by) {
  const ns = settings1D(tabAxis(table, x), null);
  ns.lines = ys.map(y => newTabLine(table, y, by)); ns.tools = [];
  if (ys.length === 1) ns.labels = { ...(ns.labels || {}), ylabel: colLabel(tableOf(table), ys[0]) };   // the y axis: its column
  addPanel(newPanel("1d", ns, { name: table }));
  toast(`a plot of table ${table} (hover a point: its row; ⚙ → x: another column; + line: another column)`);
}
/** v14.1: a new plot made from period tool t on `panel` (what: cycleplots.js CYC_WHAT), right after it; it follows the tool. */
function newCycPlot(panel, t, what) {
  const v = toolValues(panel.id, t.id), dim = isPerCurve(what) ? curveDim(v) : null;
  if (isPerCurve(what) && !dim) { toast("the period tool's curves do not differ by a pick (r_max …): cast them to a table instead (→ table)", true); return; }
  const xaxis = what === "ac" ? "lag" : dim ?? v?.xaxis ?? eff(panel).xaxis;
  const ns = settings1D(xaxis, null);
  ns.lines = [newCycLine(t.id, what, panel.id)];
  if (what !== "sp" && what !== "sr") ns.tools = [];
  ns.labels = { ...(ns.labels || {}), ylabel: CYC_WHAT[what] };
  // (human 2026-11-13: "make the new plot linked in the same panel"): docked under its source plot, in its figure
  spawnPlot(panel, newPanel("1d", ns, { name: `${CYC_WHAT[what]} · ${panel.name || "plot"}` }));   // v14.2.1: beside its source (v14.5: spawnPlot)
  toast(`${CYC_WHAT[what]}: a new plot beside its source that follows the period tool (its window, detrend)`);
}
/** v14.2: the 1D plot of map `panel`'s lineout tool t (its quantity along the tool's axis, one curve per position). */
function newLineoutPlot(panel, t) {
  const g = loGeom(panel.id, t.id);
  if (g.error) { toast(`lineout: ${g.error}`, true); return; }
  if (!loPositions(t).length && !isRef(t.at)) { t.at = [Number(Number(loDefault(g)).toPrecision(4))]; }
  const ns = settings1D(g.along, null);
  ns.lines = [newLoLine(panel.id, t.id)];                 // (its y label: automatic, from the map's quantity as it is now)
  const np = newPanel("1d", ns, { name: `lineout · ${panel.name || g.src.label}` });
  t.plot = np.id;
  // (human 2026-11-13: "make the new plot linked in the same panel"; "I want it to the side not below by default")
  spawnPlot(panel, np);                                   // v14.5: the one way to make a plot from a plot
  toast("lineout: click the map to move it, shift-click on the map to add one");
}
/** v14.2: a lineout tool's direction changed: its plots' x axis follows. */
function retargetLineout(panel, t) {
  const g = loGeom(panel.id, t.id);
  if (g.error) return;
  for (const p of S.panels) if (p.type === "1d" && (eff(p).lines || []).some(l => l.lo?.tool === t.id)) { ctxPanel(p).set("xaxis", g.along); ctxPanel(p).set("view", null); }
  rebuildAll(); save();
}
/** v14.2: a click on map `panel` at its plot coordinates (X, Y): its first lineout tool's last position moves there (add: one more). */
function lineoutClick(panel, X, Y, add) {
  const I = ctxPanel(panel), tools = I.get("tools") || [], t = tools.find(x => x.type === "lineout" && x.visible !== false);
  if (!t) return false;
  const g = loGeom(panel.id, t.id);
  if (g.error) return false;
  const v = Number(loValueAt(g, X, Y).toPrecision(4)), P = loPositions(t);
  if (!Number.isFinite(v)) return false;
  const nv = add ? [...P, v] : P.length ? [...P.slice(0, -1), v] : [v];
  if (isRef(t.at)) { const x = S.vars[t.at.slice(1)]; if (x) x.value = nv.length > 1 ? nv : nv[0]; }
  else t.at = nv;
  I.set("tools", tools); save(); requestRender(panel);
  return true;
}
/** v14.0: a table changed: its plots redraw (rebuild: every plot, e.g. a table renamed or deleted), the sidebar, save. */
function tablesChanged(rebuild = false) {
  if (rebuild) rebuildAll();
  else for (const p of S.panels) if (p.type === "1d" && (eff(p).lines || []).some(l => lineReads(l, { table: true }))) requestRender(p);
  renderSidebar(); refreshTableCard(); save();
}
function addPanel(panel, at = S.panels.length) {
  delete panel.pos;
  if (panel.span == null) panel.span = Math.min(2, board().N);
  if (at >= S.panels.length) panel.col = null;            // appended: the first free spot (a copy keeps its original's column)
  S.panels.splice(at, 0, panel); rebuildAll(); save();
  setFocus(blockKeyOf(panel));                              // v8.9.2: a new plot is the one you look at
}
function removePanel(panel) {
  if (settingsFor === panel.id) closeSettings();
  leaveFigure(panel); if (groupOf(panel)) unlinkPanel(panel);
  S.panels = S.panels.filter(p => p !== panel);
  rebuildAll(); save();
}
// ---- theme (v8, human 2026-10-14: "dark plots maybe? … (maybe have the three options) I want saved figures to be
// regular color though"): light · dark page (plots as always) · dark page and dark plots. Per browser (localStorage).
// Exports (PNG, figure PNG, movies) are always drawn light: lightForExport() redraws light, then back.
const THEMES = [["light", "☀", "light"], ["dark", "◐", "dark page, plots as usual"], ["darkplots", "●", "dark page and dark plots (PNGs and movies stay light)"]];
let theme = localStorage.getItem("aptvis.theme") || "light";
function setTheme(t, redraw = true) {
  theme = THEMES.some(([k]) => k === t) ? t : "light";
  localStorage.setItem("aptvis.theme", theme);
  document.body.classList.toggle("dark", theme !== "light");
  R.setPlotTheme(theme === "darkplots");
  for (const b of document.querySelectorAll("#theme button")) b.classList.toggle("on", b.dataset.t === theme);
  if (redraw) renderAll();
}
async function lightForExport(draw, panels) {
  if (!R.plotThemeDark()) return draw();
  R.setPlotTheme(false);
  try { await Promise.all(panels.map(p => requestRender(p))); return await draw(); }
  finally { R.setPlotTheme(true); renderAll(); }
}
async function savePNG(panel) {
  if (!live.get(panel.id)?.canvas) return;
  const name = (panel.name || panel.type).replace(/[^\w.-]+/g, "_") + `_t${R.fmt(S.t)}.png`;
  const blob = await lightForExport(() => new Promise(r => live.get(panel.id).canvas.toBlob(r)), [panel]);
  const a = el("a", { href: URL.createObjectURL(blob), download: name }); a.click(); URL.revokeObjectURL(a.href);
}
/** The figure's plots as one image (rows and columns as on screen). */
function figureCanvas(g) {
  const rows = figRows(g).map(r => r.map(id => live.get(id)?.canvas).filter(Boolean)).filter(r => r.length), gap = 6;
  if (!rows.length) return null;
  const W = Math.max(...rows.map(r => r.reduce((a, c) => a + c.width + gap, -gap))), H = rows.reduce((a, r) => a + Math.max(...r.map(c => c.height)) + gap, -gap);
  const out = el("canvas", { width: W, height: H }), ctx = out.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  let y = 0;
  for (const r of rows) { let x = 0; for (const c of r) { ctx.drawImage(c, x, y); x += c.width + gap; } y += Math.max(...r.map(c => c.height)) + gap; }
  return out;
}
// ---- movies (v5.18, human 2026-10-06: "be able to save a movie as well as the png … I liked ffmpeg for my other
// library so why not just stick with that? … on each panel like png"). Each step of the time range is drawn like the
// PNG export and sent to serve.py, which runs ffmpeg (libx264, yuv420p — as Aperture_plotting's movies) into
// visualizer/movies/<name>.mp4; the browser then downloads it. One movie at a time; the slider comes back after.
let movieBusy = false;
async function saveMovie(panel = null, g = null) {
  if (movieBusy) return toast("a movie is already being made", true);
  if (!hasFeature("movie")) return toast("Movies are made by ffmpeg through serve.py: restart serve.py (the new one offers movies), then reload this page.", true);
  const T0 = allTimes();
  if (T0.length < 2) return toast("nothing to animate: this desktop has no time axis", true);
  const stem = String((panel ? panel.name || panel.type : g.name || "figure") || "movie").replace(/[^\w.-]+/g, "_").slice(0, 60);
  const name = el("input", { type: "text", size: 24, value: stem }), fps = el("input", { type: "text", size: 4, value: String(S.fps) });
  const from = el("input", { type: "text", size: 6, placeholder: R.fmt(T0[0]) }), to = el("input", { type: "text", size: 6, placeholder: R.fmt(T0.at(-1)) });
  const every = el("input", { type: "text", size: 3, value: "1" }), scale = el("input", { type: "text", size: 4, value: "100" });
  const frow = (lab, ...c) => el("div", { class: "pop-row" }, el("span", { class: "lab" }, lab), ...c);
  if (!(await askForm("Save a movie (mp4)", [frow("name", name, el("span", { class: "dim" }, ".mp4")), frow("fps", fps),
    frow("times", from, "–", to, el("span", { class: "dim" }, "(empty = the ⏱ range; variables work)")), frow("every", every, el("span", { class: "dim" }, "step(s)")),
    frow("size", scale, el("span", { class: "dim" }, "% of the plot as drawn (smaller = faster to send)")),
    el("div", { class: "dim", title: "each step is drawn as in the PNG (always light) and sent to serve.py; ffmpeg (libx264) makes visualizer/movies/<name>.mp4, then it downloads" },
      `${T0.length} steps in the ⏱ range ⓘ`)], "make movie"))) return;
  const val = inp => { const r = parseNumRef(inp.value); return r.error || r.value === null ? null : Number(isRef(r.value) ? numOf(r.value) : r.value); };
  const lo = val(from) ?? -Infinity, hi = val(to) ?? Infinity, nth = Math.max(1, Math.round(Number(every.value) || 1));
  const f = Number(fps.value), k100 = Math.min(400, Math.max(10, Number(scale.value) || 100)) / 100;
  const nm = name.value.trim().replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "") || "movie";
  if (!(f >= 0.1 && f <= 120)) return toast("fps: a number from 0.1 to 120", true);
  const T = T0.filter(t => t >= Math.min(lo, hi) - 1e-9 && t <= Math.max(lo, hi) + 1e-9).filter((_, k) => k % nth === 0);
  if (T.length < 2) return toast("fewer than 2 steps in that range", true);
  if (playing) play();                                    // pause playback
  movieBusy = true;
  const darkPlots = R.plotThemeDark();
  if (darkPlots) R.setPlotTheme(false);                   // movies are always drawn light (v8)
  const t0 = S.t, job = "m" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  let cancel = false, failed = null, size = null, upload = Promise.resolve(), sent = 0;
  const text = el("span", {}, "starting…");
  const bar = el("div", { class: "movieprog" }, "🎬 ", text, el("button", { onclick: () => { cancel = true; text.textContent = "stopping…"; } }, "cancel"));
  document.body.append(bar);
  const post = (what, body, type = "application/json") => fetch(apiUrl("movie/" + what), { method: "POST", headers: { "Content-Type": type }, body });
  // v8.16: where the time goes (human 2026-10-30: "why did my movie take 10 minutes to save when I already have
  // everything cached?"): drawing, PNG encoding, waiting for the upload — shown while it runs and at the end
  const took = { draw: 0, png: 0, wait: 0 }, tStart = performance.now(), m0 = measuredMs;
  const per = n => `per frame: draw ${Math.round(took.draw / n)} ms (measured variables ${Math.round((measuredMs - m0) / n)} ms) · ` +
    `PNG ${Math.round(took.png / n)} ms · upload wait ${Math.round(took.wait / n)} ms`;
  try {
    for (let k = 0; k < T.length && !cancel && !failed; k++) {
      let c0 = performance.now();
      S.t = T[k]; updateTimeBar();
      await (panel ? requestRender(panel) : renderIds(membersOf(g.id).map(p => p.id)));   // waits until every frame of the plot(s) is drawn
      let c1 = performance.now(); took.draw += c1 - c0;
      const src = panel ? live.get(panel.id)?.canvas : figureCanvas(g);
      if (!src) { failed = "the plot is gone"; break; }
      // every frame has the first one's size (a constant frame for ffmpeg; even sides for yuv420p)
      if (!size) size = { w: 2 * Math.round(src.width * k100 / 2), h: 2 * Math.round(src.height * k100 / 2) };
      const frame = el("canvas", { width: size.w, height: size.h }), fx = frame.getContext("2d");
      fx.fillStyle = "#fff"; fx.fillRect(0, 0, size.w, size.h); fx.drawImage(src, 0, 0, src.width * k100, src.height * k100);
      const blob = await new Promise(r => frame.toBlob(r, "image/png"));
      c0 = performance.now(); took.png += c0 - c1;
      await upload;                                       // one upload in flight while the next step is drawn
      took.wait += performance.now() - c0;
      if (failed) break;
      sent += blob.size;
      upload = post(`frame?job=${job}&i=${k}`, blob, "image/png")
        .then(async r => { if (!r.ok) failed = (await r.json().catch(() => ({}))).error || `HTTP ${r.status}`; }).catch(e => { failed = e.message; });
      text.textContent = `frame ${k + 1}/${T.length} · t = ${R.fmt(T[k])} · ${(sent / 1e6).toFixed(1)} MB sent · ${per(k + 1)}`;
    }
    const c0 = performance.now();
    await upload;
    took.wait += performance.now() - c0;
    const summary = `${T.length} frames in ${Math.round((performance.now() - tStart) / 1000)} s (${per(T.length)})`;
    console.info("movie:", summary, took);
    if (cancel || failed) { await post("cancel", JSON.stringify({ job })).catch(() => {}); toast(cancel ? "movie cancelled" : `movie failed: ${failed}`, !cancel); return; }
    text.textContent = `ffmpeg is making ${nm}.mp4 on the server …`;
    const r = await post("finish", JSON.stringify({ job, name: nm, fps: f })), j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    if (!j.ok) { toast(`movie failed: ${j.error}`, true); return; }
    const link = el("a", { href: apiUrl("").replace(/api\/$/, "") + j.file, download: j.file.split("/").pop() });
    document.body.append(link); link.click(); link.remove();
    toast(`movie saved on the server: visualizer/${j.file}, ${summary} — downloading`);
  } catch (e) { toast(`movie failed: ${e.message}`, true); }
  finally { movieBusy = false; bar.remove(); if (darkPlots) R.setPlotTheme(true); S.t = t0; updateTimeBar(); renderAll(); }
}
async function saveFigurePNG(g) {
  const blob = await lightForExport(() => { const out = figureCanvas(g); return out ? new Promise(r => out.toBlob(r)) : null; }, [membersOf(g.id)[0]]);
  if (!blob) return;
  const a = el("a", { href: URL.createObjectURL(blob), download: (g.name || "figure").replace(/[^\w.-]+/g, "_") + `_t${R.fmt(S.t)}.png` }); a.click(); URL.revokeObjectURL(a.href);
}
function dissolveFigure(g) {
  const rows = figRows(g), cols = Math.max(1, ...rows.map(r => r.length));
  rows.forEach(r => r.forEach((id, j) => {                            // loose panels start in their cell's column
    const p = S.panels.find(q => q.id === id);
    if (p) { p.col = (g.col ?? 0) + Math.floor(j * (g.span ?? cols) / cols); p.cols = g.cols; p.span = Math.max(1, Math.round((g.span ?? cols) / cols)); p.width = g.cellWidth || p.width; }
  }));
  g.figure = false; delete g.rows; delete g.pos;
  rebuildAll(); save();
}

// ---- layout: the board (v8.0, human 2026-10-14: "Grid board"). Each block (a loose panel or a figure) has a column
// `col` and a width `span` in columns. Blocks are stacked in desktop order (S.panels), each in its own columns at the
// lowest free height there: a panel that gets taller only moves the blocks below it, never sideways, and a narrow
// panel fits into a gap under a shorter one. Replaces v3.2–v7's free places + gravity packing (panels jumped columns).
function blocks() {
  const out = [], done = new Set();
  for (const p of S.panels) {
    if (inFigure(p)) {
      const g = groupOf(p);
      if (done.has(g.id)) continue;
      done.add(g.id);
      const f = figEls.get(g.id);
      if (f) out.push({ key: `g:${g.id}`, el: f, obj: g, ids: figRows(g).flat() });
    } else {
      const r = live.get(p.id)?.root;
      if (r) out.push({ key: `p:${p.id}`, el: r, obj: p, ids: [p.id] });
    }
  }
  return out;
}
/** Desktops from before v8 (pixel places and widths): columns and order from them, once. */
function migrateBlocks(bs) {
  const old = bs.filter(b => b.obj.span == null);
  if (!old.length) return;
  const unit = BASE_COL + GAP, N = board().N;
  for (const b of old) {
    const g = b.key[0] === "g" ? b.obj : null;
    const w = g ? (g.cellWidth || 400) * Math.max(1, ...figRows(g).map(r => r.length)) : (b.obj.width || 560);
    b.obj.span = Math.max(1, Math.round((w + GAP) / unit));
    b.obj.col = b.obj.pos ? Math.max(0, Math.round((b.obj.pos.x - GAP) / unit)) : null;   // no old place: the first free spot
    b.obj.cols = N;
  }
  if (old.length === bs.length && bs.some(b => b.obj.pos)) {         // desktop order = reading order of the old places
    const at = b => b.obj.pos || { x: 0, y: 1e9 };
    const order = [...bs].sort((a, c) => (at(a).y - at(c).y) || (at(a).x - at(c).x)).flatMap(b => b.ids);
    S.panels = [...order.map(id => S.panels.find(p => p.id === id)).filter(Boolean), ...S.panels.filter(p => !order.includes(p.id))];
  }
  for (const b of old) delete b.obj.pos;
}
/** Give a block its width on the board (a figure: its cells share it). */
function sizeBlock(b, w) {
  // v8.9.8: a new width asks for a redraw itself (not only through the ResizeObserver, which a browser may deliver late)
  const prev = b.el.style.width, changed = prev !== "" && prev !== w + "px";      // ("": just built, drawn anyway)
  if (prev !== w + "px") b.el.style.width = w + "px";
  if (b.key[0] === "p") { b.obj.width = Math.round(w); if (changed) requestRender(b.obj); return; }
  // v8.9.7 (human 2026-10-15: linked copies "squish them down into panel", the plots filled only the left of the frame):
  // a cell is narrower by the space it saves (a shared y axis, a colour bar on top), so the cell width is chosen for
  // the widest row to fill the figure — that space goes to the plots instead of a blank strip at the right
  const g = b.obj, gap = g.gapX ?? 4, saved = id => live.get(id)?.figSave || 0;
  const fits = figRows(g).map(r => (w - FIG_PAD - (r.length - 1) * gap + r.reduce((a, id) => a + saved(id), 0)) / r.length);
  const cell = Math.max(120, Math.floor(Math.min(...fits)));
  if (g.cellWidth === cell) return;
  g.cellWidth = cell;
  for (const id of figRows(g).flat()) { const L = live.get(id); if (L) { L.root.style.width = cell - (L.figSave || 0) + "px"; if (L.fig) L.fig.refW = cell; } }
  renderIds(figRows(g).flat());                                     // the whole figure (its members render together, per type)
}
let layoutQueued = false;
function scheduleLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  setTimeout(() => { layoutQueued = false; layout(); }, 0);
}
// ---- focus mode (v8.5, human 2026-10-15) ---------------------------------------------------------------------
// v14.8 (human 2026-11-19: "I only ever use the focus now"): focus is the only view; the grid view is gone
let focusKey = localStorage.getItem("aptvis.focus") || null, playTick = 0;
let fitK = {};                           // v8.9: {key, k} the focused block's scale, chosen once when it was focused
let focusIds = [];                       // v8.9: the focused block's panel ids (to follow them when the block changes)
const blockKeyOf = p => (inFigure(p) ? `g:${groupOf(p).id}` : `p:${p.id}`);
function setFocus(key) {
  if (!key || key === focusKey) return;
  window.scrollTo({ top: 0 });
  focusKey = key; localStorage.setItem("aptvis.focus", key); fitK = {};
  layout(); renderAll();
}
/** Focus mode (v8.5; v8.7: "the same as on grid but physically scaled"): every block is drawn at its grid width and
 *  scaled — the focused one to fill the main area without scrolling (as large as fits its width and the screen's
 *  height), the others to the strip on the right (thumbnails with names; hover = bigger, in place). Each canvas is drawn
 *  at its scale, so text and lines stay sharp. */
/** Focus mode's room: the desk width, the thumbnail strip, the main area, and the height between header and footer. */
function focusArea() {
  const W = Math.max(320, deskRoom()), stripW = Math.round(Math.min(280, Math.max(170, W * 0.2)));
  const avail = innerHeight - document.querySelector("header").offsetHeight - document.querySelector("footer").offsetHeight - 2 * GAP - 6;
  return { W, stripW, mainW: W - stripW - 3 * GAP, avail };
}
function layoutFocus(bs) {
  const B = board(), { W, stripW, mainW, avail } = focusArea();
  // a focused block that is gone (docked into a figure, figure undone): focus the block its plots are in now
  if (!bs.some(b => b.key === focusKey)) focusKey = (bs.find(b => b.ids.some(id => focusIds.includes(id))) || bs[0]).key;
  focusIds = bs.find(b => b.key === focusKey).ids;
  const gridW = b => spanW(Math.min(Math.max(1, b.obj.span || 1), B.N), B);
  for (const b of bs) {
    const f = b.key === focusKey;
    b.el.classList.toggle("focused", f); b.el.classList.toggle("thumb", !f); b.el.classList.add("scaled"); b.el.dataset.bkey = b.key;
    sizeBlock(b, gridW(b));
  }
  let y = GAP, fh = 0;
  for (const b of bs) {
    const f = b.key === focusKey, w = gridW(b), h = Math.max(1, b.el.offsetHeight);
    // the focused block: as large as fits (width and the screen's height) when it is focused — then that scale stays,
    // so changing its aspect ratio does not resize it again (human 2026-10-15)
    let k = stripW / w;
    if (f) {
      const ready = b.ids.every(id => live.get(id)?.last);                    // drawn at its grid width: its height is real
      // (v8.9.2: never larger than the screen — a wider or taller shape is shown smaller, never bigger than chosen)
      k = Math.max(0.2, fitK.key === b.key && fitK.k ? Math.min(fitK.k, mainW / w, avail / h) : Math.min(mainW / w, avail / h, 3));
      if (ready && fitK.key !== b.key) fitK = { key: b.key, k };
    }
    b.el.style.setProperty("--k", k.toFixed(4));
    setRenderScale(b, f ? k : Math.min(1, k * 1.65));                  // a thumbnail is sharp when hovered (×1.65)
    if (f) { b.el.style.left = GAP + Math.max(0, (mainW - w * k) / 2) + "px"; b.el.style.top = GAP + "px"; fh = h * k; }
    else { b.el.style.left = 2 * GAP + mainW + stripW - w + "px"; b.el.style.top = y + "px"; y += h * k + GAP; }
  }
  sizeDesk(W, Math.max(fh + GAP, y) + 40);
  placeSettings();
}
/** The scale a block's canvases are drawn at (1 in the grid); a change redraws it. */
function setRenderScale(b, k) {
  const kk = Math.round(k * 50) / 50;
  let changed = false;
  for (const id of b.ids) { const L = live.get(id); if (L && (L.renderScale || 1) !== kk) { L.renderScale = kk; changed = true; } }
  if (changed) renderIds(b.ids);
}
function layout() {
  const B = board(), bs = blocks();
  if (!bs.length) { sizeDesk(B.W, 200); placeSettings(); return; }
  migrateBlocks(bs);
  layoutFocus(bs);
}
function sizeDesk(w, h) {
  const desk = $("desktop");
  desk.style.width = w + "px"; desk.style.height = Math.max(h, 200) + "px";
  $("deskwrap").style.height = Math.max(h, 200) + 20 + "px";
}
// ---- drag & dock --------------------------------------------------------------------------------------------
function deskPoint(clientX, clientY) { const d = $("desktop").getBoundingClientRect(); return { x: clientX - d.left, y: clientY - d.top }; }
function deskRect(node) { const d = $("desktop").getBoundingClientRect(), r = node.getBoundingClientRect(); return { x: r.left - d.left, y: r.top - d.top, w: r.width, h: r.height }; }
/** Drag a panel or a whole figure (v8.9.2 moves, the only ones since v14.8): onto a dock tab = dock (link); into the
 *  strip = a new place in the desktop's order (a plot dragged out of its figure becomes a plot of its own). Esc cancels. */
function startDrag(e, { panel = null, group = null }) {
  e.preventDefault(); closePopover();
  const block = blocks().find(b => b.key === (group ? `g:${group.id}` : blockKeyOf(panel)));
  const node = group ? figEls.get(group.id) : live.get(panel.id).root;
  if (block) focusMove(e, { panel, block, node, out: !!(panel && inFigure(panel)) });
}
/** Dock tabs (◀ ▶ ▲ ▼) on the panels in `qs` that `panel` can dock to (any type since v14.2.1). */
function dockTabs(panel, qs) {
  const tabs = [];
  for (const q of qs) {
    // v14.2.1 (human 2026-11-13: "the docking should work cross type (the only reason it may not is axis linking, so just
    // DONT link things that [don't] make sense"): any plot is a target. A joined plot links nothing but pan & zoom, and that
    // only with plots of the same axes (model.js axisSig: a map's and a 1D plot's never match)
    if (q === panel) continue;                            // v8.15.2: plots dragged out of a figure are targets too
    const r = live.get(q.id)?.root; if (!r) continue;
    const b = deskRect(r), nm = q.name || live.get(q.id)?.last?.auto?.title || q.type;
    for (const [side, x, y, ch] of [["left", b.x, b.y + b.h / 2, "◀"], ["right", b.x + b.w, b.y + b.h / 2, "▶"], ["top", b.x + b.w / 2, b.y, "▲"], ["bottom", b.x + b.w / 2, b.y + b.h, "▼"]]) {
      const t = el("div", { class: "docktab", style: `left:${x - 14}px;top:${y - 14}px`, title: `dock ${side} of "${nm}" (links the plots)` }, ch);
      $("desktop").append(t); tabs.push({ t, q, side, b });
    }
  }
  return tabs;
}
/** The dock tab under the pointer (or null); lights it and shows the bar on the edge it docks to. */
function hotTab(tabs, ev, bar) {
  const hot = tabs.find(k => { const r = k.t.getBoundingClientRect(); return ev.clientX >= r.left - 6 && ev.clientX <= r.right + 6 && ev.clientY >= r.top - 6 && ev.clientY <= r.bottom + 6; }) || null;
  tabs.forEach(k => k.t.classList.toggle("hot", k === hot));
  bar.style.display = "none";
  if (hot) {
    const b = hot.b, v = hot.side === "left" || hot.side === "right";
    Object.assign(bar.style, { display: "block", left: (hot.side === "right" ? b.x + b.w : b.x) - (v ? 3 : 0) + "px", top: (hot.side === "bottom" ? b.y + b.h : b.y) - (v ? 0 : 3) + "px", width: v ? "6px" : b.w + "px", height: v ? b.h + "px" : "6px" });
  }
  return hot;
}
/** Focus mode drags (v8.9: a thumbnail onto the focused plot; v8.9.2, human 2026-10-15: "Focus could still work the
 *  same so allow me to drag subpanels around and whatnot, its literally just a different way of displaying the
 *  figures"): the grid's moves, shown in the focus layout.
 *    over a dock tab (on the focused plots): dock = link, as on the grid;
 *    over the strip: it goes there in the desktop's order — a thumbnail or a figure as a whole, a plot dragged out of
 *      the focused figure as a plot of its own (still linked), as on the grid;
 *    anywhere else: nothing.
 *  From a thumbnail a press that does not move is a click (it focuses it). Esc cancels. */
let thumbDragged = false;
function focusDrag(e, thumb) {
  const pid = [...live].find(([, L]) => L.root?.contains(e.target))?.[0];
  const block = blocks().find(b => b.key === thumb.dataset.bkey);
  if (block) focusMove(e, { panel: S.panels.find(q => q.id === pid) || null, block, node: thumb, thumb: true });
}
/** panel: the plot that docks (null: a figure, which moves as a whole); block: what moves in the order; out: the
 *  plot leaves its figure when it is dropped in the strip. */
function focusMove(e, { panel = null, block, node, thumb = false, out = false }) {
  const x0 = e.clientX, y0 = e.clientY, name = out || !block.obj.figure ? panel?.name || panel?.type : "figure";
  let on = false, hot = null, slot = null, tabs = [], ghost = null, bar = null, line = null, gw = 0, gh = 0;
  const begin = () => {
    on = true; thumbDragged = thumb;
    const fb = blocks().find(b => b.key === focusKey);
    const qs = (fb?.ids || []).map(id => S.panels.find(q => q.id === id)).filter(Boolean);
    const r = node.getBoundingClientRect(); gw = Math.min(r.width, 200); gh = Math.min(r.height, 130);
    ghost = el("div", { class: "ghost named" }, name || ""); bar = el("div", { class: "dockbar" }); line = el("div", { class: "dockbar" });
    $("desktop").append(ghost, bar, line); node.classList.add("dragging"); document.body.classList.add("fdrag");
    tabs = panel ? dockTabs(panel, qs) : [];
    if (thumb && panel && !tabs.length) toast("nothing to dock to here (drop it in the strip to move it)");
  };
  /** The place in the strip under the pointer: before which thumbnail (null: at the end), and the bar's y. */
  const stripSlot = p => {
    const fa = focusArea(), x = 2 * GAP + fa.mainW;
    if (p.x < x - 20) return null;
    const th = blocks().filter(b => b.key !== focusKey).map(b => ({ b, r: deskRect(b.el) }));
    const i = th.findIndex(t => t.r.y + t.r.h / 2 > p.y);
    const y = i >= 0 ? th[i].r.y - GAP / 2 : (th.length ? th.at(-1).r.y + th.at(-1).r.h + GAP / 2 : GAP);
    return { before: i >= 0 ? th[i].b : null, x, w: fa.stripW, y };
  };
  const move = ev => {
    if (!on) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return; begin(); }
    const p = deskPoint(ev.clientX, ev.clientY);
    Object.assign(ghost.style, { left: p.x - gw / 2 + "px", top: p.y - 12 + "px", width: gw + "px", height: gh + "px" });
    hot = hotTab(tabs, ev, bar);
    slot = hot ? null : stripSlot(p);
    line.style.display = slot ? "block" : "none";
    if (slot) Object.assign(line.style, { left: slot.x + "px", top: slot.y - 3 + "px", width: slot.w + "px", height: "6px" });
  };
  const cleanup = () => {
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("keydown", esc, true);
    ghost?.remove(); bar?.remove(); line?.remove(); tabs.forEach(k => k.t.remove()); node.classList.remove("dragging"); document.body.classList.remove("fdrag");
    if (on && thumb) {                                         // the click that ends a drag is not a click
      const eat = ev => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener("click", eat, true); setTimeout(() => { window.removeEventListener("click", eat, true); thumbDragged = false; }, 0);
    }
  };
  const esc = ev => { if (ev.key === "Escape") { ev.stopPropagation(); cleanup(); } };
  const up = async () => {
    cleanup();
    if (!on) return;
    if (hot) {
      if (!(await dock(panel, hot.q, hot.side))) return;
      fitK = {};                                               // the focused figure changed: fit it to the screen again
      const k = blockKeyOf(hot.q);
      if (k !== focusKey) setFocus(k); else layout();
      return;
    }
    if (!slot || slot.before === block) return;
    // the grid's move, in the desktop's order: the block, or the plot out of its figure (as a plot of its own)
    let ids = block.ids;
    if (out) {
      const B = board(), span = Math.max(1, Math.min(B.N, Math.round(((groupOf(panel).cellWidth || BASE_COL) + GAP) / (B.cw + GAP))));
      leaveFigure(panel); unlinkPanel(panel); panel.span = span; panel.col = null; ids = [panel.id];   // v8.22: unlinked
      focusIds = focusIds.filter(id => id !== panel.id);       // the focus stays with the plots left in the figure
    }
    const moving = ids.map(id => S.panels.find(q => q.id === id)).filter(Boolean);
    S.panels = S.panels.filter(q => !ids.includes(q.id));
    const at = slot.before ? S.panels.findIndex(q => slot.before.ids.includes(q.id)) : -1;
    S.panels.splice(at < 0 ? S.panels.length : at, 0, ...moving);
    if (out) { fitK = {}; rebuildAll(); toast("moved out of the figure: a plot of its own now, with its current look (drag it onto a dock tab to put it back)"); }
    else layout();
    save();
  };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("keydown", esc, true);
}

// ---- what linking shares: v8.15's "smart + ask" link box (shared unless the joining plot differs and changed it from
// the default) is gone in v8.22 (human 2026-11-04: "the colormap autolinking too much and messing me up"): a plot joins
// a figure sharing only pan & zoom with the plots of the same axes (model.js ownOnJoin); 🔗 at a row shares more. ----
/** Dock `panel` on `side` of `target`: both end up in one figure (linked; v8.22: sharing pan & zoom only). */
async function dock(panel, target, side) {
  // v8.15.2 (human 2026-10-28: "trying to connect two plots together but the connect doesn't pop up … when I try to
  // create linked copy I get an error"): a target dragged out of its figure but still linked to it ("free") had no dock
  // tabs, and a linked copy of it crashed (it is in no figure row). Now it leaves that link group (keeping its look) and
  // the two make a new figure — once "link" is chosen, so cancel changes nothing.
  const same = !!groupOf(target) && groupOf(panel) === groupOf(target);
  if (!same) {
    // v8.22 (human 2026-11-04: "the colormap autolinking too much and messing me up"): a plot joins a figure sharing
    // only pan & zoom, with the plots that have the same axes; everything else stays its own (no question box any more)
    leaveFigure(panel);
    if (groupOf(panel)) unlinkPanel(panel);
    linkPanels(target, panel, ownOnJoin(target, panel));
    const tn = target.name || live.get(target.id)?.last?.auto?.title || target.type;
    toast(`joined "${tn}": pan & zoom follow the plots with the same axes; everything else is its own (🔗 at a setting shares it)`);
  } else leaveFigure(panel);
  const g = groupOf(target);
  if (!g.figure) { makeFigure(g, target); g.cellWidth = target.width; }
  const cols0 = Math.max(1, ...figRows(g).map(r => r.length));
  const rows = figRows(g).map(r => r.filter(id => id !== panel.id)).filter(r => r.length);
  let i = rows.findIndex(r => r.includes(target.id));
  if (i < 0) { rows.push([target.id]); i = rows.length - 1; }          // (never again a crash on a target outside the rows)
  const j = rows[i].indexOf(target.id);
  if (side === "right") rows[i].splice(j + 1, 0, panel.id);
  else if (side === "left") rows[i].splice(j, 0, panel.id);
  else if (side === "top") rows.splice(i, 0, [panel.id]);
  else rows.splice(i + 1, 0, [panel.id]);
  g.rows = rows;
  const cols1 = Math.max(1, ...rows.map(r => r.length));             // v8: a new column widens the figure on the board
  if (cols1 > cols0) g.span = Math.min(board().N, Math.max(cols1, Math.round((g.span || cols0) * cols1 / cols0)));
  // v7.2: in a figure with per-column / per-row sharing the new plot takes its column's and row's settings; v8.22: and
  // the pan & zoom of the plots with its axes
  panel.link.own = panel.link.own.filter(k => scopeOf(g, k) === "all"); reconcileScopes(g, undefined, panel);
  // keep the members' order in S.panels = figure order (rendering, saving)
  const ids = rows.flat(), first = Math.min(...ids.map(id => S.panels.findIndex(p => p.id === id)));
  const mem = ids.map(id => S.panels.find(p => p.id === id));
  S.panels = S.panels.filter(p => !ids.includes(p.id)); S.panels.splice(Math.min(first, S.panels.length), 0, ...mem);
  rebuildAll(); save();
  return true;
}

// ---- copy with another dataset (v5, human 2026-10-05: "copy an entire linked set and change just the dataset") --
/** Copy a panel, or its whole linked set, for other dataset(s). Default: the copies become new rows of the same
 *  figure (rows = datasets, columns = quantities), so colour map, zoom and colour limits stay shared; or a separate
 *  figure. With variables on, the original follows one dataset variable and the copy another. */
async function copyWithDataset(panel = null, g = panel ? groupOf(panel) : null) {
  const set = g ? membersOf(g.id) : [panel];
  const runsOf = p => { const s = eff(p); return p.type === "2d" ? [s.run] : (s.lines || []).map(l => l.run); };
  const used = [...new Set(set.flatMap(runsOf))].filter(Boolean);
  if (!used.length) { toast("nothing to copy: these plots show no dataset yet", true); return; }
  const runs = runNames(), shown = new Set(used.map(runOf)), vars = Object.values(S.vars).filter(v => v.type === "dataset");
  const choice = new Map(used.map((v, i) => [v, i === 0 ? (runs.find(r => !shown.has(r)) || "") : ""]));
  const opts = [["", "(keep)"], ...vars.map(v => ["$" + v.name, `${v.name} · ${runsText(v)}`]), ...runs.map(r => [r, r])];
  const rows = used.map(v => el("div", { class: "pop-row" }, el("span", { class: "lab wide", title: runRefTip(v) }, runLabel(v)), "→", select(opts, choice.get(v), x => choice.set(v, x))));
  const place = select(g ? [["rows", "as new rows of this figure (shares colour map, zoom, colour limits)"], ["separate", "as a separate figure (an independent copy)"]]
                         : [["rows", "linked, below it (a two-row figure: shared colour map, zoom, colour limits)"], ["separate", "as an independent plot"]], "rows", () => {});
  const useVars = el("input", { type: "checkbox", checked: true });
  const ok = await askForm(set.length > 1 ? `Copy these ${set.length} linked plots with another dataset` : "Copy with another dataset", [
    el("div", { class: "dim" }, "Dataset of the copy (the original keeps its own):"), ...rows,
    el("div", { class: "pop-row" }, el("span", { class: "lab" }, "place"), place),
    el("label", { class: "chk" }, useVars, "use dataset variables: the original follows one, the copy another, so a whole row's dataset can be swapped later in one click (sidebar)")], "copy");
  if (!ok) return;
  if ([...choice.values()].every(x => !x)) { toast("pick a dataset for the copy", true); return; }
  const ids = set.map(p => p.id), map = new Map(), made = [];
  const newVar = value => { const n = newVarName("dataset"); S.vars[n] = { name: n, type: "dataset", value }; made.push(`${n} = ${value}`); return "$" + n; };
  for (const [v, x] of choice) {
    if (!x) continue;
    const orig = useVars.checked && !isRef(v) ? newVar(v) : v;
    if (orig !== v) bindRun(v, orig, ids);
    map.set(orig, useVars.checked && !isRef(x) ? newVar(x) : x);
  }
  const swap = s => { if (!s) return; if (map.has(s.run)) s.run = map.get(s.run); for (const l of s.lines || []) if (map.has(l.run)) l.run = map.get(l.run); };
  const sep = place.value === "separate", idMap = new Map(), copies = [];
  let ng = null;
  if (g && sep) {
    ng = JSON.parse(JSON.stringify(g)); Object.assign(ng, { id: `g${newId()}`, color: newGroupColor(), pos: null, name: g.name ? g.name + " (copy)" : null });
    swap(ng.settings); S.groups[ng.id] = ng;
  }
  for (const p of set) {
    const c = cloneFresh(p); c.template = null; c.title = null; c.pos = null;
    if (g && !sep) {                                   // same link group: the dataset becomes this copy's own setting
      // (per-row / per-column settings stay that way: the copy's row gets the new dataset — v7.2)
      for (const k of p.type === "2d" ? ["run"] : ["lines", "run"]) if (!c.link.own.includes(k) && scopeOf(g, k) === "all") { c.link.own.push(k); c.settings[k] = cloneFresh(eff(p)[k]); }
    } else if (g) c.link = { group: ng.id, own: [...p.link.own] };
    else { c.link = null; c.settings = cloneFresh(eff(p)); }
    swap(c.settings);
    idMap.set(p.id, c.id); copies.push(c);
  }
  const rows0 = g && g.figure ? figRows(g) : null;     // before the copies exist (figRows appends unplaced members)
  S.panels.splice(Math.max(...set.map(p => S.panels.indexOf(p))) + 1, 0, ...copies);
  if (rows0) {
    const copyRows = rows0.map(r => r.map(id => idMap.get(id)).filter(Boolean)).filter(r => r.length);
    if (sep) ng.rows = copyRows; else g.rows = [...rows0, ...copyRows];
  }
  const note = made.length ? ` · variables ${made.join(", ")} (sidebar)` : "";
  if (!g && !sep) { await spawnPlot(panel, copies[0], { side: "bottom" }); toast(`copied below, linked${note}`); return; }   // (as its menu says: below)
  rebuildAll(); save();
  toast(`copied ${copies.length} plot${copies.length > 1 ? "s" : ""}${sep ? " as a separate figure" : g?.figure ? " as new rows" : ""}${note}`);
  // a separate copy goes right below the original, pushing what is below down (like a drop on its bottom edge)
  if (sep && (!g || g.figure)) { await renderAll(); insertBelow(g ? `g:${ng.id}` : `p:${copies[0].id}`, g ? `g:${g.id}` : `p:${panel.id}`); save(); }
}
/** v8: copies are placed after their original in the desktop order, so they stack below it on the board. */
function insertBelow() { layout(); }

// ---- settings box: floats over the desktop, joined to its panel by a line (human 2026-10-02) ---------------
function toggleSettings(panel) { if (settingsFor === panel.id) closeSettings(); else { settingsFor = panel.id; refreshSettings(true); markEditing(); } }
function closeSettings() { settingsFor = null; $("setbox").style.display = "none"; $("connector").innerHTML = ""; $("connector").setAttribute("width", 0); $("connector").setAttribute("height", 0); markEditing(); }
function markEditing() { for (const [id, L] of live) { L.root.classList.toggle("editing", id === settingsFor); L.root.querySelector(".phead .gear")?.classList.toggle("on", id === settingsFor); } }
/** Back to the whole plot (a double-click on the plot does the same). */
function resetView(panel) { const c = ctxPanel(panel); c.set("view", null); if (panel.type === "1d") c.set("yview", null); api.changed(panel, false); }
function copyPanel(panel) { const c = cloneFresh(panel); c.link = null; c.template = null; c.settings = cloneFresh(eff(panel)); c.name = (panel.name || panel.type) + " copy"; spawnPlot(panel, c, { dock: false }); }
/** v14.5 (architecture review §5.8, RULES P1): the one way to make a plot from a plot — period, lineout, foot-gap and
 *  "plot beside" plots, copies. The new plot `np` goes right after its source and docks beside it (`side`, default
 *  "right"; it can be dragged anywhere after), as wide as its source. dock: false = an independent plot (a copy), placed
 *  after its source's figure. Returns the new plot. */
async function spawnPlot(source, np, { side = "right", dock: docked = true } = {}) {
  if (!docked) {
    const g = groupOf(source), members = g ? membersOf(g.id) : [source];
    addPanel(np, Math.max(...members.map(q => S.panels.indexOf(q))) + 1);
    return np;
  }
  if (!S.panels.includes(np)) S.panels.splice(S.panels.indexOf(source) + 1, 0, np);
  np.width = source.width;
  await dock(np, source, side);
  return np;
}
function linkedCopy(panel) {
  const c = cloneFresh(panel); c.link = null; c.template = null; c.name = (panel.name || panel.type) + " (linked)";
  c.settings = cloneFresh(eff(panel)); spawnPlot(panel, c);   // v14.5: spawnPlot (beside it)
}
/** The panel's menu (v8.1): one menu for the header's ⋯ and the settings box's ⋯ (UI review §D3: each action once). */
/** The datasets a plot shows (its lines' lists and variables resolved), each once. */
const panelRuns = panel => { const s = eff(panel); return [...new Set((panel.type === "2d" ? [s.run] : (s.lines || []).map(l => l.run)).flatMap(r => runsOfRef(r)))].filter(r => r && store.runs[r]); };
function panelMenu(panel, e) {
  const item = (label, fn, title) => el("button", { class: "menuitem", title, onclick: () => { closePopover(); fn(); } }, label);
  popover(e.clientX, e.clientY, [
    el("div", { class: "pop-title" }, panel.name || panelType(panel)),
    el("div", { class: "menu" },
      item("⚙ settings", () => toggleSettings(panel)),
      item("PNG", () => savePNG(panel), "save this plot as PNG (always light)"),
      canTag() && panelRuns(panel).length ? item("🏷 tag its dataset…", () => tagForm(panelRuns(panel), e.clientX, e.clientY),
        "tags: what a dataset shows (e.g. has cycle), across the groups; a dataset list can follow one") : null,         // v11.8.1
      item("🎬 movie…", () => saveMovie(panel), "an mp4 over the time range, made by ffmpeg on the server"),
      el("hr"),
      item("⧉ copy", () => copyPanel(panel), "an independent copy below"),
      item("🔗⧉ linked copy", () => linkedCopy(panel), "a copy docked to the right that shares every setting except dataset + quantity"),
      item("⧉ copy with another dataset…", () => copyWithDataset(panel), panel.link ? "copy this plot's whole linked set with another dataset" : "copy with another dataset (linked, below: a two-row figure)"),
      ...pluginPlotMenu().filter(m => { try { return m.available(panel); } catch { return false; } }).map(m => item(m.label, () => m.run(panel), m.title)),   // v15.1: plugins' entries
      el("hr"),
      item("☆ save as template…", () => saveTemplate(panel), "save this plot on purpose, with its type, to insert it in any desktop (templates…)"),
      panel.template ? item(`↻ reload from "${panel.template}"`, () => reloadFromTemplate(panel), "take the template's settings again") : null,
      panel.template ? item(`⇪ update "${panel.template}"`, () => saveTemplate(panel, panel.template), "write this plot into its template") : null,
      el("hr"),
      item("🗑 remove", () => removePanel(panel))),
  ]);
}
// v8.1 (UI review §D2): the common sections open on top, the rest under "More"; a search box filters the rows
const QUICK = new Set(["Data", "Axes", "Colour", "Lines"]);      // More: Layout, Tools, Sharing (figure)
let setQuery = "";
function settingsBody(panel, ctx, g) {
  const secs = [...(panel.type === "2d" ? settings2DBox(ctx) : settings1DBox(ctx)), inFigure(panel) ? sharingSection(groupOf(panel)) : null].filter(Boolean);
  const title = s => s.querySelector(":scope > .sec-title")?.textContent || "";
  const quick = secs.filter(s => QUICK.has(title(s))), more = secs.filter(s => !quick.includes(s));
  const moreBox = more.length ? el("details", { class: "more", open: localStorage.getItem("aptvis.sec.More") === "open" },
    el("summary", { class: "more-title" }, `More: ${more.map(title).join(", ").toLowerCase()}`), ...more) : null;
  moreBox?.addEventListener("toggle", () => { if (!moreBox.dataset.filtering) localStorage.setItem("aptvis.sec.More", moreBox.open ? "open" : "closed"); });
  const search = el("input", { type: "search", class: "setsearch", placeholder: "find a setting: limit, legend, log, label …", value: setQuery,
    oninput: e => { setQuery = e.target.value; filterSettings(); } });
  return [search, ...quick, moreBox];
}
/** The visible text of a settings row (a menu counts by its chosen entry only). */
function rowText(r) {
  let t = "";
  const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement.closest("select") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  while (w.nextNode()) t += " " + w.currentNode.nodeValue;
  r.querySelectorAll("select").forEach(s => { t += " " + (s.selectedOptions[0]?.textContent || ""); });
  r.querySelectorAll("input[placeholder]").forEach(i => { t += " " + i.placeholder; });
  return t.toLowerCase();
}
function filterSettings() {
  const body = $("setbox").querySelector(".setbody"); if (!body) return;
  const q = setQuery.trim().toLowerCase(), secs = [...body.querySelectorAll("details.sec")], more = body.querySelector("details.more");
  for (const d of [...secs, more].filter(Boolean)) {
    if (q) { d.dataset.filtering = "1"; d.open = true; }
    else if (d.dataset.filtering) {                       // back to what was remembered
      d.open = d === more ? localStorage.getItem("aptvis.sec.More") === "open"                       // More: closed unless opened
        : localStorage.getItem("aptvis.sec." + (d.querySelector(":scope > .sec-title")?.textContent || "")) !== "closed";
      setTimeout(() => delete d.dataset.filtering);
    }
  }
  for (const sec of secs) {
    const hit = !!q && (sec.querySelector(":scope > .sec-title")?.textContent || "").toLowerCase().includes(q);
    let any = false;
    for (const r of sec.querySelectorAll(":scope > .row, :scope > div > .row, :scope > .row.tool")) {
      const ok = !q || hit || rowText(r).includes(q);
      r.style.display = ok ? "" : "none"; any = any || ok;
    }
    sec.style.display = !q || any || hit ? "" : "none";
  }
  if (more) more.style.display = !q || [...more.querySelectorAll("details.sec")].some(s => s.style.display !== "none") ? "" : "none";
}
function refreshSettings(first = false) {
  const panel = S.panels.find(p => p.id === settingsFor), box = $("setbox");
  if (!panel || !live.has(panel.id)) { if (settingsFor !== null) closeSettings(); return; }
  const keep = box.querySelector(".setbody")?.scrollTop || 0, ctx = settingsCtx(panel), g = groupOf(panel);
  box.replaceChildren(
    el("div", { class: "sethead" },
      el("b", {}, `${panel.type.toUpperCase()} · ${panel.name || panelType(panel)}`),
      el("span", { class: "sp" }),
      el("button", { title: "plot menu: PNG, movie, copies, template, remove", onclick: e => panelMenu(panel, e) }, "⋯"),
      el("button", { title: "close (Esc)", onclick: closeSettings }, "×")),
    el("div", { class: "setbody" }, ...settingsBody(panel, ctx, g)));
  box.style.display = "flex";
  if (setQuery) filterSettings();
  box.querySelector(".setbody").scrollTop = keep;
  if (first) box.dataset.placed = "";
  placeSettings();
}
/** Figure-wide rules (human 2026-10-02): shared axes and spacing, kept out of the always-visible UI. */
/** Pan & zoom shared by the linked panels, or each panel its own (v5.4, human 2026-10-05: "sometimes I want some
 *  settings linked but not have my pan and zoom linked"); per figure column / row since v5.12 (below). */
// ---- sharing scopes (v7.2, human 2026-10-13: "different levels of linking … more links between the same plot type
// for different datasets than for different plot types of same dataset"; generalises v5.12's pan & zoom per figure
// column / row). Families of settings (model.js SCOPE_FAMILIES) are shared by every plot, per figure column, per
// figure row, or not at all. Per column / row values live in the panels and are copied along when one changes. -----
const P_OF = id => S.panels.find(q => q.id === id);
/** The other plots of `panel`'s figure column ("col") or row ("row"), or (v8.22, "axis") the other plots of the
 *  figure with the same axes for pan & zoom key k. */
function peersOf(panel, sc, k = null) {
  const g = groupOf(panel);
  if (!g?.figure) return [];
  const rows = figRows(g), r = rows.findIndex(row => row.includes(panel.id));
  if (r < 0) return [];
  if (sc === "axis") {
    const sig = axisSig(panel, k);
    return rows.flat().filter(id => id !== panel.id).map(P_OF).filter(q => q && !q.link?.own.includes(k) && axisSig(q, k) === sig);
  }
  const c = rows[r].indexOf(panel.id), ids = sc === "col" ? rows.map(row => row[c]).filter(id => id !== undefined) : rows[r];
  return ids.filter(id => id !== panel.id).map(P_OF).filter(Boolean);
}
/** Copy setting k of panel `from` to `to` (same figure). Lines of `from`'s dataset become lines of `to`'s dataset
 *  (same plot, other dataset); a new dataset takes `to`'s lines of its old dataset along. True if `to` changed. */
function copyScoped(from, to, k) {
  if (to.link?.own.includes(k)) return false;
  const fs = eff(from), ts = eff(to);
  if (k === "run") {
    const v = panelRun(fs, from.type), old = panelRun(ts, to.type);
    if (v === old && ts.run === v) return false;
    if (to.type === "1d" && !isLinked(to, "lines")) for (const l of to.settings.lines || []) if (l.run === old && (!isFn(l) || isAn(l))) l.run = v;
    to.settings.run = v;
    return true;
  }
  let v;
  if (k === "lines") {
    const a = panelRun(fs, from.type), b = panelRun(ts, to.type);
    v = JSON.parse(JSON.stringify(fs.lines || [])).map(l => (a != null && b != null && l.run === a ? { ...l, run: b } : l));
  } else v = fs[k] === undefined ? undefined : JSON.parse(JSON.stringify(fs[k]));
  if (JSON.stringify(v) === JSON.stringify(ts[k])) return false;
  if (v === undefined) delete to.settings[k]; else to.settings[k] = v;
  return true;
}
/** After `panel` changed: copy its per-column / per-row settings to its column / row. True if a peer needs its
 *  header rebuilt (dataset, datatype, lines …). */
function syncScoped(panel) {
  const g = groupOf(panel);
  if (!g?.figure) return false;
  const keys = SCOPE_FAMILIES.flatMap(f => f[2]).filter(k => !panel.link.own.includes(k) && scopeOf(g, k) !== "all");
  if (!keys.length) return false;
  if (panel.type === "1d" && keys.includes("run")) panel.settings.run = panelRun(eff(panel), "1d");   // follows its lines
  let rebuild = false;
  for (const k of keys.sort((a, b) => (b === "run") - (a === "run")))                     // the dataset first
    for (const q of peersOf(panel, scopeOf(g, k), k)) if (copyScoped(panel, q, k) && REBUILD_KEYS.has(k)) rebuild = true;
  return rebuild;
}
/** Make the per-column / per-row families agree: in each column / row the value most plots have (a tie: the top /
 *  left plot's) is copied to the others. After a scope is chosen and when plots join a figure. */
function reconcileScopes(g, fams = [...new Set([...Object.keys(g.scope || {}), "view"])], newcomer = null) {
  if (!g.figure) return;
  const rows = figRows(g), ncol = Math.max(0, ...rows.map(r => r.length));
  for (const f of fams) {
    const sc = familyScope(g, f);
    if (sc === "axis") {                     // v8.22: per key, the plots with the same axes take one window
      for (const k of familyKeys(f)) {
        const by = new Map();
        for (const p of rows.flat().map(P_OF)) if (p && !p.link.own.includes(k)) { const s = axisSig(p, k); by.set(s, [...(by.get(s) || []), p]); }
        for (const mem of by.values()) {
          if (mem.length < 2) continue;
          const lead = mem.find(p => p !== newcomer && eff(p)[k] !== undefined) || mem.find(p => p !== newcomer) || mem[0];
          for (const p of mem) if (p !== lead) copyScoped(lead, p, k);
        }
      }
      continue;
    }
    if (sc !== "col" && sc !== "row") continue;
    const keys = familyKeys(f), sets = sc === "row" ? rows : [...Array(ncol).keys()].map(c => rows.map(r => r[c]).filter(id => id !== undefined));
    for (const ids of sets) {
      const mem = ids.map(P_OF).filter(Boolean);
      if (mem.length < 2) continue;
      const sig = p => {
        const s = eff(p), run = panelRun(s, p.type);
        return JSON.stringify(keys.map(k => (k === "run" ? run : k === "lines" ? (s.lines || []).map(l => ({ ...l, run: l.run === run ? "@" : l.run })) : s[k] ?? null)));
      };
      const n = new Map();
      for (const p of mem) n.set(sig(p), (n.get(sig(p)) || 0) + 1);
      const cand = mem.filter(p => p !== newcomer);                       // a plot that just joined follows the others
      const lead = cand.reduce((b, p) => (n.get(sig(p)) > n.get(sig(b)) ? p : b), cand[0]);
      for (const p of mem) if (p !== lead) for (const k of keys.sort((a, b) => (b === "run") - (a === "run"))) copyScoped(lead, p, k);
    }
  }
}
/** How a family is shared now: "all" | "col" | "row" | "own", or "mixed" (some plots differ: see their 🔗). */
function familyMode(g, f) {
  const sc0 = familyScope(g, f), sc = sc0 === "all" ? null : sc0, mem = membersOf(g.id);
  const keys = familyKeys(f).filter(k => k in g.settings || mem.some(p => k in p.settings));
  if (!keys.length) return sc || "all";
  const st = new Set(mem.flatMap(p => keys.map(k => (p.link.own.includes(k) ? "own" : sc || (k in g.settings ? "all" : "own")))));
  return st.size === 1 ? [...st][0] : "mixed";
}
/** Share family f by every plot ("all"), per figure column / row, or not ("own"). What every plot shows now is kept
 *  as its starting value; per column / row then makes each column / row agree (reconcileScopes). */
function setScope(g, f, mode) {
  if (mode === "mixed") return;
  const keys = familyKeys(f), mem = membersOf(g.id);
  const order = [...(g.figure ? figRows(g).flat().map(P_OF).filter(Boolean) : []), ...mem];
  for (const p of mem) { const s = eff(p); for (const k of keys) if (k in s) p.settings[k] = JSON.parse(JSON.stringify(s[k])); }
  for (const p of mem) p.link.own = p.link.own.filter(k => !keys.includes(k));
  if (mode === "col" || mode === "row" || mode === "axis") {
    if (!g.figure) return;
    g.scope = { ...(g.scope || {}), [f]: mode };
    reconcileScopes(g, [f]);
    return;
  }
  if (g.scope) delete g.scope[f];
  if (f === "view") { delete g.viewMode; if (mode === "all") g.scope = { ...(g.scope || {}), view: "all" }; }   // v8.22: absent = "axis"
  if (mode === "own") for (const p of mem) for (const k of keys) { if (k in p.settings) p.link.own.push(k); }
  else for (const k of keys) { const src = order.find(p => k in p.settings); if (src) g.settings[k] = JSON.parse(JSON.stringify(src.settings[k])); }
}
/** The "rows are datasets" preset (human 2026-10-13: "a top one is one dataset and a bottom on the other"). */
const DATASET_ROWS = { dataset: "row", data: "col", axes: "col", colour: "col", limits: "col", view: "col", tools: "col", labels: "col", style: "all" };
function afterScope(g) { if (g.figure) rebuildFigure(g); else rebuildAll(); refreshSettings(); save(); }
/** Sharing (figure), v8.4: how each family is shared is set from the tags at the right of the rows; what stays here is
 *  the "rows are datasets" preset, everything shared again, shared axes and the gaps. */
function sharingSection(g) {
  const redo = () => { rebuildFigure(g); refreshSettings(); layout(`g:${g.id}`); save(); };
  const fams = SCOPE_FAMILIES.filter(([f]) => !(g.type === "1d" && (f === "colour" || f === "limits")));
  return section("Sharing (figure)",
    el("div", { class: "row" },
      el("button", { title: "dataset per row; quantity / lines, axes, colours, limits, pan & zoom, tools, labels per column",
        onclick: () => { for (const [f] of fams) setScope(g, f, DATASET_ROWS[f] || "all"); afterScope(g); toast("rows are datasets"); } }, "rows are datasets"),
      el("button", { title: "every setting shared by every plot again", onclick: () => { for (const [f] of fams) if (f !== "dataset" && f !== "data") setScope(g, f, "all"); afterScope(g); } }, "all shared")),
    el("div", { class: "row" }, el("span", { class: "lab" }, "axes"),
      toggle("x shared", g.shareX !== false, v => { g.shareX = v; redo(); }, { title: "plots in a column with the same x axis drop repeated x labels" }),
      toggle("y shared", g.shareY !== false, v => { g.shareY = v; redo(); }, { title: "plots in a row with the same y axis drop repeated y labels" })),
    el("div", { class: "row" }, el("span", { class: "lab" }, "gaps"),
      num(g.gapX ?? 4, v => { g.gapX = Math.max(0, v ?? 4); redo(); }, { size: 3, title: "between columns (px; or drag the gap)" }),
      num(g.gapY ?? 4, v => { g.gapY = Math.max(0, v ?? 4); redo(); }, { size: 3, title: "between rows (px; or drag the gap)" })));
}

function placeSettings() {
  const panel = S.panels.find(p => p.id === settingsFor), box = $("setbox"), svg = $("connector");
  if (!panel || box.style.display === "none") { svg.innerHTML = ""; return; }
  const L = live.get(panel.id); if (!L) return;
  const r = L.root.getBoundingClientRect(), bw = 460, sx = window.scrollX, sy = window.scrollY;
  // v8.1 (UI review §A4): on a narrow window the box is a drawer on the right edge (no connector)
  const drawer = innerWidth < 1100;
  box.classList.toggle("drawer", drawer);
  if (drawer) { svg.innerHTML = ""; svg.setAttribute("width", 0); svg.setAttribute("height", 0); return; }
  if (!box.dataset.placed) {                                           // beside the panel: right if it fits, else left
    let x = r.right + 36;
    if (x + bw > innerWidth - 8) x = r.left - 36 - bw;
    if (x < 8) x = innerWidth - bw - 8;
    box.style.left = x + sx + "px"; box.style.top = Math.max(60, Math.min(r.top, innerHeight - 320)) + sy + "px";
    box.dataset.placed = "1";
  }
  {                                                                    // kept on screen (window resized, page scrolled)
    const b0 = box.getBoundingClientRect(), headH = document.querySelector("header").offsetHeight;
    if (b0.right > innerWidth - 4) box.style.left = Math.max(4, innerWidth - b0.width - 4) + sx + "px";
    if (b0.left < 4) box.style.left = 4 + sx + "px";
    if (b0.top < headH + 4) box.style.top = headH + 4 + sy + "px";
    if (b0.top > innerHeight - 120) box.style.top = Math.max(headH + 4, innerHeight - 320) + sy + "px";
  }
  const b = box.getBoundingClientRect(), right = b.left > r.right;
  const px = right ? r.right : r.left, py = r.top + Math.min(r.height / 2, 120), bx = right ? b.left : b.right, by = b.top + 24;
  const col = document.body.classList.contains("dark") ? "#8d939c" : "#8a8f98", doc = document.documentElement;
  svg.setAttribute("width", 0); svg.setAttribute("height", 0);             // measure the page without the overlay itself (it only grew)
  svg.setAttribute("width", doc.scrollWidth); svg.setAttribute("height", doc.scrollHeight);
  svg.innerHTML = `<rect x="${r.left + sx - 3}" y="${r.top + sy - 3}" width="${r.width + 6}" height="${r.height + 6}" rx="7" fill="none" stroke="${col}" stroke-width="2.5"/>` +
    `<path d="M${px + sx},${py + sy} C${(px + bx) / 2 + sx},${py + sy} ${(px + bx) / 2 + sx},${by + sy} ${bx + sx},${by + sy}" fill="none" stroke="${col}" stroke-width="2.5"/>` +
    `<circle cx="${px + sx}" cy="${py + sy}" r="4" fill="${col}"/><circle cx="${bx + sx}" cy="${by + sy}" r="4" fill="${col}"/>`;
}
function dragSettingsBox(e) {
  if (e.target.closest("button")) return;
  e.preventDefault();
  const box = $("setbox"), x0 = e.clientX - box.offsetLeft, y0 = e.clientY - box.offsetTop;
  const move = ev => { box.style.left = ev.clientX - x0 + "px"; box.style.top = ev.clientY - y0 + "px"; placeSettings(); };
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
}

// ---- saved desktops + panel setups (in-page dialogs; errors are shown) ---------------------------------------
const panelJSON = p => {
  const { ui, ...rest } = p, g = groupOf(p);
  // the dataset / number variables it uses travel with it (measured ones point at other panels: not portable)
  // v11.2: and the variables inside the dataset lists it uses
  const names = refsIn([p.settings, g?.settings]);
  for (const n of [...names]) for (const m of listRefs(S.vars[n])) names.add(m);
  const vars = Object.fromEntries([...names].filter(n => S.vars[n] && S.vars[n].type !== "measured").map(n => [n, S.vars[n]]));
  return JSON.parse(JSON.stringify({ ...rest, linkSettings: g ? g.settings : undefined, vars }));
};
/** Variables from a loaded panel setup: added if this desktop doesn't have them (a same-named one wins). */
function mergeVars(vars) {
  const clash = [];
  for (const [n, v] of Object.entries(vars || {})) { if (!S.vars[n]) S.vars[n] = v; else if (JSON.stringify(S.vars[n]) !== JSON.stringify(v)) clash.push(n); }
  if (clash.length) toast(`the plot uses variable${clash.length > 1 ? "s" : ""} ${clash.join(", ")}: this desktop's ${clash.length > 1 ? "ones are" : "one is"} used`);
}
async function askValidName(title, value) {
  for (;;) {
    const n = await askName(title, value);
    if (n === null) return null;
    if (validName(n)) return n;
    toast("Names: letters, digits, - _ . and spaces.", true); value = n;
  }
}
// v8.1 (UI review §F, human 2026-10-14): a desktop holds its panels itself. Saving one no longer writes panel setup
// files, so two desktops can't rewrite each other's panels and "save as…" is a real copy. Panels worth reusing are
// saved on purpose as templates (below).
/** The desktop as saved in views/desktops (version 8: it holds its panels). */
function desktopBody() {
  const panels = S.panels.map(p => { const j = panelJSON(p); delete j.vars; delete j.linkSettings; delete j.setupName; return j; });
  // v14.4: what a saved desktop holds = the schema's file fields (model.js DESKTOP_SCHEMA)
  return { version: 8, ...Object.fromEntries(desktopFields(f => f.file === true).map(k => [k, k === "panels" ? panels : S[k] ?? DESKTOP_SCHEMA[k].empty()])) };
}
// what was last opened / saved under the desktop's name (without the slider's time): an unchanged desktop isn't rewritten
let savedBody = null;
const bodyKey = b => JSON.stringify({ ...b, t: undefined });
function markSaved() { savedBody = bodyKey(desktopBody()); }
/** After a desktop opens, its first draws fill in automatic things (colour-map defaults, places on the board): it counts
 *  as unchanged once no plot is drawing any more (at most 10 s), so a desktop only looked at isn't rewritten. */
async function markSavedWhenDrawn(name) {
  const t0 = Date.now();
  do await new Promise(r => setTimeout(r, 150)); while (busy.size && Date.now() - t0 < 10000);
  if (S.desktopName === name) markSaved();
}
async function saveDesktop(asNew = false, named = null) {
  await guarded("saving the desktop", async () => {
    let name = named || S.desktopName;
    if (!named && (!name || asNew)) { name = await askValidName("Save the desktop as:", name || "desktop"); if (!name) return; }
    const body = desktopBody(), where = await saveView("desktops", name, body);
    S.desktopName = name; $("dname").textContent = name; save(); savedBody = bodyKey(body);
    savedWhere(where, `desktop "${name}" (${body.panels.length} panels)`);
  });
}
/** v8.9.9 (human 2026-10-15: "when I swap desktops Id like things SAVED"): before another desktop replaces this one
 *  (open, new, example, restore previous), a named desktop is written back to views/desktops if it changed; an unnamed
 *  one with panels asks for a name (cancel: not saved — it stays under "restore previous desktop"). false = don't switch. */
async function saveBeforeSwitch() {
  if (!S.panels.length) return true;
  if (!S.desktopName) {
    const n = await askValidName("This desktop has no name. Save it before switching? (Cancel = switch without saving; it stays under “restore previous desktop”)",
      `desktop ${new Date().toISOString().slice(0, 10)}`);
    if (n) await saveDesktop(false, n);
    return true;
  }
  const body = desktopBody(), key = bodyKey(body);
  if (key === savedBody) return true;                                     // unchanged since opened / saved
  try {
    const where = await saveView("desktops", S.desktopName, body);
    savedBody = key;
    if (where === "server") toast(`saved "${S.desktopName}" before switching`); else savedWhere(where, `desktop "${S.desktopName}"`);
    return true;
  } catch (e) {
    return askConfirm(`Saving "${S.desktopName}" failed (${e.message}). Switch anyway? (It stays under “restore previous desktop”.)`, "switch anyway");
  }
}
function standalone(p) { const q = cloneFresh(p); if (q.link && q.linkSettings) q.settings = { ...q.linkSettings, ...Object.fromEntries(q.link.own.map(k => [k, q.settings[k]])) }; q.link = null; delete q.free; q.pos = null; delete q.col; delete q.cols; delete q.linkSettings; return q; }
async function openDesktop(name) {
  await guarded("opening the desktop", async () => {
    const d = await loadView("desktops", name), panels = [];
    if (!(await saveBeforeSwitch())) return;                              // v8.9.9 (after the new one has loaded)
    let old = 0;
    for (const r of d.panels || []) {
      // v8.1: the panel itself. v11.1 fix: with its saved ids (cloneFresh gave every panel, line and tool a new id, so
      // a figure's rows, measured / fit variables, steps tools and foot-gap lines lost what they point to on every
      // reopen; bumpNextId below moves the id counter past them)
      if (!r.ref) { panels.push(JSON.parse(JSON.stringify(r))); continue; }
      // before v8.1: a reference to a panel setup file (read; the file stays — "clean up old setup files (desktops from before v8.1)" lists them)
      try { const p = await loadView("panels", r.ref); delete p.linkSettings; delete p.setupName; if (r.width) p.width = r.width; if (r.pos) p.pos = r.pos; if (r.col != null) { p.col = r.col; p.cols = r.cols; p.span = r.span; } p.free = !!r.free; panels.push(p); old++; }
      catch (e) { toast(`missing setup file ${r.ref}`, true); }
    }
    if (old) setTimeout(() => toast(`"${name}" was saved before v8.1: its plots came from ${old} setup files. Save it (💾) to keep them inside the desktop; the files stay.`), 600);
    const groups = d.groups || {};
    for (const p of panels) if (p.link && !groups[p.link.group]) p.link = null;
    keepPrevious();
    // v14.4: every field from the schema (model.js DESKTOP_SCHEMA): the file's value; missing: the field's rule
    for (const [k, f] of Object.entries(DESKTOP_SCHEMA)) {
      if (k === "panels" || k === "nextId") continue;     // panels: read above; nextId: the pipeline's last step
      const miss = typeof f.missing === "function" ? f.missing(d) : f.missing;
      S[k] = f.file && d[k] != null ? d[k] : miss === "keep" ? S[k] ?? f.empty() : f.empty();
    }
    S.groups = groups; S.panels = panels; S.desktopName = name;
    for (const p of panels) { mergeVars(p.vars); delete p.vars; }
    clearMeasured();
    const ren = migrateDesktop(d.nextId);                 // v14.4: the one migration pipeline
    closeSettings(); syncControls(); applyExpressions(false); rebuildAll(); save(); markSaved(); markSavedWhenDrawn(name); remapNote(ren);
  });
}
async function desktopsDialog() {
  await guarded("listing desktops", async () => {
    const v = await listViews(), when = t => (t ? new Date(t * 1000).toLocaleString() : "");
    dialog(`Desktops${(await apiAvailable(true)) ? " (views/desktops on the server)" : " (⚠ browser storage: serve.py not reachable)"}`,
      v.desktops.map(d => ({ name: d.name, info: `${d.n ?? (d.refs || []).length} plot${(d.n ?? (d.refs || []).length) === 1 ? "" : "s"}${(d.refs || []).length ? " (saved before v8.1)" : ""} · ${when(d.mtime)}`, actions: [["open", () => openDesktop(d.name)],
        ["delete", async () => { if (await askConfirm(`Delete desktop "${d.name}"?`, "delete")) await guarded("deleting", () => deleteView("desktops", d.name)); }]] })),
      [["save current as…", () => saveDesktop(true)],
       ["new empty desktop", async () => { if (!(await saveBeforeSwitch())) return; keepPrevious(); closeSettings(); resetDesktop(); afterReset(); }],
       ["example desktop", async () => { if (!(await saveBeforeSwitch())) return; keepPrevious(); closeSettings(); resetDesktop(); S.panels = defaultDesktop(); afterReset(); }],
       ...(localStorage.getItem(PREV_KEY) ? [["restore previous desktop", restorePrevious]] : [])]);
  });
}
// ---- templates (v8.1, UI review §F, human 2026-10-14: "panel setups … TYPES"; "yeah"). A template is a panel saved
// on purpose, with its type filled in ("1D · twist angle vs r_max", "2D map · B_φ/B"), a free tag, and a preview.
// Inserting gives an independent copy; "keep in sync" remembers the template, so the panel's menu can reload it or
// update it later. ---------------------------------------------------------------------------------------------
/** The panel's type in words: what the template picker groups by. */
function panelType(p) {
  const s = eff(p);
  if (p.type === "2d") { const src = srcOf(s.run, s.q); return `2D map · ${src?.label ?? s.q ?? "?"}`; }
  const l = (s.lines || []).find(x => !isFn(x)), src = l ? srcOf(l.run, l.q) : null;
  return `1D · ${s.ykind || src?.kind || (l ? l.q : "lines")} vs ${axisLabel(s.xaxis).replace(/\s*\[.*\]$/, "")}`;
}
/** A panel as a self-contained template body (linked settings folded in, no place on the board). */
function templateBody(p) {
  const raw = panelJSON(p), vars = raw.vars, q = standalone(raw);
  delete q.vars; delete q.setupName; delete q.template; delete q.span; delete q.width; delete q.id;
  return { panel: q, vars };
}
/** A small light preview (JPEG data URL, 240 px wide) of the panel as drawn. */
async function templateThumb(p) {
  try {
    return await lightForExport(() => {
      const c = live.get(p.id)?.canvas; if (!c || !c.width) return null;
      const w = 240, h = Math.round(c.height * w / c.width), t = el("canvas", { width: w, height: h }), x = t.getContext("2d");
      x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(c, 0, 0, w, h);
      return t.toDataURL("image/jpeg", 0.72);
    }, [p]);
  } catch { return null; }
}
async function needTemplates() {
  if (hasFeature("templates") || !(await apiAvailable())) return true;       // without serve.py: browser storage
  toast("Templates are stored by serve.py: restart serve.py (the new one offers them), then reload this page.", true);
  return false;
}
async function saveTemplate(panel, name0 = null) {
  if (!(await needTemplates())) return;
  await guarded("saving the template", async () => {
    const v = await listViews(), tags = [...new Set(v.templates.map(t => t.tag).filter(Boolean))].sort();
    const type = panelType(panel), stem = (panel.name || type).replace(/[^\w.\- ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "template";
    const name = el("input", { type: "text", size: 32, value: name0 || panel.template || stem, title: "the variables it uses travel with it · inserting gives an independent copy unless kept in sync" });
    const tag = el("input", { type: "text", size: 20, value: v.templates.find(t => t.name === (name0 || panel.template))?.tag || "", list: "tpl-tags", placeholder: "e.g. twist, no-pairs" });
    const sync = el("input", { type: "checkbox", checked: !!panel.template });
    const ok = await askForm("Save as template", [
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "type"), el("b", {}, type)),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "name"), name),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "tag"), tag, el("datalist", { id: "tpl-tags" }, tags.map(t => el("option", { value: t })))),
      el("label", { class: "chk" }, sync, "keep this plot in sync with the template (its menu can update or reload it)"),
      ], "save");
    if (!ok) return;
    const n = name.value.trim();
    if (!validName(n)) return toast("Names: letters, digits, - _ . and spaces.", true);
    if (v.templates.some(t => t.name === n) && n !== panel.template && !(await askConfirm(`Replace the template "${n}"?`, "replace"))) return;
    const where = await saveView("templates", n, { type: panel.type, label: type, tag: tag.value.trim() || null, ...templateBody(panel), thumb: await templateThumb(panel) });
    panel.template = sync.checked ? n : null; save();
    savedWhere(where, `template "${n}"`);
  });
}
/** Insert template `name`: an independent copy, or kept in sync with it. */
async function insertTemplate(name, sync = false) {
  const t = await loadView("templates", name);
  mergeVars(t.vars);
  const p = { ...cloneFresh(t.panel), id: newId(), link: null, template: sync ? name : null };
  addPanel(p); migrateInserted();                        // v14.4: an old template gets the same migrations
  toast(`inserted "${name}"` + (sync ? " (kept in sync: its menu can update or reload it)" : ""));
}
/** A synced panel takes its template's settings again (place and links stay). */
async function reloadFromTemplate(panel) {
  await guarded("reloading the template", async () => {
    const t = await loadView("templates", panel.template);
    mergeVars(t.vars);
    const keep = { id: panel.id, link: panel.link, col: panel.col, cols: panel.cols, span: panel.span, width: panel.width, template: panel.template };
    if (panel.link) unlinkPanel(panel);
    Object.assign(panel, cloneFresh(t.panel), { ...keep, link: null });
    rebuildAll(); save(); toast(`"${panel.template}" reloaded`);
  });
}
async function templatesDialog() {
  await guarded("listing templates", async () => {
    const v = await listViews(), when = t => (t ? new Date(t * 1000).toLocaleDateString() : "");
    const back = el("div", { class: "modal-back", onmousedown: e => { if (e.target === back) back.remove(); } });
    const search = el("input", { type: "search", size: 30, placeholder: "search: name, type, tag" });
    const list = el("div", { class: "modal-list tpl-list" });
    const thumbs = new Map();
    const fill = () => {
      const q = search.value.trim().toLowerCase();
      const items = v.templates.filter(t => !q || `${t.name} ${t.label} ${t.tag || ""}`.toLowerCase().includes(q));
      const byType = new Map();
      for (const t of items) { const k = t.label || (t.type || "?").toUpperCase(); if (!byType.has(k)) byType.set(k, []); byType.get(k).push(t); }
      list.replaceChildren(...(items.length ? [...byType].sort((a, b) => a[0].localeCompare(b[0])).flatMap(([k, ts]) => [
        el("div", { class: "tpl-type" }, k, el("span", { class: "dim" }, ` · ${ts.length}`)),
        ...ts.map(t => {
          const img = el("img", { class: "tpl-thumb", alt: "" });
          if (thumbs.has(t.name)) { if (thumbs.get(t.name)) img.src = thumbs.get(t.name); }
          else loadView("templates", t.name).then(o => { thumbs.set(t.name, o.thumb || null); if (o.thumb) img.src = o.thumb; }).catch(() => thumbs.set(t.name, null));
          const act = (label, fn, title) => el("button", { title, onclick: async () => { back.remove(); await guarded(label, fn); } }, label);
          return el("div", { class: "tpl-item" }, img,
            el("div", { class: "tpl-info" }, el("b", {}, t.name), t.tag ? el("span", { class: "tpl-tag" }, t.tag) : null, el("div", { class: "dim" }, when(t.mtime))),
            act("insert", () => insertTemplate(t.name), "an independent copy"),
            act("insert, keep in sync", () => insertTemplate(t.name, true), "the plot remembers the template: its menu can update or reload it"),
            el("button", { onclick: async () => { if (await askConfirm(`Delete the template "${t.name}"?`, "delete")) { await guarded("deleting", () => deleteView("templates", t.name)); v.templates = v.templates.filter(x => x !== t); fill(); } } }, "delete"));
        })]) : [el("div", { class: "dim" }, v.templates.length ? "no template matches" : "No templates yet: a plot's ⋯ menu → “save as template…”.")]));
    };
    search.addEventListener("input", fill);
    const oldUsed = n => v.desktops.filter(d => (d.refs || []).includes(n)).length;
    back.append(el("div", { class: "modal tpl-modal" },
      el("div", { class: "modal-head" }, el("b", {}, "Templates"), search, el("button", { onclick: () => back.remove() }, "×")),
      list,
      el("div", { class: "modal-foot" },
        v.panels.length ? el("button", { title: "setup files of desktops saved before v8.1", onclick: () => { back.remove(); oldSetupsDialog(v, oldUsed); } }, `old setup files (${v.panels.length})…`) : null,
        el("button", { onclick: () => back.remove() }, "close"))));
    document.body.append(back); fill(); search.focus();
  });
}
/** The panel setup files of desktops saved before v8.1: insert one, make it a template, or delete it (UI review §F4). */
function oldSetupsDialog(v, used) {
  const items = [...v.panels].sort((a, b) => used(a.name) - used(b.name) || a.name.localeCompare(b.name));
  dialog(`Old setup files (${items.length}; ${items.filter(p => !used(p.name)).length} not used by any desktop)`, items.map(p => ({
    name: p.name, info: used(p.name) ? `used by ${used(p.name)} desktop(s) saved before v8.1` : "not used by any desktop",
    actions: [
      ["insert", async () => { const raw = await loadView("panels", p.name); mergeVars(raw.vars); const q = standalone(raw); delete q.vars; delete q.setupName; addPanel(q); migrateInserted(); }],
      ["make template", async () => { const raw = await loadView("panels", p.name); mergeVars(raw.vars); const q = standalone(raw); delete q.vars; delete q.setupName; addPanel(q); migrateInserted(); setTimeout(() => saveTemplate(q, p.name), 400); }],
      ["delete", async () => { if (await askConfirm(`Delete the old setup file "${p.name}"?` + (used(p.name) ? ` ${used(p.name)} desktop(s) saved before v8.1 still read it: open and save them first.` : ""), "delete")) await guarded("deleting", () => deleteView("panels", p.name)); }]] })),
    [["back to templates", templatesDialog]]);
}
/** v8.22 (human 2026-11-04: "any linking remains within a single panel"): links live only inside a figure. In a desktop
 *  saved before, linked panels outside a figure become panels of their own, keeping their look; a figure's pan & zoom
 *  (one value for every plot) becomes each plot's, so it follows the plots with the same axes (the new default). */
/** v8.30: plots made before slope / rate lines had y axes of their own — a plot whose lines are all slope lines (or all
 *  d/dt lines) of its y-axis group K now has the y axis "slope of K" ("rate of K"). Plots that mix them with plain
 *  lines keep their y axis (and say in the plot that the lines belong apart). */
/** v10.0.1: an old panel setup inserted into the open desktop gets the same moves as a desktop being opened (its lines
 *  on the old 200-point profiles → the along-line data at the line's own points). */
function migrateInserted() { migrateDesktop(); rebuildAll(); save(); }   // v14.4: the one migration pipeline
/** v14.4: a new empty desktop: every field of the schema empty, except the slider, playback and id counter. Before
 *  v14.4 it kept the old desktop's style, time range, expressions and notes. */
function resetDesktop() {
  for (const [k, f] of Object.entries(DESKTOP_SCHEMA)) if (!f.player) S[k] = f.empty();
  clearMeasured();
}
function afterReset() { migrateDesktop(); syncControls(); applyExpressions(false); rebuildAll(); save(); }
/** v14.4 (architecture review §5.7, P9): every migration, in one order, for every way a desktop arrives: startup, open,
 *  "restore previous", new / example desktop, template inserts. Each step is safe to run again on a migrated desktop.
 *  Returns the datasets renamed (for a note). */
function migrateDesktop(nextId = 0) {
  for (const [k, f] of Object.entries(DESKTOP_SCHEMA)) if (S[k] === undefined || (S[k] === null && f.empty() !== null)) S[k] = f.empty();
  S.panels = migrate(S.panels);                         // 1. every panel has every field (model.js)
  for (const p of S.panels) delete p.ui;                // 2. a field from before v5
  migrateRows();                                        // 3. v8.22: a row group is a figure
  migrateLinks();                                       // 4. every group is a figure; groups of one dissolve
  migrateDerivedKinds();                                // 5. slope "drop", merged lineouts, named steps tools, mean → draw …
  for (const m of pluginMigrations()) { try { m(S); } catch (e) { console.warn("plugin migration", e); } }   // 5b. v14.9
  const ren = remapRenamed();                           // 6. renamed datasets
  sanitize();                                           // 7. group colours, v5.12 view modes
  bumpNextId(nextId);                                   // 8. the id counter past every id
  return ren;
}
function migrateDerivedKinds() {
  // v8.31 (human 2026-11-09: "get rid of slope of the drop then I can determine whether to use + or - ddx"): a line still
  // set to the automatic "drop" sign becomes −d/dx (every along-line potential so far falls from the north foot)
  let drops = 0;
  const fixDrop = st => { for (const l of st?.lines || []) if (l.slope?.sign === "drop") { l.slope.sign = -1; drops++; } };
  for (const p of S.panels) fixDrop(p.settings);
  for (const g of Object.values(S.groups || {})) fixDrop(g.settings);
  if (drops) setTimeout(() => toast(`${drops} slope line${drops > 1 ? "s" : ""} set to "slope of the drop" now use${drops > 1 ? "" : "s"} −d/dx (that choice is gone: pick d/dx or −d/dx in the line)`), 900);
  // v14.2.2 (human 2026-11-13: lineouts "along same axis ... should collapse down to one tool use as a list"): several
  // lineout tools of one map along the same axis become one (its positions, in order); their plots read the one kept
  const loMoved = new Map();
  for (const st of [...S.panels.map(p => p.settings), ...Object.values(S.groups || {}).map(g => g.settings)]) {
    const los = (st?.tools || []).filter(t => t?.type === "lineout");
    for (const ax of ["x", "y"]) {
      const same = los.filter(t => (t.along || "x") === ax);
      if (same.length < 2) continue;
      const keep = same[0];
      if (!isRef(keep.at)) keep.at = [...new Set(same.flatMap(t => (isRef(t.at) ? [] : [].concat(t.at ?? []))).map(Number).filter(Number.isFinite))];
      for (const t of same.slice(1)) { loMoved.set(t.id, keep.id); st.tools.splice(st.tools.indexOf(t), 1); }
    }
  }
  if (loMoved.size) for (const st of [...S.panels.map(p => p.settings), ...Object.values(S.groups || {}).map(g => g.settings)])
    for (const l of st?.lines || []) if (l.lo && loMoved.has(l.lo.tool)) l.lo.tool = loMoved.get(l.lo.tool);
  if (loMoved.size) setTimeout(() => toast(`lineouts along the same axis of a map are one tool now (${loMoved.size} merged); their extra plots show the same curves — remove them if you like`), 900);
  // v8.32.1: steps tools made before tools had names get one (steps1 …), so their output shows in the Outputs tab
  for (const st of [...S.panels.map(p => p.settings), ...Object.values(S.groups || {}).map(g => g.settings)])
    for (const t of [...(st?.tools || []), ...(st?.ownTools || [])]) {
      if (t?.type === "steps" && !t.name) t.name = freeToolName("steps");
      // v12.0: "mean of each curve" is a draw: a horizontal line at each curve's mean (same range, colours, label)
      // v14.5.1 (architecture review Phase 3): "line at the slider's time" (`now`) becomes a vertical line in time mode (one
      // thing, one stored form); its look stays
      if (t?.type === "now") Object.assign(t, { type: "line", orient: "v", mode: "time", offset: 0, value: 0, dash: t.dash ?? "dashed", width: t.width ?? 1, color: t.color ?? "#000000" });
      if (t?.type === "mean" && !t.along) {
        if (t.over === "shown") { t.from = "$view_x0"; t.to = "$view_x1"; }
        Object.assign(t, { type: "line", orient: "h", mode: "data", stat: "mean" });
        delete t.over; delete t.along;
      }
    }
  // v12.2 (human 2026-11-12: "lets just get rid of pinned values"): a pinned draw (a line / point read off each curve, with a
  // name) becomes a measured variable of that name (same line, reading, range, level); "$name.value" / ".x" / ".y" → "$name"
  const pins = [];
  for (const p of S.panels) {
    for (const t of [...(p.settings?.tools || []), ...(p.settings?.ownTools || []), ...(groupOf(p)?.settings?.tools || [])]) {
      if (!t?.name || !(t.type === "line" || t.type === "point") || t.mode !== "data") continue;
      const n = t.name;
      delete t.name;
      const stat = t.stat || (t.type === "point" ? "max" : t.orient === "h" ? "mean" : "xmax");
      const line = t.line ?? (eff(p).lines || []).find(l => !isFn(l))?.id;
      if (S.vars[n] || line == null) continue;
      S.vars[n] = { name: n, type: "measured", panel: p.id, line, op: stat, at: null, along: null, over: "range",
        from: t.from ?? null, to: t.to ?? null, level: stat === "cross" ? (t.at ?? 0) : null };
      pins.push(n);
    }
  }
  if (pins.length) {
    const re = new RegExp(`(\\$?)\\b(${pins.join("|")})\\.(value|x|y)\\b`, "g");
    const walk = o => { if (!o || typeof o !== "object") return; for (const k of Object.keys(o)) { if (typeof o[k] === "string") o[k] = o[k].replace(re, "$1$2"); else walk(o[k]); } };
    walk(S.panels); walk(S.groups); walk(S.vars);
    setTimeout(() => toast(`pinned values are measured variables now (sidebar → Variables): ${pins.join(", ")}`), 700);
  }
  // (v10.0's move of the old 200-point profiles to along-line data is the aperture4 plugin's migration since v15.1, D20)
  // v10.1.1 (human 2026-11-10: smoothing = "average over x axis … a window defined in the UNITS of the x axis"; averaging
  // r_max profiles over outputs "is still something I need access to"). The old "average ±N" (avg) and v10.1's smooth:
  // on a t plot → smooth = {h, kind} over t ± h (± N outputs = ± N R*/c: the outputs are 1 R*/c apart); on a profile plot
  // → each line's time average (tavg, its time row: mean over t ± h; a variable stays a variable), and smooth keeps only
  // a smoothing along x. 2D maps keep avg (read as t ± h in R*/c, panel2d.js).
  const given = v => v !== undefined && v !== null && v !== "";
  const timeOf = sp => (sp && typeof sp === "object" && sp.along === "time" && given(sp.w) ? (sp.unit === "outputs" || isRef(sp.w) ? sp.w : Number(sp.w) / 2) : undefined);
  const first = (...vs) => vs.find(given);
  const newSmooth = (o, src, tX) => {                     // o.smooth from o.smooth (v10.1) or src (an old avg)
    const sp = normSmooth(src, tX);
    if (sp === undefined) delete o.smooth; else o.smooth = sp || false;
  };
  for (const p of S.panels) {                             // lines first: they read their plot's (or group's) old avg
    if (p.type !== "1d") continue;
    const e = eff(p), tX = e.xaxis === "time";
    for (const l of e.lines || []) {
      if (!("avg" in l) && !("smooth" in l) && !(!tX && (given(e.avg) || timeOf(e.smooth) !== undefined))) continue;
      if (!tX && l.tavg === undefined) {
        const v = first(timeOf(l.smooth), l.avg, timeOf(e.smooth), e.avg);
        if (v !== undefined && (isRef(v) || Number(v) > 0)) l.tavg = v;
      }
      if ("smooth" in l || ("avg" in l && tX)) newSmooth(l, l.smooth !== undefined ? l.smooth : l.avg, tX);
      delete l.avg;
    }
  }
  const plotSmooth = (st, tX) => {
    if (!st || (!("avg" in st) && !("smooth" in st))) return;
    if ("smooth" in st || ("avg" in st && tX)) newSmooth(st, st.smooth !== undefined ? st.smooth : st.avg, tX);
    delete st.avg;
  };
  for (const p of S.panels) if (p.type === "1d") {
    plotSmooth(p.settings, eff(p).xaxis === "time");
    if (Array.isArray(p.link?.own) && p.link.own.includes("avg")) p.link.own = p.link.own.map(k => (k === "avg" ? "smooth" : k));
  }
  for (const g of Object.values(S.groups || {})) if (g.type === "1d") {
    const m = S.panels.find(p => groupOf(p) === g);
    plotSmooth(g.settings, (g.settings.xaxis ?? (m ? eff(m).xaxis : null)) === "time");
  }
  for (const p of S.panels) {
    if (p.type !== "1d") continue;
    const s = eff(p);
    if (!s.ykind || splitKind(s.ykind).mode) continue;
    const data = (s.lines || []).filter(l => !isFn(l) && !isAn(l));
    const ks = new Set(data.map(l => lineKind(l, srcOf(l.run, l.q))));
    const k = ks.size === 1 ? [...ks][0] : null;
    if (k && k !== s.ykind && splitKind(k).base === s.ykind) ctxPanel(p).set("ykind", k);
  }
}
function migrateLinks() {
  for (const p of S.panels) if ("free" in p) { if (p.free && groupOf(p)) { p.settings = JSON.parse(JSON.stringify(eff(p))); p.link = null; } delete p.free; }   // v14.5.1: the flag is gone
  const deep = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  for (const g of Object.values(S.groups)) {
    for (const p of membersOf(g.id)) if (!g.figure || p.free) { p.settings = deep(eff(p)); p.link = null; }   // (free: older desktops only)
    const rest = membersOf(g.id);
    if (rest.length < 2) {
      for (const q of rest) {
        q.settings = deep(eff(q)); q.link = null;
        if (g.figure) { q.col = g.col ?? q.col; q.cols = g.cols ?? q.cols; q.span = g.span ?? q.span; q.width = g.cellWidth || q.width; }
      }
      delete S.groups[g.id];
      continue;
    }
    if (!g.v822) {
      if (familyScope(g, "view") === "axis")
        for (const q of rest) for (const k of familyKeys("view")) if (!q.link.own.includes(k) && k in g.settings) q.settings[k] = deep(g.settings[k]);
      g.v822 = true;
    }
  }
}
/** v8.23 (human 2026-11-04: the RCS desktop showed no data after its datasets were renamed rics-* → rcs-*; "can you just
 *  clean up my current desktops?"): a dataset renamed in the data manager keeps its old names (card `renamed_from`); a
 *  desktop's references to an old name that is no longer in the store become the new name. Exact names only (panel
 *  and line datasets, dataset variables and lists, anything else holding exactly that name). Returns "old → new". */
function remapRenamed() {
  const to = {};
  for (const [n, c] of Object.entries(store.cards || {})) for (const old of c.renamed_from || []) if (!store.runs[old] && store.runs[n]) to[old] = n;
  if (!Object.keys(to).length) return [];
  const done = new Set();
  const fix = o => {
    if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) o[i] = fix(o[i]); return o; }
    if (o && typeof o === "object") { for (const k of Object.keys(o)) o[k] = fix(o[k]); return o; }
    if (typeof o === "string" && to[o]) { done.add(o); return to[o]; }
    return o;
  };
  fix(S.panels); fix(S.groups); fix(S.vars);
  return [...done].map(o => `${o} → ${to[o]}`);
}
const remapNote = r => r.length && toast(`renamed datasets updated in this desktop: ${r.join(", ")} (save it to keep that)`);
/** v3.2 "line up side by side" groups become figures (one row, in desktop order). */
function migrateRows() {
  for (const g of Object.values(S.groups)) {
    if (!g.row) continue;
    const mem = membersOf(g.id);
    if (mem.length) { g.figure = true; g.rows = [mem.map(p => p.id)]; g.pos = g.pos || mem[0].pos || null; g.cellWidth = g.cellWidth || mem[0].width; }
    delete g.row;
  }
}

// ---- data, expressions, controls ---------------------------------------------------------------------------
async function loadAllRuns() {
  // v6.1: menu sections in the data manager's group order (optional file)
  // v11.7: and the folders, which section the quantity menus (read before the menus are built)
  const groupsRead = fetch(store.base + "groups.json", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(j => { if (j) { setSectionOrder(j.order); setFolders(j.folders); } }).catch(() => {});
  const names = await store.loadIndex();
  const cards = store.loadCards();                           // v8.1 dataset cards (tags, notes) for the dataset menus
  const res = await Promise.allSettled(names.map(n => store.loadRun(n)));
  await cards;                                               // (v8.23: old names of renamed datasets, remapRenamed)
  await groupsRead;
  const bad = names.filter((n, i) => res[i].status === "rejected");
  if (bad.length) setTimeout(() => toast(`could not read ${bad.join(", ")} (being recorded?) — skipped`, true), 500);
  showExprErrors();
}
function showExprErrors(extra = []) {
  const errs = [...extra, ...Object.entries(store.runs).flatMap(([n, r]) => Object.entries(r.exprErrors).map(([e, m]) => `${n}/${e}: ${m}`))];
  $("expr-errors").textContent = errs.join("\n");
}
// ---- the analytic functions library (v7.5, human 2026-10-14: "when I make an analytic function I want it available
// everywhere, not just in one specific desktop"): one text shared by every desktop (views/library/analytics.json via
// serve.py; this browser's storage if the running serve.py does not offer it). Desktops no longer carry it; ones saved
// before still do (S.analytics) — their functions join the library when opened (new names only). ---------------------
let LIBTEXT = "", libWhere = "browser";
let LIBLATEX = {};                 // v8.2: name -> LaTeX written for that function in the Functions tab (display only)
let LIBNOTES = {};                 // v8.5: name -> notes on that function (its box)
let LIBPARAMS = {};                // v8.5: name -> {parameter: what it is}
// v8.25 derived quantities shared by every desktop (views/library/derived.json): expressions like the desktop's, e.g.
// gap.on = abs(gap.voltage) >= V_min (human 2026-11-09: cheap quantities "from precached things" are not cached)
let DERTEXT = "", DERNOTES = {};
const AN_LINE = /^\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*=/;          // (v8.25: a derived member's dotted name)
/** `base` plus the lines of `extra` that define names `base` lacks: {text, added, clashes (same name, other formula)}. */
function mergeAnalyticText(base, extra) {
  const have = new Map();
  for (const l of String(base || "").split("\n")) { const m = l.match(AN_LINE); if (m && !l.trim().startsWith("#")) have.set(m[1], l.trim()); }
  const add = [], clashes = [];
  for (const l of String(extra || "").split("\n")) {
    const m = l.match(AN_LINE);
    if (!m || l.trim().startsWith("#")) continue;
    if (!have.has(m[1])) { add.push(l.trim()); have.set(m[1], l.trim()); }
    else if (have.get(m[1]).replace(/\s+/g, "") !== l.trim().replace(/\s+/g, "")) clashes.push(m[1]);
  }
  return { text: add.length ? [String(base || "").replace(/\s+$/, ""), ...add].filter(Boolean).join("\n") : String(base || ""), added: add.map(l => l.match(AN_LINE)[1]), clashes };
}
async function loadAnalyticsLib() {
  try {
    const { obj, where } = await loadLibrary("analytics");
    libWhere = where; LIBTEXT = obj?.text || ""; LIBLATEX = obj?.latex || {}; LIBNOTES = obj?.notes || {}; LIBPARAMS = obj?.params || {};
    const local = where === "server" ? browserLibrary("analytics") : null;   // kept here while serve.py had no library
    if (local?.text) {
      const m = mergeAnalyticText(LIBTEXT, local.text);
      if (m.added.length) { LIBTEXT = m.text; await saveLibrary("analytics", { text: LIBTEXT, latex: LIBLATEX, notes: LIBNOTES, params: LIBPARAMS }); }
      forgetBrowserLibrary("analytics");
    }
  } catch (e) { console.warn("analytic functions library", e); }
  try { const { obj } = await loadLibrary("derived"); DERTEXT = obj?.text || ""; DERNOTES = obj?.notes || {}; }   // v8.25
  catch (e) { console.warn("derived quantities library", e); }
}
async function saveDerivedLib() {
  const names = new Set(Object.keys(parseExpressionText(DERTEXT).defs));
  DERNOTES = Object.fromEntries(Object.entries(DERNOTES).filter(([n]) => names.has(n)));
  try { await saveLibrary("derived", { text: DERTEXT, notes: DERNOTES }); }
  catch (e) { toast(`could not save the derived quantities: ${e.message}`, true); }
}
async function saveAnalyticsLib() {
  const names = new Set(Object.keys(parseAnalyticText(LIBTEXT).defs));     // LaTeX of removed functions goes too
  LIBLATEX = Object.fromEntries(Object.entries(LIBLATEX).filter(([n]) => names.has(n)));
  LIBNOTES = Object.fromEntries(Object.entries(LIBNOTES).filter(([n]) => names.has(n)));
  LIBPARAMS = Object.fromEntries(Object.entries(LIBPARAMS).filter(([n]) => names.has(n)));
  try { libWhere = await saveLibrary("analytics", { text: LIBTEXT, latex: LIBLATEX, notes: LIBNOTES, params: LIBPARAMS }); }
  catch (e) { toast(`could not save the analytic functions: ${e.message}`, true); }
}
/** A desktop saved before v7.5 carries its own analytic functions: they join the library (new names only). */
function adoptDesktopAnalytics() {
  if (!S.analytics) return;
  const m = mergeAnalyticText(LIBTEXT, S.analytics);
  S.analytics = "";
  if (m.added.length) { LIBTEXT = m.text; saveAnalyticsLib(); toast(`analytic functions ${m.added.join(", ")} from this desktop are now in the shared library`); }
  if (m.clashes.length) toast(`this desktop's ${m.clashes.join(", ")} differ from the library's: the library's are used`, true);
  $("anx").value = LIBTEXT;
}
/** The expressions box and (v7) the analytic functions box: re-read both, rebuild the runs' derived sources once. */
function applyExpressions(render = true) {
  adoptDesktopAnalytics();
  const lib = parseExpressionText(DERTEXT), { defs, errors } = parseExpressionText(S.expressions);
  store.expressions = { ...lib.defs, ...defs };                      // v8.25: the library's, then this desktop's (wins)
  store.libExpr = new Set(Object.keys(lib.defs).filter(n => !defs[n]));
  defChips("expr-list", Object.entries(store.expressions).map(([name, d]) => ({ name, label: d.label, src: d.expr, lib: store.libExpr.has(name) })), "expr");
  errors.push(...lib.errors.map(e => `library: ${e}`));
  const an = parseAnalyticText(LIBTEXT);
  store.analytics = an.defs; store.anParams = LIBPARAMS;             // v8.8: parameter descriptions (shown in "+ line")
  for (const [n, r] of Object.entries(store.runs)) store.runs[n] = new Run(store, n, r.m);
  // analytic lines keep the formula they use, so a copied panel works on a desktop without the definition
  const sync = s => { for (const l of s?.lines || []) { const d = an.defs[l.an]; if (isAn(l) && d) Object.assign(l, { fn: d.formula, anLabel: d.label, anKind: d.kind }); } };
  for (const p of S.panels) sync(p.settings);
  for (const g of Object.values(S.groups)) sync(g.settings);
  showExprErrors(errors);
  showAnalyticInfo(an.errors);
  if (render) { rebuildAll(); save(); }
}
/** Errors of the analytic functions box, and the list of functions (v8.4, human 2026-10-15: "as default in this list
 *  the names of the functions, then a hover can show the fn and a click can open a fn box"). */
function showAnalyticInfo(errors = []) {
  $("anx-errors").textContent = errors.join("\n");
  $("anx-info").textContent = "";
  defChips("anx-list", Object.values(store.analytics).map(d => ({ name: d.name, label: d.label, kind: d.kind, src: d.formula })), "fn");
}
/** The names as a list; hover: the equation (typeset); click: the box to change it. */
function defChips(listId, items, what) {
  const runs = Object.values(store.runs);
  $(listId).replaceChildren(...(items.length ? items.map(d => {
    const b = el("button", { class: "fnchip hastip" + (d.lib ? " lib" : ""), onclick: e => defBox(what, d.name, e) }, d.lib ? `📚 ${d.name}` : d.name);
    b._tip = box => {
      const eq = el("div", { class: "fn-eq" });
      let tex; try { tex = (what === "fn" && LIBLATEX[d.name]) || formulaToLatex(d.src, d.name); } catch { tex = `\\text{${d.name}}`; }
      const where = what === "fn" ? (runs.some(r => r.sources["an:" + d.name]) ? "1D lines · 2D maps" : "1D lines") : "";
      const note = (what === "fn" ? LIBNOTES : d.lib ? DERNOTES : S.exprNotes || {})[d.name];
      box.append(d.label !== d.name ? el("b", {}, d.label) : "", eq, note ? el("div", { class: "tipnote" }, note.length > 240 ? note.slice(0, 240) + " …" : note) : "",
        el("div", { class: "tipdim" }, [what === "fn" && d.kind && d.kind !== d.label ? `y axis: ${d.kind}` : "", where, d.lib ? "every desktop (library)" : "", "click to edit"].filter(Boolean).join(" · ")));
      renderMath(eq, tex);
    };
    return b;
  }) : [el("span", { class: "dim" }, "none yet: ＋ above")]));
}
/** text with the line of definition `old` replaced by `line` (or `line` added; line null = removed). */
function setDefLine(text, old, line) {
  const ls = String(text || "").split("\n");
  const i = old ? ls.findIndex(l => !l.trim().startsWith("#") && (l.match(AN_LINE) || [])[1] === old) : -1;
  if (i >= 0) { if (line === null) ls.splice(i, 1); else ls[i] = line; }
  else if (line !== null) { while (ls.length && !ls[ls.length - 1].trim()) ls.pop(); ls.push(line); }
  return ls.join("\n");
}
/** Plots that use function / expression `name` (analytic lines and maps; quantities of lines and maps). */
function defUses(what, name) {
  let n = 0;
  for (const s of [...S.panels.map(p => p.settings), ...Object.values(S.groups).map(g => g.settings)]) {
    if (what === "fn") n += (s?.lines || []).filter(l => l.an === name).length + (s?.q === "an:" + name ? 1 : 0);
    else n += (s?.lines || []).filter(l => l.q === name).length + (s?.q === name ? 1 : 0);
  }
  return n;
}
function renameDefUses(what, old, nw) {
  for (const s of [...S.panels.map(p => p.settings), ...Object.values(S.groups).map(g => g.settings)]) {
    if (!s) continue;
    for (const l of s.lines || []) { if (what === "fn" && l.an === old) l.an = nw; if (what === "expr" && l.q === old) l.q = nw; }
    if (what === "fn" && s.q === "an:" + old) s.q = "an:" + nw;
    if (what === "expr" && s.q === old) s.q = nw;
  }
}
const FN_HELP = "{name} = a parameter, filled where it is used: the x axis, a number or variable, a quantity, a config number (Bp …) or the time\n" +
  "+ − * / ^  sqrt abs log log10 exp sin cos tan sign min max atan2 deg  pi e";
const EXPR_HELP = "names of stored quantities (same dataset, same axes), coordinates (r, theta, r_max, theta_foot), pi, Bp, config numbers\n" +
  "+ − * / ^  sqrt abs log log10 exp sin cos tan sign min max atan2 deg";
/** The box of one function (what = "fn") or expression ("expr"): name, formula, label, y-axis group, LaTeX; a live
 *  typeset preview; save / delete. name null = a new one. */
function defBox(what, name, ev) {
  const fn = what === "fn", defs = fn ? store.analytics : store.expressions, d = name ? defs[name] : null;
  const nameIn = el("input", { type: "text", size: 16, value: name || "", placeholder: "name", title: "letters, digits and _" });
  const formIn = el("textarea", { rows: 3, cols: 40, spellcheck: "false", class: "fn-tex", placeholder: fn ? "2 * {I} * {r_max}^2 / {Bp}" : "B3 * r^1.5", title: fn ? FN_HELP : EXPR_HELP });
  formIn.value = d ? (fn ? d.formula : d.expr) : "";
  // v8.9 (human 2026-10-15: "have the equation itself be an editable thing like desmos? I click into a section and can
  // edit it"): the formula as an equation edited in place; what it says is read back into the formula (latexToFormula)
  let mathMode = localStorage.getItem("aptvis.mathedit") !== "text", mf = null, mathErr = null, names = new Map();
  const mathHost = el("div", { class: "mathhost" });
  const run1 = Object.values(store.runs)[0];
  const insSel = el("select", { class: "mathins", title: "put a name in where the cursor is (long names and names with digits: from here; typed letters multiply)" });
  const fillIns = () => {
    const opts = (lab, list) => (list.length ? el("optgroup", { label: lab }, list.map(n => el("option", { value: n }, n))) : null);
    const qs = Object.values(run1?.sources || {}).filter(s => !s.isAn && !s.isExpr).map(s => s.name);
    const conf = Object.entries(run1?.conf || {}).filter(([, v]) => typeof v === "number").map(([k]) => k);
    insSel.replaceChildren(el("option", { value: "" }, "insert a name…"), opts("in this formula", formulaNames(formIn.value)), opts("quantities", qs),
      opts("config numbers", conf), opts("coordinates", axisCatalog()));
  };
  const modeBtn = el("button", { class: "tog", title: "edit it as an equation or as text" });
  const fromMath = () => {
    if (!mf) return;
    try { formIn.value = latexToFormula(mf.value, names, fn); mathErr = null; } catch (e) { mathErr = e.message; }
    update();
  };
  const showMode = async () => {
    modeBtn.textContent = mathMode ? "⌨ text" : "∑ equation";
    formIn.style.display = mathMode ? "none" : ""; mathHost.style.display = insSel.style.display = mathMode ? "" : "none";
    mf = null; mathErr = null; mathHost.replaceChildren();
    if (!mathMode) { update(); return; }
    try {
      const MF = await loadMathLive(), e = editLatex(formIn.value.trim());
      names = e.names;
      mf = new MF();
      mathHost.replaceChildren(mf);                                      // on the page first: it takes a value only then
      mf.mathVirtualKeyboardPolicy = "manual"; mf.menuItems = [];
      mf.value = e.tex;
      mf.addEventListener("input", () => { clearTimeout(mf._t); mf._t = setTimeout(fromMath, 150); });
      fillIns();
      setTimeout(() => mf?.focus(), 60);
      update();
    } catch (er) { mathMode = false; toast(`the equation editor did not load (${er.message}): text instead`, true); showMode(); }
  };
  modeBtn.onclick = () => { mathMode = !mathMode; localStorage.setItem("aptvis.mathedit", mathMode ? "math" : "text"); showMode(); };
  insSel.onchange = () => {
    const n = insSel.value; insSel.value = "";
    if (!n || !mf) return;
    const t = editSymbol(n); names.set(symbolKey(t), n);
    mf.executeCommand(["insert", t]); mf.focus(); fromMath();
  };
  const labIn = el("input", { type: "text", size: 24, value: d && d.label !== name ? d.label : "", placeholder: "label (menus, legend)" });
  const kinds = [...new Set(Object.values(store.runs).flatMap(r => Object.values(r.sources).map(s => s.kind)).filter(Boolean))].sort();
  const kindIn = fn ? el("input", { type: "text", size: 18, value: d && d.kind !== d.label ? d.kind : "", placeholder: "y-axis group", list: "yax-kinds", title: "drawn on one y axis with the quantities of this group" }) : null;
  const texIn = fn ? el("textarea", { rows: 2, cols: 40, spellcheck: "false", class: "fn-tex", placeholder: "own LaTeX (empty: made from the formula)", title: "only how it is shown; the formula is what is computed" }) : null;
  if (texIn) texIn.value = (name && LIBLATEX[name]) || "";
  // v8.25: an expression lives on this desktop or in the library (every desktop)
  const wasLib = !fn && !!name && !!store.libExpr?.has(name);
  const whereSel = fn ? null : el("select", { title: "every desktop: kept in the shared library (views/library/derived.json), like the analytic functions" },
    el("option", { value: "desk", selected: !wasLib || null }, "this desktop"), el("option", { value: "lib", selected: wasLib || null }, "every desktop (library)"));
  const notes = fn ? LIBNOTES : wasLib ? DERNOTES : (S.exprNotes ||= {});
  // v8.5: the parameters (functions) / names (expressions) the formula uses, listed as it is typed
  const pdesc = fn ? { ...((name && LIBPARAMS[name]) || {}) } : null, parBox = el("div", { class: "fn-params" });
  const run0 = Object.values(store.runs)[0];
  const fillText = p => {
    if (!fn) {
      const s = run0?.sources[p];
      return s ? `quantity · ${s.label}` : run0?.coord(p) ? "coordinate" : S.vars[p] && S.vars[p].type !== "dataset" ? `variable · ${listOf("$" + p).map(R.fmt).join(", ")}`
        : typeof run0?.conf?.[p] === "number" ? `config · ${R.fmt(run0.conf[p])}` : ["pi", "e"].includes(p) ? "" : "unknown name";
    }
    const d = anDefault(p, null, run0), axis = axisCatalog().includes(p) ? ` · the x axis on ${axisLabel(p)} plots` : "";
    return (d.mode === "data" ? `quantity · ${run0.sources[p].label}` : d.mode === "conf" ? `config · ${R.fmt(run0.conf[p])}` : d.mode === "time" ? "the slider's time"
      : d.value ? `variable ${p}` : "a number (typed where it is used)") + axis;
  };
  let shownPars = "";
  const renderParams = src => {
    const ps = formulaNames(src).filter(p => fn || !["pi", "e"].includes(p));
    if (ps.join(",") === shownPars) return;                     // unchanged: keep the boxes being typed in
    shownPars = ps.join(",");
    parBox.replaceChildren(...(ps.length ? ps.map(p => el("div", { class: "fn-param" },
      el("code", {}, fn ? `{${p}}` : p), el("span", { class: "dim" }, fillText(p)),
      fn ? (() => { const i = el("input", { type: "text", size: 16, value: pdesc[p] || "", placeholder: "what it is", title: "a short description (shown here and when the function is used)" });
        i.addEventListener("input", () => { pdesc[p] = i.value; }); return i; })() : null)) : []));
  };
  const noteIn = el("textarea", { rows: 3, cols: 40, class: "fn-notes", placeholder: "notes: what it is, where it comes from, caveats …" });
  noteIn.value = (name && notes[name]) || "";
  const prev = el("div", { class: "fn-eq" }), err = el("div", { class: "warn" });
  const update = async () => {
    err.textContent = "";
    const src = formIn.value.trim().replace(/\s*\n\s*/g, " ");
    renderParams(src);
    if (mathMode && mathErr) err.textContent = mathErr;
    if (!src) { prev.replaceChildren(); return; }
    try { if (fn) compileAnalytic(src); else { const e = parseExpressionText(`x = ${src}`).errors[0]; if (e) throw new Error(e.replace(/^x: /, "")); } } catch (e) { err.textContent ||= e.message; }
    if (mathMode && !texIn?.value.trim()) { prev.replaceChildren(); return; }     // the equation field shows it
    let tex; try { tex = texIn?.value.trim() || formulaToLatex(src, nameIn.value.trim() || "f"); } catch (e) { err.textContent ||= e.message; return; }
    const m = await renderMath(prev, tex); if (m && texIn?.value.trim()) err.textContent = m;
  };
  for (const x of [nameIn, formIn, texIn].filter(Boolean)) x.addEventListener("input", () => { clearTimeout(x._t); x._t = setTimeout(update, 200); });
  const save = async () => {
    if (mathMode && mathErr) { err.textContent = mathErr; return; }
    const nm = nameIn.value.trim(), src = formIn.value.trim().replace(/\s*\n\s*/g, " ");
    if (!(fn ? /^[A-Za-z_]\w*$/ : /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/).test(nm)) { err.textContent = fn ? "name: letters, digits and _ (no spaces)" : "name: letters, digits and _ (a family's member: family.name)"; return; }
    if (nm !== name && defs[nm]) { err.textContent = `${nm} exists already`; return; }
    if (!src || src.includes("#")) { err.textContent = src ? "no # in a formula" : "write the formula"; return; }
    try { if (fn) compileAnalytic(src); else { const e = parseExpressionText(`${nm} = ${src}`).errors[0]; if (e) throw new Error(e); } } catch (e) { err.textContent = e.message; return; }
    const label = labIn.value.trim().replace(/[#\n]/g, ""), kind = kindIn ? kindIn.value.trim().replace(/[#\[\]\n]/g, "") : "";
    const line = `${nm} = ${src}` + (label || kind ? `   # ${label || nm}` + (kind ? ` [${kind}]` : "") : "");
    const toLib = !fn && whereSel.value === "lib", notesTo = fn ? notes : toLib ? DERNOTES : (S.exprNotes ||= {});
    if (name) delete notes[name];
    const nt = noteIn.value.trim(); if (nt) notesTo[nm] = nt; else delete notesTo[nm];
    if (fn) {
      if (name && name !== nm) delete LIBPARAMS[name];
      const used = formulaNames(src), kept = Object.fromEntries(Object.entries(pdesc).map(([p, v]) => [p, v.trim()]).filter(([p, v]) => v && used.includes(p)));
      if (Object.keys(kept).length) LIBPARAMS[nm] = kept; else delete LIBPARAMS[nm];
    }
    if (fn) {
      LIBTEXT = setDefLine(LIBTEXT, name, line);
      if (name && name !== nm) delete LIBLATEX[name];
      const t = texIn.value.trim(); if (t) LIBLATEX[nm] = t; else delete LIBLATEX[nm];
      $("anx").value = LIBTEXT;
    } else if (toLib) { S.expressions = setDefLine(S.expressions, name, null); DERTEXT = setDefLine(DERTEXT, name, line); $("expr").value = S.expressions; }
    else { DERTEXT = setDefLine(DERTEXT, name, null); S.expressions = setDefLine(S.expressions, name, line); $("expr").value = S.expressions; }
    if (name && name !== nm) renameDefUses(what, name, nm);
    closePopover();
    if (fn) await saveAnalyticsLib();
    else if (toLib || wasLib) await saveDerivedLib();
    applyExpressions();
  };
  const del = async () => {
    const n = defUses(what, name);
    if (!(await askConfirm(`Delete ${fn ? "function" : "expression"} ${name}?` + (n ? ` ${n} plot line${n > 1 ? "s use" : " uses"} it.` : ""), "delete"))) return;
    delete notes[name];
    if (fn) { LIBTEXT = setDefLine(LIBTEXT, name, null); delete LIBLATEX[name]; delete LIBPARAMS[name]; $("anx").value = LIBTEXT; await saveAnalyticsLib(); }
    else { S.expressions = setDefLine(S.expressions, name, null); $("expr").value = S.expressions; if (wasLib) { DERTEXT = setDefLine(DERTEXT, name, null); await saveDerivedLib(); } }
    applyExpressions();
  };
  const r = (lab, ...c) => el("div", { class: "pop-row" }, el("span", { class: "lab" }, lab), ...c);
  popover(ev.clientX, ev.clientY, [
    el("div", { class: "pop-title" }, name ? `${fn ? "function" : "expression"} ${name}` : `new ${fn ? "function" : "expression"}`),
    r("name", nameIn), r(fn ? "formula" : "expression", el("div", { class: "fn-formula" }, mathHost, formIn, el("div", { class: "pop-row" }, modeBtn, insSel))), prev, err, r(fn ? "parameters" : "uses", parBox), r("label", labIn), whereSel ? r("for", whereSel) : null,
    fn ? r("y axis", kindIn, el("datalist", { id: "yax-kinds" }, kinds.map(k => el("option", { value: k })))) : null,
    fn ? r("LaTeX", texIn) : null,
    r("notes", noteIn),
    el("div", { class: "pop-row pop-sep" }, el("button", { class: "on", onclick: save }, "save"),
      name ? el("button", { onclick: () => { closePopover(); del(); } }, "delete") : null,
      el("button", { onclick: closePopover }, "cancel"))]);
  showMode();                                                          // the equation field (or the text) + the checks
  if (!name || !mathMode) (name ? formIn : nameIn).focus();
}
const runShape = () => JSON.stringify(Object.entries(store.runs).map(([n, r]) => [n, Object.keys(r.sources).sort()]));
const runStamp = () => JSON.stringify(Object.entries(store.runs).map(([n, r]) => [n, r.m.updated]));
/** v11.4: read one dataset again (a cache job started from a plot stored more outputs, or its first ones); true if it
 *  could be read. New quantities or a new dataset rebuild the menus; new outputs only redraw. */
async function refreshRun(name) {
  const shape0 = runShape(), stamp0 = runStamp();
  try { await store.loadRun(name); } catch { return false; }
  if (runStamp() === stamp0) return true;
  clearMeasured();
  if (runShape() !== shape0) rebuildAll(); else { updateTimeBar(); renderAll(); }
  $("updated").textContent = "data read " + new Date().toLocaleTimeString();
  return true;
}
async function refresh() {
  const atEnd = timeIndex() === allTimes().length - 1, shape0 = runShape(), stamp0 = runStamp();
  await loadAllRuns();
  await loadAnalyticsLib();                                 // v7.5: changed in another tab / browser meanwhile?
  if (S.expressions || S.analytics || LIBTEXT || DERTEXT) applyExpressions(false);
  $("anx").value = LIBTEXT;
  $("updated").textContent = "data read " + new Date().toLocaleTimeString();
  if (runStamp() === stamp0) return;                      // nothing new (auto-refresh every 30 s): no work
  clearMeasured();
  if (atEnd) S.t = allTimes().at(-1) ?? S.t;
  if (runShape() !== shape0) rebuildAll();                // new runs / quantities: menus change
  else { updateTimeBar(); renderAll(); }                  // only new steps: redraw
}
function syncControls() {
  $("fps").value = S.fps; $("loop").checked = S.loop; $("expr").value = S.expressions; $("anx").value = LIBTEXT;
  $("cachemb").value = Math.round(store.cache.max / 1e6);
  $("dname").textContent = S.desktopName || "unsaved desktop";
}
let autoTimer = null;
/** Desktop style box (v5.8, human 2026-10-05: "good settings for altering things like fontsize … a global setting for
 *  the desktop"). Every number can follow a variable; empty = default. */
function styleDialog(e) {
  const st = S.style = S.style || {};
  const apply = () => { rebuildAll(); save(); };
  const row = (label, key, hint = "") => el("div", { class: "pop-row" }, el("span", { class: "lab wide" }, label),
    numRef(st[key] ?? null, v => { if (v === null) delete st[key]; else st[key] = v; apply(); }, { size: 4, placeholder: String(STYLE_DEFAULTS[key]) }),
    el("span", { class: "dim" }, hint || `default ${STYLE_DEFAULTS[key]}`));
  const fams = [["system-ui, sans-serif", "sans (system)"], ["Georgia, 'Times New Roman', serif", "serif"],
    ["'Latin Modern Roman', 'CMU Serif', 'Computer Modern', 'Times New Roman', serif", "LaTeX-like (if installed)"], ["ui-monospace, Consolas, monospace", "mono"]];
  popover(e.clientX, e.clientY, [
    el("div", { class: "pop-title" }, "desktop style (all plots)"),
    el("div", { class: "dim" }, "font sizes (px)"),
    row("title", "title"), row("axis labels", "label"), row("tick numbers", "tick"), row("legend", "legend"), row("fit text", "info"),
    row("colour-bar label", "cbar"), row("colour-bar numbers", "cbarTick"),
    el("div", { class: "pop-row" }, el("span", { class: "lab wide" }, "font"),
      select(fams, st.family ?? STYLE_DEFAULTS.family, v => { if (v === STYLE_DEFAULTS.family) delete st.family; else st.family = v; apply(); })),
    el("div", { class: "dim" }, "lines"),
    row("line widths ×", "lineScale", "multiplies every curve and tool line (default 1)"), row("axis frame", "frame"), row("tick length", "ticklen"),
    el("div", { class: "pop-row pop-sep" }, el("button", { onclick: () => { S.style = {}; closePopover(); apply(); } }, "↺ defaults"),
      el("button", { onclick: closePopover, title: "saved with the desktop · margins grow with the text, plot areas keep their size · boxes take number variables" }, "done")),
  ]);
}
/** Time range (v5.12, human 2026-10-06: "pairs1 crashed at around 70, is there a way I can change the available
 *  times?"; "a long sim but only care about say post twist"). One range for the desktop: the slider, playback and
 *  precaching stay inside it; plots with a time axis show it unless they have their own window. */
function timeRangeDialog(e) {
  const tr = S.trange = S.trange || {}, info = timeInfo();
  const apply = () => { updateTimeBar(); renderAll(); save(); };
  const box = (key, ph) => numRef(tr[key] ?? null, v => { if (v === null) delete tr[key]; else tr[key] = v; apply(); }, { size: 6, placeholder: ph,
    title: "empty = the data's own start / end · the slider, ▶ and precaching stay inside · a dataset that ends early keeps its last frame" });
  const flag = (label, on, set, title) => el("label", { class: "chk", title },
    el("input", { type: "checkbox", checked: on, onchange: ev => { set(ev.target.checked); apply(); } }), label);
  const short = info.runs.length > 1 ? info.runs[0] : null;
  popover(e.clientX, e.clientY, [
    el("div", { class: "pop-title" }, "time range (whole desktop)"),
    el("div", { class: "pop-row" }, el("span", { class: "lab" }, "from"), box("from", info.all.length ? R.fmt(info.all[0]) : "start"),
      el("span", { class: "lab" }, "to"), box("to", info.all.length ? R.fmt(info.all.at(-1)) : "end")),
    flag("only times every dataset here has" + (short ? ` (to t = ${R.fmt(short.t1)}: ${short.run} is the shortest)` : ""), !!tr.common,
      on => { if (on) tr.common = true; else delete tr.common; }, "ends the range where the shortest dataset ends"),
    flag("plots with a time axis show only the range", tr.axes !== false, on => { if (on) delete tr.axes; else tr.axes = false; },
      "unless a plot has its own window (set in its settings, or by zooming it)"),
    el("div", { class: "dim" }, "datasets on this desktop"),
    ...info.runs.map(r => el("div", { class: "dim" }, `${r.run}: t = ${R.fmt(r.t0)} – ${R.fmt(r.t1)} (${r.n} steps)`)),
    el("div", { class: "pop-row pop-sep" }, el("button", { onclick: () => { S.trange = {}; closePopover(); apply(); } }, "↺ all times"),
      el("button", { onclick: closePopover }, "done")),
  ]);
}
/** serve.py / the port forward unreachable (v5.2): one banner instead of a "Failed to fetch" per panel; playback
 *  pauses; a ping every 5 s; when it answers, features are re-read (a restarted serve.py) and panels redrawn. */
function showOffline() {
  if (playing) { playing = false; playGen++; $("play").textContent = "▶"; }
  $("offline").style.display = "block";
  clearInterval(showOffline.timer);
  showOffline.timer = setInterval(async () => {
    if (!(await apiAvailable(true))) return;
    clearInterval(showOffline.timer); store.net.offline = false; backOnline();
  }, 5000);
}
function backOnline() {
  $("offline").style.display = "none";
  store.colsApi = hasFeature("cols") && params.get("bands") !== "off" ? apiUrl("cols") : null;
  store.rowsApi = hasFeature("rows") ? apiUrl("rows") : null;        // v10.2: one row of every output in one request
  renderAll();
}

async function main() {
  // v15.0: what plugins may call in the wiring (make a plot from a plot, say something, redraw the plots that read X)
  setCoreApi({ toast, spawnPlot, redrawReaders: what => { for (const p of S.panels) if (p.type === "1d" && (eff(p).lines || []).some(l => lineReads(l, what))) requestRender(p); },
    makeFigure, rebuildAll, save });                         // v15.1: a plugin's plot-menu entry makes a figure (aperture4: linked slices)
  await loadPlugins(params);                                // v14.9: plugins register before anything is read or drawn
  for (const f of failedPlugins()) setTimeout(() => toast(`plugin ${f.name} not loaded: ${f.error}`, true), 600);
  try { await loadAllRuns(); }
  catch (e) { $("desktop").textContent = `Could not read ${store.base}index.json — ${e.message}. Start the viewer with serve.py (see README).`; return; }
  if (params.get("fresh")) {                                // ?fresh=1: start from the example layout (old one backed up)
    if (window.aptvisBackup?.keep(localStorage.getItem(STATE_KEY)) !== false) localStorage.removeItem(STATE_KEY);
    params.delete("fresh"); history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
  }
  const saved = localStorage.getItem(STATE_KEY);
  if (saved) { try { Object.assign(S, JSON.parse(saved)); } catch { /* broken saved state: start fresh */ } }
  if (window.aptvisNoStorage) setTimeout(() => toast("this browser blocks storage: layouts are not remembered after a reload (saving to views/ still works)", true), 800);
  // v5.2: panels whose run can't be read right now (e.g. being recorded) are kept and show a warning
  if (!(S.panels || []).length) { S.groups = {}; S.panels = defaultDesktop(); }
  const ren0 = migrateDesktop();                          // v14.4: the one migration pipeline
  $("theme").replaceChildren(...THEMES.map(([k, ch, tip]) => el("button", { "data-t": k, title: tip, onclick: () => setTheme(k) }, ch)));
  setTheme(theme, false);
  setVarsApi({ varsChanged: (r) => api.varsChanged(r), toast, highlight, relayout: () => { scheduleLayout(); placeSettings(); },
    // v12.0: the Tools tab
    toolTypes: () => TOOLS, toolFolders: () => TOOL_FOLDERS, toolWhere, toolDrag, armTool,
    toolsInUse: () => S.panels.map(p => ({ panel: p, name: p.name || panelType(p), tools: toolList(settingsCtx(p)) })).filter(x => x.tools.length),
    editTool: (pid, tid, ev) => { const p = S.panels.find(x => x.id === pid); if (p) openToolEditor(settingsCtx(p), tid, ev); } });
  setAutoChange(() => { save(); refreshSettings(); });
  // v8.32: a named tool's output changed (new frame, new settings): redraw the other plots that use it (steps from an
  // output, "$name." in a number field) and the Outputs tab when it is open
  // v14.4: one change bus (results.js): a tool's results changed -> the plots made from it redraw (lines that read it,
  // linekinds.js deps); a named output changed -> the plots that use it and the sidebar
  onResult(owner => {
    const i = owner.indexOf(":"), kind = owner.slice(0, i), name = owner.slice(i + 1);
    if (kind === "tool") { const id = Number(name); for (const p of S.panels) if (p.type === "1d" && (eff(p).lines || []).some(l => lineReads(l, { tool: id }))) requestRender(p); }
    if (kind === "output") outputChanged(name, getResult(owner, "own")?.panel);
  });
  const outputChanged = (name, pid) => {
    const src = `"source":"${name}"`, ref = `$${name}.`;
    for (const p of S.panels) { if (p.id === pid) continue; const j = JSON.stringify(eff(p)); if (j.includes(src) || j.includes(ref)) requestRender(p); }
    if (["outs", "tools"].includes(localStorage.getItem("aptvis.sbtab"))) renderSidebar();
  };
  // v9.0: more outputs of a tool's foot gaps are known: redraw the plots that show them
  setTablesApi({ toast, changed: tablesChanged, newTablePlot });          // v14.0
  setCycApi({ newPlot: newCycPlot });                                     // v14.1
  setLineoutApi({ newPlot: newLineoutPlot, retarget: retargetLineout });  // v14.2
  const head = document.querySelector("header"), setHeadH = () => document.documentElement.style.setProperty("--headh", head.offsetHeight + "px");
  setHeadH(); new ResizeObserver(setHeadH).observe(head);
  const foot = document.querySelector("footer"), setFootH = () => document.documentElement.style.setProperty("--footh", foot.offsetHeight + "px");
  setFootH(); new ResizeObserver(setFootH).observe(foot);
  // v8.1 (UI review §A1): rarely used header items in ☰ (they keep their ids and wiring)
  const hm = $("hmenu");
  $("hmenubtn").onclick = e => { e.stopPropagation(); hm.hidden = !hm.hidden; if (!hm.hidden) { const r = e.target.getBoundingClientRect(); hm.style.left = Math.min(r.left, innerWidth - 260) + "px"; hm.style.top = r.bottom + 4 + "px"; } };
  document.addEventListener("mousedown", e => { if (!hm.hidden && !hm.contains(e.target) && e.target.id !== "hmenubtn") hm.hidden = true; });
  hm.addEventListener("click", e => { if (e.target.closest("button, a")) hm.hidden = true; });
  const rb = $("restorebak");                               // v8.9: the backup a fresh start kept (index.html)
  if (window.aptvisBackup?.has()) {
    rb.hidden = false; rb.textContent = `↺ restore the layout backup${window.aptvisBackup.when()}`;
    rb.onclick = () => { clearTimeout(saveTimer); localStorage.setItem(STATE_KEY, JSON.stringify(S)); window.aptvisBackup.restore(); };
  }
  setTimeout(() => remapNote(ren0), 800);
  await loadAnalyticsLib();                                 // v7.5: the shared analytic functions (v8.25: and derived quantities)
  syncControls();
  if (S.expressions || S.analytics || LIBTEXT || DERTEXT) applyExpressions(false);
  if (S.t === null || !allTimes().includes(S.t)) S.t = allTimes().at(-1) ?? 0;

  $("tslider").addEventListener("input", e => setTimeIndex(Number(e.target.value)));
  $("play").onclick = play;
  $("prev").onclick = () => setTimeIndex(timeIndex() - 1);
  $("next").onclick = () => setTimeIndex(timeIndex() + 1);
  $("first").onclick = () => setTimeIndex(0);
  $("last").onclick = () => setTimeIndex(allTimes().length - 1);
  $("trange").onclick = e => timeRangeDialog(e);
  $("fps").onchange = e => { S.fps = Math.max(0.5, Number(e.target.value) || 8); save(); };
  $("loop").onchange = e => { S.loop = e.target.checked; save(); };
  $("cachemb").onchange = e => { const mb = Math.max(200, Number(e.target.value) || 1200); store.cache.max = mb * 1e6; store.cache.evict(); localStorage.setItem("aptvis.cacheMB", mb); };
  $("zoomout").onclick = () => setZoom(zoom / 1.15);
  $("zoomin").onclick = () => setZoom(zoom * 1.15);
  $("prefetch").onclick = () => setPrefetch(!prefetchOn); setPrefetch(prefetchOn);
  $("zoomval").onclick = () => setZoom(1);
  // v6.3: a new panel starts from a small form with what defines it (its axes); "more settings…" opens the full box
  const createPanel = (type, s, more) => { const p = newPanel(type, s); addPanel(p); if (more) toggleSettings(p); };
  $("add2d").onclick = e => openNewPanel("2d", e.clientX, e.clientY, createPanel);
  $("add1d").onclick = e => openNewPanel("1d", e.clientX, e.clientY, createPanel);
  $("refresh").onclick = refresh;
  $("auto").onchange = e => { clearInterval(autoTimer); if (e.target.checked) autoTimer = setInterval(refresh, 30000); };
  $("savedesk").onclick = () => saveDesktop(false);
  $("desktops").onclick = desktopsDialog;
  $("panelsets").onclick = templatesDialog;
  $("style").onclick = e => styleDialog(e);
  $("help").onclick = () => helpDialog();                // v15.3: the "?" list of every tool
  $("undo").onclick = undo; $("redo").onclick = redo;
  $("expr-apply").onclick = () => { S.expressions = $("expr").value; applyExpressions(); };
  $("expr-new").onclick = e => defBox("expr", null, e);
  // v8.5 focus mode (the only view since v14.8): a thumbnail is clicked to focus it (its plot does not pan / zoom / edit)
  document.body.classList.add("focusmode");
  const thumbOf = e => e.target.closest?.("#desktop .thumb");
  for (const ev of ["mousedown", "pointerdown", "dblclick", "click"]) $("desktop").addEventListener(ev, e => {
    const t = thumbOf(e); if (!t) return;
    e.stopPropagation(); e.preventDefault();
    if (ev === "pointerdown" && e.button === 0) focusDrag(e, t);       // v8.9: drag it onto the focused plot to link
    if (ev === "click" && !thumbDragged) setFocus(t.dataset.bkey);
  }, true);
  $("desktop").addEventListener("wheel", e => { if (thumbOf(e) && !e.ctrlKey) e.stopPropagation(); }, true);   // scroll the page, not the plot
  $("anx-new").onclick = e => defBox("fn", null, e);
  // v8.4 (human 2026-10-15: "the side window is also HUGE … a way of changing that sidebar size"): drag its edge
  const sbw = w => document.documentElement.style.setProperty("--sbw", Math.max(190, Math.min(720, w)) + "px");
  sbw(Number(localStorage.getItem("aptvis.sbw")) || 258);
  $("sbgrip").addEventListener("pointerdown", e => {
    e.preventDefault();
    const move = ev => { sbw(ev.clientX); scheduleLayout(); };
    const up = ev => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      localStorage.setItem("aptvis.sbw", Math.max(190, Math.min(720, ev.clientX))); scheduleLayout(); placeSettings(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  });
  $("anx-apply").onclick = async () => {                    // v7; v7.5: saved to the shared library
    let text = $("anx").value;
    try {                                                  // changed elsewhere (another tab / browser) since: keep those too
      const cur = (await loadLibrary("analytics")).obj?.text || "";
      if (cur !== LIBTEXT) { const m = mergeAnalyticText(text, cur); if (m.added.length) { text = m.text; toast(`kept ${m.added.join(", ")}, added elsewhere meanwhile`); } }
    } catch { /* offline: save what is here */ }
    LIBTEXT = text; $("anx").value = text;
    await saveAnalyticsLib(); applyExpressions();
    if (libWhere === "browser") toast("analytic functions saved in this browser (every desktop here); restart serve.py to share them with every browser", true);
  };
  $("setbox").addEventListener("pointerdown", e => { if (e.target.closest(".sethead")) dragSettingsBox(e); });
  // v8.21 (human 2026-11-04: "the panels don't really update to fill my screen unless i leave the panel and come back";
  // text "wrong size" after changing screens): VS Code's browser doesn't always send "resize" when the screen or its
  // scaling changes, so the board stayed laid out for the old width (and focus mode kept its old scale). Now the page's
  // own size is watched too, and a pixel-ratio change also lays the board out again.
  let roomKey = "";
  const roomChanged = () => {
    const k = `${document.documentElement.clientWidth}x${innerHeight}@${window.devicePixelRatio}`;
    if (k === roomKey) return;
    roomKey = k; fitK = {}; scheduleLayout(); placeSettings();
  };
  window.addEventListener("resize", roomChanged);
  new ResizeObserver(roomChanged).observe(document.documentElement);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) roomChanged(); });
  // v8.22: Esc (with no pop-up open) or a click on the empty desktop clears the shift-click selection
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !document.querySelector(".popover")) clearSel(); });
  $("deskwrap").addEventListener("mousedown", e => { if (!e.shiftKey && (e.target === $("deskwrap") || e.target === $("desktop"))) clearSel(); });
  // v8: Ctrl + wheel (mouse) / pinch (trackpad) anywhere = panel size; the plots' own wheel zoom leaves it alone
  window.addEventListener("wheel", e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    setZoom(zoom * Math.exp(-d * 0.0025));
  }, { passive: false });
  // v7.3: moved to a screen with another pixel ratio (laptop 150 % ↔ monitor 100 %): redraw the plots sharp
  const watchDpr = () => matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => { roomChanged(); renderAll(); watchDpr(); }, { once: true });
  watchDpr();
  // v5.17 fix (human 2026-10-06: "the orange highlight for settings remains behind until I move it slightly"): panels
  // glide to new places after a drop (CSS transition), so the settings outline was measured mid-glide; redraw it
  // when a panel or figure arrives
  $("desktop").addEventListener("transitionend", e => {
    if ((e.propertyName === "left" || e.propertyName === "top") && e.target.parentElement === $("desktop")) placeSettings();
  });
  window.addEventListener("scroll", placeSettings, { passive: true });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && settingsFor !== null && !document.querySelector(".popover")) { closeSettings(); return; }
    if (["INPUT", "TEXTAREA", "SELECT", "MATH-FIELD"].includes(e.target.tagName) || e.target.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    // v8.1: the browser's zoom keys change the panel size here, like Ctrl + wheel (text and buttons keep their size)
    if (mod && e.key === "0") { e.preventDefault(); setZoom(1); return; }
    if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); setZoom(zoom * 1.1); return; }
    if (mod && e.key === "-") { e.preventDefault(); setZoom(zoom / 1.1); return; }
    if (e.key === "Tab") {                 // v8.5: Tab / Shift+Tab = the next / previous block
      e.preventDefault();
      const keys = blocks().map(b => b.key), i = keys.indexOf(focusKey);
      if (keys.length) setFocus(keys[(i + (e.shiftKey ? -1 : 1) + keys.length) % keys.length]);
      return;
    }
    if (e.key === "ArrowRight") setTimeIndex(timeIndex() + 1);
    else if (e.key === "ArrowLeft") setTimeIndex(timeIndex() - 1);
    else if (e.key === " ") { e.preventDefault(); play(); }
  });
  const builtin = Object.entries(store.runs).flatMap(([n, r]) => Object.entries(r.m.expressions || {}).map(([k, v]) => `${k} = ${v.expr}   (${n})`));
  $("expr-builtin").textContent = builtin.length ? "built in: " + builtin.join(" · ") : "";
  $("saveinfo").textContent = (await apiAvailable(true)) ? "saving to views/ on the server" : "⚠ serve.py not reachable: saving to this browser only";
  // v5.1: download only the r band a panel's zoom shows, if the running serve.py offers it (restart it after an update)
  if (hasFeature("cols") && params.get("bands") !== "off") store.colsApi = apiUrl("cols");
  if (hasFeature("rows")) store.rowsApi = apiUrl("rows");                // v10.2
  store.net.onOffline = showOffline; store.net.onOnline = () => { clearInterval(showOffline.timer); backOnline(); };
  $("zoomval").textContent = Math.round(zoom * 100) + "%";
  try { rebuildAll(); }
  catch (e) { console.error(e); window.aptvisFatal?.(`building the desktop failed: ${e.message}`); return; }
  lastSnap = snapshot();
  $("updated").textContent = "data read " + new Date().toLocaleTimeString();
  prefetchLoop();
  // v11.4: what could be cached but is not (◌ in the menus) and computing it from a plot — serve.py with the datamgr only
  if (hasFeature("datamgr")) initCacheable({ store, apiUrl, onRun: refreshRun, onIndex: rebuildAll, toast });
  setTimeout(() => { window.aptvisStarted = true; }, 3000);     // v8.9.3: later errors are not start-up errors (index.html)
}
main();
