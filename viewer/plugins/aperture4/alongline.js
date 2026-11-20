// alongline.js (aperture4 plugin, v15.1; DECISIONS D20) — along-line data as a data kind of the core: a quantity stored
// at a traced field line's own points (dim "pt"), its arc length in its family's member `s` (alongdata.js). Registered
// with api.registerDataKind (the core asks the kind at every place it treats this data differently: its x axes, how a
// 1D curve of it reads x, how a map of it is laid out and painted, its settings rows, the new-plot form, lineouts),
// api.registerReadingOp ("line length"), api.registerPlotMenu ("▦ linked slices") and api.registerMigration (old
// 200-point profiles → along-line data). Moved from the core's model.js, panel1d.js, panel2d.js, settings.js,
// newpanel.js, lineout.js, vars.js, measure.js and app.js.
import { S, eff, srcOf, isFn, isAn, runsOf, ctxPanel, num1, isRef, timeLine, isTimeLine, newTool, nameTaken, newVarName, cloneFresh,
  ownOnJoin, familyKeys, linkPanels, groupOf } from "../../js/model.js";
import { interp1, normSmooth } from "../../js/panel1d.js";
import { row } from "../../js/settings.js";
import { smoothControls } from "../../js/lines.js";
import { numRef, renderSidebar } from "../../js/vars.js";
import { el, select } from "../../js/ui.js";
import { ALONG_AXES, ALONG_POS, isAlong, alongS, alongKind } from "./alongdata.js";
import { mapAxes, mapTimes, mapYRange, mapLoad, mapPrepare, mapView, mapPaint, mapLabels, alongSeriesAt } from "./alongmap.js";

// ---- 1D: x per curve and per frame (v8.28; was panel1d.js lineCurve) ------------------------------------------------
// Human 2026-11-09: along-line data "saved naturally as along s". Each frame's points have their own s (the line moves):
// x is the s of the frame shown (s, s / its last s, or its last s − s); the other frames of a ±N mean, a "mean over"
// window or a d/dt are interpolated onto those x (at fixed position along the line), the middle of a window's frames
// giving x. The curve carries its line's length (sLen, its last s): the "line length" reading and gapseries.js read it.
async function lineData({ src, run, fit, need, frames, base, sx, ref: refI, avgDims }) {
  if (avgDims.length) return { error: `${src.label}: a mean over another axis needs one common s for every line — not for data at the line's points` };
  const sSrc = alongS(src), sFr = new Map(), npt = src.run.m.coords.pt.values.length;
  await Promise.all(need.map(async i => sFr.set(i, await sSrc.frame(i))));
  const rows = new Map();
  for (const i of need) {
    const Sa = sFr.get(i), Ya = frames.get(i), xr = [], yr = [];
    for (let k = 0; k < npt; k++) { const sv = Sa?.[base + k * sx]; if (!Number.isFinite(sv)) break; xr.push(sv); yr.push(Ya ? Ya[base + k * sx] : NaN); }
    const L = xr.length ? xr[xr.length - 1] : NaN;
    rows.set(i, { x: fit.along === "s" ? xr : fit.along === "norm" ? xr.map(v => v / L) : xr.map(v => L - v), y: yr, L });
  }
  const ref = rows.get(refI) ?? rows.get(need[0]);
  if (!ref || !ref.x.length) return { error: `${src.label} (${run}): the line is not closed here (no points)` };
  const xs = Float64Array.from(ref.x);
  return { xs, val: (i, j) => { const r = rows.get(i); return !r ? NaN : r === ref ? r.y[j] : interp1(r.x, r.y, xs[j]); }, extra: { sLen: ref.L } };
}

