// settings.js — the settings box of a panel. v8.4 (human 2026-10-15): one line per axis, colour on two lines, tools as
// summaries, few words — the help is in hover boxes. In a linked panel each row ends with its sharing tag (v8.3).
import * as R from "./render.js";
import { sectionRank, store, srcOf, fitAxis, axisCatalog, axisLabel, axisInfo, kindsFor, derivedKindsFor, datatypes, dimCoord, isSpherical, newTool, setAxes2D, runOf, runLabel, isRef, numOf, pickIndex, listOf, isFn, setToolShared, isAn,
  S, dropOutput, freeToolName, dataKindOf, missingKindOf, missingKindText, missingToolOf, missingToolText, startPicksOf, newVarName } from "./model.js";
import { axesFor } from "./panel2d.js";
import { el, select, num, text, check, toggle, colorPicker, popover, closePopover, editText, submenu, closeSubmenu } from "./ui.js";
import { openAddLine, openEditLine, groupedSelect, scaleControls, smoothControls, lineName, isRecordedLine } from "./lines.js";
import { expansions, legendSpot, LEGEND_SPOTS, normSmooth } from "./panel1d.js";
import { runSelect, numRef, varBind, newMeasuredVar, fontSize, listPick } from "./vars.js";

import { groupOf, membersOf, menuSections, isDraw, drawKind, setDrawKind, DRAW_KINDS, CONTOUR_LEVELS, DATA_STATS, timeLine, isTimeLine, toolValues, dropToolValues, newId } from "./model.js";
import { cacheables, canCompute, labelOf, MARK } from "./cacheable.js";
import { tableOf, numericCols, parseTabAxis, tabAxis, castForm } from "./tables.js";   // v14.0
import { loGeom, loPositions, newLineoutPlot, retargetLineout, loNextPosition, loColor, loColors, setLoColor } from "./lineout.js";   // v14.2
const LO_PICK = new Map();                                // v14.3: which lineout chip's colour picker is open (per tool)
import { eff, timeUnits } from "./model.js";

const copy = o => JSON.parse(JSON.stringify(o));

/** A settings row. In a figure: 🔗 at its right end says whether `keys` are shared with other plots of the figure
 *  (click: which plots share them). v15.1: exported for a data kind's own rows (mapRows). */
export function row(ctx, keys, label, ...controls) {
  const inG = keys.length > 0 && ctx.inGroup();
  // v5.13 fix (human 2026-10-06: "the setting says own and I change it it changes other linked things"): a row whose
  // settings were partly shared (1D y window: y range shared, y zoom own) said "own" while editing it still changed
  // the linked panels. Now it says "🔗 part" and one click makes the whole row own. Settings never set (neither
  // shared nor own) don't count.
  // v7.2: a setting can also be shared per figure column / row (ctx.scope: "col" | "row"): "🔗 col" / "🔗 row";
  // v8.22: or pan & zoom with the plots of the same axes ("axis")
  const sharedK = k => ctx.linked(k) || !!ctx.scope(k);
  const known = inG ? keys.filter(k => sharedK(k) || ctx.own(k)) : [], shared = known.filter(sharedK);
  const all = shared.length > 0 && shared.length === known.length, linked = shared.length > 0;
  // the row's main setting (its first) says per column / per row (a row can hold keys of two families, e.g. |value|)
  const sc = all && shared.length ? ctx.scope(shared[0]) : null;
  let st = !linked ? "own" : !all ? "part" : sc || "all", note = st === "part" ? ` (${shared.join(", ")} shared)` : "";
  // v8.13.1 (human 2026-10-20: "When I set one plot's linked thing to its own it doesn't change the other plots status
  // … They need to show the all, row, col, own, or mix"): ALL only when every linked plot shares it; when some of the
  // others have their own it is MIX; when all the others have their own, this plot's edits change only this plot: OWN
  if (st === "all" && ctx.panel) {
    const g = groupOf(ctx.panel), others = g ? membersOf(g.id).filter(q => q !== ctx.panel) : [];
    const ownBy = others.filter(q => shared.some(k => (q.link?.own || []).includes(k)));
    if (ownBy.length && ownBy.length === others.length) { st = "own"; note = ""; }
    else if (ownBy.length) st = "mix";
  }
  // v8.22: an axis row whose only shared part is its pan & zoom (with the plots of the same axes) says "axes", not "part"
  let scx = sc;
  if (st === "part" && shared.every(k => ctx.scope(k) === "axis")) { st = scx = "axis"; note = " (its pan & zoom; the rest of the row is this plot's own)"; }
  // v8.22: shared per column / row / axes with nobody to share with is this plot's own in effect
  if (scx && st === scx && ctx.peers && !ctx.peers(shared[0]).length) {
    st = "own"; note = scx === "axis" ? " (no other plot of the figure has the same axes)" : ` (alone in its figure ${scx === "col" ? "column" : "row"})`;
  }
  // who it is shared with, by name (v8.22: the hover of the 🔗 says it)
  if (st !== "own" && st !== "part" && ctx.members) {
    const ids = scx ? (ctx.peers?.(shared[0]) || []).map(q => q.id) : ctx.sharers(shared[0]).filter(id => id !== ctx.panel?.id);
    const names = ctx.members().filter(q => ids.includes(q.id)).map(q => `"${ctx.plotName(q)}"`);
    if (names.length) note = `${st === "axis" && !sc ? " (its pan & zoom)" : ""} with ${names.join(", ")}`;
  }
  const tip = `${SCOPE_TIP[st]}${note}`;
  const tag = inG ? chainTag(ctx, st, `${tip} — click: share it with other plots of the figure, or not`,
    (mode, fam = null) => { keys.filter(k => !fam || ctx.familyOf(k) === fam).forEach(k => { if (sharedK(k) !== (mode === "shared")) ctx.toggleLink(k); }); ctx.done(); }, keys, label) : null;
  return el("div", { class: "row" + (inG ? (linked && st !== "own" ? " linked" : " own") : ""), title: inG ? tip.replace(/^./, c => c.toUpperCase()) : null },
    label ? el("span", { class: "lab" + (label instanceof Node ? " short" : "") }, label) : null, ...controls, tag);
}
const SCOPE_TIP = { all: "shared", col: "shared by the plots in this figure column", row: "shared by the plots in this figure row",
  axis: "shared by the plots of this figure with the same axes", own: "this plot's own", part: "partly shared", mix: "shared with some of the plots" };
/** The 🔗 at a row's right end (v8.22, human 2026-11-04, replacing the ALL / OWN / COL / ROW / PART / MIX words: "a chain
 *  on each setting"; "the colormap autolinking too much"): lit = shared with other plots of the figure, grey = this
 *  plot's own. Its menu: tick the plots that share these settings (this plot's value is the one they share), or — for
 *  settings shared per column / row / axes — this plot follows or not; and for every plot, how the figure shares the
 *  family (the Sharing table's lines). setThis("shared" | "own") changes this plot. */
function chainTag(ctx, st, title, setThis, keys, label, simple = false) {
  const fams = ctx.familyOf ? [...new Set(keys.map(k => ctx.familyOf(k)).filter(Boolean))] : [];
  const what = typeof label === "string" && label ? label : fams.length ? ctx.familyLabel(fams[0]) : "these settings";
  let at = null;
  const body = () => {
    const fig = fams.length && ctx.isFigure && ctx.isFigure(), fsc = fams.length && ctx.familyScope ? ctx.familyScope(fams[0]) : "all";
    // (a sub-menu, v8.21: the pop-up it was opened from — the colour bar's, an axis's — stays open and refreshes)
    const choice = (lab, on, fn, tip) => el("button", { class: "menuitem" + (on ? " on" : ""), title: tip, onclick: () => { closeSubmenu(); fn(); } }, (on ? "● " : "○ ") + lab);
    const mem = ctx.members ? ctx.members() : [];
    let plots = null;
    if (!simple && fsc === "all" && mem.length > 1 && ctx.sharers) {
      const now = ctx.sharers(keys[0]), set = new Set(now.length >= 2 ? now : []);
      plots = [el("div", { class: "dim" }, "share it with (ticked plots show one value: this plot's, when it is ticked)"),
        ...mem.map(q => el("label", { class: "chk menuitem" }, el("input", { type: "checkbox", checked: set.has(q.id) || (q === ctx.panel && !set.size),
          onchange: e => {
            const ids = new Set(set.size ? set : [ctx.panel.id]);
            if (e.target.checked) ids.add(q.id); else ids.delete(q.id);
            ctx.shareWith(keys, [...ids]); ctx.done(); setTimeout(() => submenu(at.x, at.y, body()));
          } }), " ", ctx.plotName(q) + (q === ctx.panel ? "  (this plot)" : "")))];
    } else if (fsc !== "all" || simple) {
      const how = fsc === "all" ? "the figure" : fsc === "axis" ? "the plots with the same axes" : fsc === "col" ? "its figure column" : "its figure row";
      plots = [el("div", { class: "dim" }, "this plot"),
        choice(`follows ${how}`, st !== "own" && st !== "part", () => setThis("shared"), "edits change the plots it follows"),
        choice("its own", st === "own" || st === "part", () => setThis("own"), "edits change only this plot")];
    }
    // v14.3.3 (human 2026-11-13: two linked plots' "y axes are locked together and I cant separate them even with the
    // choosing link as their own"): a row that mixes families (the y row: y settings + its pan & zoom) showed only the
    // first family's choice; pan & zoom shared with the plots of the same axes now has its own follows / own pair here
    const axFam = !simple && fig && fsc !== "axis" ? fams.find(f => ctx.familyScope(f) === "axis") : null;
    if (axFam) {
      const follows = keys.some(k => ctx.familyOf(k) === axFam && !!ctx.scope(k));
      plots = [...(plots || []), el("div", { class: "dim" }, `this plot · ${ctx.familyLabel(axFam)}`),
        choice("follows the plots with the same axes", follows, () => setThis("shared", axFam), "zooming or panning one zooms the others with the same axes"),
        choice("its own", !follows, () => setThis("own", axFam), "zoom and range of this plot only (no common y range, its own y numbers)")];
    }
    return [el("div", { class: "pop-title" }, `sharing · ${what}`),
      el("div", { class: "menu" }, plots,
        fig ? fams.map(f => {
          const fm = ctx.familyMode(f);
          const modes = [["all", "all share it"], ...(f === "view" ? [["axis", "plots with the same axes"]] : []), ["col", "per column"], ["row", "per row"], ["own", "each its own"]];
          return [el("hr"), el("div", { class: "dim" }, `every plot · ${ctx.familyLabel(f)}`),
            ...modes.map(([m, lab]) => choice(lab, fm === m, () => ctx.figureScope(f, m)))];
        }) : null)];
  };
  const open = e => { at = { x: e.clientX, y: e.clientY }; submenu(at.x, at.y, body()); };
  const small = { col: "col", row: "row", axis: "axes", part: "part", mix: "some" }[st];
  return el("button", { class: `scopetag chain s-${st}`, title, onclick: open }, "🔗", small ? el("small", {}, small) : null);
}
/** Collapsible section; open/closed is remembered per section title (human 2026-10-01). */
export function section(title, ...rows) {
  const key = "aptvis.sec." + title, closed = localStorage.getItem(key) === "closed";
  const d = el("details", { class: "sec", open: !closed }, el("summary", { class: "sec-title" }, title), ...rows);
  d.addEventListener("toggle", () => { if (!d.dataset.filtering) localStorage.setItem(key, d.open ? "open" : "closed"); });
  return d;
}

