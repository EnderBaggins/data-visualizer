// measure.js — measured variables (v5, human 2026-10-05): a number read off a 1D panel's line at every frame
// (max, min, x at max, x at min, value at x), which tools and picks can follow by name. Values live in
// MEASURED (model.js); they are recomputed before each render, memoised per frame.
import { S, eff, numOf, indexer, resolved, runNames, setViewContext, store, runsOf, srcOf, readingOwn, readingRuns, fitRuns, READING_OPS } from "./model.js";
import { putResult, keepScopes } from "./results.js";       // v14.4: the one result store
import * as R from "./render.js";
/** The source plot's zoom as view_x0 / view_x1 (v8.12); not zoomed: none (then bounds that follow them fall back to the whole curve). */
const viewOf = s => (s?.view ? { x0: Math.min(s.view.x0, s.view.x1), x1: Math.max(s.view.x0, s.view.x1) } : null);
import { lineCurve, overRange, expansions, axisFns, asDrawn } from "./panel1d.js";
import { fitCurve } from "./fit.js";
import { lineCan } from "./linekinds.js";                  // v14.4: what a made line can do
import { meanOf, statValue } from "./stats.js";            // v14.4: the one place statistics are computed
import { window as cycWindow, period as cycPeriod } from "./cycles.js";   // v14.1

const memo = new Map();
export function clearMeasured() { memo.clear(); }
/** The operations this module computes itself (valueOf); others come from plugins (READING_OPS). */
const CORE_OPS = ["max", "min", "xmax", "xmin", "cross", "at", "mean", "period", "regularity", "ncycles"];
/** v15.1 (plugins.js, DECISIONS D20): a reading operation a plugin adds — {key, label, value(curve)} (+ text, help,
 *  missing, perCurve: model.js READING_OPS). It is offered wherever readings are made (vars.js measureOps). */
export function registerReadingOp(o) {
  for (const f of ["key", "label", "value"]) if (!(f in (o || {}))) throw new Error(`missing ${f}`);
  if (typeof o.value !== "function") throw new Error("value is not a function");
  if (CORE_OPS.includes(o.key) || READING_OPS.some(x => x.key === o.key)) throw new Error(`there is already a reading "${o.key}"`);
  READING_OPS.push(o);
}

function lineOf(v) {
  const p = S.panels.find(q => q.id === v.panel);
  if (!p) return {};
  const s = resolved(eff(p));                             // windows that follow variables, as numbers
  return { s, line: (s.lines || []).find(l => l.id === v.line) };
}
/** One number per curve of the line (v5.15: a line following a list gives a list of values, one per curve), and where
 *  each was read (v8.27: {val, at}; at = [{run, d}] per value, for per-curve use in axis functions). */
async function measureOne(v, s, line, forRun = null) {    // v13.0: forRun = one dataset of the reading (results "run:<dataset>")
  if (!line) return { val: NaN, at: null };
  const rop = READING_OPS.find(o => o.key === v.op) || null;
  if (!rop && !CORE_OPS.includes(v.op)) throw new Error(`a reading made by a plugin that is not loaded ("${v.op}"): add the plugin to viewer/plugins/index.json`);
  // v5.16 (human 2026-10-06: "choose any axis … mean j∥/B over s/smax and set that as a measured variable"): a mean
  // along another axis D than x averages the line over D (from / to in D's shown coordinate), like the mean tool's
  // curves, then reads that curve at x = at (empty: the slider's time on a time axis, otherwise its mean over x)
  const D = v.op === "mean" && v.along ? v.along : null;
  const l2 = !D ? line : D === "time" ? { ...line, timeMode: "mean", timeFrom: v.from ?? null, timeTo: v.to ?? null }
    : { ...line, picks: { ...(line.picks || {}), [D]: { mean: true, from: v.from ?? null, to: v.to ?? null } } };
  let subs = expansions(line, s.xaxis);
  if (D && subs[0]?.dim === D)                            // averaging over the list's own axis: one value (per dataset, v8.18)
    subs = subs[0].run !== undefined ? subs.filter(x => !x.ik).map(x => ({ run: x.run, k: x.k, n: x.n, ref: x.ref })) : [null];
  const ref = forRun ? null : subs[0]?.ref ?? null;      // the list its line follows (its colours)
  const T = forRun ? axisFns(s, forRun) : axisFns(s), out = [], at = [];                // v8.17: a variable reads the plot as drawn (its axis functions)
  for (const sub of subs) {
    const r = await lineCurve(s, l2, false, sub);
    at.push(r.curve?.at ? { run: r.curve.at.run, d: { ...r.curve.at.d } } : null);
    // v15.1: a plugin's reading (READING_OPS; aperture4: the line length) reads the curve as lineCurve made it
    if (rop) {
      if (r.curve && !Number.isFinite(rop.value(r.curve))) throw new Error(rop.missing || `${rop.label}: this curve has none`);
      out.push(r.curve ? rop.value(r.curve) : NaN); continue;
    }
    if (r.curve) await asDrawn(s, [r.curve], T);          // v14.4: the curve as drawn (scale, smoothing, slope, f(x), f(y))
    out.push(r.curve ? valueOf(v, s, r.curve, D, T.x?.g) : NaN);
  }
  return { val: out.length > 1 ? out : out[0], at, ref };
}

