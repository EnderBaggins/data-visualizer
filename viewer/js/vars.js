// vars.js — variables (v5, human 2026-10-05): named values in the left sidebar that settings can point at.
// Links share the LOOK of plots (colour map, zoom, axes); variables share DATA CHOICES (which dataset, which
// r_max, which time), across any panels. Kinds (model.js): dataset · number · measured (read off a 1D line every
// frame: max, min, x at max, …). A dataset menu lists the variables; a number field takes a variable's name.
// v13.0 (human 2026-11-12): two groups. Set variables (what you choose: datasets, numbers) and measured variables (read
// off the data, one value per dataset: configs, fits, readings; ⏱ = moves with the slider).
import * as R from "./render.js";
import { styleNow, fitValue, VIEW_VARS, PREFS } from "./model.js";
import { readingIsLive, setReadingOpen, updateMeasured } from "./measure.js";
import { tablesTab } from "./tables.js";   // v14.0
import { fitParams } from "./fit.js";
import { isTagEntry, tagRuns, allTags, outputValues, nameTaken } from "./model.js";
import { S, store, eff, fitAxis, dimCoord, axisInfo, isFn, isAn, anDef, srcOf, isRef, varOf, runOf, runLabel, numOf, listOf, newVarName, validVarName, renameVar, deleteVar, usesOf, bindRun, runNames, parseNumberValue, numberText,
  configValues, isRunList, runsText, runsOf, listEntries, listRefs, readingOwn, readingRuns, fitRuns, READING_OPS } from "./model.js";
import { el, select, askName, askConfirm, askForm, colorButton, closePopover } from "./ui.js";
import { canCompute, ghostRuns, ghostPick, labelOf, MARK } from "./cacheable.js";

let API = { varsChanged() {}, toast() {}, highlight() {}, relayout() {} };
export function setVarsApi(api) { API = api; }
/** A variable changed (from outside the sidebar, e.g. a line editor): redraw (rebuild = every plot) and save. */
export const varsChanged = (rebuild = true) => API.varsChanged(rebuild);

export const MEASURE_OPS = [["max", "max"], ["min", "min"], ["xmax", "x at max"], ["xmin", "x at min"], ["cross", "x where it crosses"], ["at", "value at x ="],
  ["mean", "mean along …"],                            // (v14.3.1: v14.1 commented this out by mistake — restored)
  ["period", "cycle period"], ["regularity", "cycle regularity"], ["ncycles", "number of cycles"]];   // v14.1
/** v15.1: the core's operations and the plugins' (measure.js registerReadingOp; aperture4: "line length"). */
export const measureOps = () => [...MEASURE_OPS, ...READING_OPS.map(o => [o.key, o.label])];
const fmt1 = v => (typeof v === "number" && isFinite(v) ? R.fmt(v) : "—");
const fmtVal = v => (Array.isArray(v) ? v.map(fmt1).join(", ") : fmt1(v));   // a list: one value per curve (v5.15)

/** Dataset menu: variables first ("A · baseline-19"), then the runs, then "new variable…" (binds this place).
 *  props.lists (v8.18): offer dataset lists too (a 1D line's dataset; not 2D maps or analytic parameters). */
export function runSelect(value, onchange, props = {}) {
  const { lists = false, q = null, ...attrs } = props;
  const runs = runNames(), vars = Object.values(S.vars).filter(v => v.type === "dataset" && (lists || !isRunList(v) || "$" + v.name === value));
  const opt = (v, lab) => el("option", { value: v, selected: v === value }, lab);
  // v11.4 (human 2026-11-12): with the plot's quantity q, a dataset that lacks it but can compute it is marked ◌ (grey),
  // and datasets added on the data manager page with nothing cached yet are listed too (◌): picking one offers to compute
  const qq = q && !isRef(q) ? q : null, ghosts = qq ? ghostRuns().filter(g => canCompute(g, qq)) : [];
  // v8.24: the datasets by their data manager group (archived ones left out); a 1D line can take a whole group as a list
  const groups = runGroups([...runs, ...ghosts], isRef(value) ? [] : [value]), whole = lists ? groups.filter(([g, rs]) => g && rs.length > 1 && !rs.some(r => ghosts.includes(r))) : [];
  const runOpt = r => {
    const ghost = ghosts.includes(r), lack = !ghost && qq && !srcOf(r, qq) && canCompute(r, qq), o = opt(r, (ghost || lack ? MARK : "") + cardLabel(r));
    if (ghost || lack) o.className = "cacheable";
    o.title = (ghost ? `nothing cached for ${r} yet: pick it to compute ${labelOf(qq)}\n\n` : lack ? `${labelOf(qq)} is not cached here: pick it, then “compute” in the plot\n\n` : "") + runTip(r);
    return o;
  };
  // v8.19: hovering the menu says what its dataset is (then the menu's own hint)
  return el("select", { ...attrs, title: [value ? runRefTip(value) : "", attrs.title].filter(Boolean).join("\n\n"), onchange: e => {
      let v = e.target.value;
      if (ghosts.includes(v)) {                         // nothing stored yet: offer to compute; the choice is made then
        e.target.value = value ?? "";
        ghostPick(v, qq, () => { onchange(v); API.varsChanged(false); }, e.target);
        return;
      }
      if (v === "__new") {
        const name = newVarName("dataset");
        S.vars[name] = { name, type: "dataset", value: runOf(value) || runs[0] };
        v = "$" + name;
        API.toast(`new variable ${name} = ${S.vars[name].value} (change it in the sidebar)`);
      } else if (v.startsWith("__group:")) v = groupAsList(v.slice(8));
      else if (v.startsWith("__tag:")) v = tagAsList(v.slice(6));                 // v11.8
      onchange(v);
      API.varsChanged(false);
    } },
    isRef(value) && !varOf(value) ? opt(value, `${value.slice(1)} (missing)`) : null,
    vars.length ? el("optgroup", { label: "variables" }, vars.map(v => { const o = opt("$" + v.name, `${v.name} · ${runsText(v)}${isRunList(v) ? `  (list of ${runsOf("$" + v.name).length})` : ""}`); o.title = runRefTip("$" + v.name); return o; })) : null,
    groups.map(([g, rs]) => el("optgroup", { label: groupLabel(g, groups) }, rs.map(runOpt))),
    whole.length ? el("optgroup", { label: "a whole group as a list (one curve per dataset)" }, whole.map(([g, rs]) => { const o = opt("__group:" + g, `${g}  (${rs.length} datasets)`); o.title = rs.join("\n"); return o; })) : null,
    lists && allTags().length ? el("optgroup", { label: "a tag as a list (every dataset with it, now and later)" }, allTags().map(t => { const rs = tagRuns(t), o = opt("__tag:" + t, `#${t}  (${rs.length} dataset${rs.length === 1 ? "" : "s"})`); o.title = rs.join("\n"); return o; })) : null,
    el("optgroup", { label: "─────" }, opt("__new", "＋ new variable for this…")));
}

/** A dataset's card (data manager, v8.1): its tags beside the name in menus, notes + tags as the tooltip. */
const cardOf = r => store.cards?.[r] || null;
// ---- dataset groups (v8.24, human 2026-11-09: "I like the collapsible dataset groups, there may be a way to use those
// to improve my choosing of datasets on a new desktop"): menus list the datasets by their data manager group; archived
// datasets are left out unless one is in use ----------------------------------------------------------------------
export const groupOfRun = r => cardOf(r)?.group || "";
export const isArchived = r => !!cardOf(r)?.archived;
/** [[group, [datasets]]] in the data manager's group order, datasets in no group last ("" = no group); archived ones
 *  are left out unless listed in `keep`. */
export function runGroups(runs = runNames(), keep = []) {
  const order = store.groupOrder || [], out = new Map();
  for (const r of runs) if (!isArchived(r) || keep.includes(r)) { const g = groupOfRun(r); if (!out.has(g)) out.set(g, []); out.get(g).push(r); }
  const at = g => (g === "" ? 1e9 : order.includes(g) ? order.indexOf(g) : 1e6);
  return [...out.keys()].sort((a, b) => at(a) - at(b) || a.localeCompare(b)).map(g => [g, out.get(g)]);
}
/** A menu heading for a group ("" = the datasets in no group). */
export const groupLabel = (g, groups) => g || (groups.length > 1 ? "other datasets" : "datasets");
/** A whole group as a dataset list: a list with exactly its datasets if there is one, else a new one named after the
 *  group. Returns its "$name". */