/** Slider over a coordinate's values; calls onPick(value). */
function coordSlider(values, value, onPick, label) {
  const i0 = value === undefined || value === null ? Math.floor(values.length / 2) : Math.max(0, values.reduce((b, v, i) => (Math.abs(v - value) < Math.abs(values[b] - value) ? i : b), 0));
  const lab = el("span", { class: "val" }, `${label} = ${R.fmt(values[i0])}`);
  return [el("input", { type: "range", min: 0, max: values.length - 1, value: i0,
    oninput: e => { lab.textContent = `${label} = ${R.fmt(values[Number(e.target.value)])}`; },
    onchange: e => onPick(values[Number(e.target.value)]) }), lab];
}

// ---- small pieces of a settings line (v8.4, human 2026-10-15: one line per axis, few words, help in hover boxes) ----
const show = x => (x === undefined || x === null || !isFinite(x) ? "" : Number(R.fmt(x)));
/** ± (v5.12): symmetric about 0 — one typed value sets both ends; automatic ranges and zooms stay centred. */
function symTog(ctx, symKey, likeKey) {
  return toggle("±", !!ctx.get(symKey), v => { ctx.setWith(symKey, v || null, likeKey); ctx.done(); }, { title: "symmetric about 0: one value sets both ends (40 → −40…40)" });
}
/** Both ends of a symmetric pair from one typed value: [-|x|, |x|], or a variable in both (drawn as -|a| … |a|). */
const symPair = x => (isRef(x) ? [x, x] : [-Math.abs(x), Math.abs(x)]);
export const dash = () => el("span", { class: "dash" }, "–");   // (D22: exported for plugins' card rows)
const resetBtn = (title, fn) => el("button", { class: "tog", title, onclick: fn }, "↺");
/** ✎: edit one of the plot's labels (x / y / colour bar) in place; the hover box says what it is now. */
function labelBtn(ctx, k, what) {
  const cur = (ctx.get("labels") || {})[k];
  return el("button", { class: "tog" + (cur != null ? " on" : ""), title: `${what} label: ${cur ?? "automatic"}\n{name} = a variable's value · $…$ = LaTeX`,
    onclick: e => editText(e.clientX, e.clientY, { what: `${what} label`, value: cur, auto: ctx.lastAuto?.()?.[k] ?? "",
      extra: [k === "cbar" ? fontSize(ctx, "cbar") : fontSize(ctx, "label"), el("span", { class: "dim" }, k === "cbar" ? "" : "(x and y together)")],
      onSet: v => { ctx.set("labels", { ...(ctx.get("labels") || {}), [k]: v }); ctx.done(); } }) }, "✎");
}
/** From / to boxes of a view (2D "view" = x0 x1 y0 y1, 1D "view" = x0 x1) and its ±. Empty boxes show the view drawn
 *  now (grey); typing one end keeps the rest as drawn. allKeys = every key of the view. */
function rangeBoxes(ctx, key, k0, k1, symKey, allKeys) {
  const view = ctx.get(key), drawn = ctx.lastView ? ctx.lastView() : null;
  const set = (k, x) => {
    if (x === null) return;
    const base = { ...(drawn || {}), ...(view || {}) };
    for (const kk of allKeys) if (base[kk] === undefined) return;     // nothing drawn yet
    if (ctx.get(symKey)) [base[k0], base[k1]] = symPair(x); else base[k] = x;
    ctx.set(key, Object.fromEntries(allKeys.map(kk => [kk, base[kk]])));
    ctx.done();
  };
  const box = (k, tip) => numRef(view ? (isRef(view[k]) ? view[k] : show(view[k])) : null, x => set(k, x), { size: 5, placeholder: show(drawn?.[k]), title: tip });
  return [box(k0, "from"), dash(), box(k1, "to"), symTog(ctx, symKey, key)];
}

// ---- tools (both panel types): one summary line each; click it to edit (v8.4) ----------------------------------
export const fmtV = v => (isRef(v) ? v.slice(1) : v === null || v === undefined ? "?" : Array.isArray(v) ? v.map(R.fmt).join(", ") : R.fmt(v));   // v14.3.2: a typed list
const statLabel = (which, st) => (DATA_STATS[which].find(([k]) => k === st) || [st, st])[1];
/** A tool in a few words (its card's title, the 🛠 list): its definition's. */
const toolSummary = (ctx, t) => defOf(t)?.summary(ctx, t) ?? (missingToolOf(t) ? `${missingToolOf(t).what} (needs the ${missingToolOf(t).plugin} plugin)` : t.type);   // D22: a plugin's tool with the plugin off
const lineSummary = (ctx, t) => (t.mode === "time" ? `line at the slider's time${t.offset ? ` + ${fmtV(t.offset)}` : ""}` : `${t.orient === "h" ? "horizontal" : "vertical"} line ` + (t.mode === "time" ? ""
    : t.mode === "data" ? `at ${statLabel(t.orient === "h" ? "h" : "v", t.stat || (t.orient === "h" ? "mean" : "xmax"))}${t.stat === "cross" ? ` ${fmtV(t.at ?? 0)}` : ""}` : `at ${fmtV(t.value)}`) + (t.label ? ` “${t.label}”` : ""));
/** The full controls of one tool (its editor pop-up). upd(key, value) applies a change. */
// ---- draw (v12.0): what kind, where from the data, → variable (v12.2) -------------------------------------------
/** v12.0.1 (human 2026-11-12: field lines "can only be drawn on the 2D plots (not even spacetime but just the r theta or x y
 *  meridional plots)"): a map whose two axes are its quantity's two space axes (r–θ, plain or in the meridional plane; x–y).
 *  Not a spacetime map, not a data kind's map (v15.1; along field lines). */
function spatialMap(ctx) {
  if (ctx.panel?.type !== "2d") return false;
  const src = srcOf(ctx.get("run"), ctx.get("q"));
  if (!src || dataKindOf(src) || missingKindOf(src)) return false;
  const [xd, yd] = axesFor({ xdim: ctx.get("xdim"), ydim: ctx.get("ydim") }, src);
  return xd !== yd && src.spaceDims.includes(xd) && src.spaceDims.includes(yd);
}
const timeAxisOf = ctx => (ctx.panel?.type === "1d" ? ctx.get("xaxis") === "time" : ctx.get("xdim") === "time" || ctx.get("ydim") === "time");
function drawKindRow(ctx, t, upd) {
  // v12.1 (human 2026-11-12: "swap what tool something is from the tools own thing (if they are compatible tools like
  // horizontal vertical)"): a line, band or point swaps to another of them; field lines are their own tool (no row)
  if (t.type === "contour") return null;
  const cur = drawKind(t);
  const kinds = DRAW_KINDS.filter(([k]) => k !== "contour");
  return el("div", { class: "pop-row" }, el("span", { class: "lab" }, "tool"), select(kinds, cur, v => { setDrawKind(t, v); upd("type", t.type); },
    { title: "swap it for another draw tool: horizontal or vertical line, band, point (its look and label stay)" }));
}
/** The rows of a position read off each curve: which line(s), which statistic, over which x. */
function dataRows(ctx, t, upd, which) {
  const lines = (ctx.get("lines") || []).filter(l => !isFn(l)), st = t.stat || DATA_STATS[which][0][0];
  return [
    el("div", { class: "pop-row" }, "of", select([["", "every line"], ...lines.map(l => [String(l.id), lineName(l)])], t.line == null ? "" : String(t.line), v => upd("line", v === "" ? null : Number(v)))),
    el("div", { class: "pop-row" }, "at", select(DATA_STATS[which], st, v => upd("stat", v)),
      st === "cross" ? numRef(t.at ?? 0, v => upd("at", v ?? 0), { size: 5, title: "the value it crosses (the first crossing in the range)" }) : null),
    el("div", { class: "pop-row" }, "x from", numRef(t.from ?? null, v => upd("from", v), { size: 5, placeholder: "start", title: "empty: the start of the curve; view_x0: the part shown" }), dash(),
      numRef(t.to ?? null, v => upd("to", v), { size: 5, placeholder: "end", title: "empty: the end of the curve; view_x1: the part shown" }),
      toggle("curve colours", t.curveColors !== false, v => upd("curveColors", v), { title: "each curve's own colour (off: the colour below)" }))];
}
/** v12.2 (human 2026-11-12: "make more tools like the fits -> variable"; "lets just get rid of pinned values"): the values
 *  a draw read off each curve at the last frame drawn, and "→ variable": a measured variable of the same reading (line,
 *  statistic, range, level), in the Variables tab like a fit's numbers. */
