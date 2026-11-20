// curvetools.js (analysis plugin; DECISIONS D22) — the fit and the averaged curve, moved from the core: their
// TOOL_DEFS entries, card rows and → table (settings.js) and their drawing (panel1d.js render1D). Their maths stays core:
// fit.js (fit variables are a core variable kind) and stats.js. A fit: a polynomial, power law or exponential of each
// curve over a range (→ variable, → table); an averaged curve: each curve averaged along another axis (r_max …).
import * as R from "../../js/render.js";
import { srcOf, fitAxis, dimCoord, isFn, num1, subVars, axisInfo, toolValues, setToolValues, newId } from "../../js/model.js";
import { el, select, text, toggle, closePopover } from "../../js/ui.js";
import { lineName } from "../../js/lines.js";
import { numRef, newMeasuredVar, newFitVar } from "../../js/vars.js";
import { fmtV, dash, plotName, rangeText } from "../../js/settings.js";
import { castForm, tabLineText } from "../../js/tables.js";
import { fitParams, fitCurve, meanOf } from "../../js/fit.js";
import { lineCurve, asDrawn, overRange, ownLabel, slotKey } from "../../js/panel1d.js";

// v5.13 (1D): a least-squares fit of each curve; a mean of each curve (v14.5.1: along another axis; a stored "mean" with
// no axis becomes a draw line when a desktop opens). line: a line id or null (all); over: "range" = the whole curve (inside
// the time range on a time axis, narrowed by from / to) | "shown" = the window. (Were model.js newTool's "mean" / "fit".)
const newMean = (extra = {}) => ({ id: newId(), type: "mean", visible: true, line: null, along: null, over: "range", from: null, to: null, curveColors: true, color: "#555555", dash: "dashed", width: 1.2, label: null, ...extra });
const newFit = (extra = {}) => ({ id: newId(), type: "fit", visible: true, line: null, model: "poly", degree: 2, over: "range", from: null, to: null, curveColors: true, color: "#555555", dash: "dashed", width: 1.4, show: true, ...extra });