// (v8.27's field-line length measured from Ψ — for the old 200-point profiles — was removed in v10.0.)
function valueOf(v, s, curve, D = null, g = null) {
  const { xs, ys } = curve, now = g && s.xaxis === "time" ? g(S.t) : S.t;   // the slider's time where it is drawn
  if (D) {
    const x = v.at !== null && v.at !== undefined ? numOf(v.at) : s.xaxis === "time" ? now : null;
    if (x === null) return meanOf(xs, ys);
    const j = isFinite(x) ? indexer(xs)(x) : -1;
    return j >= 0 ? ys[j] : NaN;
  }
  if (v.op === "mean") {                                  // v5.13; v5.15: the mean tool's range options
    const prev = setViewContext(viewOf(s));
    const [a, b] = v.over === "shown" && s.view ? [s.view.x0, s.view.x1] : overRange(s, { from: v.from, to: v.to }, null, g);
    setViewContext(prev);
    return meanOf(xs, ys, Math.min(a, b), Math.max(a, b));
  }
  if (v.op === "at") {
    const x = v.at === null || v.at === undefined ? now : numOf(v.at), j = isFinite(x) ? indexer(xs)(x) : -1;
    return j >= 0 ? ys[j] : NaN;
  }
  // v12.2 (a draw tool's "→ variable", human 2026-11-12: "make more tools like the fits -> variable"): max / min / x at
  // max / x at min over a range (from / to; empty: the whole curve), and x where the curve first crosses a level
  if (v.op === "period" || v.op === "regularity" || v.op === "ncycles") {   // v14.1: the period tool's numbers (cycles.js)
    const prev = setViewContext(viewOf(s));
    const [a, b] = overRange(s, { from: v.from, to: v.to }, null, g);
    setViewContext(prev);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const [tw, yw] = cycWindow([...xs], [...ys], Number.isFinite(lo) ? lo : null, Number.isFinite(hi) ? hi : null);
    if (tw.length < 4) return NaN;
    const r = cycPeriod(tw, yw, v.detrend || "linear");
    return v.op === "period" ? r.period : v.op === "regularity" ? r.regularity : r.n_cycles;
  }
  if (v.op === "cross" || ((v.from != null || v.to != null) && ["max", "min", "xmax", "xmin"].includes(v.op))) {
    const prev = setViewContext(viewOf(s));
    const [a, b] = overRange(s, { from: v.from, to: v.to }, null, g);
    setViewContext(prev);
    return statValue(xs, ys, v.op, Math.min(a, b), Math.max(a, b), numOf(v.level ?? 0));
  }
  return statValue(xs, ys, v.op);                         // v14.4: max / min / x at max / x at min over the whole curve (stats.js)
}
// ---- fit variables (v8.10) ----------------------------------------------------------------------------------
/** A fit variable's recipe: read from its fit tool and line while they exist (it follows their changes), else the one
 *  last seen (kept in the variable, so it still works when the plot is gone). */
export function fitRecipe(v) {
  const p = S.panels.find(q => q.id === v.panel);
  if (p) {
    const s = resolved(eff(p)), t = (s.tools || []).find(x => x.id === v.tool && x.type === "fit"), line = (s.lines || []).find(l => l.id === v.line);
    if (t && line) v.recipe = { s: { xaxis: s.xaxis, abs: !!s.abs, avg: s.avg ?? null, smooth: s.smooth, scale: s.scale ?? null, view: s.view ?? null, logx: !!s.logx, xfn: s.xfn ?? null, yfn: s.yfn ?? null },
      line: JSON.parse(JSON.stringify(line)), fit: { model: t.model || "poly", degree: t.degree ?? 2, over: t.over || "range", from: t.from ?? null, to: t.to ?? null } };
  }
  return v.recipe || null;
}
/** The fit on one dataset: the recipe's line with that dataset (its picks, averaging, |value| and scale), fitted over
 *  the recipe's x range; a line that follows a list gives one value per curve. */
