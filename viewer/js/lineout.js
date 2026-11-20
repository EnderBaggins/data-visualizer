// lineout.js — lineouts of a map (v14.2, human 2026-11-13: "a tool to make a linked plot that shows cuts of the 2D";
// "make it lineout"; "nice to easily be able to have multiple cuts comparing maybe need shift click to add new one";
// "allow the tool to cast to variable").
//
// A lineout tool sits on a map (2D plot): t = {along: "x" | "y", at: [positions] | "$variable", plot}. Its linked 1D plot
// has one lineout line (line.lo = {map, tool}): one curve per position, the map's quantity along the map's `along` axis at
// that position of the other axis (the cut). Click the map: the last lineout moves there; shift-click: one more. On the
// map each position is a dashed line (a ray or an arc on a meridional map) in the colour of its curve.
//   ordinary maps     the 1D line of the same quantity with the cut as a pick (or a fixed time when the cut is time);
//   a data kind's map its own (v15.1: lineoutCurve, lineoutDefault, lineoutPositions; aperture4: along-line maps).
import { S, eff, srcOf, dataKindOf, missingKindOf, missingKindText, listOf, isRef, axisLabel, isSpherical, newId, dimCoord, num1, subVars, toolLabel, runOf } from "./model.js";
import * as R from "./render.js";
import { axesFor } from "./panel2d.js";

let API = { newPlot() {}, retarget() {} };
export function setLineoutApi(a) { API = { ...API, ...a }; }
export const newLineoutPlot = (panel, t) => API.newPlot(panel, t);
export const retargetLineout = (panel, t) => API.retarget(panel, t);
export const isLo = l => !!l?.lo;
export const newLoLine = (map, tool) => ({ id: newId(), lo: { map, tool }, run: null, label: null, color: null, dash: "solid", width: 1.6, visible: true, listColors: false });
/** A lineout tool's positions (numbers; a variable's values when it follows one). */
export const loPositions = t => (isRef(t.at) ? listOf(t.at) : [].concat(t.at ?? [])).map(Number).filter(Number.isFinite);
const cutName = d => axisLabel(d).replace(/ \[.*\]$/, "");
/** The map of a lineout and its axes: {p, s2, t, src, xd, yd, merid, along, cut} or {error}. */
export function loGeom(mapId, toolId) {
  const p = S.panels.find(q => q.id === mapId);
  if (!p) return { error: "the map of this lineout was removed" };
  const s2 = eff(p), t = (s2.tools || []).find(x => x.id === toolId && x.type === "lineout");
  if (!t) return { error: "the lineout tool was removed from its map" };
  const src = srcOf(s2.run, s2.q);
  if (!src) return { error: `${s2.q} is not cached for this map's dataset` };
  const [xd, yd] = axesFor(s2, src), merid = !dataKindOf(src) && isSpherical(src, xd, yd) && !!s2.meridional;
  return { p, s2, t, src, xd, yd, merid, along: t.along === "y" ? yd : xd, cut: t.along === "y" ? xd : yd };
}
export const loLineText = l => { const g = loGeom(l.lo.map, l.lo.tool); return g.error ? "lineout (?)" : `lineout of ${g.src.label} along ${cutName(g.along)}`; };
/** A first position: the middle of the cut axis's values. */
export function loDefault(g) {
  if (g.cut === "time") return g.src.times[g.src.times.length >> 1];
  const own = dataKindOf(g.src)?.lineoutDefault?.(g.cut);             // v15.1: a data kind's own axis
  if (own !== undefined && own !== null) return own;
  const v = dimCoord(g.src, g.cut)?.values;
  return v?.length ? Number(v[v.length >> 1]) : 0;
}
// v14.3 (human 2026-11-13: "a blue will be hard to see on blue background ... see and change list colors for a single
// tool"; "make it more like the variables choice of color I like the halo option"): a lineout's positions each have a
// colour — the tool's own list (t.colors), or its variable's (v.colors) when its positions follow one — used by its line on
// the map AND its curve in the lineout plot. "list colours" off: one colour (t.color) for all.
const varOfAt = t => (isRef(t.at) ? S.vars?.[t.at.slice(1)] || null : null);
export const loColors = t => (varOfAt(t) ? varOfAt(t).colors : t.colors) || [];
export const loColor = (t, k) => (t.listColors === false ? t.color || "#d6007a" : loColors(t)[k] || R.SERIES_COLORS[k % 10]);
export function setLoColor(t, k, c) { const o = varOfAt(t) || t; o.colors = [...(o.colors || [])]; o.colors[k] = c; }
/** The colour of position k of a lineout line's tool (its 1D curve). */
export function loLineColor(line, k) { const g = loGeom(line.lo.map, line.lo.tool); return g.error ? R.SERIES_COLORS[k % 10] : loColor(g.t, k); }
/** A contrasting edge for a line of colour c (white under dark lines, black under light ones). */
/** v14.2.2: one more position for a tool that has `P`: a value of the cut axis away from those there. */
export function loNextPosition(g, P) {
  const own = g.cut === "time" ? null : dataKindOf(g.src)?.lineoutPositions?.(g.cut) || null;   // v15.1: a data kind's own axis: its list
  const vals = g.cut === "time" ? [...g.src.times] : own ? [...own] : [...(dimCoord(g.src, g.cut)?.values || [])].map(Number);
  if (!vals.length) return 0;
  if (own) return vals.find(v => !P.some(p => Math.abs(p - v) < 1e-9)) ?? vals[0];
  const k = P.length + 1, i = Math.min(vals.length - 1, Math.round((vals.length - 1) * (k % 2 ? k / (k + 1) : 1 / (k + 1))));
  return Number(Number(vals[i]).toPrecision(4));
}
export function loExpansions(line) {
  const g = loGeom(line.lo.map, line.lo.tool);
  if (g.error) return [null];
  const P = loPositions(g.t);
  return P.length ? P.map((v, k) => ({ lo: v, k, n: P.length, label: `${cutName(g.cut)} = ${R.fmt(v)}` })) : [null];
}
/** One lineout curve. fns = panel1d's {lineCurve, smoothAlong, slopeAlong} (no import cycle). */
export async function loCurve(s, line, sub, fns) {
  const g = loGeom(line.lo.map, line.lo.tool);
  if (g.error) return { error: `lineout: ${g.error}` };
  const miss = missingKindOf(g.src);                      // v15.1: its map's data needs a plugin that is off
  if (miss) return { error: `lineout: ${missingKindText(miss, g.src.label)}` };
  if (sub?.lo === undefined) return { error: "lineout: no position yet (click the map)" };
  if (s.xaxis !== g.along) return { error: `lineout: this plot's x is ${cutName(s.xaxis)}, the lineout runs along ${cutName(g.along)} (⚙ → x, or the tool's direction)` };
  const v = sub.lo, { s2, src } = g;
  const finish = c => Object.assign(c, { line, sub, label: `${src.label} · ${sub.label}`, subLabel: sub.label, listKey: "lo", keyed: [["q", src.label], ["lo", sub.label]] });
  const kind = dataKindOf(src);
  if (kind?.lineoutCurve) return kind.lineoutCurve({ s, line, sub, g, fns, finish });   // v15.1: a data kind's map reads its own
  const synth = { id: line.id, run: s2.run, q: s2.q, picks: { ...(s2.picks || {}), ...(g.cut !== "time" ? { [g.cut]: v } : {}) }, pickAs: {},
    timeMode: g.cut === "time" ? "fixed" : s2.timeMode === "fixed" ? "fixed" : "follow", fixedTime: g.cut === "time" ? v : s2.fixedTime ?? null, visible: true };
  const r = await fns.lineCurve(s, synth, false, null);
  if (!r?.curve) return r || { error: "lineout: nothing to draw" };
  return { ...r, curve: finish(r.curve) };
}
/** Where a click at (X, Y) (the map's own plot coordinates) puts a lineout: the cut axis's value there. */
export function loValueAt(g, X, Y) {
  if (g.merid) {
    const sph = g.src.run.m.geometry.spherical;
    return g.cut === sph.theta ? Math.atan2(Math.abs(X), Y) : Math.hypot(X, Y);
  }
  return g.cut === g.xd ? X : Y;
}
/** Draw a map's lineout positions (panel2d) as a horizontal / vertical line tool draws its lines (v14.2.2, human
 *  2026-11-13: "when it shows the cut should act like a horizontal or vertical tool for drawing"): the card's style, width,
 *  colour (list colours: each position its curve's colour), label ({v} = the position); rays / arcs on a meridional map. */
