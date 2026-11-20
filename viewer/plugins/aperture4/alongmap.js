// alongmap.js (aperture4 plugin, v15.1; was js/panel2d.js, DECISIONS D20) — maps of along-line data, drawn through the
// core's data-kind hooks in panel2d.js render2D (mapAxes, mapTimes, mapYRange, mapLoad, mapPrepare, mapView, mapPaint,
// mapLabels), and the series a lineout of such a map reads (alongSeriesAt).
//
// ---- along-line maps (v10.2; v11.0 kinds B and C) --------------------------------------------------------------
// Human 2026-11-10 (relayed): "can we have that option of spacetime where there may be some choice"; "it would fit best
// in the normal 2D"; "I want the first draw to not take forever"; then linked slices, "just do it all as v11". A quantity
// stored at a field line's own points (`along.*`) as a map of two of: time, r_max (each line), a position along the
// line (s, s/s_max, s from the south foot) —
//   A  position × time  : one line (r_max: the slice) at every output (serve.py api/rows: that line of every output)
//   B  position × r_max : every line at one output (time: the slice, as any map; that output's frames)
//   C  time × r_max     : every line at every output, read at one position ("at"; serve.py api/window)
// Each curve (a line at an output) is its 1D curve: its own points and s, smoothed along the position and sloped with
// the 1D code. A pixel shows the mean of the curve's points inside it, else the curve at its centre (A, B); in C each
// cell is the curve at the position.
import * as R from "../../js/render.js";
import { S, dimCoord, pickIndex, num1, numOf, axisLabel, isRef } from "../../js/model.js";
import { smoothAlong, slopeAlong, normSmooth } from "../../js/panel1d.js";
import { ALONG_AXES, ALONG_POS, alongS, alongKind, lineWindow, lineWindowCached } from "./alongdata.js";

const POS_LABEL = { s_norm: "s/s_max (N→S)" };
const posLabel = d => POS_LABEL[d] ?? axisLabel(d);
const axLabel = d => (d === "time" || d === "r_max" ? axisLabel(d) : posLabel(d));
const fmtV = v => (isRef(v) ? v.slice(1) : R.fmt(Number(v)));
const AT_NAME = { s: "s", s_norm: "s/s_max", s_south: "s from the south foot" };

/** The map's two axes: time and one position along the line, or r_max and a position, or r_max and time (alongKind). */
export const mapAxes = s => (alongKind(s.xdim, s.ydim) ? [s.xdim, s.ydim] : ["s", "time"]);
/** Which outputs it needs (as panel2d's timesNeeded): B = the one at the slider (or fixed); A and C read their own data. */
export function mapTimes(s, src, xd, yd) {
  const kind = alongKind(xd, yd);
  if (kind !== "B") return { list: [], fixed: 0, axis: true, along: kind };
  const ft = numOf(s.fixedTime), i = s.timeMode === "fixed" ? src.indexAt(isFinite(ft) && ft !== null ? ft : src.times.at(-1)) : src.indexAt(S.t);
  return { list: [i], fixed: i, axis: false, along: "B" };      // every line at one output
}
/** The y range before the data are read (the left margin): time or r_max cells; a position: null (from the data). */
export const mapYRange = (s, src, xd, yd) => (yd === "time" ? cells(src.times, false) : yd === "r_max" ? cells(dimCoord(src, "r_max").values, !!s.logy) : null);