function valueRows(ctx, t) {
  const vals = toolValues(ctx.panel?.id, t.id) || [], f = x => (Number.isFinite(x) ? R.fmt(x) : "—");
  const stat = t.stat || (t.type === "point" ? "max" : t.orient === "h" ? "mean" : "xmax");
  const line = t.line ?? (ctx.get("lines") || []).find(l => !isFn(l))?.id;
  const toVar = () => { closePopover(); newMeasuredVar({ panel: ctx.panel.id, line, op: stat, from: t.from ?? null, to: t.to ?? null, level: stat === "cross" ? (t.at ?? 0) : undefined }); };
  return [
    vals.length ? el("div", { class: "toolvals" }, vals.slice(0, 12).map(v => el("div", {}, el("span", { class: "dim" }, `${v.label || "curve"}: `), f(v.value)))) : el("div", { class: "dim" }, "values: shown after the plot is drawn"),
    el("div", { class: "pop-row" }, el("button", { title: "a reading (one value per curve of the line; Variables tab): number fields, f(x) and other plots can use it", onclick: toVar }, "→ variable"),
      el("button", { title: "cast these values (one per curve, with its dataset and r_max …) into a table (sidebar → Tables); they stay until you cast again", onclick: () => { closePopover(); castDraw(ctx, t); } }, "→ table"))];
}
// ---- "→ table" (v14.0, human 2026-11-13: "I basically want the cast to cast a number and then that number isnt updated
// unless I cast again"): a tool card's numbers of each curve, with the curve's dataset and picks, into a table ---------
/** The plot's name in a table column's note, and a tool's x range in words (D22: exported for plugins' casts). */
export const plotName = ctx => ctx.panel?.name || "1D plot";
export const rangeText = t => (t.from != null || t.to != null ? `, x ${fmtV(t.from ?? null) === "?" ? "start" : fmtV(t.from)}–${fmtV(t.to ?? null) === "?" ? "end" : fmtV(t.to)}` : "");
// (D22: the fit's and the period tool's casts moved to the analysis plugin with their tools, plugins/analysis/)
function castDraw(ctx, t) {
  const stat = t.stat || (t.type === "point" ? "max" : t.orient === "h" ? "mean" : "xmax");
  const name = { mean: "mean", max: "max", min: "min", xmax: "x at max", xmin: "x at min", cross: `crossing ${fmtV(t.at ?? 0)}` }[stat] || stat;
  castForm((toolValues(ctx.panel?.id, t.id) || []).map(v => ({ run: v.at?.run ?? null, d: v.at?.d ?? {}, values: { v: v.value } })),
    [["v", name, true, `${name} of each curve on the plot "${plotName(ctx)}"${rangeText(t)}`]]);
}
/** A tool's own card rows: its definition's (TOOL_DEFS). upd(key, value) applies a change. */
const toolControls = (ctx, t, upd) => defOf(t)?.rows(ctx, t, upd) ?? (missingToolOf(t) ? [el("div", { class: "warn" }, missingToolText(missingToolOf(t)))] : []);   // D22
function lineRows(ctx, t, upd) {
  const p = ctx.panel;
    const oneD = p?.type === "1d", which = t.orient === "h" ? "h" : "v";
    const modes = [["fixed", "at"], ["time", "at the slider's time +"], ...(oneD ? [["data", "from each curve"]] : [])];
    return [drawKindRow(ctx, t, upd),
      el("div", { class: "pop-row" }, select(modes, t.mode, v => upd("mode", v), { title: "a value / list / variable, the slider's time, or read off each curve" }),
        t.mode === "fixed" ? numRef(t.value, v => upd("value", v ?? 0), { size: 8, list: true, title: "position: a number, a list (0.5, 1, 2: one line each) or a variable" })
          : t.mode === "time" ? numRef(t.offset, v => upd("offset", v ?? 0), { size: 5, title: "offset from the slider's time" }) : null,
        t.mode === "fixed" && listOf(t.value).length > 1
          ? toggle("list colours", t.listColors !== false, v => upd("listColors", v ? undefined : false), { title: "each line in its value's colour" }) : null),
      ...(t.mode === "data" ? dataRows(ctx, t, upd, which) : []),
      el("div", { class: "pop-row" }, text(t.label ?? "", v => upd("label", v || null), { size: 18, placeholder: "label", title: "drawn beside the line; {v} = its value" }),
        oneD ? null : toggle("halo", !!t.halo, v => upd("halo", v), { title: "a thin contrasting edge under the line (white under dark lines, black under light ones), so it shows on any colour map" })),   // v14.5: a halo on every map line
      ...(t.mode === "data" ? valueRows(ctx, t) : [])];
}
function bandRows(ctx, t, upd) {
  const p = ctx.panel;
  return [drawKindRow(ctx, t, upd),
    el("div", { class: "pop-row" }, select([["v", "across x"], ["h", "across y"]], t.orient || "v", v => upd("orient", v)),
      numRef(t.lo, v => upd("lo", v ?? 0), { size: 6, title: "one edge (a number or variable)" }), dash(), numRef(t.hi, v => upd("hi", v ?? 0), { size: 6, title: "the other edge" }),
      "opacity", numRef(t.alpha ?? 0.15, v => upd("alpha", v ?? 0.15), { size: 4, title: "0–1" })),
    el("div", { class: "pop-row" }, text(t.label ?? "", v => upd("label", v || null), { size: 18, placeholder: "label" }))];
}
function pointRows(ctx, t, upd) {
  const p = ctx.panel;
    const oneD = p?.type === "1d";
    return [drawKindRow(ctx, t, upd),
      el("div", { class: "pop-row" }, select([["fixed", "at"], ...(oneD ? [["data", "on each curve"]] : [])], t.mode || "fixed", v => upd("mode", v)),
        t.mode === "data" ? null : ["x", numRef(t.x, v => upd("x", v ?? 0), { size: 6 }), "y", numRef(t.y, v => upd("y", v ?? 0), { size: 6 })],
        "size", numRef(t.size ?? 5, v => upd("size", v ?? 5), { size: 3, title: "radius in px" })),
      ...(t.mode === "data" ? dataRows(ctx, t, upd, "p") : []),
      el("div", { class: "pop-row" }, text(t.label ?? "", v => upd("label", v || null), { size: 18, placeholder: "label", title: "beside the point; {v} = its y" })),
      ...(t.mode === "data" ? valueRows(ctx, t) : [])];
}
function lineoutRows(ctx, t, upd) {
  const p = ctx.panel;
  // v14.2: lineouts of this map (lineout.js)
    const g = loGeom(ctx.panel.id, t.id), P = loPositions(t), nm = d => axisLabel(d).replace(/ \[.*\]$/, "");
    const axs = g.error ? ["x", "y"] : [g.xd, g.yd];
    const hasPlot = S.panels.some(p => (eff(p).lines || []).some(l => l.lo?.tool === t.id));
    return [
      el("div", { class: "pop-row" }, "along", select([["x", `${nm(axs[0])} (cut across ${nm(axs[1])})`], ["y", `${nm(axs[1])} (cut across ${nm(axs[0])})`]], t.along === "y" ? "y" : "x",
        x => { upd("along", x); retargetLineout(ctx.panel, t); }, { title: "the axis the lineout plot runs along; the positions are on the other one" })),
      el("div", { class: "pop-row" }, "at", isRef(t.at) ? el("span", { title: "the positions follow this variable (sidebar)" }, `${t.at.slice(1)} = ${P.map(R.fmt).join(", ")}`)
        : text(P.map(x => Number(x.toPrecision(5))).join(", "), x => upd("at", String(x).split(/[,\s]+/).filter(Boolean).map(Number).filter(Number.isFinite)), { size: 16, title: "positions on the cut axis, comma-separated (one curve each)" })),
      el("div", { class: "pop-row" }, toggle("list colours", t.listColors !== false, x => upd("listColors", x ? undefined : false), { title: "each lineout its own colour (the chips below; its line on the map and its curve). Off: one colour for all (below)" }),
        toggle("halo", !!t.halo, x => upd("halo", x), { title: "a thin contrasting edge under each line on the map (white under dark lines, black under light ones), so it shows on any colour map" }),
        text(t.label ?? "", x => upd("label", x || null), { size: 14, placeholder: "label", title: "drawn beside each line on the map; {v} = its position" })),
      // v14.3: one chip per position, like a list variable's colours: click = its colour (map line and curve); × = remove it
      t.listColors !== false && P.length ? el("div", { class: "pop-row vcolors", title: "each lineout's colour: click a chip to change it" }, P.map((v, k) => el("span", { class: "vcol" },
        el("button", { class: "swatch big" + (LO_PICK.get(t.id) === k ? " on" : ""), style: `background:${loColor(t, k)}`, title: "this lineout's colour (its line on the map and its curve)",
          onclick: () => { LO_PICK.set(t.id, LO_PICK.get(t.id) === k ? null : k); upd("colors", t.colors ?? null); } }), R.fmt(v),
        el("button", { class: "vdel", title: "remove this lineout", onclick: () => {
          const Q = [...P]; Q.splice(k, 1);
          const o = isRef(t.at) ? S.vars[t.at.slice(1)] : t, cs = [...(o?.colors || [])]; cs.splice(k, 1); if (o) o.colors = cs;
          LO_PICK.delete(t.id);
          if (isRef(t.at)) { const x = S.vars[t.at.slice(1)]; if (x) x.value = Q.length > 1 ? Q : Q[0] ?? 0; upd("at", t.at); } else upd("at", Q);
        } }, "×")))) : null,
      t.listColors !== false && LO_PICK.get(t.id) != null && LO_PICK.get(t.id) < P.length
        ? colorPicker(loColor(t, LO_PICK.get(t.id)), c => { setLoColor(t, LO_PICK.get(t.id), c); upd("colors", t.colors ?? null); }, ctx.usedColors ? ctx.usedColors() : []) : null,
      el("div", { class: "dim" }, "Click the map: the last lineout moves there. Shift-click on the map: one more. (Shift-click elsewhere on the plot still selects it.)"),
      g.error ? el("div", { class: "warn" }, g.error) : null,
      el("div", { class: "pop-row" },
        isRef(t.at) ? null : el("button", { title: "a number variable with these positions; the lineouts then follow it (other plots and tools can use it too)", onclick: () => {
          const n = newVarName("number"); S.vars[n] = { name: n, type: "number", value: P.length > 1 ? P : P[0] ?? 0, ...(t.colors ? { colors: [...t.colors] } : {}) }; upd("at", "$" + n); ctx.api?.varsChanged?.(false);   // v14.3: with its colours
        } }, "→ variable"),
        hasPlot ? null : el("button", { title: "make its 1D plot again (it was removed)", onclick: () => { closePopover(); newLineoutPlot(ctx.panel, t); } }, "make its plot"))];
}
/** The card rows of a contour tool (v15.0: general; the aperture4 plugin's field lines use them too). */
export function contourRows(ctx, t, upd) {
    const srcs = Object.values(store.runs[runOf(ctx.get("run"))]?.sources || {}).filter(s => s.spaceDims.length === 2 && !dataKindOf(s) && !missingKindOf(s)).map(s => s.name);   // (v15.1: plain maps, not a data kind's)
    const modes = [["values", "at values"], ...CONTOUR_LEVELS.map(m => [m.key, m.label])];
    return [drawKindRow(ctx, t, upd),
      spatialMap(ctx) ? null : el("div", { class: "dim" }, "Contours are drawn only on maps whose two axes are the quantity's two space axes. This plot is not one, so nothing is drawn: switch what it draws, or remove it."),
      el("div", { class: "pop-row" }, "of", select(srcs, t.q ?? ctx.get("q"), v => upd("q", v))),
      el("div", { class: "pop-row" }, select(modes, t.levelMode || "values", v => upd("levelMode", v), { title: CONTOUR_LEVELS.map(m => m.title).filter(Boolean).concat("at values: levels of the quantity").join("; ") }),
        ...(inp => [inp, listPick(inp)])(text(t.levels, v => upd("levels", v), { size: 12, title: "comma-separated; variables allowed (2, 4, rmax)" }))),   // v8.20: ▾ variables
      // v14.5 (RULES P4): each line in its list's colour (a list variable's own colours, else the series colours), a halo
      el("div", { class: "pop-row" }, toggle("list colours", !!t.listColors, v => upd("listColors", v), { title: "each contour its own colour: the colours of the list variable in the box (sidebar), else the series colours. Off: one colour (below)" }),
        toggle("halo", !!t.halo, v => upd("halo", v), { title: "a thin contrasting edge under the line (white under dark lines, black under light ones), so it shows on any colour map" }))];
}
function toolEditor(ctx, e, ev) {
  const t = e.t;
  let box = null;
  const upd = (key, v) => { t[key] = v; ctx.set(e.key, e.list); ctx.done(); setTimeout(fill); };
  // v12.0.1: remove from the card (a shared tool: from every plot that shares it, as the × in ⚙ → Tools)
  const shared = e.shared ?? (e.key === "tools" && ctx.inGroup() && !!ctx.linked("tools"));
  const remove = () => { closePopover(); dropTool(ctx, e); };
  const body = () => [el("div", { class: "pop-title" }, toolSummary(ctx, t)), ...toolControls(ctx, t, upd),
    // v14.5: line style only for a tool that draws lines; its colour picker only when it draws in one colour (its
    // definition says; the period tool's "width" is its sliding window, which the line-width box used to overwrite)
    defOf(t)?.style ? el("div", { class: "pop-row pop-sep" }, select(Object.keys(R.DASHES), t.dash || "solid", v => upd("dash", v), { title: "line style" }),
      numRef(t.width ?? 1, v => { if (isRef(v) || v > 0) upd("width", v); }, { size: 3, title: "line width (px)" })) : null,
    defOf(t)?.colour(t) === "single" ? colorPicker(t.color, c => upd("color", c), ctx.usedColors ? ctx.usedColors() : []) : null,
    el("div", { class: "pop-row pop-sep" }, toggle("shown", t.visible !== false, v => upd("visible", v), { title: "off: kept but not drawn" }),
      el("button", { class: "tooldel", title: shared ? "remove it (from every plot that shares it)" : "remove it from this plot", onclick: remove }, shared ? "remove (all linked plots)" : "remove"),
      el("button", { onclick: closePopover }, "done"))];
  const fill = () => { if (box?.isConnected) box.replaceChildren(...body()); };
  box = popover(ev.clientX, ev.clientY, body());
}
/** v14.5 (architecture review §5.1, RULES P6; human 2026-11-13: "universal ways of using tools (that can be overwriten
 *  but by default new tools should use the same design principles)"): every tool is ONE definition. A field a tool
 *  leaves out takes TOOL_DEFAULTS. Before v14.5: the TOOLS table, toolKey, and separate if-chains for summaries, card
 *  rows and adding (v12.1 human: "folders with every tool visible"; "there is a draw folder"; field lines are "its own
 *  tool"; "horizontal and vertical as separate things").
 *    key, label, help, folder, where   the Tools tab / ⚙ menu (where: "any" | "1d" | "2d" maps | "map": r–θ / x–y maps)
 *    is(t)        whether stored tool t is this kind;   make(ctx)  a new one (its starting settings)
 *    summary(ctx, t)   its card title and 🛠 list text;   rows(ctx, t, upd)  its own card rows
 *    style        it draws lines: the card shows line style and width
 *    colour(t)    "single": the card's colour picker; "curves": each curve's colour; "list": each value's (chips) — no
 *                 picker then (it was shown and ignored)
 *    addTo(ctx)   optional: adding it joins an existing tool instead (lineouts);  afterAdd(ctx, t)  optional
 *  Optional (D22, for tools that compute on a 1D plot's curves; the analysis plugin's fit, averaged curve, period, steps,
 *  steps from another plot):
 *    problem(ctx)        why it cannot go on this plot (a short reason), or null; asked after the core's own reasons.
 *    prepare1d(env, t)   may be async; after the plot's curves are read (as drawn), before its y range. env = {panel, s
 *                        (its settings, resolved), T (axis functions), curves, multiRun, errors, toolCurves}. Curves it
 *                        pushes to env.toolCurves ({tid: t.id, parent: curve, curve: {xs, ys}, role}) count in the y range;
 *                        what it returns is handed to its draw1d. E.g. an averaged curve's curves; a named tool's output.
 *    draw1d(env, t, prepared)   in the plot's tool order, after the curves are drawn. env = {panel, s, T, ctx (canvas),
 *                        plot, ax, ay, dpr, curves, win ([x0, x1] shown), tx ({dataset}, {t}), info (the plot's text box:
 *                        push {color, tool, text}), toolCurves, colorOfSlot(line, sub, key), error(message)}.
 *    legend1d(env, t)    entries it adds to the legend ([{label, color, dash, width, sep, tool}]).
 *    textRow             true: a plot with this tool shows the "fit text" row (where the tool texts sit) in ⚙ → Lines.
 *  A stored tool no definition claims, of a plugin that is not loaded (its plugin.json "tools"), keeps its settings and
 *  says so in its card and on its plot (missingToolOf, model.js).
 *  tools/check.mjs checks every definition has every field. */
