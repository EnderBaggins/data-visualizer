// panel2d.js — 2D colour-map panels: one colour layer (+ tools). Linked panels are rendered together, and
// those with the same colour settings share one colour range ("together", human 2026-10-01).
// Zoom/pan/click-to-edit. Canvas height = width × aspect (lock = keep that ratio while resizing).
import * as R from "./render.js";
import { S, eff, srcOf, isSpherical, dimCoord, indexer, pickIndex, parseListRefs, extent, axisLabel, ctxPanel, runOf, numOf, listOf, toolRules, resolved, num1, subVars, outsideNote } from "./model.js";
import { editText, wheelFactor, dmLink, tipAt } from "./ui.js";
import { fontSize, runTip } from "./vars.js";
import { CONTOUR_LEVELS, panelRun, setRunContext, setViewContext, dataKindOf, missingKindOf, missingKindText, isRef, setToolValues, varOf, listColor, toolLabel } from "./model.js";
import { F16_TABLE } from "./data.js";
import { canCompute, jobFor, computeBox } from "./cacheable.js";
import { drawLineouts, loColors } from "./lineout.js";   // v14.2

const COLOR_KEYS = ["q", "cmap", "reverse", "norm", "limits", "vmin", "vmax", "vsym", "symmetric", "decades", "abs", "linthresh", "slope", "smooth"];

export function axesFor(s, src) {
  const k = dataKindOf(src);                              // v15.1: a data kind's map has its own axes
  if (k?.mapAxes) return k.mapAxes(s, src);
  if (src.dims.includes(s.xdim) && src.dims.includes(s.ydim) && s.xdim !== s.ydim) return [s.xdim, s.ydim];
  const g = src.run.m.geometry?.spherical, d = src.spaceDims;
  if (g && d.includes(g.r) && d.includes(g.theta)) return [g.r, g.theta];
  if (d.length >= 2) return [d[d.length - 1], d[d.length - 2]];   // v15.3: (…, y, x) data opens as x × y
  const all = src.hasTime ? ["time", ...d] : d;
  return [all[0], all[1] ?? all[0]];
}

function timesNeeded(s, src, xd, yd) {
  const k = dataKindOf(src);                              // v15.1: a data kind's map reads its own data (mapLoad)
  if (k?.mapTimes) return k.mapTimes(s, src, xd, yd);
  if (!src.hasTime) return { list: [0], fixed: 0, axis: false };
  if (xd === "time" || yd === "time") return { list: [...Array(src.nFrames).keys()], fixed: 0, axis: true };
  const ft = numOf(s.fixedTime);
  const i = s.timeMode === "fixed" ? src.indexAt(isFinite(ft) && ft !== null ? ft : src.times.at(-1)) : src.indexAt(S.t);
  // v8.13 (human 2026-10-20: "can I average over a couple times of my 2d plot?" → "lets do plus minus"): the outputs
  // i − N … i + N around the time shown (cut at the run's ends), averaged pixel by pixel
  // v10.1.1: the outputs within t ± h (h in R*/c, as a profile's time average; the outputs are 1 R*/c apart, so ± N is
  // what ± N outputs was), at most 101
  const h = num1(s.avg, 0);
  if (h > 0) {
    const t0 = src.times[i], list = [];
    for (let j = 0; j < src.nFrames; j++) if (Math.abs(src.times[j] - t0) <= h + 1e-9 * Math.max(1, Math.abs(t0))) list.push(j);
    while (list.length > 101) { if (list[list.length - 1] - i > i - list[0]) list.pop(); else list.shift(); }
    if (list.length > 1) return { list, fixed: i, axis: false, avg: list };
  }
  return { list: [i], fixed: i, axis: false };
}
/** The per-step sources a 2D panel draws at the current time, with the columns its zoom needs (v5.1;
 *  from its last render, L.cols): [{src, cols}] for the prefetcher. */
export function followSource2D(panel, L = null) {
  const s = eff(panel), src = srcOf(s.run, s.q);
  if (!src || !src.hasTime) return [];
  const [xd, yd] = axesFor(s, src);
  if (xd === "time" || yd === "time" || s.timeMode === "fixed") return [];
  const cols = L?.cols ?? lastCols.get(panel.id) ?? null, out = [{ src, cols }];
  for (const t of s.tools || []) if (t.type === "contour" && t.visible) { const c = srcOf(s.run, t.q ?? s.q); if (c && c.hasTime) out.push({ src: c, cols: contourCols(cols, src, c) }); }
  return out;
}
/** Columns of the last (contiguous) dim — r for θ × r maps — that view `v` needs: [c0, c1), or null = all.
 *  Meridional: the r range of the view box (nearest point … farthest corner). One cell of margin. */
function colsFor(s, src, xd, yd, merid, v) {
  const cd = src.spaceDims.at(-1), vals = dimCoord(src, cd).values, n = vals.length;
  const lo0 = Math.min(vals[0], vals[n - 1]), hi0 = Math.max(vals[0], vals[n - 1]);
  const span = (a, b) => {
    if (!(isFinite(a) && isFinite(b))) return null;
    const f = indexer(vals), clamp = x => Math.min(hi0, Math.max(lo0, x));
    const i = f(clamp(Math.min(a, b))), j = f(clamp(Math.max(a, b)));
    if (i < 0 || j < 0) return null;
    return [Math.max(0, Math.min(i, j) - 1), Math.min(n, Math.max(i, j) + 2)];
  };
  if (merid) {
    if (cd !== src.run.m.geometry.spherical.r) return null;
    const x0 = s.mirror ? v.x0 : Math.max(0, v.x0), x1 = v.x1;
    const dx = x0 > 0 ? x0 : x1 < 0 ? -x1 : 0, dy = v.y0 > 0 ? v.y0 : v.y1 < 0 ? -v.y1 : 0;
    return span(Math.hypot(dx, dy), Math.max(...[x0, x1].flatMap(x => [v.y0, v.y1].map(y => Math.hypot(x, y)))));
  }
  if (xd === cd) return span(v.x0, v.x1);
  if (yd === cd) return span(v.y0, v.y1);
  const i = pickIndex(src, cd, s.picks?.[cd]);
  return [i, i + 1];
}
/** The contour tool reads each field line's level at r index 0 (the surface): from column 0 on. */
const contourCols = (cols, src, csrc) => (cols && csrc.spaceDims.at(-1) === src.spaceDims.at(-1) ? [0, cols[1]] : null);

