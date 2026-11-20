// cycleplots.js — plots made from a period tool (v14.1, human 2026-11-13: "it is nice to have tools have option of make
// new plot (and can choose which plot) these would probably be default linked to same panel"). A cycle line
// (line.cyc = {tool, what}) reads the period tool's last results (TOOL_VALUES, filled when its plot draws; that plot then
// asks these plots to redraw), so it follows the tool: change the window or detrend there and these change.
//   ac        each curve's autocorrelation against the lag (its first half), the chosen peak marked;
//   sp / sr   each curve's period / regularity in sliding windows (the tool's width and step) over the whole curve, the
//             tool's window shaded;
//   pp pr pl pn   per curve: period, regularity, lag, number of cycles against the pick the curves differ by (r_max …).
import { toolValues, newId } from "./model.js";
import { sliding } from "./cycles.js";

let API = { newPlot() {} };
export function setCycApi(api) { API = { ...API, ...api }; }
export const newCyclePlot = (panel, t, what) => API.newPlot(panel, t, what);
export const isCyc = l => !!l?.cyc;
export const CYC_WHAT = { ac: "autocorrelation", sp: "period (sliding window)", sr: "regularity (sliding window)",
  pp: "period per curve", pr: "regularity per curve", pl: "lag per curve", pn: "cycles per curve" };
const PER = { pp: "period", pr: "regularity", pl: "lag", pn: "n_cycles" };
export const isPerCurve = what => !!PER[what];
export const newCycLine = (tool, what, panel = null) => ({ id: newId(), cyc: { tool, what, panel },   // v14.3.2: + the plot it reads
  run: null, label: null, color: null, dash: "solid", width: 1.4, visible: true, listColors: false, size: 4 });
export const cycLineText = l => `${CYC_WHAT[l.cyc.what] ?? l.cyc.what} (period tool)`;
/** The pick the period tool's curves differ by (r_max …), or null (they differ by dataset only, or one curve). */
export function curveDim(v) {
  const cs = (v?.curves || []).filter(c => c.at);
  if (cs.length < 2) return null;
  return Object.keys(cs[0].at.d || {}).find(d => new Set(cs.map(c => c.at.d?.[d])).size > 1) ?? null;
}
export function cycExpansions(line) {
  const v = toolValues(line.cyc.panel ?? null, line.cyc.tool);
  if (!v?.curves || PER[line.cyc.what] || v.curves.length < 2) return [null];
  return v.curves.map((c, k) => ({ cyc: k, k, n: v.curves.length, label: c.display }));
}
const SL = new Map();                                      // sliding results per curve and recipe (kept in the browser)
function slidingOf(v, k) {
  const c = v.curves[k], xs = c.src.xs, ys = c.src.ys;
  let h = 0; for (let i = 0; i < ys.length; i += Math.max(1, ys.length >> 5)) h = (h * 31 + (Number.isFinite(ys[i]) ? ys[i] : 0) * 1e6) % 1e12;
  const key = JSON.stringify([v.how, v.width, v.step, xs.length, xs[0], xs[xs.length - 1], h]);
  if (!SL.has(key)) { SL.set(key, sliding(xs, ys, v.width, v.step, v.how)); if (SL.size > 200) SL.delete(SL.keys().next().value); }
  return SL.get(key);
}
export function cycCurve(s, line, sub) {
  const v = toolValues(line.cyc.panel ?? null, line.cyc.tool), w = line.cyc.what, name = CYC_WHAT[w] ?? w;
  if (!v?.curves) return { error: "the period tool this plot reads is not drawn (its plot removed, hidden or not yet drawn)" };
  if (PER[w]) {
    const d = curveDim(v);
    if (!d) return { error: "the period tool's curves do not differ by a pick (r_max …): cast them to a table instead (→ table)" };
    const pts = v.curves.map(c => [c.at?.d?.[d], c[PER[w]]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)).sort((a, b) => a[0] - b[0]);
    return { curve: { line, src: null, isCyc: true, markers: true, xs: Float64Array.from(pts.map(p => p[0])), ys: Float64Array.from(pts.map(p => p[1])),
      label: name, sub: null, subLabel: null, keyed: [["q", name]], listKey: null } };
  }
  const k = sub?.cyc ?? 0, c = v.curves[k];
  if (!c) return { error: "the period tool has no such curve now" };
  let xs, ys;
  const extra = {};
  if (w === "ac") {
    const n = Math.ceil(c.ac.x.length / 2);
    xs = c.ac.x.slice(0, n); ys = c.ac.y.slice(0, n);
    extra.peak = Number.isFinite(c.period) ? { x: c.period, y: c.regularity } : null;
  } else {
    const S = slidingOf(v, k);
    xs = S.t_mid; ys = w === "sp" ? S.period : S.regularity;
    extra.window = v.win;
  }
  return { curve: { line, src: null, isCyc: true, xs: Float64Array.from(xs), ys: Float64Array.from(ys), label: [name, sub?.label].filter(Boolean).join(" · "),
    sub, subLabel: sub?.label ?? null, keyed: [["q", name], ...(sub ? [["cyc", sub.label]] : [])], listKey: sub ? "cyc" : null, ...extra } };
}