const TOOL_DEFAULTS = { folder: "more", where: "any", help: "", is: () => false, make: () => null, summary: (ctx, t) => t.type, rows: () => [], style: true, colour: () => "single", addTo: null, afterAdd: null,
  problem: null, prepare1d: null, draw1d: null, legend1d: null, textRow: false };
export const TOOL_FOLDERS = [["draw", "draw"], ["curves", "curves"], ["more", "more"]];
const TOOL_DEFS = [
  { key: "hline", label: "horizontal line", folder: "draw", where: "any",
    help: "at a value, a list (one line each) or a variable; on a 1D plot also at each curve's mean, max or min (→ variable: a reading)",
    is: t => t.type === "line" && t.orient === "h", make: () => newTool("line", { orient: "h" }),
    summary: lineSummary, rows: lineRows, style: true, colour: t => (t.mode === "data" && t.curveColors !== false ? "curves" : t.mode !== "data" && listOf(t.value).length > 1 && t.listColors !== false ? "list" : "single") },
  { key: "vline", label: "vertical line", folder: "draw", where: "any",
    help: "at a value, a list or a variable, or at the slider's time; on a 1D plot also at each curve's x of the max or min, or where it crosses a value (→ variable)",
    is: t => t.type === "line" && t.orient !== "h", make: () => newTool("line", { orient: "v" }),
    summary: lineSummary, rows: lineRows, style: true, colour: t => (t.mode === "time" ? "single" : (t => (t.mode === "data" && t.curveColors !== false ? "curves" : t.mode !== "data" && listOf(t.value).length > 1 && t.listColors !== false ? "list" : "single"))(t)) },
  { key: "band", label: "band", folder: "draw", where: "any",
    help: "a shaded band between two values, across x or across y",
    is: t => t.type === "band", make: () => newTool("band"),
    summary: (ctx, t) => `band ${fmtV(t.lo)}–${fmtV(t.hi)} ${t.orient === "h" ? "(across y)" : "(across x)"}` + (t.label ? ` “${t.label}”` : ""), rows: bandRows, style: false, colour: () => "single" },
  { key: "point", label: "point", folder: "draw", where: "any",
    help: "a point at x, y; on a 1D plot also at each curve's max or min (→ variable)",
    is: t => t.type === "point", make: () => newTool("point"),
    summary: (ctx, t) => (t.mode === "data" ? `point at ${statLabel("p", t.stat || "max")}` : `point at (${fmtV(t.x)}, ${fmtV(t.y)})`) + (t.label ? ` “${t.label}”` : ""), rows: pointRows, style: false, colour: t => (t.mode === "data" && t.curveColors !== false ? "curves" : "single") },
  { key: "contour", label: "contours", folder: "draw", where: "map",
    help: "contour lines of a 2D quantity at the levels you give (numbers, a list or variables)",
    is: t => t.type === "contour", make: ctx => newTool("contour", { q: ctx.get("q") }),
    summary: (ctx, t) => `contours of ${srcOf(ctx.get("run"), t.q ?? ctx.get("q"))?.label ?? t.q ?? "?"}${t.levels ? ` at ${t.levels}` : ""}`, rows: contourRows, style: true, colour: t => (t.listColors ? "list" : "single") },
  { key: "lineout", label: "lineout", folder: "curves", where: "2d",
    help: "a linked 1D plot of this map's quantity along one of its axes, one curve per position (a cut across the other axis): click the map to move the last lineout, shift-click on the map to add one; → variable makes the positions a variable",
    is: t => t.type === "lineout", make: () => newTool("lineout"),
    summary: (ctx, t) => `lineout along ${t.along === "y" ? "y" : "x"} at ${isRef(t.at) ? t.at.slice(1) : loPositions(t).map(R.fmt).join(", ") || "—"}`, rows: lineoutRows, style: true, colour: t => (t.listColors !== false ? "list" : "single"),
    // v14.2.2 (human 2026-11-13: "when I add multiple lineouts of same type (like all along same axis, it should collapse
    // down to one tool use as a list"): a lineout on a map that has one along the same axis is one more position of it
    addTo: ctx => {
      const tools = ctx.get("tools") || [], had = tools.find(x => x.type === "lineout" && (x.along || "x") === "x");
      if (!had) return null;
      const g = loGeom(ctx.panel.id, had.id), P = loPositions(had);
      if (g.error) return null;
      const v = loNextPosition(g, P);
      if (isRef(had.at)) { const x = S.vars[had.at.slice(1)]; if (x) x.value = [...P, v]; } else had.at = [...P, v];
      had.visible = true; ctx.set("tools", tools); ctx.done();
      return had;
    },
    afterAdd: (ctx, t) => setTimeout(() => newLineoutPlot(ctx.panel, t), 0) },
].map(d => ({ ...TOOL_DEFAULTS, ...d }));
/** [key, label, help, where, folder] for the Tools tab (vars.js) and the ⚙ menu. */
export const TOOLS = TOOL_DEFS.map(d => [d.key, d.label, d.help, d.where, d.folder]);
/** v14.9 (plugins.js): a plugin adds a tool. It states the same fields as the tools above (the rest take
 *  TOOL_DEFAULTS); a new folder name gets its own folder in the Tools tab. A key that exists is refused. */
const TOOL_NEED = ["key", "label", "folder", "where", "help", "is", "make", "summary", "rows", "style", "colour"];
export function registerTool(d) {
  const missing = TOOL_NEED.filter(f => !(f in (d || {})));
  if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
  if (TOOL_DEFS.some(x => x.key === d.key)) throw new Error(`there is already a tool "${d.key}"`);
  if (!["any", "1d", "2d", "map"].includes(d.where)) throw new Error(`where must be any, 1d, 2d or map (not ${d.where})`);
  if (!/^[\w -]+$/.test(d.folder)) throw new Error(`bad folder name ${d.folder}`);
  for (const f of ["problem", "prepare1d", "draw1d", "legend1d"]) if (d[f] != null && typeof d[f] !== "function") throw new Error(`${f} is not a function`);   // D22
  if (!TOOL_FOLDERS.some(([f]) => f === d.folder)) TOOL_FOLDERS.push([d.folder, d.folder]);
  const def = { ...TOOL_DEFAULTS, ...d };
  TOOL_DEFS.push(def); TOOLS.push([def.key, def.label, def.help, def.where, def.folder]);
}
/** The definition of menu key `what`, and of stored tool t. */
const toolDef = what => TOOL_DEFS.find(d => d.key === what) ?? null;
const defOf = t => (t ? TOOL_DEFS.findLast(d => d.is(t)) ?? null : null);   // v15.0: a later (plugin) definition wins (field lines over contours)
/** D22: the definition of stored tool t (panel1d.js draws with its prepare1d / draw1d / legend1d), and whether a tool
 *  `key` is defined (a plugin may read another plugin's tools: aperture4's foot gaps read the analysis plugin's steps). */