// ---- maps: axes and settings rows (v10.2 / v11.0; was model.js setAxes2D, settings.js) ---------------------------
/** One field line at every output: position × time; v11.0: also r_max × position, r_max × time. */
function setMapAxes(s, src, xd, yd) {
  if (!alongKind(xd, yd)) { xd = "s"; yd = "time"; }
  const logR = k => k === "r_max" && src.run.m.coords.r_max?.scale === "log";
  s.xdim = xd; s.ydim = yd; s.logx = logR(xd); s.logy = logR(yd); s.view = null;
  if ((xd === "time" || yd === "time") && !s.tools.some(isTimeLine)) s.tools.push(timeLine({ color: "#ffffff" }));
}
const ALONG_AXIS_OPTS = [["s", "s from the north foot"], ["s_norm", "s/s_max"], ["s_south", "s from the south foot"], ["time", "t"], ["r_max", "r_max (each line)"]];
const AT_OPTS = [["s", "s from the north foot"], ["s_norm", "s/s_max"], ["s_south", "s from the south foot"]];
/** v11.0: where a map of every line over time reads each curve: a position along the line (a number or a variable). */
function alongAtRow(ctx) {
  const a = ctx.get("at") || {}, pos = ALONG_POS.includes(a.pos) ? a.pos : "s";
  return row(ctx, ["at"], "at",
    select(AT_OPTS, pos, v => { ctx.set("at", { ...a, pos: v }); ctx.done(); }, { title: "where along each line the map reads it" }),
    "=", numRef(a.v ?? 0.3, v => { if (v !== null) { ctx.set("at", { pos, ...a, v }); ctx.done(); } }, { size: 5, title: "the position: R* on s (from the north or the south foot), a fraction on s/s_max; a variable works" }),
    el("span", { class: "dim" }, pos === "s_norm" ? "" : "R*"));
}
/** v10.2: an along-line map's row operations, as on a 1D plot: its slope along the position (± d/ds over w) and its
 *  smoothing along the position (mean / median over ± h), both in the position axis's units. */
function alongOpsRow(ctx) {
  const sl = ctx.get("slope"), on = !!sl?.sign;
  return row(ctx, ["slope", "smooth"], "line",
    el("span", { class: "dim" }, "slope"),
    select([["", "none"], ["1", "d/ds"], ["-1", "−d/ds"]], on ? String(Number(sl.sign) < 0 ? -1 : 1) : "", v => { ctx.set("slope", v ? { sign: Number(v), w: sl?.w ?? 0.5 } : null); ctx.done(); },
      { title: "draw the slope of the quantity along the line instead, as a 1D slope line: (y(x + w/2) − y(x − w/2)) / w, the position as drawn (−d/ds: a drop reads positive)" }),
    on ? ["over", numRef(sl.w ?? 0.5, v => { if (isRef(v) || v > 0) { ctx.set("slope", { ...sl, w: v }); ctx.done(); } }, { size: 4, title: "the window w along the position axis (R* on s; a variable works, $L is the line's length)" })] : null,
    el("span", { class: "dim" }, "smooth"),
    smoothControls(normSmooth(ctx.get("smooth"), false) ?? false, v => { ctx.set("smooth", v ?? false); ctx.done(); }, { dflt: 0.25 }));
}
/** The map's own settings rows: the 1D operations on every output's row; v11.0: where every line is read (C). */
const mapRows = (ctx, src, xd, yd) => [alongOpsRow(ctx), alongKind(xd, yd) === "C" ? alongAtRow(ctx) : null].filter(Boolean);
const mapHint = (xd, yd) => (alongKind(xd, yd) === "A" ? "One field line (r_max: a slider in its settings) at every output."
  : alongKind(xd, yd) === "B" ? "Every field line at the time shown (the time slider)." : "Every field line at every output, read at one position along it (in its settings).");

// ---- lineouts of an along-line map (v14.2; was lineout.js) --------------------------------------------------------
// Along the line (s …) at a time (A) or on a line (B): the 1D along-line line; along time (C: on a line r_max at the
// map's position; A: at a position of the map's line): read as the map reads it (each output's curve smoothed / sloped
// along the line, then read at the position: alongmap.js alongSeriesAt).
const lineoutDefault = cut => (ALONG_POS.includes(cut) ? (cut === "s_norm" ? 0.5 : 1) : undefined);
const lineoutPositions = cut => (ALONG_POS.includes(cut) ? [0.25, 0.5, 0.75, 0.1, 0.9] : null);
async function lineoutCurve({ s, line, sub, g, fns, finish }) {
  const v = sub.lo, { s2, src } = g;
  if (g.along === "time") {                             // C: a line (cut r_max) at the map's position; A: the map's line at a position (cut)
    const r = g.cut === "r_max" ? await alongSeriesAt(src, s2, v) : await alongSeriesAt(src, s2, s2.picks?.r_max, g.cut, v);
    if (r.error) return { error: `lineout: ${r.error}` };
    return { curve: finish({ src: null, isLoSeries: true, xs: r.xs, ys: r.ys, at: { run: src.run.name, d: { r_max: r.rmax } } }) };
  }
  if (!ALONG_POS.includes(g.along)) return { error: "lineout: along r_max of an along-line map is not in this version" };
  const synth = { id: line.id, run: s2.run, q: s2.q, picks: { ...(s2.picks || {}), ...(g.cut === "r_max" ? { r_max: v } : {}) }, pickAs: {},
    timeMode: g.cut === "time" ? "fixed" : s2.timeMode === "fixed" ? "fixed" : "follow", fixedTime: g.cut === "time" ? v : s2.fixedTime ?? null,
    smooth: s2.smooth ?? undefined, slope: s2.slope ?? undefined, visible: true };
  const r = await fns.lineCurve(s, synth, false, null);
  if (!r?.curve) return r || { error: "lineout: nothing to draw" };
  fns.smoothAlong(r.curve, s); fns.slopeAlong(r.curve);  // as the map draws it (its smoothing, slope along the line)
  r.curve.smoothed = true;
  return { ...r, curve: finish(r.curve) };
}

