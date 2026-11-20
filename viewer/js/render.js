// render.js — colour maps, norms, ticks, axes, map/line drawing, contours. Pure drawing, no state.
import { hasMath, drawRich, measureRich } from "./mathtext.js";

// ---- colour maps (stops interpolated linearly in RGB to 256 entries) ------------------------------
const STOPS = {
  hot_and_cold: "00ffff,01efff,03deff,05ccff,06baff,08a8ff,0996ff,0b83ff,0c70fd,0e5df9,0f49f2,1036e6,1022d4,0f13b8,121590,171963,191a1e,401110,5b0e0c,760d0a,8f160b,a4250b,b6360b,c6480b,d35c0b,dd700a,e68409,ec9907,f2ad06,f6c205,fad603,fdeb02,ffff00",
  RdBu_r: "053061,2166ac,4393c3,92c5de,d1e5f0,f7f7f7,fddbc7,f4a582,d6604d,b2182b,67001f",
  viridis: "440154,482878,3e4989,31688e,26828e,1f9e89,35b779,6ece58,b5de2b,fde725",
  inferno: "000004,1b0c41,4a0c6b,781c6d,a52c60,cf4446,ed6925,fb9b06,f7d13d,fcffa4",
  magma: "000004,180f3d,440f76,721f81,9e2f7f,cd4071,f1605d,fd9668,feca8d,fcfdbf",
  plasma: "0d0887,46039f,7201a8,9c179e,bd3786,d8576b,ed7953,fb9f3a,fdca26,f0f921",
  gray: "000000,ffffff",
};
export const CMAPS = Object.keys(STOPS);
const LUTS = {};
/** 256 colours packed as little-endian RGBA uint32 (for ImageData). */
export function lut(name, reverse = false) {
  const key = name + (reverse ? "_r" : "");
  if (LUTS[key]) return LUTS[key];
  const st = STOPS[name].split(",").map(h => [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16)));
  if (reverse) st.reverse();
  const out = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * (st.length - 1), k = Math.min(Math.floor(x), st.length - 2), f = x - k;
    const c = [0, 1, 2].map(j => Math.round(st[k][j] * (1 - f) + st[k + 1][j] * f));
    out[i] = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
  }
  return (LUTS[key] = out);
}
export const lutCss = (L, i) => { const v = L[i]; return `rgb(${v & 255},${(v >> 8) & 255},${(v >> 16) & 255})`; };

// ---- norms: value -> [0,1]; NaN = no data (drawn as background) ----------------------------------------
export function makeNorm(kind, vmin, vmax, linthresh) {
  if (kind === "log") {
    // v <= 0 on a log scale is "below the range", not missing: it gets the lowest colour (human 2026-10-01,
    // e.g. number density where the plasma hasn't arrived yet is exactly 0)
    const a = Math.log10(vmin), b = Math.log10(vmax);
    return { f: v => (v > 0 ? (Math.log10(v) - a) / (b - a) : -Infinity), inv: u => 10 ** (a + u * (b - a)) };
  }
  if (kind === "symlog") {
    const g = v => Math.sign(v) * Math.log10(1 + Math.abs(v) / linthresh);
    const gi = y => Math.sign(y) * linthresh * (10 ** Math.abs(y) - 1);
    const a = g(vmin), b = g(vmax);
    return { f: v => (g(v) - a) / (b - a), inv: u => gi(a + u * (b - a)) };
  }
  return { f: v => (v - vmin) / (vmax - vmin), inv: u => vmin + u * (vmax - vmin) };
}

// ---- ticks ----------------------------------------------------------------------------------------
export function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw)), r = raw / p;
  const step = (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * p;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}
export function logTicks(lo, hi) {
  const a = Math.ceil(Math.log10(lo) - 1e-9), b = Math.floor(Math.log10(hi) + 1e-9), out = [];
  if (b - a >= 1) { const every = Math.ceil((b - a + 1) / 7); for (let k = a; k <= b; k += every) out.push(10 ** k); }
  else for (let k = a - 1; k <= b; k++) for (const m of [1, 2, 5]) { const v = m * 10 ** k; if (v >= lo && v <= hi) out.push(v); }
  return out;
}
export function fmt(v) {
  if (v === 0) return "0";
  if (!isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) {
    const [m, e] = v.toExponential(1).split("e");
    return `${m.replace(/\.0$/, "")}e${Number(e)}`;
  }
  return String(Number(v.toPrecision(3)));
}

