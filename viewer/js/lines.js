// lines.js — the "+ line" form and the legend's line editor of 1D panels (human 2026-10-01): pick a dataset
// and a datatype that fits the panel's x and y axes (readable names, grouped by section), the value of every
// other dim (in any of its coordinates, e.g. r_max or θ_foot), then colour / style / label. Edits apply live.
// v5 (human 2026-10-05): datasets may be variables; values may be variable names; the header has one chip per
// dataset of the panel (swap / remove all its lines) and "+ dataset" (this panel's lines for another dataset).
import * as R from "./render.js";
import { S, store, srcOf, fitAxis, ctxPanel, eff, panelRun, datatypes, menuSections, coordChoices, newLine, newId, indexer, pickIndex, pickCoord, isRef, runOf, runLabel, runNames, numOf, isFn, isMeanPick,
  isAn, anDef, anBindings, newAnalyticLine, PREFS, timeUnits, axisLabel, runsOf, isRunList, varOf, listOf, listColor, listEntries, newVarName, usesOf, splitKind, lineKind, opLabel, axisInfo } from "./model.js";
import { compileFunction } from "./data.js";
import { el, select, popover, closePopover, colorPicker, colorButton } from "./ui.js";
import { DASHES } from "./render.js";
import { runSelect, numRef, parseNumRef, newMeasuredVar, varPick, fontSize, runListChips, setRuns, varsChanged, cardLabel, runTip, runRefTip, aboutLine,
  compareBox, groupedRunTicks } from "./vars.js";
import { expansions, normSmooth } from "./panel1d.js";
import { tableOf, numericCols, parseTabAxis, newTabLine, tables } from "./tables.js";   // v14.0
import { CYC_WHAT } from "./cycleplots.js";   // v14.1
import { loLineText } from "./lineout.js";   // v14.2
import { madeKind, isRecordedLine } from "./linekinds.js";

/** v10.1.1 (human 2026-11-10: "average over x axis … a window defined in the UNITS of the x axis"): the smoothing of a
 *  line (inherit: "as the plot" offered) or of every line of a plot — mean or median over x ± h, h in the x axis's units
 *  (xu). spec: undefined (as the plot), false / null (none) or {h, kind}; dflt: h when first switched on. onChange(spec,
 *  rebuild): rebuild = the controls change shape (the kind, not h). */
export function smoothControls(spec, onChange, { inherit = false, xu = "", dflt = 0.25 } = {}) {
  const on = !!spec && typeof spec === "object";
  const mode = on ? (spec.kind === "median" ? "median" : "mean") : spec === undefined && inherit ? "" : "none";
  const kindSel = select([...(inherit ? [["", "as the plot"]] : []), ["none", "none"], ["mean", "mean"], ["median", "median"]], mode, v => {
    if (v === "") onChange(undefined, true);
    else if (v === "none") onChange(false, true);
    else onChange({ h: on ? spec.h : dflt, kind: v }, true);
  }, { title: "smooth the curve along x, before any slope or d/dt\nmean: the integral over x ± h ÷ its length (points spread unevenly do not weigh more)\nmedian: of the points in x ± h, each weighted by the stretch of x it stands for (a spike is outvoted, a jump stays sharp)" });
  if (!on) return el("span", { class: "smooth" }, kindSel);
  return el("span", { class: "smooth" }, kindSel, "over x ±",
    numRef(spec.h ?? null, v => { if (v === null || isRef(v) || v > 0) onChange({ ...spec, h: v }, false); },
      { size: 4, title: "h: each point is smoothed over x − h … x + h, in the x axis's units; a variable works — a line length $L is each line's own" }),
    xu ? el("span", { class: "dim" }, xu) : null);
}
/** Scale controls (v5.5): "÷ its own max", "÷ max of <datatype> on the same line" (e.g. the drive twist),
 *  "÷ its value at x =", "÷ number / variable". inherit = a line's control (first choice: as the panel). */
export function scaleControls(spec, onChange, run, xaxis, inherit = false) {
  const mode = spec === undefined ? (inherit ? "inherit" : "none") : spec === null ? "none" : spec.mode;
  const groups = datatypes(run, xaxis, null), all = groups.flatMap(([, it]) => it.map(([n]) => n));
  const defQ = PREFS.scaleRef.find(q => all.includes(q)) ?? all[0];   // v15.0: a plugin's preference (aperture4: drive_twist)
  const set = patch => onChange({ ...(spec || {}), ...patch });
  const out = [select([...(inherit ? [["inherit", "as the plot"]] : []), ["none", "none"], ["max", "÷ its own max |y|"], ["mean", "÷ its own mean"], ["ref", "÷ max |y| of … (same line)"], ["at", "÷ its value at x ="], ["num", "÷ number / variable"]], mode,
    m => (m === "inherit" ? onChange(undefined) : m === "none" ? onChange(inherit ? { mode: "none" } : null) : set({ mode: m, q: spec?.q ?? defQ })),
    { title: "divide each curve, e.g. twist angle ÷ max |drive twist| of the same field line, to compare shapes" })];
  if (mode === "ref") out.push(groupedSelect(groups, spec.q ?? defQ, q => set({ q })));
  if (mode === "at") out.push(numRef(spec.at ?? null, v => set({ at: v }), { size: 6, placeholder: "x", title: "x position (a number or a variable)" }));
  if (mode === "num") out.push(numRef(spec.value ?? 1, v => set({ value: v ?? 1 }), { size: 6, title: "divide by (a number or a variable)" }));
  if (mode === "mean") out.push(numRef(spec.from ?? null, v => set({ from: v }), { size: 4, placeholder: "from", title: "mean from x = (empty = the start; on a time axis the desktop's time range)" }),
    numRef(spec.to ?? null, v => set({ to: v }), { size: 4, placeholder: "to", title: "mean to x = (empty = the end)" }));
  return out;
}

export function keepOnScreen(box) {                                 // keep a re-filled pop-over on screen
  const r = box.getBoundingClientRect();
  if (r.bottom > innerHeight - 8) box.style.top = Math.max(8, innerHeight - r.height - 8) + "px";
  if (r.right > innerWidth - 8) box.style.left = Math.max(8, innerWidth - r.width - 8) + "px";
}
export function groupedSelect(groups, value, onchange, props = {}) {
  return el("select", { ...props, onchange: e => onchange(e.target.value) },
    groups.map(([sec, items]) => el("optgroup", { label: sec }, items.map(([v, lab, attrs]) => el("option", { ...(attrs || {}), value: v, selected: v === value }, lab)))));
}
const tokens = t => String(t ?? "").split(/[,\s]+/).filter(Boolean);
/** One typed value -> a pick: a variable ("$name", read in the shown coordinate) or the dim's own coordinate value;
 *  v8.25: on a named axis also a value's name ("north"). */
function pickOf(tok, vals, own, names = null) {
  const ni = names ? names.findIndex(n => n.toLowerCase() === String(tok).toLowerCase()) : -1;
  if (ni >= 0) return own[ni];
  const r = parseNumRef(tok);
  if (r.error || r.value === null) return undefined;
  if (isRef(r.value)) return r.value;
  const i = indexer(vals)(r.value);
  return i >= 0 ? own[i] : undefined;
}