export function drawLineouts(ctx, t, it, plot, ax, ay, dpr) {
  const { src, xd, yd, merid, s } = it, P = loPositions(t), cutX = t.along === "y", cut = cutX ? xd : yd;
  const dash = t.dash || "dashed", lw = num1(t.width, 1.4);
  ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
  P.forEach((v, k) => {
    const col = loColor(t, k), hl = t.halo ? R.haloOf(col) : null;
    if (!merid) {
      // v14.5.1: drawn as a line tool draws (render.js drawToolRule; label: {v} = its position, {dataset}, {t})
      R.drawToolRule(ctx, plot, cutX ? ax : ay, v, cutX, col, lw, dash, { halo: !!t.halo, label: toolLabel(t, v, { dataset: runOf(s.run) ?? "", t: R.fmt(S.t) }) }, dpr);
      return;
    }
    const sph = src.run.m.geometry.spherical, xs = [], ys = [];
    if (cut === sph.theta) {
      const r1 = 2 * Math.max(Math.abs(ax.v0), Math.abs(ax.v1), Math.abs(ay.v0), Math.abs(ay.v1));
      for (const sg of s.mirror ? [1, -1] : [1]) { xs.push(NaN, 0, sg * r1 * Math.sin(v)); ys.push(NaN, 0, r1 * Math.cos(v)); }
    } else {
      for (const sg of s.mirror ? [1, -1] : [1]) { xs.push(NaN); ys.push(NaN); for (let j = 0; j <= 96; j++) { const th = (Math.PI * j) / 96; xs.push(sg * v * Math.sin(th)); ys.push(v * Math.cos(th)); } }
    }
    if (hl) R.drawPolyline(ctx, Float64Array.from(xs), Float64Array.from(ys), ax, ay, hl, (lw + 2.4) * dpr, dash, dpr);
    R.drawPolyline(ctx, Float64Array.from(xs), Float64Array.from(ys), ax, ay, col, lw * dpr, dash, dpr);
  });
  ctx.restore();
}