// ---- axes: data <-> canvas pixels ---------------------------------------------------------------------
/** Linear or log10 mapping of one axis onto [p0, p1] pixels. */
export function axis(v0, v1, p0, p1, log) {
  if (log && !(v0 > 0 && v1 > 0)) log = false;           // a log axis needs a positive range
  const T = log ? Math.log10 : x => x, Ti = log ? (x => 10 ** x) : x => x;
  const a = T(v0), b = T(v1), k = (p1 - p0) / (b - a);
  return { to: v => p0 + (T(v) - a) * k, from: p => Ti(a + (p - p0) / k), v0, v1, log };
}

// ---- desktop style (v5.8, human 2026-10-05: font sizes etc. are a desktop-wide setting) ---------------------------
// Sizes in CSS px. Set by the app before drawing (S.style resolved; numbers may follow variables).
export const STYLE = { title: 12, label: 12, tick: 11, legend: 11, info: 11, cbar: 11, cbarTick: 10, lineScale: 1, frame: 1, ticklen: 4, family: "system-ui, sans-serif" };
let BASE = { ...STYLE };                  // the desktop style (v8.9.6: a plot's own sizes go over it while it is drawn)
export function setStyle(o) { Object.assign(STYLE, o); BASE = { ...STYLE }; }
export const FONT_KEYS = ["title", "label", "tick", "legend", "info", "cbar", "cbarTick"];
/** v8.9.6: one plot's own text sizes (settings.fonts) over the desktop style; useStyle() = the desktop's again. Called at
 *  the start of every synchronous piece of a plot's drawing (renders of other plots may run between awaits). */
export function useStyle(over = null) {
  Object.assign(STYLE, BASE);
  if (over) for (const k of FONT_KEYS) { const v = Number(over[k]); if (over[k] != null && isFinite(v) && v > 0) STYLE[k] = v; }
}
// v8: plot colours that aren't data (background, frame, text, boxes). Dark plots swap them; exports draw with LIGHT.
const LIGHT = { bg: "#fff", fg: "#222", frame: "#444", dim: "#777", edited: "#124", box: "rgba(255,255,255,0.85)", halo: "rgba(255,255,255,0.92)", zero: "#ccc", note: "#a15c07" };
const DARK = { bg: "#16181c", fg: "#e3e5e9", frame: "#a3a8b0", dim: "#9ea3aa", edited: "#9cc3ff", box: "rgba(22,24,28,0.85)", halo: "rgba(22,24,28,0.92)", zero: "#4a4e55", note: "#f0b060" };
export const THEME = { ...LIGHT };
export function setPlotTheme(dark) { Object.assign(THEME, dark ? DARK : LIGHT); }
export const plotThemeDark = () => THEME.bg === DARK.bg;
const font = (size, dpr, bold = false) => `${bold ? "bold " : ""}${size * dpr}px ${STYLE.family}`;
/** fillText / measureText that understand $...$ LaTeX (mathtext.js, v5.11); plain text takes the fast path. */
function textOut(ctx, s, x, y, size, dpr, bold = false, stroke = false) {
  if (hasMath(s)) drawRich(ctx, s, x, y, size * dpr, STYLE.family, bold, stroke); else if (stroke) ctx.strokeText(s, x, y); else ctx.fillText(s, x, y);
}
/** Text with a soft halo of the page colour behind its letters only (v8.9.2, human 2026-10-15: legends "blurred behind
 *  the actual text not the whole rectangular box"): the curves stay visible between and around the words. */
function haloOut(ctx, s, x, y, size, dpr) {
  ctx.save();
  ctx.strokeStyle = ctx.shadowColor = THEME.halo; ctx.lineWidth = 3.5 * dpr; ctx.lineJoin = "round"; ctx.shadowBlur = 3 * dpr;
  textOut(ctx, s, x, y, size, dpr, false, true);
  ctx.restore();
  textOut(ctx, s, x, y, size, dpr);
}
function textW(ctx, s, size, dpr, bold = false) { return hasMath(s) ? measureRich(ctx, s, size * dpr, STYLE.family, bold) : ctx.measureText(s).width; }
/** Plot margins (CSS px) for the current style: the defaults reproduce the old 64 / 46 / 26. */
export function axisMargins() {
  const s = STYLE;
  return { l: 14 + s.ticklen + 3.4 * s.tick + s.label, b: s.ticklen + 14 + s.tick + s.label, t: s.title + 14 };
}
/** Side colour bar: right margin; top colour bar: its offset above the plot, the title gap and the top margin. */
export const cbarRight = () => 46 + 4.6 * STYLE.cbarTick;
export const cbarTopOffset = () => 22 + STYLE.cbarTick;      // v11.1.1: 6 px less blank under the bar's numbers (was 28)
let MEASURE = null;
/** v11.1.1 (human 2026-11-10: "this is way more whitespace than necessary so yeah fix it"): the left margin (CSS px) a y
 *  axis needs — its tick numbers as drawAxes draws them for this range and plot height (device px), and its title —
 *  instead of a fixed allowance for about three and a half characters of numbers. */
