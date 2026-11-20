// stepsof.js (analysis plugin; DECISIONS D22) — the steps tool's computation, moved from panel1d.js. Pure: no DOM
// (RULES P7; tools/check.mjs checks it). Used by the steps tool (steps.js) and the aperture4 plugin's foot gaps.
// Human 2026-11-09 (via the intermittent-discharge session): "I like the slope of the drop plot is there a way to do that
// in visualizer without caching everything? should be pretty cheap on the 1D stuff". Computed from the curve as drawn
// (x after its function, so per R* when x is in R*), nothing stored. Definitions as claude_work/scratch/gap-proto/steps.py.
import { interp1, curveNum, risingPoints, interpHeld } from "../../js/panel1d.js";

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