/** Rows for the dims of `src` other than the x axis; writes into the draft line `d`. */
function dimRows(src, xdim, d, onChange, allowList) {
  const rows = [];
  for (const dim of src.dims) {
    if (dim === xdim) continue;
    if (dim === "time") {
      rows.push(el("div", { class: "pop-row" }, el("span", { class: "lab" }, "time"),
        el("select", { onchange: e => { d.timeMode = e.target.value; onChange(true); } },
          el("option", { value: "follow", selected: d.timeMode !== "fixed" && d.timeMode !== "mean" }, "follows the slider"),
          el("option", { value: "fixed", selected: d.timeMode === "fixed" }, "fixed at"),
          el("option", { value: "mean", selected: d.timeMode === "mean" }, "mean over")),                  // v5.14
        d.timeMode === "fixed" ? numRef(d.fixedTime ?? Number(R.fmt(S.t)), v => { d.fixedTime = v; onChange(); }, { size: 6, title: "time" }) : null,
        // v10.1.1 (human 2026-11-10: averaging r_max profiles over outputs "is still something I need access to"): the
        // profile as the mean of the outputs within t ± h around its time (was "average ±N" outputs; they are 1 R*/c apart)
        d.timeMode !== "mean" ? [el("span", { class: "dim" }, "mean over t ±"),
          numRef(d.tavg !== undefined ? d.tavg : d.avg ?? null, v => { if (v === null) delete d.tavg; else d.tavg = v; delete d.avg; onChange(); },
            { size: 3, placeholder: "0", title: "average this profile over the outputs within t − h … t + h around its time (h in the time axis's units); empty or 0 = none; a variable works" }),
          el("span", { class: "dim" }, timeUnits())] : null,
        d.timeMode === "mean" ? [numRef(d.timeFrom ?? null, v => { d.timeFrom = v; onChange(); }, { size: 5, placeholder: "from", title: "from t = (empty = the start of the desktop's time range)" }), "–",
          numRef(d.timeTo ?? null, v => { d.timeTo = v; onChange(); }, { size: 5, placeholder: "to", title: "to t = (empty = its end)" })] : null));
      continue;
    }
    const choices = coordChoices(src, dim), as = pickCoord(src, dim, d.pickAs?.[dim])[0];
    const vals = choices.find(c => c[0] === as)[2], own = choices[0][2], p = d.picks?.[dim];
    const names = as === choices[0][0] ? src.run.coord(dim)?.names || null : null;          // v8.25: a named axis
    // v5.14 (human 2026-10-06: "mean along s/smax"): one value, or the mean over (a range of) this dim
    const modeSel = el("select", { title: "one value, or the mean over this coordinate (a range of it: from – to, empty = all)", onchange: e => {
      if (e.target.value === "mean") { d.picks = { ...(d.picks || {}), [dim]: { mean: true, from: null, to: null } }; delete (d.pickValues || {})[dim]; }
      else { const rest = { ...(d.picks || {}) }; delete rest[dim]; d.picks = rest; }
      onChange(true);
    } }, el("option", { value: "value", selected: !isMeanPick(p) }, "="), el("option", { value: "mean", selected: isMeanPick(p) }, "mean over"));
    const coordSel = () => el("select", { title: "give the value in this coordinate", onchange: e => {
        d.pickAs = { ...(d.pickAs || {}), [dim]: e.target.value }; delete (d.pickValues || {})[dim];
        if (isMeanPick(d.picks?.[dim])) d.picks = { ...d.picks, [dim]: { mean: true, from: null, to: null } };   // the range was in the old coordinate
        onChange(true);
      } }, choices.map(([n, lab]) => el("option", { value: n, selected: n === as }, lab)));
    if (isMeanPick(p)) {
      const setP = (k, v) => { d.picks = { ...d.picks, [dim]: { ...d.picks[dim], [k]: v } }; onChange(); };
      rows.push(el("div", { class: "pop-row" }, el("span", { class: "lab" }, dim), coordSel(), modeSel,
        numRef(p.from ?? null, v => setP("from", v), { size: 5, placeholder: R.fmt(Math.min(...vals)), title: "from (empty = all)" }), "–",
        numRef(p.to ?? null, v => setP("to", v), { size: 5, placeholder: R.fmt(Math.max(...vals)), title: "to (empty = all)" })));
      continue;
    }
    const cur = d.pickValues?.[dim] ?? (isRef(p) ? p.slice(1) : names?.[pickIndex(src, dim, p)] ?? R.fmt(vals[pickIndex(src, dim, p)]));
    const inp = el("input", { type: "text", size: allowList ? 14 : 8, value: cur, class: isRef(p) ? "numref bound" : "",
      title: (allowList ? "one value, or several separated by commas (one line each)" : "value") + " · or a variable's name, e.g. rmax (a list variable draws this line once per value)",
      onchange: e => {
        const first = tokens(e.target.value)[0], v = first === undefined ? undefined : pickOf(first, vals, own, names);
        inp.classList.toggle("bad", first !== undefined && v === undefined);
        if (v === undefined) return;
        d.pickValues = { ...(d.pickValues || {}), [dim]: e.target.value };
        d.picks = { ...(d.picks || {}), [dim]: v };
        d.pickAs = { ...(d.pickAs || {}), [dim]: as };
        onChange(isRef(v) !== isRef(p));
      } });
    rows.push(el("div", { class: "pop-row" }, el("span", { class: "lab" }, dim), coordSel(), modeSel, inp, varPick(inp)));
  }
  return rows;
}

/** v8.14: a rate line's time derivative — d/dt | −d/dt, smoothing ±n, local fit or difference. v8.30: a rate line is a line
 *  of its own ("rate of K"): no "off" here (the plain quantity is another line). */
function ddtRow(dd, set) {
  return el("div", { class: "pop-row" }, el("span", { class: "lab", title: "a rate line: the time derivative of its quantity, computed when drawn (nothing stored)" }, "rate"),
    select([["1", "d/dt"], ["-1", "−d/dt"]], String(dd?.sign ?? 1), v => set({ n: 2, how: "fit", ...(dd || {}), sign: Number(v) }),
      { title: "the time derivative (−d/dt: a loss reads positive) · x = time: along x · another x: along time at each x, around the time shown, or over a \"mean over\" window as the rate over it" }),
    "±", numRef(dd?.n ?? 2, v => set({ ...dd, n: v ?? 2 }), { size: 2, title: "smoothing: ±n outputs" }),
    select([["fit", "local fit"], ["diff", "difference"]], dd?.how || "fit", v => set({ ...dd, how: v }),
      { title: "local fit: the slope of a straight line through the 2n + 1 outputs (over a window: through all of it) · difference: the centred difference of the ±n means (over a window: of its ends)" }));
}
/** v8.29 (human 2026-11-09: "I like the slope of the drop plot is there a way to do that in visualizer without caching
 *  everything?"): a slope line's slope along the plot's x, computed when drawn — d/dx | −d/dx, over a window w in x as
 *  drawn (R* on an s axis). v8.30: a slope line is a line of its own ("slope of K"): no "off" here. v8.31 (human: "get rid
 *  of slope of the drop then I can determine whether to use + or - ddx why add needless complexity"): no automatic sign. */
function slopeRow(sl, set) {
  return el("div", { class: "pop-row" }, el("span", { class: "lab", title: "a slope line: the slope of its quantity along x, computed when drawn (nothing stored)" }, "slope"),
    select([["1", "d/dx"], ["-1", "−d/dx"]], String(Number(sl?.sign) < 0 ? -1 : 1), v => set({ w: 0.5, ...(sl || {}), sign: Number(v) }),
      { title: "the slope along the plot's x: (y(x + w/2) − y(x − w/2)) / w, the curve held at its ends\n" +
        "−d/dx: the same with its sign flipped (a drop along x reads positive)\n" +
        "x as drawn: after the x axis's function (x * L gives R*); after the line's scale, before f(y)" }),
    "over", numRef(sl?.w ?? 0.5, v => { if (isRef(v) || v > 0) set({ ...sl, w: v }); }, { size: 4, title: "the window w along x as drawn; a variable works" }));
}
/** v8.30: new data lines go where their y axis is — this plot when it has none yet or the same one ("slope of K" lines with
 *  "slope of K"), else a new plot right after this one (same x axis), so a slope never shares a y axis with its quantity. */
function placeLines(panel, c, s, made, api) {
  const k = lineKind(made[0], srcOf(made[0].run, made[0].q));
  if (!s.ykind || s.ykind === k) {
    c.set("lines", [...(c.get("lines") || []), ...made]);
    if (!s.ykind && k) c.set("ykind", k);
    closePopover(); api.changed(panel, true);
    return;
  }
  closePopover(); api.plotBeside(panel, made, k);
}
/** The copy of data line `line` drawn as its slope or rate (a new line; the original stays). */
function derivedCopy(line, mode) {
  const l = { ...JSON.parse(JSON.stringify(line)), id: S.nextId++, color: null, label: null };
  delete l.slope; delete l.ddt;                          // (its scale stays: the slope / rate of the curve as you see it)
  if (mode === "slope") l.slope = { sign: 1, w: 0.5 }; else l.ddt = { sign: 1, n: 2, how: "fit" };
  return l;
}
/** With d/dt on, a line may show any quantity with a time axis (its derivative belongs to the panel's y axis). */
const timeDatatypes = (run, xaxis) => datatypes(run, xaxis, null).map(([sec, it]) => [sec, it.filter(([n]) => srcOf(run, n)?.hasTime)]).filter(([, it]) => it.length);

/** "+ line": data (one or more new lines; comma-separated values of one dim make several) or (v8.8) an analytic function
 *  with its parameters set right here. New lines start with the panel's dataset. */
let addKind = "data";
/** v14.9 (plugins.js): kinds a plugin adds to "+ line": {key, label, help, available(ctx), form(ctx), prefer?(ctx)}.
 *  ctx = {s (the plot's settings), panel, run (the dataset the menu starts on), redraw(), place(lines) (add them: this
 *  plot, or a new one beside it when their y axis differs), cancel()}; it is one object per open menu, so a form may keep
 *  its draft on it. form returns the rows under the kind switch, its own add button included. prefer: the menu opens on
 *  this kind (a plot made for it). */