async function fitOne(v, rec, run) {
  const s = rec.s, line = { ...rec.line, run }, out = [], at = [], T = axisFns(s, run);     // v8.17: the fit as drawn (axis functions)
  for (const sub of expansions(line, s.xaxis)) {
    const r = await lineCurve(s, line, false, sub);
    at.push(r.curve?.at ? { run: r.curve.at.run, d: { ...r.curve.at.d } } : null);   // v14.3.2: where each fit was taken
    if (!r.curve) { out.push(NaN); continue; }
    await asDrawn(s, [r.curve], T);                       // v14.4: the fit as drawn
    const prev = setViewContext(viewOf(s));
    const [a, b] = rec.fit.over === "shown" && s.view ? [s.view.x0, s.view.x1] : overRange(s, rec.fit, null, T.x?.g);
    setViewContext(prev);
    const fr = fitCurve(r.curve.xs, r.curve.ys, rec.fit.model, rec.fit.degree, Math.min(a, b), Math.max(a, b));
    out.push(fr.error ? NaN : fr.params?.[v.param] ?? NaN);
  }
  return { val: out.length > 1 ? out : out[0], at };
}
const finite = x => (Array.isArray(x) ? x.some(Number.isFinite) : Number.isFinite(x));
async function updateFits(fits, others) {
  let changed = false;
  await Promise.all(fits.map(async v => {
    const rec = fitRecipe(v), runs = runNames();
    const got = rec ? await Promise.all(runs.map(run => {
      const key = JSON.stringify(["fit", v.param, rec, run, rec.s.xaxis === "time" ? null : S.t, others, S.trange]);
      if (!memo.has(key)) {
        memo.set(key, fitOne(v, rec, run).catch(e => { console.warn("fit variable", v.name, run, e); return { val: NaN, at: null }; }));
        if (memo.size > 4000) memo.delete(memo.keys().next().value);
      }
      return memo.get(key);
    })) : [];
    const vals = new Map(runs.map((r, i) => [r, got[i]]).filter(([, x]) => x && finite(x.val)));    // datasets without it: left out ({val, at})
    if (storeRuns(`fit:${v.name}`, vals, fitRuns(v.name))) changed = true;
  }));
  return changed;
}
// ---- readings on every dataset (v13.0, human 2026-11-12: "set variables vs measured variables"; ⏱ for a value that moves
// with the slider; every reading is computed on the datasets on screen, the others when its values are opened) ------
/** A reading's recipe: its line as drawn (quantity, picks, averaging, smoothing, slope, axis functions), taken from its
 *  plot while the line exists, else the one last seen (kept in the variable, so it still works when the plot is gone). */
export function readingRecipe(v) {
  const p = S.panels.find(q => q.id === v.panel);
  if (p) {
    const s = resolved(eff(p)), line = (s.lines || []).find(l => l.id === v.line);
    if (line) v.recipe = { s: { xaxis: s.xaxis, abs: !!s.abs, avg: s.avg ?? null, smooth: s.smooth, scale: s.scale ?? null, view: s.view ?? null, logx: !!s.logx, xfn: s.xfn ?? null, yfn: s.yfn ?? null },
      line: JSON.parse(JSON.stringify(line)) };
  }
  return v.recipe || null;
}
/** Does reading `v` move with the slider (⏱)? When the curve it reads changes with time (x is not time, and the line is
 *  not at a fixed time or averaged over time), or it reads "now" on a time axis (value at x = now, a mean along another
 *  axis read now). */
