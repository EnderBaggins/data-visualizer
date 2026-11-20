// gapseries.js (aperture4 plugin since v15.0; was js/gapseries.js) — foot gaps over time (v9.0, human 2026-11-09: "lets start with footpoint gaps though this method can FInd
// other gaps, I want to plot the footpoints as fns of time their voltage and width"; "is this needing new cachine? it
// seems quick to compute these values so maybe not").
//
// A foot-gap line (line.gap = {out, line, foot, what}) sits on a plot whose x axis is time. It reads a named steps tool
// (by its recipe, not its last values): at every output it rebuilds the tool's own line at that time on the tool's plot
// (that plot's x axis and x function, the line's scale and slope, f(y)), finds the steps with the tool's own settings
// (median window, k), and takes the step that touches the north foot (the start of x on an s axis) or the south foot (the
// end of x): its width from that foot to its far edge, its 10–90 % width, the voltage across it (the drop of the line's
// own quantity — the potential — from the foot to the step's far edge, in the slope's sign), or its excess drop. No step
// touching that foot at an output: no value there. Nothing is stored: each output's answer is kept in the browser per
// recipe (changing the tool or its line starts over), computed three outputs at a time, nearest the slider first.
// D22: steps tools are the analysis plugin's (plugins/analysis/): foot gaps need it loaded; without it they are
// unavailable (no "+ line" entry; a saved foot-gap line says so) and this plugin still loads. The steps computation is
// read from plugins/analysis/stepsof.js when the first output is computed.
import { S, eff, resolved, namedTools, isFn, isAn, num1, panelRun, srcOf, runOf, axisInfo, setRunContext, newId, isRef, refsIn, listOf } from "../../js/model.js";
import { lineCurve, expansions, axisFns, asDrawn, smoothOf, smoothSeries, smoothText, normSmooth } from "../../js/panel1d.js";
import { toolDefined } from "../../js/settings.js";
// (v9.1 imported fieldLineLength from measure.js: removed in v10.0)
import * as R from "../../js/render.js";
import { el, select, closePopover } from "../../js/ui.js";
import { numRef } from "../../js/vars.js";
import { smoothControls, keepOnScreen, bareName } from "../../js/lines.js";
import { settings1D, newPanel, timeLine, isTimeLine, panelRun as panelRunOf } from "../../js/model.js";

export const GAP_WHAT = { width: "width", core: "10–90 % width", voltage: "voltage", excess: "excess drop" };
export const GAP_FOOT = { north: "north foot", south: "south foot" };
export const isGap = l => !!l?.gap;
export const gapLineText = l => `${GAP_FOOT[l.gap.foot] ?? l.gap.foot} gap ${GAP_WHAT[l.gap.what] ?? l.gap.what} (${l.gap.out})`;   // v14.4: its name (linekinds.js)
/** A new foot-gap line: steps tool `out` (its line `lineId` in dataset `run`), `foot` north | south, `what` (GAP_WHAT). */
export const newGapLine = (out, lineId, run, foot, what) => ({ id: newId(), gap: { out, line: lineId ?? null, foot, what }, run, label: null, color: null,
  dash: foot === "south" ? "dashed" : "solid", width: 1.6, visible: true });
/** The named steps tools: [{p, t, line}] (line = the data line it reads, or its plot's first); none when the analysis
 *  plugin (the steps tool) is not loaded. */
export function stepsTools() {
  if (!toolDefined("steps")) return [];
  return namedTools().filter(x => x.t.type === "steps").map(x => {
    const data = (eff(x.p).lines || []).filter(l => !isFn(l) && !isAn(l) && !l.gap);
    return { ...x, line: data.find(l => l.id === x.t.line) ?? data[0] ?? null };
  });
}
let onProgress = null;
/** app.js: called with the tool's name when more outputs of its foot gaps are known (redraw the plots that show them). */
export function setGapProgress(fn) { onProgress = fn; }

