// data.js — reads the apt-vis/1 store (../FORMAT.md) and evaluates expressions. No physics here.
//
//   const store = new Store("../data/");
//   const run   = await store.loadRun("baseline-19");
//   const src   = run.source("B3");            // stored quantity or expression, same interface
//   const arr   = await src.frame(i);          // Float32Array over the non-time dims (C order)
//   src.isCached(i)                            // already in memory? (used by the prefetcher)
//
// Memory (v2): frames are kept compact (float16 as stored, 0.5 MB per 512² map) in a byte-bounded
// LRU; a small "hot" cache holds the decoded float32 frames being drawn. Inputs of expressions are
// cached as low priority, so they are evicted before frames that are displayed.
//
// Bands (v5.1, 2026-10-05): the network is the bottleneck (~1 MB/s through the port forward, against
// ~25 ms of browser work per step), so a θ × r map is downloaded in bands of BAND r-columns through
// serve.py's api/cols, and only the bands a panel's zoom shows. Bands are cached one by one: zooming
// out downloads just the missing ones. Unloaded cells are NaN. `cols` = [c0, c1) column range, or
// null = the whole frame. Without api/cols (old serve.py) whole files are downloaded as before.

// ---- float16 <-> float32 -------------------------------------------------------------------------
const F16 = (() => {
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    t[h] = e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024);
  }
  return t;
})();
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function toHalf(v) {
  if (v !== v) return 0x7e00;
  _f[0] = v; const x = _u[0], sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;          // rebias 127 -> 15
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) { if (e < -10) return sign; m = (m | 0x800000) >> (1 - e); return sign | ((m + 0x1000) >> 13); }
  const h = sign | (e << 10) | ((m + 0x1000) >> 13);
  return h;                                                       // rounding carry rolls into the exponent correctly
}
/** float32 array -> compact Uint16Array (float16 of value/scale), with .scale attached. */
function encode(a) {
  let top = 0;
  for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > top && v < Infinity) top = v; }
  const scale = top > 0 ? top / 32768 : 1, u = new Uint16Array(a.length);
  for (let i = 0; i < a.length; i++) u[i] = toHalf(a[i] / scale);
  u.scale = scale;
  return u;
}
function decode(c) {
  if (!(c instanceof Uint16Array)) return c;
  const out = new Float32Array(c.length), s = c.scale;
  for (let i = 0; i < c.length; i++) out[i] = F16[c[i]] * s;
  return out;
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

export const BAND = 64;                      // r columns per band (512 r cells -> 8 bands)
const NAN16 = 0x7e00;
export const F16_TABLE = F16;                 // float16 code -> value (the palette painter colours codes)

// ---- network queue (v5.2) ----------------------------------------------------------------------------
/** Several downloads at once (measured: 1.0 MB/s one at a time, 1.5 MB/s with 6 in parallel through the port
 *  forward). "high" = needed on screen now, "low" = read-ahead; the read-ahead uses at most lowMax of the
 *  browser's 6 connections, so a frame on screen always finds a free one, and a queued read-ahead request
 *  that becomes needed on screen is promoted. Counts bytes for the footer's speed meter; a network failure
 *  (not an HTTP error) calls onOffline, the next success onOnline. */
class Net {
  constructor() { this.q = []; this.active = 0; this.max = 6; this.lowMax = 4; this.samples = []; this.offline = false; this.onOffline = null; this.onOnline = null; }
  get(url, prio = "high") {
    const e = { url, prio };
    e.promise = new Promise((res, rej) => { e.res = res; e.rej = rej; });
    this.q.push(e); this.pump();
    return e;
  }
  promote(e) { if (e && e.prio !== "high") { e.prio = "high"; this.pump(); } }
  pump() {
    for (;;) {
      const hi = this.q.findIndex(x => x.prio === "high");
      let i = -1;
      if (hi >= 0) { if (this.active < this.max) i = hi; }
      else if (this.q.length && this.active < this.lowMax) i = 0;
      if (i < 0) return;
      const e = this.q.splice(i, 1)[0];
      this.active++;
      // v8.15.2 (human 2026-10-28: "frequently when I +dataset the plot goes black and won't show until i restart"): a
      // request the port forward stalls (no error, no data) used to hang forever, holding a connection and the plot's
      // draw. Now one that receives nothing for 20 s is aborted and tried again (twice), then fails with a message.
      const ac = new AbortController(), name = e.url.split("?")[0].split("/").slice(-3).join("/");
      let idle = null, stalled = false;
      const arm = () => { clearTimeout(idle); idle = setTimeout(() => { stalled = true; ac.abort(); }, 20000); };
      arm();
      fetch(e.url, { priority: e.prio === "high" ? "high" : "low", signal: ac.signal })
        .then(async r => {
          if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
          let b;
          const reader = r.body?.getReader?.();
          if (reader) {                                    // chunk by chunk: each chunk re-arms the stall timer
            const parts = []; let n = 0;
            for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; arm(); }
            const u = new Uint8Array(n); let o = 0; for (const p of parts) { u.set(p, o); o += p.length; }
            b = u.buffer;
          } else b = await r.arrayBuffer();
          clearTimeout(idle);
          this.samples.push([performance.now(), b.byteLength]);
          if (this.offline) { this.offline = false; this.onOnline?.(); }
          e.res(b);
        }, err => { clearTimeout(idle); if (stalled) throw err; if (!this.offline) { this.offline = true; this.onOffline?.(err); } throw err; })
        .catch(err => {
          clearTimeout(idle);
          if (stalled && (e.tries = (e.tries || 0) + 1) <= 2) { console.warn(`stalled 20 s, retrying: ${name}`); this.q.unshift(e); return; }
          e.rej(stalled ? new Error(`${name}: no data for 20 s (port forward / serve.py?) — ⟳ refresh data to retry`) : err);
        })
        .finally(() => { this.active--; this.pump(); });
    }
  }
  /** MB/s over the last 3 s. */
  rate() {
    const now = performance.now();
    while (this.samples.length && now - this.samples[0][0] > 3000) this.samples.shift();
    return this.samples.reduce((a, x) => a + x[1], 0) / 3e6;
  }
}