function pickOffset(s, src, xd, yd) {
  let off = 0;
  src.spaceDims.forEach((d, k) => { if (d !== xd && d !== yd) off += pickIndex(src, d, s.picks?.[d]) * src.strides[k]; });
  return off;
}

function defaultView(s, src, xd, yd, merid) {
  if (merid) {
    const g = src.run.m.geometry.spherical, rc = src.run.m.coords[g.r].values, Rm = rc[rc.length - 1];
    return { x0: s.mirror ? -Rm : 0, x1: Rm, y0: -Rm, y1: Rm };
  }
  const ext = d => { const v = dimCoord(src, d).values; return extent((d === xd ? s.logx : s.logy) ? v.filter(x => x > 0) : v); };
  const [x0, x1] = ext(xd), [y0, y1] = ext(yd);
  return { x0, x1, y0, y1 };
}
/** ± (v5.12): an axis centred on 0. */
function symView(s, v) {
  const half = (a, b) => Math.max(Math.abs(a), Math.abs(b));
  if (s.xsym && !s.logx) { const h = half(v.x0, v.x1); v = { ...v, x0: -h, x1: h }; }
  if (s.ysym && !s.logy) { const h = half(v.y0, v.y1); v = { ...v, y0: -h, y1: h }; }
  return v;
}
function equalAspect(v, plot) {
  const sx = (v.x1 - v.x0) / plot.w, sy = (v.y1 - v.y0) / plot.h, k = Math.max(sx, sy);
  const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
  return { x0: cx - k * plot.w / 2, x1: cx + k * plot.w / 2, y0: cy - k * plot.h / 2, y1: cy + k * plot.h / 2 };
}

/** For each plot pixel: which frame (time index, -1 = the fixed one) and flat offset to read. Cached. */
function address(sp, s, src, xd, yd, merid, plot, ax, ay) {
  const picked = src.spaceDims.filter(d => d !== xd && d !== yd).map(d => pickIndex(src, d, s.picks?.[d]));    // resolved (picks may follow variables)
  const key = JSON.stringify([merid, s.mirror, plot.w, plot.h, ax.v0, ax.v1, ay.v0, ay.v1, ax.log, ay.log, xd, yd, picked, src.run.name, src.name, src.nFrames]);
  if (sp.addrKey === key) return sp.addr;
  const W = plot.w, H = plot.h, flat = new Int32Array(W * H), tsel = new Int32Array(W * H).fill(-1);
  const base = pickOffset(s, src, xd, yd), sd = src.spaceDims;
  if (merid) {
    const g = src.run.m.geometry.spherical, kr = sd.indexOf(g.r), kt = sd.indexOf(g.theta);
    const rc = src.run.m.coords[g.r].values, tc = src.run.m.coords[g.theta].values;
    for (let j = 0; j < H; j++) {
      const Y = ay.from(plot.y + j + 0.5);
      for (let i = 0; i < W; i++) {
        let X = ax.from(plot.x + i + 0.5);
        if (X < 0) { if (!s.mirror) { flat[j * W + i] = -1; continue; } X = -X; }
        const ir = R.nearestIndex(rc, Math.hypot(X, Y)), it = R.nearestIndex(tc, Math.atan2(X, Y));
        flat[j * W + i] = ir < 0 || it < 0 ? -1 : base + ir * src.strides[kr] + it * src.strides[kt];
      }
    }
  } else {
    const idx = (d, a, n, p0) => { const f = indexer(dimCoord(src, d).values), out = new Int32Array(n); for (let i = 0; i < n; i++) out[i] = f(a.from(p0 + i + 0.5)); return out; };
    const xi = idx(xd, ax, W, plot.x), yi = idx(yd, ay, H, plot.y);
    const sx = xd === "time" ? 0 : src.strides[sd.indexOf(xd)], sy = yd === "time" ? 0 : src.strides[sd.indexOf(yd)];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const a = xi[i], b = yi[j], k = j * W + i;
      if (a < 0 || b < 0) { flat[k] = -1; continue; }
      flat[k] = base + (xd === "time" ? 0 : a * sx) + (yd === "time" ? 0 : b * sy);
      if (xd === "time") tsel[k] = a; else if (yd === "time") tsel[k] = b;
    }
  }
  sp.addrKey = key; sp.addr = { flat, tsel };
  return sp.addr;
}

function scan(arrs, abs, out = { lo: Infinity, hi: -Infinity, mp: Infinity }) {
  for (const a of arrs) for (let i = 0; i < a.length; i++) {
    let v = a[i]; if (v !== v) continue; if (abs) v = Math.abs(v);
    if (v < out.lo) out.lo = v; if (v > out.hi) out.hi = v;
    const m = Math.abs(v); if (m > 0 && m < out.mp) out.mp = m;
  }
  return out;
}