const LINE_MENU = [];
export function registerLineMenu(k) {
  for (const f of ["key", "label", "help", "available", "form"]) if (!(f in (k || {}))) throw new Error(`missing ${f}`);
  if (["data", "slope", "rate", "analytic"].includes(k.key) || LINE_MENU.some(x => x.key === k.key)) throw new Error(`there is already a "+ line" kind "${k.key}"`);
  if (typeof k.available !== "function" || typeof k.form !== "function") throw new Error("available and form must be functions");
  LINE_MENU.push(k);
}
export function openAddLine(panel, clientX, clientY, api) {
  const c = ctxPanel(panel), s = eff(panel), runs = Object.keys(store.runs);
  const ta = parseTabAxis(s.xaxis);
  if (ta) {                                               // v14.0: a table plot takes another column of a table
    const tb = tableOf(ta.table), cols = tb ? numericCols(tb).filter(([k]) => k !== ta.key) : [];
    if (!cols.length) { api.toast?.("the table has no other numeric column"); return; }
    const ysel = select(cols, cols[0][0], () => {});
    popover(clientX, clientY, [el("div", { class: "pop-title" }, `+ column of ${ta.table}`), el("div", { class: "pop-row" }, el("span", { class: "lab" }, "y"), ysel),
      el("div", { class: "pop-row" }, el("button", { onclick: () => { const lines = c.get("lines") || []; lines.push(newTabLine(ta.table, ysel.value)); c.set("lines", lines); closePopover(); api.changed(panel, true); } }, "add"),
        el("button", { onclick: closePopover }, "cancel"))]);
    return;
  }
  const run0 = panelRun(s, panel.type) || s.lines?.find(l => !isFn(l) || isAn(l))?.run || runs[0];
  const d = { run: run0, q: null, picks: {}, pickAs: {}, pickValues: {}, timeMode: "follow" };
  const defs = Object.values(store.analytics || {});
  let draft = defs.length ? newAnalyticLine(defs[0], run0) : null;
  const box = popover(clientX, clientY, []);
  // v8.30: slope and rate lines are made here as lines of their own; a slope / rate plot opens on its own kind
  const sk = splitKind(s.ykind);
  // v14.9: plugins' kinds (foot gaps, across lines …): shown where available; a plot made for one opens on it (prefer)
  const menuCtx = { s, panel, run: d.run, redraw: () => draw(), place: ls => placeLines(panel, c, s, ls, api), cancel: closePopover };
  const plugKinds = LINE_MENU.filter(k => { try { return !!k.available(menuCtx); } catch { return false; } });
  const preferred = plugKinds.find(k => { try { return !!k.prefer?.(menuCtx); } catch { return false; } });
  if (sk.mode) addKind = sk.mode; else if (preferred) addKind = preferred.key; else if (addKind !== "analytic") addKind = "data";
  if (addKind === "slope" && s.xaxis === "time") addKind = "data";
  const KINDS = [["data", "data", "a stored quantity of a dataset"],
    ...(s.xaxis !== "time" ? [["slope", "slope of…", "the slope of a stored quantity along this plot's x (a line of its own: y axis \"slope of …\"; computed when drawn)"]] : []),
    ["rate", "rate of…", "the time derivative d/dt of a stored quantity (a line of its own: y axis \"rate of …\"; computed when drawn)"],
    ...plugKinds.map(k => [k.key, k.label, k.help]),          // v14.9: plugins' kinds
    ["analytic", "analytic", "an analytic function (Functions tab)"]];
  const kindSw = () => el("span", { class: "modesw" }, KINDS.map(([k, lab, tip]) => el("button", { class: addKind === k ? "on" : "", title: tip,
    onclick: () => { addKind = k; draw(); } }, lab)));
  const add = (l, e) => {
    const lines = c.get("lines") || [];
    lines.push(l); c.set("lines", lines);
    closePopover(); api.changed(panel, true);
    return lines;
  };
  const draw = () => {
    const title = el("div", { class: "pop-title" }, `add a line  (x: ${s.xaxis}${s.ykind ? `, y: ${s.ykind}` : ""})`);
    if (addKind === "analytic") {
      if (!draft) { box.replaceChildren(title, kindSw(), el("div", { class: "dim" }, "No functions yet: Functions tab in the sidebar → ＋")); keepOnScreen(box); return; }
      const def = anDef(draft);
      box.replaceChildren(title, kindSw(),
        el("div", { class: "pop-row" }, el("span", { class: "lab" }, "function"),
          select(defs.map(a => [a.name, `${a.label} (${a.name})`]), draft.an, v => { const a = store.analytics[v]; if (a) { draft = newAnalyticLine(a, draft.run); draw(); } })),
        el("div", { class: "pop-row an-formula" }, `${def.name} = ${def.formula}`),
        ...analyticParamRows(draft, s, () => {}, draw),              // each quantity / config parameter names its dataset
        el("div", { class: "pop-row" },
          el("button", { class: "on", onclick: () => { add(draft); } }, "add"),
          el("button", { onclick: closePopover }, "cancel")));
      keepOnScreen(box);
      return;
    }
    const pk = plugKinds.find(k => k.key === addKind);   // v14.9: a plugin's kind draws its own rows
    if (pk) {
      let rows;
      try { rows = pk.form(menuCtx) || []; } catch (e) { rows = [el("div", { class: "dim" }, `this kind failed: ${e.message}`)]; }
      box.replaceChildren(title, kindSw(), ...rows);
      keepOnScreen(box);
      return;
    }
    // v8.30: data / slope of… / rate of…: the quantities of this plot's y axis (its base quantity for a slope / rate
    // plot); a line whose y axis differs from the plot's goes into a new plot beside it (placeLines)
    const mode = addKind, same = sk.mode === (mode === "data" ? null : mode);
    const groups = mode === "rate" ? (same && s.ykind ? datatypes(d.run, s.xaxis, s.ykind) : timeDatatypes(d.run, s.xaxis))
      : datatypes(d.run, s.xaxis, same ? s.ykind : null);
    if (!groups.some(([, it]) => it.some(([n]) => n === d.q))) { d.q = groups[0]?.[1][0]?.[0] ?? null; d.picks = {}; d.pickValues = {}; }
    const src = d.q && srcOf(d.run, d.q), fit = src && fitAxis(src, s.xaxis);
    if (mode === "slope") d.slope ||= { sign: 1, w: 0.5 };
    if (mode === "rate") d.ddt ||= { sign: 1, n: 2, how: "fit" };
    const newKind = src ? lineKind({ slope: mode === "slope" ? d.slope : null, ddt: mode === "rate" ? d.ddt : null }, src) : null;
    box.replaceChildren(
      el("div", { class: "pop-title", title: "only quantities with this plot's x axis" + (s.ykind ? " and y axis" : "") + " are listed · values can be variable names (e.g. rmax)" }, `add a line  (x: ${s.xaxis}${s.ykind ? `, y: ${s.ykind}` : ""})`),
      kindSw(),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "dataset"), runSelect(d.run, v => { d.run = v; draw(); }, { lists: true, q: d.q })),
      groups.length ? el("div", { class: "pop-row" }, el("span", { class: "lab" }, mode === "data" ? "quantity" : `${mode} of`), groupedSelect(groups, d.q, v => { d.q = v; d.picks = {}; d.pickValues = {}; draw(); }))
                    : el("div", { class: "warn" }, `${runLabel(d.run)} has nothing with x = ${s.xaxis}${s.ykind ? ` and y = ${s.ykind}` : ""}`),
      mode === "rate" ? ddtRow(d.ddt, v => { d.ddt = v; draw(); }) : null,                                   // v8.14
      mode === "slope" ? slopeRow(d.slope, v => { d.slope = v; draw(); }) : null,                            // v8.29
      ...(fit ? dimRows(src, fit.dim, d, redraw => redraw && draw(), true) : []),
      s.ykind && newKind && newKind !== s.ykind ? el("div", { class: "dim" }, `y axis "${newKind}": it goes into a new plot next to this one (this plot's y axis is "${s.ykind}")`) : null,
      el("div", { class: "pop-row" },
        el("button", { class: "on", disabled: !fit, onclick: () => {
          const made = [], listDim = Object.keys(d.pickValues || {}).find(k => tokens(d.pickValues[k]).length > 1);
          const make = picks => newLine(d.run, d.q, { picks, pickAs: { ...d.pickAs }, timeMode: d.timeMode, fixedTime: d.fixedTime ?? null, timeFrom: d.timeFrom ?? null, timeTo: d.timeTo ?? null,
            ...(mode === "rate" ? { ddt: { ...d.ddt } } : {}), ...(mode === "slope" ? { slope: { ...d.slope } } : {}) });
          if (listDim) {
            const own = coordChoices(src, listDim)[0][2], pc = pickCoord(src, listDim, d.pickAs[listDim]), vals = pc[2];
            const names = pc[0] === coordChoices(src, listDim)[0][0] ? src.run.coord(listDim)?.names || null : null;   // v8.25: "north, south"
            for (const tok of tokens(d.pickValues[listDim])) { const v = pickOf(tok, vals, own, names); if (v !== undefined) made.push(make({ ...d.picks, [listDim]: v })); }
          } else made.push(make({ ...d.picks }));
          if (made.length) placeLines(panel, c, s, made, api);
        } }, "add"),
        el("button", { onclick: closePopover }, "cancel"),
        el("button", { title: "a curve y = f(x) you type, e.g. a*x^2 + b", onclick: e => {
          const l = { id: newId(), fn: "x", run: d.run, label: null, color: null, dash: "dashed", width: 1.6, visible: true };
          const lines = add(l);
          openEditLine(panel, l.id, e.clientX, e.clientY, api, R.SERIES_COLORS[(lines.length - 1) % 10], "y = x");
        } }, "+ y = f(x)")));
    keepOnScreen(box);
  };
  draw();
}