// ---- LRU caches ---------------------------------------------------------------------------------------
class Cache {
  constructor(maxBytes) { this.max = maxBytes; this.bytes = 0; this.map = new Map(); this.low = new Set(); }
  has(k) { return this.map.has(k); }
  get(k, promote = true) {
    const v = this.map.get(k);
    if (v !== undefined) { this.map.delete(k); this.map.set(k, v); if (promote) this.low.delete(k); }
    return v;
  }
  set(k, v, low = false) {
    if (this.map.has(k)) { this.bytes -= this.map.get(k).byteLength; this.map.delete(k); }
    this.map.set(k, v); this.bytes += v.byteLength;
    if (low) this.low.add(k); else this.low.delete(k);
    this.evict();
  }
  evict() {
    if (this.bytes <= this.max) return;
    for (const k of this.map.keys()) { if (this.bytes <= this.max) return; if (this.low.has(k)) this.drop(k); }
    for (const k of this.map.keys()) { if (this.bytes <= this.max) return; this.drop(k); }
  }
  drop(k) { this.bytes -= this.map.get(k).byteLength; this.map.delete(k); this.low.delete(k); }
}
class Hot {                                   // decoded frames currently being drawn (count-bounded)
  constructor(n) { this.n = n; this.map = new Map(); }
  get(k) { const v = this.map.get(k); if (v) { this.map.delete(k); this.map.set(k, v); } return v; }
  set(k, v) { this.map.set(k, v); while (this.map.size > this.n) this.map.delete(this.map.keys().next().value); }
}

export class Store {
  constructor(base, maxBytes = 1.2e9) {
    this.base = base.endsWith("/") ? base : base + "/";
    this.runs = {};
    this.cache = new Cache(maxBytes);
    this.hot = new Hot(48);
    this.pending = new Map();         // key -> {p: promise, entry: queued request} (de-duplicated downloads)
    this.net = new Net();
    this.colsApi = null;            // URL of serve.py's api/cols when it offers it (set by app.js)
    this.rowsApi = null;            // v10.2: URL of serve.py's api/rows (one row of every output in one request)
    this.expressions = {};          // name -> {expr, label}; applied to every run that has the operands
    this.analytics = {};            // v7: name -> analytic function {name, formula, label, kind, params, f}
  }
  async loadIndex() { return (await fetchJSON(this.base + "index.json")).runs; }
  /** v8.1: the data manager's dataset cards (notes, tags, kind) — optional (data/datasets.json). */
  async loadCards() {
    // v8.24: and the dataset groups' order (each card says its group; archived datasets leave the menus)
    try { const r = await fetch(this.base + "datasets.json", { cache: "no-store" }), j = r.ok ? await r.json() : {}; this.cards = j.datasets || {}; this.groupOrder = j.group_order || []; }
    catch { this.cards = {}; this.groupOrder = []; }
  }
  async loadRun(name) {
    const m = await fetchJSON(`${this.base}${encodeURIComponent(name)}/manifest.json`);
    this.runs[name] = new Run(this, name, m);
    return this.runs[name];
  }
  /** Compact array (cached, de-duplicated fetch). float16 files come back as Uint16Array with .scale.
   *  low = cache it as low priority (expression inputs); prio = network priority ("high" | "low"). */
  async compact(key, url, dtype, scale, low = false, prio = "high") {
    const hit = this.cache.get(key, !low);
    if (hit) return hit;
    const pend = this.pending.get(key);
    if (pend) { if (prio === "high") this.net.promote(pend.entry); return pend.p; }
    const entry = this.net.get(url, prio);
    const p = entry.promise.then(buf => {
      let a;
      if (dtype === "float16") { a = new Uint16Array(buf); a.scale = scale; } else a = new Float32Array(buf);
      this.cache.set(key, a, low);
      return a;
    });
    this.pending.set(key, { p, entry });
    try { return await p; } finally { this.pending.delete(key); }
  }
  decoded(key, c) {
    let d = this.hot.get(key);
    if (!d) { d = decode(c); this.hot.set(key, d); }
    return d;
  }
}

