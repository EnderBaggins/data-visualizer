// panel1d.js — 1D line panels (human 2026-10-01): an x axis (coordinate) and a y axis (kind), set by clicking
// the axis labels; lines are added with "+ line" and edited from the legend. Linked panels with the same y
// settings share one y range.
import * as R from "./render.js";
import { S, store, eff, srcOf, fitAxis, indexer, pickIndex, pickCoord, extent, axisLabel, axisCatalog, axisInfo, kindsFor, ctxPanel, newTool, runOf, numOf, listOf, isRef, varOf, listColor, toolRules, resolved, num1, subVars, timeWindow, timeInfo, outsideNote, isFn, isMeanPick, toolLabel,
  isAn, anDef, anBindings, coordChoices, runsOf, isRunList } from "./model.js";
import { compileFunction } from "./data.js";
import { formulaToLatex } from "./latex.js";
import { meanOf, fitCurve } from "./fit.js";
import { el, popover, closePopover, wheelFactor, dmLink, tipAt } from "./ui.js";
import { openEditLine, openListValue, lineName } from "./lines.js";
import { tableOf, rowText, tabLineText } from "./tables.js";   // v14.0: tables
import * as CYC from "./cycles.js";                                                                  // v14.1: period tool
import { madeKind, lineCan } from "./linekinds.js";                                       // v14.4: the line-source registry
import { panelRun, setRunContext, setViewContext, curveValue, READING_OPS, dataKindOf, missingKindOf, missingKindText, splitKind, lineKind, opLabel, putOutput, liveOutput, outputCurve, curveStat, toolValues, setToolValues, yAxisId, ownY } from "./model.js";
import { fontSize, runTip } from "./vars.js";
import { canCompute, jobFor, computeBox } from "./cacheable.js";

let onAutoChange = null;                                  // render changed a saved setting (a line style): save it
export function setAutoChange(fn) { onAutoChange = fn; }
// (v14.4: a tool's results and outputs changing is announced by the result store's change bus, results.js onResult.)
/** Does this line take its colours from the list it follows (default yes; legend editor can switch it off)? */
export const followsListColors = (l, sub) => !!sub && l.listColors !== false;
/** A curve's key in a plot: line id, and its value's index (v8.18: dataset index.value index for a combination). */
export const slotKey = (l, sub) => (!sub ? String(l.id) : `${l.id}:${sub.k}${sub.ik !== undefined ? "." + sub.ik : ""}`);
/** A line that follows a LIST variable is drawn once per value (human 2026-10-05): a pick list (v5.3, e.g. r_max)
 *  gives [{dim, value, k, n, ref}], else a fixed-time list (v5.5, snapshots at several times) gives
 *  [{time, k, n, ref}]; [null] for an ordinary line. One list expands per line. Pass the panel's x axis so a
 *  time list is ignored when time is the x axis.
 *  v8.18 (human 2026-11-02: "a single line … that I want to plot for a list of datasets"): a data line whose dataset is
 *  a dataset list is drawn once per dataset: {run, k, n, ref (the list), label}; with a pick / time list as well, every
 *  combination: the dataset gives k, n, ref (its colour), the other list ik, in, iref (a shade of that colour). */
export function expansions(line, xaxis = null) {
  const made = madeKind(line);                            // v14.4: a line made by a tool or a table expands its own way (linekinds.js)
  if (made) return made.expand(line);
  if (!isFn(line) && !isAn(line) && isRunList(line.run)) {
    const runs = runsOf(line.run), inner = valueExpansions(line, xaxis);
    if (runs.length > 1) return runs.flatMap((run, k) => inner.map(o => ({ ...(o || {}), run, k, n: runs.length, ref: line.run, label: run,
      ...(o ? { ik: o.k, in: o.n, iref: o.ref } : {}) })));
  }
  return valueExpansions(line, xaxis);
}
/** A line's expansions over its value lists (picks, fixed times, a function's or analytic line's parameters). */
function valueExpansions(line, xaxis) {
  if (isAn(line)) {                                      // v7: one curve per value of the lists its parameters use
    const lists = [];
    for (const b of Object.values(anBindings(line, xaxis))) {
      if (b.mode !== "value" || !isRef(b.value) || lists.some(l => l.ref === b.value)) continue;
      const vals = listOf(b.value);
      if (vals.length > 1) lists.push({ ref: b.value, vals });
    }
    if (!lists.length) return [null];
    // several lists: every combination (at most AN_MAX curves); colours follow the first list
    let combos = [{}];
    for (const l of lists) combos = combos.flatMap(c => l.vals.map((v, k) => ({ ...c, [l.ref]: { v, k } })));
    combos = combos.slice(0, AN_MAX);
    const one = lists.length === 1, first = lists[0].ref;
    return combos.map((c, k) => ({ an: Object.fromEntries(Object.entries(c).map(([r, o]) => [r, o.v])), value: c[first].v,
      k: one ? c[first].k : k, n: one ? lists[0].vals.length : combos.length, ref: first,
      label: lists.map(l => `${l.ref.slice(1)} = ${R.fmt(c[l.ref].v)}`).join(" · ") }));
  }
  if (isFn(line)) {                                      // v5.13: a function line, once per value of a list it uses
    for (const name of new Set(String(line.fn).match(/[A-Za-z_]\w*/g) || [])) {
      const v = S.vars?.[name], vals = ["number", "config"].includes(v?.type) ? listOf("$" + name) : [];   // v7.4: config lists too
      if (vals.length > 1) return vals.map((value, k) => ({ fnvar: name, value: Number(value), k, n: vals.length, ref: "$" + name }));
    }
    return [null];
  }
  for (const [d, p] of Object.entries(line.picks || {})) {
    const vals = isRef(p) ? listOf(p) : [];
    if (vals.length > 1) return vals.map((value, k) => ({ dim: d, value, k, n: vals.length, ref: p }));
  }
  if (line.timeMode === "fixed" && isRef(line.fixedTime) && xaxis !== "time") {
    const vals = listOf(line.fixedTime);
    if (vals.length > 1) return vals.map((time, k) => ({ time, k, n: vals.length, ref: line.fixedTime }));
  }
  return [null];
}
/** Indices of the coordinate values in [a, b] (either order). */
function rangeIdx(vals, a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b), out = [];
  for (let i = 0; i < vals.length; i++) if (vals[i] >= lo && vals[i] <= hi) out.push(i);
  return out;
}
/** Trapezoid weights of the coordinate values at idx (consecutive): the weighted mean is the integral / length, right
 *  for uneven spacing (r_max); a single value gets weight 1. */
function trapzWeights(vals, idx) {
  const n = idx.length;
  if (n === 1) return [1];
  return idx.map((_, q) => Math.abs(vals[idx[Math.min(n - 1, q + 1)]] - vals[idx[Math.max(0, q - 1)]]) / 2);
}
/** Every combination of the averaged dims as {off, w} (offset into a frame, product of weights); null when none. */
function avgOffsets(dims) {
  if (!dims.length) return null;
  let out = [{ off: 0, w: 1 }];
  for (const d of dims) out = out.flatMap(o => d.idx.map((i, q) => ({ off: o.off + i * d.stride, w: o.w * d.w[q] })));
  return out;
}
/** Centred running mean over ±N points (shorter at the ends; NaN points skipped). */
/** v8.28: y at x by linear interpolation in the points (xa, ya), xa monotonic (rising or falling); NaN outside. */
export function interp1(xa, ya, x) {
  const n = xa.length;
  if (n < 2 || !Number.isFinite(x)) return n === 1 && x === xa[0] ? ya[0] : NaN;
  const up = xa[n - 1] >= xa[0], lo0 = up ? xa[0] : xa[n - 1], hi0 = up ? xa[n - 1] : xa[0];
  if (x < lo0 || x > hi0) return NaN;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((xa[m] <= x) === up) lo = m; else hi = m; }
  const d = xa[hi] - xa[lo];
  return d === 0 ? ya[lo] : ya[lo] + (ya[hi] - ya[lo]) * (x - xa[lo]) / d;
}
// ---- time derivatives (v8.14) -------------------------------------------------------------------------------
/** The slope of the least-squares straight line through the finite points (T, V); NaN with fewer than 2. */
function lsSlope(T, V) {
  let n = 0, mt = 0, mv = 0;
  for (let i = 0; i < T.length; i++) if (Number.isFinite(T[i]) && Number.isFinite(V[i])) { n++; mt += T[i]; mv += V[i]; }
  if (n < 2) return NaN;
  mt /= n; mv /= n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < T.length; i++) if (Number.isFinite(T[i]) && Number.isFinite(V[i])) { const dt = T[i] - mt; sxx += dt * dt; sxy += dt * (V[i] - mv); }
  return sxx > 0 ? sxy / sxx : NaN;
}
/** (the mean of the last k values − the mean of the first k) / (the difference of their mean times). */
function diffOver(T, V, k) {
  const P = T.map((t, i) => [t, V[i]]).filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v));
  if (P.length < 2) return NaN;
  k = Math.max(1, Math.min(k, Math.floor(P.length / 2) || 1));
  const m = a => [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length];
  const [t0, v0] = m(P.slice(0, k)), [t1, v1] = m(P.slice(-k));
  return t1 !== t0 ? (v1 - v0) / (t1 - t0) : NaN;
}
/** dy/dx along a series: "fit" = the slope of a straight line through the 2n + 1 points around each (n ≥ 1);
 *  "diff" = the centred difference of the ±n running mean (one-sided at the ends). */
function ddtSeries(xs, ys, n, how) {
  const out = new Float64Array(ys.length), L = ys.length;
  if (how === "diff") {
    const sm = n > 0 ? runningMean(ys, n) : ys;
    for (let j = 0; j < L; j++) { const a = Math.max(0, j - 1), b = Math.min(L - 1, j + 1); out[j] = b > a ? (sm[b] - sm[a]) / (xs[b] - xs[a]) : NaN; }
    return out;
  }
  const h = Math.max(1, n);
  for (let j = 0; j < L; j++) {
    const a = Math.max(0, j - h), b = Math.min(L - 1, j + h);
    out[j] = lsSlope(Array.from(xs.slice(a, b + 1)), Array.from(ys.slice(a, b + 1)));
  }
  return out;
}
// ---- smoothing (v10.1; v10.1.1, human 2026-11-10: "can we not just make it be average over x axis call it good?" … "a
// window defined in the UNITS of the x axis"): smooth = {h, kind: "mean" | "median"} — over x ± h around each point, h in
// the x axis's units (R* on an s axis, R*/c on a t axis; a variable works, and $L is each line's own); on a line
// undefined = as the plot, false = none. Before any slope or d/dt, so a derivative is of the smoothed curve. A profile's
// mean over the outputs around its time is the line's time setting instead ("mean over t ± h"; tavgOf below).
/** A smoothing as {h, kind} from any form it was stored in: {h, kind} (v10.1.1); {along, w, unit, kind} (v10.1: along x
 *  = ± w/2; on a t plot ± w outputs = ± w R* / c, the outputs being 1 R* / c apart, and a window w in t = ± w/2); a number
 *  (the old "average ±N") on a t plot = ± N. null = none; undefined = not set here (a profile's old "average ±N" and a
 *  v10.1 smoothing over time are the time setting's, not a smoothing). */
export function normSmooth(sp, timeX) {
  if (sp === undefined) return undefined;
  if (sp === null || sp === false) return null;
  const k = sp?.kind === "median" ? "median" : "mean";
  if (typeof sp !== "object") return !timeX ? undefined : !isRef(sp) && Number(sp) === 0 ? null : { h: sp, kind: "mean" };
  if ("h" in sp) return sp.h === null || sp.h === "" ? null : { h: sp.h, kind: k };
  if (sp.w === undefined || sp.w === null || sp.w === "") return null;
  if (sp.along === "time" && !timeX) return undefined;
  const half = v => (isRef(v) ? v : Number(v) / 2);
  return { h: sp.along === "time" && sp.unit === "outputs" ? sp.w : half(sp.w), kind: k };
}
/** A line's smoothing {h, kind}: its own, else the plot's; null = none. */
export function smoothOf(s, line) {
  const timeX = s?.xaxis === "time";
  let sp = line?.smooth !== undefined ? normSmooth(line.smooth, timeX) : normSmooth(line?.avg, timeX);
  if (sp === undefined) sp = s?.smooth !== undefined ? normSmooth(s.smooth, timeX) : normSmooth(s?.avg, timeX);
  return sp || null;
}
/** v10.1.1: a profile's time average — the mean of the outputs within t ± h around the time it shows (h in R* / c), set in
 *  the line's time row (line.tavg). From the older forms too: a line's or plot's "average ±N" (± N: the outputs are 1 R* / c
 *  apart) and a v10.1 smoothing over time (± w outputs, or a window w in t = ± w/2). 0 = none. */
export function tavgOf(s, line) {
  const conv = sp => (sp && typeof sp === "object" && sp.along === "time" && sp.w != null && sp.w !== "" ? (sp.unit === "outputs" || isRef(sp.w) ? sp.w : Number(sp.w) / 2) : undefined);
  let v = line?.tavg;
  if (v === undefined) v = conv(line?.smooth);
  if (v === undefined) v = line?.avg ?? undefined;
  if (v === undefined) v = conv(s?.smooth);
  if (v === undefined) v = s?.avg ?? undefined;
  const h = num1(v ?? 0, 0);
  return h > 0 ? h : 0;
}
/** How a smoothing is named in a legend ("mean over ±0.25"). */
export function smoothText(sp, h) { return `${sp.kind === "median" ? "median" : "mean"} over ±${R.fmt(h)}`; }
/** Mean or median over a window w along x (full width, centred, shorter at the ends); NaN points stay NaN. Points spread
 *  unevenly (a traced line is dense near the star) do not weigh more: the mean is the exact integral of the curve
 *  (straight between its points) over the window ÷ the window's length; the median is that of the points in the window,
 *  each weighted by the stretch of x it stands for. */
