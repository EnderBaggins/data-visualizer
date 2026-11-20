// cycles.js — period of a cycle in a curve (v14.1, human 2026-11-13: the research session's method, "add it to the
// visualizer"; "the window is the window I check for period (because in many sims the period dies out at some point and
// starts at some point)"). A line-by-line port of claude_work/lib/cycles.py (numpy) — the same steps and the same numbers
// (checked against it on ec025's foot→equator voltage: claude_work/scratch/cycle-port/):
//   1. detrend   inside the window: "linear" (default; a fit over the window), "mean", "quadratic", "running:W";
//   2. autocorr  normalised autocorrelation (biased, AC(0) = 1);
//   3. period    the FIRST local maximum after the first zero crossing (within half the window), parabola-refined;
//                regularity = AC there; below 0.2 → no clear cycle (period NaN); n_cycles = window length / period.
// sliding(): period and regularity in windows of `width` stepped by `step`; lines(): lags between curves on one time grid
// (cross-correlation against the most regular one) and how in phase they are (mean pairwise correlation).
const fin = Number.isFinite;
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2])) : NaN; };
const diffs = t => { const d = []; for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]); return d; };
/** (t, y) restricted to t0 <= t <= t1 (null: open end). */
export function window(t, y, t0 = null, t1 = null) {
  const T = [], Y = [];
  for (let i = 0; i < t.length; i++) if ((t0 == null || t[i] >= t0) && (t1 == null || t[i] <= t1)) { T.push(t[i]); Y.push(y[i]); }
  return [T, Y];
}
/** Least-squares polynomial of degree deg through (x, y) (as np.polyfit): coefficients, highest power first. */
function polyfit(x, y, deg) {
  const m = x.reduce((s, v) => s + v, 0) / x.length;                     // centred for conditioning, then expanded
  const n = deg + 1, A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < x.length; i++) {
    const u = x[i] - m, p = [];
    for (let k = 0; k < n; k++) p.push(u ** k);
    for (let r = 0; r < n; r++) { for (let c = 0; c < n; c++) A[r][c] += p[r] * p[c]; A[r][n] += p[r] * y[i]; }
  }
  for (let c = 0; c < n; c++) {                            // Gauss-Jordan with pivoting
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  const b = A.map((row, k) => row[n] / row[k]);             // y = sum b_k (x - m)^k
  return x0 => b.reduce((s, bk, k) => s + bk * (x0 - m) ** k, 0);
}
function interpFill(t, y) {
  const ok = y.map(fin);
  if (ok.every(Boolean)) return [...y];
  const T = t.filter((_, i) => ok[i]), Y = y.filter((_, i) => ok[i]);
  return t.map((x, i) => (ok[i] ? y[i] : interp1(T, Y, x)));
}
function interp1(X, Y, x) {                                 // np.interp: held at the ends
  if (!X.length) return NaN;
  if (x <= X[0]) return Y[0];
  if (x >= X[X.length - 1]) return Y[Y.length - 1];
  let lo = 0, hi = X.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (X[mid] <= x) lo = mid; else hi = mid; }
  return Y[lo] + ((Y[hi] - Y[lo]) * (x - X[lo])) / (X[hi] - X[lo]);
}
function runningMean(y, n) {
  n = Math.max(Math.round(n) | 1, 3);                       // odd width, >= 3 samples
  const h = n >> 1, N = y.length, pad = [];
  for (let i = h; i >= 1; i--) pad.push(y[Math.min(i, N - 1)]);                        // reflect (np.pad "reflect")
  pad.push(...y);
  for (let i = 1; i <= h; i++) pad.push(y[Math.max(N - 1 - i, 0)]);
  const out = [];
  for (let i = 0; i < N; i++) { let s = 0; for (let k = 0; k < n; k++) s += pad[i + k]; out.push(s / n); }
  return out;
}
/** y minus its slow trend over the given (windowed) samples. how: mean | linear | quadratic | running:W. */
export function detrend(t, y, how = "linear") {
  const ok = y.map(fin), n = ok.filter(Boolean).length;
  if (n < 3) return y.map(() => NaN);
  if (how === "mean") { const m = y.filter(fin).reduce((s, v) => s + v, 0) / n; return y.map(v => v - m); }
  if (how === "linear" || how === "quadratic") {
    const f = polyfit(t.filter((_, i) => ok[i]), y.filter(fin), how === "linear" ? 1 : 2);
    return y.map((v, i) => v - f(t[i]));
  }
  if (String(how).startsWith("running:")) {
    const W = Number(String(how).split(":")[1]), dt = median(diffs(t)), yy = interpFill(t, y);
    const rm = runningMean(yy, Math.round(W / dt));
    return yy.map((v, i) => v - rm[i]);
  }
  throw new Error(`unknown detrend "${how}" (mean | linear | quadratic | running:W)`);
}
/** Normalised autocorrelation for lags 0 … len−1 (NaNs filled by interpolation). */
export function autocorr(y) {
  const ok = y.map(fin);
  if (ok.filter(Boolean).length < 3) return y.map(() => NaN);
  const idx = y.map((_, i) => i), yy = ok.every(Boolean) ? [...y] : idx.map(i => (ok[i] ? y[i] : interp1(idx.filter(j => ok[j]), y.filter(fin), i)));
  const m = yy.reduce((s, v) => s + v, 0) / yy.length, d = yy.map(v => v - m), N = d.length, ac = [];
  for (let k = 0; k < N; k++) { let s = 0; for (let i = 0; i + k < N; i++) s += d[i] * d[i + k]; ac.push(s); }
  return ac[0] > 0 ? ac.map(v => v / ac[0]) : ac.map(() => NaN);
}
const parabola = (a, b, c) => { const d = a - 2 * b + c; return d !== 0 ? (0.5 * (a - c)) / d : 0; };
/** Period of the cycle in y(t) over the given (windowed) samples: {period, regularity, n_cycles, dt, ac, lag, note}. */
export function period(t, y, how = "linear", maxLagFrac = 0.5, minRegularity = 0.2) {
  const dt = median(diffs(t)), ac = autocorr(detrend(t, y, how)), lag = ac.map((_, k) => k * dt);
  const out = { period: NaN, regularity: NaN, n_cycles: NaN, dt, ac, lag, note: "" };
  if (!ac.some(fin)) { out.note = "too few finite samples"; return out; }
  const z0 = ac.findIndex(v => v < 0);
  if (z0 < 0) { out.note = "autocorrelation never negative: trend left in, or no cycle"; return out; }
  const kmax = Math.trunc(maxLagFrac * ac.length);
  let found = false;
  for (let k = Math.max(z0, 1); k < kmax - 1; k++) {
    if (ac[k] >= ac[k - 1] && ac[k] > ac[k + 1]) {
      const P = (k + parabola(ac[k - 1], ac[k], ac[k + 1])) * dt;
      Object.assign(out, { period: P, regularity: ac[k], n_cycles: (t[t.length - 1] - t[0]) / P });
      found = true; break;
    }
  }
  if (!found) { out.note = "no peak after the first zero crossing"; return out; }
  if (out.regularity < minRegularity) {
    out.note = `no clear cycle: the first peak (shift ${out.period.toFixed(2)}) has regularity ${out.regularity >= 0 ? "+" : ""}${out.regularity.toFixed(2)} < ${minRegularity}`;
    out.candidate = out.period; out.period = NaN; out.n_cycles = NaN;
    return out;
  }
  if (String(how).startsWith("running:") && Number(String(how).split(":")[1]) < 3 * out.period)
    out.note = `running-mean width ${String(how).split(":")[1]} < 3 × period ${out.period.toFixed(2)}: it may weaken this cycle and inflate regularity`;
  return out;
}
/** Period and regularity in windows of `width` stepped by `step` through the whole series: {t_mid, period, regularity}. */
export function sliding(t, y, width = 32, step = 2, how = "linear") {
  const mids = [], P = [], R = [];
  if (!t.length) return { t_mid: mids, period: P, regularity: R };
  for (let a = t[0]; a + width <= t[t.length - 1] + 1e-9; a += step) {
    const [tw, yw] = window(t, y, a, a + width);
    const r = tw.length >= 4 ? period(tw, yw, how) : { period: NaN, regularity: NaN };
    mids.push(a + width / 2); P.push(r.period); R.push(r.regularity);
  }
  return { t_mid: mids, period: P, regularity: R };
}
/** Curves on one time grid (columns Y[j], same t): each one's lag against the most regular (ref; positive = trails it)
 *  and in_phase = mean pairwise correlation of the detrended series. regs = each column's regularity, periods = periods. */