async function alongRows(src, s) {
  const ri = pickIndex(src, "r_max", s.picks?.r_max), sSrc = alongS(src);
  if (!sSrc) throw new Error(`${src.label}: this dataset has no along.s`);
  const [Q, Sv] = await Promise.all([src.lineRows(ri), sSrc === src ? null : sSrc.lineRows(ri)]);
  return { ri, Q, S: Sv ?? Q, sSrc };
}
/** C's position: {pos, p (a number), raw (as set: a number or a variable)}. */
function alongAt(s) {
  const a = s.at || {};
  return { pos: ALONG_POS.includes(a.pos) ? a.pos : "s", p: num1(a.v, 0.3), raw: a.v ?? 0.3 };
}
/** How far around C's position each curve is needed: its smoothing ± h and half its slope window, plus a few points. */
function alongMargin(s, pos) {
  const sm = normSmooth(s.smooth, false), sl = s.slope?.sign ? s.slope : null;
  const m = (sm ? num1(sm.h, Infinity) : 0) + (sl ? num1(sl.w ?? 0.5, Infinity) / 2 : 0) + (pos === "s_norm" ? 0.004 : 0.03);
  return Number.isFinite(m) ? Number(m.toPrecision(6)) : 1e9;
}
/** The 1D operations as text (title, colour bar). */
function opsOf(s, pos) {
  const sm = normSmooth(s.smooth, false), sl = s.slope?.sign ? s.slope : null;
  const d = pos === "s_norm" ? "d/d(s/s_max)" : "d/ds";
  return { sm, sl, ops: [sm ? `${sm.kind === "median" ? "median" : "mean"} over ±${fmtV(sm.h)}` : null, sl ? `${Number(sl.sign) < 0 ? "−" : ""}${d} over ${fmtV(sl.w ?? 0.5)}` : null].filter(Boolean),
    opD: sl ? `${Number(sl.sign) < 0 ? "−" : ""}${d}` : null };
}
/** Values of the variables an operation follows (part of the memo key). */
const varVals = (...vs) => vs.map(v => (isRef(v) ? [v, S.vars?.[v.slice(1)]?.value ?? null] : v));
/** One curve as drawn: points (s from Sv[sOff …], values from Qv[qOff …]; up to the first missing s) moved to the
 *  position axis, smoothed and sloped as a 1D line: {X (rising), Y, L} or null. */
function curveRow(Sv, sOff, Qv, qOff, n, mode, pos, s, sl, at) {
  let m = 0;
  while (m < n && Number.isFinite(Sv[sOff + m])) m++;
  if (m < 2) return null;
  const L = Sv[sOff + m - 1];
  const c = { line: { smooth: s.smooth ?? undefined, slope: sl ?? undefined }, sLen: L, at, keyed: [], label: "",
    xs: Float64Array.from(Sv.subarray(sOff, sOff + m), v => (mode === "s" ? v : mode === "norm" ? v / L : L - v)), ys: Float64Array.from(Qv.subarray(qOff, qOff + m)) };
  smoothAlong(c, { xaxis: pos });
  slopeAlong(c);
  const idx = [];
  for (let j = 0; j < m; j++) if (Number.isFinite(c.xs[j]) && Number.isFinite(c.ys[j])) idx.push(j);
  if (idx.length < 2) return null;
  idx.sort((u, v) => c.xs[u] - c.xs[v]);
  return { X: Float64Array.from(idx, j => c.xs[j]), Y: Float64Array.from(idx, j => c.ys[j]), L };
}

