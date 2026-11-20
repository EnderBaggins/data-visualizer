// steps.js (analysis plugin; DECISIONS D22) — the steps tool (steps above a running-median background; v8.29) and
// "steps from another plot" (v8.32), moved from the core: their TOOL_DEFS entries and card rows (settings.js), their
// drawing (panel1d.js render1D), the steps tool's output card (vars.js stepsOutputView), the output kind "steps" (its
// fields for "$name.from" …, was model.js OUTPUT_FIELDS) and the names of old unnamed steps tools (app.js migration).
// The computation: stepsof.js. The aperture4 plugin's foot gaps read named steps tools (plugins/aperture4/gapseries.js).
import * as R from "../../js/render.js";
import { isFn, isRef, num1, newId, axisLabel, outputNames, liveOutput, outputCurve, putOutput, freeToolName, renameOutput, validVarName, nameTaken, OUTPUT_FIELDS } from "../../js/model.js";
import { el, select, text, toggle, closePopover } from "../../js/ui.js";
import { lineName } from "../../js/lines.js";
import { numRef, outputActions, curveNames } from "../../js/vars.js";
import { fmtV } from "../../js/settings.js";
import { ownLabel } from "../../js/panel1d.js";
import { stepsOf } from "./stepsof.js";

let CORE = { toast() {} };                              // api.core (registerSteps)
// v8.29 (1D): steps above a running-median background: w = its window along x, k = the threshold in robust σ
const newSteps = (extra = {}) => ({ id: newId(), type: "steps", visible: true, line: null, w: 3, k: 3, showBg: true, showThr: true, shade: true, show: true, width: 1.1, ...extra });
// v8.32 (1D): another tool's steps (its output, by name) shaded on this plot's curves: whole steps light, 10–90 % dark
const newStepbands = (extra = {}) => ({ id: newId(), type: "stepbands", visible: true, source: null, whole: true, core: true, color: "#888888", ...extra });

function stepsRows(ctx, t, upd) {
  const p = ctx.panel;
  // v8.29: the slope-of-the-drop steps (claude_work/scratch/gap-proto/steps.py)
    const lines = ctx.get("lines") || [], name = lineName;
    // v8.32: its name = its output's name (sidebar → Outputs; "$name.from" in number fields; + tool → steps from an output)
    const rename = v => {
      const n = String(v || "").trim();
      if (!n || n === t.name) return;
      if (!validVarName(n) || nameTaken(n)) { alert(`"${n}": a name of letters, digits and _ that no variable or tool has`); return; }
      const old = t.name; t.name = n; if (old) renameOutput(old, n); upd("name", n);
    };
    return [
      el("div", { class: "pop-row" }, "name", text(t.name ?? "", rename, { size: 10, title: "its name: number fields read $name.from, .to, .start, .end, .excess, .count, .sigma; \"steps from another plot\" shades its steps there" })),
      el("div", { class: "pop-row" }, "of", select([["", "every line"], ...lines.filter(l => !isFn(l)).map(l => [String(l.id), name(l)])], t.line == null ? "" : String(t.line), v => upd("line", v === "" ? null : Number(v)))),
      el("div", { class: "pop-row" }, "background: median over",
        numRef(t.w ?? 3, v => { if (isRef(v) || v > 0) upd("w", v); }, { size: 4, title: "the window of the running median along x, in x as drawn (R* on an s axis); a variable works" }),
        "· steps above it by", numRef(t.k ?? 3, v => upd("k", v ?? 3), { size: 3, title: "k: a step is where the curve is above the background by more than k σ (σ = 1.4826 × the median absolute deviation of curve − background); a variable works" }), "σ"),
      el("div", { class: "pop-row" }, toggle("background", t.showBg !== false, v => upd("showBg", v), { title: "draw the background b (dashed, the curve's colour)" }),
        toggle("threshold", t.showThr !== false, v => upd("showThr", v), { title: "draw b + kσ (dotted)" }),
        toggle("shade", t.shade !== false, v => upd("shade", v), { title: "shade the steps: light = from where the excess starts to where it ends, dark = 10–90 % of its excess ∫(curve − b) dx" }),
        toggle("text", t.show !== false, v => upd("show", v), { title: "σ and the steps' 10–90 % spans in the plot's text box" })),
      ...stepsOutputView(t.name),                          // v12.2: what it found (was the Tools tab's pinned values)
      el("div", { class: "dim" }, "Use it in a slope plot (a line's \"→ its slope\", or + line → slope of…), with the sign that makes the drop positive (−d/dx when the quantity falls along x): the steps are where the drop is steeper than its running median.")];
}
function stepbandsRows(ctx, t, upd) {
  const p = ctx.panel;
  // v8.32: another named steps tool's steps, shaded here
    const outs = outputNames().filter(n => liveOutput(n)?.kind === "steps");
    return [
      el("div", { class: "pop-row" }, "steps of", select([...(t.source && !outs.includes(t.source) ? [[t.source, `${t.source} (not found)`]] : []), ...outs.map(n => [n, `${n} (${liveOutput(n).xlabel})`])],
        t.source ?? "", v => upd("source", v), { title: "a steps tool (by its name): its steps, each curve here shaded with its own field line's (same dataset and r_max)" })),
      el("div", { class: "pop-row" }, toggle("whole step", t.whole !== false, v => upd("whole", v), { title: "light: from where its excess starts to where it ends" }),
        toggle("10–90 %", t.core !== false, v => upd("core", v), { title: "darker: 10–90 % of its excess ∫(curve − b) dx" })),
      el("div", { class: "dim" }, outs.length ? "Each curve gets the steps found on its own field line (same dataset and r_max) by the named tool; the x axes must match." : "No named steps tool yet: a slope plot's + tool → steps above a running median.")];
}
/** v12.2 (human 2026-11-12: "lets just get rid of pinned values and steps tool can keep its own things"): what steps tool
 *  `n` found at the time shown, in its card: per curve its σ and steps, copy as CSV, and the buttons other plugins add for
 *  steps outputs (aperture4: → foot gaps vs t; vars.js registerOutputAction). (Was part of the Outputs tab, then the Tools
 *  tab's "pinned values", both gone; D22: was vars.js.) */