export function smoothAlongX(xs, ys, w, kind) {
  const idx = [];
  for (let j = 0; j < xs.length; j++) if (Number.isFinite(xs[j]) && Number.isFinite(ys[j])) idx.push(j);
  if (idx.length < 2 || !(w > 0)) return ys;
  idx.sort((a, b) => xs[a] - xs[b]);
  const X = idx.map(j => xs[j]), Y = idx.map(j => ys[j]), m = X.length, x0 = X[0], x1 = X[m - 1];
  if (!(x1 > x0)) return ys;
  const keep = (y, j) => Number.isFinite(y) && Number.isFinite(xs[j]);
  if (kind !== "median") {
    const F = new Float64Array(m);                      // F[k] = ∫ y dx from X[0] to X[k]
    for (let k = 1; k < m; k++) F[k] = F[k - 1] + 0.5 * (Y[k] + Y[k - 1]) * (X[k] - X[k - 1]);
    const Fat = x => {                                  // ∫ y dx from X[0] to x, x in [x0, x1]
      let lo = 0, hi = m - 1;
      while (hi - lo > 1) { const c = (lo + hi) >> 1; if (X[c] <= x) lo = c; else hi = c; }
      const dx = x - X[lo], d = X[hi] - X[lo], yx = d > 0 ? Y[lo] + (Y[hi] - Y[lo]) * dx / d : Y[lo];
      return F[lo] + 0.5 * (Y[lo] + yx) * dx;
    };
    return Float64Array.from(ys, (y, j) => {
      if (!keep(y, j)) return NaN;
      const a = Math.max(x0, xs[j] - w / 2), b = Math.min(x1, xs[j] + w / 2);
      return b > a ? (Fat(b) - Fat(a)) / (b - a) : y;
    });
  }
  // the median: of the points in the window, each weighted by the stretch of x it stands for (half the distance between
  // its neighbours) — dense points do not weigh more, and a lone spike is outvoted (a resampled curve would spread it)
  const Wt = X.map((_, k) => 0.5 * (X[Math.min(m - 1, k + 1)] - X[Math.max(0, k - 1)]));
  const out = new Float64Array(ys.length).fill(NaN);
  let lo = 0, hi = 0;
  for (let p = 0; p < m; p++) {
    const a = X[p] - w / 2, b = X[p] + w / 2;
    while (X[lo] < a) lo++;
    while (hi < m - 1 && X[hi + 1] <= b) hi++;
    const win = [];
    for (let k = lo; k <= hi; k++) win.push([Y[k], Wt[k] > 0 ? Wt[k] : 1e-12]);
    win.sort((u, v) => u[0] - v[0]);
    const tot = win.reduce((t, u) => t + u[1], 0);
    let acc = 0, med = win[win.length - 1][0];
    for (let k = 0; k < win.length; k++) {
      acc += win[k][1];
      if (acc > tot / 2 + 1e-12 * tot) { med = win[k][0]; break; }
      if (Math.abs(acc - tot / 2) <= 1e-12 * tot) { med = 0.5 * (win[k][0] + win[Math.min(win.length - 1, k + 1)][0]); break; }
    }
    out[idx[p]] = med;
  }
  return out;
}
/** A time series smoothed by sp (x = the outputs' times): over t ± h. */
export function smoothSeries(ts, ys, sp) {
  const h = num1(sp.h, NaN);
  return h > 0 ? smoothAlongX(ts, ys, 2 * h, sp.kind) : ys;
}
/** v10.1: a curve smoothed along x as drawn (after its scale, before its slope and f(y)); time smoothing happens when
 *  the curve is read (lineCurve / gapCurve). Keeps the values before as c.ysRaw (a foot gap's voltage is the drop of the
 *  unsmoothed quantity). */
export function smoothAlong(c, s) {
  if (c.isFn || !lineCan(c.line, "smooth") || c.timeX || c.smoothed) return;   // v14.4: what a made line can do: linekinds.js
  const sp = smoothOf(s, c.line);
  if (!sp) return;
  c.smoothed = true;
  const h = curveNum(sp.h, c, NaN);
  if (!(h > 0)) return;
  c.ysRaw = c.ys;
  c.ys = smoothAlongX(c.xs, c.ys, 2 * h, sp.kind);
  const txt = smoothText(sp, h);
  c.label += ` · ${txt}`;
  c.keyed = [...(c.keyed || []), ["smooth", txt]];
}
function runningMean(ys, N) {
  const out = new Float64Array(ys.length);
  for (let j = 0; j < ys.length; j++) {
    let sum = 0, cnt = 0;
    for (let i = Math.max(0, j - N); i <= Math.min(ys.length - 1, j + N); i++) if (Number.isFinite(ys[i])) { sum += ys[i]; cnt++; }
    out[j] = cnt ? sum / cnt : NaN;
  }
  return out;
}
/** The values of x axis `id` in the recorded data (the desktop's times for "time"). */
function axisValues(id) {
  if (id === "time") { const T = timeInfo().times; if (T.length) return T; }
  for (const run of Object.values(store.runs)) for (const src of Object.values(run.sources)) {
    const f = fitAxis(src, id);
    if (f && f.values?.length) return f.values;          // v8.28: data at a line's points have no fixed x values
  }
  return [0, 1];
}
/** The extent of x axis `id` in the recorded data: where a panel with only function lines draws them. */
function axisExtent(id, logx = false) {
  const v = axisValues(id);
  return extent(logx ? [...v].filter(x => x > 0) : [...v]);
}
/** The x window a panel shows: its own window, else the extent of its data curves (or of the axis' data), clipped to
 *  the desktop's time range on a time axis (v5.12) and centred by ± (v5.12). X: the x axis's function (v8.17). */
function xRangeOf(s, curves, X = null) {
  if (X && !s.view) return movedRange(s, curves, X);
  let [x0, x1] = s.view ? [s.view.x0, s.view.x1]
    : curves.length ? extent(curves.flatMap(c => (s.logx ? [...c.xs].filter(v => v > 0) : [...c.xs]))) : axisExtent(s.xaxis, s.logx);
  const tw = !s.view && s.xaxis === "time" ? timeWindow() : null;
  if (tw && Math.max(x0, tw[0]) < Math.min(x1, tw[1])) { x0 = Math.max(x0, tw[0]); x1 = Math.min(x1, tw[1]); }
  if (s.xsym && !s.logx && isFinite(x0)) { const h = Math.max(Math.abs(x0), Math.abs(x1)); x0 = -h; x1 = h; }
  return [x0, x1];
}
/** The x interval a mean, a mean scale or a fit uses (v5.13): spec.over "shown" = the plot's window; otherwise the
 *  whole curve — inside the desktop's time range on a time axis — narrowed by spec.from / spec.to (numbers or
 *  variables). */
export function overRange(s, spec, shown = null, g = null) {
  if (spec?.over === "shown" && shown) return shown;
  let a = -Infinity, b = Infinity;
  if (s.xaxis === "time") {
    const w = timeInfo();
    if (w.limited && !w.empty) { a = w.a; b = w.b; if (g) { const A = g(a), B = g(b); [a, b] = [Math.min(A, B), Math.max(A, B)]; } }   // v8.17: as drawn
  }
  return [num1(spec?.from, a), num1(spec?.to, b)];
}

// ---- axis functions (v8.17, human 2026-10-30: "click an axis and apply a fn to it. Like if my x axis is r_max can I
// make it be 1/r_max easily? because the value shouldn't have to change right") ------------------------------------
/** A formula's text with identifier `id` written as `name` (bracketed when it has spaces or operators, unless the
 *  formula already brackets it): "1/x" with x → r_max gives "1/r_max". */
export function nameIn(txt, id, name) {
  const wrap = /[\s+\-*/^]/.test(name);
  return String(txt).replace(new RegExp(`\\b${id}\\b`, "g"), (m, i, all) => (wrap && !(all[i - 1] === "(" && all[i + m.length] === ")") ? `(${name})` : name));
}
/** The x axis's formula as the symbol in a fit's formula (LaTeX; bracketed unless it is one name): (1/r_max). */
function texSym(txt) {
  let t;
  try { t = formulaToLatex(txt); } catch { return "x'"; }
  return /^\s*[A-Za-z_]\w*\s*$/.test(txt) ? t : `\\left(${t}\\right)`;
}
/** A 1D plot's axis functions, compiled (null = none). s.xfn draws each point at x′ = f(x), s.yfn draws each value as
 *  y′ = f(y, x). In both, x is the x axis's own coordinate (r_max …; the axis's name works too) and y the value as it
 *  would be drawn without the function; other names as in function lines (t = the slider's time, pi, variables, the
 *  numbers of the dataset's config). The data are not changed, only where they are drawn. `run`: the dataset whose
 *  config numbers the formulas may use (default: the plot's). {x: {g, label, tex}, y: {g(y, x), text}, errors}. */
export function axisFns(s, run = undefined) {
  const out = { x: null, y: null, errors: [] };
  if (!s?.xfn && !s?.yfn) return out;
  const r = runOf(run === undefined ? panelRun(s, "1d") : run), conf = (r && store.runs[r]?.conf) || {};
  const isVar = n => ["number", "measured", "config", "fit"].includes(S.vars?.[n]?.type), V = n => Number(numOf("$" + n));
  const own = s.xaxis, xname = axisInfo(s.xaxis).label;
  const prep = txt => String(txt).replace(new RegExp(`\\b${own}\\b`, "g"), "x");          // r_max → x
  const make = (txt, ax) => {
    try {
      const f = compileFunction(prep(txt), conf, isVar, ax === "y" ? ["y"] : []).f;
      const call = (...a) => { try { const v = f(...a); return typeof v === "number" ? v : NaN; } catch { return NaN; } };
      const mk = Vf => (ax === "y" ? (y, x) => call(x, S.t, Vf, y) : x => call(x, S.t, Vf));
      const g = mk(V);
      // v8.27: for one curve, a per-curve measured variable (a field-line length L, one value per curve of a list line)
      // is its value at this curve's dataset and picks; a curve it has no value for is not drawn (and said so)
      // v9.1: `over` = {name: value} replaces a variable for this curve (foot gaps: L measured at another output)
      g.forCurve = (c, over = null) => {
        if (!c?.at && !over) return g;
        return mk(n => {
          if (over && n in over) return over[n];
          if (!c?.at) return V(n);
          const u = curveValue(n, c.at);
          if (u === undefined) return V(n);
          if (u !== u) { const m = `${ax} axis: ${n} has no value for ${c.label}`; if (!out.errors.includes(m)) out.errors.push(m); }
          return u;
        });
      };
      return g;
    } catch (e) { out.errors.push(`${ax} axis f(${ax}) = ${txt}: ${e.message}`); return null; }
  };
  if (s.xfn) {
    const g = make(s.xfn, "x");
    if (g) out.x = { g, label: nameIn(prep(s.xfn), "x", xname), tex: texSym(nameIn(prep(s.xfn), "x", own)) };
  }
  if (s.yfn) { const g = make(s.yfn, "y"); if (g) out.y = { g, text: nameIn(prep(s.yfn), "x", xname) }; }
  return out;
}
/** Curve c drawn on the x axis's function: each point moves to f(x); its own x stay in c.x0s (scales read those). */
export function moveX(c, X, over = null) { if (!X || c.x0s) return; const g = X.g.forCurve ? X.g.forCurve(c, over) : X.g; c.x0s = c.xs; c.xs = Float64Array.from(c.xs, x => g(x)); }
/** … and each value to f(y, x) (after scaling: the function acts on the value as it would be drawn). */
export function moveY(c, Y, over = null) { if (!Y) return; const g = Y.g.forCurve ? Y.g.forCurve(c, over) : Y.g, x0 = c.x0s ?? c.xs; c.ys = Float64Array.from(c.ys, (y, j) => g(y, x0[j])); }
/** v14.4 (review §5.5, P1): the one "curve as drawn". Curves read for plot settings `s` are moved to the plot's x (f(x)),
 *  scaled (÷ max …), smoothed along x, turned into their slope (if the line asks), and moved to the plot's y (f(y)), in
 *  that order. The plot, readings, fit variables, foot gaps and the averaged curve all go through here, so a number read
 *  off a curve is the one drawn. T = axisFns(s); `over` = per-curve values for the axis functions (a line length).
 *  Returns the scale's messages. */
export async function asDrawn(s, curves, T, over = null) {
  for (const c of curves) moveX(c, T.x, over);            // (a curve already moved keeps its x)
  const errors = await applyScales(s, curves);
  for (const c of curves) smoothAlong(c, s);              // v10.1: after its scale, before its slope
  for (const c of curves) slopeAlong(c);                  // v8.29: before f(y)
  for (const c of curves) moveY(c, T.y, over);
  return errors;
}

// ---- along x: slope and steps (v8.29) -----------------------------------------------------------------------------
// Human 2026-11-09 (via the intermittent-discharge session): "I like the slope of the drop plot is there a way to do that
// in visualizer without caching everything? should be pretty cheap on the 1D stuff". Computed from the curve as drawn
// (x after its function, so per R* when x is in R*), nothing stored. Definitions as claude_work/scratch/gap-proto/steps.py.
/** The curve's finite points in rising x: [X, Y] (plain arrays). */
function risingPoints(c) {
  const idx = [];
  for (let j = 0; j < c.xs.length; j++) if (Number.isFinite(c.xs[j]) && Number.isFinite(c.ys[j])) idx.push(j);
  idx.sort((a, b) => c.xs[a] - c.xs[b]);
  return [idx.map(j => c.xs[j]), idx.map(j => c.ys[j])];
}
/** y at x in rising (X, Y), held at the end values beyond them (as numpy's interp). */
function interpHeld(X, Y, x) { return x <= X[0] ? Y[0] : x >= X[X.length - 1] ? Y[Y.length - 1] : interp1(X, Y, x); }
/** A line's slope along x (line.slope = {sign: 1 | −1, w}): each value becomes sign × (y(x + w/2) − y(x − w/2)) / w, the
 *  curve held at its ends. After the line's scale, before f(y). (v8.31: the automatic "drop" sign is gone — the human
 *  chooses d/dx or −d/dx; desktops that had it are moved to −d/dx when they open, and one still carrying it is drawn with
 *  the sign that makes its net change positive, named by that sign.) */
/** v10.0: a number setting for one curve. A per-curve reading of a plugin (the aperture4 line length L) is read off this
 *  curve itself (its own line's length at its own time); another per-curve variable (a list line's measured values) is this curve's own value; else the setting's
 *  number (human 2026-11-09: the steps tool's median window = the line length, "one background per line" — before,
 *  every curve got the first curve's length). */
export function curveNum(v, c, dflt) {
  if (isRef(v) && c) {
    const x = S.vars?.[v.slice(1)];
    const rop = x?.type === "measured" ? READING_OPS.find(o => o.key === x.op && o.perCurve) : null;   // v15.1: a plugin's per-curve reading
    if (rop) { const own = rop.value(c); if (Number.isFinite(own)) return own; }                     // (the line length: this curve's own)
    const u = curveValue(v.slice(1), c.at);
    if (u !== undefined && Number.isFinite(u)) return u;
  }
  return num1(v, dflt);
}
export function slopeAlong(c) {
  const sl = c.line?.slope;
  if (!sl?.sign || c.isFn || c.sloped) return;
  const w = curveNum(sl.w, c, 0.5);
  c.sloped = true;
  if (!(w > 0)) return;
  const [X, Y] = risingPoints(c);
  if (X.length < 2) { c.ys = c.ys.map(() => NaN); return; }
  const sg = sl.sign === "drop" ? Math.sign(Y[Y.length - 1] - Y[0]) || 1 : Number(sl.sign) < 0 ? -1 : 1;
  c.ys0 = c.ys;                                           // v9.0: the values before the slope (a foot gap's voltage)
  c.ys = Float64Array.from(c.xs, (x, j) => (Number.isFinite(x) && Number.isFinite(c.ys[j]) ? sg * (interpHeld(X, Y, x + w / 2) - interpHeld(X, Y, x - w / 2)) / w : NaN));
  // v8.30: a slope line is named as one — "−d/dx Φ · r_max = 3.01 · over 0.5" — and its plot's y axis is "slope of …"
  // (the note below says how it was taken)
  const op = sg < 0 ? "−d/dx" : "d/dx", q0 = c.keyed?.[0]?.[1] ?? "", qn = opLabel(op, q0), win = `over ${R.fmt(w)}`;
  c.label = (q0 && c.label.startsWith(q0) ? qn + c.label.slice(q0.length) : `${qn} · ${c.label}`) + ` · ${win}`;
  c.keyed = [["q", qn], ...(c.keyed || []).slice(1), ["slope", win]];
  c.slopeNote = `(${sg < 0 ? "−d/dx, " : ""}w = ${R.fmt(w)})`;
}
const median = a => { if (!a.length) return NaN; const s = [...a].sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]); };
/** The steps tool on one curve (t = {w, k}): background b = running median over w along x, σ = 1.4826 × the median
 *  absolute deviation of e = y − b, steps = runs with e > kσ widened to where e falls back to ≤ 0 on each side (merged
 *  where they touch), each with its 10–90 % span of the excess ∫e dx. The median and σ are taken over x (the curve
 *  resampled to a uniform grid of w/40), so dense points (a traced line near the star) do not weigh more.
 *  {xs, b, thr, sigma, steps: [{a, z, s10, s90, D}]} or null. */