export function yAxisRoom(v0, v1, log, hDev, dpr) {
  const st = STYLE, lo = Math.min(v0, v1), hi = Math.max(v0, v1);
  if (!(hi > lo) || (log && !(lo > 0))) return axisMargins().l;
  const yt = log ? logTicks(lo, hi) : niceTicks(lo, hi, Math.max(2, Math.round(hDev / ((15 + 4 * st.tick) * dpr))));
  MEASURE = MEASURE || document.createElement("canvas").getContext("2d");
  MEASURE.font = font(st.tick, dpr);
  const eps = (hi - lo) * 1e-6;
  let w = 2 * st.tick * dpr;                                 // drawAxes' own minimum
  for (const v of yt) if (v >= lo - eps && v <= hi + eps) w = Math.max(w, MEASURE.measureText(fmt(v)).width);
  return Math.ceil(st.ticklen + 2 + w / dpr + 4 + 1.15 * st.label + 4);   // tick · gap · numbers · gap · title · edge
}
export function topMargins() { const g = cbarTopOffset() + 4; return { titleGap: g, t: g + Math.max(STYLE.title, STYLE.cbar) + 4 }; }

export function drawAxes(ctx, plot, ax, ay, opts) {
  const { x, y, w, h } = plot, dpr = opts.dpr, st = STYLE, tl = st.ticklen * dpr;
  ctx.save();
  ctx.strokeStyle = THEME.frame; ctx.lineWidth = st.frame * dpr; ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = THEME.fg; ctx.font = font(st.tick, dpr);
  const xt = ax.log ? logTicks(Math.min(ax.v0, ax.v1), Math.max(ax.v0, ax.v1)) : niceTicks(Math.min(ax.v0, ax.v1), Math.max(ax.v0, ax.v1), Math.max(2, Math.round(w / ((40 + 4.5 * st.tick) * dpr))));
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (const v of xt) { const px = ax.to(v); if (px < x - 1 || px > x + w + 1) continue; ctx.beginPath(); ctx.moveTo(px, y + h); ctx.lineTo(px, y + h + tl); ctx.stroke(); if (!opts.hideX) ctx.fillText(fmt(v), px, y + h + tl + 2 * dpr); }
  const yt = ay.log ? logTicks(Math.min(ay.v0, ay.v1), Math.max(ay.v0, ay.v1)) : niceTicks(Math.min(ay.v0, ay.v1), Math.max(ay.v0, ay.v1), Math.max(2, Math.round(h / ((15 + 4 * st.tick) * dpr))));
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  let tickW = 2 * st.tick * dpr;
  for (const v of yt) {
    const py = ay.to(v); if (py < y - 1 || py > y + h + 1) continue;
    ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x - tl, py); ctx.stroke();
    if (!opts.hideY) { const t = fmt(v); ctx.fillText(t, x - tl - 2 * dpr, py); tickW = Math.max(tickW, ctx.measureText(t).width); }
  }
  // texts — returned as click regions so the viewer can edit them; v8: the tick numbers too (click: the axis's range)
  const hits = {};
  if (!opts.hideX) hits.xaxis = { x: x - 4 * dpr, y: y + h, w: w + 8 * dpr, h: tl + (4 + st.tick + 2) * dpr };
  if (!opts.hideY) hits.yaxis = { x: x - tl - tickW - 6 * dpr, y: y - 4 * dpr, w: tl + tickW + 6 * dpr, h: h + 8 * dpr };
  ctx.font = font(st.label, dpr);
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  if (!opts.hideX) {                                     // hidden when the plot below shares this x axis
    const base = y + h + tl + (2 + st.tick + 4 + st.label) * dpr;
    ctx.fillStyle = opts.edited?.xlabel ? THEME.edited : THEME.fg;
    textOut(ctx, opts.xlabel || "(x label)", x + w / 2, base, st.label, dpr);
    const xw = Math.max(textW(ctx, opts.xlabel || "(x label)", st.label, dpr), 60 * dpr);
    hits.xlabel = { x: x + w / 2 - xw / 2, y: base - (st.label + 4) * dpr, w: xw, h: (st.label + 4) * dpr };
  }
  if (!opts.hideY) {                                     // hidden when the plot to the left shares this y axis
    const lx = x - tl - 2 * dpr - tickW - 4 * dpr;
    ctx.save(); ctx.translate(lx, y + h / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = "bottom";
    ctx.fillStyle = opts.edited?.ylabel ? THEME.edited : THEME.fg;
    textOut(ctx, opts.ylabel || "(y label)", 0, 0, st.label, dpr); ctx.restore();
    const yw = Math.max(textW(ctx, opts.ylabel || "(y label)", st.label, dpr), 60 * dpr);
    hits.ylabel = { x: lx - (st.label + 4) * dpr, y: y + h / 2 - yw / 2, w: (st.label + 4) * dpr, h: yw };
  }
  ctx.font = font(st.title, dpr, true); ctx.textAlign = "left"; ctx.textBaseline = "bottom";
  ctx.fillStyle = opts.edited?.title ? THEME.edited : THEME.fg;
  const tg = (opts.titleGap ?? 6) * dpr;                 // larger when a colour bar sits between title and plot
  textOut(ctx, opts.title || "(title)", x, y - tg, st.title, dpr, true);
  hits.title = { x, y: y - tg - (st.title + 4) * dpr, w: Math.max(textW(ctx, opts.title || "(title)", st.title, dpr, true), 60 * dpr), h: (st.title + 6) * dpr };
  ctx.restore();
  return hits;
}

