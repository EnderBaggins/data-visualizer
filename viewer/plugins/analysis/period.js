// period.js (analysis plugin; DECISIONS D22) — the period tool and the plots made from it, moved from the core:
// its TOOL_DEFS entry, card rows and → table (settings.js), its drawing (panel1d.js render1D), the plots made from it
// (cycleplots.js, lines.js editCyc, app.js newCycPlot; the "cyc" line kind of linekinds.js). The period method itself stays
// core (cycles.js): the readings "period", "regularity" and "ncycles" use it too.
// The plots made from a period tool (was js/cycleplots.js; v14.1, human 2026-11-13: "it is nice to have tools have option of make
// new plot (and can choose which plot) these would probably be default linked to same panel"). A cycle line
// (line.cyc = {tool, what}) reads the period tool's last results (TOOL_VALUES, filled when its plot draws; that plot then
// asks these plots to redraw), so it follows the tool: change the window or detrend there and these change.
//   ac        each curve's autocorrelation against the lag (its first half), the chosen peak marked;
//   sp / sr   each curve's period / regularity in sliding windows (the tool's width and step) over the whole curve, the
//             tool's window shaded;
//   pp pr pl pn   per curve: period, regularity, lag, number of cycles against the pick the curves differ by (r_max …).
import * as R from "../../js/render.js";
import { DASHES } from "../../js/render.js";
import { isFn, isRef, num1, eff, newId, toolValues, setToolValues, settings1D, newPanel } from "../../js/model.js";
import { el, select, toggle, colorPicker, closePopover } from "../../js/ui.js";
import { lineName, keepOnScreen } from "../../js/lines.js";
import { numRef, newMeasuredVar } from "../../js/vars.js";
import { fmtV, dash, plotName } from "../../js/settings.js";
import { castForm } from "../../js/tables.js";
import { lineCan } from "../../js/linekinds.js";
import { overRange } from "../../js/panel1d.js";
import * as CYC from "../../js/cycles.js";
import { sliding } from "../../js/cycles.js";

let CORE = { toast() {}, spawnPlot() {} };               // api.core (registerPeriod)
// v14.1: the cycle period in a window (cycles.js); was model.js newTool("period")
const newPeriod = (extra = {}) => ({ id: newId(), type: "period", visible: true, line: null, from: null, to: null, detrend: "linear", width: 32, step: 2, color: "#7a3fb0", show: true, ...extra });

// ---- the plots made from a period tool (was js/cycleplots.js) ----------------------------------------------------------
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
/** v14.1: a new plot made from period tool t on `panel` (what: CYC_WHAT), right after it; it follows the tool (was app.js newCycPlot). */
function newCyclePlot(panel, t, what) {
  const v = toolValues(panel.id, t.id), dim = isPerCurve(what) ? curveDim(v) : null;
  if (isPerCurve(what) && !dim) { CORE.toast("the period tool's curves do not differ by a pick (r_max …): cast them to a table instead (→ table)", true); return; }
  const xaxis = what === "ac" ? "lag" : dim ?? v?.xaxis ?? eff(panel).xaxis;
  const ns = settings1D(xaxis, null);
  ns.lines = [newCycLine(t.id, what, panel.id)];
  if (what !== "sp" && what !== "sr") ns.tools = [];
  ns.labels = { ...(ns.labels || {}), ylabel: CYC_WHAT[what] };
  // (human 2026-11-13: "make the new plot linked in the same panel"): docked under its source plot, in its figure
  CORE.spawnPlot(panel, newPanel("1d", ns, { name: `${CYC_WHAT[what]} · ${panel.name || "plot"}` }));   // v14.2.1: beside its source (v14.5: spawnPlot)
  CORE.toast(`${CYC_WHAT[what]}: a new plot beside its source that follows the period tool (its window, detrend)`);
}
/** v14.1: the editor of a period-tool plot's line — what it shows, style. It follows the tool (window, detrend). */
export function editCyc(panel, line, lines, push, box, api, defaultColor) {
  const draw = () => {
    box.replaceChildren(
      el("div", { class: "pop-title" }, "from a period tool"),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "shows"), select(Object.entries(CYC_WHAT), line.cyc.what, v => { line.cyc.what = v; push(true); draw(); },
        { title: "per-curve kinds need this plot's x to be the pick the curves differ by (r_max …); the others: lag (autocorrelation) or the source's x (sliding)" })),
      el("div", { class: "pop-row" }, "style",
        el("select", { onchange: e => { line.dash = e.target.value; push(); } }, Object.keys(DASHES).map(k => el("option", { value: k, selected: k === (line.dash || "solid") }, k))),
        "width", numRef(line.width ?? 1.4, w => { if (isRef(w) || w > 0) { line.width = w; push(); } }, { size: 3 }),
        el("label", { class: "chk" }, el("input", { type: "checkbox", checked: line.visible !== false, onchange: e => { line.visible = e.target.checked; push(); } }), "shown")),
      colorPicker(line.color || defaultColor, col => { line.color = col; push(); }, api.usedColors()),
      el("div", { class: "dim" }, "Made from a period tool on another plot: it changes when that tool's window or detrend changes. Its x: lag (autocorrelation), the source's x (sliding), or the pick the curves differ by (per curve)."),
      el("div", { class: "pop-row pop-sep" },
        el("button", { onclick: () => { lines.splice(lines.indexOf(line), 1); closePopover(); push(true); } }, "remove line"),
        el("button", { onclick: closePopover }, "done")));
    keepOnScreen(box);
  };
  draw();
}