/** Legend click: edit one line (dataset, datatype, dim values, colour, style, label), live. */
export function openEditLine(panel, lineId, clientX, clientY, api, defaultColor, autoLabel) {
  const c = ctxPanel(panel), s = eff(panel);
  const lines = c.get("lines") || [], line = lines.find(l => l.id === lineId);
  if (!line) return;
  const push = (rebuild = false) => { c.set("lines", lines); api.changed(panel, rebuild); };
  const box = popover(clientX, clientY, []);
  if (isAn(line)) return editAnalytic(panel, line, lines, push, box, api, defaultColor);          // v7
  if (isFn(line)) return editFunction(panel, line, lines, push, box, api, defaultColor);
  const made = madeKind(line);                                     // v14.4: foot gap, table, period, lineout (linekinds.js)
  if (made) return made.editor(panel, line, lines, push, box, api, defaultColor);
  const draw = () => {
    // v8.30: a slope / rate line lists the quantities of its own kind of y axis
    const lmode = line.slope?.sign ? "slope" : line.ddt?.sign ? "rate" : null, own = splitKind(s.ykind).mode === lmode;
    const groups = own ? datatypes(line.run, s.xaxis, s.ykind) : lmode === "rate" ? timeDatatypes(line.run, s.xaxis) : datatypes(line.run, s.xaxis, lmode ? null : s.ykind);
    const src = srcOf(line.run, line.q), fit = src && fitAxis(src, s.xaxis);
    // v8.18: a line drawn several times (a list) has no one automatic name: empty = each curve named by its list value
    const multi = !!expansions(line, s.xaxis)[0], auto = multi ? "" : autoLabel;
    const lab = el("input", { type: "text", size: 30, value: line.label ?? auto,
      placeholder: multi ? "automatic: each curve by its list value · {v} = that value" : "" });
    lab.addEventListener("input", () => { line.label = lab.value === auto || lab.value === "" ? null : lab.value; push(); });
    lab.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === "Escape") closePopover(); });
    box.replaceChildren(
      el("div", { class: "pop-title" }, "line"),
      drawnFor(line, s),                                                                            // v8.18
      lab,
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "dataset"), runSelect(line.run, v => { line.run = v; push(true); draw(); }, { lists: true, q: line.q })),
      isRunList(line.run) ? el("div", { class: "pop-row vcolors" }, el("span", { class: "lab", title: `the list ${line.run.slice(1)} (sidebar): every plot that uses it changes` }, ""),
        runListChips(varOf(line.run), () => { varsChanged(true); draw(); })) : null,
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "quantity"), groupedSelect(groups.length ? groups : [["", [[line.q, line.q]]]], line.q, v => { line.q = v; line.picks = {}; push(); draw(); })),
      lmode === "rate" ? ddtRow(line.ddt, v => { line.ddt = v; push(); draw(); }) : null,                 // v8.14
      lmode === "slope" ? slopeRow(line.slope, v => { line.slope = v; push(); draw(); }) : null,          // v8.29
      ...(fit ? dimRows(src, fit.dim, line, redraw => { push(); if (redraw) draw(); }, false) : [el("div", { class: "warn" }, src ? `${line.q} has no ${s.xaxis} axis in ${runLabel(line.run)}`
        : `${line.q} is not cached for ${runLabel(line.run)}: compute it in the data manager (🗂 data), then ⟳ refresh data`)]),
      ...(() => {                                       // v5.4: a list line's colours come from its list variable
        const sub = expansions(line, s.xaxis)[0];
        if (!sub) return [colorPicker(line.color || defaultColor, col => { line.color = col; push(); }, api.usedColors())];
        const name = String(sub.ref).slice(1), follow = line.listColors !== false;
        return [el("label", { class: "chk", title: "on: each value has the colour set for it in the sidebar (the same in every line); off: shades of this line's own colour" },
            el("input", { type: "checkbox", checked: follow, onchange: e => { line.listColors = e.target.checked ? undefined : false; push(); draw(); } }),
            `colours from the list "${name}" (one per value, set in the sidebar)`),
          follow ? null : colorPicker(line.color || defaultColor, col => { line.color = col; push(); }, api.usedColors())];
      })(),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "scale"),
        scaleControls(line.scale, v => { if (v === undefined) delete line.scale; else line.scale = v; push(); draw(); }, line.run, s.xaxis, true)),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "smooth"),                       // v10.1 (was "average ±N")
        smoothControls(normSmooth(line.smooth !== undefined ? line.smooth : line.avg, s.xaxis === "time"), (v, rebuild) => {
          if (s.xaxis === "time") delete line.avg;          // (on a profile, an old avg is its time average: the time row's)
          if (v === undefined) delete line.smooth; else line.smooth = v;
          push(); if (rebuild) draw();
        }, { inherit: true, xu: axisInfo(s.xaxis).units || "", dflt: s.xaxis === "time" ? 2 : 0.25 })),
      el("div", { class: "pop-row" }, "style",
        el("select", { onchange: e => { line.dash = e.target.value; push(); } }, Object.keys(DASHES).map(k => el("option", { value: k, selected: k === (line.dash || "solid") }, k))),
        "width", numRef(line.width ?? 1.6, w => { if (isRef(w) || w > 0) { line.width = w; push(); } }, { size: 3, title: "line width (a number or a variable)" }),
        el("label", { class: "chk" }, el("input", { type: "checkbox", checked: line.visible !== false, onchange: e => { line.visible = e.target.checked; push(); } }), "shown")),
      el("div", { class: "pop-row pop-sep" },
        el("button", { onclick: () => { lines.push({ ...JSON.parse(JSON.stringify(line)), id: S.nextId++, color: null, label: null }); closePopover(); push(true); } }, "duplicate"),
        el("button", { onclick: () => { lines.splice(lines.indexOf(line), 1); closePopover(); push(true); } }, "remove line"),
        el("button", { onclick: () => { line.label = null; line.color = null; line.dash = "solid"; line.width = 1.6; push(); draw(); } }, "↺ automatic style"),
        el("button", { title: "make a variable from this line (max, min, x at max, value now …) that tools and picks can follow", onclick: () => { closePopover(); newMeasuredVar({ panel: panel.id, line: line.id }); } }, "measure → variable"),
        el("button", { onclick: closePopover }, "done")),
      // v8.30: a plain line's slope / rate is a new line of its own (y axis "slope of …" / "rate of …"): in a new plot
      // next to this one unless this plot already is one
      !lmode && src ? el("div", { class: "pop-row" }, el("span", { class: "lab" }, "new line"),
        s.xaxis !== "time" ? el("button", { title: "a new line: this line's slope along x (y axis \"slope of …\"; next to this plot)", onclick: () => placeLines(panel, c, s, [derivedCopy(line, "slope")], api) }, "→ its slope") : null,
        src.hasTime ? el("button", { title: "a new line: this line's time derivative d/dt (y axis \"rate of …\"; next to this plot)", onclick: () => placeLines(panel, c, s, [derivedCopy(line, "rate")], api) }, "→ its d/dt") : null) : null,
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "legend text"), fontSize(c, "legend", () => api.changed(panel, false))),   // v8.9.6
      el("div", { class: "pop-hint" }, `automatic label: ${autoLabel} · your label is used as typed: {v} = this curve's list value, {name} = a variable's value · changes apply immediately`));
    keepOnScreen(box);
  };
  draw();
}