function finishLimits(s, st) {
  let { lo, hi, mp } = st;
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  let vmin = lo, vmax = hi;
  if (s.limits === "manual") {
    vmin = s.vmin ?? lo; vmax = s.vmax ?? hi;
    if (s.vsym && s.norm !== "log") { const m = Math.max(Math.abs(vmin), Math.abs(vmax)); vmin = -m; vmax = m; }   // ± (v6.3)
  }
  else if (s.symmetric && s.norm !== "log") { const m = Math.max(Math.abs(lo), Math.abs(hi)); vmin = -m; vmax = m; }
  if (s.norm === "log") {
    if (s.limits !== "manual") { vmax = Math.max(Math.abs(lo), Math.abs(hi)); vmin = Math.max(isFinite(mp) ? mp : vmax * 1e-6, vmax * 10 ** -(s.decades || 4)); }
    if (!(vmin > 0)) vmin = vmax * 1e-4;
  }
  if (!(vmax > vmin)) { const d = Math.abs(vmax) * 1e-3 || 1; vmin -= d; vmax += d; }
  return { vmin, vmax };
}

// ---- contours (tool) ---------------------------------------------------------------------------------------
const CONTOURS = new Map();
function contours(csrc, i, frame, tool, cols) {
  let levels = parseListRefs(tool.levels);                                  // may name variables (v5)
  const key = `${csrc.run.name}/${csrc.name}/${i}/${tool.levelMode}/${levels.join(",")}/${cols ? cols[1] : "all"}`;
  if (CONTOURS.has(key)) return CONTOURS.get(key);
  const [d0, d1] = csrc.spaceDims, c0 = csrc.run.m.coords[d0].values, c1 = csrc.run.m.coords[d1].values;
  const ny = c0.length, nx = c1.length, g = csrc.run.m.geometry?.spherical;
  const mode = CONTOUR_LEVELS.find(m => m.key === tool.levelMode);           // v15.0: a plugin's level mode (aperture4: r_max footpoints)
  if (mode) levels = mode.levels({ levels, frame, dims: [d0, d1], coords: [c0, c1], run: csrc.run, geometry: g }) || [];
  else if (tool.levelMode && tool.levelMode !== "values") levels = [];   // a plugin's level mode with the plugin off: nothing (not wrong lines)
  const segs = levels.filter(isFinite).map(lv => R.contourSegments(frame, ny, nx, lv));
  CONTOURS.set(key, segs);
  if (CONTOURS.size > 600) CONTOURS.delete(CONTOURS.keys().next().value);
  return segs;
}