// ---- linked slices (v11.0; was app.js) ------------------------------------------------------------------------------
/** v11.0 (human 2026-11-10: linked slices of r_max × s × t — "how would these linked work? … just do it all as v11"):
 *  three along-line maps of this panel's quantity as one figure, tied by $rmax, $spos and the time slider —
 *  A: s × t on the line $rmax; B: s × r_max at the slider's time; C: t × r_max at s = $spos (from the north foot).
 *  A click in any sets them (each plot's "click sets"); the crosshairs are line tools at them and the "now" line.
 *  Dataset, quantity, slope, smoothing and colour are shared; axes, slices, tools and zoom are each plot's own. */
function linkedSlices(panel, core) {
  const s0 = eff(panel), src = srcOf(s0.run, s0.q);
  if (!isAlong(src)) { core.toast("linked slices are made from a map of a quantity along one field line (along.*)", true); return; }
  const numVar = (want, value) => {
    if (S.vars[want]?.type === "number") return "$" + want;
    const n = nameTaken(want) ? newVarName("number") : want;
    S.vars[n] = { name: n, type: "number", value };
    return "$" + n;
  };
  const RM = numVar("rmax", Number(num1(s0.picks?.r_max, 3).toPrecision(4))), SP = numVar("spos", 0.3);
  const line = (orient, value) => newTool("line", { orient, value, color: "#d6007a", dash: "dashed", width: 1.2 });
  const now = () => timeLine({ color: "#ffffff" });     // v14.5.1: the line at the slider's time
  const strip = { view: null, tools: [], picks: {}, click: null, at: null, labels: { xlabel: null, ylabel: null, cbar: null } };
  const mk = over => {
    const c = cloneFresh(panel);
    Object.assign(c, { link: null, template: null, title: null, name: null, pos: null });
    c.settings = { ...cloneFresh(s0), ...strip, ...over };
    return c;
  };
  const logR = src.run.m.coords?.r_max?.scale === "log";
  const A = mk({ xdim: "s", ydim: "time", logx: false, logy: false, picks: { r_max: RM }, click: { x: SP, y: "time" }, tools: [now(), line("v", SP)] });
  const B = mk({ xdim: "s", ydim: "r_max", logx: false, logy: logR, timeMode: "follow", click: { x: SP, y: RM }, tools: [line("v", SP), line("h", RM)] });
  const C = mk({ xdim: "time", ydim: "r_max", logx: false, logy: logR, at: { pos: "s", v: SP }, click: { x: "time", y: RM }, tools: [now(), line("h", RM)] });
  const shared = new Set(["run", "q", "slope", "smooth", "cmap", "reverse", "norm", "linthresh", "decades", "limits", "vmin", "vmax", "vsym", "symmetric", "abs", "hide"]);
  const own = [...new Set([...ownOnJoin(A, B, C), ...familyKeys("view"), "click", "at", "tools", "picks", "xdim", "ydim", "logx", "logy", "timeMode", "fixedTime", "labels"])].filter(k => !shared.has(k));
  S.panels.splice(S.panels.indexOf(panel) + 1, 0, A, B, C);
  linkPanels(A, B, own); linkPanels(A, C, own);
  const g = groupOf(A);
  core.makeFigure(g, A);
  g.rows = [[A.id], [B.id, C.id]];                     // A on top; B under it (same s axis), C beside B (same r_max axis)
  core.rebuildAll(); core.save(); renderSidebar();
  core.toast(`linked slices: ${RM.slice(1)} = the line (r_max), ${SP.slice(1)} = s from the north foot — click a plot to move them; the time slider moves t`);
}