// ---- the tool --------------------------------------------------------------------------------------------------------
function periodRows(ctx, t, upd) {
  const p = ctx.panel;
  // v14.1: the cycle period in a window (cycles.js)
    const lines = (ctx.get("lines") || []).filter(l => !isFn(l)), v = toolValues(ctx.panel?.id, t.id), f = x => (Number.isFinite(x) ? R.fmt(x) : "—");
    const run = String(t.detrend || "").startsWith("running:"), view = ctx.get("view");
    const perOk = !!curveDim(v);
    return [
      el("div", { class: "pop-row" }, "of", select([["", "every line"], ...lines.map(l => [String(l.id), lineName(l)])], t.line == null ? "" : String(t.line), x => upd("line", x === "" ? null : Number(x)))),
      el("div", { class: "pop-row" }, "window", numRef(t.from ?? null, x => upd("from", x), { size: 5, placeholder: "start", title: "where the cycle lives: from (in x as drawn; empty = the start)" }), dash(),
        numRef(t.to ?? null, x => upd("to", x), { size: 5, placeholder: "end", title: "to (empty = the end)" }),
        el("button", { title: view ? "the window = the x range shown now (zoom to the cycles first)" : "zoom the plot to the cycles first, then click: the window = the x range shown", disabled: !view,
          onclick: () => { const a = Math.min(view.x0, view.x1), b = Math.max(view.x0, view.x1); t.from = Number(a.toPrecision(5)); t.to = Number(b.toPrecision(5)); upd("to", t.to); } }, "use the zoom")),
      el("div", { class: "pop-row" }, "detrend", select([["linear", "linear fit"], ["mean", "mean"], ["quadratic", "quadratic fit"], ["running", "running mean over W"]], run ? "running" : t.detrend || "linear",
        x => upd("detrend", x === "running" ? `running:${Math.max(3, Math.round(3 * ((v?.curves || []).map(c => c.period).find(Number.isFinite) || 8)))}` : x), { title: "the slow trend removed inside the window first (the research session found every choice gives the same period on ec025)" }),
        run ? ["W", numRef(Number(String(t.detrend).split(":")[1]), x => { if (Number(x) > 0) upd("detrend", `running:${x}`); }, { size: 4, title: "running-mean width (x units); keep it > 3 × the period" })] : null),
      v?.curves?.length ? el("div", { class: "toolvals" }, v.curves.map(c => el("div", { title: c.note || "" }, el("span", { class: "dim" }, `${c.display}: `),
        Number.isFinite(c.period) ? `${f(c.period)} · reg ${c.regularity.toFixed(2)} · ${f(c.n_cycles)} cycles${Number.isFinite(c.lag) && v.curves.length > 1 ? ` · lag ${f(c.lag)}` : ""}` : (c.note || "no clear cycle")))) : el("div", { class: "dim" }, "values: shown after the plot is drawn"),
      Number.isFinite(v?.inPhase) ? el("div", { class: "dim", title: "mean pairwise correlation of the detrended curves in the window (1 = all in step)" }, `in phase ${v.inPhase.toFixed(2)} · lags against ${v.curves[v.ref]?.display ?? "?"}`) : null,
      el("div", { class: "pop-row" },
        el("button", { title: "cast period, regularity, cycles (and lag) of each curve into a table — you tick which", onclick: () => { closePopover(); castPeriod(ctx, t); } }, "→ table"),
        el("button", { title: "a reading: period, regularity or number of cycles of one line, one value per dataset (pick which in the form)",
          onclick: () => { closePopover(); newMeasuredVar({ panel: ctx.panel.id, line: t.line ?? lines.find(l => lineCan(l, "slider"))?.id, op: "period", from: t.from ?? null, to: t.to ?? null, detrend: t.detrend || "linear" }); } }, "→ variable"),
        select([["", "new plot…"], ["ac", CYC_WHAT.ac], ["sp", CYC_WHAT.sp], ["sr", CYC_WHAT.sr], ...(perOk ? ["pp", "pr", "pl", "pn"].map(k => [k, CYC_WHAT[k]]) : [])], "",
          x => { if (!x) return; closePopover(); newCyclePlot(ctx.panel, t, x); }, { title: "a new plot made from this tool, next to this one; it follows the tool (window, detrend). Per-curve plots need curves that differ by a pick (r_max …)" })),
      el("div", { class: "pop-row" }, "sliding", numRef(t.width ?? 32, x => { if (Number(x) > 0) upd("width", x); }, { size: 3, title: "the sliding plots' window width (x units)" }), "step",
        numRef(t.step ?? 2, x => { if (Number(x) > 0) upd("step", x); }, { size: 3, title: "their step" }),
        toggle("text", t.show !== false, x => upd("show", x), { title: "the numbers in the plot's text box" }))];
}
// v14.1: the period tool's numbers of each curve → a table (the human picks which)
function castPeriod(ctx, t) {
  const v = toolValues(ctx.panel?.id, t.id);
  if (!v?.curves) return castForm([], []);
  const where = `in ${v.win.map(x => (Number.isFinite(x) ? R.fmt(x) : "…")).join("–")} (detrend ${v.how}) on the plot "${plotName(ctx)}"`;
  castForm(v.curves.map(c => ({ run: c.at?.run ?? null, d: c.at?.d ?? {}, values: { period: c.period, regularity: c.regularity, n_cycles: c.n_cycles, lag: c.lag } })),
    [["period", "period", true, `cycle period ${where}`], ["regularity", "regularity", true, `cycle regularity ${where}`], ["n_cycles", "cycles", false, `number of cycles ${where}`],
      ...(v.curves.length > 1 && v.curves.some(c => Number.isFinite(c.lag)) ? [["lag", "lag", false, `lag against the most regular curve ${where}`]] : [])]);
}
/** v14.1 (human 2026-11-13, the research session's cycle-period method, claude_work/lib/cycles.py): the period of each
 *  curve inside the window (shaded), its regularity and number of cycles, and (curves on one time grid) their lags. */