export class Run {
  constructor(store, name, manifest) {
    this.store = store; this.name = name; this.m = manifest;
    this.timeOfStep = new Map(manifest.steps.map((s, i) => [s, manifest.times[i]]));
    this.sources = {};
    for (const [qn, q] of Object.entries(manifest.quantities)) this.sources[qn] = new StoredSource(this, qn, q);
    this.exprErrors = {};
    // (v8.25: in passes, so an expression can use another defined after it; what still fails says why)
    let left = Object.entries({ ...(manifest.expressions || {}), ...store.expressions }).filter(([en]) => !(this.sources[en] && !(this.sources[en] instanceof ExprSource)));
    for (let more = true; more && left.length;) {
      more = false;
      left = left.filter(([en, e]) => {
        try { this.sources[en] = new ExprSource(this, en, e); delete this.exprErrors[en]; more = true; return false; }
        catch (err) { this.exprErrors[en] = err.message; return true; }
      });
    }
    // v7: analytic functions as maps (2D panels), where this run has what their {names} need; the reason otherwise
    this.anErrors = {};
    for (const [an, d] of Object.entries(store.analytics || {})) {
      try { this.sources["an:" + an] = new AnalyticSource(this, "an:" + an, d); }
      catch (err) { this.anErrors[an] = err.message; }
    }
  }
  coord(name) {
    const c = this.m.coords[name];
    if (c) return c;
    for (const d of Object.values(this.m.coords)) if (d.alt && d.alt[name]) return d.alt[name];
    return null;
  }
  source(name) { return this.sources[name]; }
  /** Config numbers: the recorded ones, plus (v8.1) every config.toml number the data manager stored (conf_all). */
  get conf() {
    if (this._confM !== this.m) { this._confM = this.m; this._conf = { ...(this.m.conf_all || {}), ...(this.m.conf || {}) }; }
    return this._conf;
  }
}

class SourceBase {
  init(run, name, dims) {
    this.run = run; this.name = name; this.dims = dims;
    this.hasTime = dims.includes("time");
    this.spaceDims = dims.filter(d => d !== "time");
    this.shape = this.spaceDims.map(d => run.coord(d).values.length);
    this.size = this.shape.reduce((a, b) => a * b, 1);
    this.strides = this.shape.map((_, k) => this.shape.slice(k + 1).reduce((a, b) => a * b, 1));
  }
  setSteps(steps) {
    this.steps = steps;
    this.times = steps.map(s => this.run.timeOfStep.get(s));
    this.stepIndex = new Map(steps.map((s, i) => [s, i]));
  }
  indexAt(t) {
    if (!this.hasTime || !this.times.length) return 0;
    let lo = 0, hi = this.times.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.times[mid] <= t) lo = mid; else hi = mid; }
    return Math.abs(this.times[hi] - t) < Math.abs(this.times[lo] - t) ? hi : lo;
  }
  get nFrames() { return this.hasTime ? this.steps.length : 1; }
  /** Bytes one frame takes in the compact cache (prefetch budgeting). */
  get frameBytes() { return this.size * (this.isExpr || this.q?.dtype === "float16" ? 2 : 4); }
  /** Share of a frame that column range `cols` covers (in whole bands). */
  colsShare(cols) {
    if (!cols) return 1;
    const n = this.shape.at(-1), b0 = Math.floor(cols[0] / BAND), b1 = Math.ceil(cols[1] / BAND);
    return Math.min(1, Math.max(0, Math.min(n, b1 * BAND) - b0 * BAND) / n);
  }
  /** The bands (indices) column range `cols` touches; null = all. */
  bandsOf(cols) {
    const n = this.shape.at(-1), nb = Math.ceil(n / BAND);
    if (!cols) return [...Array(nb).keys()];
    const out = [];
    for (let b = Math.max(0, Math.floor(cols[0] / BAND)); b <= Math.min(nb - 1, Math.floor((cols[1] - 1) / BAND)); b++) out.push(b);
    return out.length ? out : [0];
  }
  /** True for per-step sources, where every frame is a separate fetch (worth prefetching). */
  get perStep() { return this.isExpr ? this.ops.some(o => o.perStep) : this.q.layout === "per_step"; }
}