export const toolDefOf = defOf;
export const toolDefined = key => !!toolDef(key);
export const toolWhere = w => (w === "1d" ? "1D plots" : w === "2d" ? "maps (2D plots)" : w === "map" ? "r–θ and x–y maps" : "any plot");   // v14.3.2: "2d" (lineout)
export const canHaveTool = (panelType, what) => { const w = toolDef(what)?.where ?? "any"; return w === "any" || (w === "map" ? panelType === "2d" : w === panelType); };
/** v12.0.1: why tool `what` cannot go on this plot (a short reason), or null if it can. Dragging / arming a tool shows the
 *  reason on each plot that refuses it; dropping there says it; ⚙ → Tools greys it out with the reason. */
export function toolProblem(ctx, what) {
  const type = ctx.panel?.type, { where = "any", folder } = toolDef(what) || {};
  if (where === "1d" && type !== "1d") return "it works on the curves of a 1D plot, and this is a map";
  if (where === "2d" && type !== "2d") return "it works on maps (2D plots), and this is a 1D plot";   // v14.2: lineout
  if (where === "map") {                                // v12.1: contours (v15.0: general; a plugin's tool may add its own problem)
    const label = toolDef(what)?.label ?? "contours";
    if (type !== "2d") return `${label} are drawn on maps, and this is a 1D plot`;
    const src = srcOf(ctx.get("run"), ctx.get("q"));
    if (src && !spatialMap(ctx)) return `${label} are drawn on maps whose two axes are the quantity's space axes, and this map is ${axesFor({ xdim: ctx.get("xdim"), ydim: ctx.get("ydim") }, src).join(" × ")}`;
    return toolDef(what)?.problem?.(ctx) ?? null;
  }
  if (type !== "1d" || folder === "draw") return null;
  const curves = (ctx.get("lines") || []).filter(l => !isFn(l));
  if (!curves.length) return "this plot has no data curves yet";
  return toolDef(what)?.problem?.(ctx) ?? null;              // D22: its own (the averaged curve, steps from another plot)
}
/** v12.1: ⚙ → Tools' add menu: every tool by folder; the ones this plot cannot take greyed out, the reason on hover. */
function toolMenu(ctx) {
  return el("select", { title: "add a tool (or drag one from the sidebar's Tools tab onto the plot)", onchange: e => { const v = e.target.value; e.target.value = ""; if (v) addTool(ctx, v); } },
    el("option", { value: "" }, "+ tool…"),
    TOOL_FOLDERS.map(([f, lab]) => el("optgroup", { label: lab }, TOOLS.filter(x => x[4] === f).map(([k, l, tip]) => {
      const why = toolProblem(ctx, k);
      return el("option", { value: k, disabled: !!why, title: why ? `not here: ${why}` : tip }, why ? `${l} (not here)` : l);
    }))));
}
// ---- copy a tool to another plot (v13.1, human 2026-11-12: "dragging a set tool from one plot to another (for instance I
// set a vertical band to red out t <40 ...) ... when I click the hammer icon and see dropdown list of tools i can drag over")
/** The TOOLS entry tool `t` is (for the checks). */
const toolKey = t => defOf(t)?.key ?? t.type;          // v14.5: its definition says
/** A plot's x axis as drawn (1D: its x axis and x function; 2D: its x dim, in the meridional plane or not). */
function xAxisOf(c) {
  if (c.panel?.type === "1d") return { id: JSON.stringify([c.get("xaxis"), c.get("xfn") || ""]), label: c.get("xfn") ? `f(${c.get("xaxis")})` : c.get("xaxis") };
  const src = srcOf(c.get("run"), c.get("q"));
  if (!src) return null;
  const [xd, yd] = axesFor({ xdim: c.get("xdim"), ydim: c.get("ydim") }, src), merid = isSpherical(src, xd, yd) && c.get("meridional");
  // v13.1.1: the same id as a 1D plot's for the same axis (a band along time copies between a time series and a
  // spacetime map; it said "its position is along time, and this plot's x is time")
  return { id: JSON.stringify([merid ? "r sinθ" : xd, ""]), label: merid ? "r sinθ" : xd };
}
/** Why tool `t` (set up on another plot, `from` = that plot's settings context) cannot be copied onto this plot, or null. */
export function copyProblem(ctx, t, from = null) {
  const why = toolProblem(ctx, toolKey(t));
  if (why) return why;
  // a position typed along x (a vertical line or a band across x, a point) means the same only on the same x axis
  const alongX = (t.type === "line" && t.orient !== "h" && t.mode === "fixed") || (t.type === "band" && t.orient !== "h") || (t.type === "point" && t.mode !== "data");
  if (alongX && from) {
    const a = xAxisOf(from), b = xAxisOf(ctx);
    if (a && b && a.id !== b.id) return `its position is along ${a.label}, and this plot's x is ${b.label}`;
  }
  if ((t.type === "line" || t.type === "point") && t.mode === "data" && ctx.panel?.type !== "1d") return "it reads each curve, and this is a map";
  if (isTimeLine(t) && !timeAxisOf(ctx)) return "it sits at the slider's time, and this plot has no time axis";
  return null;
}
/** Copy tool `t` onto this plot: its look and settings, a new id; "one line" becomes every line when this plot has no line
 *  of that id; a named tool (steps) gets a new name (others none). Returns the copy. */
export function copyToolTo(ctx, t) {
  const c = JSON.parse(JSON.stringify(t)), what = toolKey(t), type = ctx.panel?.type, ownTools = ctx.panel?.settings.ownTools || [];
  c.id = newId(); c.visible = true;
  if (c.line != null && !(ctx.get("lines") || []).some(l => l.id === c.line)) c.line = null;
  if (c.name) c.name = freeToolName(c.type); else delete c.name;   // D22: a named tool (steps: "steps2" …), any kind
  if (ctx.inGroup() && type === "1d" && toolDef(what)?.folder !== "draw") ctx.set("ownTools", [...ownTools, c]);
  else { const tools = ctx.get("tools") || []; tools.push(c); ctx.set("tools", tools); }
  ctx.done();
  return c;
}
/** Add tool `what` (TOOLS) to the plot; returns it. In a linked panel, curve tools start as this plot's own. */
export function addTool(ctx, what) {
  const type = ctx.panel?.type, ownTools = ctx.panel?.settings.ownTools || [], def = toolDef(what);
  if (!def) return null;
  const had = def.addTo?.(ctx);                           // v14.5: e.g. one more lineout position (its definition)
  if (had) return had;
  const t = def.make(ctx);
  if (ctx.inGroup() && type === "1d" && def.folder !== "draw") ctx.set("ownTools", [...ownTools, t]);
  else { const tools = ctx.get("tools") || []; tools.push(t); ctx.set("tools", tools); }
  ctx.done();
  def.afterAdd?.(ctx, t);
  return t;
}
/** v14.2.2 (human 2026-11-13: the 🛠 list should have "more ... than just the list (maybe the x to delete etc"): remove
 *  tool `id` of this plot (a shared one: from every linked plot), or show / hide it. */
export function removeToolById(ctx, id) {
  const e = toolEntry(ctx, id);
  if (e) dropTool(ctx, e);
}
/** v14.3.2: the one way to remove a tool (its card's ×, ⚙ → Tools ×, the 🛠 list's ×): from its list, with its card values
 *  and its output (two of the three paths left them behind). */
function dropTool(ctx, e) {
  const i = e.list.indexOf(e.t);
  if (i < 0) return;
  e.list.splice(i, 1);
  if (e.t.name) dropOutput(e.t.name);
  dropToolValues(e.t.id);
  ctx.set(e.key, e.list); ctx.done();
}
export function setToolShown(ctx, id, on) {
  const e = toolEntry(ctx, id);
  if (!e) return;
  e.t.visible = on; ctx.set(e.key, e.list); ctx.done();
}
/** v12.0: open the card of tool `id` of this plot (the Tools tab, the plot's 🛠 badge, a new tool). */
export function openToolEditor(ctx, id, ev) { const e = toolEntry(ctx, id); if (e) toolEditor(ctx, e, ev); }
/** v12.0: this plot's tools as [{t, text}] (shared ones it shows, and its own). */
export function toolList(ctx) {
  const p = ctx.panel, inG = ctx.inGroup(), sharedList = inG && ctx.linked("tools"), hide = new Set(p?.settings.hideShared || []);
  return [...(ctx.get("tools") || []).filter(t => !(sharedList && hide.has(t.id))), ...(p?.settings.ownTools || [])].map(t => ({ t, text: toolSummary(ctx, t) }));
}
function toolsSection(ctx, type) {
  const tools = ctx.get("tools") || [];
  const edit = fn => { fn(tools); ctx.set("tools", tools); ctx.done(); };
  // v5.15: in a linked panel each tool is shared (the group's list, minus those this panel made its own) or its own
  const p = ctx.panel, inG = ctx.inGroup(), sharedList = inG && ctx.linked("tools");
  const hide = new Set(p?.settings.hideShared || []), ownTools = p?.settings.ownTools || [];
  const entries = [...tools.filter(t => !(sharedList && hide.has(t.id))).map(t => ({ t, list: tools, key: "tools", shared: sharedList })),
    ...ownTools.map(t => ({ t, list: ownTools, key: "ownTools", shared: false }))];
  const rows = entries.map(e => {
    const t = e.t, upd = (key, v) => { t[key] = v; ctx.set(e.key, e.list); ctx.done(); };
    return el("div", { class: "row tool" + (inG ? (e.shared ? " linked" : " own") : "") },
      check("", t.visible, v => upd("visible", v), { title: "show" }),
      el("span", { class: "swatch", style: `background:${t.color}` }),
      el("button", { class: "linkish", title: "click to edit", onclick: ev => toolEditor(ctx, e, ev) }, toolSummary(ctx, t)),
      el("button", { class: "tog", title: e.shared ? "remove (from every plot that shares it)" : "remove", onclick: () => dropTool(ctx, e) }, "×"),
      inG ? chainTag(ctx, e.shared ? ctx.scope("tools") || "all" : "own", e.shared ? "shared with the linked plots" : "this plot's own",
        mode => { if ((mode === "shared") !== e.shared) { setToolShared(p, t, mode === "shared"); ctx.done(); } }, ["tools"], "this tool", true) : null);
  });
  // v12.0: draw (lines, band, point, field lines) · fit · more (also: drag one from the sidebar's Tools tab)
  rows.push(el("div", { class: "row" }, toolMenu(ctx)));      // v12.1: by folder
  return section("Tools", clickRow(ctx, type), ...rows);   // v11.0: click sets
}