export const DASHES = { solid: [], dashed: [6, 4], dotted: [1.5, 3], dashdot: [6, 3, 1.5, 3] };

/** Where a legend of size w × h sits (v6.3, human 2026-10-13: "a way of moving the legend around nicely"):
 *  pos = null (upper right), {fx, fy} = how far across the plot's free space (0 = left / top, 1 = right / bottom),
 *  or "outside" (right of the plot, in the margin the panel keeps for it). */
export const LEGEND_PAD = 6;
export function legendXY(plot, w, h, pos, dpr) {
  const pad = LEGEND_PAD * dpr;
  if (pos === "outside") return [plot.x + plot.w + 8 * dpr, plot.y];
  const fx = pos?.fx ?? 1, fy = pos?.fy ?? 0;
  return [plot.x + pad + fx * Math.max(0, plot.w - w - 2 * pad), plot.y + pad + fy * Math.max(0, plot.h - h - 2 * pad)];
}
/** Legend box; returns one click region per entry, plus .box = the whole frame (to drag it). `header` = grey text
 *  above the entries (what all curves share, v5.9); an entry with .sep starts a new group (small gap). */
export function drawLegend(ctx, plot, entries, dpr, header = null, pos = null) {
  if (!entries.length) return [];
  ctx.save();
  ctx.font = font(STYLE.legend, dpr);
  const lh = (STYLE.legend + 4) * dpr, gap = 5 * dpr, nsep = entries.filter(e => e.sep).length, hh = header ? lh : 0;
  const wmax = Math.max(...entries.map(e => textW(ctx, e.label, STYLE.legend, dpr) + 34 * dpr), header ? textW(ctx, header, STYLE.legend, dpr) + 12 * dpr : 0);
  const hbox = hh + lh * entries.length + nsep * gap + 6 * dpr, [bx, by] = legendXY(plot, wmax, hbox, pos, dpr);
  if (header) { ctx.fillStyle = THEME.dim; ctx.textAlign = "left"; ctx.textBaseline = "middle"; haloOut(ctx, header, bx + 6 * dpr, by + 3 * dpr + lh / 2, STYLE.legend, dpr); }
  const hits = [];
  let off = by + 3 * dpr + hh;
  entries.forEach((e, k) => {
    if (e.sep && k > 0) off += gap;
    const yy = off + k * lh + lh / 2;
    ctx.strokeStyle = e.color; ctx.lineWidth = Math.max(1.5, e.width) * STYLE.lineScale * dpr; ctx.setLineDash((DASHES[e.dash] || []).map(v => v * dpr));
    ctx.beginPath(); ctx.moveTo(bx + 6 * dpr, yy); ctx.lineTo(bx + 24 * dpr, yy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = e.edited ? THEME.edited : THEME.fg; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    haloOut(ctx, e.label, bx + 28 * dpr, yy, STYLE.legend, dpr);
    hits.push({ x: bx, y: yy - lh / 2, w: wmax, h: lh, entry: e });
  });
  ctx.restore();
  hits.box = { x: bx, y: by, w: wmax, h: hbox };
  return hits;
}

/** Horizontal colour bar above the plot (for plots side by side): label right-aligned on the title line,
 *  ticks below the bar. Returns the label's click region. */
export function drawColorbarTop(ctx, box, L, norm, kind, vmin, vmax, label, dpr) {
  const { x, y, w, h } = box;
  for (let i = 0; i < w; i++) { ctx.fillStyle = lutCss(L, Math.round(255 * i / Math.max(1, w - 1))); ctx.fillRect(x + i, y, 1, h); }
  ctx.strokeStyle = THEME.frame; ctx.lineWidth = STYLE.frame * dpr; ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = THEME.fg; ctx.font = font(STYLE.cbarTick, dpr); ctx.textBaseline = "top";
  let ticks;
  if (kind === "log") ticks = logTicks(vmin, vmax);
  else if (kind === "symlog") ticks = [vmin, norm.inv(0.25), norm.inv(0.5), norm.inv(0.75), vmax];
  else ticks = niceTicks(vmin, vmax, Math.max(2, Math.round(w / (70 * dpr))));
  for (const v of ticks) {
    const u = norm.f(v); if (!(u >= -1e-6 && u <= 1 + 1e-6)) continue;
    const px = x + u * w; ctx.fillRect(px, y + h, dpr, 3 * dpr);
    ctx.textAlign = u < 0.03 ? "left" : u > 0.97 ? "right" : "center"; ctx.fillText(fmt(v), px, y + h + 4 * dpr);
  }
  ctx.font = font(STYLE.cbar, dpr); ctx.textAlign = "right"; ctx.textBaseline = "bottom";
  textOut(ctx, label || "", x + w, y - 3 * dpr, STYLE.cbar, dpr);
  const lw = Math.max(textW(ctx, label || "", STYLE.cbar, dpr), 40 * dpr);
  // the label's click region; .scale = the bar and its numbers (v8: click → colour limits)
  return { x: x + w - lw, y: y - (STYLE.cbar + 6) * dpr, w: lw, h: (STYLE.cbar + 4) * dpr,
    scale: { x, y: y - 2 * dpr, w, h: h + (8 + STYLE.cbarTick) * dpr } };
}

export function drawColorbar(ctx, box, L, norm, kind, vmin, vmax, label, dpr) {
  const { x, y, w, h } = box;
  for (let j = 0; j < h; j++) { ctx.fillStyle = lutCss(L, Math.round(255 * (1 - j / (h - 1)))); ctx.fillRect(x, y + j, w, 1); }
  ctx.strokeStyle = THEME.frame; ctx.lineWidth = STYLE.frame * dpr; ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = THEME.fg; ctx.font = font(STYLE.cbarTick, dpr); ctx.textAlign = "left"; ctx.textBaseline = "middle";
  let ticks;
  if (kind === "log") ticks = logTicks(vmin, vmax);
  else if (kind === "symlog") ticks = [vmin, norm.inv(0.25), norm.inv(0.5), norm.inv(0.75), vmax];
  else ticks = niceTicks(vmin, vmax, 5);
  let tw = 0;
  for (const v of ticks) { const u = norm.f(v); if (!(u >= -1e-6 && u <= 1 + 1e-6)) continue; const py = y + h - u * h; ctx.fillRect(x + w, py, 3 * dpr, dpr); ctx.fillText(fmt(v), x + w + 5 * dpr, py); tw = Math.max(tw, ctx.measureText(fmt(v)).width); }
  ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.font = font(STYLE.cbar, dpr);
  textOut(ctx, label || "", x + w / 2, y - 4 * dpr, STYLE.cbar, dpr);
  return { x: x - 10 * dpr, y: y - (STYLE.cbar + 7) * dpr, w: w + 40 * dpr, h: (STYLE.cbar + 5) * dpr,    // click region of the label
    scale: { x: x - 3 * dpr, y: y - 3 * dpr, w: w + tw + 9 * dpr, h: h + 6 * dpr } };                          // the bar + numbers (v8)
}

// ---- 2D maps --------------------------------------------------------------------------------------------
/** v8.26: the plot background as an ImageData pixel (RGBA bytes, little-endian): cells hidden by "hide below". */
export function bgPixel() {
  let h = String(THEME.bg).replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const n = parseInt(h, 16);
  return Number.isFinite(n) ? (0xff000000 | ((n & 255) << 16) | (n & 0xff00) | ((n >> 16) & 255)) >>> 0 : 0xffffffff;
}

/** Fill the plot rectangle. value(i) for i in pixel index order; returns ImageData.
 *  hide > 0 (v8.26): cells with |value| < hide are drawn in the plot background (no-data cells stay badColor). */
export function paintImage(ctx, plot, W, H, values, L, norm, badColor = 0xffd8d8d8, hide = 0) {
  const img = ctx.createImageData(W, H), px = new Uint32Array(img.data.buffer);
  const hc = hide > 0 ? bgPixel() : 0;
  for (let i = 0; i < W * H; i++) {
    const v = values[i];
    if (v !== v) { px[i] = badColor; continue; }             // NaN = outside domain / masked
    if (hide > 0 && Math.abs(v) < hide) { px[i] = hc; continue; }   // v8.26: hide below
    const u = norm.f(v);
    px[i] = u !== u ? badColor : L[u <= 0 ? 0 : u >= 1 ? 255 : (u * 255 + 0.5) | 0];
  }
  ctx.putImageData(img, plot.x, plot.y);
  return img;
}

/** Colour k of n shades around `hex` (lighter -> darker, the colour itself in the middle): one list line's curves. */
export function shade(hex, k, n) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m || n < 2) return hex;
  const f = (k / (n - 1) - 0.5) * 0.9, c = m.slice(1).map(h => parseInt(h, 16));
  const mix = c.map(x => Math.round(f < 0 ? x + (255 - x) * -f : x * (1 - f)));
  return "#" + mix.map(x => x.toString(16).padStart(2, "0")).join("");
}