export function stepsOf(c, t) {
  const W = curveNum(t.w, c, 3), K = curveNum(t.k, c, 3);   // v10.0: per curve (a line length L: each line's own)
  const [X, Y] = risingPoints(c);
  if (X.length < 3 || !(W > 0)) return null;
  const x0 = X[0], x1 = X[X.length - 1], h = Math.max(W / 40, (x1 - x0) / 4000), n = Math.floor((x1 - x0) / h) + 1;
  const G = Array.from({ length: n }, (_, i) => interpHeld(X, Y, x0 + i * h)), half = Math.round(W / 2 / h);
  const B = G.map((_, i) => median(G.slice(Math.max(0, i - half), Math.min(n, i + half + 1))));
  const E = G.map((g, i) => g - B[i]), mE = median(E), sigma = 1.4826 * median(E.map(e => Math.abs(e - mE)));
  const grid = Array.from({ length: n }, (_, i) => x0 + i * h);
  const b = X.map(x => interpHeld(grid, B, x)), e = Y.map((y, j) => y - b[j]), hot = e.map(v => v > K * sigma);
  const steps = [];
  for (let i = 0; i < X.length;) {
    if (!hot[i]) { i++; continue; }
    let a = i, z = i;
    while (z + 1 < X.length && hot[z + 1]) z++;
    while (a > 0 && e[a - 1] > 0) a--;
    while (z + 1 < X.length && e[z + 1] > 0) z++;
    if (steps.length && a <= steps.at(-1).z) steps.at(-1).z = z; else steps.push({ a, z });
    i = z + 1;
  }
  for (const st of steps) {                              // where 10 % and 90 % of its excess ∫ max(e, 0) dx lie
    const cum = [0];
    for (let j = st.a + 1; j <= st.z; j++) cum.push(cum.at(-1) + 0.5 * (Math.max(e[j], 0) + Math.max(e[j - 1], 0)) * (X[j] - X[j - 1]));
    const D = cum.at(-1), xsSeg = X.slice(st.a, st.z + 1);
    Object.assign(st, { x0: X[st.a], x1: X[st.z], D, s10: D > 0 ? interp1(cum, xsSeg, 0.1 * D) : X[st.a], s90: D > 0 ? interp1(cum, xsSeg, 0.9 * D) : X[st.z] });
  }
  return { xs: Float64Array.from(X), b: Float64Array.from(b), thr: Float64Array.from(b, v => v + K * sigma), sigma, steps };
}
/** The x window of an axis with a function, not zoomed: the extent of the points as drawn (of those inside the desktop's
 *  time range on a time axis), else of the axis's values moved by f; centred by ±. */
function movedRange(s, curves, X) {
  const tw = s.xaxis === "time" ? timeWindow() : null, ok = v => Number.isFinite(v) && (!s.logx || v > 0);
  let vals = [];
  for (const c of curves) {
    const o = c.x0s ?? c.xs;
    for (let j = 0; j < c.xs.length; j++) if (!tw || (o[j] >= tw[0] && o[j] <= tw[1])) vals.push(c.xs[j]);
  }
  if (!vals.some(ok)) vals = curves.length ? curves.flatMap(c => [...c.xs]) : Array.from(axisValues(s.xaxis), x => X.g(x));
  let [x0, x1] = extent(vals.filter(ok));
  if (s.xsym && !s.logx && isFinite(x0)) { const h = Math.max(Math.abs(x0), Math.abs(x1)); x0 = -h; x1 = h; }
  return [x0, x1];
}
/** Where a function line is evaluated: 400 x across [x0, x1] (log-spaced on a log axis). On an axis with a function
 *  (s.xT = {g, W, log}, v8.17) more points where f stretches the axis, so the curve stays smooth as drawn: each step
 *  is cut until it spans at most 1/400 of the window shown (W; else the curve's own extent), at most 64 pieces. */
function sampleXs(s, range) {
  let [x0, x1] = range;
  if (!isFinite(x0) || !isFinite(x1)) [x0, x1] = [0, 1];
  if (x0 === x1) [x0, x1] = [x0 - 1, x1 + 1];
  const lg = s.logx && x0 > 0 && x1 > 0, n = 400, xs = new Float64Array(n);
  for (let j = 0; j < n; j++) xs[j] = lg ? x0 * Math.pow(x1 / x0, j / (n - 1)) : x0 + ((x1 - x0) * j) / (n - 1);
  if (!s.xT) return xs;
  const { g, W, log } = s.xT, G = Array.from(xs, x => (log ? Math.log10(g(x)) : g(x))), [a, b] = extent(G), step = (W || b - a) / 400;
  if (!(step > 0)) return xs;
  const out = [];
  for (let j = 0; j < n - 1; j++) {
    const d = Math.abs(G[j + 1] - G[j]), k = Number.isFinite(d) ? Math.min(64, Math.max(1, Math.ceil(d / step))) : 1;
    for (let q = 0; q < k; q++) out.push(lg ? xs[j] * Math.pow(xs[j + 1] / xs[j], q / k) : xs[j] + ((xs[j + 1] - xs[j]) * q) / k);
  }
  out.push(xs[n - 1]);
  return Float64Array.from(out);
}
/** A function line y = f(x) (v5.13, human 2026-10-06: "plotting analytic functions … a quadratic to see how it fits
 *  data"): sampled across the x window. Names: x, t (the slider's time), number / measured variables (a list gives
 *  one curve per value: `sub`), and the numbers of the line's dataset config (if it has a dataset). */
export function fnCurve(s, line, sub, range) {
  const run = runOf(line.run), conf = (run && store.runs[run]?.conf) || {};
  let f;
  try { f = compileFunction(line.fn, conf, n => ["number", "measured", "config", "fit"].includes(S.vars?.[n]?.type)).f; }
  catch (e) { return { error: `y = ${line.fn}: ${e.message}` }; }
  const V = n => (sub && sub.fnvar === n ? sub.value : Number(numOf("$" + n)));
  const xs = sampleXs(s, range), ys = new Float64Array(xs.length);
  for (let j = 0; j < xs.length; j++) {
    let y;
    try { y = f(xs[j], S.t, V); } catch { y = NaN; }
    ys[j] = s.abs ? Math.abs(y) : y;
  }
  const name = `y = ${line.fn}`, subLabel = sub ? `${sub.fnvar} = ${R.fmt(sub.value)}` : null;
  return { curve: { line, src: null, isFn: true, xs, ys, label: [name, subLabel].filter(Boolean).join(" · "), sub, subLabel,
    keyed: [["q", name], ...(sub ? [["fn:" + sub.fnvar, subLabel]] : [])], listKey: sub ? "fn:" + sub.fnvar : null } };
}
// ---- analytic lines (v7) -----------------------------------------------------------------------------------------
const AN_MAX = 60;                                       // curves one analytic line may draw (combinations of lists)
/** y at x of a curve given at xs (linear; NaN outside; xs ascending or descending). */
function interpAt(xs, ys, x) {
  const n = xs.length;
  if (!n) return NaN;
  const asc = xs[n - 1] >= xs[0], lo = asc ? xs[0] : xs[n - 1], hi = asc ? xs[n - 1] : xs[0];
  if (!(x >= lo && x <= hi)) return NaN;
  let a = 0, b = n - 1;
  while (b - a > 1) { const m = (a + b) >> 1; if ((xs[m] <= x) === asc) a = m; else b = m; }
  const d = xs[b] - xs[a];
  return d === 0 ? ys[a] : ys[a] + (ys[b] - ys[a]) * (x - xs[a]) / d;
}
/** An analytic line's curve (v7). Each {parameter} is filled per its binding (anBindings): the x axis; a number or
 *  variable (a list: `sub` holds this curve's values); a config number; the slider's time; or a datatype of the line's
 *  dataset, read along the x axis (at the slider's time, or at {t} / {time} when that is a value) and at the values of
 *  the parameters named like its other dims ({r_max} …; the middle value when there is none). A datatype without the
 *  x axis gives one number. The curve's x values are those of its first datatype, else 400 points across the window. */
export async function analyticCurve(s, line, sub, range, multiRun = false) {
  const def = anDef(line);
  if (def.error) return { error: `${line.an}: ${def.error}` };
  const run = runOf(line.run), b = anBindings(line, s.xaxis), scal = {}, data = [];
  // v8.8: a quantity / config parameter may come from its own dataset (binding.run), else the line's
  const runOfB = x => (x.run !== undefined && x.run !== null ? x.run : line.run), used = new Set();
  let follows = null, usesRun = false;
  const err = m => ({ error: `${def.label}: ${m}` });
  for (const p of def.params) {                          // numbers first: datatypes are read where they say
    const x = b[p];
    if (x.mode === "value") {
      // v8.10: a fit variable gives its value for the parameter's dataset (its menu, else the line's)
      const prev = setRunContext(runOfB(x));
      const v = isRef(x.value) && sub?.an && x.value in sub.an ? sub.an[x.value] : Number(numOf(x.value));
      setRunContext(prev);
      if (varOf(x.value)?.type === "fit") { usesRun = true; used.add(runOf(runOfB(x))); }
      if (x.value === null || x.value === undefined || x.value === "" || !isFinite(v)) return err(`give {${p}} a value (click the line in the legend)`);
      scal[p] = v;
    } else if (x.mode === "conf") {
      const r = runOf(runOfB(x)), v = r && store.runs[r]?.conf?.[x.key ?? p];
      if (typeof v !== "number") return err(`${r ?? "no dataset"} has no config number ${x.key ?? p}`);
      scal[p] = v; usesRun = true; used.add(r);
    } else if (x.mode === "time") scal[p] = S.t;
  }
  const tParam = ["t", "time"].find(p => b[p]?.mode === "value"), tAt = tParam ? scal[tParam] : null;
  for (const p of def.params) {
    if (b[p].mode !== "data") continue;
    usesRun = true;
    const brun = runOfB(b[p]), src = srcOf(brun, b[p].q);
    used.add(runOf(brun));
    if (!src) return err(`${b[p].q} is not cached for ${runOf(brun) ?? "the dataset"}`);
    const fit = fitAxis(src, s.xaxis), picks = {};
    for (const d of src.spaceDims) {                     // its other dims: from the parameter named like them
      if (fit && d === fit.dim) continue;
      const ch = coordChoices(src, d), q = def.params.find(pp => pp in scal && ch.some(c => c[0] === pp));
      if (!q) continue;
      const c = ch.find(x => x[0] === q), i = indexer(c[2])(scal[q]);
      if (i < 0) return err(`${q} = ${R.fmt(scal[q])} is outside ${src.label}`);
      picks[d] = ch[0][2][i];
      scal[q] = c[2][i];          // the formula uses the value the data was read at (the nearest stored field line)
    }
    if (fit) {
      const r = await lineCurve(s, { run: brun, q: b[p].q, picks, pickAs: {}, timeMode: tAt !== null ? "fixed" : "follow", fixedTime: tAt, smooth: line.smooth, tavg: line.tavg, avg: line.avg }, false, null);
      if (r.error) return err(r.error);
      data.push({ p, xs: r.curve.xs, ys: r.curve.ys });
      follows = follows || r.follows;
    } else {                                             // no x axis in it: one number (at the time and the picks)
      const fr = await src.frame(src.hasTime ? src.indexAt(tAt ?? S.t) : 0);
      let off = 0;
      src.spaceDims.forEach((d, k) => { off += pickIndex(src, d, picks[d]) * src.strides[k]; });
      scal[p] = fr[off];
    }
  }
  const xs = data.length ? data[0].xs : sampleXs(s, range);
  const cols = def.params.map(p => data.find(d => d.p === p) || null), P = new Array(def.params.length), ys = new Float64Array(xs.length);
  for (let j = 0; j < xs.length; j++) {
    def.params.forEach((p, k) => {
      const d = cols[k];
      P[k] = b[p].mode === "x" ? xs[j] : d ? (d.xs === xs ? d.ys[j] : interpAt(d.xs, d.ys, xs[j])) : scal[p];
    });
    let y;
    try { y = def.f(P); } catch { y = NaN; }
    ys[j] = s.abs ? Math.abs(y) : y;
  }
  const subLabel = sub ? sub.label : null, runs = [...used].filter(Boolean).join(" / ") || run;
  // v8.8: the values typed for its parameters are keyed too, so two lines of one function that differ only there are
  // told apart in the legend ("parab · a = 2"); values that every curve shares stay out (compact legend)
  const vals = def.params.filter(p => b[p].mode === "value" && !(sub?.an && isRef(b[p].value) && b[p].value in sub.an)).map(p => [`p:${p}`, `${p} = ${R.fmt(scal[p])}`]);
  const keyed = [["q", def.label], ...(multiRun && usesRun ? [["run", runs]] : []), ...vals, ...(sub ? [["an", subLabel]] : [])];
  return { curve: { line, src: null, isFn: true, isAn: true, xs, ys, label: [def.label, multiRun && usesRun ? runs : null, subLabel].filter(Boolean).join(" · "),
    sub, subLabel, keyed, listKey: sub ? "an" : null }, follows };
}

/** One line -> one curve {xs, ys, label}. Its dataset and picks may follow variables (v5). `sub` = one value of a
 *  list variable for dim sub.dim, read in that dim's shown coordinate (r_max …). */