export function stepsOutputView(n) {
  const o = n ? liveOutput(n) : null;
  if (!o || o.kind !== "steps") return [el("div", { class: "dim" }, "its steps: shown after the plot is drawn")];
  const f = x => (Number.isFinite(x) ? R.fmt(x) : "—"), names = curveNames(o.curves);
  const total = o.curves.reduce((s, c) => s + c.steps.length, 0);
  const csv = ["output,curve,step,from_10,to_90,start,end,excess,sigma",
    ...o.curves.flatMap((c, i) => (c.steps.length ? c.steps : [null]).map((st, j) => [n, `"${names[i]}"`, st ? j + 1 : 0, ...(st ? [st.s10, st.s90, st.x0, st.x1, st.D] : ["", "", "", "", ""]), c.sigma].join(",")))].join("\n");
  const rows = o.curves.flatMap((c, i) => [
    el("tr", { class: "outcurve" }, el("td", { colspan: 4, title: c.label }, `${names[i]} · σ ${f(c.sigma)} · ${c.steps.length} step${c.steps.length === 1 ? "" : "s"}`)),
    ...c.steps.map((st, j) => el("tr", {}, el("td", { class: "dim" }, String(j + 1)), el("td", { title: "10–90 % of its excess" }, `${f(st.s10)}–${f(st.s90)}`),
      el("td", { class: "dim", title: "the whole step" }, `${f(st.x0)}–${f(st.x1)}`), el("td", { title: "excess ∫(curve − background) dx" }, f(st.D))))]);
  return [
    el("div", { class: "pop-row" }, el("span", { class: "dim" }, `found ${total} step${total === 1 ? "" : "s"} on ${o.curves.length} curve${o.curves.length === 1 ? "" : "s"}`),
      el("button", { class: "tog", title: "copy every step as CSV (output, curve, step, from_10, to_90, start, end, excess, sigma)",
        onclick: () => navigator.clipboard?.writeText(csv).then(() => CORE.toast(`${n}: ${total} steps copied as CSV`), () => CORE.toast("could not copy (the browser refused)", true)) }, "copy CSV"),
      // v15.0: buttons plugins add to this card (aperture4: → foot gaps vs t)
      ...outputActions(o.kind).map(a => el("button", { class: "tog", title: a.title || "", onclick: () => { closePopover(); a.run(n); } }, a.label))),
    el("div", { class: "toolvals" }, el("table", { class: "outtab" }, el("tr", { class: "dim" }, el("th", {}, "#"), el("th", {}, "10–90 %"), el("th", {}, "whole"), el("th", {}, "excess")), ...rows)),
    el("div", { class: "dim", title: "type these into number fields (a vertical line at $" + n + ".from draws one line per step)" },
      `$${n}.` + Object.keys(OUTPUT_FIELDS[o.kind] || {}).join(" · ."))];
}