// ---- painting from float16 codes (v5.2) ----------------------------------------------------------------------
// A stored frame holds at most 65,536 distinct values (its float16 codes), so each code's colour is computed once
// per (frame scale, norm, limits, colour map) and every pixel is one lookup: the same pixels as paintImage,
// 5-7x faster (audit SPD-7), no per-render value array.
const PALS = new Map();
export function palette(F16, scale, norm, normKey, L, lutKey, abs, badColor = 0xffd8d8d8, hide = 0) {
  const hc = hide > 0 ? bgPixel() : 0;                   // v8.26: hide below (the background colour is in the key)
  const key = `${scale}|${normKey}|${lutKey}|${abs ? 1 : 0}|${hide > 0 ? `${hide}|${hc}` : ""}`;
  let p = PALS.get(key);
  if (p) { PALS.delete(key); PALS.set(key, p); return p; }
  p = new Uint32Array(65536);
  for (let h = 0; h < 65536; h++) {
    let v = Math.fround(F16[h] * scale);           // float32, exactly like the decoded frames paintImage used
    if (v !== v) { p[h] = badColor; continue; }
    if (abs) v = Math.abs(v);
    if (hide > 0 && Math.abs(v) < hide) { p[h] = hc; continue; }
    const u = norm.f(v);
    p[h] = u !== u ? badColor : L[u <= 0 ? 0 : u >= 1 ? 255 : (u * 255 + 0.5) | 0];
  }
  PALS.set(key, p);
  if (PALS.size > 24) PALS.delete(PALS.keys().next().value);
  return p;
}
/** Paint pixels from codes through a palette; `flat` maps each plot pixel to a frame cell (-1 = no data). */
export function paintCodes(ctx, plot, W, H, flat, codes, pal, holder, badColor = 0xffd8d8d8) {
  let img = holder.img;
  if (!img || img.width !== W || img.height !== H) img = holder.img = ctx.createImageData(W, H);
  const px = new Uint32Array(img.data.buffer);
  for (let k = 0; k < W * H; k++) { const f = flat[k]; px[k] = f < 0 ? badColor : pal[codes[f]]; }
  ctx.putImageData(img, plot.x, plot.y);
  return img;
}