/** v11.8: a dataset list that follows tag `t` (made once per tag, then reused): "$name". */
export function tagAsList(t) {
  let v = Object.values(S.vars).find(x => isRunList(x) && x.value.length === 1 && x.value[0] === "#" + t);
  if (!v) {
    const base = t.replace(/\W+/g, "_").replace(/^(?=\d)/, "_");
    const n = validVarName(base) && !nameTaken(base) ? base : newVarName("tag");
    v = S.vars[n] = { name: n, type: "dataset", value: ["#" + t], colors: [R.SERIES_COLORS[0]] };
    API.toast(`new dataset list ${n} = every dataset tagged "${t}" (${tagRuns(t).length} now; it follows the tag)`);
  }
  return "$" + v.name;
}
export function groupAsList(g) {
  const runs = runGroups().find(([x]) => x === g)?.[1] || [];
  let v = Object.values(S.vars).find(x => isRunList(x) && JSON.stringify(x.value) === JSON.stringify(runs));
  if (!v) {
    const base = g.replace(/\W+/g, "_").replace(/^(?=\d)/, "_");
    const n = validVarName(base) && !nameTaken(base) ? base : newVarName("runs");
    v = S.vars[n] = { name: n, type: "dataset", value: [...runs] };
    setRuns(v, runs);
    API.toast(`new dataset list ${n} = group "${g}" (${runs.length} datasets; sidebar)`);
  }
  return "$" + v.name;
}
/** A plain dataset menu (no variables) sectioned by group: the sidebar's dataset variables, forms. */
export function groupedRunSelect(value, onchange, props = {}, runs = runNames()) {
  const groups = runGroups(runs, [value]);
  return el("select", { ...props, onchange: e => onchange(e.target.value) },
    groups.map(([g, rs]) => el("optgroup", { label: groupLabel(g, groups) }, rs.map(r => { const o = el("option", { value: r, selected: r === value }, cardLabel(r)); o.title = runTip(r); return o; }))));
}
/** Tick boxes for datasets under group headings (a heading's box ticks the whole group). check(r) → checked; on(r, v). */
export function groupedRunTicks(check, on, runs = runNames(), keep = [], tip = runTip) {
  const groups = runGroups(runs, keep);
  return groups.flatMap(([g, rs]) => [
    groups.length > 1 || g ? el("label", { class: "chk np-sec", title: `tick or untick the whole group "${groupLabel(g, groups)}"` },
      el("input", { type: "checkbox", checked: rs.every(check), onchange: e => { for (const r of rs) on(r, e.target.checked); } }), groupLabel(g, groups)) : null,
    ...rs.map(r => el("label", { class: "chk", title: tip(r) }, el("input", { type: "checkbox", checked: check(r), onchange: e => on(r, e.target.checked) }), cardLabel(r)))]);
}
export const cardLabel = r => { const t = cardOf(r)?.tags || []; return t.length ? `${r}  · ${t.join(", ")}` : r; };
// ---- what a dataset is (v8.19, human 2026-11-03: "I like the idea of tooltips so when I hover over dataset it says
// whats what") ----------------------------------------------------------------------------------------------------
/** "pairs-10: the replicate_2017 fixes on the project's 2–8 drive" (the card's line from the run's wiki section,
 *  `python -m datamgr about`), else the name. */
export const aboutLine = r => (cardOf(r)?.about ? `${r}: ${cardOf(r).about}` : r);
/** A dataset's hover text: what it is, its wiki page, how far it is stored, and the card's tags and notes. */
export function runTip(r) {
  const c = cardOf(r), times = store.runs[r]?.m.times, t = times?.length ? times.at(-1) : null;
  const where = [c?.group ? `group: ${c.group}` : "", c?.page ? `wiki: ${c.page.replace(/^projects\//, "")}` : "", t != null ? `stored to t = ${R.fmt(t)}` : "",
    c?.archived ? "archived" : ""].filter(Boolean).join(" · ");
  return [aboutLine(r), where, c?.tags?.length ? `tags: ${c.tags.join(", ")}` : "", c?.notes || ""].filter(Boolean).join("\n");
}
/** The same for a menu value: a dataset, or a dataset variable (its name, then each of its datasets). */
export function runRefTip(rv) {
  if (!isRef(rv)) return runTip(rv);
  const v = varOf(rv);
  if (!v) return `variable ${rv.slice(1)} is missing`;
  const ents = listEntries(v);                                  // v11.2: entries resolved (via a variable), each once
  return !Array.isArray(v.value) ? `variable ${v.name} = ${runTip(ents[0]?.run)}`
    : [`variable ${v.name}: a list of ${ents.length}`, ...ents.map(o => aboutLine(o.run) + (o.via ? `   (via ${o.via})` : ""))].join("\n");
}
/** The config numbers that differ between two datasets: [[key, a's, b's]] (output_dir left out). null when either has
 *  none recorded (`python -m datamgr conf` records them). */
export function confDiff(a, b) {
  const A = store.runs[a]?.m.conf_all, B = store.runs[b]?.m.conf_all;
  if (!A || !B) return null;
  return [...new Set([...Object.keys(A), ...Object.keys(B)])].filter(k => k !== "output_dir" && JSON.stringify(A[k]) !== JSON.stringify(B[k]))
    .sort().map(k => [k, A[k], B[k]]);
}
/** "compare with [dataset]": a table of the settings that differ. Config numbers only, so a code change without a
 *  config switch does not show (the wiki line says those). opts: others (the menu), pick (shown at once), resized(). */
export function compareBox(a, { others = runNames().filter(r => r !== a), pick = "", resized = () => {} } = {}) {
  const out = el("div", { class: "cmp" });
  const f = v => (v === undefined || v === null ? "—" : Array.isArray(v) ? `[${v.join(", ")}]` : String(v));
  const show = b => {
    const rows = b ? confDiff(a, b) : [];
    out.replaceChildren(!b ? "" : rows === null ? el("div", { class: "dim" }, `no config numbers recorded for ${store.runs[a]?.m.conf_all ? b : a}`)
      : !rows.length ? el("div", { class: "dim" }, "the same config numbers (a code change would not show here)")
      : el("table", { class: "cmp-t" }, el("tr", {}, el("th", {}, "setting"), el("th", { title: runTip(a) }, a), el("th", { title: runTip(b) }, b)),
          rows.map(([k, x, y]) => el("tr", {}, el("td", {}, k), el("td", {}, f(x)), el("td", {}, f(y))))));
    resized();
  };
  const sel = select([["", "compare with…"], ...others.map(r => [r, r])], pick, show,
    { title: "the config numbers that differ between the two (code changes without a config switch don't show)" });
  if (pick) show(pick);
  return [el("div", { class: "pop-row" }, el("span", { class: "lab" }, "compare"), sel), out];
}

/** Parse what was typed into a number field: a number, or the name of a number / measured variable. With `list`
 *  (v14.3.2: fields that say "a list"), also several numbers separated by commas ("0.5, 1, 2"). */
export function parseNumRef(text, { list = false } = {}) {
  const t = String(text ?? "").trim();
  if (t === "") return { value: null };
  if (/[,;]/.test(t) || (list && /\s/.test(t) && t.split(/\s+/).every(w => isFinite(Number(w))))) {
    if (!list) return { error: "one number or variable here (a list of positions: a number variable with a list, in the sidebar)" };
    const xs = t.split(/[,;\s]+/).filter(Boolean), bad = xs.find(w => !isFinite(Number(w)));
    if (bad !== undefined) return { error: `"${bad}" is not a number (a list takes numbers; for a variable's list type its name alone)` };
    return { value: xs.length === 1 ? Number(xs[0]) : xs.map(Number) };
  }
  const n = t.replace(/^\$/, "");
  if (/^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(n)) {                       // v12.0: a steps tool's value ("steps1.from")
    return outputValues(n) ? { value: "$" + n } : { error: `no steps tool output "${n}" (a steps tool's name, then .from, .to …)` };
  }
  if (validVarName(n) && !isFinite(Number(t))) {
    const v = S.vars[n];
    if (!v && n in VIEW_VARS) return { value: "$" + n };              // v8.12: built in (the part of the plot shown)
    if (!v || v.type === "dataset") return { error: `no number variable "${n}" (make one in the sidebar)` };
    return { value: "$" + n };
  }
  const x = Number(t);
  return isFinite(x) ? { value: x } : { error: `"${t}" is not a number or a variable name` };
}
/** A number field that also takes a variable name ("3" or "rmax"); bound fields are tinted. */
export function numRef(value, onchange, { list = false, ...props } = {}) {
  const inp = el("input", { type: "text", size: 7, ...props, value: isRef(value) ? value.slice(1) : Array.isArray(value) ? value.join(", ") : (value ?? ""),
    class: "numref" + (isRef(value) ? " bound" : ""),
    title: (props.title ? props.title + " · " : "") + "number or variable" + (isRef(value) ? ` (now ${listOf(value).map(fmtVal).join(", ")})` : "") });
  inp.addEventListener("change", () => {
    const r = parseNumRef(inp.value, { list });
    inp.classList.toggle("bad", !!r.error);
    if (r.error) { API.toast(r.error, true); return; }
    onchange(r.value);
  });
  const menu = varPick(inp);
  return menu ? el("span", { class: "numref-wrap" }, inp, menu) : inp;
}
/** v6.4 (human 2026-10-13: "there is option to input number where I can do variable it may be nice to also have a
 *  dropdown for variables"): a small menu beside a number box; picking a variable types its name into the box (as
 *  if typed: the box's own change handler applies it). None when there are no number / measured variables. */