/** The averaged curve and the fit share their rows (which line, range, colours, → variable). */
function curveToolRows(ctx, t, upd) {
  const p = ctx.panel;
    const lines = ctx.get("lines") || [], name = lineName;
    const xaxis = ctx.get("xaxis"), dims = new Map();
    for (const l of lines) {
      if (isFn(l) || (t.line != null && l.id !== t.line)) continue;
      const src = srcOf(l.run, l.q), f = src && fitAxis(src, xaxis);
      if (f) for (const d of src.dims) if (d !== f.dim && !dims.has(d)) dims.set(d, d === "time" ? "time" : dimCoord(src, d).label || d);
    }
    const along = t.type === "mean" && t.along ? t.along : null;
    // v8.12 (human 2026-10-20: "whole curve … gives me options of x axis range, that is confusing … I just want to set
    // bounds"): just bounds — empty = the whole curve; view_x0 / view_x1 (▾) = the part shown. A "shown part" tool
    // becomes those.
    if (!along && t.over === "shown") { t.over = "range"; t.from = "$view_x0"; t.to = "$view_x1"; }
    const fromTo = [numRef(t.from ?? null, v => upd("from", v), { size: 5, placeholder: "start", title: "from (empty = the start of the curve; view_x0 = the start of the part shown)" }), dash(),
      numRef(t.to ?? null, v => upd("to", v), { size: 5, placeholder: "end", title: "to (empty = the end of the curve; view_x1 = the end of the part shown)" })];
    return [
      el("div", { class: "pop-row" }, "of", select([["", "every line"], ...lines.map(l => [String(l.id), name(l)])], t.line == null ? "" : String(t.line), v => upd("line", v === "" ? null : Number(v)))),
      // v14.5.1 (Phase 3): "along x" is gone from the card — a line at each curve's mean is a horizontal line "from each curve"
      t.type === "mean" ? el("div", { class: "pop-row" }, "along", select([...dims].map(([d, lab]) => [d, lab]), t.along ?? [...dims.keys()][0] ?? "", v => upd("along", v || null),
        { title: "each curve averaged over this axis, drawn beside it (a line at each curve's mean along x: a horizontal line, \"from each curve\")" })) : null,
      t.type === "fit" ? el("div", { class: "pop-row" }, select([["poly", "polynomial"], ["power", "power law A x^p"], ["exp", "exponential A e^(kx)"]], t.model || "poly", v => upd("model", v)),
        t.model === "poly" || !t.model ? numRef(t.degree ?? 2, v => upd("degree", v ?? 2), { size: 2, title: "degree (0–8)" }) : null,
        // v8.10 (human 2026-10-16: "tau is useful but … for general exponential fit maybe just k, so I guess can choose k or tau")
        t.model === "exp" ? select([["k", "label: e^(kt)"], ["tau", "label: e^(−t/τ)"]], t.expShow || "k", v => upd("expShow", v), { title: "the formula label: the rate k, or the decay time τ = −1/k" }) : null) : null,
      el("div", { class: "pop-row" }, along ? "over" : "x from", fromTo,
        el("span", { class: "dim", title: `empty: the whole curve${xaxis === "time" ? " (inside the ⏱ time range)" : ""} · view_x0 / view_x1 (▾ in the box): the part of the plot shown, following pan & zoom` }, "ⓘ")),
      // v8.11 (human 2026-10-20: the fit text "more customizable … kinda like the legend"): what its text says
      t.type === "fit" ? el("div", { class: "pop-row" }, "text",
        text(t.label ?? "", v => upd("label", v || null), { size: 14, placeholder: "label (automatic)", title: "the text before the formula; {c} = the curve's name; {name} = a variable; $…$ = LaTeX; empty = the curve's name when the fit has several curves" }),
        toggle("R²", t.showR2 !== false, v => upd("showR2", v), { title: "show R² (how well it fits)" }),
        toggle("range", !!t.showRange, v => upd("showRange", v), { title: "show the x range the fit used" })) : null,
      el("div", { class: "pop-row" }, toggle("curve colours", t.curveColors !== false, v => upd("curveColors", v), { title: "each curve's own colour (off: the colour below)" }),
        t.type === "mean" ? text(t.label ?? "", v => upd("label", v || null), { size: 12, placeholder: "label", title: "{v} = the mean" })
          : toggle("formula", t.show !== false, v => upd("show", v), { title: "show the fitted formula and R²" }),
        t.type === "mean" ? el("button", { title: "a reading of these means (one per curve)",
          onclick: () => { closePopover(); newMeasuredVar({ panel: p.id, line: t.line ?? lines.find(l => !isFn(l))?.id, op: "mean", along: t.along, over: t.over, from: t.from, to: t.to }); } }, "→ variable")
        : el("button", { title: "a fit variable: k, τ, A or R² (a coefficient for a polynomial) of this fit, one value per dataset — other plots and analytic functions can use it",
          onclick: () => { closePopover(); newFitVar({ panel: p.id, tool: t.id, line: t.line ?? lines.find(l => !isFn(l))?.id }); } }, "→ variable"),
        t.type === "fit" ? el("button", { title: "cast this fit's numbers (τ, k, A, R² …) of each curve into a table (sidebar → Tables); they stay until you cast again",
          onclick: () => { closePopover(); castFit(ctx, t); } }, "→ table") : null)];
}
// ---- "→ table" (v14.0, human 2026-11-13: "I basically want the cast to cast a number and then that number isnt updated
// unless I cast again"): a fit's numbers of each curve, with the curve's dataset and picks, into a table ----------------
const SHORT = { tau: "τ", r2: "R²" };
function castFit(ctx, t) {
  const model = t.model || "poly", pars = fitParams(model, t.degree ?? 2), vals = toolValues(ctx.panel?.id, t.id) || [];
  const mname = { poly: `degree-${fmtV(t.degree ?? 2)} polynomial`, power: "power-law", exp: "exponential" }[model] || model;
  castForm(vals.map(v => ({ run: v.at?.run ?? null, d: v.at?.d ?? {}, values: Object.fromEntries(pars.map(([k]) => [k, v.params?.[k]])) })),
    pars.map(([k, lab], i) => [k, SHORT[k] ?? k, i === 0, `${lab} of the ${mname} fit on the plot "${plotName(ctx)}"${rangeText(t)}`]));
}

/** The averaged curve's curves (its prepare1d, before the plot's y range). v5.14 (human 2026-10-06: "mean along the given
 *  axis … mean along s/smax"): for each curve, the same line averaged over the tool's axis (dashed, in the curve's colour). */