class StoredSource extends SourceBase {
  constructor(run, name, q) {
    super(); this.q = q; this.init(run, name, q.dims); this.setSteps(this.hasTime ? q.steps : []);
    this.label = q.label || name; this.units = q.units || ""; this.description = q.description || "";
    this.section = q.section || (this.spaceDims.length >= 2 ? "maps" : "other"); this.kind = q.kind || this.label;
    // v8.25 quantity families: a member is listed in its own menu section, "along field lines ▸ gap"
    this.family = q.family || null;
    if (this.family) this.section = `${this.section} ▸ ${q.family_label || q.family}`;
  }
  stats(i) {
    const s = this.q.stats; if (!s) return null;
    const k = this.hasTime ? i : 0;
    return { min: s.min[k], max: s.max[k], minpos: s.minpos[k] };
  }
  allStats() {
    const s = this.q.stats; if (!s) return null;
    const ok = a => a.filter(v => v !== null && v !== undefined);
    const mn = ok(s.min), mx = ok(s.max), mp = ok(s.minpos);
    if (!mn.length) return null;
    return { min: Math.min(...mn), max: Math.max(...mx), minpos: mp.length ? Math.min(...mp) : null };
  }
  key(i) {
    return this.q.layout === "per_step" ? `${this.run.name}/${this.name}/${this.steps[i]}/${this.q.scales[i]}`
                                        : `${this.run.name}/${this.name}/whole/${this.run.m.updated}`;
  }
  /** v10.2 (human 2026-11-10: a map whose "first draw [does] not take forever"): row r of every output's frame (the
   *  last dim; e.g. one field line of along-line data at every output) as one Float32Array (output-major, NaN-padded).
   *  One request through serve.py's api/rows (only that row of each file is read and sent), else taken from the whole
   *  frames. Cached. */
  rowsKey(r) { return `${this.run.name}/${this.name}/rows/${r}/${this.steps.length}/${this.steps.at(-1)}/${this.q.scales?.at(-1)}`; }
  lineRowsCached(r) { return this.run.store.cache.has(this.rowsKey(r)); }
  async lineRows(r, prio = "high") {
    const st = this.run.store, q = this.q, n = this.shape.at(-1), T = this.steps.length, w = q.dtype === "float16" ? 2 : 4;
    const key = this.rowsKey(r);
    let a = st.cache.get(key, true);
    if (!a) {
      let pend = st.pending.get(key);
      if (!pend) {
        let p;
        if (st.rowsApi && q.layout === "per_step") {
          const f = `${this.run.name}/${q.path.replace("{step:05d}", "{step}")}`;
          const entry = st.net.get(`${st.rowsApi}?f=${encodeURIComponent(f)}&steps=${this.steps.join(",")}&n=${n}&w=${w}&r=${r}`, prio);
          p = entry.promise.then(buf => (w === 2 ? new Uint16Array(buf) : new Float32Array(buf)));
          pend = { p, entry };
        } else {
          p = (async () => {
            const out = w === 2 ? new Uint16Array(T * n) : new Float32Array(T * n);
            for (let i = 0; i < T; i++) { const c = await this.compactFrame(i, true, null, prio); out.set(c.subarray(r * n, (r + 1) * n), i * n); }
            return out;
          })();
          pend = { p, entry: null };
        }
        st.pending.set(key, pend);
        p.then(v => { if (v.length === T * n) st.cache.set(key, v, false); }).finally(() => st.pending.delete(key)).catch(() => {});
      }
      a = await pend.p;
      if (a.length !== T * n) throw new Error(`${this.label}: the line's rows came back with ${a.length} values, not ${T * n}`);
    }
    if (w === 4) return a;
    const out = new Float32Array(T * n);
    for (let i = 0; i < T; i++) { const sc = q.scales[i]; for (let k = i * n; k < (i + 1) * n; k++) out[k] = F16[a[k]] * sc; }
    return out;
  }
  // (v11.0's lineWindow — every field line near one position, serve.py api/window — is the aperture4 plugin's since v15.1:
  // plugins/aperture4/alongdata.js, DECISIONS D20)
  /** A per-step float16 map with ≥ 2 dims, and serve.py offers api/cols: downloaded in bands. */
  get banded() { return !!this.run.store.colsApi && this.q.layout === "per_step" && this.q.dtype === "float16" && this.spaceDims.length >= 2; }
  isCached(i, cols = null) {
    const c = this.run.store.cache, k = this.key(i);
    return c.has(k) || (this.banded && this.bandsOf(cols).every(b => c.has(`${k}#${b}`)));
  }
  /** The stored (compact) frame: a Uint16Array of float16 codes with .scale, or a Float32Array. prio = network
   *  priority. A banded frame with missing bands is marked .incomplete (never cached as a whole). */
  async compactFrame(i, low = false, cols = null, prio = "high") {
    const q = this.q, st = this.run.store, base = `${st.base}${encodeURIComponent(this.run.name)}/`;
    if (this.banded && !st.cache.has(this.key(i))) return this.bandFrame(i, low, cols, prio);
    if (q.layout === "per_step") {
      const file = q.path.replace("{step:05d}", String(this.steps[i]).padStart(5, "0"));
      return st.compact(this.key(i), base + file, q.dtype, q.scales[i], low, prio);
    }
    const whole = await st.compact(this.key(i), base + q.path, "float32", 1, low, prio);
    return this.hasTime ? whole.subarray(i * this.size, (i + 1) * this.size) : whole;
  }
  async frame(i, low = false, cols = null, prio = "high") {
    const st = this.run.store;
    if (this.banded && !st.cache.has(this.key(i))) {                  // decoded copy of these bands already made?
      const b = this.bandsOf(cols), h = st.hot.get(`${this.key(i)}#${b[0]}-${b.at(-1)}`);
      if (h) return h;
    }
    const c = await this.compactFrame(i, low, cols, prio);
    if (!(c instanceof Uint16Array)) return c;
    return c.incomplete ? decode(c) : st.decoded(c.ckey || this.key(i), c);
  }
  /** The frame assembled from its cached bands (missing ones downloaded first, bands already on their way
   *  awaited, not downloaded twice); NaN outside them. */
  async bandFrame(i, low, cols, prio = "high") {
    const st = this.run.store, k = this.key(i), n = this.shape.at(-1), rows = this.size / n, bands = this.bandsOf(cols);
    const load = async () => {
      const waits = [], missing = [];
      for (const b of bands) {
        if (st.cache.has(`${k}#${b}`)) continue;
        const pend = st.pending.get(`${k}#${b}`);
        if (pend) { if (prio === "high") st.net.promote(pend.entry); waits.push(pend.p); } else missing.push(b);
      }
      const runs = [];
      for (const b of missing) { const r = runs.at(-1); if (r && r[1] === b) r[1] = b + 1; else runs.push([b, b + 1]); }
      await Promise.all([...waits, ...runs.map(([b0, b1]) => this.fetchBands(i, b0, b1, low, prio))]);
    };
    await load();
    if (bands.some(b => !st.cache.has(`${k}#${b}`))) await load();     // a band evicted meanwhile: once more
    const out = new Uint16Array(this.size).fill(NAN16);
    for (const b of bands) {
      const part = st.cache.get(`${k}#${b}`, !low), c0 = b * BAND, w = Math.min(BAND, n - c0);
      if (!part) { out.incomplete = true; continue; }
      for (let r = 0; r < rows; r++) out.set(part.subarray(r * w, r * w + w), r * n + c0);
    }
    out.scale = this.q.scales[i]; out.ckey = `${k}#${bands[0]}-${bands.at(-1)}`;
    return out;
  }
  /** Download bands b0..b1-1 of frame i in one request and cache them band by band. */
  fetchBands(i, b0, b1, low, prio = "high") {
    const st = this.run.store, k = this.key(i);
    const n = this.shape.at(-1), rows = this.size / n, c0 = b0 * BAND, c1 = Math.min(n, b1 * BAND), W = c1 - c0;
    const file = `${this.run.name}/${this.q.path.replace("{step:05d}", String(this.steps[i]).padStart(5, "0"))}`;
    const entry = st.net.get(`${st.colsApi}?f=${encodeURIComponent(file)}&n=${n}&c0=${c0}&c1=${c1}`, prio);
    const p = entry.promise.then(buf => {
      const all = new Uint16Array(buf);
      for (let b = b0; b < b1; b++) {
        const off = b * BAND - c0, w = Math.min(BAND, n - b * BAND), part = new Uint16Array(rows * w);
        for (let row = 0; row < rows; row++) part.set(all.subarray(row * W + off, row * W + off + w), row * w);
        st.cache.set(`${k}#${b}`, part, low);
      }
    });
    for (let b = b0; b < b1; b++) st.pending.set(`${k}#${b}`, { p, entry });       // per band: no overlap twice
    return p.finally(() => { for (let b = b0; b < b1; b++) st.pending.delete(`${k}#${b}`); });
  }
}