export function varPick(inp, { view = true, title = "use a variable" } = {}) {
  const vars = Object.values(S.vars).filter(v => v.type !== "dataset");
  if (!view && !vars.length) return null;
  return el("select", { class: "varpick", title, onchange: e => {
      const name = e.target.value;
      e.target.value = "";
      if (!name) return;
      inp.value = name; inp.dispatchEvent(new Event("change"));
    } }, el("option", { value: "" }, "▾"),
    vars.map(v => el("option", { value: v.name }, `${v.name} = ${listOf("$" + v.name).map(fmtVal).join(", ")}${v.type === "measured" ? "  (measured)" : v.type === "fit" ? "  (fit, per dataset)" : ""}`)),
    view ? el("optgroup", { label: "the part of the plot shown" }, Object.entries(VIEW_VARS).map(([n, what]) => el("option", { value: n }, `${n}  (${what})`))) : null);
}
/** The same menu beside a typed list ("2, 4, rmax": a map's field-line r_max / contour levels). v8.20, human 2026-11-04:
 *  "when I do r_max field lines it doesn't let me dropdown from variables". Picking a variable replaces the list; the
 *  view variables are left out (a list can't follow them). */
export const listPick = inp => varPick(inp, { view: false, title: "use a variable (replaces the list; type e.g. 2, rmax to mix numbers and variables)" });
/** "fixed / = variable" menu for settings that otherwise use a slider (2D picks, fixed time). onchange("$n" | null). */
export function varBind(value, onchange) {
  const vars = Object.values(S.vars).filter(v => v.type !== "dataset");
  if (!vars.length && !isRef(value)) return null;
  return select([["", "fixed"], ...vars.map(v => ["$" + v.name, `= ${v.name}`])], isRef(value) ? value : "", v => onchange(v || null),
    { title: "follow a number variable instead of a fixed value", class: "varbind" });
}