export async function lineCurve(s, line, multiRun, sub = null) {
  const made = madeKind(line);                            // v14.4: table, period, lineout, foot gap: their own curve (linekinds.js)
  if (made) return made.curve(s, line, sub, { lineCurve, smoothAlong, slopeAlong });
  const line0 = line;                                                   // the curve belongs to the line as stored
  if (sub?.run !== undefined) line = { ...line, run: sub.run };          // v8.18: one dataset of a dataset list
  if (isAn(line)) return analyticCurve(s, line, sub, s.view ? [s.view.x0, s.view.x1] : axisExtent(s.xaxis, s.logx), multiRun);
  if (isFn(line)) return fnCurve(s, line, sub, s.view ? [s.view.x0, s.view.x1] : axisExtent(s.xaxis, s.logx));
  const run = runOf(line.run), src = srcOf(line.run, line.q);
  // v14.9: a line with no quantity, no function and no known kind was made by a plugin that is not loaded (kept as it is)
  if (line.q == null) return { error: `a line made by a plugin that is not loaded (${Object.keys(line).filter(k => !["id", "run", "label", "color", "dash", "width", "visible", "q", "picks", "pickAs", "pickValues", "timeMode", "scale", "yaxis"].includes(k)).join(", ") || "unknown kind"}): add the plugin to viewer/plugins/index.json` };
  if (!src) return { error: run ? `${line.q} is not cached for ${run}: compute it in the data manager (🗂 data), then ⟳ refresh data` : `variable ${line.run.slice(1)} is missing` };
  const miss = missingKindOf(src);                       // v15.1: data only a plugin that is off can draw
  if (miss) return { error: missingKindText(miss, `${src.label} (${run})`) };
  const fit = fitAxis(src, s.xaxis), kind = dataKindOf(src);
  if (!fit) return { error: `${src.label} (${run}) has no ${s.xaxis} axis` };
  const sd = src.spaceDims;
  let xs = fit.values, extra = null;                      // v15.1: a data kind may give x per curve (its lineData, below)
  let tFixed = 0;
  const ft = sub && sub.time !== undefined ? sub.time : numOf(line.fixedTime);
  if (src.hasTime && fit.dim !== "time") tFixed = line.timeMode === "fixed" ? src.indexAt(isFinite(ft) && ft !== null ? ft : src.times.at(-1)) : src.indexAt(S.t);
  // v5.14: "mean over" a time interval (profiles): every frame in it, trapezoid weights in t; empty from / to = the
  // desktop's time range (or all times)
  const timeMean = src.hasTime && fit.dim !== "time" && line.timeMode === "mean";
  // v5.13 (human 2026-10-06: "average over +-2 frames"): a profile was the mean of the frames tFixed - N … tFixed + N, a
  // time series a running mean over ±N points; v10.1: that is now the smoothing over time (below).
  // v8.14 (relayed by the "Twist Analysis" session 2026-10-20: "a time-derivative option on lines, so derived powers and
  // rates never have to be stored"): line.ddt = {sign: 1 | −1, n, how: "fit" | "diff"} draws d/dt instead of the value.
  // x = time: along x. Another x: along time at each x — around the time shown (±n outputs, at least ±1), or over a
  // "mean over" window as the rate over it (its slope, or its ends' difference)
  const dd = src.hasTime && line.ddt && line.ddt.sign ? line.ddt : null, dn = dd ? Math.max(0, Math.min(50, Math.round(num1(dd.n, 2)))) : 0;
  // v10.1.1: a time series (x = time) is smoothed along t here, before its d/dt (other x: smoothAlong, after the scale);
  // a profile's time average (its time row: the outputs within t ± h, plain mean) — not with a "mean over" time window,
  // nor on a rate line's profile (its ±n is its own window)
  const timeX = fit.dim === "time", smX = timeX ? smoothOf(s, line) : null, hX = smX ? num1(smX.h, NaN) : NaN;
  const hT = !timeX && src.hasTime && !timeMean && !dd ? tavgOf(s, line) : 0;
  let need = fit.dim === "time" ? [...Array(src.nFrames).keys()] : [], fw = null;
  const frames = new Map();
  if (timeMean) {
    const w = timeInfo(), lim = w.limited && !w.empty;
    need = rangeIdx(src.times, num1(line.timeFrom, lim ? w.a : -Infinity), num1(line.timeTo, lim ? w.b : Infinity));
    if (!need.length) return { error: `${src.label} (${run}): no times in the mean's interval` };
    fw = trapzWeights(src.times, need);
  } else if (fit.dim !== "time") {
    const win = (h) => { for (let i = Math.max(0, tFixed - h); i <= Math.min(src.nFrames - 1, tFixed + h); i++) need.push(i); };
    if (dd) win(Math.max(1, dn));
    else if (hT > 0) {
      const t0 = src.times[tFixed];
      for (let i = 0; i < src.nFrames; i++) if (Math.abs(src.times[i] - t0) <= hT + 1e-9 * Math.max(1, Math.abs(t0))) need.push(i);
    } else win(0);
  }
  await Promise.all(need.map(async i => frames.set(i, await src.frame(i))));
  let base = 0, subLabel = null;
  const parts = [], keyed = [["q", src.label], ["run", run]];       // label parts by kind (compact legend, v5.9)
  const avgDims = [];                                     // v5.14: dims averaged instead of picked
  const atD = {};                                         // v8.27: the picked value of each dim, in its own coordinate
  for (let k = 0; k < sd.length; k++) {
    const d = sd[k];
    if (d === fit.dim) continue;
    const as = pickCoord(src, d, line.pickAs?.[d]), p = line.picks?.[d];
    if (isMeanPick(p) && !(sub && sub.dim === d)) {
      const name = as[1].replace(/ \[.*\]$/, ""), idx = rangeIdx(as[2], num1(p.from, -Infinity), num1(p.to, Infinity));
      if (!idx.length) return { error: `${src.label} (${run}): no ${name} values in the mean's range` };
      avgDims.push({ stride: src.strides[k], idx, w: trapzWeights(as[2], idx) });
      const part = `mean over ${name}` + (p.from != null || p.to != null ? ` ${R.fmt(as[2][idx[0]])}–${R.fmt(as[2][idx.at(-1)])}` : "");
      parts.push(part); keyed.push(["d:" + d, part]);
      continue;
    }
    let i;
    if (sub && sub.dim !== undefined && d === sub.dim) {
      i = indexer(as[2])(sub.value);
      if (i < 0) return { error: `${as[1].replace(/ \[.*\]$/, "")} = ${R.fmt(sub.value)} is outside ${src.label}` };
    } else i = pickIndex(src, d, line.picks?.[d], line.pickAs?.[d]);
    base += i * src.strides[k];
    atD[d] = src.run.m.coords[d]?.values?.[i];
    const part = `${as[1].replace(/ \[.*\]$/, "")} = ${(as[0] === d && src.run.coord(d)?.names?.[i]) || R.fmt(as[2][i])}`;   // v8.25: a named axis
    parts.push(part); keyed.push(["d:" + d, part]);
    if (sub && sub.dim !== undefined && d === sub.dim) subLabel = part;
  }
  const sx = fit.dim === "time" ? 0 : src.strides[sd.indexOf(fit.dim)], combos = avgOffsets(avgDims);
  const at = (arr, off) => {                              // a value, or the weighted mean over the averaged dims
    if (!arr) return NaN;
    if (!combos) return arr[off];
    let sum = 0, W = 0;
    for (const c of combos) { const v = arr[off + c.off]; if (Number.isFinite(v)) { sum += c.w * v; W += c.w; } }
    return W ? sum / W : NaN;
  };
  let val = (i, j) => at(frames.get(i), base + j * sx);   // the value of frame i at point j of the curve
  // v15.1 (DECISIONS D20): a data kind reads its own x and values per frame (aperture4: data at a field line's own
  // points, whose x moves with the line); `ref` = the frame whose x the curve takes (the middle of a time window's)
  if (kind?.lineData) {
    const r = await kind.lineData({ src, run, fit, need, frames, base, sx, ref: timeMean ? need[need.length >> 1] : tFixed, avgDims });
    if (r.error) return { error: r.error };
    xs = r.xs; val = r.val; extra = r.extra || null;
  }
  let ys = new Float64Array(xs.length);
  const T = dd && fit.dim !== "time" ? need.map(i => src.times[i]) : null;          // v8.14: d/dt along time at each x
  for (let j = 0; j < xs.length; j++) {
    if (fit.dim === "time") { ys[j] = at(frames.get(j), base); continue; }
    if (T) { const V = need.map(i => val(i, j)); ys[j] = dd.how === "diff" ? diffOver(T, V, timeMean ? dn + 1 : Math.max(1, dn)) : lsSlope(T, V); continue; }
    let sum = 0, W = 0;
    need.forEach((i, q) => { const v = val(i, j), w = fw ? fw[q] : 1; if (Number.isFinite(v)) { sum += w * v; W += w; } });
    ys[j] = W ? sum / W : NaN;
  }
  if (hX > 0) ys = smoothSeries(xs, ys, smX);               // v10.1.1 (was a running mean over ±N points)
  if (dd && fit.dim === "time") ys = ddtSeries(xs, ys, dn, dd.how);
  if (dd && dd.sign < 0) ys = ys.map(v => -v);
  if (s.abs) ys = ys.map(Math.abs);
  if (hX > 0) { parts.push(smoothText(smX, hX)); keyed.push(["smooth", parts.at(-1)]); }
  if (hT > 0 && need.length > 1) { parts.push(`mean over t ± ${R.fmt(hT)}`); keyed.push(["tavg", parts.at(-1)]); }
  if (dd) {
    const qd = opLabel(`${dd.sign < 0 ? "−" : ""}d/dt`, src.label);            // v8.30: a family member keeps its family first
    keyed[0] = ["q", qd];
    if (!timeMean) { parts.push(dd.how === "diff" ? `difference${dn ? ` of ±${dn} means` : ""}` : `fit over ±${Math.max(1, dn)} outputs`); keyed.push(["ddt", parts.at(-1)]); }
  }
  if (timeMean) { parts.push(`${dd ? "rate" : "mean"} over t ${R.fmt(src.times[need[0]])}–${R.fmt(src.times[need.at(-1)])}`); keyed.push(["t", parts.at(-1)]); }
  if (src.hasTime && fit.dim !== "time" && line.timeMode === "fixed") {
    parts.push(`t = ${R.fmt(src.times[tFixed])}`); keyed.push(["t", parts.at(-1)]);
    if (sub && sub.time !== undefined) subLabel = parts.at(-1);
  }
  const label = [keyed[0][1], multiRun ? run : null, ...parts].filter(Boolean).join(" · ");
  if (sub?.run !== undefined) subLabel = [run, subLabel].filter(Boolean).join(" · ");       // v8.18: its dataset (and value)
  const listKey = !sub ? null : sub.run !== undefined ? "run" : sub.dim !== undefined ? "d:" + sub.dim : "t";
  // v8.27: where the curve was read (its dataset, picks and time): per-curve measured variables match on it (curveValue)
  const readAt = { run, d: atD, t: src.hasTime && fit.dim !== "time" && !timeMean ? src.times[tFixed] : null };
  return { curve: { line: line0, src, xs, ys, label, sub, subLabel, keyed, listKey, at: readAt, timeX, ...extra }, follows: src.hasTime && fit.dim !== "time" && line.timeMode !== "fixed" && !timeMean ? { src, tFixed } : null };
}

// ---- scaling (v5.5, human 2026-10-05: "twist_angle / max drive_angle so I can compare shapes of different field
// lines"). spec = {mode: "none" | "max" | "ref" | "at" | "num", q, at, value}; a line's own spec, else the panel's.
export const scaleOf = (s, line) => (line.scale !== undefined ? line.scale : s.scale) || null;
// v5.13: also "mean" = ÷ its own mean (over the whole curve, inside the time range on a time axis; spec.from / to)
const maxAbs = ys => { let m = 0; for (const y of ys) if (isFinite(y) && Math.abs(y) > m) m = Math.abs(y); return m; };
/** Divide each curve by its scale; a "ref" scale uses the same line (dataset, field line / time value) with another
 *  datatype, e.g. the drive twist of that very field line. Returns error texts. */
export async function applyScales(s, curves) {
  const errors = [], zero = [];
  await Promise.all(curves.map(async c => {
    const spec = scaleOf(s, c.line);
    if (!spec || spec.mode === "none") return;
    let div = NaN, note = "";
    if (spec.mode === "max") { div = maxAbs(c.ys); note = "÷ max"; }
    else if (spec.mode === "mean") { const [a, b] = overRange(s, spec); div = meanOf(c.x0s ?? c.xs, c.ys, a, b); note = "÷ mean"; }   // v5.13 (v8.17: in the axis's own x)
    else if (spec.mode === "ref" && (c.isFn || !c.src)) {   // v14.3.2: tables, period, foot-gap and lineout curves have no recorded source
      errors.push("scale ÷ max of another quantity: only for recorded lines"); return; }
    else if (spec.mode === "ref") {
      const r = await lineCurve(s, { ...c.line, q: spec.q, label: null }, false, c.sub);
      if (r.curve) { div = maxAbs(r.curve.ys); note = `÷ max ${r.curve.src.label}`; } else { errors.push(`scale: ${r.error}`); return; }
    } else if (spec.mode === "at") {            // v11.2.1: per curve (a fit / measured variable: this curve's own value)
      const x = curveNum(spec.at, c, NaN), j = isFinite(x) ? indexer(c.x0s ?? c.xs)(x) : -1;
      div = j >= 0 ? c.ys[j] : NaN; note = `÷ value at ${R.fmt(x)}`;
    } else if (spec.mode === "num") { div = curveNum(spec.value, c, NaN); note = `÷ ${R.fmt(div)}`; }
    if (!(isFinite(div) && div !== 0)) { c.scaleNote = "(not scaled: ÷0)"; c.label += " (not scaled: ÷0)"; zero.push(c); return; }
    c.ys = c.ys.map(y => y / div);
    c.scaleNote = note; c.label += ` ${note}`;
  }));
  // e.g. a field line outside the driven band has no drive to divide by: one short message, curves left as they are
  if (zero.length) errors.push(`${zero.length} curve${zero.length > 1 ? "s" : ""} not scaled (the scale is 0 there, e.g. no drive on that field line)`);
  return errors;
}

// ---- compact legend (v5.9, human 2026-10-05: "how do I make the legend labels not auto clunky?") -------------------
/** A line's own label as typed, with {name} variables filled in and {v} = this curve's list value (v5.10: nothing is
 *  appended automatically; without a curve, {v} and the separator before it are dropped). null = no own label. */