// ---- expressions ----------------------------------------------------------------------------------------
const FUNCS = {
  sqrt: "Math.sqrt", abs: "Math.abs", log: "Math.log", ln: "Math.log", log10: "Math.log10", exp: "Math.exp",
  sin: "Math.sin", cos: "Math.cos", tan: "Math.tan", asin: "Math.asin", acos: "Math.acos",
  atan: "Math.atan", atan2: "Math.atan2", sign: "Math.sign", min: "Math.min", max: "Math.max",
  pow: "Math.pow", deg: "((x)=>x*180/Math.PI)",
};
function tokenize(s) {
  // v8.25: dotted names (a family's member, gap.voltage) and comparisons (>=, <, ==, …)
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*)|(\*\*|>=|<=|==|!=|[-+*/^(),<>]))/y;
  const out = [];
  re.lastIndex = 0;
  while (re.lastIndex < s.length) {
    const at = re.lastIndex;
    if (/^\s*$/.test(s.slice(at))) break;
    const m = re.exec(s);
    if (!m) throw new Error(`can't read "${s.slice(at).trim()}"`);
    out.push(m[1] ? { t: "num", v: m[1] } : m[2] ? { t: "id", v: m[2] } : { t: "op", v: m[3] === "**" ? "^" : m[3] });
  }
  return out;
}
function compile(src, resolve) {
  const tk = tokenize(src); let p = 0;
  const peek = () => tk[p], eat = v => { if (!tk[p] || tk[p].v !== v) throw new Error(`expected "${v}"`); p++; };
  // v8.25 (human 2026-11-09: cheap quantities "from precached things", e.g. gap on = |V| >= V_min): a comparison is 1 or 0
  const CMP = { ">": ">", "<": "<", ">=": ">=", "<=": "<=", "==": "===", "!=": "!==" };
  const cmp = () => { let a = expr(); while (peek() && CMP[peek().v]) { const o = CMP[tk[p++].v]; a = `((${a})${o}(${expr()})?1:0)`; } return a; };
  const expr = () => { let a = term(); while (peek() && (peek().v === "+" || peek().v === "-")) { const o = tk[p++].v; a = `(${a}${o}${term()})`; } return a; };
  const term = () => { let a = unary(); while (peek() && (peek().v === "*" || peek().v === "/")) { const o = tk[p++].v; a = `(${a}${o}${unary()})`; } return a; };
  const unary = () => { if (peek() && peek().v === "-") { p++; return `(-${unary()})`; } if (peek() && peek().v === "+") { p++; return unary(); } return power(); };
  const power = () => { const a = atom(); if (peek() && peek().v === "^") { p++; return `Math.pow(${a},${unary()})`; } return a; };
  const atom = () => {
    const t = tk[p++];
    if (!t) throw new Error("unexpected end");
    if (t.t === "num") return t.v;
    if (t.v === "(") { const a = cmp(); eat(")"); return `(${a})`; }
    if (t.t === "id") {
      if (peek() && peek().v === "(") {
        if (!FUNCS[t.v] && !LOGIC.has(t.v)) throw new Error(`unknown function ${t.v}()`);
        p++; const args = [];
        if (peek() && peek().v !== ")") { args.push(cmp()); while (peek() && peek().v === ",") { p++; args.push(cmp()); } }
        eat(")");
        if (t.v === "where") { if (args.length !== 3) throw new Error("where(condition, value if true, value if false)"); return `((${args[0]})?(${args[1]}):(${args[2]}))`; }
        if (t.v === "and" || t.v === "or") { if (args.length < 2) throw new Error(`${t.v}(a, b, …)`); return `((${args.map(a => `(${a})`).join(t.v === "and" ? "&&" : "||")})?1:0)`; }
        if (t.v === "not") { if (args.length !== 1) throw new Error("not(a)"); return `((${args[0]})?0:1)`; }
        return `${FUNCS[t.v]}(${args.join(",")})`;
      }
      return resolve(t.v);
    }
    throw new Error(`unexpected "${t.v}"`);
  };
  const code = cmp();
  if (p < tk.length) throw new Error(`unexpected "${tk[p].v}"`);
  return code;
}
const LOGIC = new Set(["where", "and", "or", "not"]);