/** Nearest index of v in ascending coordinate array c (-1 when farther than half a cell outside). */
export function nearestIndex(c, v) {
  const n = c.length;
  if (n === 1) return 0;
  if (v < c[0] - 0.5 * (c[1] - c[0]) || v > c[n - 1] + 0.5 * (c[n - 1] - c[n - 2])) return -1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= v) lo = mid; else hi = mid; }
  return v - c[lo] < c[hi] - v ? lo : hi;
}

// ---- contours (marching squares on a 2D array [ny][nx], C order) ----------------------------------------
/** Returns segments [[y0,x0,y1,x1], ...] in fractional index space. */
export function contourSegments(a, ny, nx, level) {
  const seg = [];
  const lerp = (v0, v1) => (level - v0) / (v1 - v0);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v00 = a[j * nx + i], v01 = a[j * nx + i + 1], v10 = a[(j + 1) * nx + i], v11 = a[(j + 1) * nx + i + 1];
      if (v00 !== v00 || v01 !== v01 || v10 !== v10 || v11 !== v11) continue;
      const c = (v00 > level ? 1 : 0) | (v01 > level ? 2 : 0) | (v11 > level ? 4 : 0) | (v10 > level ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const top = [j, i + lerp(v00, v01)], right = [j + lerp(v01, v11), i + 1];
      const bottom = [j + 1, i + lerp(v10, v11)], left = [j + lerp(v00, v10), i];
      const add = (p, q) => seg.push([p[0], p[1], q[0], q[1]]);
      switch (c) {
        case 1: case 14: add(left, top); break;
        case 2: case 13: add(top, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(right, bottom); break;
        case 6: case 9: add(top, bottom); break;
        case 7: case 8: add(left, bottom); break;
        case 5: add(left, top); add(right, bottom); break;
        case 10: add(top, right); add(left, bottom); break;
      }
    }
  }
  return seg;
}

