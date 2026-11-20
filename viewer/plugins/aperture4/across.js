// across.js (aperture4 plugin since v15.0; was js/across.js) — "across lines" lines (v14.6; human 2026-11-13, Phase 4: "go for it", DECISIONS D11). From a stored
// quantity over (time, r_max) — a value per field line at every output — the browser makes one curve over time: the
// slope across the lines at a chosen line, or a sum / integral / mean / max over the lines (stats.js acrossValue). This
// is how the retired stored rates are made now (∂V/∂Ψ: slope of line_voltage against Ψ, with a mean over ±2.5 in time to match the stored one;
// ohmic power: 2π × ∫ line_voltage d(line_current), inner lines first — both checked against the stored ones 2026-11-13), computed when drawn, never stored, never stale. A made line kind: linekinds.js.
import { srcOf, runOf, runsOf, listOf, newId, isRef, num1, numOf, store } from "../../js/model.js";
import { acrossValue } from "../../js/stats.js";
import * as R from "../../js/render.js";
import { el, select, closePopover, colorPicker } from "../../js/ui.js";
import { numRef, runSelect } from "../../js/vars.js";
import { keepOnScreen } from "../../js/lines.js";

export const ACROSS_OPS = {
  slope: "slope across the lines, at a line",
  int: "∫ … dr_max over the lines",
  intd: "∫ … d(another) over the lines",
  mean: "mean over the lines",
  max: "max over the lines",
};
export const isAcross = l => !!l?.across;
/** Is source s a quantity with one value per field line at every output (dims time, r_max)? */
export const isLineSeries = s => !!s && s.hasTime && s.spaceDims.length === 1 && s.spaceDims[0] === "r_max";
/** The quantities of dataset `run` it can be made from: [[name, label]]. */
export function lineSeriesOf(run) {
  const r = store.runs[runOf(runsOf(run)[0] ?? run)];
  return r ? Object.values(r.sources).filter(isLineSeries).map(s => [s.name, s.label]).sort((a, b) => a[1].localeCompare(b[1])) : [];
}
export const newAcrossLine = (run, q, extra = {}) => ({ id: newId(),
  across: { q, op: "slope", at: 5, wrt: "psi", q2: null, k: 1, from: null, to: null, ...extra },
  run, label: null, color: null, dash: "solid", width: 1.4, visible: true });