/** A function line's formula y = f(x) (v5.13): names are x, t (the slider's time), pi, e, variables (isVar(name);
 *  read through V(name) at every evaluation, so lists and measured values work) and the numbers of a dataset's
 *  config. Returns {f: (x, t, V) => y, vars: the variable names used}. Same grammar as the expressions.
 *  `more`: further names, passed after V (v8.17: a y axis function's y: f(x, t, V, y)). */
export function compileFunction(expr, conf = {}, isVar = () => false, more = []) {
  const vars = [];
  const code = compile(String(expr), id => {
    if (id === "x" || id === "t" || more.includes(id)) return id;
    if (id === "pi") return "Math.PI";
    if (id === "e") return "Math.E";
    if (isVar(id)) { if (!vars.includes(id)) vars.push(id); return `V(${JSON.stringify(id)})`; }
    if (typeof conf[id] === "number") return String(conf[id]);
    throw new Error(`unknown name "${id}" (use x, ${more.map(m => m + ", ").join("")}t, a number variable, or a number from the dataset's config)`);
  });
  return { f: new Function("x", "t", "V", ...more, `return ${code};`), vars };
}

class ExprSource extends SourceBase {
  constructor(run, name, def) {
    super();
    this.def = def; this.expr = def.expr; this.label = def.label || name; this.units = def.units || ""; this.isExpr = true;   // v14.6: [group | units]
    this.description = `expression: ${def.expr}`; this.section = def.section || "expressions"; this.kind = def.kind || this.label;
    // v8.25 derived quantities (human 2026-11-09): an expression may use other expressions, a family's members
    // (gap.voltage) and the sidebar's number / measured variables (V_min: read at every draw, part of the cache key)
    const ops = [], coordsUsed = [], conf = run.conf, vars = [];
    const resolve = id => {
      if (id === "pi") return "Math.PI";
      if (id === "e") return "Math.E";
      const s = run.sources[id];
      if (s && s.name !== name && !s.isAn) { if (!ops.includes(s)) ops.push(s); return `Q[${ops.indexOf(s)}][i]`; }
      if (run.coord(id)) { if (!coordsUsed.includes(id)) coordsUsed.push(id); return `C[${coordsUsed.indexOf(id)}][i]`; }
      if (varValue(id) !== undefined) { if (!vars.includes(id)) vars.push(id); return `V[${vars.indexOf(id)}]`; }
      if (id in conf && typeof conf[id] === "number") return String(conf[id]);
      throw new Error(`unknown name "${id}"`);
    };
    const code = compile(def.expr, resolve);
    if (!ops.length) throw new Error("an expression needs at least one stored quantity");
    this.vars = vars;
    // a derived member of a family (gap.on) is listed with the family
    const fam = name.includes(".") ? ops.find(o => o.family === name.split(".")[0]) : null;
    if (fam && !def.section) { this.section = fam.section; this.family = fam.family; }
    const d0 = JSON.stringify(ops[0].dims);
    for (const o of ops) if (JSON.stringify(o.dims) !== d0) throw new Error(`${o.name} has dims ${o.dims}, ${ops[0].name} has ${ops[0].dims}`);
    this.ops = ops;
    this.init(run, name, ops[0].dims);
    for (const c of coordsUsed) if (!this.coordDim(c)) throw new Error(`"${c}" is not a coordinate of ${this.spaceDims}`);
    this.coordsUsed = coordsUsed;
    this.fn = new Function("Q", "C", "n", "V", `const out=new Float32Array(n);for(let i=0;i<n;i++){out[i]=${code};}return out;`);
    let steps = ops[0].hasTime ? ops[0].steps : [];
    for (const o of ops.slice(1)) if (o.hasTime) { const set = new Set(o.steps); steps = steps.filter(s => set.has(s)); }
    this.setSteps(steps);
  }
  coordDim(c) {
    for (const d of this.spaceDims) {
      if (d === c) return { dim: d, values: this.run.m.coords[d].values };
      const alt = this.run.m.coords[d].alt;
      if (alt && alt[c]) return { dim: d, values: alt[c].values };
    }
    return null;
  }
  coordArray(c) {
    const key = `${this.run.name}/coord/${c}/${this.spaceDims}`;
    const hit = this.run.store.cache.get(key);
    if (hit) return hit;
    const { dim, values } = this.coordDim(c), k = this.spaceDims.indexOf(dim);
    const n = this.shape[k], stride = this.strides[k], out = new Float32Array(this.size);
    for (let i = 0; i < this.size; i++) out[i] = values[Math.floor(i / stride) % n];
    this.run.store.cache.set(key, out);
    return out;
  }
  stats() { return null; }
  allStats() { return null; }
  key(i) { return `${this.run.name}/expr/${this.expr}/${this.hasTime ? this.steps[i] : "static"}/${this.run.m.updated}` + (this.vars.length ? `/${this.varVals().join(",")}` : ""); }
  varVals() { return this.vars.map(n => { const v = varValue(n); return Number(Array.isArray(v) ? v[0] : v); }); }
  /** Cache key of the result for column range `cols` (the band span when the inputs come in bands). */
  colsKey(i, cols) {
    const o = this.ops.find(x => x.banded);
    if (!o || !cols) return this.key(i);
    const b = o.bandsOf(cols);
    return `${this.key(i)}#${b[0]}-${b.at(-1)}`;
  }
  isCached(i, cols = null) { const c = this.run.store.cache; return c.has(this.key(i)) || c.has(this.colsKey(i, cols)); }
  async frame(i, low = false, cols = null, prio = "high") {
    const st = this.run.store;
    for (const k of [this.key(i), this.colsKey(i, cols)]) { const hit = st.cache.get(k); if (hit) return st.decoded(k, hit); }
    const key = this.colsKey(i, cols), step = this.hasTime ? this.steps[i] : null;
    let incomplete = false;
    const Q = await Promise.all(this.ops.map(async o => {          // inputs: low priority, decoded temporarily
      const k = o.hasTime ? o.stepIndex.get(step) : 0;
      if (o.isExpr) return o.frame(k, true, cols, prio);              // (v8.25: another expression, already decoded)
      const c = await o.compactFrame(k, true, cols, prio);
      if (c.incomplete) incomplete = true;
      return c instanceof Uint16Array ? decode(c) : c;
    }));
    const out = this.fn(Q, this.coordsUsed.map(c => this.coordArray(c)), this.size, this.varVals());
    if (incomplete) return out;                                   // never cache a result with missing bands
    st.cache.set(key, this.size > 4096 ? encode(out) : out);
    st.hot.set(key, out);
    return out;
  }
  /** The result as float16 codes (.scale) for the palette painter: computed if needed, then taken from the
   *  cache; null when it is kept as float32 (small) or could not be cached (missing bands). */
  async compactFrame(i, low = false, cols = null, prio = "high") {
    await this.frame(i, low, cols, prio);
    const st = this.run.store;
    for (const k of [this.key(i), this.colsKey(i, cols)]) { const c = st.cache.get(k); if (c instanceof Uint16Array) { c.ckey = k; return c; } }
    return null;
  }
}