/** Linear interpolation of a coordinate array at a fractional index. */
export const coordAt = (c, f) => { const k = Math.min(Math.max(Math.floor(f), 0), c.length - 2); return c[k] + (f - k) * (c[k + 1] - c[k]); };

// ---- lines -------------------------------------------------------------------------------------------------
export const SERIES_COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];

export function drawPolyline(ctx, xs, ys, ax, ay, color, lw, dash = "solid", dpr = 1) {
  ctx.strokeStyle = color; ctx.lineWidth = lw * STYLE.lineScale; ctx.setLineDash((DASHES[dash] || []).map(v => v * dpr)); ctx.beginPath();
  let pen = false;
  for (let i = 0; i < xs.length; i++) {
    const X = ax.to(xs[i]), Y = ay.to(ys[i]);
    if (!isFinite(X) || !isFinite(Y)) { pen = false; continue; }
    if (pen) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); pen = true; }
  }
  ctx.stroke(); ctx.setLineDash([]);
}

/** Straight line across the plot at data value v (vertical: on x; horizontal: on y). */
/** Text beside a rule (a line tool's label, v5.6): at the top of a vertical rule, at the right end of a horizontal
 *  one. "{v}" in the text becomes the rule's value. */
export function drawRuleLabel(ctx, plot, a, v, vertical, color, text, dpr) {
  const p = a.to(v);
  if (!text || !isFinite(p) || p < (vertical ? plot.x : plot.y) || p > (vertical ? plot.x + plot.w : plot.y + plot.h)) return;
  const s = String(text).replace(/\{v\}/g, fmt(v));
  ctx.save();
  ctx.font = font(STYLE.tick, dpr); ctx.fillStyle = color;
  if (vertical) { ctx.textAlign = p > plot.x + plot.w - 60 * dpr ? "right" : "left"; ctx.textBaseline = "top"; textOut(ctx, s, p + (ctx.textAlign === "left" ? 3 : -3) * dpr, plot.y + 3 * dpr, STYLE.tick, dpr); }
  else { ctx.textAlign = "right"; ctx.textBaseline = "bottom"; textOut(ctx, s, plot.x + plot.w - 4 * dpr, p - 2 * dpr, STYLE.tick, dpr); }
  ctx.restore();
}
/** v12.0 (draw): a band between v0 and v1 along axis a (vertical: across x), filled at alpha. */
export function drawBand(ctx, plot, a, v0, v1, vertical, color, alpha, dpr) {
  const p0 = a.to(v0), p1 = a.to(v1);
  if (!isFinite(p0) || !isFinite(p1)) return;
  ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha)); ctx.fillStyle = color;
  if (vertical) ctx.fillRect(Math.min(p0, p1), plot.y, Math.max(1, Math.abs(p1 - p0)), plot.h);
  else ctx.fillRect(plot.x, Math.min(p0, p1), plot.w, Math.max(1, Math.abs(p1 - p0)));
  ctx.restore();
}
/** v12.0 (draw): a point (filled circle, radius in px) at (x, y), with an optional label beside it. */
export function drawPoint(ctx, plot, ax, ay, x, y, color, size, text, dpr) {
  const X = ax.to(x), Y = ay.to(y);
  if (!isFinite(X) || !isFinite(Y) || X < plot.x || X > plot.x + plot.w || Y < plot.y || Y > plot.y + plot.h) return;
  ctx.save(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X, Y, Math.max(1, size) * dpr, 0, 2 * Math.PI); ctx.fill();
  if (text) { ctx.font = font(STYLE.tick, dpr); ctx.textAlign = "left"; ctx.textBaseline = "bottom"; textOut(ctx, String(text), X + (size + 3) * dpr, Y - 2 * dpr, STYLE.tick, dpr); }
  ctx.restore();
}
export function drawRule(ctx, plot, a, v, vertical, color, lw, dash, dpr) {
  const p = a.to(v);
  if (!isFinite(p)) return;
  ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
  ctx.strokeStyle = color; ctx.lineWidth = lw * STYLE.lineScale * dpr; ctx.setLineDash((DASHES[dash] || []).map(x => x * dpr));
  ctx.beginPath();
  if (vertical) { ctx.moveTo(p, plot.y); ctx.lineTo(p, plot.y + plot.h); } else { ctx.moveTo(plot.x, p); ctx.lineTo(plot.x + plot.w, p); }
  ctx.stroke(); ctx.restore();
}