// ---- old desktops (v10.0; was app.js migrateDerivedKinds) ---------------------------------------------------------
// v10.0 (human 2026-11-10: "can you make it so all the old clunky stuff is gone"): plots on the old 200-point profiles
// (s/s_max; R* through x * L) move to the along-line data at the line's own points (true s), where every dataset of
// the plot has it: epar_along → along.epar …; x * L → s from the north foot, (1 − x) * L → s from the south foot.
const OLD = { epar_along: "along.epar", phi_along: "along.phi", I_along: "along.I_enc", B_along: "along.Bmag", jpar_over_B_along: "along.jpar_over_B" };
function migrateProfiles(core) {
  const lenVar = n => S.vars?.[n]?.type === "measured" && S.vars[n].op === "length";
  let moved = 0;
  for (const p of S.panels) {
    if (p.type !== "1d") continue;
    const e = eff(p), old = (e.lines || []).filter(l => !isFn(l) && !isAn(l) && OLD[l.q]);
    if (!old.length || !old.every(l => runsOf(l.run).length && runsOf(l.run).every(r => srcOf(r, OLD[l.q])))) continue;
    for (const l of old) { l.q = OLD[l.q]; moved++; }      // (the stored line objects: eff shares them)
    const f = String(e.xfn || "").replace(/\s+/g, ""), m1 = /^x\*(\w+)$/.exec(f), m2 = /^\(1-x\)\*(\w+)$/.exec(f), c = ctxPanel(p);
    if ((m1 && lenVar(m1[1])) || (m2 && lenVar(m2[1]))) {
      c.set("xaxis", m1 ? "s" : "s_south"); c.set("xfn", null); c.set("view", null);
      if (e.labels?.xlabel) c.set("labels", { ...e.labels, xlabel: null });
    }
  }
  if (moved) setTimeout(() => core.toast(`${moved} line${moved > 1 ? "s" : ""} moved from the old 200-point profiles to the along-line data at the line's own points (true s)`), 1300);
}

export function registerAlongLine(api) {
  api.registerDataKind({
    key: "along", label: "data at a field line's own points (along-line data)", is: isAlong,
    dims: ["pt"], axes: ALONG_POS, axisOrderBefore: "r_out",
    axisInfo: { s: { label: "s from the north foot", units: "R_*" }, s_south: { label: "s from the south foot", units: "R_*" } },
    fitAxis: (src, id) => (id in ALONG_AXES && alongS(src) ? { dim: "pt", values: null, along: ALONG_AXES[id] } : null),
    fitsDims: (dims, id) => (dims.includes("pt") ? id in ALONG_AXES : undefined),
    lineData, readsWith: src => (alongS(src) ? [alongS(src)] : []),
    startPicks: (src, q) => ((src ? isAlong(src) : String(q ?? "").startsWith("along.")) ? { r_max: 3 } : null),   // v10.2: the line r_max = 3
    setMapAxes, mapAxes, mapTimes, mapYRange, mapLoad, mapPrepare, mapView, mapPaint, mapLabels,
    mapAxisOptions: ALONG_AXIS_OPTS, mapAxisTitle: "time, or the position along the line",
    mapPairOk: (a, b) => !!alongKind(a, b), mapOtherFor: v => (ALONG_POS.includes(v) ? "time" : "s"),
    mapCanLog: d => d === "r_max", mapSkipDims: ["pt", "time"], mapRows, mapHint,
    lineoutDefault, lineoutPositions, lineoutCurve,
  });
  // v8.27 line length; v10.0: only the stored length of along-line data at the line's points (its last s)
  api.registerReadingOp({ key: "length", label: "line length (R*)", text: "line length (R*, per curve: its last s)", perCurve: true,
    value: c => c?.sLen ?? NaN, missing: "a line length needs along-line data at the line's points (true s)",
    help: "Line length: the length of each curve's own field line (its last s; along-line data at the line's points); where a setting or f(x) uses it, each curve uses its own." });
  api.registerPlotMenu({ key: "linkedSlices", label: "▦ linked slices (r_max × s × t)",
    title: "three maps of this quantity as one figure — one line over time, every line at the slider's time, every line over time at one position — tied by $rmax, $spos and the time slider (click a plot to move them)",
    available: panel => panel.type === "2d" && isAlong(srcOf(eff(panel).run, eff(panel).q)), run: panel => linkedSlices(panel, api.core) });
  api.registerMigration(() => migrateProfiles(api.core));
}