// ---- analytic functions (v7) ----------------------------------------------------------------------------
/** v7 (human 2026-10-13: "better methods for plotting analytic functions … define a new thing like
 *  Twist_angle_analytic = 2 * {line_current} * {r_max}^2 * sqrt(1 - 1/{r_max}) / {Bp}"): a formula whose {names} are
 *  parameters, filled in where it is used. Same grammar as the expressions; bare names: pi, e and functions only.
 *  Returns {params (in order of appearance), f: P => value, P = the values in params order}. */
export function compileAnalytic(formula) {
  const params = [];
  const text = String(formula).replace(/\{\s*([A-Za-z_]\w*)\s*\}/g, (_, n) => { if (!params.includes(n)) params.push(n); return `__P${params.indexOf(n)}`; });
  if (/[{}]/.test(text)) throw new Error("a { or } that is not part of a {name}");
  const code = compile(text, id => {
    const m = id.match(/^__P(\d+)$/);
    if (m) return `P[${m[1]}]`;
    if (id === "pi") return "Math.PI";
    if (id === "e") return "Math.E";
    throw new Error(`"${id}": parameters go in braces, {${id}}`);
  });
  return { params, f: new Function("P", `return ${code};`) };
}
/** Parse the analytic functions box: one `name = formula  # label [y quantity]` per line (the [ ] part says which y
 *  axis it belongs on, e.g. [twist angle]; default: the label). Returns {defs, errors}. */
export function parseAnalyticText(text) {
  const defs = {}, errors = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z_0-9]*)\s*=\s*([^#]+?)\s*(?:#\s*(.*))?$/);
    if (!m) { errors.push(`can't read: ${line}`); continue; }
    let label = (m[3] || "").trim(), kind = null;
    const k = label.match(/\[([^\]]+)\]\s*$/);
    if (k) { kind = k[1].trim(); label = label.slice(0, k.index).trim(); }
    try { const c = compileAnalytic(m[2]); defs[m[1]] = { name: m[1], formula: m[2], label: label || m[1], kind: kind || label || m[1], params: c.params, f: c.f }; }
    catch (e) { errors.push(`${m[1]}: ${e.message}`); }
  }
  return { defs, errors };
}
let varValue = () => undefined;          // the app's variables: name -> value now (number, list, measured) or undefined
export function setVarValue(fn) { varValue = fn; }
/** An analytic function on the grid of a run (v7, for 2D maps). Its {names} are taken BY NAME: a stored quantity
 *  (same output), a coordinate (r, theta, r_max, theta_foot …), t / time (the output's time), a number of the run's
 *  config, else a number / measured variable (its value now; a list: its first value). Dims: those of its quantities,
 *  else those of the first stored quantity that has its coordinates (with time only if it uses t). */