async function averagedCurves({ s, T, curves, multiRun, errors, toolCurves }, t) {
  if (!t.along) return null;
  const done = new Set();
  for (const c of curves) {
    if (c.isFn || !c.src || (t.line != null && c.line.id !== t.line) || !c.src.dims.includes(t.along) || fitAxis(c.src, s.xaxis)?.dim === t.along) continue;
    // averaged over the list's own axis: one curve (per dataset of a dataset list, v8.18)
    const sub = c.sub && c.sub.dim === t.along ? (c.sub.run !== undefined ? { run: c.sub.run, k: c.sub.k, n: c.sub.n, ref: c.sub.ref } : null) : c.sub;
    const key = sub ? slotKey(c.line, sub) : String(c.line.id);
    if (done.has(key)) continue;
    done.add(key);
    const l2 = t.along === "time" ? { ...c.line, timeMode: "mean", timeFrom: t.from ?? null, timeTo: t.to ?? null }
      : { ...c.line, picks: { ...(c.line.picks || {}), [t.along]: { mean: true, from: t.from ?? null, to: t.to ?? null } } };
    const r = await lineCurve(s, l2, multiRun, sub).catch(e => ({ error: String(e?.message || e) }));
    if (r.error) { if (!errors.includes(`mean: ${r.error}`)) errors.push(`mean: ${r.error}`); continue; }
    await asDrawn(s, [r.curve], T);                   // v14.4: as drawn
    toolCurves.push({ tid: t.id, parent: c, curve: r.curve });
  }
  return null;
}
/** An averaged curve along an axis: its curves (above), drawn. */
function drawAveraged(env, t) {
  const { ctx, plot, ax, ay, dpr, toolCurves, colorOfSlot } = env;
  ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
  for (const o of toolCurves.filter(o => o.tid === t.id))
    R.drawPolyline(ctx, o.curve.xs, o.curve.ys, ax, ay, t.curveColors !== false ? colorOfSlot(o.parent.line, o.parent.sub, o.parent.key) : t.color, num1(t.width, 1.2) * dpr, t.dash || "dashed", dpr);
  ctx.restore();
}
/** A fit (and a stored "mean" with no axis: a rule at each curve's mean): one per curve of the chosen line(s), on the
 *  curves as drawn (v5.13); the fit's numbers are its card's values (setToolValues). */
function drawFit(env, t) {
  const { panel, s, T, ctx, plot, ax, ay, dpr, curves, win, tx, info, colorOfSlot } = env;
  let mine = curves.filter(c => t.line == null || c.line.id === t.line).filter(c => t.type === "mean" || !c.isFn);
  // v14.0.1 (human 2026-11-13: no fit on a table plot, "they are of different datsets though"): a table line's points
  // are one curve per dataset (its colours); a fit or mean takes all of the line's points together
  if (mine.some(c => c.isTab)) {
    const merged = new Map();
    mine = mine.flatMap(c => {
      if (!c.isTab) return [c];
      const pts = [...c.xs].map((x, j) => [x, c.ys[j]]);
      if (merged.has(c.line.id)) { merged.get(c.line.id).pts.push(...pts); return []; }
      const m = { pts, c }; merged.set(c.line.id, m); return [m];
    }).map(o => {
      if (!o.pts) return o;
      o.pts.sort((u, v) => u[0] - v[0]);
      const name = tabLineText(o.c.line);
      return { ...o.c, xs: Float64Array.from(o.pts.map(q => q[0])), ys: Float64Array.from(o.pts.map(q => q[1])), sub: null, key: String(o.c.line.id),
        label: name, compact: name, subLabel: null, at: null, mergedTab: true };
    });
  }
  const [a, b] = overRange(s, t, win, T.x?.g), oneLine = new Set(mine.map(c => c.line.id)).size === 1;
  const tag = c => (mine.length < 2 ? "" : `${(oneLine && c.subLabel) || (ownLabel(c.line, c) ?? c.compact)}: `);   // what tells the fits apart
  const fv = [];                                    // v14.0: each curve's fit numbers (its card's "→ table")
  for (const c of mine) {
    const col = c.mergedTab ? c.line.color || t.color : t.curveColors !== false ? colorOfSlot(c.line, c.sub, c.key) : t.color;   // v14.0.1
    if (t.type === "mean") {
      const m = meanOf(c.xs, c.ys, a, b);
      R.drawRule(ctx, plot, ay, m, false, col, num1(t.width, 1.2), t.dash || "dashed", dpr);
      if (t.label) R.drawRuleLabel(ctx, plot, ay, m, false, col, subVars(t.label, tx), dpr);
      continue;
    }
    const fr = fitCurve(c.xs, c.ys, t.model || "poly", num1(t.degree, 2), a, b, T.x ? T.x.tex : s.xaxis === "time" ? "t" : "x", { tau: t.expShow === "tau" });
    if (fr.error) { env.error(`fit: ${fr.error}`); continue; }
    fv.push({ label: c.label, at: c.at ? { run: c.at.run, d: { ...c.at.d } } : null, params: fr.params, x0: fr.x0, x1: fr.x1 });
    const lo = Math.max(fr.x0, win[0]), hi = Math.min(fr.x1, win[1]), n = 200, lg = s.logx && lo > 0;
    const FX = new Float64Array(n), FY = new Float64Array(n);
    for (let j = 0; j < n; j++) { const x = lg ? lo * Math.pow(hi / lo, j / (n - 1)) : lo + ((hi - lo) * j) / (n - 1); FX[j] = x; FY[j] = fr.f(x); }
    ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
    R.drawPolyline(ctx, FX, FY, ax, ay, col, num1(t.width, 1.4) * dpr, t.dash || "dashed", dpr);
    ctx.restore();
    if (t.show !== false) {
      // v8.11: its own label ({c} = the curve's name; empty = automatic), R² and the fitted x range on / off
      const cname = (oneLine && c.subLabel) || (ownLabel(c.line, c) ?? c.compact);
      const pre = t.label ? subVars(String(t.label).replace(/\{c\}/g, cname), tx) + " " : tag(c);
      const xn = T.x ? T.x.label : s.xaxis === "time" ? "t" : axisInfo(s.xaxis).label;
      info.push({ color: col, tool: t, text: pre + fr.text + (t.showR2 !== false ? `   R² = ${fr.r2.toFixed(3)}` : "")
        + (t.showRange ? `   (${xn} ${R.fmt(fr.x0)}–${R.fmt(fr.x1)})` : "") });
    }
  }
  if (t.type === "fit") setToolValues(panel.id, t.id, fv);
}