function ownLabel(l, c) {
  if (l.label === null || l.label === undefined) return null;
  const v = c?.sub ? (c.sub.run ?? R.fmt(c.sub.value ?? c.sub.time)) : null;     // v8.18: a dataset list's {v} = the dataset
  const t = v !== null ? String(l.label).replace(/\{v\}/g, v) : String(l.label).replace(/\s*[·:=,-]?\s*\{v\}/g, "");
  // v11.1: {dataset} = this curve's dataset (without a curve: the line's)
  return subVars(t, { dataset: c?.at?.run ?? c?.src?.run?.name ?? runsOf(l.run).join(", "), t: R.fmt(c?.at?.t ?? S.t) });   // no scale note: that is the y axis label's job
}
/** Leading words shared by all strings ("twist angle (measured)", "twist angle (drive)" -> "twist angle "). */
function commonWords(strs) {
  const w = strs.map(s => s.split(" "));
  let n = 0;
  while (w.every(x => x.length > n + 1 && x[n] === w[0][n])) n++;
  return n ? w[0].slice(0, n).join(" ") + " " : "";
}
/** Give each curve .compact = only the label parts that differ between the curves; return the common parts. */
function compactLabels(curves) {
  const vals = new Map();
  for (const c of curves) for (const [k, v] of c.keyed) { if (!vals.has(k)) vals.set(k, new Set()); vals.get(k).add(v); }
  const varies = k => vals.get(k).size > 1 || curves.some(c => !c.isFn && !c.keyed.some(([kk]) => kk === k));
  let short = v => v;
  if (vals.has("q") && varies("q")) {
    const pre = commonWords([...vals.get("q")]);
    if (pre) short = v => v.slice(pre.length).replace(/^\(|\)$/g, "") || v;
  }
  // scale notes: only a curve left unscaled, or scales that differ between lines, need saying in the legend
  const real = new Set(curves.map(c => c.scaleNote).filter(n => n && !n.startsWith("(not scaled")));
  for (const c of curves) {
    c.varying = c.keyed.filter(([k]) => varies(k)).map(([k, v]) => [k, k === "q" ? short(v) : v]);
    const say = c.scaleNote && (c.scaleNote.startsWith("(not scaled") || real.size > 1);
    c.compact = (c.varying.map(x => x[1]).join(" · ") || c.keyed[0][1]) + (say ? ` ${c.scaleNote}` : "");
  }
  // a scale shared by every curve belongs to the y axis label, not the legend (human 2026-10-05: "the axis label
  // already contains that information, the label is only to differentiate different lines")
  return [...vals.keys()].filter(k => !varies(k)).map(k => [...vals.get(k)][0]);
}

/** Per-step sources a 1D panel follows (for the prefetcher). */
export function followSources1D(panel) {
  const s = eff(panel), out = [];
  for (const l of s.lines || []) {
    if (l.visible === false) continue;
    if (isAn(l)) {                                       // v7: the datatypes an analytic line reads at the slider's time
      for (const b of Object.values(anBindings(l, s.xaxis))) {
        const src = b.mode === "data" ? srcOf(b.run ?? l.run, b.q) : null, fit = fitAxis(src, s.xaxis);
        if (src && fit && src.hasTime && fit.dim !== "time") out.push(src);
      }
      continue;
    }
    for (const run of runsOf(l.run)) {                     // v8.18: each dataset of a dataset list
      const src = srcOf(run, l.q), fit = fitAxis(src, s.xaxis);
      if (src && fit && src.hasTime && fit.dim !== "time" && l.timeMode !== "fixed" && l.timeMode !== "mean") {
        out.push(src, ...(dataKindOf(src)?.readsWith?.(src) || []));   // v15.1: what a data kind reads with it (along-line data: its s)
      }
    }
  }
  return out;
}

export const margins1D = fig => { const m = R.axisMargins(); return { l: fig?.hideY ? 8 : m.l, r: 16, t: m.t, b: fig?.hideX ? 8 : m.b }; };