function drawPeriod(env, t) {
  const { panel, s, T, ctx, plot, ax, curves, win, info, colorOfSlot } = env;
  const mine = curves.filter(c => !c.isFn && (t.line == null || c.line.id === t.line));
  const [a, b] = overRange(s, t, win, T.x?.g), lo = Math.min(a, b), hi = Math.max(a, b), how = t.detrend || "linear";
  const X0 = ax.to(Math.max(lo, win[0])), X1 = ax.to(Math.min(hi, win[1]));
  if (Number.isFinite(X0) && Number.isFinite(X1)) {
    ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
    ctx.globalAlpha = 0.08; ctx.fillStyle = t.color || "#7a3fb0"; ctx.fillRect(Math.min(X0, X1), plot.y, Math.abs(X1 - X0), plot.h); ctx.restore();
  }
  const res = mine.map(c => {
    const [tw, yw] = CYC.window([...c.xs], [...c.ys], Number.isFinite(lo) ? lo : null, Number.isFinite(hi) ? hi : null);
    let r;
    try { r = tw.length >= 4 ? CYC.period(tw, yw, how) : null; } catch (e) { r = { period: NaN, regularity: NaN, n_cycles: NaN, ac: [], lag: [], note: String(e?.message || e) }; }
    return { c, tw, yw, r: r || { period: NaN, regularity: NaN, n_cycles: NaN, ac: [], lag: [], note: "fewer than 4 points in the window" } };
  });
  const n0 = res[0]?.tw.length, sameGrid = res.length > 1 && res.every(o => o.tw.length === n0 && o.tw.every((x, i) => Math.abs(x - res[0].tw[i]) <= 1e-9 * Math.max(1, Math.abs(x))));
  const L = sameGrid && n0 >= 4 ? CYC.lines(res[0].tw, res.map(o => o.yw), how, res.map(o => o.r.regularity), res.map(o => o.r.period)) : null;
  const vals = { win: [lo, hi], how, width: num1(t.width, 32), step: num1(t.step, 2), xaxis: s.xaxis, inPhase: L ? L.in_phase : NaN, ref: L ? L.ref : null,
    curves: res.map((o, k) => ({ label: o.c.label, display: o.c.display ?? o.c.label, at: o.c.at ? { run: o.c.at.run, d: { ...o.c.at.d } } : null, color: colorOfSlot(o.c.line, o.c.sub, o.c.key),
      period: o.r.period, regularity: o.r.regularity, n_cycles: o.r.n_cycles, note: o.r.note, candidate: o.r.candidate ?? null, lag: L ? L.lag[k] : NaN,
      ac: { x: o.r.lag, y: o.r.ac }, src: { xs: [...o.c.xs], ys: [...o.c.ys] } })) };
  vals.sig = JSON.stringify([vals.win, how, vals.width, vals.step, vals.curves.map(v => [v.label, v.period, v.regularity, v.lag, v.src.ys.length])]);
  setToolValues(panel.id, t.id, vals, vals.sig);    // v14.4: the plots made from it redraw when sig changes (change bus)
  if (t.show !== false) for (const v of vals.curves) info.push({ color: v.color, tool: t,
    text: `${mine.length > 1 ? v.display + ": " : ""}${Number.isFinite(v.period) ? `period ${R.fmt(v.period)} · regularity ${v.regularity.toFixed(2)} · ${R.fmt(v.n_cycles)} cycles` : "no clear cycle"}` });
}

