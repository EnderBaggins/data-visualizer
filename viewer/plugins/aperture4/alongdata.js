// alongdata.js (aperture4 plugin, v15.1; DECISIONS D20) — along-line data: a quantity stored at a traced field line's own
// points (dim "pt"; data manager family `along`). Each point's arc length is the family's member `s` (along.s next to
// along.epar). Moved from the core: model.js (ALONG_AXES, alongS, isAlongSrc, ALONG_POS, alongKind) and data.js
// (lineWindow, windowFromFrames: serve.py api/window). The core's data.js keeps lineRows (row r of every output), which is
// general.
//
// v8.28 (human 2026-11-09: along-line data "saved naturally as along s, then when I want to plot s/smax it can just do
// that scaling automatically"): they go on three x axes, read per curve and per frame: s (from the north foot), s/s_max
// (= s / the line's last s; the same axis id as the older 200-point data) and s from the south foot.
import { F16_TABLE } from "../../js/data.js";
import { hasFeature, apiUrl } from "../../js/views.js";

/** The x axes of along-line data and how each reads s: s as stored, s / L, or L − s. */
export const ALONG_AXES = { s: "s", s_norm: "norm", s_south: "south" };
export const ALONG_POS = ["s", "s_norm", "s_south"];
/** Data at a line's own points (the `along` family). */
export const isAlong = src => !!src?.spaceDims?.includes("pt");
/** The source holding the arc length of `src`'s points (its family's `s`), or null (not data at a line's points). */
export const alongS = src => (isAlong(src) && src.family ? src.run.source(`${src.family}.s`) || null : null);
/** v11.0: which along-line map two axes make — "A" time × position (one line over time), "B" r_max × position (every
 *  line at one time), "C" r_max × time (every line over time at one position); null = not a pair it can draw. */
export function alongKind(a, b) {
  const has = (x, y) => (a === x && y(b)) || (b === x && y(a));
  if (has("time", d => ALONG_POS.includes(d))) return "A";
  if (has("r_max", d => ALONG_POS.includes(d))) return "B";
  if (has("r_max", d => d === "time")) return "C";
  return null;
}

// ---- every line near one position, at every output (v11.0; was data.js StoredSource.lineWindow) ------------------------
/** serve.py's api/window, when the running serve.py offers it (read each time: a restarted serve.py may add it). */
const windowApi = () => (hasFeature("window") ? apiUrl("window") : null);
const windowKey = (src, mode, p, m) => `${src.run.name}/${src.name}/win/${mode}/${p}/${m}/${src.steps.length}/${src.steps.at(-1)}/${src.q.scales?.at(-1)}`;
export const lineWindowCached = (src, mode, p, m) => src.run.store.cache.has(windowKey(src, mode, p, m));
/** Every field line's points within m of position p along it (mode "s" | "norm" | "south"), at every output of `src`:
 *  {T, J, count, off, L, s, q} — per (output, line) k: count[k] points from off[k] in s / q, the line's length L[k].
 *  One request through serve.py's api/window, else from the whole frames (this source and its s source `sSrc`). */
export async function lineWindow(src, sSrc, mode, p, m, prio = "high") {
  const st = src.run.store, q = src.q, n = src.shape.at(-1), J = src.size / n, T = src.steps.length, w = q.dtype === "float16" ? 2 : 4;
  const api = windowApi();
  if (!(api && q.layout === "per_step" && sSrc.q?.layout === "per_step")) return windowFromFrames(src, sSrc, mode, p, m, prio);
  const key = windowKey(src, mode, p, m);
  let raw = st.cache.get(key, true);
  if (!raw) {
    let pend = st.pending.get(key);
    if (!pend) {
      const qf = `${src.run.name}/${q.path.replace("{step:05d}", "{step}")}`, sf = `${sSrc.run.name}/${sSrc.q.path.replace("{step:05d}", "{step}")}`;
      const entry = st.net.get(`${api}?qf=${encodeURIComponent(qf)}&sf=${encodeURIComponent(sf)}&steps=${src.steps.join(",")}&n=${n}&w=${w}&mode=${mode}&p=${p}&m=${m}`, prio);
      const pr = entry.promise.then(buf => new Uint8Array(buf));
      pend = { p: pr, entry };
      st.pending.set(key, pend);
      pr.then(v => st.cache.set(key, v, false)).finally(() => st.pending.delete(key)).catch(() => {});
    }
    raw = await pend.p;
  }
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), K = T * J;
  if (buf.byteLength < 8 * K) throw new Error(`${src.label}: api/window sent ${buf.byteLength} bytes, fewer than its header`);
  const count = new Int32Array(buf, 0, K), L = new Float32Array(buf, 4 * K, K), off = new Int32Array(K);
  let tot = 0;
  for (let k = 0; k < K; k++) { off[k] = tot; tot += count[k]; }
  const s = new Float32Array(buf, 8 * K, tot);
  let qv;
  if (w === 4) qv = new Float32Array(buf, 8 * K + 4 * tot, tot);
  else {
    const codes = new Uint16Array(buf, 8 * K + 4 * tot, tot);
    qv = new Float32Array(tot);
    for (let t = 0; t < T; t++) { const sc = q.scales[t]; for (let k = t * J; k < (t + 1) * J; k++) for (let i = off[k]; i < off[k] + count[k]; i++) qv[i] = F16_TABLE[codes[i]] * sc; }
  }
  return { T, J, count, off, L, s, q: qv };
}
/** The same from the whole frames (no api/window): slow the first time (every output's frame of both sources). */
async function windowFromFrames(src, sSrc, mode, p, m, prio) {
  const n = src.shape.at(-1), J = src.size / n, T = src.steps.length, K = T * J;
  const count = new Int32Array(K), L = new Float32Array(K).fill(NaN), off = new Int32Array(K), S = [], Q = [];
  let tot = 0;
  for (let t = 0; t < T; t++) {
    const si = sSrc.stepIndex.get(src.steps[t]);
    if (si === undefined) { for (let j = 0; j < J; j++) off[t * J + j] = tot; continue; }
    const [Sv, Qv] = await Promise.all([sSrc.frame(si, true, null, prio), src.frame(t, true, null, prio)]);
    for (let j = 0; j < J; j++) {
      const k = t * J + j, o = j * n;
      let mc = 0;
      while (mc < n && Number.isFinite(Sv[o + mc])) mc++;
      off[k] = tot;
      if (mc < 2) continue;
      const Lj = Sv[o + mc - 1];
      L[k] = Lj;
      for (let i = 0; i < mc; i++) {
        const sv = Sv[o + i], ps = mode === "s" ? sv : mode === "norm" ? sv / Lj : Lj - sv;
        if (Math.abs(ps - p) <= m) { S.push(sv); Q.push(Qv[o + i]); count[k]++; tot++; }
      }
    }
  }
  return { T, J, count, off, L, s: Float32Array.from(S), q: Float32Array.from(Q) };
}