export function readingIsLive(v, rec = readingRecipe(v)) {
  if (!rec || !lineCan(rec.line, "slider")) return false;   // v14.1: a table's points / a period tool's results: not the slider's (v14.4: linekinds.js)
  if (rec.s.xaxis === "time") return (v.op === "at" || (v.op === "mean" && !!v.along)) && (v.at === null || v.at === undefined);
  return !["fixed", "mean"].includes(rec.line.timeMode);
}
const OPEN = new Set();
/** The sidebar shows (true) or hides reading `name`'s values per dataset; while shown, a ⏱ one is read on every dataset. */
export function setReadingOpen(name, on) { if (on) OPEN.add(name); else OPEN.delete(name); }
/** The datasets the plots show. */
function onScreenRuns() {
  const out = new Set();
  for (const p of S.panels) {
    const s = eff(p);
    if (p.type === "2d") runsOf(s.run).forEach(r => out.add(r));
    else for (const l of s.lines || []) runsOf(l.run).forEach(r => out.add(r));
  }
  return out;
}
async function updateReadings(vars, others) {
  let changed = false;
  const screen = onScreenRuns();
  await Promise.all(vars.map(async v => {
    const rec = readingRecipe(v);
    if (!rec || !lineCan(rec.line, "perDataset")) return;   // table, period-tool, lineout lines: their own value only (v14.4: linekinds.js)
    // the datasets on screen (a value is only used where its dataset is shown); every dataset while ▦ is open. (A reading
    // on a line cut from a map would otherwise download that line for every dataset.) ⏱: recomputed each frame.
    const all = runNames().filter(r => typeof rec.line.q !== "string" || !!srcOf(r, rec.line.q));     // datasets with its quantity
    const live = readingIsLive(v, rec), runs = OPEN.has(v.name) ? all : all.filter(r => screen.has(r));
    const what = { op: v.op, at: v.at ?? null, along: v.along ?? null, over: v.over ?? null, from: v.from ?? null, to: v.to ?? null, level: v.level ?? null };
    const got = await Promise.all(runs.map(run => {
      const key = JSON.stringify(["read", what, rec, run, live ? S.t : null, others, S.trange]);
      if (!memo.has(key)) {
        memo.set(key, measureOne(v, rec.s, { ...rec.line, run }, run).catch(() => ({ val: NaN, at: null })));
        if (memo.size > 4000) memo.delete(memo.keys().next().value);
      }
      return memo.get(key);
    }));
    const vals = new Map(runs.map((r, i) => [r, got[i]]).filter(([, o]) => o?.at && finite(o.val)).map(([r, o]) => [r, { val: o.val, at: o.at }]));   // datasets without it: left out
    if (storeRuns(`reading:${v.name}`, vals, readingRuns(v.name))) changed = true;
  }));
  return changed;
}
/** v14.4: an owner's values per dataset into the result store (scope "run:<dataset>"); datasets no longer measured are
 *  dropped. Whether anything changed. */
function storeRuns(owner, vals, before) {
  const was = JSON.stringify(before.slice().sort(([a], [b]) => (a < b ? -1 : 1)));
  keepScopes(owner, k => !k.startsWith("run:") || vals.has(k.slice(4)));
  for (const [r, o] of vals) putResult(owner, `run:${r}`, o);
  return JSON.stringify([...vals].sort(([a], [b]) => (a < b ? -1 : 1))) !== was;
}
/** Recompute every measured variable for the current frame (and the fit variables). Resolves true if any value changed. */
export async function updateMeasured() {
  const vars = Object.values(S.vars || {}).filter(v => v.type === "measured"), fits = Object.values(S.vars || {}).filter(v => v.type === "fit");
  if (!vars.length && !fits.length) return false;
  const others = JSON.stringify(Object.values(S.vars).filter(v => v.type !== "measured"));
  let changed = false;
  await Promise.all(vars.map(async v => {
    const { s, line } = lineOf(v);
    const key = JSON.stringify([v, s?.xaxis, s?.abs, s?.avg, s?.smooth, s?.xfn, s?.yfn, line, S.t, others, S.trange]);
    if (!memo.has(key)) {
      memo.set(key, measureOne(v, s, line).catch(e => { console.warn("measure", v.name, e); return { val: NaN, at: null, ref: null, err: e.message || String(e) }; }));
      if (memo.size > 4000) memo.delete(memo.keys().next().value);
    }
    const { val, at, ref = null, err = null } = await memo.get(key);
    // v14.4: its own line's result (results.js): the value(s), where each was read, the list it follows, why none
    if (putResult(`reading:${v.name}`, "own", { val, at, ref, err: at ? null : err ?? readingOwn(v.name).err ?? null })) changed = true;
  }));
  if (fits.length && (await updateFits(fits, others))) changed = true;
  if (vars.length && (await updateReadings(vars, others))) changed = true;     // v13.0
  return changed;
}