/** Aspect (and, 2D, where the colour bar goes): rarely changed, so under More (v8.4). */
function layoutSection(ctx, type) {
  const a = ctx.get("aspect");
  return section("Layout",
    row(ctx, ["aspect", "lockAspect"], "aspect", numRef(isRef(a) ? a : Number((a || (type === "2d" ? 0.8 : 0.6)).toFixed(3)), v => { ctx.set("aspect", v ?? (type === "2d" ? 0.8 : 0.6)); ctx.done(); },
      { size: 4, title: "height / width (or drag the plot's corner)" }),
      toggle("🔒", ctx.get("lockAspect"), v => { ctx.set("lockAspect", v); ctx.done(); }, { title: "lock the shape: resizing scales the plot" })),
    type === "2d" ? row(ctx, ["cbarPos"], "colour bar", select([["auto", "auto"], ["right", "right"], ["top", "top"]], ctx.get("cbarPos") ?? "auto", v => { ctx.set("cbarPos", v); ctx.done(); },
      { title: "auto: on top when plots sit side by side" })) : null,
    // v8.9.6: this plot's text sizes (empty = the desktop's; or click the text itself)
    row(ctx, ["fonts"], "text", fontSize(ctx, "title", undefined, "title"), fontSize(ctx, "label", undefined, "labels"), fontSize(ctx, "tick", undefined, "numbers"),
      ...(type === "2d" ? [fontSize(ctx, "cbar", undefined, "bar"), fontSize(ctx, "cbarTick", undefined, "bar nos")] : [fontSize(ctx, "legend", undefined, "legend"), fontSize(ctx, "info", undefined, "fits")])));
}

// ---- 2D ------------------------------------------------------------------------------------------------------
/** Switch a 2D panel/subpanel to quantity v (new axes if the dims differ; colours re-decided). */
export function changeQuantity2D(ctx, v) {
  const run = ctx.get("run"), old = srcOf(run, ctx.get("q")), nw = srcOf(run, v);
  const shared = k => !!(ctx.linked && ctx.linked(k));
  ctx.set("q", v);
  for (const k of ["cmap", "symmetric"]) if (!shared(k)) ctx.set(k, null);      // shared colours stay shared
  if (nw && (!old || JSON.stringify(old.dims) !== JSON.stringify(nw.dims))) {
    // different dims: this panel needs its own axes; the linked panels keep theirs
    const s = { tools: copy(ctx.get("tools") || []) }; setAxes2D(s, nw);
    for (const k of ["xdim", "ydim", "logx", "logy", "view", "tools", "picks"]) {
      if (shared(k)) ctx.toggleLink(k);
      ctx.set(k, k === "picks" ? (startPicksOf(nw, v) ?? {}) : s[k]);   // v15.1: a data kind's map may start on picks (along-line: r_max 3)
    }
  }
}
/** Readable quantity names grouped by section, for 2D maps (any source with ≥ 2 dims incl. time). */
export const quantityGroups2D = run => {
  const es = [];                                          // (v11.7: sectioned by folder, model.menuSections)
  for (const s of Object.values(store.runs[runOf(run)]?.sources || {})) {
    if (s.dims.length < 2) continue;                    // v10.2: a data kind's quantities too (their own maps)
    es.push({ name: s.name, label: (s.isExpr ? "ƒ " : "") + s.label, section: s.section || "other", dims: s.dims });
  }
  for (const c of cacheables(runOf(run))) {               // v11.4: not cached here yet, can be computed (◌, grey)
    if (c.dims.length < 2) continue;
    es.push({ name: c.name, label: MARK + c.label, section: c.section, dims: c.dims,
      attrs: { class: "cacheable", title: "not cached for this dataset yet: pick it, then “compute” in the plot" } });
  }
  return menuSections(es);
};
/** v11.2.2 (human 2026-11-11: a spacetime map switched to another dataset "defaulted to meridional now I cant change
 *  back"): the quantity menu of a map whose quantity this dataset does not have — that quantity first, marked, so the
 *  menu shows what the plot is set to (not the dataset's first quantity, which it is not drawing). */
export const qLabel = q => Object.values(store.runs).map(r => r.source(q)).find(Boolean)?.label ?? labelOf(q);
export const quantityGroups2DFor = (run, q) => {
  const groups = quantityGroups2D(run);
  return q && !srcOf(run, q) && !canCompute(runOf(run), q) ? [["not in this dataset", [[q, `${qLabel(q)} (${runLabel(run)} has none)`]]], ...groups] : groups;
};

/** Set the 2D x or y axis to dim d (new view, logs and tools to match). */
function setAxis2D(ctx, src, xd, yd, which, d) {
  const s = { tools: copy(ctx.get("tools") || []) };
  setAxes2D(s, src, which === "x" ? d : xd, which === "y" ? d : yd);
  for (const k of ["xdim", "ydim", "logx", "logy", "view"]) ctx.set(k, s[k]);
  ctx.set("tools", s.tools); ctx.done();
}
/** v10.2: set both axes of a map at once (a data kind's map: its axes come in pairs). */
function setBothAxes2D(ctx, src, x, y) {
  const s = { tools: copy(ctx.get("tools") || []) };
  setAxes2D(s, src, x, y);
  for (const k of ["xdim", "ydim", "logx", "logy", "view"]) ctx.set(k, s[k]);
  ctx.set("tools", s.tools); ctx.done();
}
/** v11.0 (human 2026-11-10: "click to set … like a choice for measuring where cursor click sets some things", default
 *  off): what a click on the plot (no drag) sets — for x and y, the time slider (a time axis) or a number variable.
 *  Choosing a variable also gives the plot its crosshair (a line tool at it), the time slider the "now" line. */
