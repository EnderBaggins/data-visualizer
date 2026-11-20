// stats.js — statistics of a curve as drawn: the one place they are computed (v14.4, architecture review §5.5, P1). Pure:
// no DOM, tested in node (tools/check.mjs). Draw tools' values, readings, the averaged curve, "÷ mean" and fits all use
// these, so a mean on a tool card and the same mean as a variable agree. (Before v14.4 there were three: curveStat in
// model.js, meanOf in fit.js and a max/min loop in measure.js; they treated gaps differently.)
//
// Conventions, the same for every statistic:
// - only points with a ≤ x ≤ b and finite x and y count;
// - a gap (a point without a finite value) splits the curve: the mean integrates over the pieces, never across a gap;
// - x values are the curve's own, in its order (a curve as drawn: after f(x), its scale, smoothing and slope).

/** The points of a curve with a ≤ x ≤ b and finite x, y: [X, Y] (in the curve's order). */
export function pointsIn(xs, ys, a = -Infinity, b = Infinity) {
  const X = [], Y = [];
  for (let j = 0; j < xs.length; j++) {
    const x = xs[j], y = ys[j];
    if (x >= a && x <= b && Number.isFinite(x) && Number.isFinite(y)) { X.push(x); Y.push(y); }
  }
  return [X, Y];
}

/** A statistic of a curve over a ≤ x ≤ b: {x, y}, or null when no point counts.
 *  - "max" / "min" / "xmax" / "xmin": the extreme point ({x, y} of it);
 *  - "mean": the trapezoid integral divided by the length covered (the time average on a time axis; right for uneven
 *    spacing such as r_max), gaps left out; a single point (or points at one x) gives their average. x = NaN;
 *  - "cross": the first place the curve crosses level c ({x, y: c}), interpolated between the two points around it. */
export function curveStat(xs, ys, stat, a = -Infinity, b = Infinity, c = 0) {
  let best = -1, sum = 0, L = 0, n = 0, sumY = 0, px = NaN, py = NaN;
  for (let j = 0; j < xs.length; j++) {
    const x = xs[j], y = ys[j];
    if (!(x >= a && x <= b) || !Number.isFinite(x) || !Number.isFinite(y)) { px = NaN; continue; }
    if (stat === "cross" && Number.isFinite(px) && (py - c) * (y - c) <= 0 && py !== y) return { x: px + ((c - py) * (x - px)) / (y - py), y: c };
    if (stat === "mean") { n++; sumY += y; if (Number.isFinite(px)) { sum += 0.5 * (y + py) * (x - px); L += x - px; } }
    if ((stat === "max" || stat === "xmax") && (best < 0 || y > ys[best])) best = j;
    if ((stat === "min" || stat === "xmin") && (best < 0 || y < ys[best])) best = j;
    px = x; py = y;
  }
  if (stat === "mean") return L ? { x: NaN, y: sum / L } : n ? { x: NaN, y: sumY / n } : null;
  if (stat === "cross") return null;
  return best < 0 ? null : { x: xs[best], y: ys[best] };
}

/** One number of a statistic: the value for max / min / mean, the x for xmax / xmin / cross; NaN when none. */
export function statValue(xs, ys, stat, a = -Infinity, b = Infinity, c = 0) {
  const r = curveStat(xs, ys, stat, a, b, c);
  return !r ? NaN : stat === "xmax" || stat === "xmin" || stat === "cross" ? r.x : r.y;
}

/** The mean of y over a ≤ x ≤ b (curveStat "mean"); NaN when no point counts. */
export const meanOf = (xs, ys, a = -Infinity, b = Infinity) => statValue(xs, ys, "mean", a, b);

/** v14.6 (human 2026-11-13, Phase 4: "go for it"; DECISIONS D11): one number from the values of a quantity across the
 *  field lines at one time — what the retired stored rates did (∂V/∂Ψ = twist_rate_voltage, −∫V dI = ohmic_power).
 *  rmax = the lines' r_max (ascending), x = what a slope is taken against (r_max itself, or Ψ = Bp / r_max), q = the
 *  quantity on each line, q2 = a second one (for "intd"). Lines with a non-finite value are skipped.
 *    "slope"  dq/dx at the line nearest r_max = at (central difference with the finite neighbours; one-sided at an end)
 *    "int"    ∫ q dr_max between from and to (trapezoid)
 *    "intd"   ∫ q dq2 between from and to (trapezoid in q2: Σ ½ (q_k + q_k+1) (q2_k+1 − q2_k), inner lines first)
 *    "mean"   the r_max-weighted mean between from and to;  "max" the largest
 *  Returns NaN when it can't be formed. */
export function acrossValue(op, rmax, x, q, { at = NaN, q2 = null, from = -Infinity, to = Infinity } = {}) {
  const lo = Number.isFinite(from) ? from : -Infinity, hi = Number.isFinite(to) ? to : Infinity;
  const ok = k => Number.isFinite(rmax[k]) && Number.isFinite(q[k]) && (op !== "intd" || Number.isFinite(q2?.[k]));
  if (op === "slope") {
    let k = -1, best = Infinity;
    for (let j = 0; j < rmax.length; j++) if (ok(j) && Number.isFinite(x[j]) && Math.abs(rmax[j] - at) < best) { best = Math.abs(rmax[j] - at); k = j; }
    if (k < 0) return NaN;
    let a = k - 1, b = k + 1;
    while (a >= 0 && !(ok(a) && Number.isFinite(x[a]))) a--;
    while (b < rmax.length && !(ok(b) && Number.isFinite(x[b]))) b++;
    if (a < 0) a = k;
    if (b >= rmax.length) b = k;
    return a === b || x[b] === x[a] ? NaN : (q[b] - q[a]) / (x[b] - x[a]);
  }
  const idx = [];
  for (let j = 0; j < rmax.length; j++) if (ok(j) && rmax[j] >= lo && rmax[j] <= hi) idx.push(j);
  if (!idx.length) return NaN;
  if (op === "mean") return statValue(idx.map(j => rmax[j]), idx.map(j => q[j]), "mean");
  if (op === "max") return Math.max(...idx.map(j => q[j]));
  if (idx.length < 2) return NaN;
  let sum = 0;
  for (let n = 0; n + 1 < idx.length; n++) {
    const j = idx[n], k = idx[n + 1];
    sum += op === "int" ? 0.5 * (q[j] + q[k]) * (rmax[k] - rmax[j]) : op === "intd" ? 0.5 * (q[j] + q[k]) * (q2[k] - q2[j]) : NaN;
  }
  return sum;
}