/** D22: the period tool, its plots' line kind ("cyc") and their editor. */
export function registerPeriod(api) {
  CORE = api.core;
  api.registerTool({ key: "period", label: "period", folder: "curves", where: "1d",
    help: "the period of a cycle in each curve inside a window you choose (detrended autocorrelation, its first peak; regularity < 0.2 = no clear cycle), the lags between curves; → table, → variable, new plots (autocorrelation, period over time, per curve)",
    is: t => t.type === "period", make: () => newPeriod(),
    summary: (ctx, t) => `period in ${t.from == null && t.to == null ? "the whole curve" : `${fmtV(t.from ?? null) === "?" ? "start" : fmtV(t.from)}–${fmtV(t.to ?? null) === "?" ? "end" : fmtV(t.to)}`} (detrend ${t.detrend || "linear"})`, rows: periodRows, style: false, colour: () => "single",
    draw1d: (env, t) => drawPeriod(env, t) });
  api.registerLineKind({ key: "cyc", label: "period tool", is: l => isCyc(l),
    expand: l => cycExpansions(l), curve: (s, l, sub) => cycCurve(s, l, sub), name: l => cycLineText(l),
    editor: (...a) => editCyc(...a), colour: (l, sub) => toolValues(l.cyc.panel ?? null, l.cyc.tool)?.curves?.[sub.k]?.color ?? null,
    deps: l => ({ tool: l.cyc.tool }), yId: l => `cyc:${l.cyc.what}`,
    caps: { slider: false, perDataset: false, smooth: false } });
}