/** Where a foot-gap line reads: {P, sP, T, srcLine} (the steps tool's plot, its settings, the tool, its line) or {error}. */
export function gapSource(line) {
  if (!toolDefined("steps")) return { error: "foot gaps read a named steps tool, which comes with the analysis plugin, and it is not loaded (list it in viewer/plugins/index.json). The line's settings are kept." };   // D22
  const g = line.gap || {}, hit = namedTools().find(x => x.t.name === g.out && x.t.type === "steps");
  if (!hit) return { error: `foot gaps: there is no steps tool named "${g.out ?? "?"}" (sidebar → Outputs)` };
  const P = hit.p, sP = resolved(eff(P)), T = hit.t, data = (sP.lines || []).filter(l => !isFn(l) && !isAn(l) && !l.gap);
  const srcLine = data.find(l => l.id === (g.line ?? T.line)) ?? data[0];
  if (!srcLine) return { error: `foot gaps: the plot of ${g.out} has no data line` };
  // A measured variable in that plot's x / y function is read at the time shown only. v9.1 (human 2026-11-10: the gaps
  // plot draws x with "x * L" on replicate_2017_8, which has only the 200-point profiles): a field-line length (L) is
  // measured again at every output (feetAt); any other measured variable cannot follow the outputs and is refused.
  const lens = [];
  for (const f of [sP.xfn, sP.yfn]) if (f) for (const v of Object.values(S.vars || {}))
    if (v.type === "measured" && new RegExp(`(?<![\\w.])${v.name}\\b`).test(f)) {
      if (v.op !== "length") return { error: `foot gaps: the plot of ${g.out} draws with "${f}", and ${v.name} is measured at the time shown only — only a field-line length can be measured again at every output` };
      if (!lens.includes(v.name)) lens.push(v.name);
    }
  return { P, sP, T, srcLine, lens };
}
/** A foot-gap line's curves: one per curve of the tool's line (its list values, its datasets). */
export function gapExpansions(line) {
  const src = gapSource(line);
  return src.error ? [null] : expansions(src.srcLine, src.sP.xaxis);
}