/** v14.0: the editor of a table line — its table, y column, what colours its points, markers, style. */
export function editTab(panel, line, lines, push, box, api, defaultColor) {
  const t = line.tab;
  const draw = () => {
    const tb = tableOf(t.table), cols = tb ? numericCols(tb) : [];
    box.replaceChildren(
      el("div", { class: "pop-title" }, "table points"),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "table"),
        select([...(tb ? [] : [[t.table, `${t.table} (not found)`]]), ...Object.keys(tables()).map(n => [n, n])], t.table, v => { t.table = v; push(true); draw(); })),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "y"), select(cols.length ? cols : [[t.y, t.y]], t.y, v => { t.y = v; push(true); draw(); })),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "colour by"),
        select([["dataset", "dataset"], ["", "nothing (one colour)"], ...cols], t.by ?? "dataset", v => { t.by = v; push(true); draw(); }, { title: "one colour per value of this column (each dataset …)" })),
      el("div", { class: "pop-row" }, "point size", numRef(line.size ?? 4, w => { if (isRef(w) || w > 0) { line.size = w; push(); } }, { size: 3, title: "radius in px" }),
        el("label", { class: "chk" }, el("input", { type: "checkbox", checked: !!line.joined, onchange: e => { line.joined = e.target.checked; push(); draw(); } }), "joined"),
        el("label", { class: "chk" }, el("input", { type: "checkbox", checked: line.visible !== false, onchange: e => { line.visible = e.target.checked; push(); } }), "shown")),
      line.joined ? el("div", { class: "pop-row" }, "style",
        el("select", { onchange: e => { line.dash = e.target.value; push(); } }, Object.keys(DASHES).map(k => el("option", { value: k, selected: k === (line.dash || "solid") }, k))),
        "width", numRef(line.width ?? 1.2, w => { if (isRef(w) || w > 0) { line.width = w; push(); } }, { size: 3 })) : null,
      colorPicker(line.color || defaultColor, col => { line.color = col; push(); }, api.usedColors()),
      el("div", { class: "dim" }, "One point per row of the table with a number in both columns; x is the plot's x column (⚙ → x). Hover a point: its whole row. A set colour is shaded per group."),
      el("div", { class: "pop-row pop-sep" },
        el("button", { onclick: () => { lines.splice(lines.indexOf(line), 1); closePopover(); push(true); } }, "remove line"),
        el("button", { onclick: closePopover }, "done")));
    keepOnScreen(box);
  };
  draw();
}
/** v14.2: the editor of a lineout line — style; its positions are on the map (click / shift-click, or the tool's card). */
export function editLo(panel, line, lines, push, box, api, defaultColor) {
  box.replaceChildren(
    el("div", { class: "pop-title" }, loLineText(line)),
    el("div", { class: "pop-row" }, "style",
      el("select", { onchange: e => { line.dash = e.target.value; push(); } }, Object.keys(DASHES).map(k => el("option", { value: k, selected: k === (line.dash || "solid") }, k))),
      "width", numRef(line.width ?? 1.6, w => { if (isRef(w) || w > 0) { line.width = w; push(); } }, { size: 3 }),
      el("label", { class: "chk" }, el("input", { type: "checkbox", checked: line.visible !== false, onchange: e => { line.visible = e.target.checked; push(); } }), "shown")),
    el("div", { class: "dim" }, "One curve per lineout on the map, in the colour of its dashed line there. Move one: click the map; add one: shift-click on the map; or type the positions in the map's lineout tool."),
    el("div", { class: "pop-row pop-sep" },
      el("button", { onclick: () => { lines.splice(lines.indexOf(line), 1); closePopover(); push(true); } }, "remove line"),
      el("button", { onclick: closePopover }, "done")));
  keepOnScreen(box);
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
/** Editor of a function line y = f(x) (v5.13, human 2026-10-06: "plotting analytic functions … a quadratic to see how it
 *  fits data"). The formula takes x, t (the slider's time), number variables (a list draws one curve per value; a
 *  measured variable its value now) and, if a dataset is chosen, the numbers of its config. Live as you type. */
function editFunction(panel, line, lines, push, box, api, defaultColor) {
  const draw = () => {
    const run = runOf(line.run), conf = (run && store.runs[run]?.conf) || {};
    const confNums = Object.entries(conf).filter(([, v]) => typeof v === "number").map(([k]) => k);
    const vars = Object.values(S.vars).filter(v => ["number", "measured", "config", "fit"].includes(v.type)).map(v => v.name);
    const f = el("input", { type: "text", size: 34, value: line.fn, class: "numref", title: "e.g. a*x^2 + b*x + c, 2*pi*x, sqrt(x), exp(-x/tau), x^1.5" });
    const err = el("div", { class: "warn" });
    const check = () => { try { compileFunction(f.value, conf, n => vars.includes(n)); err.textContent = ""; return true; } catch (e) { err.textContent = e.message; return false; } };
    f.addEventListener("input", () => { if (check()) { line.fn = f.value; push(); } });
    f.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === "Escape") closePopover(); });
    const lab = el("input", { type: "text", size: 30, value: line.label ?? "", placeholder: `y = ${line.fn}` });
    lab.addEventListener("input", () => { line.label = lab.value === "" ? null : lab.value; push(); });
    const sub = expansions(line)[0];
    box.replaceChildren(
      el("div", { class: "pop-title" }, "function line"),
      el("div", { class: "pop-row" }, "y =", f), err,
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "label"), lab),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "config of"),
        select([["", "(none)"], ...runNames().map(r => [r, r]), ...Object.values(S.vars).filter(v => v.type === "dataset" && !isRunList(v)).map(v => ["$" + v.name, `${v.name} · ${v.value}`])],
          line.run ?? "", v => { line.run = v || null; push(); draw(); }, { title: "a dataset whose config numbers (e.g. the drive's) the formula may use by name" })),
      sub ? el("label", { class: "chk", title: "on: each value has the colour set for it in the sidebar; off: shades of this line's own colour" },
          el("input", { type: "checkbox", checked: line.listColors !== false, onchange: e => { line.listColors = e.target.checked ? undefined : false; push(); draw(); } }),
          `colours from the list "${sub.fnvar}" (one curve per value)`) : null,
      !sub || line.listColors === false ? colorPicker(line.color || defaultColor, col => { line.color = col; push(); }, api.usedColors()) : null,
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "scale"),
        scaleControls(line.scale, v => { if (v === undefined) delete line.scale; else line.scale = v; push(); draw(); }, line.run || runNames()[0], eff(panel).xaxis, true)),
      el("div", { class: "pop-row" }, "style",
        el("select", { onchange: e => { line.dash = e.target.value; push(); } }, Object.keys(DASHES).map(k => el("option", { value: k, selected: k === (line.dash || "solid") }, k))),
        "width", numRef(line.width ?? 1.6, w => { if (isRef(w) || w > 0) { line.width = w; push(); } }, { size: 3 }),
        el("label", { class: "chk" }, el("input", { type: "checkbox", checked: line.visible !== false, onchange: e => { line.visible = e.target.checked; push(); } }), "shown")),
      el("div", { class: "pop-row pop-sep" },
        el("button", { onclick: () => { lines.push({ ...JSON.parse(JSON.stringify(line)), id: S.nextId++, color: null, label: null }); closePopover(); push(true); } }, "duplicate"),
        el("button", { onclick: () => { lines.splice(lines.indexOf(line), 1); closePopover(); push(true); } }, "remove line"),
        el("button", { onclick: closePopover }, "done")),
      el("div", { class: "pop-hint" }, "Names: x, t (the slider's time), pi, e" + (vars.length ? `, variables: ${vars.join(", ")}` : "") +
        (confNums.length ? `, config: ${confNums.slice(0, 12).join(", ")}${confNums.length > 12 ? " …" : ""}` : "") +
        ". Functions: sqrt abs exp log ln log10 sin cos tan asin acos atan atan2 sign min max pow. Powers: x^2. A list variable draws one curve per value."));
    check();
    keepOnScreen(box);
  };
  draw();
}

/** Every datatype of a dataset (any dims), grouped by section: what an analytic line's {parameter} can read. */
function allDatatypes(run) {
  return menuSections(Object.values(store.runs[runOf(run)]?.sources || {}).filter(s => !s.isAn)   // (v11.7: by folder)
    .map(s => ({ name: s.name, label: s.label, section: s.section, dims: s.dims })));
}
/** Editor of an analytic line (v7, human 2026-10-13: "when I then pull it into the function plotter gives me those
 *  things as options to put in numbers or variables … so long as when I apply it onto a panel it gives me the
 *  appropriate options"). Which function, the dataset its datatypes / config numbers come from, and what fills each
 *  {parameter}: the x axis, a number or variable (var ▾; a list draws one curve per value), a datatype, a config
 *  number or the slider's time. "automatic" rows follow the parameter's name (anDefault). Live. */
/** The rows that set what fills each {parameter} of analytic line `line` (the line editor and "+ line" → analytic):
 *  the x axis, a number or variable (a list draws one curve per value), a quantity, a config number or the slider's time;
 *  v8.8: a quantity / config number from its own dataset (default: the line's). push() applies, redraw() redraws. */