export async function render1D(members) {
  // v8.7: a plot drawn scaled (focus mode) draws its canvas at that scale too (sharp): its own pixel density
  const dpr0 = (window.devicePixelRatio || 1) * (window.aptvisZoom || 1), dprOf = sp => dpr0 * (sp?.renderScale || 1);
  let dpr = dpr0;
  const items = [];
  for (const { panel, L: sp } of members) {
    dpr = dprOf(sp);
    setRunContext(panelRun(eff(panel), "1d"));                     // v8.10: fit variables are this plot's dataset's
    const s = resolved(eff(panel)), lines = s.lines || [];          // numbers that follow variables, resolved
    const T = axisFns(s);                                           // v8.17: the axes' functions
    const multiRun = new Set(lines.filter(l => !isFn(l) || isAn(l)).flatMap(l => runsOf(l.run))).size > 1;   // v8.18: a list's runs too
    // slots: one per curve to draw (a list line gives several), hidden lines included for the legend
    const slots = [];
    for (const l of lines) for (const sub of expansions(l, s.xaxis)) slots.push({ l, sub, key: slotKey(l, sub) });
    const jobs = slots.filter(x => x.l.visible !== false);
    // data lines first; function lines (v5.13) are then sampled across the x window those give (or the axis' data)
    // v8.18: a curve whose data can't be read (e.g. one dataset of a list) is reported; the others are still drawn
    const failed = (x, e) => ({ error: `${x.sub?.run ?? runOf(x.l.run) ?? ""}: ${e?.message || e}` });
    const res = await Promise.all(jobs.map(x => (isFn(x.l) ? null : lineCurve(s, x.l, multiRun, x.sub).catch(e => failed(x, e)))));
    let range, sF = s;
    if (!T.x) range = xRangeOf(s, res.filter(r => r?.curve).map(r => r.curve));
    else {
      // v8.17: on an axis with a function, function lines are evaluated in the axis's own x (across the data's own
      // extent), then moved like the data; sampled finer where f stretches the axis (sampleXs)
      const own = res.filter(r => r?.curve).map(r => r.curve.xs);
      range = own.length ? extent(own.flatMap(a => [...a])) : axisExtent(s.xaxis);
      const v = s.view, W = v ? (s.logx ? Math.log10(v.x1 / v.x0) : v.x1 - v.x0) : NaN;
      sF = { ...s, logx: axisInfo(s.xaxis).scale === "log", xT: { g: T.x.g, W: Number.isFinite(W) ? Math.abs(W) : null, log: !!s.logx } };
      for (const r of res) if (r?.curve) moveX(r.curve, T.x);
    }
    await Promise.all(jobs.map(async (x, j) => {
      if (isAn(x.l)) res[j] = await analyticCurve(sF, x.l, x.sub, range, multiRun).catch(e => failed(x, e));   // v7
      else if (isFn(x.l)) { setRunContext(panelRun(s, "1d")); res[j] = fnCurve(sF, x.l, x.sub, range); }
      if ((isAn(x.l) || isFn(x.l)) && res[j]?.curve) moveX(res[j].curve, T.x);
    }));
    res.forEach((r, j) => { if (r.curve) r.curve.key = jobs[j].key; });
    const curves = res.map(r => r.curve).filter(Boolean);
    const errors = [...new Set([...T.errors, ...res.filter(r => r.error).map(r => r.error), ...(await asDrawn(s, curves, T))])];   // v14.4: as drawn
    // v8.30: slope / rate lines have their own y axes — say so when a plot mixes them with others
    const kinds = new Set(curves.filter(c => c.src && !c.isFn).map(c => lineKind(c.line, c.src)).filter(Boolean));
    const odd = [...kinds].filter(k => s.ykind && k !== s.ykind && (splitKind(k).mode || splitKind(s.ykind).mode));
    if (odd.length) errors.push(`this plot's y axis is "${s.ykind}": its ${odd.map(k => `"${k}"`).join(", ")} lines belong in a plot of their own (a line's "→ its slope" / "→ its d/dt" makes one)`);
    for (const e of T.errors) if (!errors.includes(e)) errors.push(e);   // v8.27: a per-curve value missing for f(y)
    // v5.14 (human 2026-10-06: "mean along the given axis … mean along s/smax"): a mean tool along another axis than x
    // draws, for each curve, the same line averaged over that axis (dashed, in the curve's colour)
    const toolCurves = [];
    for (const t of s.tools || []) {
      if (!t.visible || t.type !== "mean" || !t.along) continue;
      const done = new Set();
      for (const c of curves) {
        if (c.isFn || !c.src || (t.line != null && c.line.id !== t.line) || !c.src.dims.includes(t.along) || fitAxis(c.src, s.xaxis)?.dim === t.along) continue;
        // averaged over the list's own axis: one curve (per dataset of a dataset list, v8.18)
        const sub = c.sub && c.sub.dim === t.along ? (c.sub.run !== undefined ? { run: c.sub.run, k: c.sub.k, n: c.sub.n, ref: c.sub.ref } : null) : c.sub;
        const key = sub ? slotKey(c.line, sub) : String(c.line.id);
        if (done.has(key)) continue;
        done.add(key);
        const l2 = t.along === "time" ? { ...c.line, timeMode: "mean", timeFrom: t.from ?? null, timeTo: t.to ?? null }
          : { ...c.line, picks: { ...(c.line.picks || {}), [t.along]: { mean: true, from: t.from ?? null, to: t.to ?? null } } };
        const r = await lineCurve(s, l2, multiRun, sub).catch(e => ({ error: String(e?.message || e) }));
        if (r.error) { if (!errors.includes(`mean: ${r.error}`)) errors.push(`mean: ${r.error}`); continue; }
        await asDrawn(s, [r.curve], T);                   // v14.4: as drawn
        toolCurves.push({ tid: t.id, parent: c, curve: r.curve });
      }
    }
    // v8.29: the steps tool — each chosen curve's background b and threshold b + kσ (tool curves: in the y range) and its
    // steps (shaded when drawn)
    const toolSteps = [];
    for (const t of s.tools || []) {
      if (!t.visible || t.type !== "steps") continue;
      for (const c of curves) {
        if (c.isFn || (t.line != null && c.line.id !== t.line)) continue;
        const r = stepsOf(c, t);
        if (!r) continue;
        toolSteps.push({ tid: t.id, parent: c, r });
        if (t.showBg !== false) toolCurves.push({ tid: t.id, parent: c, curve: { xs: r.xs, ys: r.b }, role: "bg" });
        if (t.showThr !== false) toolCurves.push({ tid: t.id, parent: c, curve: { xs: r.xs, ys: r.thr }, role: "thr" });
      }
      // v8.32: a named steps tool publishes its steps (the sidebar's Outputs tab; "$name.from" …; steps from an output)
      if (t.name) {
        const out = { kind: "steps", panel: panel.id, toolId: t.id, x: JSON.stringify([s.xaxis, s.xfn || ""]), xlabel: T.x ? T.x.label : axisLabel(s.xaxis),
          w: num1(t.w, 3), k: num1(t.k, 3), curves: toolSteps.filter(o => o.tid === t.id).map(o => ({ at: o.parent.at ? { run: o.parent.at.run, d: { ...o.parent.at.d } } : null,
            label: o.parent.label, sigma: o.r.sigma, steps: o.r.steps.map(st => ({ x0: st.x0, x1: st.x1, s10: st.s10, s90: st.s90, D: st.D })) })) };
        putOutput(t.name, out);                           // v14.4: the result store (its users redraw on a change)
      }
    }
    items.push({ panel, sp, s, T, lines, slots, curves, errors, toolCurves, toolSteps, follows: res.find(r => r.follows)?.follows, followSrcs: [...new Set(res.filter(r => r.follows).map(r => r.follows.src))] });
  }
  // shared y range (linked panels with identical y settings)
  const groups = new Map();
  for (const it of items) {
    const s = it.s;
    let [x0, x1] = xRangeOf(s, it.curves.filter(c => !c.isFn), it.T.x);
    if (!s.view && it.curves.some(c => c.isTab || c.markers) && isFinite(x0) && isFinite(x1)) {   // v14.0: a table's points, not on the frame
      const lo = Math.min(x0, x1), hi = Math.max(x0, x1), pad = hi > lo ? 0.06 * (hi - lo) : Math.abs(lo) * 0.1 || 1;
      if (s.logx && lo > 0) { const f = hi > lo ? Math.pow(hi / lo, 0.06) : 1.3; x0 = lo / f; x1 = hi * f; } else { x0 = lo - pad; x1 = hi + pad; }
    }
    it.x0 = x0; it.x1 = x1;
    let y0 = Infinity, y1 = -Infinity;
    // function lines are overlays: the automatic y range follows the data, and grows to show a function only up to
    // one data height beyond it (a steep formula can't squash the data); a panel of functions only fits them
    const fitY = it.curves.some(c => !c.isFn) ? it.curves.filter(c => !c.isFn) : it.curves;
    const take = (c, lo = -Infinity, hi = Infinity) => {
      for (let j = 0; j < c.xs.length; j++) {
        const x = c.xs[j], y = c.ys[j];
        if (x < Math.min(x0, x1) || x > Math.max(x0, x1) || !isFinite(y) || y < lo || y > hi || (s.logy && y <= 0)) continue;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    };
    for (const c of fitY) take(c);
    for (const o of it.toolCurves) take(o.curve);
    if (fitY.length < it.curves.length && isFinite(y0)) {
      const span = y1 - y0 || Math.abs(y1) || 1, lo = y0 - span, hi = y1 + span;
      for (const c of it.curves) if (c.isFn) take(c, lo, hi);
    }
    if (it.curves.some(c => c.isTab || c.markers) && isFinite(y0) && isFinite(y1)) {          // v14.0: a table's points, not on the frame
      const pad = y1 > y0 ? 0.06 * (y1 - y0) : Math.abs(y0) * 0.1 || 1;
      if (!(s.logy && y0 - pad <= 0)) { y0 -= pad; y1 += pad; }
    }
    it.y0 = y0; it.y1 = y1;
    // v14.3.3: plots drawn together share one y range only when they show the same thing (yAxisId) and neither made its y window its own
    const g = JSON.stringify([ownY(it.panel) ? it.panel.id : null, s.xaxis, yAxisId(s), s.logy, s.abs, s.ylim, s.ymin, s.ymax, s.yview, s.scale ?? null, !!s.ysym, s.xfn ?? null, s.yfn ?? null]);
    if (!groups.has(g)) groups.set(g, []); groups.get(g).push(it);
  }
  for (const mem of groups.values()) {
    let y0 = Math.min(...mem.map(m => m.y0)), y1 = Math.max(...mem.map(m => m.y1));
    const s = mem[0].s;
    if (!isFinite(y0)) { y0 = s.logy ? 1e-3 : 0; y1 = 1; }
    if (s.logy) { y0 /= 1.3; y1 *= 1.3; } else { const pad = (y1 - y0) * 0.05 || Math.abs(y1) * 0.05 || 1; y0 -= pad; y1 += pad; }
    if (s.yview) { y0 = s.yview.y0; y1 = s.yview.y1; }
    if (s.ylim === "manual") { y0 = s.ymin ?? y0; y1 = s.ymax ?? y1; }
    if (s.ysym && !s.logy) { const h = Math.max(Math.abs(y0), Math.abs(y1)); y0 = -h; y1 = h; }   // ± (v5.12)
    for (const m of mem) { m.Y0 = y0; m.Y1 = y1; }
  }
  let redo = false;                                     // an outside legend changed width: draw once more
  // v11.1.1 (human 2026-11-10: "way more whitespace than necessary"): each plot's left margin from its y numbers and
  // title (not a fixed allowance); plots drawn together (a figure) take the widest, so their axes line up
  const needL = new Map();
  for (const it of items) {
    const { panel, sp, s } = it, fig = sp.fig;
    if (fig?.hideY || !Number.isFinite(it.Y0) || !Number.isFinite(it.Y1)) continue;
    const d = dprOf(sp);
    R.useStyle(s.fonts);
    const cssW = Math.max(120, sp.wrap.clientWidth - (fig ? 0 : 2)), refW = (fig ? fig.refW : cssW) * d;
    needL.set(panel.id, R.yAxisRoom(it.Y0, it.Y1, !!s.logy, Math.max(60 * d, refW * (s.aspect || 0.6) - (26 + 46) * d), d));
  }
  R.useStyle();
  if (items.length > 1 && needL.size) { const mx = Math.max(...needL.values()); for (const k of needL.keys()) needL.set(k, mx); }
  for (const it of items) {
    const { panel, sp, s, T, lines, slots, curves } = it;
    // v11.1: {dataset} in this plot's title, axis labels and tool labels = the datasets it draws, in order
    const tx = { dataset: [...new Set(curves.map(c => c.at?.run ?? c.src?.run?.name).filter(Boolean))].join(", ") || (runOf(panelRun(s, "1d")) ?? ""), t: R.fmt(S.t) };
    dpr = dprOf(sp);
    R.useStyle(s.fonts);                                  // v8.9.6: this plot's own text sizes
    setRunContext(panelRun(s, "1d"));                     // v8.10: {name} of a fit variable = this plot's dataset's
    const fig = sp.fig, m = margins1D(fig), M = { l: (needL.get(panel.id) ?? m.l) * dpr, r: m.r * dpr, t: m.t * dpr, b: m.b * dpr };   // v11.1.1: fitted left
    const thumb = !!sp.root?.closest?.(".thumb");          // v8.6: thumbnails (focus mode) are drawn without a legend
    const outside = !thumb && s.legendPos === "outside" && (s.legend || "compact") !== "off" && lines.length > 0;
    if (outside) M.r += ((sp.legendW ?? 120) + 8) * dpr;     // v6.3: the legend's width, measured at the last draw
    sp.renderedW = sp.wrap.clientWidth;
    const cssW = Math.max(120, sp.wrap.clientWidth - (fig ? 0 : 2)), cw = Math.round(cssW * dpr);
    // in a figure all plot areas get the same size (from the figure's cell width), so rows and columns line up
    const refW = (fig ? fig.refW : cssW) * dpr;
    const ch = Math.round(Math.max(60 * dpr, refW * (s.aspect || 0.6) - (26 + 46) * dpr) + M.t + M.b);
    if (sp.canvas.width !== cw || sp.canvas.height !== ch) { sp.canvas.width = cw; sp.canvas.height = ch; }
    sp.canvas.style.height = ch / dpr + "px"; sp.canvas.style.width = cw / dpr + "px";   // v8.9.8: shown at the size drawn (no stretch while a resize waits for this draw)
    const ctx = sp.canvas.getContext("2d");
    ctx.fillStyle = R.THEME.bg; ctx.fillRect(0, 0, cw, ch);
    const plot = { x: Math.round(M.l), y: Math.round(M.t), w: Math.round(cw - M.l - M.r), h: Math.round(ch - M.t - M.b) };
    let x0 = it.x0, x1 = it.x1;
    if (!isFinite(x0)) { x0 = 0; x1 = 1; }
    const ax = R.axis(x0, x1, plot.x, plot.x + plot.w, s.logx), ay = R.axis(it.Y1, it.Y0, plot.y, plot.y + plot.h, s.logy);
    ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
    if (it.Y0 < 0 && it.Y1 > 0 && !s.logy) { ctx.strokeStyle = R.THEME.zero; ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(plot.x, ay.to(0)); ctx.lineTo(plot.x + plot.w, ay.to(0)); ctx.stroke(); }
    // colours (v5.4, human 2026-10-05: "lists correlated with given colours"): a list line takes the colour of
    // each VALUE from its list variable, the same in every line and panel, and lines differ by line style;
    // otherwise a set colour (shaded per value if the line opted out), else the next free series colour
    const listOfLine = l => varOf((expansions(l, s.xaxis)[0] || {}).ref);
    let maxList = 0;
    for (const x of slots) if (followsListColors(x.l, x.sub)) maxList = Math.max(maxList, x.sub.n);
    const autoColor = new Map();
    let nextAuto = maxList;
    for (const x of slots) if (!followsListColors(x.l, x.sub) && !x.l.color) autoColor.set(x.key, R.SERIES_COLORS[nextAuto++ % 10]);
    // v8.18: a dataset list × another list: the dataset's colour, shaded per value of the other
    const inner = (c, sub) => (sub?.ik !== undefined ? R.shade(c, sub.ik, sub.in) : c);
    const madeCol = (l, sub) => (sub && madeKind(l)?.colour && (!l.color || madeKind(l).key === "lo") ? madeKind(l).colour(l, sub) : null);   // v14.5: unless the line has its own colour
    const colorOfSlot = (l, sub, key) => (madeCol(l, sub)   // v14.3: e.g. its lineout's colour (map line = curve); v14.5: tables, period plots
      || (followsListColors(l, sub) ? inner(listColor(listOfLine(l), sub.k), sub)
      : l.color ? (sub ? inner(R.shade(l.color, sub.k, sub.n), sub) : l.color) : autoColor.get(key)));
    const colorOf = l => { const x = slots.find(y => y.l === l); return x ? colorOfSlot(l, x.sub, x.key) : (l.color || R.SERIES_COLORS[0]); };
    // two lines following the same list with the same line style would look identical: the later one gets the
    // next free style, saved (so the legend editor shows what is drawn)
    const styles = new Map();
    let restyled = false;
    for (const l of lines) {
      const sub = expansions(l, s.xaxis)[0];
      if (!followsListColors(l, sub)) continue;
      const name = String(sub.ref), used = styles.get(name) || new Set(), d = l.dash || "solid";
      if (used.has(d)) { const free = Object.keys(R.DASHES).find(x => !used.has(x)); if (free) { l.dash = free; restyled = true; } }
      used.add(l.dash || "solid"); styles.set(name, used);
    }
    if (restyled) onAutoChange?.();
    const byKey = new Map(curves.map(c => [c.key, c]));
    const cw0 = curves.find(c => c.window);               // v14.1: a period tool's window, shaded (its sliding plots)
    if (cw0) {
      const A = ax.to(Math.max(cw0.window[0], Math.min(x0, x1))), B = ax.to(Math.min(cw0.window[1], Math.max(x0, x1)));
      if (Number.isFinite(A) && Number.isFinite(B)) { ctx.globalAlpha = 0.1; ctx.fillStyle = "#7a3fb0"; ctx.fillRect(Math.min(A, B), plot.y, Math.abs(B - A), plot.h); ctx.globalAlpha = 1; }
    }
    for (const c of curves) {
      c.display = ownLabel(c.line, c) ?? c.label;
      if (c.peak) R.drawPoint(ctx, plot, ax, ay, c.peak.x, c.peak.y, colorOfSlot(c.line, c.sub, c.key), 4.5, null, dpr);   // v14.1: the chosen peak
      if (c.isTab || c.markers) {                         // v14.0: a table's points (markers; joined if asked)
        const col = colorOfSlot(c.line, c.sub, c.key);
        if (c.line.joined) R.drawPolyline(ctx, c.xs, c.ys, ax, ay, col, num1(c.line.width, 1.2) * dpr, c.line.dash || "solid", dpr);
        for (let j = 0; j < c.xs.length; j++) R.drawPoint(ctx, plot, ax, ay, c.xs[j], c.ys[j], col, num1(c.line.size, 4), null, dpr);
        continue;
      }
      R.drawPolyline(ctx, c.xs, c.ys, ax, ay, colorOfSlot(c.line, c.sub, c.key), num1(c.line.width, 1.6) * dpr, c.line.dash || "solid", dpr);
    }
    ctx.restore();
    compactLabels(curves);                                // short curve names for the fit formulas
    const info = [], win = [Math.min(x0, x1), Math.max(x0, x1)];
    setViewContext({ x0: win[0], x1: win[1], y0: Math.min(it.Y0, it.Y1), y1: Math.max(it.Y0, it.Y1) });   // v8.12: view_x0 … for tools / fits
    for (const t of s.tools || []) {
      if (!t.visible) continue;
      if (t.type === "stepbands") {                       // v8.32: another tool's steps, each curve its own field line's
        const o = liveOutput(t.source);
        if (!o) { const m = `steps from another plot: there is no steps tool named "${t.source ?? "?"}"`; if (!it.errors.includes(m)) it.errors.push(m); continue; }
        if (o.x !== JSON.stringify([s.xaxis, s.xfn || ""])) { const m = `steps of ${t.source} are along "${o.xlabel}", not this plot's x`; if (!it.errors.includes(m)) it.errors.push(m); }
        ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
        for (const c of curves) {
          const oc = c.isFn ? null : outputCurve(o, c.at);
          if (!oc) continue;
          ctx.fillStyle = colorOfSlot(c.line, c.sub, c.key);
          for (const st of oc.steps) for (const [a, b, al] of [[st.x0, st.x1, t.whole !== false ? 0.1 : 0], [st.s10, st.s90, t.core !== false ? 0.22 : 0]]) {
            const X0 = ax.to(a), X1 = ax.to(b);
            if (!al || !Number.isFinite(X0) || !Number.isFinite(X1)) continue;
            ctx.globalAlpha = al; ctx.fillRect(Math.min(X0, X1), plot.y, Math.max(1, Math.abs(X1 - X0)), plot.h);
          }
        }
        ctx.globalAlpha = 1; ctx.restore();
        continue;
      }
      if (t.type === "steps") {                           // v8.29: steps shaded (light: widened, dark: 10–90 %), b dashed, b + kσ dotted
        const mine = it.toolSteps.filter(o => o.tid === t.id);
        ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
        if (t.shade !== false) for (const o of mine) {
          ctx.fillStyle = colorOfSlot(o.parent.line, o.parent.sub, o.parent.key);
          for (const st of o.r.steps) for (const [a, b, al] of [[st.x0, st.x1, 0.1], [st.s10, st.s90, 0.22]]) {
            const X0 = ax.to(a), X1 = ax.to(b);
            if (!Number.isFinite(X0) || !Number.isFinite(X1)) continue;
            ctx.globalAlpha = al; ctx.fillRect(Math.min(X0, X1), plot.y, Math.max(1, Math.abs(X1 - X0)), plot.h);
          }
        }
        ctx.globalAlpha = 1;
        for (const o of it.toolCurves.filter(o => o.tid === t.id))
          R.drawPolyline(ctx, o.curve.xs, o.curve.ys, ax, ay, colorOfSlot(o.parent.line, o.parent.sub, o.parent.key), num1(t.width, 1.1) * dpr, o.role === "thr" ? "dotted" : "dashed", dpr);
        ctx.restore();
        if (t.show !== false) for (const o of mine) {
          const name = (o.parent.subLabel || (ownLabel(o.parent.line, o.parent) ?? o.parent.compact ?? o.parent.label));
          // the three largest by excess ∫(curve − b) dx (their 10–90 % spans), largest first; the rest counted
          const st = o.r.steps, top = [...st].sort((p, q) => q.D - p.D).slice(0, 3);
          const list = top.map(x => `${R.fmt(x.s10)}–${R.fmt(x.s90)} (${R.fmt(x.D)})`).join(", ") + (st.length > top.length ? ` +${st.length - top.length}` : "");
          const flat = !(o.r.sigma > 0) ? " (the background follows the curve: widen its window)" : "";
          info.push({ color: colorOfSlot(o.parent.line, o.parent.sub, o.parent.key), tool: t,
            text: `${mine.length > 1 ? name + ": " : ""}σ = ${R.fmt(o.r.sigma)}${flat} · ${st.length ? `${st.length} step${st.length > 1 ? "s" : ""}, largest: ${list}` : "no steps"}` });
        }
        continue;
      }
      if (t.type === "mean" && t.along) {                 // v5.14: averaged along another axis
        ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
        for (const o of it.toolCurves.filter(o => o.tid === t.id))
          R.drawPolyline(ctx, o.curve.xs, o.curve.ys, ax, ay, t.curveColors !== false ? colorOfSlot(o.parent.line, o.parent.sub, o.parent.key) : t.color, num1(t.width, 1.2) * dpr, t.dash || "dashed", dpr);
        ctx.restore();
        continue;
      }
      // v14.1 (human 2026-11-13, the research session's cycle-period method, claude_work/lib/cycles.py): the period of each
      // curve inside the window (shaded), its regularity and number of cycles, and (curves on one time grid) their lags
      if (t.type === "period") {
        const mine = curves.filter(c => !c.isFn && (t.line == null || c.line.id === t.line));
        const [a, b] = overRange(s, t, win, T.x?.g), lo = Math.min(a, b), hi = Math.max(a, b), how = t.detrend || "linear";
        const X0 = ax.to(Math.max(lo, win[0])), X1 = ax.to(Math.min(hi, win[1]));
        if (Number.isFinite(X0) && Number.isFinite(X1)) {
          ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
          ctx.globalAlpha = 0.08; ctx.fillStyle = t.color || "#7a3fb0"; ctx.fillRect(Math.min(X0, X1), plot.y, Math.abs(X1 - X0), plot.h); ctx.restore();
        }
        const res = mine.map(c => {
          const [tw, yw] = CYC.window([...c.xs], [...c.ys], Number.isFinite(lo) ? lo : null, Number.isFinite(hi) ? hi : null);
          let r;
          try { r = tw.length >= 4 ? CYC.period(tw, yw, how) : null; } catch (e) { r = { period: NaN, regularity: NaN, n_cycles: NaN, ac: [], lag: [], note: String(e?.message || e) }; }
          return { c, tw, yw, r: r || { period: NaN, regularity: NaN, n_cycles: NaN, ac: [], lag: [], note: "fewer than 4 points in the window" } };
        });
        const n0 = res[0]?.tw.length, sameGrid = res.length > 1 && res.every(o => o.tw.length === n0 && o.tw.every((x, i) => Math.abs(x - res[0].tw[i]) <= 1e-9 * Math.max(1, Math.abs(x))));
        const L = sameGrid && n0 >= 4 ? CYC.lines(res[0].tw, res.map(o => o.yw), how, res.map(o => o.r.regularity), res.map(o => o.r.period)) : null;
        const vals = { win: [lo, hi], how, width: num1(t.width, 32), step: num1(t.step, 2), xaxis: s.xaxis, inPhase: L ? L.in_phase : NaN, ref: L ? L.ref : null,
          curves: res.map((o, k) => ({ label: o.c.label, display: o.c.display ?? o.c.label, at: o.c.at ? { run: o.c.at.run, d: { ...o.c.at.d } } : null, color: colorOfSlot(o.c.line, o.c.sub, o.c.key),
            period: o.r.period, regularity: o.r.regularity, n_cycles: o.r.n_cycles, note: o.r.note, candidate: o.r.candidate ?? null, lag: L ? L.lag[k] : NaN,
            ac: { x: o.r.lag, y: o.r.ac }, src: { xs: [...o.c.xs], ys: [...o.c.ys] } })) };
        vals.sig = JSON.stringify([vals.win, how, vals.width, vals.step, vals.curves.map(v => [v.label, v.period, v.regularity, v.lag, v.src.ys.length])]);
        setToolValues(panel.id, t.id, vals, vals.sig);    // v14.4: the plots made from it redraw when sig changes (change bus)
        if (t.show !== false) for (const v of vals.curves) info.push({ color: v.color, tool: t,
          text: `${mine.length > 1 ? v.display + ": " : ""}${Number.isFinite(v.period) ? `period ${R.fmt(v.period)} · regularity ${v.regularity.toFixed(2)} · ${R.fmt(v.n_cycles)} cycles` : "no clear cycle"}` });
        continue;
      }
      if (t.type === "mean" || t.type === "fit") {        // v5.13: one per curve of the chosen line(s), on the curves as drawn
        let mine = curves.filter(c => t.line == null || c.line.id === t.line).filter(c => t.type === "mean" || !c.isFn);
        // v14.0.1 (human 2026-11-13: no fit on a table plot, "they are of different datsets though"): a table line's points
        // are one curve per dataset (its colours); a fit or mean takes all of the line's points together
        if (mine.some(c => c.isTab)) {
          const merged = new Map();
          mine = mine.flatMap(c => {
            if (!c.isTab) return [c];
            const pts = [...c.xs].map((x, j) => [x, c.ys[j]]);
            if (merged.has(c.line.id)) { merged.get(c.line.id).pts.push(...pts); return []; }
            const m = { pts, c }; merged.set(c.line.id, m); return [m];
          }).map(o => {
            if (!o.pts) return o;
            o.pts.sort((u, v) => u[0] - v[0]);
            const name = tabLineText(o.c.line);
            return { ...o.c, xs: Float64Array.from(o.pts.map(q => q[0])), ys: Float64Array.from(o.pts.map(q => q[1])), sub: null, key: String(o.c.line.id),
              label: name, compact: name, subLabel: null, at: null, mergedTab: true };
          });
        }
        const [a, b] = overRange(s, t, win, T.x?.g), oneLine = new Set(mine.map(c => c.line.id)).size === 1;
        const tag = c => (mine.length < 2 ? "" : `${(oneLine && c.subLabel) || (ownLabel(c.line, c) ?? c.compact)}: `);   // what tells the fits apart
        const fv = [];                                    // v14.0: each curve's fit numbers (its card's "→ table")
        for (const c of mine) {
          const col = c.mergedTab ? c.line.color || t.color : t.curveColors !== false ? colorOfSlot(c.line, c.sub, c.key) : t.color;   // v14.0.1
          if (t.type === "mean") {
            const m = meanOf(c.xs, c.ys, a, b);
            R.drawRule(ctx, plot, ay, m, false, col, num1(t.width, 1.2), t.dash || "dashed", dpr);
            if (t.label) R.drawRuleLabel(ctx, plot, ay, m, false, col, subVars(t.label, tx), dpr);
            continue;
          }
          const fr = fitCurve(c.xs, c.ys, t.model || "poly", num1(t.degree, 2), a, b, T.x ? T.x.tex : s.xaxis === "time" ? "t" : "x", { tau: t.expShow === "tau" });
          if (fr.error) { if (!it.errors.includes(`fit: ${fr.error}`)) it.errors.push(`fit: ${fr.error}`); continue; }
          fv.push({ label: c.label, at: c.at ? { run: c.at.run, d: { ...c.at.d } } : null, params: fr.params, x0: fr.x0, x1: fr.x1 });
          const lo = Math.max(fr.x0, win[0]), hi = Math.min(fr.x1, win[1]), n = 200, lg = s.logx && lo > 0;
          const FX = new Float64Array(n), FY = new Float64Array(n);
          for (let j = 0; j < n; j++) { const x = lg ? lo * Math.pow(hi / lo, j / (n - 1)) : lo + ((hi - lo) * j) / (n - 1); FX[j] = x; FY[j] = fr.f(x); }
          ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
          R.drawPolyline(ctx, FX, FY, ax, ay, col, num1(t.width, 1.4) * dpr, t.dash || "dashed", dpr);
          ctx.restore();
          if (t.show !== false) {
            // v8.11: its own label ({c} = the curve's name; empty = automatic), R² and the fitted x range on / off
            const cname = (oneLine && c.subLabel) || (ownLabel(c.line, c) ?? c.compact);
            const pre = t.label ? subVars(String(t.label).replace(/\{c\}/g, cname), tx) + " " : tag(c);
            const xn = T.x ? T.x.label : s.xaxis === "time" ? "t" : axisInfo(s.xaxis).label;
            info.push({ color: col, tool: t, text: pre + fr.text + (t.showR2 !== false ? `   R² = ${fr.r2.toFixed(3)}` : "")
              + (t.showRange ? `   (${xn} ${R.fmt(fr.x0)}–${R.fmt(fr.x1)})` : "") });
          }
        }
        if (t.type === "fit") setToolValues(panel.id, t.id, fv);
        continue;
      }
      // v12.0 (draw): a line or a point read off each curve (mean, max, min, x at the max, a crossing), its values kept
      // for its card (TOOL_VALUES; v12.2: "→ variable" there makes a measured variable of the same reading)
      if ((t.type === "line" || t.type === "point") && t.mode === "data") {
        const stat = t.stat || (t.type === "point" ? "max" : t.orient === "h" ? "mean" : "xmax");
        const mine = curves.filter(c => !c.isFn && (t.line == null || c.line.id === t.line));
        const [a, b] = overRange(s, t, win, T.x?.g), vals = [];
        for (const c of mine) {
          const r = curveStat(c.xs, c.ys, stat, a, b, num1(t.at, 0));
          if (!r) continue;
          const col = t.curveColors !== false ? colorOfSlot(c.line, c.sub, c.key) : t.color;
          const v = t.type === "point" ? r.y : t.orient === "h" ? r.y : r.x;
          if (t.type === "point") R.drawPoint(ctx, plot, ax, ay, r.x, r.y, col, num1(t.size, 5), toolLabel(t, r.y, tx), dpr);
          else R.drawToolRule(ctx, plot, t.orient === "v" ? ax : ay, v, t.orient === "v", col, num1(t.width, 1.2), t.dash || "dashed", { label: toolLabel(t, v, tx) }, dpr);   // v14.5.1: {v} filled
          vals.push({ label: c.label, at: c.at ? { run: c.at.run, d: { ...c.at.d } } : null, value: v, x: r.x, y: r.y });
        }
        setToolValues(panel.id, t.id, vals);
        continue;
      }
      if (t.type === "band") {                            // v12.0: a band between two values (variables / lists: the first)
        const vert = t.orient !== "h", lo = num1(t.lo, NaN), hi = num1(t.hi, NaN);
        R.drawBand(ctx, plot, vert ? ax : ay, lo, hi, vert, t.color, num1(t.alpha, 0.15), dpr);
        if (t.label) R.drawRuleLabel(ctx, plot, vert ? ax : ay, Math.min(lo, hi), vert, t.color, subVars(t.label, tx), dpr);
        continue;
      }
      if (t.type === "point") {                           // v12.0: a point at x, y (lists: one point per pair)
        const xs = listOf(t.x), ys = listOf(t.y), n = Math.max(xs.length, ys.length);
        for (let k = 0; k < n; k++) R.drawPoint(ctx, plot, ax, ay, xs[Math.min(k, xs.length - 1)], ys[Math.min(k, ys.length - 1)], t.color, num1(t.size, 5), toolLabel(t, ys[Math.min(k, ys.length - 1)], tx), dpr);   // v14.5.1: {v} = its y, as its card says
        continue;
      }
      // v8.17: on a time axis with a function the slider's time is drawn where it lands (typed positions are as drawn)
      const atT = v => (T.x && s.xaxis === "time" ? T.x.g(v) : v);
      if (t.type === "line" && !(t.mode === "time" && s.xaxis !== "time")) for (const [v0, col] of toolRules(t)) {   // v14.5.1: a line at the slider's time only on a time axis
        const v = t.mode === "time" ? atT(v0) : v0;
        const vert = t.mode === "time" || t.orient === "v";        // (at the slider's time: always across the time axis, x here)
        R.drawToolRule(ctx, plot, vert ? ax : ay, v, vert, col, num1(t.width, 1.2), t.dash, { label: toolLabel(t, v0, tx) }, dpr);   // v14.5.1: {v} = its value
      }
    }
    // v9.0 / v15.0: curves still being computed say how far they are (c.progress = [done, of], c.progressLabel), and a
    // made curve's own warning (c.warn) goes with the errors
    const busy = curves.filter(c => c.progress && c.progress[0] < c.progress[1]), byLab = new Map();
    for (const c of busy) { const k = c.progressLabel || "curves"; byLab.set(k, [Math.min(byLab.get(k)?.[0] ?? Infinity, c.progress[0]), c.progress[1]]); }
    const busyNotes = [...byLab].map(([k, [d, n]]) => `${k}: ${d} of ${n} outputs computed…`);
    R.drawNote(ctx, plot, [...new Set(it.followSrcs.map(src => outsideNote(src, S.t)).filter(Boolean)), ...busyNotes], dpr);   // v5.12: runs that ended
    for (const c of curves) if (c.warn) { const w = `${c.progressLabel ? c.progressLabel + ": " : ""}${c.warn}`; if (!it.errors.includes(w)) it.errors.push(w); }
    const infoHits = thumb ? [] : R.drawInfo(ctx, plot, info, dpr, s.infoPos ?? null);   // v5.13 fit formulas; v8.11 placed like the legend
    const lab = s.labels || {}, units = curves.find(c => c.src)?.src.units ?? curves.find(c => c.yunits)?.yunits;   // v9.0: a made curve's units (foot gaps …)
    // the scale goes in the y label: "|twist angle| ÷ max twist angle (drive)" when all curves share it, else "(scaled)"
    const real = new Set(curves.map(c => c.scaleNote).filter(n => n && !n.startsWith("(not scaled")));
    const ynote = real.size === 1 ? ` ${[...real][0]}` : real.size ? " (scaled)" : "", yname = (s.abs ? "|" : "") + (s.ykind || "value") + (s.abs ? "|" : "");
    // v8.30: a slope / rate plot: "slope of potential (−d/dx, w = 0.5) [per R_*]" — its units per x / per time
    const sk = splitKind(s.ykind), slopeNotes = new Set(curves.map(c => c.slopeNote).filter(Boolean));
    const snote = slopeNotes.size === 1 ? ` ${[...slopeNotes][0]}` : "", xu = T.x ? null : axisInfo(s.xaxis).units || null;
    const yunits = sk.mode === "slope" ? (xu ? (units ? `${units} / ${xu}` : `per ${xu}`) : units ? `${units} per x` : "")
      : sk.mode === "rate" ? (units ? `${units} per R_*/c` : "per R_*/c") : units;
    const auto = {
      title: panel.name || (s.ykind ? `${s.ykind} vs ${T.x ? T.x.label : axisInfo(s.xaxis).label}` : "1D plot"),
      xlabel: T.x ? T.x.label : axisLabel(s.xaxis),                     // v8.17: "1/r_max" (no units)
      ylabel: T.y ? nameIn(T.y.text, "y", yname + ynote + snote) : yname + snote + (ynote || (yunits ? ` [${yunits}]` : "")),
    };
    if (it.follows) auto.title += ` · t = ${R.fmt(it.follows.src.times[it.follows.tFixed])}`;
    const hits = R.drawAxes(ctx, plot, ax, ay, {
      dpr, xlabel: subVars(lab.xlabel, tx) ?? auto.xlabel, ylabel: subVars(lab.ylabel, tx) ?? auto.ylabel, title: subVars(panel.title, tx) ?? auto.title,
      edited: { xlabel: lab.xlabel != null, ylabel: lab.ylabel != null, title: panel.title != null },
      hideX: !!fig?.hideX, hideY: !!fig?.hideY,
    });
    // legend: every line (hidden ones greyed), always shown so lines can be edited from it
    // legend (v5.9): "compact" = only what differs between curves (common parts as a grey heading); lines that
    // follow one list with list colours get a two-part legend: one entry per VALUE (colour) + one per LINE (style)
    const mode = thumb ? "off" : s.legend || "compact", common = compactLabels(curves);
    const auto0 = (l, c) => c?.label ?? lineName(l);   // v14.3.2: the one shared line name (lines.js)
    const oneRun = l => (isFn(l) || isAn(l) || isRunList(l.run) ? null : runOf(l.run));     // v8.19: an entry's dataset (its hover)
    const own = l => ownLabel(l, null);
    let entries, header = null;
    const listLines = lines.filter(l => followsListColors(l, expansions(l, s.xaxis)[0]));
    const refs = new Set(listLines.map(l => String(expansions(l, s.xaxis)[0].ref)));
    if (mode === "compact" && listLines.length && refs.size === 1 && slots.length > listLines.length + expansions(listLines[0], s.xaxis).length) {
      const l0 = listLines[0], firstCurve = l => curves.find(c => c.line === l);
      // v8.18: one entry per value of the list (a dataset list: per dataset); a click opens that value (its colour, the
      // lines that use it), not a line
      const values = expansions(l0, s.xaxis).filter(sub => !sub.ik).map(sub => {
        const c = byKey.get(slotKey(l0, sub));
        return { label: sub.run ?? c?.subLabel ?? R.fmt(sub.value ?? sub.time), auto: auto0(l0, c), color: listColor(listOfLine(l0), sub.k), dash: "solid", width: 2,
          value: { ref: String(sub.ref), k: sub.k, label: sub.run ?? c?.subLabel ?? R.fmt(sub.value ?? sub.time) }, run: sub.run ?? oneRun(l0) };
      });
      const lineEntries = lines.map(l => {
        const c = firstCurve(l), lk = c?.listKey;
        const lab = own(l) ?? (c ? c.varying.filter(([k]) => k !== lk).map(x => x[1]).join(" · ") || c.keyed[0][1] : auto0(l, c));
        const inList = listLines.includes(l);
        return { label: lab, auto: auto0(l, c), color: l.visible === false || !c ? "#bbbbbb" : inList ? "#555555" : colorOf(l),
                 dash: l.dash || "solid", width: num1(l.width, 1.6), edited: l.label != null, line: l, sep: l === lines[0], run: inList ? null : oneRun(l) };
      });
      entries = [...values, ...lineEntries];
    } else {
      // one line following a list: the values are the entries, the line's own label (if any) is the heading
      const single = mode === "compact" && lines.length === 1 && slots.length > 1;
      entries = slots.map(({ l, sub, key }) => {
        const c = byKey.get(key), o = ownLabel(l, c), hasV = /\{v\}/.test(l.label || "");
        let lab;
        if (o != null && (hasV || !sub)) lab = o;                                  // as typed ({v} filled in)
        else if (o != null) lab = single ? c?.subLabel : `${o} · ${c?.subLabel}`;   // must still tell the curves apart
        else lab = mode === "full" ? c?.label : single ? c?.subLabel : c?.compact;
        return { label: lab ?? auto0(l, c), auto: auto0(l, c), color: l.visible === false || !c ? "#bbbbbb" : colorOfSlot(l, sub, key),
                 dash: l.dash || "solid", width: num1(l.width, 1.6), edited: l.label != null, line: l, run: sub?.run ?? oneRun(l) };
      });
      if (single && own(lines[0]) != null && !/\{v\}/.test(lines[0].label || "")) header = [own(lines[0]), ...common.filter(x => !curves.some(c => c.subLabel === x))].join(" · ");
    }
    if (mode === "compact" && entries.length > 1 && common.length && header === null) header = common.join(" · ");
    for (const t of s.tools || []) if (t.visible && t.type === "mean" && t.along && it.toolCurves.some(o => o.tid === t.id))
      entries.push({ label: t.label ? subVars(t.label, tx) : `mean over ${t.along === "time" ? "t" : axisInfo(t.along).label}`, color: "#555555",
        dash: t.dash || "dashed", width: num1(t.width, 1.2), sep: true, tool: t });
    for (const c of curves) if (c.line.label == null && mode === "compact") c.display = c.compact;
    hits.info = infoHits;
    hits.legend = mode === "off" ? [] : R.drawLegend(ctx, plot, entries, dpr, header, s.legendPos ?? null);
    if (outside && hits.legend.box && Math.abs(hits.legend.box.w / dpr - (sp.legendW ?? 120)) > 1) { sp.legendW = hits.legend.box.w / dpr; redo = true; }
    sp.last = { kind: "line", plot, ax, ay, curves, entries, hits, auto, s, T, colorOf, info, toolCurves: it.toolCurves, plotHcss: plot.h / dpr, refWcss: fig ? fig.refW : sp.wrap.clientWidth - 2 };
    // v11.4: a line whose dataset can compute its quantity gets a "compute" box (one per dataset), not the error text
    const nc = it.errors.map(m => /^(\S+) is not cached for ([^:\s]+)/.exec(m)).filter(Boolean);
    const can = nc.filter(([, q, r]) => canCompute(r, q) || jobFor(r, q)), canMsg = new Set(can.map(c => c.input));
    const shown = it.errors.filter(m => !canMsg.has(m));
    sp.status.textContent = shown.length ? `⚠ ${shown.join("; ")}` : can.length ? "" : (lines.length ? "click the legend to edit a line (drag it to move it), the axes or their labels to set them" : "no lines yet — press “+ line” in the header");
    const other = nc.find(c => !canMsg.has(c.input));
    if (other) sp.status.append(" · ", dmLink(other[1], other[2]));
    const byRun = new Map();
    for (const [, q, r] of can) { if (!byRun.has(r)) byRun.set(r, []); if (!byRun.get(r).includes(q)) byRun.get(r).push(q); }
    for (const [r, qs] of byRun) sp.status.append(sp.status.childNodes.length ? " " : "", computeBox(r, qs));
  }
  R.useStyle(); setRunContext(null); setViewContext(null);
  return redo;
}

// ---- interaction ---------------------------------------------------------------------------------------------
function devPos(c, e) { const b = c.getBoundingClientRect(), d = c.width / b.width; return [(e.clientX - b.left) * d, (e.clientY - b.top) * d]; }

const inside = (r, x, y) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
function zoomRange(a0, a1, c, f, log) {
  const T = log ? Math.log10 : x => x, Ti = log ? x => 10 ** x : x => x;
  return [Ti(T(c) + (T(a0) - T(c)) * f), Ti(T(c) + (T(a1) - T(c)) * f)];
}

export function attach1D(panel, sp, api) {
  const c = sp.canvas, I = () => ctxPanel(panel);
  c.addEventListener("wheel", e => {
    const l = sp.last; if (!l) return;
    if (e.ctrlKey) return;                               // v8: Ctrl + wheel / pinch = panel size (app.js)
    const [x, y] = devPos(c, e); if (!inside(l.plot, x, y)) return;
    const f = wheelFactor(e, e.shiftKey);
    if (f === 1) return;
    e.preventDefault();
    if (e.shiftKey) {                                  // v8.1: the y range itself (as typing it), not a second "y zoom"
      const lo = Math.min(l.ay.v0, l.ay.v1), hi = Math.max(l.ay.v0, l.ay.v1);
      let [a, b] = zoomRange(lo, hi, l.ay.from(y), f, l.ay.log);
      if (I().get("ysym")) { const m = Math.max(Math.abs(a), Math.abs(b)); [a, b] = [-m, m]; }
      const c = I(); c.set("ylim", "manual"); c.set("ymin", a); c.set("ymax", b); c.set("yview", null);
    }
    else { const [a, b] = zoomRange(l.ax.v0, l.ax.v1, l.ax.from(x), f, l.ax.log); I().set("view", { x0: a, x1: b }); }
    api.changed(panel, false);
  }, { passive: false });
  let drag = null;
  c.addEventListener("mousedown", e => {
    if (!sp.last) return;
    const p = devPos(c, e), box = sp.last.hits.legend?.box, ib = sp.last.hits.info?.box, onLegend = !!box && inside(box, ...p);
    drag = { start: p, pos: p, x0: sp.last.ax.v0, x1: sp.last.ax.v1, y0: sp.last.ay.v0, y1: sp.last.ay.v1, moved: false,
      legend: onLegend ? { dx: p[0] - box.x, dy: p[1] - box.y, w: box.w, h: box.h } : null,
      info: !onLegend && ib && inside(ib, ...p) ? { dx: p[0] - ib.x, dy: p[1] - ib.y, w: ib.w, h: ib.h } : null };   // v8.11
  });
  window.addEventListener("mouseup", e => {      // (removed with the panel: sp.ac, v5.2)
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved || !sp.last) return;
    const [x, y] = d.start, l = sp.last;
    const legend = (l.hits.legend || []).find(h => inside(h, x, y));
    if (legend) {
      const en = legend.entry;
      if (en.value) openListValue(panel, en.value, e.clientX, e.clientY, api);                        // v8.18: a list's value
      else if (en.line) openEditLine(panel, en.line.id, e.clientX, e.clientY, api, l.colorOf(en.line), en.auto);
      return;
    }
    const fitText = (l.hits.info || []).find(h => inside(h, x, y));                 // v8.11: a fit's text opens that fit
    if (fitText) return api.quick(panel, `fit:${fitText.item.tool.id}`, e.clientX, e.clientY);
    // v8: an axis's label or its numbers open that axis's settings (axis, range, log, label)
    if (inside(l.hits.xlabel, x, y) || inside(l.hits.xaxis, x, y)) return api.quick(panel, "x", e.clientX, e.clientY);
    if (inside(l.hits.ylabel, x, y) || inside(l.hits.yaxis, x, y)) return api.quick(panel, "y", e.clientX, e.clientY);
    if (inside(l.hits.title, x, y)) {
      const inp = el("input", { type: "text", size: 30, value: panel.title ?? l.auto.title });
      inp.addEventListener("input", () => { panel.title = inp.value === l.auto.title || inp.value === "" ? null : inp.value; api.changed(panel, false); });
      inp.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === "Escape") closePopover(); });
      popover(e.clientX, e.clientY, [el("div", { class: "pop-title" }, "title"), inp,
        el("div", { class: "pop-row" }, fontSize(I(), "title", () => api.changed(panel, false))),
        el("div", { class: "pop-row" }, el("button", { onclick: () => { panel.title = null; inp.value = l.auto.title; api.changed(panel, false); } }, "↺ automatic"), el("button", { onclick: closePopover }, "done"))]);
    } else if (inside(l.plot, x, y)) api.cursor?.(panel, l.ax.from(x), l.ay.from(y));    // v11.0: click sets (if on)
  }, { signal: sp.ac?.signal });
  c.addEventListener("mousemove", e => {
    const l = sp.last; if (!l) return;
    const [x, y] = devPos(c, e);
    if (drag) {
      if (Math.hypot(x - drag.start[0], y - drag.start[1]) > 3) drag.moved = true;
      if (!drag.moved) return;
      if (drag.legend) { I().set("legendPos", legendDrop(l.plot, drag.legend, x, y, c.width / c.getBoundingClientRect().width)); api.changed(panel, false); return; }
      if (drag.info) { I().set("infoPos", legendDrop(l.plot, drag.info, x, y, c.width / c.getBoundingClientRect().width, false)); api.changed(panel, false); return; }
      // v8.9.5: a drag moves the axes whose drag is on (x by default; y when chosen; both = like a map)
      const ic = I(), dx = ic.get("xdrag") !== false, dy = ic.get("ydrag") === true && !ic.get("ysym");
      if (!dx && !dy) return;
      const shift = (a, from, to, v0, v1) => { const k = a.log ? a.from(from) / a.from(to) : a.from(from) - a.from(to); return a.log ? [v0 * k, v1 * k] : [v0 + k, v1 + k]; };
      if (dx) { [drag.x0, drag.x1] = shift(l.ax, drag.pos[0], x, drag.x0, drag.x1); ic.set("view", { x0: drag.x0, x1: drag.x1 }); }
      if (dy) {
        [drag.y0, drag.y1] = shift(l.ay, drag.pos[1], y, drag.y0, drag.y1);
        ic.set("ylim", "manual"); ic.set("ymin", Math.min(drag.y0, drag.y1)); ic.set("ymax", Math.max(drag.y0, drag.y1)); ic.set("yview", null);
      }
      drag.pos = [x, y];
      api.changed(panel, false);
      return;
    }
    const overText = [l.hits.title, l.hits.xlabel, l.hits.ylabel, l.hits.xaxis, l.hits.yaxis, ...(l.hits.legend || []), ...(l.hits.info || [])].some(r => inside(r, x, y));
    const overLegend = inside(l.hits.legend?.box, x, y), overInfo = !overLegend && inside(l.hits.info?.box, x, y);
    c.style.cursor = overLegend || overInfo ? "move" : overText ? "pointer" : "crosshair";
    // v8.19 (human 2026-11-03: "when I hover over dataset it says whats what"): a legend entry's dataset
    const enRun = overLegend ? (l.hits.legend || []).find(h => inside(h, x, y))?.entry?.run : null;
    tipAt(e.clientX, e.clientY, enRun ? runTip(enRun) : null);
    if (overLegend) { sp.status.textContent = "click an entry: a line opens its settings (and what it is drawn for), a list's colour opens that value (and the lines that use it) · drag to move the legend (it snaps to corners and edges; right of the plot = outside) · double-click: back to the top right"; return; }
    if (overInfo) { sp.status.textContent = "click a fit's text to edit that fit (label, R², range, size) · drag to move the text (it snaps to corners and edges) · double-click: back to the upper left"; return; }
    if (!inside(l.plot, x, y)) {
      sp.status.textContent = inside(l.hits.xaxis, x, y) || inside(l.hits.xlabel, x, y) ? "click: x axis, range, log, label"
        : inside(l.hits.yaxis, x, y) || inside(l.hits.ylabel, x, y) ? "click: y axis, range, log, label" : overText ? "click to edit" : "";
      return;
    }
    // v14.0: a table point under the mouse: its whole row
    const tabs = (l.curves || []).filter(cv => cv.isTab);
    if (tabs.length) {
      const r2 = (8 * (c.width / (c.clientWidth || c.width || 1))) ** 2;
      let best = null, bd = r2;
      for (const cv of tabs) for (let j = 0; j < cv.xs.length; j++) {
        const d2 = (l.ax.to(cv.xs[j]) - x) ** 2 + (l.ay.to(cv.ys[j]) - y) ** 2;
        if (d2 < bd) { bd = d2; best = { cv, j }; }
      }
      if (best) { const txt = rowText(tableOf(best.cv.table), best.cv.rows[best.j]); tipAt(e.clientX, e.clientY, txt); sp.status.textContent = txt; return; }
    }
    const X = l.ax.from(x), Tx = l.T?.x;
    // v8.17: on an axis with a function, what it shows and the axis's own x of the nearest point of the first curve
    const j0 = Tx && l.curves[0]?.x0s ? indexer(l.curves[0].xs)(X) : -1;
    sp.status.textContent = (Tx ? `${Tx.label} = ${R.fmt(X)}${j0 >= 0 ? ` (${axisInfo(l.s.xaxis).label} ≈ ${R.fmt(l.curves[0].x0s[j0])})` : ""}   ` : `x = ${R.fmt(X)}   `) + l.curves.map(cv => {
      const j = indexer(cv.xs)(X);
      return `${cv.display ?? cv.label}: ${j >= 0 && isFinite(cv.ys[j]) ? cv.ys[j].toPrecision(4) : "—"}`;
    }).join("   ");
  });
  c.addEventListener("dblclick", e => {
    if (inside(sp.last?.hits.legend?.box, ...devPos(c, e))) { I().set("legendPos", null); api.changed(panel, false); return; }
    if (inside(sp.last?.hits.info?.box, ...devPos(c, e))) { I().set("infoPos", null); api.changed(panel, false); return; }
    const ic = I(); ic.set("view", null); ic.set("yview", null); ic.set("ylim", "auto"); api.changed(panel, false);   // (v8.9.3: was `c`, which hid the canvas: every double-click threw)
  });
}