const MEMO = new Map();                                   // recipe -> {feet: per output, done, n, running, err}
/** The finite points (xs[j], ys[j]) in rising x: [X, Y]. */
function rising(xs, ys) {
  const idx = [];
  for (let j = 0; j < xs.length; j++) if (Number.isFinite(xs[j]) && Number.isFinite(ys[j])) idx.push(j);
  idx.sort((a, b) => xs[a] - xs[b]);
  return [idx.map(j => xs[j]), idx.map(j => ys[j])];
}
/** y at x in rising (X, Y), held at the ends. */
function at(X, Y, x) {
  if (!X.length) return NaN;
  if (x <= X[0]) return Y[0];
  if (x >= X[X.length - 1]) return Y[Y.length - 1];
  let lo = 0, hi = X.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] <= x) lo = m; else hi = m; }
  return X[hi] === X[lo] ? Y[lo] : Y[lo] + (Y[hi] - Y[lo]) * (x - X[lo]) / (X[hi] - X[lo]);
}
/** Both foot gaps of the tool's line (one curve of it) at time t: {north, south}, each {width, core, voltage, excess} or null. */
async function feetAt({ sP, T, srcLine, lens = [] }, sub, t) {
  const prev = setRunContext(panelRun(sP, "1d"));
  let r;
  try { r = await lineCurve(sP, { ...srcLine, timeMode: "fixed", fixedTime: t }, false, sub); }
  finally { setRunContext(prev); }
  // v9.0.1: say why the tool's line could not be drawn at this output (it was a silent blank)
  if (!r?.curve) throw new Error(r?.error || "the tool's line could not be drawn");
  const c = r.curve, TX = axisFns(sP);
  // v9.1: a field-line length in the x / y function (x * L) is this field line's length at THIS output: the stored one
  // (data at the line's points; v10.0: the Ψ-measured length for the old 200-point profiles is gone)
  let over = null;
  if (lens.length) {
    const L = c.sLen;
    if (!Number.isFinite(L)) throw new Error(`a line length needs along-line data at the line's points (true s): ${c.label} has none at t = ${R.fmt(t)}`);
    over = Object.fromEntries(lens.map(n => [n, L]));
  }
  await asDrawn(sP, [c], TX, over);                       // v14.4: the tool's line as drawn
  const { stepsOf } = await import("../analysis/stepsof.js");   // D22: the analysis plugin's steps
  const st = stepsOf(c, T);
  if (!st) return null;
  const X = st.xs, n = X.length, sg = Number(srcLine.slope?.sign) < 0 ? -1 : 1;
  // the line's own quantity (before its slope), in rising x: the voltage is its drop across the step; a line not drawn
  // as a slope (E∥ itself): the voltage is ∫ y dx across the step. v10.1: of the quantity before any smoothing along x
  // (the smoothing only finds the steps)
  const base = c.ys0 ? c.ysRaw || c.ys0 : null, [BX, BY] = rising(c.xs, base || c.ysRaw || c.ys);
  const drop = (a, b) => (base ? sg * (at(BX, BY, b) - at(BX, BY, a)) : integrate(BX, BY, a, b));
  const lowStep = st.steps.find(x => x.a === 0), highStep = st.steps.find(x => x.z === n - 1);
  const low = lowStep ? { width: lowStep.x1 - X[0], core: lowStep.s90 - lowStep.s10, voltage: drop(X[0], lowStep.x1), excess: lowStep.D } : null;
  const high = highStep ? { width: X[n - 1] - highStep.x0, core: highStep.s90 - highStep.s10, voltage: drop(highStep.x0, X[n - 1]), excess: highStep.D } : null;
  const northLow = sP.xaxis !== "s_south";                 // on "s from the south foot" the north foot is at the end
  return { north: northLow ? low : high, south: northLow ? high : low };
}
/** ∫ y dx over [a, b] (trapezoid on the points): the voltage when the tool's line is not drawn as a slope (E∥ itself). */
function integrate(X, Y, a, b) {
  let s = 0;
  for (let j = 1; j < X.length; j++) {
    const x0 = Math.max(a, X[j - 1]), x1 = Math.min(b, X[j]);
    if (x1 > x0) s += 0.5 * (at(X, Y, x0) + at(X, Y, x1)) * (x1 - x0);
  }
  return s;
}
async function fill(m, info, sub, src, name) {
  m.running = true;
  const cur = src.indexAt(S.t), order = [...Array(m.n).keys()].sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
  let next = 0, ping = 0;
  const worker = async () => {
    while (next < order.length && !m.dropped) {
      const i = order[next++];
      if (m.feet[i] !== undefined) continue;
      try { m.feet[i] = await feetAt(info, sub, src.times[i]); m.ok++; }
      catch (e) { m.feet[i] = null; m.fails++; m.err = String(e?.message || e || "unknown error"); }
      m.done++;
      const now = performance.now();
      if (now - ping > 700) { ping = now; onProgress?.(name); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  m.running = false;
  onProgress?.(name);
}
/** The curve of foot-gap line `line` for one curve (`sub`) of the tool's line: what is known so far, NaN elsewhere. */
export async function gapCurve(s, line, sub) {
  const info = gapSource(line);
  if (info.error) return { error: info.error };
  const { sP, T, srcLine } = info, g = line.gap;
  const run = runOf(sub?.run ?? srcLine.run);
  if (!run) return { error: `foot gaps: the line of ${g.out} has no dataset (${srcLine.run ?? "none"})` };   // v9.0.1
  const src = srcOf(run, srcLine.q);
  if (!src) return { error: `foot gaps: ${srcLine.q} is not cached for ${run}` };
  if (!src.hasTime) return { error: `foot gaps: ${src.label} has no time axis` };
  const n = src.times.length;
  // v10.0: a measured variable in a setting (w = $L) is read per curve and per output: its name, not its value now, keys it
  const kv = (v, d) => (isRef(v) && S.vars?.[v.slice(1)]?.type === "measured" ? v : num1(v, d));
  // v14.3.2: the current values of the set variables it uses (r_max = $rmax …): changing one recomputes (it kept the old)
  const refVals = [...refsIn([srcLine, sP.xfn ?? null, sP.yfn ?? null, sP.scale ?? null, smoothOf(sP, srcLine) ?? null])].sort().map(nm => {
    const x = S.vars?.[nm];
    return [nm, !x || x.type === "measured" ? null : x.type === "dataset" ? runOf("$" + nm) : listOf("$" + nm)];
  });
  const key = JSON.stringify([g.out, kv(T.w, 3), kv(T.k, 3), srcLine, smoothOf(sP, srcLine), sP.xaxis, sP.xfn || "", sP.yfn || "", sP.scale ?? null, !!sP.abs, run,
    sub ? [sub.dim ?? null, sub.value ?? null, sub.run ?? null, sub.time ?? null] : null, refVals]);
  let m = MEMO.get(key);
  if (m && m.n < n) { m.n = n; m.feet.length = n; }       // v14.3.2: the run grew: its new outputs are filled in too
  if (!m) {
    m = { feet: new Array(n), done: 0, ok: 0, fails: 0, n, running: false, err: null };
    MEMO.set(key, m);
    if (MEMO.size > 300) { const k0 = MEMO.keys().next().value; MEMO.get(k0).dropped = true; MEMO.delete(k0); }
  }
  if (!m.running && m.done < n) fill(m, info, sub, src, g.out);
  let ys = Float64Array.from({ length: n }, (_, i) => { const f = m.feet[i]?.[g.foot]; return f ? f[g.what] : NaN; });
  // v10.1 (human 2026-11-10: "I may be interested in smoothinig along t these two plots"): the gap line's smoothing (its
  // own, else its plot's) along t — outputs without a gap stay empty
  const sm = smoothOf(s, line), smh = sm ? num1(sm.h, NaN) : NaN, smTxt = sm && smh > 0 ? smoothText(sm, smh) : null;
  if (smTxt) ys = smoothSeries(src.times, ys, sm);
  const what = `${GAP_FOOT[g.foot] ?? g.foot} gap ${GAP_WHAT[g.what] ?? g.what}`;
  const part = !sub ? null : sub.run !== undefined && sub.dim === undefined ? sub.run : sub.dim !== undefined && sub.value !== undefined ? `${sub.dim} = ${R.fmt(sub.value)}` : null;
  const keyed = [["q", what], ["run", run], ...(part ? [[sub?.dim !== undefined ? "d:" + sub.dim : "run", part]] : []), ...(smTxt ? [["smooth", smTxt]] : [])];
  const listKey = !sub ? null : sub.run !== undefined && sub.dim === undefined ? "run" : sub.dim !== undefined ? "d:" + sub.dim : "t";
  const xu = sP.xfn ? null : axisInfo(sP.xaxis).units || null;
  const yunits = g.what === "voltage" ? (src.units || "") : g.what === "excess" ? "" : (xu || "");
  return { curve: { line, src: null, isGap: true, xs: Float64Array.from(src.times), ys, label: [what, run, part, smTxt].filter(Boolean).join(" · "), sub, subLabel: part,
    keyed, listKey, yunits, progress: [m.done, n], progressLabel: "foot gaps",
    // v9.0.1: why outputs failed (the tool's line could not be rebuilt there): all of them, or how many
    warn: !m.fails ? null : !m.ok ? `could not rebuild ${g.out}'s line: ${m.err}` : `${m.fails} of ${m.done} outputs failed: ${m.err}`,
    at: { run, d: sub?.dim !== undefined ? { [sub.dim]: sub.value } : {} } } };
}

/** v9.0: the editor of a foot-gap line — its steps tool, foot, number, style. Its curves follow the tool's line. */
export function editGap(panel, line, lines, push, box, api, defaultColor) {
  const tools = stepsTools(), g = line.gap;
  const draw = () => {
    box.replaceChildren(
      el("div", { class: "pop-title" }, "foot gap over time"),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "steps tool"),
        select([...(tools.some(x => x.t.name === g.out) ? [] : [[g.out ?? "", `${g.out ?? "?"} (not found)`]]), ...tools.map(x => [x.t.name, `${x.t.name} · ${x.line ? bareName(x.line) : "?"}`])], g.out ?? "",
          v => { const x = tools.find(y => y.t.name === v); g.out = v; g.line = x?.line?.id ?? null; line.run = x?.line?.run ?? line.run; push(true); draw(); })),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "foot"),
        select([["north", "north foot"], ["south", "south foot"]], g.foot, v => { g.foot = v; push(true); draw(); })),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "number"),
        select(Object.entries(GAP_WHAT), g.what, v => { g.what = v; push(true); draw(); }, { title: "width: from the foot to the step's far edge · 10–90 %: of its excess drop · voltage: the drop across it · excess: above the background" })),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "smooth"),                       // v10.1: along t
        smoothControls(normSmooth(line.smooth, true), (v, rebuild) => { if (v === undefined) delete line.smooth; else line.smooth = v; push(); if (rebuild) draw(); }, { inherit: true, xu: "R*/c", dflt: 2 })),
      el("div", { class: "pop-row" }, "style",
        el("select", { onchange: e => { line.dash = e.target.value; push(); } }, Object.keys(R.DASHES).map(k => el("option", { value: k, selected: k === (line.dash || "solid") }, k))),
        "width", numRef(line.width ?? 1.6, w => { if (isRef(w) || w > 0) { line.width = w; push(); } }, { size: 3, title: "line width" }),
        el("label", { class: "chk" }, el("input", { type: "checkbox", checked: line.visible !== false, onchange: e => { line.visible = e.target.checked; push(); } }), "shown")),
      el("div", { class: "dim" }, "Each curve follows a curve of the tool's line (each r_max …) in that list's colours. Changing the tool (its line, slope window, median window, k) recomputes every output."),
      el("div", { class: "pop-row pop-sep" },
        el("button", { onclick: () => { lines.splice(lines.indexOf(line), 1); closePopover(); push(true); } }, "remove line"),
        el("button", { onclick: closePopover }, "done")));
    keepOnScreen(box);
  };
  draw();
}