export function analyticParamRows(line, s, push, redraw) {
  const def = anDef(line), b = anBindings(line, s.xaxis);
  const setB = (p, nb) => { line.bind = { ...(line.bind || {}), [p]: nb }; push(); redraw(); };
  const resetB = p => { const nb = { ...(line.bind || {}) }; delete nb[p]; line.bind = nb; push(); redraw(); };
  const scalar = p => ["value", "conf", "time"].includes(b[p]?.mode);
  const runB = x => (x.run !== undefined && x.run !== null ? x.run : line.run);
  // where a quantity is read: along the x axis or one number; its other dims from parameters named like them
  const dataNote = (q, brun) => {
    const src = srcOf(brun, q);
    if (!src) return el("span", { class: "warn" }, `not cached for ${runOf(brun) ?? "this dataset"}`);
    const fit = fitAxis(src, s.xaxis), parts = [fit ? `along ${axisLabel(s.xaxis)}` : "one number"];
    for (const d of src.spaceDims) {
      if (fit && d === fit.dim) continue;
      const ch = coordChoices(src, d), pp = def.params.find(x => scalar(x) && ch.some(c => c[0] === x));
      parts.push(pp ? `${ch.find(c => c[0] === pp)[0]} = {${pp}}` : `${ch[0][1].replace(/ \[.*\]$/, "")}: its middle value`);
    }
    if (src.hasTime && !(fit && fit.dim === "time")) parts.push(["t", "time"].some(x => b[x]?.mode === "value") ? "at t = {t}" : "at the slider's time");
    return el("span", { class: "dim", title: parts.join(", ") }, "ⓘ");
  };
  const prow = p => {
    const x = b[p], own = !!line.bind?.[p], brun = runB(x), R0 = store.runs[runOf(brun)];
    const confNums = Object.entries(R0?.conf || {}).filter(([, v]) => typeof v === "number").map(([k]) => k);
    const allQ = allDatatypes(brun), firstQ = allQ[0]?.[1][0]?.[0] ?? null;
    const modeSel = select([["x", `x axis (${axisLabel(s.xaxis)})`], ["value", "number / variable"], ["data", "quantity"], ["conf", "config number"], ["time", "slider's time"]], x.mode,
      v => setB(p, v === "data" ? { mode: v, q: x.q ?? (R0?.sources[p] ? p : firstQ), run: x.run } : v === "conf" ? { mode: v, key: x.key ?? (confNums.includes(p) ? p : confNums[0] ?? p), run: x.run }
        : v === "value" ? { mode: v, value: x.value ?? null } : { mode: v }), { title: "what fills it" });
    // v8.10: a fit variable (one value per dataset) gets the same dataset menu
    const fitVar = x.mode === "value" && varOf(x.value)?.type === "fit";
    const dsSel = x.mode === "data" || x.mode === "conf" || fitVar
      ? runSelect(brun, v => setB(p, { ...x, run: v === line.run ? undefined : v }), { title: fitVar ? "the dataset whose value of the fit variable it takes" : "the dataset it comes from", class: "an-ds" }) : null;
    const ctl = x.mode === "value" ? numRef(x.value ?? null, v => setB(p, { mode: "value", value: v }), { size: 8, placeholder: "number / variable", title: `{${p}}: a number, or a variable (a list draws one curve per value)` })
      : x.mode === "data" ? [groupedSelect(allQ.length ? allQ : [["", [[x.q, x.q]]]], x.q, v => setB(p, { ...x, mode: "data", q: v })), dataNote(x.q, brun)]
      : x.mode === "conf" ? select(confNums.length ? confNums.map(k => [k, `${k} = ${R.fmt(R0.conf[k])}`]) : [[x.key ?? p, `${x.key ?? p} (not in this dataset's config)`]], x.key ?? p, v => setB(p, { ...x, mode: "conf", key: v }))
      : null;
    // v7.1: an empty value draws nothing — say so here
    const empty = x.mode === "value" && (x.value === null || x.value === undefined || x.value === "");
    return el("div", { class: "pop-row" }, el("span", { class: "lab", title: store.anParams?.[line.an]?.[p] || "" }, `{${p}}`), modeSel, dsSel, ctl,
      empty ? el("span", { class: "warn", title: "nothing is drawn until it has a value" }, `⚠ needs a value${p === "r_max" || p === "rmax" ? " (which field line)" : ""}`) : null,
      own ? el("button", { class: "tog", title: "back to the automatic choice (from the parameter's name)", onclick: () => resetB(p) }, "↺") : el("span", { class: "dim", title: "chosen from the parameter's name" }, "auto"));
  };
  return def.params.map(prow);
}
function editAnalytic(panel, line, lines, push, box, api, defaultColor) {
  const draw = () => {
    const s = eff(panel), def = anDef(line), b = anBindings(line, s.xaxis);
    const lab = el("input", { type: "text", size: 30, value: line.label ?? "", placeholder: def.label });
    lab.addEventListener("input", () => { line.label = lab.value === "" ? null : lab.value; push(); });
    lab.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === "Escape") closePopover(); });
    const defs = Object.values(store.analytics || {}), sub = expansions(line, s.xaxis)[0];
    box.replaceChildren(
      el("div", { class: "pop-title" }, "analytic function"),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "function"),
        select([...defs.map(a => [a.name, `${a.label} (${a.name})`]), ...(def.missing || !defs.length ? [[line.an, `${line.an} (kept in this line)`]] : [])], line.an, v => {
          const a = store.analytics[v]; if (!a) return;
          Object.assign(line, { an: v, fn: a.formula, anLabel: a.label, anKind: a.kind }); push(true); draw();
        })),
      el("div", { class: "pop-row an-formula" }, `${def.name} = ${def.formula}`),
      (() => {                                            // v7.1: why nothing is drawn, at the top
        const need = def.params.filter(p => b[p].mode === "value" && (b[p].value === null || b[p].value === undefined || b[p].value === ""));
        return need.length ? el("div", { class: "warn" }, `Nothing is drawn yet: give ${need.map(p => `{${p}}`).join(", ")} a value (a number, or a variable from var ▾; a list draws one curve per value).`) : null;
      })(),
      def.missing ? el("div", { class: "warn" }, `"${line.an}" is not in this desktop's analytic functions: the line uses the formula it kept`) : null,
      def.error ? el("div", { class: "warn" }, def.error) : null,
      ...analyticParamRows(line, s, push, draw),                     // each quantity / config parameter names its dataset
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "label"), lab),
      sub ? el("label", { class: "chk", title: "on: each value has the colour set for it in the sidebar; off: shades of this line's own colour" },
          el("input", { type: "checkbox", checked: line.listColors !== false, onchange: e => { line.listColors = e.target.checked ? undefined : false; push(); draw(); } }),
          `colours from the list "${String(sub.ref).slice(1)}" (one curve per value)`) : null,
      !sub || line.listColors === false ? colorPicker(line.color || defaultColor, col => { line.color = col; push(); }, api.usedColors()) : null,
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "scale"),
        scaleControls(line.scale, v => { if (v === undefined) delete line.scale; else line.scale = v; push(); draw(); }, line.run || runNames()[0], s.xaxis, true)),
      el("div", { class: "pop-row" }, "style",
        el("select", { onchange: e => { line.dash = e.target.value; push(); } }, Object.keys(DASHES).map(k => el("option", { value: k, selected: k === (line.dash || "solid") }, k))),
        "width", numRef(line.width ?? 1.6, w => { if (isRef(w) || w > 0) { line.width = w; push(); } }, { size: 3 }),
        el("label", { class: "chk" }, el("input", { type: "checkbox", checked: line.visible !== false, onchange: e => { line.visible = e.target.checked; push(); } }), "shown")),
      el("div", { class: "pop-row pop-sep" },
        el("button", { onclick: () => { lines.push({ ...JSON.parse(JSON.stringify(line)), id: S.nextId++, color: null, label: null }); closePopover(); push(true); } }, "duplicate"),
        el("button", { onclick: () => { lines.splice(lines.indexOf(line), 1); closePopover(); push(true); } }, "remove line"),
        el("button", { title: "make a variable from this line (max, min, x at max, value now …)", onclick: () => { closePopover(); newMeasuredVar({ panel: panel.id, line: line.id }); } }, "measure → variable"),
        el("button", { onclick: closePopover }, "done")),
      el("div", { class: "pop-hint" }, "Each {parameter}: the x axis, a number or variable (a list draws one curve per value; several lists: every combination, colours by the first), " +
        "a quantity of the dataset (read along the x axis at the slider's time; its other dims, e.g. r_max, from the parameter of that name), a config number, or the slider's time. " +
        "Edit the formula in the header's “analytic functions” box; every line using it follows."));
    keepOnScreen(box);
  };
  draw();
}