function clickRow(ctx, type) {
  const c = ctx.get("click") || {}, src = type === "2d" ? srcOf(ctx.get("run"), ctx.get("q")) : null;
  const [xd, yd] = type === "2d" ? (src ? axesFor({ xdim: ctx.get("xdim"), ydim: ctx.get("ydim") }, src) : [null, null]) : [ctx.get("xaxis"), null];
  const nums = Object.values(S.vars || {}).filter(v => v.type === "number").map(v => ["$" + v.name, v.name]);
  const opts = d => [["", "—"], ...(d === "time" ? [["time", "the time slider"]] : []), ...nums, ["+", "＋ new variable"]];
  const pick = (axis, d) => select(opts(d), c[axis] ?? "", v => {
    let target = v || null;
    if (v === "+") { const n = newVarName("number"); S.vars[n] = { name: n, type: "number", value: 0 }; target = "$" + n; ctx.api?.varsChanged?.(false); }
    const next = { ...c, [axis]: target };
    ctx.set("click", next.x || next.y ? next : null);
    const tools = ctx.get("tools") || [];
    if (target === "time" && !tools.some(isTimeLine)) ctx.set("tools", [...tools, timeLine(type === "2d" ? { color: "#ffffff" } : {})]);
    else if (target && target !== "time" && !tools.some(t => t.type === "line" && t.value === target))
      ctx.set("tools", [...tools, newTool("line", { orient: axis === "x" ? "v" : "h", value: target, color: "#d6007a", dash: "dashed" })]);
    ctx.done();
  }, { title: `a click on the plot (not a drag) sets this to the clicked ${axis}${d === "time" ? " (the time slider: the nearest output)" : ""}` });
  return row(ctx, ["click"], "click sets", "x →", pick("x", xd), "y →", pick("y", yd));
}
/** One line per axis of a map: axis · from – to · ± · log · ✎ label · ↺ (v8.4). */
function axisLine2D(ctx, src, xd, yd, merid, which) {
  const X = which === "x", lk = X ? "logx" : "logy", sk = X ? "xsym" : "ysym", k = dataKindOf(src), own = k?.mapAxisOptions ? k : null;
  // v15.1 (DECISIONS D20): a data kind's map offers its own axes, which come in pairs (along-line data: time, r_max and a
  // position along the line); choosing one moves the other: an impossible pair keeps the axis's old choice on the other
  // axis, else the kind's choice (mapOtherFor)
  const onOwn = v => {
    const mine = X ? xd : yd, pair = o => (X ? [v, o] : [o, v]);
    let o = X ? yd : xd;
    if (!own.mapPairOk(...pair(o))) o = own.mapPairOk(...pair(mine)) ? mine : own.mapOtherFor(v);
    setBothAxes2D(ctx, src, ...pair(o));
  };
  return row(ctx, [X ? "xdim" : "ydim", "view", sk, lk, "labels"], el("b", {}, which),
    merid ? el("span", { class: "val axsel", title: "the meridional plane" }, X ? "r sinθ" : "r cosθ")
      : own ? select(own.mapAxisOptions, X ? xd : yd, onOwn, { class: "axsel", title: `${which} axis${own.mapAxisTitle ? `: ${own.mapAxisTitle}` : ""}` })
      : select(src.dims, X ? xd : yd, v => setAxis2D(ctx, src, xd, yd, which, v), { class: "axsel", title: `${which} axis` }),
    own && X ? el("button", { class: "tog", title: "swap x and y", onclick: () => setBothAxes2D(ctx, src, yd, xd) }, "⇄") : null,
    ...rangeBoxes(ctx, "view", X ? "x0" : "y0", X ? "x1" : "y1", sk, ["x0", "x1", "y0", "y1"]),
    merid || (own && !own.mapCanLog?.(X ? xd : yd)) ? null : toggle("log", ctx.get(lk), v => { ctx.set(lk, v); ctx.set("view", null); ctx.done(); }, { title: "log scale" }),
    labelBtn(ctx, X ? "xlabel" : "ylabel", which),
    resetBtn("the whole domain (both axes; a double-click on the plot too)", () => { ctx.set("view", null); ctx.done(); }));
}
/** The colour of a map on two lines: map ⇄ scale ✎ / limits ± |v| (v8.4). */
function colourLines2D(ctx) {
  const norm = ctx.get("norm"), limits = ctx.get("limits"), manual = limits === "manual";
  // v6.3: ± with manual limits — one typed value sets both ends (40 → −40 to 40)
  const setV = (k, v) => { if (v === null) return; if (ctx.get("vsym")) { const [a, b] = symPair(v); ctx.set("vmin", a); ctx.set("vmax", b); } else ctx.set(k, v); ctx.done(); };
  return [
    row(ctx, ["cmap", "reverse", "norm", "linthresh", "decades", "hide", "labels"], "map",
      select(R.CMAPS, ctx.get("cmap") ?? "viridis", v => { ctx.set("cmap", v); ctx.done(); }, { title: "colour map" }),
      toggle("⇄", ctx.get("reverse"), v => { ctx.set("reverse", v); ctx.done(); }, { title: "reverse the colour map" }),
      select([["lin", "linear"], ["log", "log"], ["symlog", "symlog"]], norm, v => { ctx.set("norm", v); ctx.done(); }, { title: "colour scale" }),
      norm === "symlog" ? numRef(ctx.get("linthresh"), v => { ctx.set("linthresh", v); ctx.done(); }, { size: 4, placeholder: "auto", title: "linear range around 0" }) : null,
      norm === "log" ? numRef(ctx.get("decades"), v => { ctx.set("decades", v ?? 4); ctx.done(); }, { size: 2, title: "decades shown" }) : null,
      // v8.26 (human 2026-11-09): "giving it a particular number": cells with |value| below it are drawn blank
      el("span", { class: "dash" }, "hide <"),
      numRef(ctx.get("hide"), v => { ctx.set("hide", v); ctx.done(); }, { size: 4, placeholder: "off", title: "hide below: cells with |value| under this are drawn blank (background); empty = off" }),
      labelBtn(ctx, "cbar", "colour bar")),
    row(ctx, ["limits", "vmin", "vmax", "vsym", "symmetric", "abs"], "limits",
      select([["frame", "auto: frame"], ["view", "auto: visible"], ["all", "auto: all times"], ["manual", "manual"]], limits, v => { ctx.set("limits", v); ctx.done(); },
        { title: "automatic from this frame / the visible area / all times, or typed (linked plots with the same colours share one range)" }),
      manual ? [numRef(ctx.get("vmin"), v => setV("vmin", v), { size: 5, title: "min" }), dash(), numRef(ctx.get("vmax"), v => setV("vmax", v), { size: 5, title: "max" })] : null,
      manual ? toggle("±", !!ctx.get("vsym"), v => { ctx.setWith("vsym", v || null, "vmax"); ctx.done(); }, { title: "symmetric about 0: one value sets both ends" })
        : norm !== "log" ? toggle("±", !!ctx.get("symmetric"), v => { ctx.set("symmetric", v); ctx.done(); }, { title: "symmetric about 0" }) : null,
      toggle("|v|", ctx.get("abs"), v => { ctx.set("abs", v); ctx.done(); }, { title: "absolute value" })),
  ];
}
export function settings2DBox(ctx) {
  const run = ctx.get("run"), q = ctx.get("q"), src = srcOf(run, q);
  const out = [];
  out.push(section("Data", row(ctx, ["run", "q"], "data", runSelect(run, v => { ctx.set("run", v); ctx.done(); }, { q: ctx.get("q"), title: "dataset (or a dataset variable)" }),
    groupedSelect(quantityGroups2DFor(run, q), q, v => { changeQuantity2D(ctx, v); ctx.done(); }, { title: "quantity" }))));
  if (!src) return out;
  const miss = missingKindOf(src);                         // v15.1: data only a plugin that is off can draw: its settings stay as saved
  if (miss) { out.push(section("Axes", el("div", { class: "warn" }, missingKindText(miss, src.label)))); return out; }
  const kind = dataKindOf(src);
  const [xd, yd] = axesFor({ xdim: ctx.get("xdim"), ydim: ctx.get("ydim") }, src), sph = !kind && isSpherical(src, xd, yd), merid = sph && ctx.get("meridional");
  const axRows = [axisLine2D(ctx, src, xd, yd, merid, "x"), axisLine2D(ctx, src, xd, yd, merid, "y")];
  if (sph) axRows.push(row(ctx, ["meridional", "mirror"], "",
    toggle("meridional", ctx.get("meridional"), v => { ctx.set("meridional", v); ctx.set("view", null); ctx.done(); }, { title: "the r–θ map drawn in the meridional plane (x = r sinθ, z = r cosθ)" }),
    merid ? toggle("mirror", ctx.get("mirror"), v => { ctx.set("mirror", v); ctx.set("view", null); ctx.done(); }, { title: "both sides of the axis" }) : null,
    merid ? select([["", "r < …"], ...[3, 6, 12, 20].map(R0 => [String(R0), `r < ${R0}`])], "", v => { if (!v) return; const R0 = Number(v), m = ctx.get("mirror"); ctx.set("view", { x0: m ? -R0 : 0, x1: R0, y0: -R0, y1: R0 }); ctx.done(); },
      { title: "zoom to a radius (the shape is kept, so one direction is widened to fill the plot)" }) : null));
  if (kind?.mapRows) axRows.push(...kind.mapRows(ctx, src, xd, yd));   // v15.1: a data kind's own rows (along-line: slope, smoothing, where read)
  for (const d of src.dims) {
    if (d === xd || d === yd || kind?.mapSkipDims?.includes(d)) continue;
    if (d === "time") {
      const mode = ctx.get("timeMode"), ft = ctx.get("fixedTime");
      axRows.push(row(ctx, ["timeMode", "fixedTime", "avg"], el("b", {}, "t"), select([["follow", "slider"], ["fixed", "fixed"]], mode, v => { ctx.set("timeMode", v); ctx.done(); }, { title: "time: follows the slider, or fixed" }),
        mode === "fixed" ? [isRef(ft) ? el("span", { class: "val" }, `t = ${R.fmt(numOf(ft))}`) : coordSlider(src.times, ft, v => { ctx.set("fixedTime", v); ctx.done(); }, "t"),
          varBind(ft, v => { ctx.set("fixedTime", v ?? src.times[src.indexAt(numOf(ft) ?? src.times.at(-1))]); ctx.done(); })] : null,
        // v8.13: the map averaged over ±N outputs around that time (not a data kind's map: it reads its own data)
        kind ? null : [el("span", { class: "dim" }, "mean over t ±"), numRef(ctx.get("avg") ?? null, v => { ctx.set("avg", v); ctx.done(); },
          { size: 2, placeholder: "0", title: "average the map over the outputs within t ± h around the time shown (h in the time axis's units; 0 or empty = none; a number or a variable)" }),
        el("span", { class: "dim" }, timeUnits())]));
    } else {
      // a slice: a slider, or a number variable (read in r_max if the dim has it, else its own coordinate; v5)
      const c = dimCoord(src, d), picks = ctx.get("picks") || {}, p = picks[d];
      axRows.push(row(ctx, ["picks"], el("b", {}, d),
        isRef(p) ? el("span", { class: "val" }, `${c.label} = ${R.fmt(c.values[pickIndex(src, d, p)])}`) : coordSlider(c.values, p, v => { ctx.set("picks", { ...picks, [d]: v }); ctx.done(); }, c.label),
        varBind(p, v => { ctx.set("picks", { ...picks, [d]: v ?? c.values[pickIndex(src, d, p)] }); ctx.done(); })));
    }
  }
  out.push(section("Axes", ...axRows));
  out.push(section("Colour", ...colourLines2D(ctx)));
  out.push(layoutSection(ctx, "2d"));
  out.push(toolsSection(ctx, "2d"));
  return out;
}

// ---- 1D ------------------------------------------------------------------------------------------------------
/** x: axis · from – to · ± · log · ✎ label · ↺ (v8.4) */
function xLine1D(ctx) {
  const xaxis = ctx.get("xaxis"), ykind = ctx.get("ykind"), ta = parseTabAxis(xaxis);
  if (ta) {                                               // v14.0: a table plot: x is one of the table's columns
    const tb = tableOf(ta.table), cols = tb ? numericCols(tb) : [[ta.key, ta.key]];
    return row(ctx, ["xaxis", "view", "logx", "labels"], el("b", {}, "x"),
      select(cols.map(([k, l]) => [tabAxis(ta.table, k), l]), xaxis, v => { ctx.set("xaxis", v); ctx.set("view", null); ctx.done(); }, { title: `a column of table ${ta.table}` }),
      toggle("log", !!ctx.get("logx"), v => { ctx.set("logx", v); ctx.set("view", null); ctx.done(); }, { title: "log x" }));
  }
  return row(ctx, ["xaxis", "xfn", "view", "xsym", "xdrag", "logx", "labels"], el("b", {}, "x"),
    select(axisCatalog().map(a => [a, axisLabel(a)]), xaxis, v => {
      ctx.set("xaxis", v); ctx.set("view", null); ctx.set("logx", axisInfo(v).scale === "log");
      if (ykind && ![...kindsFor(v), ...derivedKindsFor(v)].some(k => k.kind === ykind)) ctx.set("ykind", null);   // v8.30: slope / rate groups too
      const tools = ctx.get("tools") || [];
      if (v === "time" && !tools.some(isTimeLine)) ctx.set("tools", [...copy(tools), timeLine()]);
      const labs = ctx.get("labels"); if (labs?.xlabel) ctx.set("labels", { ...labs, xlabel: null });   // the old axis's name
      ctx.done();
    }, { class: "axsel", title: "x axis" }),
    fnBox(ctx, "x"),
    ...rangeBoxes(ctx, "view", "x0", "x1", "xsym", ["x0", "x1"]),
    dragTog(ctx, "x"),
    toggle("log", ctx.get("logx"), v => { ctx.set("logx", v); ctx.set("view", null); ctx.done(); }, { title: "log scale" }),
    labelBtn(ctx, "xlabel", "x"),
    resetBtn("the whole x range (a double-click on the plot too)", () => { ctx.set("view", null); ctx.done(); }));
}
/** v8.17 (human 2026-10-30: "click an axis and apply a fn to it … my x axis is r_max can I make it be 1/r_max"): the
 *  axis's function. The points are drawn at f(x) / the values as f(y); the data are not changed. Empty = none. */
function fnBox(ctx, ax) {
  const k = ax + "fn";
  return [el("span", { class: "dim" }, `f(${ax})`), text(ctx.get(k) ?? "", v => {
    ctx.set(k, v.trim() || null);
    if (ax === "x") ctx.set("view", null); else { ctx.set("ylim", "auto"); ctx.set("yview", null); }   // windows typed in the old units
    ctx.done();
  }, { size: 8, placeholder: ax, class: "fn-in", title: ax === "x"
    ? "draw each point at f(x) instead of x, e.g. 1/x — x is the axis's own coordinate (its name works too: 1/r_max)\n" +
      "also: t (the slider's time), pi, variables, config numbers · the values don't change, only where they are drawn\n" +
      "a measured variable with one value per curve (a field-line length L, or a list line's max …): each curve uses its own (x * L)\n" +
      "zoom, fits, means and positions typed for this axis are in f(x) as drawn · empty = none"
    : "draw each value as f(y) instead of y, e.g. y*x^3 or 1/y — y is the value, x the x axis's own coordinate (r_max …)\n" +
      "also: t, pi, variables, config numbers · after the line's scale (÷ max …) · empty = none" })];
}
/** v8.9.5 (human 2026-10-15: dragging inside a plot "should be part of the axis options … same should work for y axis
 *  (lets go default is no drag) but can choose to drag. if both are active as drag it works like the 2d map drag"):
 *  whether a drag inside the plot moves this axis — x on by default (as before), y off; both on = drag like a map. */