/** The steps tool before the plot's y range (its prepare1d): each chosen curve's background b and threshold b + kσ (tool
 *  curves: in the y range) and its steps (shaded when drawn); a named tool publishes them. Returns [{tid, parent, r}]. */
function findSteps({ panel, s, T, curves, toolCurves }, t) {
  const mine = [];
  for (const c of curves) {
    if (c.isFn || (t.line != null && c.line.id !== t.line)) continue;
    const r = stepsOf(c, t);
    if (!r) continue;
    mine.push({ tid: t.id, parent: c, r });
    if (t.showBg !== false) toolCurves.push({ tid: t.id, parent: c, curve: { xs: r.xs, ys: r.b }, role: "bg" });
    if (t.showThr !== false) toolCurves.push({ tid: t.id, parent: c, curve: { xs: r.xs, ys: r.thr }, role: "thr" });
  }
  // v8.32: a named steps tool publishes its steps (the sidebar's Outputs tab; "$name.from" …; steps from an output)
  if (t.name) {
    const out = { kind: "steps", panel: panel.id, toolId: t.id, x: JSON.stringify([s.xaxis, s.xfn || ""]), xlabel: T.x ? T.x.label : axisLabel(s.xaxis),
      w: num1(t.w, 3), k: num1(t.k, 3), curves: mine.map(o => ({ at: o.parent.at ? { run: o.parent.at.run, d: { ...o.parent.at.d } } : null,
        label: o.parent.label, sigma: o.r.sigma, steps: o.r.steps.map(st => ({ x0: st.x0, x1: st.x1, s10: st.s10, s90: st.s90, D: st.D })) })) };
    putOutput(t.name, out);                           // v14.4: the result store (its users redraw on a change)
  }
  return mine;
}
/** v8.29: steps shaded (light: widened, dark: 10–90 %), b dashed, b + kσ dotted; σ and the largest steps in the text box. */
function drawSteps(env, t, prepared) {
  const { ctx, plot, ax, ay, dpr, info, toolCurves, colorOfSlot } = env;
  const mine = prepared || [];
  ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
  if (t.shade !== false) for (const o of mine) {
    ctx.fillStyle = colorOfSlot(o.parent.line, o.parent.sub, o.parent.key);
    for (const st of o.r.steps) for (const [a, b, al] of [[st.x0, st.x1, 0.1], [st.s10, st.s90, 0.22]]) {
      const X0 = ax.to(a), X1 = ax.to(b);
      if (!Number.isFinite(X0) || !Number.isFinite(X1)) continue;
      ctx.globalAlpha = al; ctx.fillRect(Math.min(X0, X1), plot.y, Math.max(1, Math.abs(X1 - X0)), plot.h);
    }
  }
  ctx.globalAlpha = 1;
  for (const o of toolCurves.filter(o => o.tid === t.id))
    R.drawPolyline(ctx, o.curve.xs, o.curve.ys, ax, ay, colorOfSlot(o.parent.line, o.parent.sub, o.parent.key), num1(t.width, 1.1) * dpr, o.role === "thr" ? "dotted" : "dashed", dpr);
  ctx.restore();
  if (t.show !== false) for (const o of mine) {
    const name = (o.parent.subLabel || (ownLabel(o.parent.line, o.parent) ?? o.parent.compact ?? o.parent.label));
    // the three largest by excess ∫(curve − b) dx (their 10–90 % spans), largest first; the rest counted
    const st = o.r.steps, top = [...st].sort((p, q) => q.D - p.D).slice(0, 3);
    const list = top.map(x => `${R.fmt(x.s10)}–${R.fmt(x.s90)} (${R.fmt(x.D)})`).join(", ") + (st.length > top.length ? ` +${st.length - top.length}` : "");
    const flat = !(o.r.sigma > 0) ? " (the background follows the curve: widen its window)" : "";
    info.push({ color: colorOfSlot(o.parent.line, o.parent.sub, o.parent.key), tool: t,
      text: `${mine.length > 1 ? name + ": " : ""}σ = ${R.fmt(o.r.sigma)}${flat} · ${st.length ? `${st.length} step${st.length > 1 ? "s" : ""}, largest: ${list}` : "no steps"}` });
  }
}
/** v8.32: another tool's steps, each curve its own field line's (same dataset and picks). */
function drawStepbands(env, t) {
  const { s, ctx, plot, ax, curves, colorOfSlot } = env;
  const o = liveOutput(t.source);
  if (!o) { const m = `steps from another plot: there is no steps tool named "${t.source ?? "?"}"`; env.error(m); return; }
  if (o.x !== JSON.stringify([s.xaxis, s.xfn || ""])) { const m = `steps of ${t.source} are along "${o.xlabel}", not this plot's x`; env.error(m); }
  ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
  for (const c of curves) {
    const oc = c.isFn ? null : outputCurve(o, c.at);
    if (!oc) continue;
    ctx.fillStyle = colorOfSlot(c.line, c.sub, c.key);
    for (const st of oc.steps) for (const [a, b, al] of [[st.x0, st.x1, t.whole !== false ? 0.1 : 0], [st.s10, st.s90, t.core !== false ? 0.22 : 0]]) {
      const X0 = ax.to(a), X1 = ax.to(b);
      if (!al || !Number.isFinite(X0) || !Number.isFinite(X1)) continue;
      ctx.globalAlpha = al; ctx.fillRect(Math.min(X0, X1), plot.y, Math.max(1, Math.abs(X1 - X0)), plot.h);
    }
  }
  ctx.globalAlpha = 1; ctx.restore();
}