// ---- datasets of a 1D panel (v5) -------------------------------------------------------------------------------
const colorOf = (l, lines) => l.color || R.SERIES_COLORS[Math.max(0, lines.indexOf(l)) % 10];
/** Lines that belong to a dataset: recorded lines and analytic lines (v7), not plain y = f(x) lines. */
// v8.9 (human 2026-10-15: "once I can pick each variable I don't need it to be correlated with a dataset"): analytic
// lines are not under a dataset (each quantity / config parameter names its own); only recorded lines are
const hasRun = l => !isFn(l);
/** Header chips: one per dataset of the panel's lines (click: swap it / remove its lines), "+ line", "+ dataset". */
export function datasetChips(panel, api) {
  const lines = (eff(panel).lines || []).filter(hasRun), vals = [...new Set(lines.map(l => l.run))];
  const chips = vals.map(rv => {
    const first = lines.find(l => l.run === rv), list = isRunList(rv);
    const dots = list ? runsOf(rv).map((r, k) => el("span", { class: "dot", style: `background:${listColor(varOf(rv), k)}` }))
      : [el("span", { class: "dot", style: `background:${colorOf(first, lines)}` })];
    // v8.19: the hover says what each dataset is
    return el("button", { class: "dchip" + (isRef(rv) ? " bound" : ""), title: list ? `${runRefTip(rv)}\n\nclick to change the list or swap it`
      : `${runRefTip(rv)}\n\nclick to swap these lines' dataset, remove them, or compare it with another`, onclick: e => openDatasetChip(panel, rv, e.clientX, e.clientY, api) }, ...dots, runLabel(rv));
  });
  return [...chips,
    el("button", { class: "addline", title: "add a line: pick a dataset and a quantity that fits this plot's axes", onclick: e => openAddLine(panel, e.clientX, e.clientY, api) }, "+ line"),
    vals.length ? el("button", { class: "addline", title: "draw this plot's lines for more datasets (a dataset list: one curve per dataset)", onclick: e => openAddDataset(panel, e.clientX, e.clientY, api) }, "+ dataset") : null];
}
function openDatasetChip(panel, rv, x, y, api) {
  const c = ctxPanel(panel), lines = c.get("lines") || [], mine = lines.filter(l => l.run === rv && hasRun(l));
  const box = popover(x, y, []);
  const draw = () => {
    const list = isRunList(rv), v = varOf(rv);
    box.replaceChildren(
      el("div", { class: "pop-title" }, `${mine.length} line${mine.length > 1 ? "s" : ""} of ${runLabel(rv)}`),
      list ? el("div", { class: "drawn" }, `drawn once per dataset of the list ${v.name}: ${mine.map(bareName).join(", ")}`)
        : el("div", { class: "about", title: runTip(runOf(rv)) }, aboutLine(runOf(rv))),                       // v8.19
      list ? el("div", { class: "pop-row vcolors" }, runListChips(v, () => { varsChanged(true); draw(); })) : null,
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, list ? "or follow" : "dataset"),
        runSelect(rv, nv => { for (const l of mine) l.run = nv; c.set("lines", lines); closePopover(); api.changed(panel, true); }, { lists: true })),
      isRef(rv) ? el("div", { class: "pop-hint" }, `These lines follow variable ${rv.slice(1)}: ${list ? "changing the list above (or" : "change it"} in the sidebar${list ? ")" : ""} changes every plot that uses it (${usesOf(rv.slice(1)).panels.length}). Picking a dataset or variable here changes only these lines.`) : null,
      ...(list ? [] : compareBox(runOf(rv), { resized: () => keepOnScreen(box) })),                              // v8.19
      el("div", { class: "pop-row pop-sep" },
        el("button", { onclick: () => { c.set("lines", lines.filter(l => l.run !== rv || !hasRun(l))); closePopover(); api.changed(panel, true); } }, "remove these lines"),
        el("button", { onclick: closePopover }, "done")));
    keepOnScreen(box);
  };
  draw();
}
/** "+ dataset" (v8.18, human 2026-11-02: one line "for a list of datasets"): tick the datasets the lines should be drawn
 *  for. As a list (default): the lines follow a dataset list (sidebar) and draw one curve per dataset, each dataset in its
 *  own colour — the list they already follow (every plot that uses it changes), else a new one. As copies (the old way):
 *  separate lines per new dataset, e.g. to style one dataset differently. Lines that differ only in their dataset (copies
 *  made before) can first be merged into lines that follow a list. */
function openAddDataset(panel, x, y, api) {
  const c = ctxPanel(panel), lines = c.get("lines") || [], vals = [...new Set(lines.filter(hasRun).map(l => l.run))];
  const d = { from: vals.find(isRunList) ?? vals[0], picked: null, mode: "list", style: null };
  const box = popover(x, y, []);
  const addFor = (src, to, style) => {                   // a copy of the lines for dataset `to`
    const usedCols = new Set(lines.map(l => colorOf(l, lines))), col = R.SERIES_COLORS.find(k => !usedCols.has(k)) || R.SERIES_COLORS[lines.length % 10];
    const order = Object.keys(DASHES), had = [...new Set(src.map(l => l.dash || "solid"))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const free = order.filter(k => !had.includes(k)), next = k => free[had.indexOf(k) % Math.max(1, free.length)] || "dashed";
    for (const l of src) {
      const n = { ...JSON.parse(JSON.stringify(l)), id: newId(), run: to, label: null };
      if (style === "colour") n.color = col; else { n.color = colorOf(l, lines); n.dash = next(l.dash || "solid"); }
      lines.push(n);
    }
  };
  const apply = src => {
    const cur = runsOf(d.from), lv = isRunList(d.from) ? varOf(d.from) : null;
    const order = [...cur.filter(r => d.picked.has(r)), ...runNames().filter(r => d.picked.has(r) && !cur.includes(r))];
    if (!order.length) return;
    if (d.mode === "copy") {
      const auto = new Set(src.map(l => colorOf(l, lines))).size <= 1 ? "colour" : "dash";
      for (const r of order) if (!cur.includes(r)) addFor(src, r, d.style || auto);
    } else if (lv) {
      // v11.2: the list's own entries stay (a variable entry stays while its dataset is ticked); new ticks are added
      const stored = Array.isArray(lv.value) ? lv.value : [lv.value];
      const kept = stored.filter(e => (isRef(e) ? runsOf(e).some(r => d.picked.has(r)) : d.picked.has(e)));
      const covered = new Set(kept.flatMap(e => (isRef(e) ? runsOf(e) : [e])));
      setRuns(lv, [...kept, ...order.filter(r => !covered.has(r))]);
    }
    else if (order.length > 1 || order[0] !== cur[0]) {
      const n = newVarName("runs"), v = S.vars[n] = { name: n, type: "dataset", value: [runOf(d.from)] , colors: [colorOf(src[0], lines)] };
      setRuns(v, order);
      for (const l of src) { l.run = "$" + n; delete l.listColors; }
    }
    c.set("lines", lines); closePopover(); api.changed(panel, true); varsChanged(true);
  };
  const draw = () => {
    const src = lines.filter(l => l.run === d.from && hasRun(l)), cur = runsOf(d.from), lv = isRunList(d.from) ? varOf(d.from) : null;
    if (!d.picked) d.picked = new Set(cur);
    const groups = mergeGroups(lines);
    box.replaceChildren(
      el("div", { class: "pop-title" }, "draw these lines for more datasets"),
      groups.length ? el("div", { class: "pop-row merge" },
        el("button", { title: "each group of lines that differ only in their dataset becomes one line that follows a dataset list (sidebar), one curve per dataset",
          onclick: () => { const made = mergeLines(lines, groups); c.set("lines", lines); closePopover(); api.changed(panel, true); varsChanged(true);
            if (made.length) api.toast?.(`new dataset list${made.length > 1 ? "s" : ""} ${made.join(", ")} (sidebar)`); } },
          `merge ${groups.reduce((a, g) => a + g.length, 0)} lines into ${groups.length}`),
        el("span", { class: "dim" }, `${groups.length} quantit${groups.length > 1 ? "ies are" : "y is"} drawn as separate lines per dataset`)) : null,
      vals.length > 1 ? el("div", { class: "pop-row" }, el("span", { class: "lab" }, "lines"),
        select(vals.map(v => [v, `the lines of ${runLabel(v)}`]), d.from, v => { d.from = v; d.picked = null; draw(); })) : null,
      // v8.24: under the data manager's dataset groups (a heading ticks the whole group; archived ones left out)
      el("div", { class: "np-list" }, groupedRunTicks(r => d.picked.has(r), (r, on) => { if (on) d.picked.add(r); else d.picked.delete(r); draw(); }, runNames(), [...d.picked])),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "as"),
        select([["list", lv ? `the list ${lv.name}: one curve per dataset` : "a dataset list (sidebar): one curve per dataset"], ["copy", "separate copies of the lines"]], d.mode, v => { d.mode = v; draw(); },
          { title: "list: the lines stay one line each and follow a list of datasets, each dataset in its own colour · copies: new lines per new dataset, e.g. to style one dataset differently (the old “+ dataset”)" }),
        d.mode === "copy" ? select([["colour", "one new colour"], ["dash", "a new line style"]], d.style || (new Set(src.map(l => colorOf(l, lines))).size <= 1 ? "colour" : "dash"), v => { d.style = v; }) : null),
      lv && d.mode === "list" ? el("div", { class: "pop-hint" }, `${lv.name} is a sidebar variable used by ${usesOf(lv.name).panels.length} plot(s): they all change.`) : null,
      el("div", { class: "pop-row" },
        el("button", { class: "on", onclick: () => apply(src) }, "apply"),
        el("button", { onclick: closePopover }, "cancel")));
    keepOnScreen(box);
  };
  draw();
}
/** Lines that differ only in their dataset (copies from the old "+ dataset"), grouped: [[line, …]], each group with
 *  two or more datasets. Lines that already follow a dataset list are left out. */