/** Small notes in the plot's lower-left corner (v5.12: "pairs-1 ends at t = 72: its last frame is shown"). */
export function drawNote(ctx, plot, notes, dpr) {
  if (!notes.length) return;
  const size = Math.max(9, STYLE.legend - 1), lh = (size + 4) * dpr;
  ctx.save();
  ctx.font = `italic ${size * dpr}px ${STYLE.family}`; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
  const w = Math.max(...notes.map(n => ctx.measureText(n).width)) + 8 * dpr, x = plot.x + 4 * dpr, y = plot.y + plot.h - 4 * dpr - lh * notes.length;
  ctx.fillStyle = THEME.box; ctx.fillRect(x, y, w, lh * notes.length + 2 * dpr);
  ctx.fillStyle = THEME.note;
  notes.forEach((n, k) => ctx.fillText(n, x + 4 * dpr, y + lh * (k + 1)));
  ctx.restore();
}

/** Coloured lines of text (fit formulas, v5.13); $...$ math allowed. v8.11 (human 2026-10-20: "the additional legend
 *  thing from the fits … more customizable and draggable kinda like the legend"): placed like the legend (pos = null:
 *  upper left, or {fx, fy}), its own text size (STYLE.info), a halo behind the letters instead of a box; returns one
 *  click region per line (.item) and .box (to drag it). */
export function drawInfo(ctx, plot, items, dpr, pos = null) {
  if (!items.length) return [];
  ctx.save();
  const size = STYLE.info ?? STYLE.legend;
  ctx.font = font(size, dpr); ctx.textAlign = "left"; ctx.textBaseline = "middle";
  const lh = (size + 7) * dpr, w = Math.max(...items.map(i => textW(ctx, i.text, size, dpr))) + 12 * dpr, h = lh * items.length + 4 * dpr;
  const [x, y] = legendXY(plot, w, h, pos && pos !== "outside" ? pos : { fx: 0, fy: 0 }, dpr);
  const hits = [];
  items.forEach((it, k) => {
    const yy = y + 2 * dpr + lh * (k + 0.5);
    ctx.fillStyle = it.color; haloOut(ctx, it.text, x + 6 * dpr, yy, size, dpr);
    hits.push({ x, y: yy - lh / 2, w, h: lh, item: it });
  });
  ctx.restore();
  hits.box = { x, y, w, h };
  return hits;
}

/** v14.3 (lineout), v14.5 (every map line, RULES P4): the colour of a thin contrasting edge under a line of colour c, so
 *  it shows on any colour map: white under dark lines, black under light ones. */
export function haloOf(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || ""));
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16), lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#000000" : "#ffffff";
}

/** v14.5.1 (architecture review §5.1, Phase 3): the one way a tool draws a straight line at value v along axis a — a halo
 *  under it (optional), the line, its label. Horizontal / vertical line tools, the slider-time line and lineouts use it on
 *  maps and 1D plots alike, so they look and label the same. */
export function drawToolRule(ctx, plot, a, v, vertical, color, lw, dash, { halo = false, label = null } = {}, dpr = 1) {
  if (halo) drawRule(ctx, plot, a, v, vertical, haloOf(color), lw + 2.4, dash, dpr);
  drawRule(ctx, plot, a, v, vertical, color, lw, dash, dpr);
  if (label) drawRuleLabel(ctx, plot, a, v, vertical, color, label, dpr);
}