/** One curve per dataset of a dataset list, and (a slope) per line of an r_max list. */
export function acrossExpansions(line) {
  const a = line.across, runs = runsOf(line.run), ats = a.op === "slope" ? listOf(a.at) : [];
  const atSubs = ats.length > 1 ? ats.map((v, k) => ({ at: v, k, n: ats.length, ref: isRef(a.at) ? a.at : null, label: `r_max = ${R.fmt(v)}` })) : [null];
  if (runs.length > 1) return runs.flatMap((run, k) => atSubs.map(o => ({ ...(o || {}), run, k, n: runs.length, ref: line.run, label: o ? `${run} · ${o.label}` : run,
    ...(o ? { ik: o.k, in: o.n, iref: o.ref } : {}) })));
  return atSubs;
}
const lab = (run, q) => srcOf(run, q)?.label ?? q ?? "?";
/** Its name in lists and the legend. */
export function acrossText(l) {
  const a = l.across, run = runsOf(l.run)[0] ?? runOf(l.run), q = lab(run, a.q), k = num1(a.k, 1);
  const pre = k === 1 ? "" : k === -1 ? "−" : `${R.fmt(k)} × `;
  const body = a.op === "slope" ? `d(${q})/d${a.wrt === "rmax" ? "r_max" : "Ψ"} across the lines`
    : a.op === "int" ? `∫ ${q} dr_max over the lines` : a.op === "intd" ? `∫ ${q} d(${lab(run, a.q2)}) over the lines`
    : `${a.op} of ${q} over the lines`;
  return pre + body;
}
/** The curve over time (the plot's x must be time). */
export async function acrossCurve(s, line, sub) {
  const a = line.across, run = runOf(sub?.run ?? runsOf(line.run)[0] ?? line.run);
  if (s.xaxis !== "time") return { error: `across lines: it is a curve over time, and this plot's x is ${s.xaxis}` };
  const src = srcOf(run, a.q);
  if (!src) return { error: `across lines: ${a.q ?? "?"} is not stored for ${run}` };
  if (!isLineSeries(src)) return { error: `across lines: ${src.label} is not one value per field line over time` };
  const src2 = a.op === "intd" ? srcOf(run, a.q2) : null;
  if (a.op === "intd" && !isLineSeries(src2)) return { error: `across lines: pick the second quantity (one value per field line over time)` };
  const rm = Array.from(src.run.coord("r_max").values, Number), Bp = Number(src.run.conf?.Bp);
  if (a.op === "slope" && a.wrt !== "rmax" && !Number.isFinite(Bp)) return { error: `across lines: ${run} has no Bp in its config (Ψ = Bp / r_max)` };
  const x = a.op === "slope" && a.wrt !== "rmax" ? rm.map(r => Bp / r) : rm;
  const at = sub?.at ?? listOf(a.at)[0] ?? NaN, k = num1(a.k, 1), from = numOf(a.from ?? NaN), to = numOf(a.to ?? NaN);
  const n = src.nFrames, ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = await src.frame(i), row2 = src2 ? await src2.frame(src2.indexAt(src.times[i])) : null;
    ys[i] = k * acrossValue(a.op, rm, x, row, { at: Number(at), q2: row2, from: Number(from), to: Number(to) });
  }
  const subLabel = sub?.label ?? (a.op === "slope" ? `r_max = ${R.fmt(Number(at))}` : null), name = acrossText(line);
  // the legend's compact labels: what differs between its curves (dataset, line), like the other made kinds
  const keyed = [["q", name], ["run", run], ...(sub?.at !== undefined ? [["d:r_max", `r_max = ${R.fmt(sub.at)}`]] : [])];
  const listKey = !sub ? null : sub.at !== undefined && sub.ik === undefined && sub.run === undefined ? "d:r_max" : "run";
  return { curve: { line, sub, src: null, isAcross: true, xs: Float64Array.from(src.times), ys, keyed, listKey,
    label: [name, subLabel].filter(Boolean).join(" · "), subLabel,
    at: { run, d: a.op === "slope" && Number.isFinite(Number(at)) ? { r_max: Number(at) } : {} } } };
}