/** D22: the fit and the averaged curve (their definitions as in the core's TOOL_DEFS before, plus their drawing). */
export function registerCurveTools(api) {
  api.registerTool({ key: "fit", label: "fit", folder: "curves", where: "1d",
    help: "a polynomial, power law or exponential fit of each curve over a range; its numbers (τ, k, p, A, R²) → variables",
    is: t => t.type === "fit", make: () => newFit(),
    summary: (ctx, t) => `${{ poly: `degree-${fmtV(t.degree ?? 2)} polynomial`, power: "power-law", exp: "exponential" }[t.model || "poly"]} fit`, rows: curveToolRows, style: true, colour: t => (t.curveColors !== false ? "curves" : "single"),
    draw1d: (env, t) => drawFit(env, t), textRow: true });
  api.registerTool({ key: "meanalong", label: "averaged curve", folder: "curves", where: "1d",
    help: "each curve averaged along another axis (e.g. over r_max), drawn beside it",
    is: t => t.type === "mean", make: ctx => {
      const xaxis = ctx.get("xaxis"), l = (ctx.get("lines") || []).find(x => !isFn(x)), src = l && srcOf(l.run, l.q), f = src && fitAxis(src, xaxis);
      return newMean({ along: src?.dims.find(d => d !== f?.dim) ?? null });
    },
    summary: (ctx, t) => `mean${t.along ? ` along ${t.along}` : ""} of ${t.line == null ? "every line" : "one line"}`, rows: curveToolRows, style: true, colour: t => (t.curveColors !== false ? "curves" : "single"),
    problem: ctx => {                                   // (was settings.js toolProblem's branch)
      const xaxis = ctx.get("xaxis"), curves = (ctx.get("lines") || []).filter(l => !isFn(l));
      const other = curves.some(l => { const src = srcOf(l.run, l.q), f = src && fitAxis(src, xaxis); return !!src && src.dims.some(d => d !== f?.dim); });
      return other ? null : "its curves have no other axis to average over";
    },
    prepare1d: (env, t) => averagedCurves(env, t),
    draw1d: (env, t) => (t.along ? drawAveraged(env, t) : drawFit(env, t)),
    legend1d: (env, t) => (t.along && env.toolCurves.some(o => o.tid === t.id)
      ? [{ label: t.label ? subVars(t.label, env.tx) : `mean over ${t.along === "time" ? "t" : axisInfo(t.along).label}`, color: "#555555",
        dash: t.dash || "dashed", width: num1(t.width, 1.2), sep: true, tool: t }] : []) });
}