class AnalyticSource extends SourceBase {
  constructor(run, name, def) {
    super();
    this.def = def; this.isExpr = true; this.isAn = true; this.label = def.label; this.units = ""; this.kind = def.kind;
    this.description = `analytic: ${def.formula}`; this.section = "analytic functions";
    const conf = run.conf, ops = [], coordsUsed = [], vars = [];
    let usesT = false;
    this.how = def.params.map(p => {
      const s = run.sources[p];
      if (s && !s.isExpr) { if (!ops.includes(s)) ops.push(s); return ["Q", ops.indexOf(s)]; }
      if (run.coord(p)) { if (!coordsUsed.includes(p)) coordsUsed.push(p); return ["C", coordsUsed.indexOf(p)]; }
      if (p === "t" || p === "time") { usesT = true; return ["T"]; }
      if (typeof conf[p] === "number") return ["K", conf[p]];
      vars.push(p); return ["V", vars.length - 1];
    });
    const hasCoords = s => coordsUsed.every(c => s.spaceDims.some(d => d === c || run.m.coords[d].alt?.[c]));
    let grid = ops[0];
    if (ops.length) {
      const d0 = JSON.stringify(ops[0].dims);
      for (const o of ops) if (JSON.stringify(o.dims) !== d0) throw new Error(`${o.name} has dims ${o.dims}, ${ops[0].name} has ${ops[0].dims}`);
    } else {
      grid = Object.values(run.sources).find(s => !s.isExpr && s.spaceDims.length && hasCoords(s) && (!usesT || s.hasTime));
      if (!coordsUsed.length || !grid) throw new Error(coordsUsed.length ? `nothing stored has the coordinates ${coordsUsed.join(", ")}` : "a map needs a {quantity} or {coordinate} of this dataset");
    }
    this.ops = ops; this.coordsUsed = coordsUsed; this.vars = vars;
    this.init(run, name, ops.length || usesT ? grid.dims : grid.spaceDims);
    for (const c of coordsUsed) if (!this.coordDim(c)) throw new Error(`"${c}" is not a coordinate of ${this.spaceDims}`);
    let steps = this.hasTime ? grid.steps : [];
    for (const o of ops) if (o.hasTime) { const set = new Set(o.steps); steps = steps.filter(x => set.has(x)); }
    this.setSteps(steps);
  }
  varVals() { return this.vars.map(n => { const v = varValue(n); return Number(Array.isArray(v) ? v[0] : v); }); }
  key(i) { return `${this.run.name}/an/${this.def.formula}/${this.hasTime ? this.steps[i] : "static"}/${this.run.m.updated}/${this.varVals().join(",")}`; }
  async frame(i, low = false, cols = null, prio = "high") {
    const st = this.run.store;
    for (const k of [this.key(i), this.colsKey(i, cols)]) { const hit = st.cache.get(k); if (hit) return st.decoded(k, hit); }
    const key = this.colsKey(i, cols), step = this.hasTime ? this.steps[i] : null;
    let incomplete = false;
    const Q = await Promise.all(this.ops.map(async o => {
      const c = await o.compactFrame(o.hasTime ? o.stepIndex.get(step) : 0, true, cols, prio);
      if (c.incomplete) incomplete = true;
      return c instanceof Uint16Array ? decode(c) : c;
    }));
    const C = this.coordsUsed.map(c => this.coordArray(c)), V = this.varVals(), T = this.hasTime ? this.times[i] : NaN;
    const arr = this.how.map(h => (h[0] === "Q" ? Q[h[1]] : h[0] === "C" ? C[h[1]] : null));
    const val = this.how.map(h => (h[0] === "K" ? h[1] : h[0] === "T" ? T : h[0] === "V" ? V[h[1]] : 0));
    const n = this.how.length, P = new Array(n), f = this.def.f, out = new Float32Array(this.size);
    for (let j = 0; j < this.size; j++) {
      for (let k = 0; k < n; k++) P[k] = arr[k] ? arr[k][j] : val[k];
      out[j] = f(P);
    }
    if (incomplete) return out;
    st.cache.set(key, this.size > 4096 ? encode(out) : out);
    st.hot.set(key, out);
    return out;
  }
}
for (const k of ["coordDim", "coordArray", "colsKey", "isCached", "compactFrame", "stats", "allStats"]) AnalyticSource.prototype[k] = ExprSource.prototype[k];

/** Parse the expressions box: one `name = expr  # label [y-axis group | units]` per line. Returns {defs, errors}.
 *  v14.6 (human 2026-11-13, Phase 4: "go for it"): the optional [ ] part, as analytic functions have it, says which
 *  y-axis group it is drawn in (it then shares a y axis with stored quantities of that group) and its units. */
export function parseExpressionText(text) {
  const defs = {}, errors = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    // (v8.25: a name may be dotted, a derived member of a family: gap.on = abs(gap.voltage) >= V_min)
    const m = line.match(/^([A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*)\s*=\s*([^#]+?)\s*(?:#\s*(.*))?$/);
    if (!m) { errors.push(`can't read: ${line}`); continue; }
    let label = (m[3] || "").trim(), kind = null, units = null;
    const k = label.match(/\[([^\]]+)\]\s*$/);
    if (k) { [kind, units] = k[1].split("|").map(x => x.trim() || null); label = label.slice(0, k.index).trim(); }
    try { tokenize(m[2]); defs[m[1]] = { expr: m[2], label: label || m[1], ...(kind ? { kind } : {}), ...(units ? { units } : {}) }; }
    catch (e) { errors.push(`${m[1]}: ${e.message}`); }
  }
  return { defs, errors };
}