/** Start reading the map's data (render2D, before any wait): {wait, note} — note = what the plot says while loading. */
export function mapLoad(it) {
  const { s, src, need } = it, kind = it.kind = need.along, sSrc = alongS(src), fail = e => { it.err = String(e?.message || e); };
  if (!sSrc) { it.err = `${src.label}: this dataset has no along.s`; return {}; }
  if (kind === "A") {                                   // one line at every output, in one request
    it.missing = !src.lineRowsCached(pickIndex(src, "r_max", s.picks?.r_max));
    return { wait: alongRows(src, s).then(r => { it.rows = r; }, fail), note: it.missing ? "loading this field line at every output …" : null };
  }
  if (kind === "B") {                                   // every line at one output: that output's frames
    const i = need.fixed, j = sSrc.stepIndex.get(src.steps[i]);
    if (j === undefined) { it.err = `${sSrc.label} has no output at t = ${R.fmt(src.times[i])}`; return {}; }
    it.missing = !src.isCached(i) || !sSrc.isCached(j);
    return { wait: Promise.all([src.frame(i), sSrc.frame(j)]).then(([Q, Sv]) => { it.frame = { Q, S: Sv, i }; }, fail) };
  }
  const at = it.at = alongAt(s), m = alongMargin(s, at.pos), md = ALONG_AXES[at.pos];   // every line at every output, near one position
  it.missing = !lineWindowCached(src, md, at.p, m);
  return { wait: lineWindow(src, sSrc, md, at.p, m).then(w => { it.win = w; }, fail), note: it.missing ? "loading every line near this position at every output …" : null };
}
/** After the data arrived: the curves (memoised on the plot), every value drawn (it.allVals); an error text or null. */
export function mapPrepare(it) {
  const have = it.kind === "A" ? it.rows : it.kind === "B" ? it.frame : it.win;
  if (it.err || !have) return it.err || "no data for this map";
  if (it.kind === "A") alongProcess(it); else if (it.kind === "B") alongProcessB(it); else alongProcessC(it);
  return null;
}
/** A: one line at every output — rows are outputs. */
function alongProcess(it) {
  const { s, src, xd, yd, rows, sp } = it, pos = xd === "time" ? yd : xd, mode = ALONG_AXES[pos], n = src.shape.at(-1);
  const rmax = dimCoord(src, "r_max").values[rows.ri], O = opsOf(s, pos);
  const key = JSON.stringify(["A", src.run.name, src.name, rows.ri, rows.Q.length, src.steps.at(-1), pos, O.sm, O.sl, varVals(O.sm?.h, O.sl?.w)]);
  if (sp.alongKey === key) { Object.assign(it, sp.alongMemo); return; }
  const sIdx = src.steps.map(st => rows.sSrc.stepIndex.get(st) ?? -1), T = src.steps.length;
  const proc = new Array(T).fill(null), all = [];
  for (let i = 0; i < T; i++) {
    if (sIdx[i] < 0) continue;
    const r = curveRow(rows.S, sIdx[i] * n, rows.Q, i * n, n, mode, pos, s, O.sl, { run: src.run.name, d: { r_max: rmax } });
    if (!r) continue;
    proc[i] = r;
    for (const y of r.Y) all.push(y);
  }
  sp.alongKey = key;
  sp.alongMemo = { proc, rowVals: src.times, allVals: Float32Array.from(all), where: `r_max = ${R.fmt(rmax)}`, ops: O.ops, opD: O.opD };
  Object.assign(it, sp.alongMemo);
}
/** B: every line at one output — rows are lines. */
function alongProcessB(it) {
  const { s, src, xd, yd, frame, sp } = it, pos = xd === "r_max" ? yd : xd, mode = ALONG_AXES[pos], n = src.shape.at(-1);
  const R0 = dimCoord(src, "r_max").values, J = R0.length, O = opsOf(s, pos);
  const key = JSON.stringify(["B", src.run.name, src.name, frame.i, src.q?.scales?.[frame.i], pos, O.sm, O.sl, varVals(O.sm?.h, O.sl?.w)]);
  if (sp.alongKey === key) { Object.assign(it, sp.alongMemo); return; }
  const proc = new Array(J).fill(null), all = [];
  for (let j = 0; j < J; j++) {
    const r = curveRow(frame.S, j * n, frame.Q, j * n, n, mode, pos, s, O.sl, { run: src.run.name, d: { r_max: R0[j] } });
    if (!r) continue;
    proc[j] = r;
    for (const y of r.Y) all.push(y);
  }
  sp.alongKey = key;
  sp.alongMemo = { proc, rowVals: R0, allVals: Float32Array.from(all), where: `t = ${R.fmt(src.times[frame.i])}`, ops: O.ops, opD: O.opD };
  Object.assign(it, sp.alongMemo);
}
/** The curve (rising X, Y) at x, straight between its points; NaN outside it. */
function valueAt(X, Y, x) {
  const m = X.length;
  if (m < 2 || !(x >= X[0] && x <= X[m - 1])) return m === 1 && x === X[0] ? Y[0] : NaN;
  const j = Math.min(m - 1, Math.max(1, lowerBound(X, x))), d = X[j] - X[j - 1];
  return d > 0 ? Y[j - 1] + (Y[j] - Y[j - 1]) * (x - X[j - 1]) / d : Y[j];
}
/** C: every line at every output, read at one position — a grid (output, line). */
function alongProcessC(it) {
  const { s, src, win, sp, at } = it, mode = ALONG_AXES[at.pos], R0 = dimCoord(src, "r_max").values, O = opsOf(s, at.pos);
  const key = JSON.stringify(["C", src.run.name, src.name, at.pos, at.p, win.count.length, win.s.length, src.steps.at(-1), O.sm, O.sl, varVals(O.sm?.h, O.sl?.w)]);
  if (sp.alongKey === key) { Object.assign(it, sp.alongMemo); return; }
  const { T, J } = win, grid = new Float32Array(T * J).fill(NaN), all = [];
  for (let t = 0; t < T; t++) for (let j = 0; j < J; j++) {
    const k = t * J + j, c0 = win.off[k], cnt = win.count[k];
    if (cnt < 2) continue;
    const r = curveRow(win.s, c0, win.q, c0, cnt, mode, at.pos, s, O.sl, { run: src.run.name, d: { r_max: R0[j] }, t: src.times[t] });
    if (!r) continue;
    const v = valueAt(r.X, r.Y, at.p);
    grid[k] = v;
    if (Number.isFinite(v)) all.push(v);
  }
  sp.alongKey = key;
  sp.alongMemo = { grid, J, rowVals: R0, allVals: Float32Array.from(all), where: `at ${AT_NAME[at.pos]} = ${R.fmt(at.p)}${at.pos === "s_norm" ? "" : " R*"}`, ops: O.ops, opD: O.opD };
  Object.assign(it, sp.alongMemo);
}
/** Half a cell beyond the first and last values (in log space on a log axis). */
function cells(V, log) {
  const n = V.length;
  if (!n) return [0, 1];
  if (n === 1) return [V[0] - 0.5, V[0] + 0.5];
  if (log && V[0] > 0) return [V[0] / Math.sqrt(V[1] / V[0]), V[n - 1] * Math.sqrt(V[n - 1] / V[n - 2])];
  return [V[0] - (V[1] - V[0]) / 2, V[n - 1] + (V[n - 1] - V[n - 2]) / 2];
}
/** The whole map: its rows' cells and the curves' extent. */
export function mapView(it) {
  const { src, xd, yd, s } = it;
  let lo = Infinity, hi = -Infinity;
  for (const r of it.proc || []) if (r) { lo = Math.min(lo, r.X[0]); hi = Math.max(hi, r.X[r.X.length - 1]); }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  const ext = (d, log) => (d === "time" ? cells(src.times, false) : d === "r_max" ? cells(dimCoord(src, "r_max").values, log) : [lo, hi]);
  const [x0, x1] = ext(xd, !!s.logx), [y0, y1] = ext(yd, !!s.logy);
  return { x0, x1, y0, y1 };
}
/** The index whose cell (midpoint to midpoint, in log space if log) holds v; -1 outside them all. V rising. */
function cellOf(V, v, log = false) {
  const n = V.length;
  if (!n || !(v === v) || (log && !(v > 0))) return -1;
  const f = log ? Math.log : (x => x), fv = f(v);
  const h0 = n > 1 ? (f(V[1]) - f(V[0])) / 2 : 0.5, h1 = n > 1 ? (f(V[n - 1]) - f(V[n - 2])) / 2 : 0.5;
  if (fv < f(V[0]) - h0 || fv > f(V[n - 1]) + h1) return -1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (V[m] <= v) lo = m; else hi = m; }
  return Math.abs(f(V[hi]) - fv) < Math.abs(f(V[lo]) - fv) ? hi : lo;
}
function lowerBound(X, x) { let lo = 0, hi = X.length; while (lo < hi) { const m = (lo + hi) >> 1; if (X[m] < x) lo = m + 1; else hi = m; } return lo; }
/** The pixels' values (render2D paints them like any map's). */
export const mapPaint = (it, ax, ay) => (it.kind === "C" ? alongPaintC(it, ax, ay) : alongPaint(it, ax, ay));
/** Pixels of A and B: each pixel along the rows' axis (time or r_max) shows its row's curve; along the position, the
 *  mean of the curve's points inside the pixel, else the curve at the pixel's centre. */