function mergeGroups(lines) {
  const key = l => { const { id, run, color, dash, label, width, visible, listColors, ...rest } = l; return JSON.stringify(rest); };
  const g = new Map();
  for (const l of lines) {
    if (!hasRun(l) || isRunList(l.run) || !runOf(l.run)) continue;
    const k = key(l);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(l);
  }
  return [...g.values()].filter(ls => new Set(ls.map(l => runOf(l.run))).size > 1);
}
/** Merge each group into its first line, which then follows a dataset list of the group's datasets (in the order the
 *  plot first shows them; an existing list with exactly those is reused; a new one takes the lines' colours).
 *  Returns the names of new lists. */
function mergeLines(lines, groups) {
  const made = [], seen = [...new Set(lines.filter(hasRun).map(l => runOf(l.run)))];
  for (const grp of groups) {
    const byRun = new Map();
    for (const l of grp) if (!byRun.has(runOf(l.run))) byRun.set(runOf(l.run), l);
    const runs = [...byRun.keys()].sort((a, b) => seen.indexOf(a) - seen.indexOf(b));
    let v = Object.values(S.vars).find(x => isRunList(x) && JSON.stringify(x.value) === JSON.stringify(runs));
    if (!v) {
      const n = newVarName("runs");
      v = S.vars[n] = { name: n, type: "dataset", value: runs, colors: runs.map(r => colorOf(byRun.get(r), lines)) };
      made.push(n);
    }
    const keep = byRun.get(runs[0]), labels = new Set(grp.map(l => l.label ?? null));
    keep.run = "$" + v.name; delete keep.listColors;
    if (labels.size > 1) keep.label = null;                // per-dataset labels: the legend names the datasets now
    for (const l of grp) if (l !== keep) lines.splice(lines.indexOf(l), 1);
  }
  return made;
}

// ---- what a legend entry acts on (v8.18, human 2026-11-02: "clicking the legend is useful but its confusing once you
// get to lists, could it be made to basically show what things are acted on") ------------------------------------
/** A line's lists in words: "drawn 6 times: once per dataset of runs (baseline-18, baseline-19, no-pair-2) × r_max of
 *  rmax (2, 5)"; null for a line drawn once. */
export function drawnFor(line, s) {
  const subs = expansions(line, s.xaxis), x = subs[0];
  if (!x) return null;
  const vals = ref => { const v = varOf(ref), a = v?.type === "dataset" ? runsOf(ref) : listOf(ref).map(R.fmt); return a.length > 6 ? [...a.slice(0, 6), "…"].join(", ") : a.join(", "); };
  const what = (o, ref) => (o.run !== undefined && ref === o.ref ? "dataset" : o.dim !== undefined ? line.pickAs?.[o.dim] || o.dim : o.time !== undefined ? "time" : o.fnvar ? o.fnvar : "value");
  const parts = [`${what(x, x.ref)} of ${String(x.ref).slice(1)} (${vals(x.ref)})`];
  if (x.iref) parts.push(`${what({ ...x, run: undefined }, x.iref)} of ${String(x.iref).slice(1)} (${vals(x.iref)})`);
  return el("div", { class: "drawn", title: "lists live in the sidebar: changing one changes every plot that uses it" },
    `drawn ${subs.length} times: once per ${parts.join(" × ")}`);
}
/** v14.3.2: a line read from a recorded quantity (it has a source and a dataset), not one made by a tool or a table. */
export { isRecordedLine };                                     // v14.4: defined in linekinds.js (the line-source registry)
/** v14.3.2: a line's name for lists (⚙ line list, tool cards): its bare name, plus its dataset when it has one. */
export const lineName = l => (l.label || !(isRecordedLine(l) || isAn(l)) ? bareName(l) : `${bareName(l)} · ${runLabel(l.run)}`);
/** A line's name without its dataset (the list says which): its label, else its quantity (d/dt, ± average). */
export function bareName(l) {
  if (l.label) return l.label;
  if (isAn(l)) return anDef(l).label;
  if (isFn(l)) return `y = ${l.fn}`;
  if (madeKind(l)) return madeKind(l).name(l);                                                     // v14.4: linekinds.js
  const q = srcOf(l.run, l.q)?.label ?? l.q, hv = v => (isRef(v) ? v.slice(1) : v);   // v10.1.1: its own smoothing, time average
  const sm = l.smooth && typeof l.smooth === "object" && "h" in l.smooth && l.smooth.h != null && l.smooth.h !== "" ? `${l.smooth.kind === "median" ? "median" : "mean"} over ±${hv(l.smooth.h)}` : null;
  const ta = l.tavg != null && l.tavg !== "" && (isRef(l.tavg) || Number(l.tavg) > 0) ? `mean over t ± ${hv(l.tavg)}` : null;
  const avg = [sm, ta].filter(Boolean).join(" · ") || null;
  // v8.30: a slope / rate line is named as one ("−d/dx Φ", "−d/dt twist energy")
  const name = l.slope?.sign ? opLabel(Number(l.slope.sign) < 0 ? "−d/dx" : "d/dx", q)
    : l.ddt?.sign ? opLabel(`${l.ddt.sign < 0 ? "−" : ""}d/dt`, q) : q;
  return [name, avg].filter(Boolean).join(" · ");
}
/** A click on a list's colour in the legend: that value — its colour (in every line and plot that follow the list), the
 *  lines of this plot drawn for it (click one to edit it), and removing it from the list (a dataset or number list). */
export function openListValue(panel, val, x, y, api) {
  const box = popover(x, y, []);
  const draw = () => {
    const v = varOf(val.ref), s = eff(panel);
    if (!v) { box.replaceChildren(el("div", { class: "dim" }, "this list was deleted")); return; }
    const all = v.type === "dataset" ? runsOf(val.ref) : listOf(val.ref), n = all.length, k = val.k;
    const mine = (s.lines || []).filter(l => expansions(l, s.xaxis)[0]?.ref === val.ref);
    const colOK = ["dataset", "number", "config"].includes(v.type), canRemove = (v.type === "dataset" || v.type === "number") && n > 1;
    box.replaceChildren(
      el("div", { class: "pop-title" }, val.label),
      el("div", { class: "drawn" }, `${v.type === "dataset" ? "dataset" : "value"} ${k + 1} of ${n} in the list ${v.name} (sidebar) — every plot that uses ${v.name} (${usesOf(v.name).panels.length}) follows it`),
      v.type === "dataset" ? el("div", { class: "about", title: runTip(all[k]) }, aboutLine(all[k])) : null,      // v8.19
      colOK ? el("div", { class: "pop-row" }, el("span", { class: "lab" }, "colour"),
        colorButton(listColor(v, k), col => {
          const e = v.type === "dataset" ? listEntries(v)[k] : null;   // v11.2: the colour of the entry (or list) that gives it
          if (e) { const o = e.owner, m = Array.isArray(o.value) ? o.value.length : 1; o.colors = Array.from({ length: m }, (_, i) => o.colors?.[i] || R.SERIES_COLORS[i % 10]); o.colors[e.oslot] = col; }
          else { v.colors = all.map((_, i) => v.colors?.[i] || R.SERIES_COLORS[i % 10]); v.colors[k] = col; }
          varsChanged(true); draw(); })) : null,
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "lines"), mine.length ? mine.map(l => el("button", { class: "linkish", title: "edit this line",
        onclick: e => openEditLine(panel, l.id, e.clientX, e.clientY, api, l.color || R.SERIES_COLORS[0], bareName(l)) }, bareName(l))) : el("span", { class: "dim" }, "none here")),
      // v8.19: how this dataset differs from the others in the list (they come first in the menu) or any other
      ...(v.type === "dataset" ? compareBox(all[k], { others: [...all.filter((_, i) => i !== k), ...runNames().filter(r => !all.includes(r))], resized: () => keepOnScreen(box) }) : []),
      el("div", { class: "pop-row pop-sep" },
        canRemove ? el("button", { title: `every plot that uses ${v.name} changes`, onclick: () => {
          if (v.type === "dataset") {                         // v11.2: drop the entry that gives it and any other giving only it
            const e = listEntries(v)[k], stored = Array.isArray(v.value) ? v.value : [v.value];
            const only = x => (isRef(x) ? runsOf(x).length === 1 && runsOf(x)[0] === e.run : x === e.run);
            setRuns(v, stored.filter((x, i) => i !== e.slot && !only(x)));
          }
          else { v.colors = all.map((_, i) => v.colors?.[i] || R.SERIES_COLORS[i % 10]).filter((_, i) => i !== k); const r = v.value.filter((_, i) => i !== k); v.value = r.length === 1 ? r[0] : r; }
          closePopover(); varsChanged(true);
        } }, `remove ${val.label} from ${v.name}`) : null,
        el("button", { onclick: closePopover }, "done")));
    keepOnScreen(box);
  };
  draw();
}