/** v14.6 (Phase 4, DECISIONS D11): the rows that say what an "across lines" line computes (its editor and "+ line"). */
function acrossRows(a, run, redraw) {
  const qs = lineSeriesOf(run), up = (k, v) => { a[k] = v; redraw(); };
  return [
    el("div", { class: "pop-row" }, el("span", { class: "lab" }, "of"), qs.length ? select(qs, a.q ?? qs[0]?.[0], v => up("q", v), { title: "a quantity with one value per field line at every output" })
      : el("span", { class: "warn" }, "nothing stored with one value per field line over time")),
    el("div", { class: "pop-row" }, el("span", { class: "lab" }, "makes"), select(Object.entries(ACROSS_OPS), a.op, v => up("op", v))),
    a.op === "slope" ? el("div", { class: "pop-row" }, "at r_max", numRef(a.at, v => up("at", v ?? 5), { size: 8, list: true, title: "the line (r_max) where the slope is taken; a list or a list variable: one curve each" }),
      "against", select([["psi", "Ψ = Bp / r_max"], ["rmax", "r_max"]], a.wrt || "psi", v => up("wrt", v), { title: "d/dΨ across the lines (∂V/∂Ψ is the voltage-predicted twist rate), or d/dr_max" })) : null,
    a.op === "intd" ? el("div", { class: "pop-row" }, "d(", select(qs, a.q2 ?? "", v => up("q2", v), { title: "the second quantity: ∫ q dq₂ over the lines, inner lines first (e.g. ∫ V dI)" }), ")") : null,
    a.op !== "slope" ? el("div", { class: "pop-row" }, "lines r_max", numRef(a.from ?? null, v => up("from", v), { size: 5, placeholder: "first" }), "–",
      numRef(a.to ?? null, v => up("to", v), { size: 5, placeholder: "last" })) : null,
    el("div", { class: "pop-row" }, "× k", numRef(a.k ?? 1, v => up("k", v ?? 1), { size: 5, title: "a factor: −1 flips the sign. 2π × ∫ line_voltage d(line_current) (inner lines first) = the retired stored ohmic power (checked 2026-11-13 to 4 digits)" })),
  ];
}
/** v14.6: the editor of an "across lines" line: what it computes, its dataset, style. */
export function editAcross(panel, line, lines, push, box, api, defaultColor) {
  const a = line.across;
  const draw = () => {
    box.replaceChildren(
      el("div", { class: "pop-title" }, acrossText(line)),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "dataset"), runSelect(line.run, v => { line.run = v; push(true); draw(); }, { lists: true })),
      ...acrossRows(a, line.run, () => { push(true); draw(); }),
      el("div", { class: "pop-row" }, "style",
        el("select", { onchange: e => { line.dash = e.target.value; push(); } }, Object.keys(R.DASHES).map(k => el("option", { value: k, selected: k === (line.dash || "solid") }, k))),
        "width", numRef(line.width ?? 1.4, w => { if (isRef(w) || w > 0) { line.width = w; push(); } }, { size: 3 }),
        el("label", { class: "chk" }, el("input", { type: "checkbox", checked: line.visible !== false, onchange: e => { line.visible = e.target.checked; push(); } }), "shown")),
      colorPicker(line.color || defaultColor, col => { line.color = col; push(); }, api.usedColors()),
      el("div", { class: "dim" }, "Computed in the browser at every output from the stored values of all the field lines (never stored). The retired stored ∂V/∂Ψ averaged over 5 time units: smooth this line by a mean over ±2.5 to match it."),
      el("div", { class: "pop-row pop-sep" },
        el("button", { onclick: () => { lines.splice(lines.indexOf(line), 1); closePopover(); push(true); } }, "remove line"),
        el("button", { onclick: closePopover }, "done")));
    keepOnScreen(box);
  };
  draw();
}
/** v15.0: everything "across lines" adds to the viewer (aperture4 plugin). */
export function registerAcross(api) {
  api.registerLineKind({ key: "across", label: "across lines", is: l => isAcross(l),
    expand: l => acrossExpansions(l), curve: (s, l, sub) => acrossCurve(s, l, sub), name: l => acrossText(l),
    editor: (...a) => editAcross(...a), colour: null,
    deps: () => ({}), yId: l => `across:${l.across.op}:${l.across.q}${l.across.q2 ? "/" + l.across.q2 : ""}`,
    caps: { slider: true, perDataset: true, smooth: true } });
  api.registerLineMenu({ key: "across", label: "across lines…",
    help: "from a quantity with one value per field line: at every output its slope across the lines at a line (∂V/∂Ψ …) or its sum / integral / mean / max over the lines (∫ V dI …); computed in the browser",
    available: ctx => ctx.s.xaxis === "time",
    form: ctx => {
      const ad = (ctx.across ||= { run: ctx.run, q: null, op: "slope", at: 5, wrt: "psi", q2: null, k: 1, from: null, to: null });
      if (!ad.q) ad.q = lineSeriesOf(ad.run).find(([n]) => n === "line_voltage")?.[0] ?? lineSeriesOf(ad.run)[0]?.[0] ?? null;
      return [
        el("div", { class: "pop-row" }, el("span", { class: "lab" }, "dataset"), runSelect(ad.run, v => { ad.run = v; ad.q = null; ctx.redraw(); }, { lists: true })),
        ...acrossRows(ad, ad.run, ctx.redraw),
        el("div", { class: "pop-row" },
          el("button", { class: "on", disabled: !ad.q || (ad.op === "intd" && !ad.q2), onclick: () => { const { run, ...rest } = ad; ctx.place([newAcrossLine(run, rest.q, rest)]); } }, "add"),
          el("button", { onclick: ctx.cancel }, "cancel"))];
    } });
}