function alongPaint(it, ax, ay) {
  const { plot, xd, proc, s, rowVals } = it, W = plot.w, H = plot.h, values = new Float32Array(W * H).fill(NaN);
  const rX = !ALONG_POS.includes(xd), P = rX ? H : W, nR = rX ? W : H, rowLog = rX ? !!s.logx : !!s.logy;
  const pa = rX ? ay : ax, ra = rX ? ax : ay, p0 = rX ? plot.y : plot.x, r0 = rX ? plot.x : plot.y;
  const edges = new Float64Array(P + 1);
  for (let k = 0; k <= P; k++) edges[k] = pa.from(p0 + k);
  const memo = new Map();
  const rowPix = i => {
    let out = memo.get(i);
    if (out) return out;
    out = new Float32Array(P).fill(NaN); memo.set(i, out);
    const r = proc[i];
    if (!r) return out;
    const { X, Y } = r, m = X.length;
    for (let k = 0; k < P; k++) {
      const a = Math.min(edges[k], edges[k + 1]), b = Math.max(edges[k], edges[k + 1]);
      if (b < X[0] || a > X[m - 1]) continue;
      const i0 = lowerBound(X, a), i1 = lowerBound(X, b);
      if (i1 > i0) { let sum = 0; for (let q = i0; q < i1; q++) sum += Y[q]; out[k] = sum / (i1 - i0); continue; }
      out[k] = valueAt(X, Y, (a + b) / 2);
    }
    return out;
  };
  for (let j = 0; j < nR; j++) {
    const i = cellOf(rowVals, ra.from(r0 + j + 0.5), rowLog);
    if (i < 0) continue;
    const rp = rowPix(i);
    for (let k = 0; k < P; k++) { const v = rp[k]; values[rX ? k * W + j : j * W + k] = s.abs ? Math.abs(v) : v; }
  }
  return values;
}
/** Pixels of C: the cell (output, line) the pixel falls in. */
function alongPaintC(it, ax, ay) {
  const { plot, xd, src, grid, J, s, rowVals } = it, W = plot.w, H = plot.h, values = new Float32Array(W * H).fill(NaN);
  const tOnX = xd === "time", T = src.times;
  const col = Int32Array.from({ length: W }, (_, i) => (tOnX ? cellOf(T, ax.from(plot.x + i + 0.5)) : cellOf(rowVals, ax.from(plot.x + i + 0.5), !!s.logx)));
  const row = Int32Array.from({ length: H }, (_, j) => (tOnX ? cellOf(rowVals, ay.from(plot.y + j + 0.5), !!s.logy) : cellOf(T, ay.from(plot.y + j + 0.5))));
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const a = col[i], b = row[j];
    if (a < 0 || b < 0) continue;
    const v = grid[(tOnX ? a : b) * J + (tOnX ? b : a)];
    values[j * W + i] = s.abs ? Math.abs(v) : v;
  }
  return values;
}
/** Its automatic title, axis labels and colour-bar label. */
export function mapLabels(it, run) {
  const { src, xd, yd } = it;
  return { title: [`${src.label} · ${run}`, it.where, ...it.ops].join(" · "), xlabel: axLabel(xd), ylabel: axLabel(yd),
    cbar: (it.opD ? `${it.opD} ` : "") + src.label + (src.units && !it.opD ? ` [${src.units}]` : "") };
}