/** Where a dragged legend lands (v6.3): its box follows the mouse inside the plot, as fractions of the free space
 *  ({fx, fy}), snapping to the corners, edge middles and centre within 10 px; with the mouse right of the plot it
 *  goes outside. leg = {dx, dy, w, h}: where the box was grabbed and its size (device px); d = device px per CSS px. */
export function legendDrop(plot, leg, x, y, d, outside = true) {
  if (outside && x > plot.x + plot.w + 4 * d) return "outside";
  const pad = R.LEGEND_PAD * d, fw = Math.max(1, plot.w - leg.w - 2 * pad), fh = Math.max(1, plot.h - leg.h - 2 * pad);
  const snap = (f, free) => { for (const t of [0, 0.5, 1]) if (Math.abs(f - t) * free < 10 * d) return t; return Math.round(f * 1000) / 1000; };
  const clamp = v => Math.min(1, Math.max(0, v));
  return { fx: snap(clamp((x - leg.dx - plot.x - pad) / fw), fw), fy: snap(clamp((y - leg.dy - plot.y - pad) / fh), fh) };
}
/** The named legend positions of the settings menu (v6.3) and which one a stored position is. */
export const LEGEND_SPOTS = [["ur", "upper right", 1, 0], ["ul", "upper left", 0, 0], ["lr", "lower right", 1, 1], ["ll", "lower left", 0, 1],
  ["uc", "top centre", 0.5, 0], ["lc", "bottom centre", 0.5, 1], ["cl", "middle left", 0, 0.5], ["cr", "middle right", 1, 0.5], ["cc", "centre", 0.5, 0.5]];
export function legendSpot(pos) {
  if (pos === "outside") return "outside";
  const fx = pos?.fx ?? 1, fy = pos?.fy ?? 0, hit = LEGEND_SPOTS.find(([, , x, y]) => x === fx && y === fy);
  return hit ? hit[0] : "custom";
}