async function drawTools(ctx, it, plot, ax, ay, dpr) {
  const { s, src, xd, yd, merid, need } = it;
  for (const t of s.tools || []) {
    if (!t.visible) continue;
    if (t.type === "lineout") {                          // v14.2: where the lineouts are; their plots redraw when they move
      drawLineouts(ctx, t, it, plot, ax, ay, dpr);
      const sig = JSON.stringify([t.at, t.along, s.run, s.q, s.picks ?? null, s.at ?? null, s.smooth ?? null, s.slope ?? null, isRef(t.at) ? listOf(t.at) : null,
        loColors(t), t.listColors ?? null, t.color ?? null]);                    // v14.3: colours too (the curves follow)
      setToolValues(it.panel.id, t.id, { lineout: true }, sig);   // v14.4: its plots redraw when this changes (results.js change bus)
      continue;
    }
    // v14.5 (RULES P4: "a halo is available on every map line"): a contrasting edge under the line
    const tx = { dataset: runOf(s.run) ?? "", t: R.fmt(S.t) };   // v11.1: {dataset}, {t} in labels
    if (t.type === "line" && t.mode === "time") {        // v14.5.1: the line at the slider's time, across whichever axis is time
      for (const [v, col] of toolRules(t)) {
        if (xd === "time") R.drawToolRule(ctx, plot, ax, v, true, col, num1(t.width, 1), t.dash, { halo: t.halo, label: toolLabel(t, v, tx) }, dpr);
        if (yd === "time") R.drawToolRule(ctx, plot, ay, v, false, col, num1(t.width, 1), t.dash, { halo: t.halo, label: toolLabel(t, v, tx) }, dpr);
      }
    } else if (t.type === "line") {
      for (const [v, col] of toolRules(t))                 // v14.5.1: the one rule drawer and label rule (render.js, model.js)
        R.drawToolRule(ctx, plot, t.orient === "v" ? ax : ay, v, t.orient === "v", col, num1(t.width, 1.2), t.dash, { halo: t.halo, label: toolLabel(t, v, tx) }, dpr);
    } else if (t.type === "band") {                     // v12.0 (draw): a band in the plot's own x / y
      const vert = t.orient !== "h", lo = num1(t.lo, NaN), hi = num1(t.hi, NaN);
      R.drawBand(ctx, plot, vert ? ax : ay, lo, hi, vert, t.color, num1(t.alpha, 0.15), dpr);
      if (t.label) R.drawRuleLabel(ctx, plot, vert ? ax : ay, Math.min(lo, hi), vert, t.color, subVars(t.label, { dataset: runOf(s.run) ?? "", t: R.fmt(S.t) }), dpr);
    } else if (t.type === "point") {                    // v12.0 (draw): a point at x, y (lists: one per pair)
      const xs = listOf(t.x), ys = listOf(t.y), n = Math.max(xs.length, ys.length);
      for (let k = 0; k < n; k++) R.drawPoint(ctx, plot, ax, ay, xs[Math.min(k, xs.length - 1)], ys[Math.min(k, ys.length - 1)], t.color, num1(t.size, 5), t.label ? subVars(t.label, { dataset: runOf(s.run) ?? "", t: R.fmt(S.t) }) : null, dpr);
    } else if (t.type === "contour") {
      const e = it.tools.get(t.id);                    // fetched together with the maps (render2D, v5.2)
      if (!e || !e.frame) continue;
      const { csrc, ci, cc, frame } = e;
      const [d0, d1] = csrc.spaceDims, c0 = csrc.run.m.coords[d0].values, c1 = csrc.run.m.coords[d1].values;
      ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
      const lw = num1(t.width, 1.2) * R.STYLE.lineScale * dpr, lvs = contours(csrc, ci, frame, t, cc);
      // v14.5 (RULES P4): "list colours" = each level its list's colour (a list variable's own colours, else the series
      // colours); a halo = a contrasting edge under each line
      const lref = String(t.levels ?? "").trim(), lvar = /^\$?[A-Za-z_]\w*$/.test(lref) ? varOf("$" + lref.replace(/^\$/, "")) : null;
      const colOf = k => (t.listColors && lvs.length > 1 ? listColor(lvar, k) : t.color);
      for (const pass of t.halo ? ["halo", "line"] : ["line"]) for (const [k, segs] of lvs.entries()) {
        ctx.strokeStyle = pass === "halo" ? R.haloOf(colOf(k)) : colOf(k); ctx.lineWidth = pass === "halo" ? lw + 2.4 * dpr : lw;
        ctx.beginPath();
        for (const [j0, i0, j1, i1] of segs) {
          const a0 = R.coordAt(c0, j0), b0 = R.coordAt(c1, i0), a1 = R.coordAt(c0, j1), b1 = R.coordAt(c1, i1);
          const v0 = { [d0]: a0, [d1]: b0 }, v1 = { [d0]: a1, [d1]: b1 };
          if (merid) {
            const g = csrc.run.m.geometry.spherical;
            for (const sg of s.mirror ? [1, -1] : [1]) {
              ctx.moveTo(ax.to(sg * v0[g.r] * Math.sin(v0[g.theta])), ay.to(v0[g.r] * Math.cos(v0[g.theta])));
              ctx.lineTo(ax.to(sg * v1[g.r] * Math.sin(v1[g.theta])), ay.to(v1[g.r] * Math.cos(v1[g.theta])));
            }
          } else { ctx.moveTo(ax.to(v0[xd]), ay.to(v0[yd])); ctx.lineTo(ax.to(v1[xd]), ay.to(v1[yd])); }
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

// ---- render 2D panels (one, or all panels of a link group together) ------------------------------------------
/** Margins (CSS px) of a 2D plot: shared axes hide labels, a top colour bar trades width for height. */
export function margins2D(fig, cbarTop) {
  const m = R.axisMargins();                            // from the desktop style (v5.8)
  return { l: fig?.hideY ? 8 : m.l, r: cbarTop ? 16 : R.cbarRight(), t: cbarTop ? R.topMargins().t : m.t, b: fig?.hideX ? 8 : m.b };
}
export const cbarIsTop = (s, fig) => (s.cbarPos === "top" || ((s.cbarPos ?? "auto") === "auto" && !!fig?.sideBySide));

/** Columns each panel last rendered with, kept across rebuilds for the read-ahead (v5.2). */
export const lastCols = new Map();
/** One frame of float16 codes can be painted through a palette (stored per-step maps, expression results). */
const usesCodes = (src, need) => !need.axis && !need.avg && (src.isExpr ? src.size > 4096 : src.q?.dtype === "float16");   // (an average: values)
/** Min / max / smallest positive of float16 codes (optionally only the cells in `flat`), like scan(). */
function scanCodes(c, abs, out, flat = null) {
  const sc = c.scale, F = F16_TABLE, n = flat ? flat.length : c.length;
  for (let k = 0; k < n; k++) {
    let idx = k;
    if (flat) { idx = flat[k]; if (idx < 0) continue; }
    let v = F[c[idx]] * sc; if (v !== v) continue; if (abs) v = Math.abs(v);
    if (v < out.lo) out.lo = v; if (v > out.hi) out.hi = v;
    const m = Math.abs(v); if (m > 0 && m < out.mp) out.mp = m;
  }
  return out;
}

/** v11.1.1 (human 2026-11-10: "way more whitespace than necessary"): the left margin (CSS px) each plot's y numbers and
 *  title need, from the y range it will show; plots drawn together (a figure) take the widest, so their axes line up.
 *  A data kind's map (v15.1) with no zoom: the y range it says (mapYRange); none (its range comes from its data): the
 *  fixed allowance. */
function leftRoom2D(members, dprOf) {
  const out = new Map();
  for (const { panel, L: sp } of members) {
    const fig = sp.fig;
    if (fig?.hideY) continue;
    const s = resolved(eff(panel)), src = srcOf(s.run, s.q);
    if (!src || missingKindOf(src)) continue;
    const [xd, yd] = axesFor(s, src), kind = dataKindOf(src), merid = !kind && isSpherical(src, xd, yd) && s.meridional, d = dprOf(sp);
    R.useStyle(s.fonts);
    const m = margins2D(fig, cbarIsTop(s, fig)), cssW = Math.max(120, sp.wrap.clientWidth - (fig ? 0 : 2));
    const pw = Math.round(cssW * d) - (m.l + m.r) * d, ph = Math.max(80 * d, Math.min((fig ? fig.refW : cssW) * d * (s.aspect || 0.8) - (26 + 46) * d, 3 * pw));
    let yr = null;
    if (kind?.mapLoad) {
      const v = s.view ? symView(s, s.view) : null;
      yr = v ? [v.y0, v.y1] : kind.mapYRange?.(s, src, xd, yd) ?? null;
    } else {
      let v = symView(s, s.view || defaultView(s, src, xd, yd, merid));
      if (merid) v = equalAspect(v, { w: pw, h: ph });
      yr = [v.y0, v.y1];
    }
    if (yr && yr.every(Number.isFinite)) out.set(panel.id, R.yAxisRoom(yr[0], yr[1], !merid && !!s.logy, ph, d));
  }
  R.useStyle();
  if (members.length > 1 && out.size) { const mx = Math.max(...out.values()); for (const k of out.keys()) out.set(k, mx); }
  return out;
}

export async function render2D(members) {
  // v8.7: each plot's own pixel density (a plot drawn scaled in focus mode draws its canvas at that scale)
  const dpr0 = (window.devicePixelRatio || 1) * (window.aptvisZoom || 1), dprOf = sp => dpr0 * (sp?.renderScale || 1);
  let dpr = dpr0;
  const items = [], waits = [], needL = leftRoom2D(members, dprOf);       // v11.1.1
  for (const { panel, L: sp } of members) {
    dpr = dprOf(sp);
    setRunContext(panelRun(eff(panel), "2d"));                           // v8.10: fit variables are this plot's dataset's
    const s = resolved(eff(panel)), src = srcOf(s.run, s.q);              // numbers that follow variables, resolved
    if (!src) {
      const run = runOf(s.run);
      if (run && (canCompute(run, s.q) || jobFor(run, s.q))) { sp.status.replaceChildren(computeBox(run, [s.q])); items.push(null); continue; }   // v11.4
      sp.status.textContent = run ? `⚠ ${s.q} is not cached for ${run}: compute it in the data manager, then ⟳ refresh data · ` : `⚠ variable ${String(s.run).slice(1)} is missing`;
      if (run) sp.status.append(dmLink(s.q, run));
      items.push(null); continue;
    }
    const miss = missingKindOf(src);                       // v15.1: data only a plugin that is off can draw: say so, change nothing
    if (miss) { sp.status.textContent = `⚠ ${missingKindText(miss, `${src.label} (${runOf(s.run)})`)}`; items.push(null); continue; }
    // v15.1 (DECISIONS D20): a data kind that reads and paints its own maps (mapLoad …; aperture4: along-line data)
    const kind = dataKindOf(src), dk = kind?.mapLoad ? kind : null;
    const [xd, yd] = axesFor(s, src), merid = !kind && isSpherical(src, xd, yd) && s.meridional;
    const need = timesNeeded(s, src, xd, yd);
    // geometry first: the view decides which columns (r band) to download (v5.1)
    R.useStyle(s.fonts);                                  // v8.9.6: this plot's own text sizes (its margins)
    const fig = sp.fig, top = cbarIsTop(s, fig), m = margins2D(fig, top);
    const M = { l: (needL.get(panel.id) ?? m.l) * dpr, r: m.r * dpr, t: m.t * dpr, b: m.b * dpr };   // v11.1.1: fitted left
    sp.renderedW = sp.wrap.clientWidth;
    const cssW = Math.max(120, sp.wrap.clientWidth - (fig ? 0 : 2)), cw = Math.round(cssW * dpr);
    let v = s.view || (dk ? null : defaultView(s, src, xd, yd, merid));   // (a data kind's map: from its data, below)
    if (v) v = symView(s, v);
    const pw = cw - M.l - M.r;
    // in a figure every plot area gets the same size (from the figure's cell width), so rows and columns line up
    const refW = (fig ? fig.refW : cssW) * dpr;
    const ph = Math.max(80 * dpr, Math.min(refW * (s.aspect || 0.8) - (26 + 46) * dpr, 3 * pw));
    const ch = Math.round(ph + M.t + M.b);
    const plot = { x: Math.round(M.l), y: Math.round(M.t), w: Math.round(pw), h: Math.round(ph) };
    if (merid) v = equalAspect(v, plot);
    const cols = dk ? null : colsFor(s, src, xd, yd, merid, v);
    sp.cols = cols; lastCols.set(panel.id, cols);
    const it = { panel, sp, s, src, xd, yd, merid, need, frames: new Map(), codes: null, fig, top, cw, ch, plot, v, cols, tools: new Map(), dataKind: dk };
    if (dk) {                                             // v15.1: the kind starts reading its own data (it.err, it.missing)
      const { wait, note } = dk.mapLoad(it) || {};
      if (note) sp.status.textContent = note;
      if (wait) waits.push(wait);
      items.push(it); continue;
    }
    it.missing = need.list.some(i => !src.isCached(i, cols));
    if (need.list.length > 20 && it.missing) sp.status.textContent = `loading ${need.list.length} frames…`;
    // v5.2: start every download of the figure (all members + their field-line frames) before waiting for any
    const codesP = usesCodes(src, need) ? src.compactFrame(need.fixed, false, cols) : Promise.resolve(null);
    waits.push(codesP.then(async c => {
      if (c instanceof Uint16Array) { it.codes = c; return; }
      await Promise.all(need.list.map(async i => it.frames.set(i, await src.frame(i, false, cols))));
    }));
    for (const t of s.tools || []) {
      if (t.type !== "contour" || !t.visible) continue;
      const csrc = srcOf(s.run, t.q ?? s.q);
      if (!csrc || csrc.spaceDims.length !== 2 || !csrc.spaceDims.includes(xd) || !csrc.spaceDims.includes(yd)) continue;
      const time = src.hasTime && !need.axis ? src.times[need.fixed] : S.t;
      const e = { csrc, ci: csrc.indexAt(time), cc: contourCols(cols, src, csrc), frame: null };
      if (!csrc.isCached(e.ci, e.cc)) it.missing = true;
      waits.push(csrc.frame(e.ci, false, e.cc).then(f => { e.frame = f; }));
      it.tools.set(t.id, e);
    }
    items.push(it);
  }
  // loading indicator (v5.2): dim the panels still waiting for data, after 250 ms (cached steps don't flicker)
  const slow = setTimeout(() => {
    for (const it of items) if (it?.missing) {
      it.sp.wrap.classList.add("loading");
      it.sp.status.textContent = `loading t = ${R.fmt(it.src.hasTime && !it.need.axis ? it.src.times[it.need.fixed] : S.t)} …`;
    }
  }, 250);
  R.useStyle(); setRunContext(null);
  try { await Promise.all(waits); } finally { clearTimeout(slow); for (const it of items) it?.sp.wrap.classList.remove("loading"); }
  // pixel -> cell address map per panel (and per-pixel values only on the old path)
  for (const it of items) {
    if (!it) continue;
    if (it.dataKind) {                                    // v15.1: a data kind's map — its values (it.allVals), the view from them if none
      const err = it.dataKind.mapPrepare(it);
      if (err) { it.failed = true; it.sp.status.textContent = `⚠ ${err}`; continue; }
      if (!it.v) it.v = symView(it.s, it.dataKind.mapView(it));
    }
    const { sp, s, src, xd, yd, merid, need, frames, codes, cw, ch, plot, v } = it;
    dpr = dprOf(sp);
    if (sp.canvas.width !== cw || sp.canvas.height !== ch) { sp.canvas.width = cw; sp.canvas.height = ch; }
    sp.canvas.style.height = ch / dpr + "px"; sp.canvas.style.width = cw / dpr + "px";   // v8.9.8: shown at the size drawn (no stretch while a resize waits for this draw)
    const ax = R.axis(v.x0, v.x1, plot.x, plot.x + plot.w, !merid && s.logx), ay = R.axis(v.y1, v.y0, plot.y, plot.y + plot.h, !merid && s.logy);
    if (it.dataKind) { Object.assign(it, { ax, ay, A: null }); it.values = it.dataKind.mapPaint(it, ax, ay); continue; }
    const A = address(sp, s, src, xd, yd, merid, plot, ax, ay);
    Object.assign(it, { ax, ay, A });
    if (codes) continue;
    const fixed = frames.get(need.fixed), W = plot.w, H = plot.h, values = new Float32Array(W * H);
    const avgF = need.avg ? need.avg.map(i => frames.get(i)).filter(Boolean) : null;      // v8.13: the outputs averaged
    for (let k = 0; k < W * H; k++) {
      const f = A.flat[k];
      if (f < 0) { values[k] = NaN; continue; }
      let x;
      if (avgF && A.tsel[k] < 0) { let sum = 0, n = 0; for (const a of avgF) { const y = a[f]; if (y === y) { sum += y; n++; } } x = n ? sum / n : NaN; }
      else { const arr = A.tsel[k] >= 0 ? frames.get(A.tsel[k]) : fixed; x = arr ? arr[f] : NaN; }
      values[k] = s.abs ? Math.abs(x) : x;
    }
    it.values = values;
  }
  // colour limits: together for subpanels with the same colour settings
  const groups = new Map();
  for (const it of items) if (it && !it.failed) { const g = JSON.stringify(COLOR_KEYS.map(k => it.s[k])); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(it); }
  const addStats = (st, a, abs) => {
    const lo = abs ? (a.min < 0 && a.max > 0 ? 0 : Math.min(Math.abs(a.min), Math.abs(a.max))) : a.min;
    const hi = abs ? Math.max(Math.abs(a.min), Math.abs(a.max)) : a.max;
    st.lo = Math.min(st.lo, lo); st.hi = Math.max(st.hi, hi); if (a.minpos) st.mp = Math.min(st.mp, a.minpos);
  };
  const okStats = a => !!a && a.min !== null && a.min !== undefined && a.max !== null && a.max !== undefined;
  const scanAll = (it, st, abs) => (it.dataKind ? scan([it.allVals], abs, st) : it.codes ? scanCodes(it.codes, abs, st) : scan(it.need.axis ? [...it.frames.values()] : [it.frames.get(it.need.fixed)], abs, st));
  for (const members of groups.values()) {
    const s = members[0].s;
    let st = { lo: Infinity, hi: -Infinity, mp: Infinity };
    if (s.limits === "all") {
      for (const it of members) { const a = it.dataKind ? null : it.src.allStats(); if (okStats(a)) addStats(st, a, s.abs); else scanAll(it, st, s.abs); }
    } else if (s.limits === "view") for (const it of members) { if (it.codes) scanCodes(it.codes, s.abs, st, it.A.flat); else scan([it.values], false, st); }
    else for (const it of members) {
      if (it.dataKind) { scanAll(it, st, s.abs); continue; }   // v15.1: a data kind's map: every value it drew (v10.2: over all outputs)
      if (it.need.avg) { scan([it.values], false, st); continue; }     // v8.13: an average has its own (narrower) range
      // "this frame": the recorded stats of the whole frame (v5.1: frames may be loaded only in the zoomed band)
      const a = it.need.axis ? it.src.allStats() : it.src.stats(it.need.fixed);
      if (okStats(a)) addStats(st, a, s.abs); else scanAll(it, st, s.abs);
    }
    if (s.cmap === null && st.hi > st.lo) {                 // first real data decides signed vs positive defaults
      // signed = both signs matter (noise-level negatives, e.g. in a density, don't count)
      const signed = st.lo < 0 && st.hi > 0 && !s.abs && Math.min(-st.lo, st.hi) > 0.01 * Math.max(-st.lo, st.hi);
      for (const it of members) {
        const c = ctxPanel(it.panel);
        c.set("cmap", signed ? "hot_and_cold" : "viridis");
        if (c.get("symmetric") === null) c.set("symmetric", signed);
      }
      s.cmap = signed ? "hot_and_cold" : "viridis"; if (s.symmetric === null) s.symmetric = signed;
    }
    const lim = finishLimits(s, st);
    for (const it of members) it.lim = lim;
  }
  // paint
  for (const it of items) {
    if (!it || it.failed) continue;
    const { panel, sp, s, src, xd, yd, merid, need, plot, ax, ay, lim, top, fig, codes, A } = it;
    dpr = dprOf(sp);
    R.useStyle(s.fonts); setRunContext(panelRun(s, "2d"));
    const v8v = it.v, setV = () => setViewContext({ x0: Math.min(v8v.x0, v8v.x1), x1: Math.max(v8v.x0, v8v.x1), y0: Math.min(v8v.y0, v8v.y1), y1: Math.max(v8v.y0, v8v.y1) });
    setV();                                               // v8.12: view_x0 … for tools
    const ctx = sp.canvas.getContext("2d");
    ctx.fillStyle = R.THEME.bg; ctx.fillRect(0, 0, sp.canvas.width, sp.canvas.height);
    const lt = s.linthresh ?? Math.max(Math.abs(lim.vmin), Math.abs(lim.vmax)) * 1e-3;
    const norm = R.makeNorm(s.norm, lim.vmin, lim.vmax, lt), L = R.lut(s.cmap ?? "viridis", s.reverse);
    const hide = Number(s.hide) > 0 ? Number(s.hide) : 0;   // v8.26: |value| below this drawn as background
    if (codes) {
      const pal = R.palette(F16_TABLE, codes.scale, norm, `${s.norm}|${lim.vmin}|${lim.vmax}|${lt}`, L, `${s.cmap ?? "viridis"}|${!!s.reverse}`, s.abs, undefined, hide);
      R.paintCodes(ctx, plot, plot.w, plot.h, A.flat, codes, pal, sp);
    } else R.paintImage(ctx, plot, plot.w, plot.h, it.values, L, norm, undefined, hide);
    await drawTools(ctx, it, plot, ax, ay, dpr);
    R.useStyle(s.fonts); setRunContext(panelRun(s, "2d")); setV();   // (other plots may have drawn during the await)
    const lab = s.labels || {}, tx = { dataset: runOf(s.run) ?? "", t: R.fmt(src.hasTime && !need.axis ? src.times[need.fixed] : S.t) };   // v11.1: {dataset}, {t} in its title and labels
    const auto = it.dataKind ? it.dataKind.mapLabels(it, runOf(s.run)) : {   // v15.1: a data kind names its own map
      title: `${src.label} · ${runOf(s.run)}` + (src.hasTime && !need.axis ? ` · t = ${R.fmt(src.times[need.fixed])}` : "")
        + (need.avg ? ` (mean of t ${R.fmt(src.times[need.avg[0]])}–${R.fmt(src.times[need.avg.at(-1)])})` : ""),
      xlabel: merid ? "x = r sinθ [R_*]" : axisLabel(xd), ylabel: merid ? "z = r cosθ [R_*]" : axisLabel(yd),
      cbar: src.label + (src.units ? ` [${src.units}]` : ""),
    };
    const hits = R.drawAxes(ctx, plot, ax, ay, {
      dpr, xlabel: subVars(lab.xlabel, tx) ?? auto.xlabel, ylabel: subVars(lab.ylabel, tx) ?? auto.ylabel, title: subVars(panel.title, tx) ?? auto.title,
      edited: { xlabel: lab.xlabel != null, ylabel: lab.ylabel != null, title: panel.title != null },
      hideX: !!fig?.hideX, hideY: !!fig?.hideY, titleGap: top ? R.topMargins().titleGap : 6,
    });
    hits.cbar = top
      ? R.drawColorbarTop(ctx, { x: plot.x, y: plot.y - R.cbarTopOffset() * dpr, w: plot.w, h: 9 * dpr }, L, norm, s.norm, lim.vmin, lim.vmax, subVars(lab.cbar, tx) ?? auto.cbar, dpr)
      : R.drawColorbar(ctx, { x: plot.x + plot.w + 12 * dpr, y: plot.y + 6 * dpr, w: 14 * dpr, h: plot.h - 6 * dpr }, L, norm, s.norm, lim.vmin, lim.vmax, subVars(lab.cbar, tx) ?? auto.cbar, dpr);
    hits.cbarScale = hits.cbar.scale; delete hits.cbar.scale;
    if (src.hasTime && !need.axis && s.timeMode !== "fixed") R.drawNote(ctx, plot, [outsideNote(src, S.t)].filter(Boolean), dpr);   // v5.12
    // hover value: read on demand (no per-render value array on the codes path)
    const vals = it.values, valueAt = codes
      ? (k => { const f = A.flat[k]; if (f < 0) return NaN; const x = F16_TABLE[codes[f]] * codes.scale; return s.abs ? Math.abs(x) : x; })
      : (k => vals[k]);
    sp.last = { kind: "map", plot, ax, ay, valueAt, merid, W: plot.w, hits, auto, s, plotHcss: plot.h / dpr, refWcss: fig ? fig.refW : sp.wrap.clientWidth - 2 };
    sp.range = `colour [${R.fmt(lim.vmin)}, ${R.fmt(lim.vmax)}]`;
    sp.status.textContent = sp.range;
  }
  R.useStyle(); setRunContext(null); setViewContext(null);
}

// ---- interaction -----------------------------------------------------------------------------------------------
function devPos(c, e) { const b = c.getBoundingClientRect(), d = c.width / b.width; return [(e.clientX - b.left) * d, (e.clientY - b.top) * d]; }
const inside = (r, x, y) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
function zoomRange(a0, a1, c, f, log) {
  const T = log ? Math.log10 : x => x, Ti = log ? x => 10 ** x : x => x;
  return [Ti(T(c) + (T(a0) - T(c)) * f), Ti(T(c) + (T(a1) - T(c)) * f)];
}
const viewOf = l => ({ x0: l.ax.v0, x1: l.ax.v1, y0: Math.min(l.ay.v0, l.ay.v1), y1: Math.max(l.ay.v0, l.ay.v1) });

export function attach2D(panel, sp, api) {
  const c = sp.canvas, I = () => ctxPanel(panel);
  c.addEventListener("wheel", e => {
    const l = sp.last; if (!l) return;
    if (e.ctrlKey) return;                               // v8: Ctrl + wheel / pinch = panel size (app.js)
    const [x, y] = devPos(c, e); if (!inside(l.plot, x, y)) return;
    const f = wheelFactor(e), v = viewOf(l);
    if (f === 1) return;
    e.preventDefault();
    const [a, b] = zoomRange(v.x0, v.x1, l.ax.from(x), f, l.ax.log), [cc, d] = zoomRange(v.y0, v.y1, l.ay.from(y), f, l.ay.log);
    I().set("view", { x0: a, x1: b, y0: cc, y1: d }); api.changed(panel, false);
  }, { passive: false });
  let drag = null;
  c.addEventListener("mousedown", e => { if (sp.last) drag = { start: devPos(c, e), pos: devPos(c, e), view: viewOf(sp.last), moved: false }; });
  window.addEventListener("mouseup", e => {      // (removed with the panel: sp.ac, v5.2)
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved || !sp.last) return;
    const [x, y] = d.start, h = sp.last.hits;                                   // a click, not a drag
    if (inside(h.title, x, y)) editText(e.clientX, e.clientY, { what: "title (this plot)", value: panel.title, auto: sp.last.auto.title, onSet: v => { panel.title = v; api.changed(panel, false); },
      extra: fontSize(ctxPanel(panel), "title", () => api.changed(panel, false)) });
    // v8 (human 2026-10-14: "colorbar click I can set limits, clicking the axis I can also set limits"): the colour bar,
    // an axis's numbers or its label open that thing's settings (range / limits, log, label …)
    else if (inside(h.cbarScale, x, y) || inside(h.cbar, x, y)) api.quick(panel, "cbar", e.clientX, e.clientY);
    else if (inside(h.xaxis, x, y) || inside(h.xlabel, x, y)) api.quick(panel, "x", e.clientX, e.clientY);
    else if (inside(h.yaxis, x, y) || inside(h.ylabel, x, y)) api.quick(panel, "y", e.clientX, e.clientY);
    else if (inside(sp.last.plot, x, y)) {
      api.lineout?.(panel, sp.last.ax.from(x), sp.last.ay.from(y), false);      // v14.2: the last lineout moves here
      api.cursor?.(panel, sp.last.ax.from(x), sp.last.ay.from(y));              // v11.0: click sets
    }
  }, { signal: sp.ac?.signal });
  c.addEventListener("mousemove", e => {
    const l = sp.last; if (!l) return;
    const [x, y] = devPos(c, e);
    if (drag) {
      if (Math.hypot(x - drag.start[0], y - drag.start[1]) > 3) drag.moved = true;
      if (!drag.moved) return;
      const sh = (a, p0, p1, v0, v1) => (a.log ? [v0 * a.from(p0) / a.from(p1), v1 * a.from(p0) / a.from(p1)] : [v0 + a.from(p0) - a.from(p1), v1 + a.from(p0) - a.from(p1)]);
      const [x0, x1] = sh(l.ax, drag.pos[0], x, drag.view.x0, drag.view.x1), [y0, y1] = sh(l.ay, drag.pos[1], y, drag.view.y0, drag.view.y1);
      drag.pos = [x, y]; drag.view = { x0, x1, y0, y1 };
      I().set("view", drag.view); api.changed(panel, false);
      return;
    }
    const h = l.hits, over = inside(h.title, x, y) ? "title" : inside(h.cbarScale, x, y) || inside(h.cbar, x, y) ? "cbar"
      : inside(h.xaxis, x, y) || inside(h.xlabel, x, y) ? "x" : inside(h.yaxis, x, y) || inside(h.ylabel, x, y) ? "y" : null;
    c.style.cursor = over === "title" ? "text" : over ? "pointer" : "crosshair";
    const run = over === "title" ? runOf(eff(panel).run) : null;
    tipAt(e.clientX, e.clientY, run ? runTip(run) : null);                // v8.19: the title's dataset, what it is
    if (!inside(l.plot, x, y)) {
      sp.status.textContent = { title: "click to edit the title", cbar: "click: colour limits, map, norm, label", x: "click: x range, log, label", y: "click: y range, log, label" }[over] ?? (sp.range || "");
      return;
    }
    const val = l.valueAt((Math.floor(y) - l.plot.y) * l.W + (Math.floor(x) - l.plot.x)), X = l.ax.from(x), Y = l.ay.from(y);
    const where = l.merid ? `r = ${R.fmt(Math.hypot(X, Y))}, θ = ${R.fmt(Math.atan2(Math.abs(X), Y) * 180 / Math.PI)}°` : `x = ${R.fmt(X)}, y = ${R.fmt(Y)}`;
    sp.status.textContent = `${where}   value = ${val === val ? val.toPrecision(4) : "—"}   ·   ${sp.range}`;
  });
  c.addEventListener("dblclick", () => { I().set("view", null); api.changed(panel, false); });
}