/** v14.2 (lineouts): an along-line quantity over time at one position (pos, p; default: the map's own) of the line
 *  nearest r_max `rmax`, as the C map reads it (each output's curve smoothed / sloped along the line, then read at the
 *  position): {xs: times, ys, rmax} or {error}. Kept in the browser per recipe. */
const LO_SERIES = new Map();
export async function alongSeriesAt(src, s, rmax, pos = null, p = null) {
  if (pos == null) { const a = alongAt(s); pos = a.pos; p = a.p; }
  if (!ALONG_POS.includes(pos)) pos = "s";
  const R0 = dimCoord(src, "r_max").values, ri = pickIndex(src, "r_max", rmax), O = opsOf(s, pos);
  const key = JSON.stringify([src.run.name, src.name, ri, pos, p, src.steps.at(-1), O.sm, O.sl, varVals(O.sm?.h, O.sl?.w)]);
  if (LO_SERIES.has(key)) return LO_SERIES.get(key);
  let rows;
  try { rows = await alongRows(src, { picks: { r_max: R0[ri] } }); } catch (e) { return { error: String(e?.message || e) }; }
  const n = src.shape.at(-1), mode = ALONG_AXES[pos], sIdx = src.steps.map(st => rows.sSrc.stepIndex.get(st) ?? -1), T = src.steps.length;
  const ys = new Float64Array(T).fill(NaN);
  for (let i = 0; i < T; i++) {
    if (sIdx[i] < 0) continue;
    const r = curveRow(rows.S, sIdx[i] * n, rows.Q, i * n, n, mode, pos, s, O.sl, { run: src.run.name, d: { r_max: R0[ri] } });
    if (r) ys[i] = valueAt(r.X, r.Y, p);
  }
  const out = { xs: Float64Array.from(src.times), ys, rmax: R0[ri] };
  LO_SERIES.set(key, out);
  if (LO_SERIES.size > 100) LO_SERIES.delete(LO_SERIES.keys().next().value);
  return out;
}