export function lines(t, Y, how = "linear", regs = null, periods = null) {
  const res = regs && periods ? null : Y.map(y => period(t, y, how));
  const R = regs ?? res.map(r => r.regularity), Pj = periods ?? res.map(r => r.period);
  const D = Y.map(y => detrend(t, y, how)), good = D.map(d => d.every(fin));
  const gi = D.map((_, j) => j).filter(j => good[j]);
  const corr = (a, b) => { const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
    let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };
  let s = 0, n = 0;
  for (let a = 0; a < gi.length; a++) for (let b = a + 1; b < gi.length; b++) { s += corr(D[gi[a]], D[gi[b]]); n++; }
  const inPhase = n ? s / n : NaN;
  let ref = 0, best = -Infinity;
  R.forEach((r, j) => { if (fin(r) && r > best) { best = r; ref = j; } });
  const dt = median(diffs(t)), maxLag = fin(Pj[ref]) ? 0.5 * Pj[ref] : 0.25 * (t[t.length - 1] - t[0]), K = Math.max(Math.trunc(maxLag / dt), 1);
  const mean = a => a.reduce((x, v) => x + v, 0) / a.length, xr = D[ref].map(v => v - mean(D[ref].filter(fin)));
  const lag = Y.map((_, j) => {
    if (!good[j]) return NaN;
    const mj = mean(D[j]), xj = D[j].map(v => v - mj), N = xj.length, cc = [];
    for (let k = -K; k <= K; k++) { let q = 0; for (let i = Math.max(k, 0), r = Math.max(-k, 0); i < N + Math.min(k, 0); i++, r++) q += xj[i] * xr[r]; cc.push(q); }
    let i = 0; for (let k = 1; k < cc.length; k++) if (cc[k] > cc[i]) i = k;
    const off = i > 0 && i < cc.length - 1 ? parabola(cc[i - 1], cc[i], cc[i + 1]) : 0;
    return (i - K + off) * dt;
  });
  return { lag, in_phase: inPhase, ref };
}