/** D22: the steps tool, "steps from another plot", the "steps" output kind, the old-desktop names. */
export function registerSteps(api) {
  CORE = api.core;
  api.registerOutputKind({ kind: "steps",
    fields: { from: "the 10 % point of each step (x)", to: "the 90 % point of each step (x)", start: "where each step starts (x)",
      end: "where each step ends (x)", excess: "each step's excess ∫(curve − background) dx", count: "the number of steps (one per curve)",
      sigma: "σ of curve − background (one per curve)" },
    values: (c, field) => {                                 // one curve's values of a field: a list (was model.js fieldOf)
      if (field === "count") return [c.steps.length];
      if (field === "sigma") return [c.sigma];
      const key = { from: "s10", to: "s90", start: "x0", end: "x1", excess: "D" }[field];
      return key ? c.steps.map(st => st[key]) : [];
    } });
  api.registerTool({ key: "steps", label: "steps", folder: "more", where: "1d",
    help: "steps above a running-median background (the slope-of-the-drop gaps); named; its card lists its steps",
    is: t => t.type === "steps", make: () => newSteps({ name: freeToolName("steps") }),
    summary: (ctx, t) => `${t.name ? t.name + ": " : ""}steps above the median over ${fmtV(t.w ?? 3)} (${fmtV(t.k ?? 3)} σ) of ${t.line == null ? "every line" : "one line"}`, rows: stepsRows, style: true, colour: () => "curves",
    prepare1d: (env, t) => findSteps(env, t), draw1d: (env, t, mine) => drawSteps(env, t, mine) });
  api.registerTool({ key: "stepbands", label: "steps from another plot", folder: "more", where: "1d",
    help: "a named steps tool's steps shaded on this plot's curves (same dataset and r_max)",
    is: t => t.type === "stepbands", make: () => newStepbands({ source: outputNames().find(n => liveOutput(n)?.kind === "steps") ?? null }),
    summary: (ctx, t) => `steps of ${t.source ?? "?"} (shaded)`, rows: stepbandsRows, style: false, colour: () => "curves",
    problem: () => (outputNames().some(n => liveOutput(n)?.kind === "steps") ? null : "there is no steps tool on any plot yet (add one to a slope plot first)"),   // (was settings.js toolProblem's branch)
    draw1d: (env, t) => drawStepbands(env, t) });
  // v8.32.1: steps tools made before tools had names get one (steps1 …), so their output shows (was in app.js migrateDerivedKinds)
  api.registerMigration(S => {
    for (const st of [...S.panels.map(p => p.settings), ...Object.values(S.groups || {}).map(g => g.settings)])
      for (const t of [...(st?.tools || []), ...(st?.ownTools || [])]) if (t?.type === "steps" && !t.name) t.name = freeToolName("steps");
  });
}