const GAP_HELP = { width: "width (from the foot to its far edge)", core: "10–90 % width (of its excess drop)", voltage: "voltage (the drop across it)", excess: "excess drop (above the background)" };
/** v15.0: "→ foot gaps vs t" — two new plots after steps tool `name`'s plot, x = time: foot-gap width and voltage, each
 *  with the north (solid) and south (dashed) foot of every curve of the tool's line (moved from app.js footGapPlots). */
async function footGapPlots(core, name) {
  const hit = stepsTools().find(x => x.t.name === name);
  if (!hit || !hit.line) { core.toast(`no steps tool named "${name}" with a data line`, true); return; }
  const sP = eff(hit.p), run = panelRunOf(sP, "1d") ?? hit.line.run;
  let prev = null;
  for (const what of ["width", "voltage"]) {
    const ns = settings1D("time", run, `foot-gap ${what}`);
    ns.lines = ["north", "south"].map(f => newGapLine(name, hit.line.id, hit.line.run, f, what));
    if (!(ns.tools || []).some(isTimeLine)) ns.tools = [...(ns.tools || []), timeLine()];
    prev = await core.spawnPlot(prev ?? hit.p, newPanel("1d", ns), { side: prev ? "bottom" : "right" });
  }
  core.toast(`foot gaps of ${name} over time: width and voltage (north solid, south dashed); computed in the browser as the data loads`);
}
/** v15.0: everything foot gaps add to the viewer (aperture4 plugin). */
export function registerGaps(api) {
  setGapProgress(name => api.core.redrawReaders({ output: name }));
  api.registerLineKind({ key: "gap", label: "foot gap", is: l => isGap(l),
    expand: l => gapExpansions(l), curve: (s, l, sub) => gapCurve(s, l, sub), name: l => gapLineText(l),
    editor: (...a) => editGap(...a), colour: null, deps: l => ({ output: l.gap.out }), yId: l => `gap:${l.gap.foot}/${l.gap.what}`,
    yKind: l => `foot-gap ${l.gap.what === "voltage" ? "voltage" : l.gap.what === "excess" ? "excess drop" : "width"}`,
    caps: { slider: true, perDataset: true, smooth: false } });
  api.registerLineMenu({ key: "gap", label: "foot gap…",
    help: "a foot gap found by a named steps tool, over time: its width or voltage at every output (computed in the browser)",
    available: ctx => ctx.s.xaxis === "time" && stepsTools().length > 0,
    prefer: ctx => /^foot-gap /.test(ctx.s.ykind || ""),
    form: ctx => {
      const tools = stepsTools();
      const gd = (ctx.gap ||= { out: tools[0]?.t.name ?? null, foot: "both", what: /voltage/.test(ctx.s.ykind || "") ? "voltage" : "width" });
      const tool = tools.find(x => x.t.name === gd.out) ?? tools[0];
      return [
        el("div", { class: "pop-row" }, el("span", { class: "lab" }, "steps tool"),
          select(tools.map(x => [x.t.name, `${x.t.name} · ${x.line ? bareName(x.line) : "?"}`]), tool.t.name, v => { gd.out = v; ctx.redraw(); },
            { title: "a named steps tool: at every output its line is rebuilt and its steps found with its own settings" })),
        el("div", { class: "pop-row" }, el("span", { class: "lab" }, "foot"),
          select([["both", "north and south (two lines)"], ["north", "north foot"], ["south", "south foot"]], gd.foot, v => { gd.foot = v; },
            { title: "the step touching the north foot (the start of s) or the south foot (its end); no such step at an output: no value there" })),
        el("div", { class: "pop-row" }, el("span", { class: "lab" }, "number"),
          select(Object.entries(GAP_WHAT).map(([k, lab]) => [k, GAP_HELP[k] || lab]), gd.what, v => { gd.what = v; })),
        el("div", { class: "dim" }, `one curve per curve of ${tool.t.name}'s line (each r_max …), in its colours; north solid, south dashed. Computed in the browser at every output (the first time: as the data loads).`),
        el("div", { class: "pop-row" },
          el("button", { class: "on", onclick: () => {
            const feet = gd.foot === "both" ? ["north", "south"] : [gd.foot];
            ctx.place(feet.map(f => newGapLine(tool.t.name, tool.line?.id, tool.line?.run, f, gd.what)));
          } }, "add"),
          el("button", { onclick: ctx.cancel }, "cancel"))];
    } });
  api.registerOutputAction({ kind: "steps", label: "→ foot gaps vs t",
    title: "two new plots, x = time: the foot gaps' width and voltage (north solid, south dashed), every curve of this tool's line, computed at every output",
    run: name => footGapPlots(api.core, name) });
}
