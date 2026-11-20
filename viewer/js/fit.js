// fit.js — means and least-squares fits of a drawn curve (v5.13, human 2026-10-06: "a measure tool for average … so I can
// also scale by average (to see deviation from average)"; "plot a quadratic to see how it fits data"). Everything works
// on the curve as drawn (after |value|, frame averaging and scaling), between x = a and x = b.

// v14.4: pointsIn and meanOf live in stats.js (the one place statistics are computed); kept importable from here.
import { pointsIn, meanOf } from "./stats.js";
export { pointsIn, meanOf };

/** Solve A c = r (small, dense) by Gaussian elimination with partial pivoting; null if singular. */
function solve(A, r) {
  const n = r.length, M = A.map((row, i) => [...row, r[i]]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (!(Math.abs(M[p][k]) > 1e-300)) return null;
    [M[k], M[p]] = [M[p], M[k]];
    for (let i = k + 1; i < n; i++) { const f = M[i][k] / M[k][k]; for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j]; }
  }
  const c = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * c[j]; c[i] = s / M[i][i]; }
  return c;
}
const binom = (n, k) => { let b = 1; for (let i = 1; i <= k; i++) b = (b * (n - k + i)) / i; return b; };
/** Least-squares polynomial of degree d through (X, Y). Solved in u = (x − m)/w for conditioning, returned as
 *  coefficients of x: [c0, c1, …, cd] (y = Σ c_k x^k), plus f(x). */
function polyfit(X, Y, d) {
  const n = X.length;
  if (n <= d) return { error: `a degree-${d} polynomial needs more than ${d} points (${n} in the range)` };
  const lo = Math.min(...X), hi = Math.max(...X), m = (lo + hi) / 2, w = (hi - lo) / 2 || 1;
  const U = X.map(x => (x - m) / w), A = Array.from({ length: d + 1 }, () => new Array(d + 1).fill(0)), r = new Array(d + 1).fill(0);
  for (let j = 0; j < n; j++) {
    const pw = [1]; for (let k = 1; k <= 2 * d; k++) pw.push(pw[k - 1] * U[j]);
    for (let a = 0; a <= d; a++) { r[a] += pw[a] * Y[j]; for (let b = 0; b <= d; b++) A[a][b] += pw[a + b]; }
  }
  const cu = solve(A, r);
  if (!cu) return { error: "the fit is singular (too few distinct x values)" };
  // y = Σ cu_k ((x − m)/w)^k = Σ_k cu_k w^-k Σ_j C(k,j) x^j (−m)^(k−j)
  const c = new Array(d + 1).fill(0);
  for (let k = 0; k <= d; k++) for (let j = 0; j <= k; j++) c[j] += cu[k] * Math.pow(w, -k) * binom(k, j) * Math.pow(-m, k - j);
  const f = x => { const u = (x - m) / w; let y = 0; for (let k = d; k >= 0; k--) y = y * u + cu[k]; return y; };
  return { c, f };
}
/** y = A x^p or y = A e^(k x): a straight-line fit of ln|y| (points of the curve's main sign; x > 0 for the power law). */
function logfit(X, Y, kind) {
  const sgn = Math.sign(Y.reduce((p, q) => p + q, 0)) || 1, P = [], Q = [];
  for (let j = 0; j < X.length; j++) {
    if (sgn * Y[j] <= 0 || (kind === "power" && X[j] <= 0)) continue;
    P.push(kind === "power" ? Math.log(X[j]) : X[j]); Q.push(Math.log(sgn * Y[j]));
  }
  if (P.length < 2) return { error: kind === "power" ? "a power law needs ≥ 2 points with x > 0 and y of one sign" : "an exponential needs ≥ 2 points with y of one sign" };
  const lin = polyfit(P, Q, 1);
  if (lin.error) return lin;
  const A = sgn * Math.exp(lin.c[0]), k = lin.c[1];
  return { A, k, f: kind === "power" ? x => A * Math.pow(x, k) : x => A * Math.exp(k * x), used: P.length };
}

/** A number for a formula in $…$ (3 significant digits; × 10^n when very large or small). */
export function texNum(v) {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return "0";
  const e = Math.floor(Math.log10(Math.abs(v)));
  if (e >= 4 || e <= -3) return `${(v / Math.pow(10, e)).toPrecision(3).replace(/\.?0+$/, "")}\\times10^{${e}}`;
  return String(Number(v.toPrecision(3)));
}
const signed = (v, first) => (first ? (v < 0 ? "-" : "") : v < 0 ? " - " : " + ") + texNum(Math.abs(v));
/** The numbers of a fit a fit variable can hold (v8.10): [[key, label]]. */
export function fitParams(model, degree = 2) {
  if (model === "exp") return [["tau", "τ = −1/k"], ["k", "k"], ["A", "A"], ["r2", "R²"]];
  if (model === "power") return [["p", "p (the power)"], ["A", "A"], ["r2", "R²"]];
  const d = Math.max(0, Math.min(8, Math.round(Number(degree) || 2)));
  return [...[...Array(d + 1).keys()].map(i => [`c${i}`, i ? `c${i} (× x${i > 1 ? "^" + i : ""})` : "c0 (constant)"]), ["r2", "R²"]];
}
/** Fit a curve: model "poly" (degree d) | "power" | "exp" over a ≤ x ≤ b. Returns {f, text (LaTeX formula in `v`, e.g.
 *  "t" on a time axis), r2, n, params} or {error}. r2 = 1 − Σ(y − f)² / Σ(y − ȳ)² over the fitted points.
 *  opts.tau (v8.10): an exponential's label as e^(−t/τ), τ = −1/k, instead of e^(kt). */
export function fitCurve(xs, ys, model, degree, a, b, v = "x", opts = {}) {
  const [X, Y] = pointsIn(xs, ys, a, b);
  if (X.length < 2) return { error: "fewer than 2 points in the fit range" };
  let res, text, params;
  if (model === "power" || model === "exp") {
    res = logfit(X, Y, model);
    if (res.error) return res;
    const tau = -1 / res.k;
    params = model === "power" ? { A: res.A, p: res.k } : { A: res.A, k: res.k, tau };
    text = model === "power" ? `$y = ${texNum(res.A)}\\,${v}^{${texNum(res.k)}}$`
      : opts.tau && Number.isFinite(tau) ? `$y = ${texNum(res.A)}\\,e^{${tau > 0 ? "-" : ""}${v}/${texNum(Math.abs(tau))}}$`
      : `$y = ${texNum(res.A)}\\,e^{${texNum(res.k)}\\,${v}}$`;
  } else {
    const d = Math.max(0, Math.min(8, Math.round(degree)));
    res = polyfit(X, Y, d);
    if (res.error) return res;
    params = Object.fromEntries(res.c.map((c, i) => [`c${i}`, c]));
    const terms = [];
    for (let k = d; k >= 0; k--) terms.push(signed(res.c[k], k === d) + (k === 0 ? "" : k === 1 ? `\\,${v}` : `\\,${v}^{${k}}`));
    text = `$y = ${terms.join("")}$`;
  }
  const ym = Y.reduce((p, q) => p + q, 0) / Y.length;
  let ssr = 0, sst = 0;
  for (let j = 0; j < X.length; j++) { ssr += (Y[j] - res.f(X[j])) ** 2; sst += (Y[j] - ym) ** 2; }
  const r2 = sst > 0 ? 1 - ssr / sst : NaN;
  return { f: res.f, text, r2, n: X.length, x0: Math.min(...X), x1: Math.max(...X), params: { ...params, r2 } };
}