function dragTog(ctx, ax) {
  const on = ax === "x" ? ctx.get("xdrag") !== false : ctx.get("ydrag") === true;
  return toggle(ax === "x" ? "⇆" : "⇅", on, v => { ctx.set(`${ax}drag`, ax === "x" ? (v ? null : false) : v || null); ctx.done(); },
    { title: `drag inside the plot moves ${ax}: ${on ? "on" : "off"}${ax === "y" ? " (not with ±)" : ""}` });
}
/** y: kind · from – to (typing makes it manual) · ± · log · |y| · ✎ label · ↺ automatic (v8.4) */
function yLine1D(ctx) {
  const ykind = ctx.get("ykind"), drawn = ctx.lastView ? ctx.lastView() : null, manual = ctx.get("ylim") === "manual";
  const set = (k, x) => {
    if (x === null) return;
    let lo = manual ? ctx.get("ymin") : drawn?.y0, hi = manual ? ctx.get("ymax") : drawn?.y1;
    if (ctx.get("ysym")) [lo, hi] = symPair(x);                          // v5.12: one value sets both ends
    else if (k === "ymin") lo = x; else hi = x;
    ctx.set("ylim", "manual"); ctx.set("ymin", lo); ctx.set("ymax", hi); ctx.set("yview", null); ctx.done();
  };
  const cur = k => { const x = ctx.get(k); return isRef(x) ? x : show(x); };
  return row(ctx, ["ykind", "yfn", "ylim", "ymin", "ymax", "yview", "ysym", "ydrag", "logy", "abs", "labels"], el("b", {}, "y"),
    select([["", "(any)"], ...kindsFor(ctx.get("xaxis")).map(k => [k.kind, k.kind + (k.units ? ` [${k.units}]` : "")]),
      ...derivedKindsFor(ctx.get("xaxis")).map(k => [k.kind, k.kind])], ykind || "",          // v8.30: "slope of …", "rate of …"
      v => { ctx.set("ykind", v || null); ctx.set("yview", null); ctx.done(); }, { class: "axsel", title: "y axis: the y-axis group of its lines (slope of … / rate of …: slope and d/dt lines)" }),
    fnBox(ctx, "y"),
    numRef(manual ? cur("ymin") : null, x => set("ymin", x), { size: 5, placeholder: show(drawn?.y0), title: "from" }), dash(),
    numRef(manual ? cur("ymax") : null, x => set("ymax", x), { size: 5, placeholder: show(drawn?.y1), title: "to" }), symTog(ctx, "ysym", "ymax"),
    dragTog(ctx, "y"),
    toggle("log", ctx.get("logy"), v => { ctx.set("logy", v); ctx.set("yview", null); ctx.done(); }, { title: "log scale" }),
    toggle("|y|", ctx.get("abs"), v => { ctx.set("abs", v); ctx.done(); }, { title: "absolute value" }),
    labelBtn(ctx, "ylabel", "y"),
    resetBtn("automatic: fit the lines", () => { ctx.set("ylim", "auto"); ctx.set("yview", null); ctx.done(); }));
}

/** Click-to-set (v8): the line(s) of one thing on the plot, the same as in the settings box. what = "cbar" | "x" | "y". */
/** A tool of this panel by id, with the list it lives in (shared "tools" or this plot's "ownTools"). */
function toolEntry(ctx, id) {
  const own = ctx.panel?.settings.ownTools || [], tools = ctx.get("tools") || [];
  const t = own.find(x => x.id === id);
  if (t) return { t, list: own, key: "ownTools" };
  const u = tools.find(x => x.id === id);
  return u ? { t: u, list: tools, key: "tools" } : null;
}
/** v8.11: where the fit text sits and how big (like the legend; or drag it on the plot, double-click it: upper left). */
function fitTextRow(ctx) {
  const pos = ctx.get("infoPos") ?? null, spot = pos ? legendSpot(pos) : "ul";
  const spots = [...LEGEND_SPOTS.map(([k, lab]) => [k, lab]), ...(spot === "custom" ? [["custom", "dragged"]] : [])];
  return row(ctx, ["infoPos", "fonts"], "fit text",
    select(spots, spot, v => { const hit = LEGEND_SPOTS.find(([k]) => k === v); if (hit) { ctx.set("infoPos", v === "ul" ? null : { fx: hit[2], fy: hit[3] }); ctx.done(); } },
      { title: "where the fit formulas sit (or drag them on the plot; they snap to corners and edges; double-click: back to the upper left)" }),
    fontSize(ctx, "info"));
}
/** v8.15.1 (human 2026-10-21: "clicking y axis in 1D does not let me change the axis title" — it was behind ✎): the
 *  label as a text box, first in the axis's quick box (live; empty or ↺ = automatic; {name} a variable, $…$ LaTeX). */
function labelRow(ctx, k) {
  const cur = (ctx.get("labels") || {})[k] ?? null, auto = ctx.lastAuto?.()?.[k] ?? "";
  const put = v => { ctx.set("labels", { ...(ctx.get("labels") || {}), [k]: v }); ctx.done(); };
  const inp = el("input", { type: "text", size: 26, value: cur ?? auto, class: "lbl-in", title: `automatic: ${auto} · {name} = a variable's value · $…$ = LaTeX` });
  inp.addEventListener("input", () => put(inp.value === auto || inp.value === "" ? null : inp.value));
  return el("div", { class: "row" }, el("span", { class: "lab" }, "label"), inp,
    el("button", { class: "tog", title: `back to automatic: ${auto}`, onclick: () => { inp.value = auto; put(null); } }, "↺"));
}
export function quickBox(ctx, what) {
  if (what === "x" || what === "y" || what === "cbar") return [labelRow(ctx, what === "cbar" ? "cbar" : what + "label"), ...quickBox0(ctx, what)];
  return quickBox0(ctx, what);
}
function quickBox0(ctx, what) {
  if (String(what).startsWith("fit:")) {                 // v8.11: a click on a fit's text: that fit, and its text's place / size
    const e = toolEntry(ctx, Number(String(what).slice(4)));
    if (!e) return [el("div", { class: "dim" }, "this fit was removed")];
    const upd = (key, v) => { e.t[key] = v; ctx.set(e.key, e.list); ctx.done(); };
    return [el("div", { class: "dim" }, toolSummary(ctx, e.t)), ...toolControls(ctx, e.t, upd), fitTextRow(ctx)];
  }
  // v8.9.6: and the sizes of that axis's text (this plot)
  const sizes = what === "cbar" ? el("div", { class: "row" }, el("span", { class: "dim" }, "text"), fontSize(ctx, "cbarTick", undefined, "numbers"), fontSize(ctx, "cbar", undefined, "label"))
    : el("div", { class: "row" }, el("span", { class: "dim" }, "text"), fontSize(ctx, "tick", undefined, "numbers"), fontSize(ctx, "label", undefined, "label"));
  if (ctx.panel.type === "1d") return [what === "x" ? xLine1D(ctx) : yLine1D(ctx), sizes];
  const src = srcOf(ctx.get("run"), ctx.get("q"));
  if (!src) return [el("div", { class: "dim" }, "no data for this plot")];
  if (what === "cbar") return [...colourLines2D(ctx), sizes];
  const [xd, yd] = axesFor({ xdim: ctx.get("xdim"), ydim: ctx.get("ydim") }, src), merid = isSpherical(src, xd, yd) && ctx.get("meridional");
  return [axisLine2D(ctx, src, xd, yd, merid, what), sizes];
}

export function settings1DBox(ctx) {
  const xaxis = ctx.get("xaxis"), out = [];
  out.push(section("Axes", xLine1D(ctx), yLine1D(ctx)));
  // lines: the legend is the main editor; this list is the overview
  const lines = ctx.get("lines") || [];
  const lrows = [];
  lines.forEach((l, k) => {
    const rec = isRecordedLine(l), src = rec ? srcOf(l.run, l.q) : null, ok = !rec || (src && fitAxis(src, xaxis));   // v14.3.2: every kind
    lrows.push(el("div", { class: "row layer" },
      check("", l.visible !== false, v => { l.visible = v; ctx.set("lines", lines); ctx.done(); }, { title: "show" }),
      el("span", { class: "swatch", style: `background:${l.color || R.SERIES_COLORS[k % 10]}` }),
      el("button", { class: "linkish", title: "edit this line (or click its legend entry)", onclick: e => openEditLine(ctx.panel, l.id, e.clientX, e.clientY, ctx.api, l.color || R.SERIES_COLORS[k % 10], lineName(l)) },
        lineName(l)),
      !ok ? el("span", { class: "warn", title: `this quantity has no ${xaxis} axis` }, "⚠") : null,
      (() => { const n = expansions(l, xaxis).length; return n > 1 ? el("span", { class: "listn", title: "follows a list variable: one curve per value" }, `×${n}`) : null; })(),
      el("button", { class: "tog", title: "remove line", onclick: () => { lines.splice(k, 1); ctx.set("lines", lines); ctx.done(); } }, "×")));
  });
  lrows.push(el("div", { class: "row" }, el("button", { onclick: e => openAddLine(ctx.panel, e.clientX, e.clientY, ctx.api) }, "+ line")));
  // v5.5 scale + v10.1 smoothing (was v5.13 "avg ±N"): every line of the panel (a line can set its own in its legend
  // editor) — one line (v8.4)
  const tX = xaxis === "time", sm0 = normSmooth(ctx.get("smooth") !== undefined ? ctx.get("smooth") : ctx.get("avg"), tX);
  lrows.push(row(ctx, ["scale", "smooth"], "all lines", scaleControls(ctx.get("scale") ?? null, v => { ctx.set("scale", v); ctx.done(); }, lines[0]?.run ?? ctx.get("run"), xaxis),
    el("span", { class: "dim" }, "smooth"), smoothControls(sm0 ?? false, v => { ctx.set("smooth", v ?? false); if (tX && ctx.get("avg") != null) ctx.set("avg", null); ctx.done(); },
      { xu: axisInfo(xaxis).units || "", dflt: tX ? 2 : 0.25 })));
  // v6.3 legend: what it says + where (drag it on the plot too; double-click it: back to the top right)
  const spot = legendSpot(ctx.get("legendPos") ?? null);
  const spots = [...LEGEND_SPOTS.map(([k, lab]) => [k, lab]), ["outside", "outside"], ...(spot === "custom" ? [["custom", "dragged"]] : [])];
  lrows.push(row(ctx, ["legend", "legendPos"], "legend",
    select([["compact", "compact"], ["full", "full"], ["off", "hidden"]], ctx.get("legend") || "compact", v => { ctx.set("legend", v); ctx.done(); },
      { title: "compact: only what differs (the common part as a heading) · a line's own label: click its legend entry" }),
    select(spots, spot, v => {
      const hit = LEGEND_SPOTS.find(([k]) => k === v);
      if (v !== "custom") { ctx.set("legendPos", v === "outside" ? "outside" : v === "ur" ? null : { fx: hit[2], fy: hit[3] }); ctx.done(); }
    }, { title: "where it sits (or drag it on the plot; it snaps to corners and edges)" }), fontSize(ctx, "legend")));
  if ([...(ctx.get("tools") || []), ...(ctx.panel?.settings.ownTools || [])].some(t => defOf(t)?.textRow)) lrows.push(fitTextRow(ctx));   // v8.11 (D22: the fit's definition says)
  out.push(section("Lines", ...lrows));
  out.push(layoutSection(ctx, "1d"));
  out.push(toolsSection(ctx, "1d"));
  return out;
}