/** Every line of every 1D panel: [{panel, line, label}] (for measured variables). */
export function allLines() {
  const out = [];
  for (const p of S.panels) {
    if (p.type !== "1d") continue;
    const g = p.link ? S.groups[p.link.group] : null, own = !g || p.link.own.includes("lines");
    for (const l of (own ? p.settings.lines : g.settings.lines) || []) out.push({ panel: p, line: l, label: `${p.name || "1D plot"} · ${lineName(l)}` });
  }
  return out;
}
export function lineName(l) {
  if (l.label) return l.label;
  if (isAn(l)) return `${anDef(l).label} · ${runOf(l.run)}`;                           // analytic line (v7)
  if (typeof l.fn === "string") return `y = ${l.fn}`;                                   // function line (v5.13)
  const src = srcOf(l.run, l.q), picks = Object.entries(l.picks || {}).map(([d, v]) => (v && typeof v === "object" ? `mean over ${d}` : `${d} ${isRef(v) ? "= " + v.slice(1) : "= " + R.fmt(v)}`));
  return [src?.label ?? l.q, runOf(l.run), ...picks].join(" · ");
}
/** The axes a measured mean of a line can run along (v5.16): [[dim | "", label]]; "" = its plot's x axis. */
export function meanAxes(panelId, lineId) {
  const p = S.panels.find(q => q.id === panelId);
  if (!p) return [["", "the plot's x axis"]];
  const s = eff(p), l = (s.lines || []).find(x => x.id === lineId), src = l && !isFn(l) ? srcOf(l.run, l.q) : null, f = src && fitAxis(src, s.xaxis);
  const out = [["", `${f?.dim === "time" ? "t" : axisInfo(s.xaxis).label} (the plot's x axis)`]];
  if (f) for (const d of src.dims) if (d !== f.dim) out.push([d, d === "time" ? "t (time)" : dimCoord(src, d).label || d]);
  return out;
}
const xIsTime = v => { const p = S.panels.find(q => q.id === v.panel); return !!p && eff(p).xaxis === "time"; };
export function measureText(v) {
  const hit = allLines().find(x => x.panel.id === v.panel && x.line.id === v.line);
  const op = (measureOps().find(o => o[0] === v.op) || [0, v.op])[1], rop = READING_OPS.find(o => o.key === v.op);
  const val = x => (isRef(x) ? x.slice(1) : R.fmt(x));
  const axis = v.op === "mean" ? (meanAxes(v.panel, v.line).find(a => a[0] === (v.along ?? "")) || [0, v.along])[1].replace(/ \(the plot's x axis\)$/, "") : "x";
  const cycOp = ["period", "regularity", "ncycles"].includes(v.op);                  // v14.1
  const ranged = (cycOp || ["max", "min", "xmax", "xmin", "cross"].includes(v.op)) && (v.from != null || v.to != null);   // v12.2
  const range = v.op !== "mean" && !ranged ? "" : !v.along && v.over === "shown" ? " over the plot's window"
    : v.from != null || v.to != null ? ` ${v.from != null ? val(v.from) : "start"}–${v.to != null ? val(v.to) : "end"}` : "";
  const where = v.op === "mean" && v.along ? (v.at != null ? ` at x = ${val(v.at)}` : xIsTime(v) ? " now" : " (and over x)") : "";
  const opText = v.op === "mean" ? `mean along ${axis}` : rop?.text ?? op;
  return hit ? `${opText}${v.op === "at" ? " " + (v.at == null ? "now" : val(v.at)) : ""}${v.op === "cross" ? " " + val(v.level ?? 0) : ""}${range}${cycOp ? ` (detrend ${v.detrend || "linear"})` : ""}${where} of ${hit.label}` : "⚠ its line was removed";
}

// ---- creating variables ------------------------------------------------------------------------------------
const formRow = (label, ...ctl) => el("div", { class: "pop-row" }, el("span", { class: "lab" }, label), ...ctl);
function nameInput(type) { return el("input", { type: "text", size: 10, value: newVarName(type) }); }
function checkName(n) {
  if (!validVarName(n)) { API.toast("Variable names: a letter or _, then letters, digits, _ (e.g. A, rmax, peak_t).", true); return false; }
  if (S.vars[n]) { API.toast(`there is already a variable "${n}"`, true); return false; }
  if (nameTaken(n)) { API.toast(`"${n}" is already a steps tool's name; variables and tools never share a name`, true); return false; }   // v12.0.1
  return true;
}
export async function newDatasetVar(run = null) {
  const runs = runNames(), name = nameInput("dataset");
  const lab = el("span", {}), all = el("input", { type: "checkbox", checked: true }), bind = el("label", { class: "chk" }, all, lab);
  // v8.18: tick more datasets for a list (a line that follows it draws one curve per dataset)
  const more = el("div", { class: "np-list" }), picked = new Set();     // (v8.24: under group headings)
  const extra = () => [...picked].filter(r => r !== sel.value);
  const fillMore = () => {
    more.replaceChildren(...groupedRunTicks(r => picked.has(r), (r, on) => { if (on) picked.add(r); else picked.delete(r); fillMore(); },
      runs.filter(r => r !== sel.value)));
    bind.hidden = extra().length > 0;
  };
  const sel = groupedRunSelect(run || runGroups(runs)[0]?.[1][0] || runs[0], v => { lab.textContent = `use it for every plot that now shows ${v}`; fillMore(); });
  lab.textContent = `use it for every plot that now shows ${sel.value}`;
  fillMore();
  if (!(await askForm("New dataset variable", [formRow("name", name), formRow("dataset", sel), bind,
    el("details", {}, el("summary", { title: "a list: a 1D line that follows it draws one curve per dataset, each in its own colour" }, "more datasets (a list)…"), more),
    el("div", { class: "dim" }, "Plots that use it all change when you change it in the sidebar. A list is for 1D lines (one curve per dataset); maps use one dataset.")], "create"))) return;
  const n = name.value.trim();
  if (!checkName(n)) return;
  const xs = extra();
  if (xs.length) {
    S.vars[n] = { name: n, type: "dataset", value: [sel.value, ...xs] };
    setRuns(S.vars[n], S.vars[n].value);
    API.varsChanged(true);
    API.toast(`variable ${n} = ${runsText(S.vars[n], 4)}: pick it as a 1D line's dataset (or “+ dataset”) to draw one curve per dataset`);
    return;
  }
  S.vars[n] = { name: n, type: "dataset", value: sel.value };
  const k = all.checked ? bindRun(sel.value, "$" + n) : 0;
  API.varsChanged(true);
  API.toast(`variable ${n} = ${sel.value}` + (all.checked ? ` · ${k} plot / line setting(s) now follow it` : " · pick it in any dataset menu"));
}
// ---- dataset lists (v8.18, human 2026-11-02: "there are enough times where I have a single line (like my twist energy as
// fn of time) that I want to plot for a list of datasets, its kinda weird how datasets act differently and lists dont work
// for them") -------------------------------------------------------------------------------------------------------
/** Set a dataset variable's datasets: one → a single dataset; several → a list. Each dataset keeps its colour (a new one
 *  gets the first series colour the list doesn't use), so removing one doesn't recolour the others. */
export function setRuns(v, runs) {
  const old = Array.isArray(v.value) ? v.value : [v.value], col = r => { const i = old.indexOf(r); return i >= 0 ? v.colors?.[i] || R.SERIES_COLORS[i % 10] : null; };
  const kept = runs.map(col), used = new Set(kept.filter(Boolean));
  v.colors = kept.map(c => c || (() => { const f = R.SERIES_COLORS.find(x => !used.has(x)) || R.SERIES_COLORS[used.size % 10]; used.add(f); return f; })());
  v.value = runs.length === 1 && !isRef(runs[0]) && !isTagEntry(runs[0]) ? runs[0] : [...runs];   // v11.2: a list of one variable (v11.8: or one tag) stays a list
}
/** A dataset variable's datasets as chips — its colour (every line that follows the list; click to change), its name, ×
 *  — and a menu that adds one (a single dataset becomes a list). changed() after each change. */
export function runListChips(v, changed) {
  const runs = Array.isArray(v.value) ? v.value : [v.value], list = Array.isArray(v.value);
  const set = r => { setRuns(v, r); changed(); };
  // v11.2: an entry can be a dataset variable ("main · rcs-pairs-chen-1"); an entry whose datasets came earlier in the
  // list is drawn once, by the earlier entry: its chip is greyed
  const drawn = new Set(listEntries(v).map(o => o.slot));
  const chips = list ? runs.map((r, k) => el("span", { class: "vcol vrun" + (isRef(r) ? " bound" : "") + (drawn.has(k) ? "" : " dup"),
      title: (isRef(r) ? runRefTip(r) : isTagEntry(r) ? `every dataset tagged ${r.slice(1)} (follows the tag):\n${tagRuns(r.slice(1)).join("\n") || "none now"}` : runTip(r)) + (drawn.has(k) ? "" : "\n\nalready in the list: drawn once, by the entry before") },
    colorButton(v.colors?.[k] || R.SERIES_COLORS[k % 10], c => { v.colors = runs.map((_, i) => v.colors?.[i] || R.SERIES_COLORS[i % 10]); v.colors[k] = c; changed(); }),
    isRef(r) ? `${r.slice(1)} · ${varOf(r) ? runsText(varOf(r)) : "(missing)"}` : isTagEntry(r) ? `${r}  (${tagRuns(r.slice(1)).length})` : r,
    el("button", { class: "vdel", title: `remove ${isRef(r) ? "variable " + r.slice(1) : r} from ${v.name}`, onclick: () => set(runs.filter((_, i) => i !== k)) }, "×"))) : [];
  const rest = runGroups(runNames().filter(r => !runs.includes(r)));             // (v8.24: by group, archived left out)
  // v11.2: one-dataset variables (not this one, not one already listed, not one whose own entries lead back here)
  const vs = Object.values(S.vars).filter(x => x.type === "dataset" && x !== v && !isRunList(x) && !runs.includes("$" + x.name) && !listRefs(x).has(v.name));
  return [...chips, rest.length || vs.length || allTags().length ? el("select", { class: "vline-sel",
    title: "add a dataset: a 1D line that follows this variable draws one curve per dataset\na variable: its dataset, whatever it is set to (a dataset already in the list is drawn once)",
    onchange: e => { const x = e.target.value; if (x) set([...runs, x]); } },
    el("option", { value: "" }, list ? "+ dataset…" : "+ dataset (makes it a list)…"),
    vs.length ? el("optgroup", { label: "variables (follow it)" }, vs.map(x => { const o = el("option", { value: "$" + x.name }, `${x.name} · ${runsText(x)}`); o.title = runRefTip("$" + x.name); return o; })) : null,
    allTags().filter(t => !runs.includes("#" + t)).length ? el("optgroup", { label: "tags (every dataset with it, now and later)" },
      allTags().filter(t => !runs.includes("#" + t)).map(t => { const o = el("option", { value: "#" + t }, `#${t}  (${tagRuns(t).length})`); o.title = tagRuns(t).join("\n"); return o; })) : null,
    rest.map(([g, rs]) => el("optgroup", { label: groupLabel(g, rest) }, rs.map(r => { const o = el("option", { value: r }, cardLabel(r)); o.title = runTip(r); return o; })))) : null];
}
export async function newNumberVar() {
  const name = nameInput("number"), val = el("input", { type: "text", size: 14, value: "3" });
  if (!(await askForm("New number variable", [formRow("name", name), formRow("value", val),
    el("div", { class: "dim" }, "One number, or a list like 3, 5, 8. Use it by typing its name into a number field: a line's r_max (or θ_foot …), a fixed time, a line tool's position, contour levels. A list draws a line once per value (and a tool once per value).")], "create"))) return;
  const n = name.value.trim(), x = parseNumberValue(val.value);
  if (!checkName(n)) return;
  if (x === null) { API.toast("the value must be a number or a list of numbers (3, 5, 8)", true); return; }
  S.vars[n] = { name: n, type: "number", value: x };
  API.varsChanged(false);
  API.toast(`variable ${n} = ${numberText(x)}: type "${n}" into a number field to use it`);
}
// ---- config variables (v7.4, human 2026-10-14: "configs of data as an accessible variable. for instance I want to
// plot an r_max for my datas twist_rmax 1 and 2") ------------------------------------------------------------------
/** The numbers in a dataset's config (as recorded in its manifest): [[name, value]]. */
const numericConf = run => Object.entries(store.runs[runOf(run)]?.conf || {}).filter(([, x]) => typeof x === "number");
/** Dataset choices for a config variable: the datasets, then the dataset variables (it then follows them). */
function datasetChoices(cur = null) {
  const out = [...runNames().map(r => [r, r]), ...Object.values(S.vars).filter(v => v.type === "dataset" && !isRunList(v)).map(v => ["$" + v.name, `${v.name} · ${v.value}`])];
  // v11.2.1: a dataset list (e.g. a fit variable made on a list line) is not in the menu: it stands for its first dataset
  const curLab = () => (isRef(cur) && isRunList(varOf(cur)) ? `${runLabel(cur)} (its first: ${runOf(cur)})` : `${runLabel(cur)} (missing)`);
  return cur && !out.some(o => o[0] === cur) ? [[cur, curLab()], ...out] : out;
}
export async function newConfigVar() {
  const name = nameInput("config"), dv = Object.values(S.vars).find(v => v.type === "dataset");
  let run = dv ? "$" + dv.name : runNames()[0];
  const keysBox = el("div", { class: "np-list" });
  const fill = () => {
    const conf = numericConf(run), pre = PREFS.configVars.filter(k => conf.some(([c]) => c === k)), pick = pre.length ? pre : conf.slice(0, 1).map(c => c[0]);   // v15.0: a plugin's preference
    keysBox.replaceChildren(...(conf.length ? conf.map(([k, x]) => el("label", { class: "chk" }, el("input", { type: "checkbox", value: k, checked: pick.includes(k) }), `${k} = ${R.fmt(x)}`))
      : [el("span", { class: "warn" }, `${runLabel(run)} has no config numbers recorded`)]));
  };
  const sel = select(datasetChoices(run), run, v => { run = v; fill(); });
  fill();
  if (!(await askForm("New config variable", [formRow("name", name), formRow("dataset", sel), formRow("numbers", keysBox),
    el("div", { class: "dim" }, "Numbers from the dataset's config. One ticked: a number; several: a list (e.g. both edges of the twist band): a line tool at it draws one line per value. With a dataset variable (A …) it follows that variable.")], "create"))) return;
  const n = name.value.trim(), keys = [...keysBox.querySelectorAll("input:checked")].map(i => i.value);
  if (!checkName(n)) return;
  if (!keys.length) { API.toast("tick at least one config number", true); return; }
  S.vars[n] = { name: n, type: "config", run, keys };
  API.varsChanged(false);
  API.toast(`variable ${n} = ${configValues(S.vars[n]).map(fmtVal).join(", ")} (${keys.join(", ")} of ${runLabel(run)}): type "${n}" into a number field, or pick it from var ▾`);
}
export async function newMeasuredVar(preset = {}) {
  const lines = allLines();
  if (!lines.length) { API.toast("readings read a line of a 1D plot: add a 1D plot with a line first", true); return; }
  const name = nameInput("measured");
  const which = select(lines.map(x => [`${x.panel.id}:${x.line.id}`, x.label]), preset.panel ? `${preset.panel}:${preset.line}` : "", () => {});
  const op = select(measureOps(), preset.op || "max", () => {});
  const along = el("select", { title: "average along which axis: the plot's x axis, or another axis of the line (e.g. s/s_max)" });
  const fillAlong = () => { const [pid, lid] = which.value.split(":").map(Number); along.replaceChildren(...meanAxes(pid, lid).map(([d, lab]) => el("option", { value: d, selected: d === (preset.along ?? "") }, lab))); };
  // v12.2: x where it crosses a level (a draw tool's crossing line → variable)
  let lev = preset.level ?? 0;
  const levelRow = formRow("crosses", numRef(lev, x => { lev = x ?? 0; }, { size: 6, title: "the value it crosses (the first crossing in the range; a number or variable)" }));
  const alongRow = formRow("along", along), showAlong = () => { alongRow.style.display = op.value === "mean" ? "" : "none"; levelRow.style.display = op.value === "cross" ? "" : "none"; };
  const rv = x => (isRef(x) ? x.slice(1) : R.fmt(x));
  const rangeNote = preset.from != null || preset.to != null
    ? el("div", { class: "dim" }, `over x ${preset.from != null ? rv(preset.from) : "start"}–${preset.to != null ? rv(preset.to) : "end"} (the tool's range)`) : null;
  which.addEventListener("change", fillAlong); op.addEventListener("change", showAlong); fillAlong(); showAlong();
  if (!(await askForm("New reading", [formRow("name", name), formRow("line", which), formRow("measure", op), alongRow, levelRow, rangeNote,
    el("div", { class: "dim" }, "Read off the line, on every dataset that has its quantity: a plot or curve of another dataset uses that dataset's value (▦ in the sidebar lists them; ⏱ if it moves with the slider). Use it by typing its name into a number field, e.g. the position of a line tool (a horizontal line at the max), or a pick." +
      READING_OPS.filter(o => o.help).map(o => " " + o.help).join(""))], "create"))) return;
  const n = name.value.trim();
  if (!checkName(n)) return;
  const [pid, lid] = which.value.split(":").map(Number);
  S.vars[n] = { name: n, type: "measured", panel: pid, line: lid, op: op.value, at: null, along: (op.value === "mean" && along.value) || null,
    over: preset.over ?? "range", from: preset.from ?? null, to: preset.to ?? null, level: op.value === "cross" ? lev : null,
    ...(["period", "regularity", "ncycles"].includes(op.value) ? { detrend: preset.detrend || "linear" } : {}) };   // v14.1
  API.varsChanged(true);
  API.toast(`variable ${n}: ${measureText(S.vars[n])}`);
}

// ---- fit variables (v8.10, human 2026-10-16: "take a measurement of say this k so other things can use it … it saves it
// per dataset so that its easy to plot them with right dataset in other plots") -----------------------------------------
const FIT_MODEL = { poly: "polynomial", power: "power-law", exp: "exponential" };
const fitTools = () => S.panels.filter(p => p.type === "1d").flatMap(p => (eff(p).tools || []).filter(t => t.type === "fit").map(t => ({ p, t })));
/** The fit tool a fit variable reads, while it exists. */
function fitToolOf(v) { const p = S.panels.find(q => q.id === v.panel); return p ? (eff(p).tools || []).find(t => t.id === v.tool && t.type === "fit") || null : null; }
const refText = x => (isRef(x) ? x.slice(1) : R.fmt(x));
/** "τ = −1/k of the exponential fit of twist energy · r_max = 3 (60–200)". */
export function fitText(v) {
  const t = fitToolOf(v), fit = t || v.recipe?.fit, model = fit?.model || "poly";
  const p = S.panels.find(q => q.id === v.panel), l = (p && (eff(p).lines || []).find(x => x.id === v.line)) || v.recipe?.line;
  const par = (fitParams(model, fit?.degree).find(x => x[0] === v.param) || [0, v.param])[1];
  const what = l ? lineName({ ...l, label: null }).replace(` · ${runOf(l.run)}`, "") : "?";
  const range = fit?.over === "shown" ? " (the plot's window)" : fit && (fit.from != null || fit.to != null) ? ` (${fit.from != null ? refText(fit.from) : "start"}–${fit.to != null ? refText(fit.to) : "end"})` : "";
  return `${par} of the ${FIT_MODEL[model]} fit of ${what}${range}` + (t ? "" : " · ⚠ its fit was removed: kept as it was");
}
// v13.0: a measured variable's values per dataset, shown under it when opened (▦)
const OPEN_VALS = new Set();
function readValSpans(v) {
  const vals = readingRuns(v.name);                      // v14.4: results.js
  const picks = o => (o.at?.length > 1 ? o.at.map(a => Object.entries(a?.d || {}).map(([d, x]) => `${d} ${R.fmt(x)}`).join(" ")).join(" | ") : "");
  return vals.length ? vals.map(([r, o]) => el("span", { class: "fval", title: `${v.name} for ${r}${picks(o) ? " · " + picks(o) : ""}` }, `${r} `, el("b", {}, fmtVal(o.val))))
    : [el("span", { class: "dim" }, "computing… (or no dataset with this line's quantity)")];
}
function confValSpans(v) {
  const vals = runNames().map(r => [r, configValues({ ...v, run: r })]).filter(([, x]) => x.some(Number.isFinite));
  return vals.length ? vals.map(([r, x]) => el("span", { class: "fval", title: `${(v.keys || []).join(", ")} of ${r}` }, `${r} `, el("b", {}, fmtVal(x.length > 1 ? x : x[0]))))
    : [el("span", { class: "dim" }, "no dataset has these config numbers")];
}
/** The ▦ button that shows / hides a measured variable's values per dataset. */
function perDatasetToggle(v) {
  const open = OPEN_VALS.has(v.name);
  return el("button", { class: "tog vper" + (open ? " on" : ""), title: open ? "hide the values per dataset" : "show the values per dataset",
    onclick: () => {
      if (open) OPEN_VALS.delete(v.name); else OPEN_VALS.add(v.name);
      if (v.type === "measured") setReadingOpen(v.name, !open);
      renderSidebar();
      if (v.type === "measured" && !open) updateMeasured().then(() => refreshVarValues());   // a ⏱ one: now on every dataset
    } }, "▦");
}
function fitValSpans(v) {
  const vals = fitRuns(v.name);                          // v14.4: results.js
  return vals.length ? vals.map(([r, x]) => el("span", { class: "fval", title: `${v.name} for ${r}` }, `${r} `, el("b", {}, fmtVal(x.val))))
    : [el("span", { class: "dim" }, "no dataset with this line's quantity yet (or still computing)")];
}
export async function newFitVar(preset = {}) {
  const tools = fitTools();
  if (!tools.length) { API.toast("a fit variable reads a fit: add one to a 1D plot first (⚙ → Tools → + tool → fit)", true); return; }
  const key = x => `${x.p.id}:${x.t.id}`, first = tools.find(x => x.p.id === preset.panel && x.t.id === preset.tool) || tools[0];
  const fitSel = select(tools.map(x => [key(x), `${x.p.name || "1D plot"} · ${FIT_MODEL[x.t.model || "poly"]} fit`]), key(first), () => fill());
  const lineSel = el("select"), parSel = el("select"), dsBox = el("span"), name = el("input", { type: "text", size: 10 });
  const lineRow = formRow("line", lineSel);
  let ds = null, named = false;
  name.addEventListener("input", () => { named = true; });
  const uniq = b => { let n = b, i = 2; while (S.vars[n]) n = b + i++; return n; };
  const fill = () => {
    const { p, t } = tools.find(x => key(x) === fitSel.value), lines = (eff(p).lines || []).filter(l => !isFn(l) && (t.line == null || l.id === t.line));
    lineSel.replaceChildren(...lines.map(l => el("option", { value: l.id, selected: l.id === preset.line }, lineName(l))));
    lineRow.style.display = lines.length > 1 ? "" : "none";
    const pars = fitParams(t.model || "poly", t.degree), want = preset.param || (t.model === "exp" ? (t.expShow === "tau" ? "tau" : "k") : pars[0][0]);
    parSel.replaceChildren(...pars.map(([k, lab]) => el("option", { value: k, selected: k === want }, lab)));
    const l = lines.find(x => String(x.id) === lineSel.value) || lines[0];
    ds = l?.run ?? runNames()[0];
    dsBox.replaceChildren(select(datasetChoices(ds), ds, x => { ds = x; }, { title: "used where no plot says which dataset (e.g. the sidebar)" }));
    if (!named) name.value = uniq(parSel.value);
  };
  parSel.addEventListener("change", () => { if (!named) name.value = uniq(parSel.value); });
  fill();
  if (!(await askForm("New fit variable", [formRow("name", name), formRow("fit", fitSel), lineRow, formRow("number", parSel), formRow("default", dsBox),
    el("div", { class: "dim" }, "One value per dataset: the same fit (this line's quantity and picks, the fit's model and x range) on every dataset that has the quantity. In a plot, its name in a number box or {name} in a text is the value for that plot's dataset; in f(x) / f(y) of an axis and in a line's scale, smoothing or slope settings it is each curve's own dataset's (a dataset list: each curve its own fit); in an analytic function you pick the dataset per parameter. It follows later changes of the fit.")], "create"))) return;
  const n = name.value.trim();
  if (!checkName(n)) return;
  const { p, t } = tools.find(x => key(x) === fitSel.value);
  S.vars[n] = { name: n, type: "fit", panel: p.id, tool: t.id, line: Number(lineSel.value), param: parSel.value, run: ds };
  API.varsChanged(true);
  API.toast(`variable ${n}: ${fitText(S.vars[n])} — values per dataset in the sidebar`);
}

// ---- the sidebar --------------------------------------------------------------------------------------------
const usesText = u => (u.panels.length ? `${u.panels.length} plot${u.panels.length > 1 ? "s" : ""}` + (u.lines ? ` · ${u.lines} line${u.lines > 1 ? "s" : ""}` : "") : "unused");
function varRow(v) {
  const u = usesOf(v.name), changed = (rebuild = true) => API.varsChanged(rebuild);
  const name = el("button", { class: `vname ${v.type}`, title: "rename", onclick: async () => {
    const n = await askName(`Rename variable ${v.name} (everything that uses it follows):`, v.name);
    if (!n || n === v.name || !checkName(n)) return;
    renameVar(v.name, n); changed();
  } }, v.name);
  const del = el("button", { class: "vdel", title: "delete (what used it keeps its current value)", onclick: async () => {
    if (!(await askConfirm(`Delete variable ${v.name}? The ${usesText(u)} that use it keep its current value.`, "delete"))) return;
    deleteVar(v.name); changed();
  } }, "×");
  const uses = el("span", { class: "vuses", title: "hover to outline the plots that use it" }, usesText(u));
  const rows = [];
  if (v.type === "dataset") {
    const list = Array.isArray(v.value);
    rows.push(el("div", { class: "vline" }, name, list ? el("span", { class: "listn", title: "list: a 1D line that follows it draws one curve per dataset (a dataset listed twice: once)" }, `×${listEntries(v).length}`)
      : groupedRunSelect(v.value, x => { v.value = x; changed(); }, { class: "vval", title: runTip(v.value) }), uses, del));
    rows.push(el("div", { class: "vsub vcolors" }, runListChips(v, changed)));                 // v8.18
  } else if (v.type === "number") {
    const list = Array.isArray(v.value);
    const inp = el("input", { type: "text", size: list ? 12 : 6, class: "vval" + (list ? " list" : ""), value: numberText(v.value),
      title: "one number, or a list like 3, 5, 8 (a line then draws once per value)",
      onchange: e => { const x = parseNumberValue(e.target.value); if (x !== null) { v.value = x; changed(); } else API.toast("a number or a list of numbers (3, 5, 8), please", true); } });
    const step = d => el("button", { class: "vstep", title: d > 0 ? "+1" : "−1", onclick: () => { v.value = Number(v.value) + d; changed(); } }, d > 0 ? "+" : "−");
    rows.push(el("div", { class: "vline" }, name, inp, list ? el("span", { class: "listn", title: "list: one curve per value" }, `×${v.value.length}`) : [step(-1), step(1)], uses, del));
    // v5.4: one colour per value, used by every line that follows this list (click a swatch to change it)
    if (list) rows.push(el("div", { class: "vsub vcolors" }, v.value.map((x, k) => el("span", { class: "vcol" },
      colorButton(v.colors?.[k] || R.SERIES_COLORS[k % 10], c => { v.colors = [...(v.colors || [])]; v.colors[k] = c; changed(); }), R.fmt(Number(x))))));
  } else if (v.type === "config") {                      // v7.4: numbers from a dataset's config
    const conf = numericConf(v.run), vals = configValues(v), keys = v.keys || [];
    rows.push(el("div", { class: "vline" }, name, el("span", { class: "cval", title: keys.join(", ") }, "= " + vals.map(fmtVal).join(", ")),
      vals.length > 1 ? el("span", { class: "listn", title: "list: one curve / rule per value" }, `×${vals.length}`) : null, perDatasetToggle(v), uses, del));
    rows.push(el("div", { class: "vsub" }, "of", select(datasetChoices(v.run), v.run, x => { v.run = x; changed(); }, { class: "vline-sel", title: "the dataset (or dataset variable) whose config it reads" })));
    if (OPEN_VALS.has(v.name)) rows.push(el("div", { class: "vsub fvals" }, confValSpans(v)));      // v13.0
    rows.push(el("div", { class: "vsub vkeys" }, keys.map(k => el("span", { class: "vkey" }, k,
        el("button", { class: "vdel", title: `remove ${k}`, onclick: () => { v.keys = keys.filter(x => x !== k); changed(); } }, "×"))),
      select([["", "+ number…"], ...conf.filter(([k]) => !keys.includes(k)).map(([k, x]) => [k, `${k} = ${R.fmt(x)}`])], "", x => { if (x) { v.keys = [...keys, x]; changed(); } },
        { class: "vline-sel", title: "add another config number (the variable becomes a list)" })));
    if (vals.length > 1) rows.push(el("div", { class: "vsub vcolors" }, vals.map((x, k) => el("span", { class: "vcol" },
      colorButton(v.colors?.[k] || R.SERIES_COLORS[k % 10], c => { v.colors = [...(v.colors || [])]; v.colors[k] = c; changed(); }), R.fmt(x)))));
  } else if (v.type === "fit") {                         // v8.10: a number of a fit, one value per dataset
    const t = fitToolOf(v), model = (t || v.recipe?.fit)?.model || "poly", degree = (t || v.recipe?.fit)?.degree;
    rows.push(el("div", { class: "vline" }, name, el("span", { class: "fval0", "data-var": v.name, title: `for ${runLabel(v.run)}: where no plot says which dataset` }, "= " + fmtVal(fitValue(v, v.run))), uses, del));
    rows.push(el("div", { class: "vsub vdesc" }, fitText(v)));
    rows.push(el("div", { class: "vsub" }, select(fitParams(model, degree), v.param, x => { v.param = x; changed(); }, { title: "which number of the fit" }),
      "default", select(datasetChoices(v.run), v.run, x => { v.run = x; changed(); }, { class: "vline-sel", title: "the dataset used where no plot says which (the sidebar, a plot with several datasets uses its own)" })));
    rows.push(el("div", { class: "vsub fvals", "data-var": v.name }, fitValSpans(v)));
  } else {
    const live = readingIsLive(v);                       // v13.0: ⏱ moves with the slider
    rows.push(el("div", { class: "vline" }, name, live ? el("span", { class: "vlive", title: "moves with the slider: its line's curve changes with time (x is not time), or it is read now" }, "⏱") : null,
      el("span", { class: "mval", "data-var": v.name, title: "value at the current frame" }, "= " + fmtVal(readingOwn(v.name).val)), perDatasetToggle(v), uses, del));
    const lines = allLines(), key = `${v.panel}:${v.line}`;
    rows.push(el("div", { class: "vsub" }, "of",
      select([...(lines.some(x => `${x.panel.id}:${x.line.id}` === key) ? [] : [[key, "⚠ line removed"]]), ...lines.map(x => [`${x.panel.id}:${x.line.id}`, x.label])], key,
        x => { const [p, l] = x.split(":").map(Number); v.panel = p; v.line = l; changed(); }, { class: "vline-sel" })));
    rows.push(el("div", { class: "vsub" }, select(measureOps(), v.op, x => { v.op = x; changed(); }),
      v.op === "at" ? numRef(v.at, x => { v.at = x; changed(); }, { size: 6, placeholder: "now", title: "x position (empty = the slider's time)" }) : null,
      v.op === "cross" ? numRef(v.level ?? 0, x => { v.level = x ?? 0; changed(); }, { size: 6, title: "the value it crosses (the first crossing in the range)" }) : null));
    if (["period", "regularity", "ncycles"].includes(v.op))              // v14.1: how the period is measured
      rows.push(el("div", { class: "vsub" }, "detrend", select([["linear", "linear fit"], ["mean", "mean"], ["quadratic", "quadratic fit"], ...(String(v.detrend || "").startsWith("running:") ? [[v.detrend, v.detrend]] : [])],
        v.detrend || "linear", x => { v.detrend = x; changed(); }, { title: "the slow trend removed inside the window before the autocorrelation" })));
    if (["max", "min", "xmax", "xmin", "cross", "period", "regularity", "ncycles"].includes(v.op))   // v12.2 / v13.0: over a range of x
      rows.push(el("div", { class: "vsub" }, "x from", numRef(v.from ?? null, x => { v.from = x; changed(); }, { size: 4, placeholder: "start", title: "from (empty = the start of the curve)" }), "–",
        numRef(v.to ?? null, x => { v.to = x; changed(); }, { size: 4, placeholder: "end", title: "to (empty = the end of the curve)" })));
    if (v.op === "mean") {                              // v5.16: along which axis, its range, where to read it (own lines: narrow sidebar)
      rows.push(el("div", { class: "vsub" }, "along", select(meanAxes(v.panel, v.line), v.along ?? "", x => { v.along = x || null; v.from = v.to = null; changed(); },
        { title: "the plot's x axis (a time average on a time axis), or another axis of the line, e.g. s/s_max (then read at the slider's time)" })));
      if (!v.along && v.over === "shown") { v.over = "range"; v.from = "$view_x0"; v.to = "$view_x1"; }   // v8.12: the plot's window = these
      rows.push(el("div", { class: "vsub" }, v.along ? null : "x from",
        [numRef(v.from ?? null, x => { v.from = x; changed(); }, { size: 4, placeholder: "start", title: "from (in that axis' coordinate; empty = the start; view_x0 = the start of the part shown)" }), "–",
          numRef(v.to ?? null, x => { v.to = x; changed(); }, { size: 4, placeholder: "end", title: "to (empty = the end; view_x1 = the end of the part shown)" })],
        v.along ? ["at x", numRef(v.at ?? null, x => { v.at = x; changed(); }, { size: 4, placeholder: xIsTime(v) ? "now" : "mean",
          title: xIsTime(v) ? "read at this x (empty = the slider's time)" : "read at this x (empty = its mean over x)" })] : null));
    }
    if (OPEN_VALS.has(v.name)) rows.push(el("div", { class: "vsub fvals rvals", "data-var": v.name }, readValSpans(v)));   // v13.0
  }
  return el("div", { class: "vrow", onmouseenter: () => API.highlight(u.panels), onmouseleave: () => API.highlight(null) }, rows);
}
// v8 (human 2026-10-14: the expressions / analytic functions boxes "take too much space it would make more sense to be
// part of the side bar"): tabs Variables · Functions · Expressions. The two text boxes live in index.html (#sbstore)
// and are moved in and out, so their text and wiring stay; the sidebar is wider on those tabs.
const SB_TABS = [["vars", "Variables", "set variables (datasets, numbers) and measured variables (configs, fits, readings; ⏱ = moves with the slider)"], ["fns", "Functions", "analytic functions: formulas with {parameters}, shared by every desktop"],
  ["expr", "Expressions", "new quantities computed from stored ones (this desktop)"],
  ["tools", "Tools", "add tools to plots (drag one onto a plot, or click it and then a plot); the tools on each plot"],
  ["tables", "Tables", "tables of points: numbers cast from tools (a fit's or a draw tool's card: → table) or typed, one row per point; plot them"]];   // v14.0
const SB_PANES = { fns: "anxpane", expr: "exprpane" };
// ---- the Outputs tab (v8.32, human 2026-11-09: "can we make it so a tool can define its own "output" as like variables
// and stuff, lets say those get their own tab … so that it doesn't clutter things"; "or maybe even a nice table thing") ----
/** What tells an output's curves apart: the label parts that differ between them (else the picks, "r_max = 3.01").
 *  (D22: exported for the analysis plugin's steps card) */
export function curveNames(curves) {
  const parts = curves.map(c => String(c.label || "").split(" · "));
  const n = Math.max(0, ...parts.map(p => p.length));
  const differ = [...Array(n).keys()].filter(i => new Set(parts.map(p => p[i])).size > 1);
  return parts.map(p => (differ.length ? differ.map(i => p[i]).filter(Boolean) : p.filter(x => x.includes(" = "))).join(" · ") || p.at(-1) || "");
}
// ---- the Tools tab (v12.0, human 2026-11-12: tools "locked in a dropdown inside a dropdown in the bottom of a settings";
// "what if we have like a tool drag that I drag to a plot and that turns on the tool"; "the tool bar would fit in with the
// other tabs like variables"): the tools to add (drag onto a plot, or click and then click a plot), the tools on each plot
// (click: its card). (v12.2: the pinned values that were here are gone) ---------------------------------------------------
function toolsTab() {
  // v12.1 (human 2026-11-12: "folders with every tool visible"): draw · curves · more (collapsed, remembered)
  const types = API.toolTypes?.() || [];
  const btn = ([k, lab, tip, where]) => {
    const b = el("button", { class: "tooltype", draggable: "true", onclick: () => API.armTool?.(k),
      title: `${lab}  ·  ${API.toolWhere?.(where) ?? where}\n${tip}\n\nDrag it onto a plot, or click it and then click a plot (Esc: cancel).` }, lab);
    b.addEventListener("dragstart", e => { e.dataTransfer.setData("application/x-aptvis-tool", k); e.dataTransfer.effectAllowed = "copy"; API.toolDrag?.(k); });
    b.addEventListener("dragend", () => API.toolDrag?.(null));
    return b;
  };
  const pal = (API.toolFolders?.() || []).map(([f, flab]) => {
    const items = el("div", { class: "toolpal" }, types.filter(x => x[4] === f).map(btn));
    if (f !== "more") return el("div", { class: "toolfold" }, el("div", { class: "toolfoldlab" }, flab), items);
    let open = false;
    try { open = localStorage.getItem("aptvis.toolsMore") === "1"; } catch { /* no storage: closed */ }
    const d = el("details", { class: "toolfold", open }, el("summary", { class: "toolfoldlab", title: "the less used tools" }, flab), items);
    d.addEventListener("toggle", () => { try { localStorage.setItem("aptvis.toolsMore", d.open ? "1" : "0"); } catch { /* skip */ } });
    return d;
  });
  const used = API.toolsInUse?.() || [];
  const rows = used.flatMap(({ panel, name, tools }) => [
    el("div", { class: "vline toolplot", onmouseenter: () => API.highlight([panel.id]), onmouseleave: () => API.highlight(null) }, el("b", {}, name), el("span", { class: "dim" }, ` · ${tools.length}`)),
    ...tools.map(({ t, text }) => el("div", { class: "vsub toolrow" + (t.visible ? "" : " off") },
      el("button", { class: "linkish", title: "open its card", onclick: ev => API.editTool?.(panel.id, t.id, ev) }, text)))]);
  // v12.1.1 (human 2026-11-12: "the on the plots section isnt necessary maybe ... a default collapsed section ... each plot
  // already says what it is"): last, collapsed unless opened (remembered)
  let onOpen = false;
  try { onOpen = localStorage.getItem("aptvis.toolsOnPlots") === "1"; } catch { /* no storage: closed */ }
  const n = used.reduce((k, x) => k + x.tools.length, 0);
  const onPlots = el("details", { class: "sbfold", open: onOpen },
    el("summary", { class: "sbsec", title: "every plot's tools; click one to open its card (each plot's 🛠 lists its own)" }, `on the plots (${n})`),
    ...(rows.length ? rows : [el("div", { class: "dim vsub" }, "no tools yet")]));
  onPlots.addEventListener("toggle", () => { try { localStorage.setItem("aptvis.toolsOnPlots", onPlots.open ? "1" : "0"); } catch { /* skip */ } });
  return [el("div", { class: "sbsec", title: "drag one onto a plot, or click it and then click a plot" }, "add to a plot"), ...pal, onPlots];
}
// (v12.2: what a steps tool found is shown in its card; D22: that card is the analysis plugin's, plugins/analysis/steps.js)
const OUTPUT_ACTIONS = [];
/** v15.0 (plugins.js): a button a plugin adds to a named tool's output card: {kind (e.g. "steps"), label, title, run(name)}. */
export function registerOutputAction(a) {
  for (const f of ["kind", "label", "run"]) if (!(f in (a || {}))) throw new Error(`missing ${f}`);
  if (typeof a.run !== "function") throw new Error("run is not a function");
  OUTPUT_ACTIONS.push(a);
}
/** D22: the buttons plugins added for an output kind; the card that shows such an output (the analysis plugin's steps
 *  card, plugins/analysis/steps.js) puts them in its first row. */
export const outputActions = kind => OUTPUT_ACTIONS.filter(a => a.kind === kind);
export function renderSidebar() {
  const box = document.getElementById("sidebar"), park = document.getElementById("sbstore");
  if (!box) return;
  for (const id of Object.values(SB_PANES)) { const p = document.getElementById(id); if (p && park && p.parentElement !== park) park.append(p); }
  const open = localStorage.getItem("aptvis.sidebar") !== "closed";
  let tab = localStorage.getItem("aptvis.sbtab") || "vars";
  if (tab === "outs") tab = "tools";                                             // v12.0: Outputs became Tools
  if (!SB_TABS.some(([k]) => k === tab)) tab = "vars";
  const wide = false;                                   // v8.4: the width is dragged (#sbgrip), the same for every tab
  if (document.body.classList.contains("sb-open") !== open || document.body.classList.contains("sb-wide") !== wide) {
    document.body.classList.toggle("sb-open", open); document.body.classList.toggle("sb-wide", wide); API.relayout?.();
  }
  const setOpen = o => { localStorage.setItem("aptvis.sidebar", o ? "open" : "closed"); renderSidebar(); };
  if (!open) { box.replaceChildren(el("button", { class: "sbtab", title: "show the sidebar (variables, functions, expressions)", onclick: () => setOpen(true) }, "variables · functions ›")); return; }
  const head = el("div", { class: "sbhead" },
    el("div", { class: "sbtabs" }, SB_TABS.map(([k, lab, tip]) => el("button", { class: k === tab ? "on" : "", title: tip,
      onclick: () => { localStorage.setItem("aptvis.sbtab", k); renderSidebar(); } }, lab))),
    el("span", { class: "sp" }), el("button", { title: "hide the sidebar", onclick: () => setOpen(false) }, "‹"));
  if (tab === "tools") { box.replaceChildren(head, ...toolsTab()); return; }      // v12.0 (was Outputs, v8.32)
  if (tab === "tables") { box.replaceChildren(head, ...tablesTab()); return; }    // v14.0
  if (tab !== "vars") { box.replaceChildren(head, document.getElementById(SB_PANES[tab])); return; }
  const vars = Object.values(S.vars || {}), of = t => vars.filter(v => v.type === t).map(varRow);
  box.replaceChildren(
    head,
    el("div", { class: "sbgroup", title: "what you choose to look at" }, "set variables"),         // v13.0
    el("div", { class: "sbsec", title: "pick one in any dataset menu (panel header, line editor, + line)" }, "datasets"), ...of("dataset"),
    el("button", { class: "sbadd", onclick: () => newDatasetVar() }, "+ dataset variable"),
    el("div", { class: "sbsec", title: "type the name into a number field" }, "numbers"), ...of("number"),
    el("button", { class: "sbadd", onclick: () => newNumberVar() }, "+ number variable"),
    el("div", { class: "sbgroup", title: "read off the data: one value per dataset (▦ shows them); ⏱ = moves with the slider" }, "measured variables"),
    el("div", { class: "sbsec", title: "numbers from a dataset's config (twist band edges, Bp …); type the name into a number field" }, "configs"), ...of("config"),
    el("button", { class: "sbadd", onclick: () => newConfigVar() }, "+ config variable"),
    el("div", { class: "sbsec", title: "a number of a fit (k, τ, A, R²), one value per dataset; in a plot its name is that plot's dataset's value" }, "fits"), ...of("fit"),
    el("button", { class: "sbadd", title: "or → variable in a fit tool", onclick: () => newFitVar() }, "+ fit variable"),
    el("div", { class: "sbsec", title: "read off a 1D line (max, mean, a crossing …), one value per dataset that has its quantity; in a plot or curve its name is that dataset's value; ⏱ = moves with the slider" }, "readings"), ...of("measured"),
    el("button", { class: "sbadd", title: "or → variable in a draw tool (a line at each curve's mean …)", onclick: () => newMeasuredVar() }, "+ reading"));
}
/** Update the shown values of measured variables (after each frame). */
export function refreshVarValues() {
  for (const s of document.querySelectorAll("#sidebar .mval")) {
    const { val, err } = readingOwn(s.dataset.var);                  // v8.27: why there is no value (e.g. Ψ not cached)
    s.textContent = "= " + fmtVal(val) + (err ? " ⚠" : "");
    s.title = err || "value at the current frame";
  }
  for (const s of document.querySelectorAll("#sidebar .fval0")) { const v = S.vars[s.dataset.var]; if (v) s.textContent = "= " + fmtVal(fitValue(v, v.run)); }
  for (const s of document.querySelectorAll("#sidebar .fvals:not(.rvals)")) { const v = S.vars[s.dataset.var]; if (v?.type === "fit") s.replaceChildren(...fitValSpans(v)); }
  for (const s of document.querySelectorAll("#sidebar .rvals")) { const v = S.vars[s.dataset.var]; if (v) s.replaceChildren(...readValSpans(v)); }   // v13.0
}


/** v8.9.6 (human 2026-10-15: "clicking on a label or whatnot I should be able to affect fontsize"): this plot's size of
 *  one kind of text — "Aa" + a number box (px; a number or a variable); empty = the desktop's size (🎨 style). */
const FONT_WHAT = { title: "title", label: "axis labels (x and y)", tick: "axis numbers", legend: "legend", info: "fit text", cbar: "colour-bar label", cbarTick: "colour-bar numbers" };
export function fontSize(ctx, key, after = () => ctx.done(), label = "Aa") {
  const cur = (ctx.get("fonts") || {})[key] ?? null, desk = styleNow()[key];
  return el("span", { class: "fontsz", title: `${FONT_WHAT[key]}: text size in this plot (px) · empty = the desktop's ${desk} (🎨 style)` },
    el("span", { class: "fontsz-a" }, label),
    numRef(cur, v => {
      const f = { ...(ctx.get("fonts") || {}) };
      if (v === null) delete f[key]; else f[key] = v;
      ctx.set("fonts", Object.keys(f).length ? f : null); after();
    }, { size: 3, placeholder: String(desk) }));
}
