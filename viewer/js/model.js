// model.js — what a desktop, panel, link group, layer and tool are, and how linked settings work (v3).
//
//   desktop = { panels: [panel], groups: {id: group}, t, fps, loop, expressions }   (views/desktops/)
//   panel   = { id, type: "2d" | "1d", name, title, width, settings, link, template }  (inside desktops; templates: views/templates/)
//   link    = null | { group: id, own: [keys] }   a linked panel reads every setting from its group,
//             except its "own" keys (human 2026-10-01: linked panels replace subpanels — you see which
//             settings are shared and can make any of them the panel's own, or share it again)
//   group   = { id, type, color, settings }       the shared values
//   line    = (1D) { id, run, q, picks: {dim: value in the dim's own coordinate}, pickAs: {dim: coord shown},
//                    timeMode: "follow"|"fixed", fixedTime, label, color, dash, width, visible }
//             A 1D panel has an x axis (a coordinate: time, r_max, θ_foot, r, …) and a y axis (a *kind*:
//             "twist angle", "current", "energy", …); its lines are any datatypes with both (human 2026-10-01).
//   tool    = { id, type: "now" | "line" | "contour", ... }   see newTool()
//   vars    = { name: variable }   named values in the sidebar (v5); a setting holds "$name" instead of a value
import * as R from "./render.js";
import { compileAnalytic } from "./data.js";
import { cacheables, ghostRuns, MARK } from "./cacheable.js";
import { putResult, getResult, getResultOrLast, resultScopes, resultOwners, dropResult, renameResult, valueAt, findAt } from "./results.js";   // v14.4

// ---- one desktop schema (v14.4, architecture review §5.7, P9) ----------------------------------------------------
// Every field of the state S, once. Save, open, undo, "new empty desktop", "example desktop", "restore previous" and
// startup all read this list (app.js); tools/check.mjs fails if code uses an S field missing here. Per field:
//   empty    its value in a new empty desktop
//   file     true: written to a saved desktop and read back; "old": only read (a field older desktops have)
//   undo     part of an undo step
//   player   the time slider / playback / id counter: kept by "new empty desktop"
//   missing  opening a desktop saved without it: "keep" the current value (default: empty); a function of the file
export const DESKTOP_SCHEMA = {
  panels:      { empty: () => [], file: true, undo: true },
  groups:      { empty: () => ({}), file: true, undo: true },
  vars:        { empty: () => ({}), file: true, undo: true },
  tables:      { empty: () => ({}), file: true, undo: true },
  style:       { empty: () => ({}), file: true, undo: true },
  trange:      { empty: () => ({}), file: true, undo: true },
  expressions: { empty: () => "", file: true, undo: true, missing: "keep" },             // desktops from before expressions
  exprNotes:   { empty: () => ({}), file: true, undo: true, missing: d => (d.expressions != null ? "empty" : "keep") },   // v14.3.2
  analytics:   { empty: () => "", file: "old", undo: true },                              // v7 per-desktop functions: joined to the library on open
  desktopName: { empty: () => null, undo: true },
  t:           { empty: () => null, file: true, player: true, missing: "keep" },
  fps:         { empty: () => 8, file: true, player: true, missing: "keep" },
  loop:        { empty: () => true, file: true, player: true, missing: "keep" },
  nextId:      { empty: () => 1, file: true, player: true },                              // read by bumpNextId on open
  version:     { empty: () => 5, player: true },
};
export const desktopFields = pred => Object.entries(DESKTOP_SCHEMA).filter(([, f]) => pred(f)).map(([k]) => k);
export const S = Object.fromEntries(Object.entries(DESKTOP_SCHEMA).map(([k, f]) => [k, f.empty()]));
export let store = null;
export function setStore(s) { store = s; }
export const newId = () => S.nextId++;
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

export const srcOf = (run, q) => store.runs[runOf(run)]?.source(q);
export const firstRun = () => Object.keys(store.runs)[0];
export const runNames = () => Object.keys(store.runs).sort();      // menus: alphabetical, not load order

// ---- variables (v5, human 2026-10-05): named values in the sidebar that settings point at --------------------
//   dataset  {name, type: "dataset", value: run}                 a panel's / line's dataset; value may be a LIST of
//            runs (v8.18): a 1D line that follows it draws one curve per dataset, in the list's colours (colors[k]);
//            where one dataset is needed the first is used. Not offered for 2D maps or analytic parameters.
//   number   {name, type: "number", value}                       picks (r_max …), fixed time, tool positions, levels;
//            value may be a LIST [3, 5, 8] (v5.3): a line's pick draws one curve per value, a tool one rule per
//            value, levels take all values; where one number is needed the first value is used
//   measured {name, type: "measured", panel, line, op, at}       read off a 1D line every frame (max, x at max, …)
//   fit      {name, type: "fit", panel, tool, line, param, run, recipe}   a number of a fit tool's fit, one per dataset (v8.10)
// A setting that follows a variable stores the string "$name". Links share the look; variables share data choices.
export const isRef = v => typeof v === "string" && v[0] === "$";
export const varOf = v => (isRef(v) ? S.vars?.[v.slice(1)] || null : null);
// v14.4 (architecture review §5.4, P2): every measured value lives in results.js, one store keyed (owner, scope):
//   "reading:<name>" / "own"           a reading's own line: {val, at, ref, err} (val: one value, or one per curve of a
//                                       line that follows a list; at: where each was read, [{run, d}]; ref: that list
//                                       ("$rmaxs"), for its colours; err: why there is no value)
//   "reading:<name>" / "run:<dataset>"  v13.0: the same reading on another dataset, {val, at}
//   "fit:<name>"     / "run:<dataset>"  a fit variable on one dataset, {val, at}
//   "output:<name>"  / "own"            a named tool's output
//   "tool:<id>"      / <plot id>         a tool's values at its last draw on that plot (its card)
// Before v14.4: MEASURED, MEASURED_AT, MEASURED_REF, MEASURE_ERR, READVALS, FITVALS, OUTPUTS and TOOL_VALUES.
/** A reading's own line: {val, at, ref, err} ({} before it is measured). */
export const readingOwn = name => getResult(`reading:${name}`, "own") ?? {};
/** A reading's values on other datasets: [[dataset, {val, at}]]. */
export const readingRuns = name => resultScopes(`reading:${name}`).filter(([k]) => k.startsWith("run:")).map(([k, o]) => [k.slice(4), o]);
/** A fit variable's values: [[dataset, {val, at}]]. */
export const fitRuns = name => resultScopes(`fit:${name}`).map(([k, o]) => [k.slice(4), o]);
const readingRun = (name, run) => getResult(`reading:${name}`, `run:${run}`);
const fitRun = (name, run) => getResult(`fit:${name}`, `run:${run}`);
/** v13.0: a reading's value(s) where it is read: a plot of a dataset its own line does not show takes that dataset's
 *  (results "run:<dataset>"); otherwise its own line's ("own"), as before. */
function readingFor(name) {
  const r = runOf(RUN_CTX), { at: own, val: all } = readingOwn(name);
  if (r && own && !own.some(w => w?.run === r)) { const o = readingRun(name, r); if (o) return o.val; }
  // v14.3.2 (P3, step 2: the same dataset): its own line follows a dataset list, so only this dataset's values (it
  // returned the whole list, and a single number then took the first dataset's)
  if (r && own && own.some(w => w?.run && w.run !== r)) {
    const list = Array.isArray(all) ? all : [all], mine = list.filter((_, k) => own[k]?.run === r);
    return mine.length === 1 ? mine[0] : mine;
  }
  return all;
}
/** Measured variable `name` for the curve at `at` ({run, d}): its value read at the same dataset and picks; NaN if it
 *  has none there; undefined if the variable is not per curve (one value for every curve: numOf). Per curve: a variable
 *  with one value per curve (its line follows a list), and a plugin's reading that says perCurve (a field-line length).
 *  v11.2.1 (human 2026-11-11: "one fit tool … set to my datalist where I plot the datas"): a fit variable is the value
 *  of the curve's own dataset (NaN if that dataset has none), so f(y) = y/(A*exp(-x/tau)) divides each curve of a
 *  dataset list by its own fit. */
export function curveValue(name, at) {
  const x = S.vars?.[name];
  if (x?.type === "fit") {
    if (!at?.run) return undefined;
    const o = fitRun(name, runOf(at.run));
    if (!o) return NaN;
    // v14.3.2: a line that follows a list (r_max …) has one fit per curve: this curve's (it took the first one's)
    return Array.isArray(o.val) ? (o.at ? valueAt(o.val, o.at, at) : o.val[0] ?? NaN) : o.val ?? NaN;
  }
  if (x?.type !== "measured" || !at) return undefined;
  const { val: vals, at: where } = readingOwn(name), r = at.run ? runOf(at.run) : null;
  // v13.0: a curve of a dataset the reading's own line does not show takes that dataset's reading (NaN if it has none)
  if (r && where && !where.some(w => w?.run === r)) { const o = readingRun(name, r); return o?.at ? valueAt(o.val, o.at, at) : NaN; }
  if (!(Array.isArray(vals) || READING_OPS.some(o => o.key === x.op && o.perCurve)) || !where) return undefined;
  return valueAt(vals, where, at);
}
/** v15.1 (DECISIONS D20): reading operations a plugin adds (measure.js registerReadingOp; aperture4: the line length):
 *  {key, label, value(curve), text?, help?, missing?, perCurve?} — value reads the number off a curve as lineCurve made
 *  it; perCurve: one value per curve always (where a setting uses it, each curve uses its own). */
export const READING_OPS = [];
// ---- tool outputs (v8.32) ----------------------------------------------------------------------------------------
// Human 2026-11-09: "can we make it so a tool can define its own "output" as like variables and stuff, lets say those get
// their own tab with variables functions expressions so that it doesn't clutter things". A named tool publishes what it
// computed at the current frame: result "output:<name>" = {kind, panel, toolId, x, xlabel, curves: [{at, label, sigma, steps}]}.
// Other plots use it (+ tool → steps from an output: each curve gets its own field line's steps), number fields read a
// field as "$name.field" (all curves' values, one list), and the sidebar's Outputs tab shows it as a table.
/** v14.4: the names of the tool outputs computed so far, and one's removal (results.js). */
export const outputNames = () => resultOwners("output:");
export const dropOutput = name => dropResult(`output:${name}`);
export const putOutput = (name, out) => putResult(`output:${name}`, "own", out);
/** v15.4 (DECISIONS D22): the kinds of output a named tool can publish (the analysis plugin's steps tool: "steps"):
 *  kind -> {field: what it is}. Filled by registerOutputKind; "$name.field" reads OUTPUT_KINDS[kind].values(curve, field)
 *  of every curve of the output. */
export const OUTPUT_FIELDS = {};
const OUTPUT_KINDS = {};
/** v15.4 (plugins.js): a kind of tool output: {kind, fields: {field: what it is}, values(curve, field) -> [numbers]}
 *  (curve = one entry of the output's curves). A kind that exists is refused. */
export function registerOutputKind(k) {
  for (const f of ["kind", "fields", "values"]) if (!(f in (k || {}))) throw new Error(`missing ${f}`);
  if (typeof k.values !== "function") throw new Error("values is not a function");
  if (!k.fields || typeof k.fields !== "object") throw new Error("fields is not an object");
  if (OUTPUT_KINDS[k.kind]) throw new Error(`there is already an output kind "${k.kind}"`);
  OUTPUT_KINDS[k.kind] = k; OUTPUT_FIELDS[k.kind] = { ...k.fields };
}
/** Every tool on the desktop that has a name: [{p, t}] (a plot's own tools and the shared ones). */
export function namedTools() {
  const out = [], seen = new Set();
  for (const p of S.panels) for (const t of [...(p.settings?.tools || []), ...(p.settings?.ownTools || []), ...(groupOf(p)?.settings?.tools || [])])
    if (t?.name && !seen.has(t)) { seen.add(t); out.push({ p, t }); }
  return out;
}
/** A name for a new tool ("steps1", "steps2" …) that no tool or variable has. */
export function freeToolName(stem) {
  for (let i = 1; ; i++) if (!nameTaken(stem + i)) return stem + i;
}
/** The output of tool `name` if that tool still exists, else null. */
export function liveOutput(name) {
  const o = getResult(`output:${name}`, "own");
  return o && namedTools().some(x => x.t.name === name) ? o : null;
}
/** One curve's values of an output's field: a list (its kind's, registerOutputKind). */
function fieldOf(kind, c, field) {
  return OUTPUT_KINDS[kind]?.values(c, field) ?? [];
}
/** "$steps1.from" (without the $): every curve's values of that field, one list; null if it is not a live output. */
export function outputValues(ref) {
  const i = String(ref).lastIndexOf(".");
  if (i < 0) return null;
  const o = liveOutput(ref.slice(0, i)), field = ref.slice(i + 1);
  if (!o || !OUTPUT_FIELDS[o.kind]?.[field]) return null;
  return o.curves.flatMap(c => fieldOf(o.kind, c, field));
}
/** The entry of output `o` for the curve read at `at` ({run, d}): the same dataset and picks (its r_max …), or null. */
export function outputCurve(o, at) {
  return o ? findAt(o.curves, at) : null;               // v14.4: the one "same dataset and picks" (results.js)
}
/** Rename tool output `old` to `nw` everywhere it is used ("$old.field" in number fields, steps-from tools). */
export function renameOutput(old, nw) {
  const re = new RegExp(`\\$${old}\\.`, "g");
  walkValues((o, k) => {
    if (typeof o[k] !== "string") return;
    if (k === "source" && o[k] === old) o[k] = nw;
    else if (o[k].includes("$" + old + ".")) o[k] = o[k].replace(re, () => "$" + nw + ".");
  });
  renameResult(`output:${old}`, `output:${nw}`);
}
// v8.10 (human 2026-10-16: "take a measurement of say this k so other things can use it … it saves it per dataset so
// that its easy to plot them with right dataset in other plots"): a fit variable's values, name -> Map(run -> value, or
// a list for a line that follows a list), computed in measure.js for every dataset that has the line's quantity.
// Where one is read, the dataset is the context (a plot: its own dataset; an analytic parameter: its dataset menu),
// else the variable's own `run`.
let RUN_CTX = null;
/** The dataset fit variables are read for, until set again; returns the previous one (to put back). */
export function setRunContext(r) { const old = RUN_CTX; RUN_CTX = r ?? null; return old; }
// v8.12 (human 2026-10-20: "I guess there can be a general variable that is the visible range? I assume that is simple
// stored when zooming"): view_x0, view_x1, view_y0, view_y1 = the part of a plot shown (its pan & zoom). Built in, in every
// plot: set while a plot is drawn (VIEW_CTX), so a tool or fit bound to them follows the zoom.
export const VIEW_VARS = { view_x0: "start of the x range shown", view_x1: "end of the x range shown", view_y0: "bottom of the y range shown", view_y1: "top of the y range shown" };
let VIEW_CTX = null;
export function setViewContext(v) { const old = VIEW_CTX; VIEW_CTX = v ?? null; return old; }
const viewVar = n => (n in VIEW_VARS && VIEW_CTX ? VIEW_CTX[n.slice(5)] : undefined);
export function fitValue(x, run = null) { const v = fitRun(x.name, runOf(run ?? RUN_CTX ?? x.run))?.val; return v ?? NaN; }   // {val, at} per dataset (results.js)
export const validVarName = n => /^[A-Za-z_]\w*$/.test(n);
/** v12.0.1 (human 2026-11-12: "I will want the tool name vs variables so its not confusing"): a name a variable, a named
 *  (steps) tool or a built-in (view_x0 …) already has. Variables and tools never share a name. */
export const nameTaken = n => !!S.vars?.[n] || n in VIEW_VARS || namedTools().some(x => x.t.name === n);
/** The run a dataset setting means ("baseline-19", or "$A" -> A's value). */
export function runOf(v) {
  if (!isRef(v)) return v;
  const x = varOf(v);
  return x && x.type === "dataset" ? (listEntries(x)[0]?.run ?? null) : null;
}
/** Every run a dataset setting means: [run], or the runs of a dataset list (v8.18); [] if none. */
export function runsOf(v) {
  if (!isRef(v)) return v === null || v === undefined ? [] : [v];
  const x = varOf(v);
  return x && x.type === "dataset" ? listEntries(x).map(o => o.run) : [];
}
/** Is this a dataset variable holding a list (v8.18)? (A variable or its "$name".) */
export const isRunList = v => { const x = typeof v === "string" ? (isRef(v) ? varOf(v) : null) : v; return x?.type === "dataset" && Array.isArray(x.value); };
/** v11.2 (human 2026-11-11: "a main dataset for looking at just one at a time … other things like energy I may plot
 *  multiple … be able to add a variable to the list (if there are duplicates in the list then it still works to add but
 *  it is treated as the list with no duplicates)"): a dataset list's entries are datasets or "$name", a dataset variable
 *  (its dataset, or its datasets if it is a list itself). The datasets the list means, in order, each once (the first
 *  entry that gives one wins): [{run, slot, color, owner, oslot, via}]. slot = the entry of this list; color = that
 *  entry's colour (a variable that is a list keeps its own colours: owner.colors[oslot]); via = the variable it came
 *  through. A variable that leads back to itself is skipped. */
/** v11.8 (human 2026-11-12: "a secondary folder setup … that I can link datasets that have similar phenomena"): a
 *  dataset list's entry "#tag" stands for every dataset with that tag (the data manager's cards; archived ones left out),
 *  in name order: tag a run on the data manager page and every list following the tag has it. */
export const isTagEntry = e => typeof e === "string" && e[0] === "#";
export const tagRuns = tag => Object.keys(store?.runs || {}).filter(r => (store.cards?.[r]?.tags || []).includes(tag) && !store.cards?.[r]?.archived).sort();
export const allTags = () => [...new Set(Object.entries(store?.cards || {}).filter(([r, c]) => !c?.archived && store.runs[r]).flatMap(([, c]) => c?.tags || []))].sort();
/** v14.5 (RULES P4: a list owns its colours): the colour dataset `run` has in the dataset lists (the first list that
 *  holds it), or null. Table points grouped by dataset use it, so a dataset looks the same in every plot. */
export function datasetColor(run) {
  for (const v of Object.values(S.vars || {})) if (v.type === "dataset" && Array.isArray(v.value)) { const e = listEntries(v).find(o => o.run === run); if (e) return e.color; }
  return null;
}
export function listEntries(x, seen = []) {
  if (x?.type !== "dataset" || seen.includes(x.name)) return [];
  const vals = Array.isArray(x.value) ? x.value : [x.value], out = [], have = new Set();
  vals.forEach((e, slot) => {
    const own = { color: x.colors?.[slot] || R.SERIES_COLORS[slot % 10], owner: x, oslot: slot };
    let sub = isRef(e) ? listEntries(varOf(e), [...seen, x.name])
      : isTagEntry(e) ? tagRuns(e.slice(1)).map((r, k) => ({ run: r, color: k ? R.SERIES_COLORS[(slot + k) % 10] : own.color, owner: x, oslot: slot, via: e }))
      : e ? [{ run: e, ...own }] : [];
    if (isRef(e) && sub.length === 1) sub = [{ run: sub[0].run, ...own }];        // a one-dataset variable: this entry's colour
    for (const o of sub) if (o.run && !have.has(o.run)) { have.add(o.run); out.push({ ...o, slot, via: isRef(e) ? e.slice(1) : o.via ?? null }); }
  });
  return out;
}
/** The variables a dataset list's entries name, through lists in lists (v11.2). */
export function listRefs(x, seen = []) {
  const out = new Set();
  if (x?.type !== "dataset" || seen.includes(x.name)) return out;
  for (const e of Array.isArray(x.value) ? x.value : [x.value]) {
    if (!isRef(e)) continue;
    out.add(e.slice(1));
    for (const m of listRefs(varOf(e), [...seen, x.name])) out.add(m);
  }
  return out;
}
/** A dataset variable's value as text: "baseline-19", or a list "baseline-18, baseline-19 +2" (short: at most `n` named). */
export const runsText = (v, n = 2) => { const r = listEntries(v).map(o => o.run); return r.length > n ? `${r.slice(0, n).join(", ")} +${r.length - n}` : r.join(", "); };
export const runLabel = v => { const x = varOf(v); return isRef(v) ? `${v.slice(1)} · ${x?.type === "dataset" ? runsText(x) : "?"}` : String(v ?? ""); };
/** The number a number setting means (a number, or "$n" -> a number / measured variable; a list -> its first). */
export function numOf(v) {
  if (Array.isArray(v)) return Number(v[0] ?? NaN);      // v14.3.2: a typed list ("0.5, 1, 2"): its first value
  if (!isRef(v)) return v;
  const x = varOf(v);
  if (!x) { const o = outputValues(v.slice(1)); if (o) return o[0] ?? NaN; }   // v8.32: "$steps1.from" (a tool's output)
  if (!x) return viewVar(v.slice(1)) ?? NaN;            // v8.12: view_x0 … (built in)
  if (x.type === "number") return Number(Array.isArray(x.value) ? x.value[0] : x.value);
  if (x.type === "measured") { const m = readingFor(x.name); return Array.isArray(m) ? m[0] ?? NaN : m ?? NaN; }   // v13.0: the plot's dataset
  if (x.type === "config") return configValues(x)[0] ?? NaN;
  if (x.type === "fit") { const f = fitValue(x); return Array.isArray(f) ? f[0] ?? NaN : f; }
  return NaN;
}
/** A config variable's numbers (v7.4, human 2026-10-14: "configs of data as an accessible variable … plot an r_max
 *  for my datas twist_rmax 1 and 2"): {type: "config", run: a dataset or "$A", keys: [config names]} → the dataset's
 *  config values, in order (one key: one number; several: a list, e.g. both edges of the twist band). */
export function configValues(x) {
  const conf = store.runs[runOf(x.run)]?.conf || {};
  return (x.keys || []).map(k => (typeof conf[k] === "number" ? conf[k] : NaN));
}
/** All numbers a setting means: [v], or every value of a list variable (v5.3). */
export function listOf(v) {
  if (v === null || v === undefined || v === "") return [];
  if (Array.isArray(v)) return v.map(Number).filter(isFinite);   // v14.3.2: a typed list ("0.5, 1, 2")
  if (!isRef(v)) return [Number(v)];
  const x = varOf(v);
  if (!x) { const o = outputValues(v.slice(1)); if (o) return o; }   // v8.32: a tool's output field: every curve's values
  if (x?.type === "number" && Array.isArray(x.value)) return x.value.map(Number);
  if (x?.type === "measured" && Array.isArray(readingFor(x.name))) return [...readingFor(x.name)];   // one per curve (v5.15; v13.0: the plot's dataset)
  if (x?.type === "config") return configValues(x);                                                     // v7.4
  if (x?.type === "fit") { const f = fitValue(x); return Array.isArray(f) ? [...f] : [f]; }              // v8.10
  return [numOf(v)];
}
/** The colour of value k of a list variable: its own colour list, else the series colours in order (v5.4). */
export function listColor(v, k) {
  if (v?.type === "measured") { const r = readingOwn(v.name).ref; return listColor(r ? varOf(r) : null, k); }   // the line's list (v5.15)
  if (v?.type === "dataset" && Array.isArray(v.value)) return listEntries(v)[k]?.color || R.SERIES_COLORS[k % 10];   // v11.2: k-th drawn
  return v?.colors?.[k] || R.SERIES_COLORS[k % 10];
}
/** A line tool's rules: [[value, colour]]; a list-valued tool draws one rule per value, in the list's colours
 *  unless the tool opted out (tool.listColors === false). */
export function toolRules(t) {
  if (t.mode === "time") return [[S.t + num1(t.offset, 0), t.color]];
  const vals = listOf(t.value), v = varOf(t.value), byList = vals.length > 1 && t.listColors !== false;
  return vals.map((x, k) => [x, byList ? listColor(v, k) : t.color]);
}
// ---- variables everywhere (v5.7, human 2026-10-05: "pretty much anything physically possible to be altered by
// variables") ----------------------------------------------------------------------------------------------------
/** A number setting as a number: its variable's value if it follows one; `dflt` when unset / not a number. */
export const num1 = (v, dflt) => { const x = numOf(v); return x === null || x === undefined || !Number.isFinite(Number(x)) ? dflt : Number(x); };
const NUM_KEYS = ["vmin", "vmax", "linthresh", "decades", "aspect", "ymin", "ymax", "hide"];   // hide: v8.26
/** Settings as drawn: number settings that follow a variable become numbers. Picks, fixed times, tool positions and
 *  lines keep their references (they expand lists and read coordinates themselves). */
export function resolved(s) {
  const out = { ...s };
  for (const k of NUM_KEYS) if (isRef(out[k])) out[k] = numOf(out[k]);
  for (const k of ["view", "yview", "fonts"]) {
    if (out[k] && Object.values(out[k]).some(isRef)) out[k] = Object.fromEntries(Object.entries(out[k]).map(([a, b]) => [a, isRef(b) ? numOf(b) : b]));
  }
  return out;
}
/** Text with {name} replaced by that variable's value: a number, a list ("3, 5, 8"), a dataset's run, a measured
 *  value (updated every frame). Unknown names stay as typed. v11.1 (human 2026-11-10: "I want to have the {dataset}
 *  option that just fills that in"): `extra` = names the plot fills in itself — {dataset}: the plot's dataset(s) (a
 *  legend label: its curve's); a variable of the same name wins. */
/** v14.5.1 (architecture review §5.1: "{v} is filled differently per tool"): a tool's label as drawn — {v} = the value it
 *  is drawn at (a line's position, a point's y, a lineout's position), {dataset} and {t} as the plot fills them, {name} =
 *  a variable. null without a label. */
export function toolLabel(t, v, extra = null) {
  if (!t.label) return null;
  return subVars(String(t.label).replace(/\{v\}/g, Number.isFinite(v) ? R.fmt(v) : ""), extra);
}
export function subVars(text, extra = null) {
  if (text === null || text === undefined) return text;
  return String(text).replace(/\{([A-Za-z_]\w*)\}/g, (m, n) => {
    const v = S.vars?.[n];
    if (!v && extra && Object.prototype.hasOwnProperty.call(extra, n)) return String(extra[n]);
    if (!v) { const b = viewVar(n); return b === undefined ? m : R.fmt(b); }
    if (v.type === "dataset") return listEntries(v).map(o => o.run).join(", ");          // v11.2: entries resolved, each once
    if (v.type === "measured") { const m = readingOwn(n).val; return Array.isArray(m) ? m.map(R.fmt).join(", ") : R.fmt(m); }
    if (v.type === "config") return configValues(v).map(R.fmt).join(", ");
    if (v.type === "fit") { const f = fitValue(v); return Array.isArray(f) ? f.map(R.fmt).join(", ") : R.fmt(f); }
    return Array.isArray(v.value) ? v.value.map(x => R.fmt(Number(x))).join(", ") : R.fmt(Number(v.value));
  });
}
/** Desktop style (v5.8): font sizes / widths for the whole desktop; S.style holds only what differs from these. */
export const STYLE_DEFAULTS = { title: 12, label: 12, tick: 11, legend: 11, info: 11, cbar: 11, cbarTick: 10, lineScale: 1, frame: 1, ticklen: 4, family: "system-ui, sans-serif" };
export function styleNow() {
  const s = S.style || {}, out = {};
  for (const [k, d] of Object.entries(STYLE_DEFAULTS)) out[k] = typeof d === "number" ? Math.max(0, num1(s[k], d)) : (s[k] || d);
  return out;
}
/** Text typed for a number variable: "3" -> 3, "3, 5, 8" -> [3, 5, 8]; null if not numbers. */
export function parseNumberValue(text) {
  const t = String(text ?? "").split(/[,\s]+/).filter(Boolean).map(Number);
  if (!t.length || !t.every(isFinite)) return null;
  return t.length === 1 ? t[0] : t;
}
export const numberText = v => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));
/** A typed list ("2, 4, rmax") -> numbers; variable names (with or without $) are resolved. */
export function parseListRefs(text) {
  return String(text ?? "").split(/[,\s]+/).filter(Boolean).flatMap(t => {
    const n = t.replace(/^\$/, "");
    if (!S.vars?.[n] && outputValues(n)) return listOf("$" + n);            // v12.0: a steps tool's value, "steps1.from"
    return validVarName(n) && S.vars?.[n] ? listOf("$" + n) : [Number(t)];
  }).filter(isFinite);
}
/** Names of the variables an object refers to. */
export function refsIn(obj) { return new Set([...JSON.stringify(obj ?? null).matchAll(/\$([A-Za-z_]\w*)/g)].map(m => m[1])); }
export function newVarName(type) {
  if (type === "dataset") for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!nameTaken(c)) return c;
  if (type === "runs") for (let i = 1; i < 99; i++) { const c = i > 1 ? "runs" + i : "runs"; if (!nameTaken(c)) return c; }   // v8.18: a dataset list
  if (type === "config") for (const n of ["band", "conf"]) for (let i = 0; i < 99; i++) { const c = i ? n + i : n; if (!nameTaken(c)) return c; }
  const stem = type === "number" ? "n" : type === "measured" ? "m" : "D";
  for (let i = 1; ; i++) if (!nameTaken(stem + i)) return stem + i;
}
/** Every stored setting (panels, groups, variables): fn(container, key) for each leaf value. */
function walkValues(fn) {
  const walk = o => {
    if (!o || typeof o !== "object") return;
    for (const k of Object.keys(o)) { if (o[k] && typeof o[k] === "object") walk(o[k]); else fn(o, k); }
  };
  for (const p of S.panels) walk(p.settings);
  for (const g of Object.values(S.groups)) walk(g.settings);
  for (const v of Object.values(S.vars)) walk(v);
}
export function renameVar(old, nw) {
  if (!S.vars[old] || nameTaken(nw) || !validVarName(nw)) return false;
  S.vars = Object.fromEntries(Object.entries(S.vars).map(([k, x]) => (k === old ? [nw, { ...x, name: nw }] : [k, x])));
  const re = new RegExp(`\\$${old}\\b`, "g");
  walkValues((o, k) => { if (typeof o[k] === "string" && o[k].includes("$" + old)) o[k] = o[k].replace(re, () => "$" + nw); });
  // v8.27: axis functions name variables bare (x * L): renamed there too
  const bare = new RegExp(`(?<![\\w$.])${old}\\b`, "g");
  walkValues((o, k) => { if ((k === "xfn" || k === "yfn") && typeof o[k] === "string") o[k] = o[k].replace(bare, nw); });
  for (const kind of ["reading", "fit"]) renameResult(`${kind}:${old}`, `${kind}:${nw}`);   // v14.4: results.js
  return true;
}
/** Delete a variable; whatever followed it keeps its current value. */
export function deleteVar(name) {
  const v = S.vars[name];
  if (!v) return;
  const m0 = Number(numOf("$" + name));                    // v14.3.2: its current value (fit and config ones too: they became 0)
  const lit = v.type === "dataset" ? runOf("$" + name) : v.type === "number" ? Number(Array.isArray(v.value) ? v.value[0] : v.value) : (isFinite(m0) ? m0 : 0);
  const litText = v.type === "number" && Array.isArray(v.value) ? v.value.join(", ") : String(lit);
  const re = new RegExp(`\\$${name}\\b`, "g");
  delete S.vars[name]; dropResult(`reading:${name}`); dropResult(`fit:${name}`);
  walkValues((o, k) => {
    const x = o[k];
    if (typeof x !== "string" || !x.includes("$" + name)) return;
    o[k] = x === "$" + name ? lit : x.replace(re, () => litText);
  });
}
/** Which panels (ids) and how many 1D lines use variable `name`. */
export function usesOf(name) {
  // v11.2: a dataset list with this variable among its entries uses it too, and so do the plots that follow that list
  const via = Object.values(S.vars).filter(x => x.name !== name && listRefs(x).has(name)).map(x => x.name);
  const re = new RegExp(`\\$(?:${[name, ...via].join("|")})\\b`), bare = new RegExp(`(?<![\\w$.])${name}\\b`), panels = [];
  let lines = 0;
  for (const p of S.panels) {
    const s = eff(p);
    // v8.27: an axis function (f(x), f(y)) names a variable bare: x * L
    if (!re.test(JSON.stringify(s)) && !(p.type === "1d" && [s.xfn, s.yfn].some(f => typeof f === "string" && bare.test(f)))) continue;
    panels.push(p.id);
    for (const l of s.lines || []) if (re.test(JSON.stringify(l))) lines++;
  }
  return { panels, lines };
}
/** Point every dataset setting showing `run` (in the given panels, or all) at `ref`. Returns how many changed. */
export function bindRun(run, ref, panelIds = null) {
  let n = 0;
  const fix = s => {
    if (!s) return;
    if (s.run === run) { s.run = ref; n++; }
    for (const l of s.lines || []) if (l.run === run) { l.run = ref; n++; }
  };
  for (const p of S.panels) if (!panelIds || panelIds.includes(p.id)) fix(p.settings);
  for (const g of Object.values(S.groups)) if (!panelIds || membersOf(g.id).some(p => panelIds.includes(p.id))) fix(g.settings);
  return n;
}

// ---- linking -----------------------------------------------------------------------------------------------
const GROUP_COLORS = ["#2f6fd0", "#d0612f", "#2a9d5b", "#9b4fc4", "#c49a1f", "#1f9fb0", "#c43f6f"];
export function newGroupColor() {
  const used = new Set(Object.values(S.groups).map(x => x.color));
  return GROUP_COLORS.find(c => !used.has(c)) || GROUP_COLORS[Object.keys(S.groups).length % GROUP_COLORS.length];
}
export const groupOf = p => (p.link ? S.groups[p.link.group] || null : null);

// ---- sharing scopes in a figure (v7.2, human 2026-10-13: "more links between the same plot type for different
// datasets than for different plot types of same dataset") ------------------------------------------------------
//   A figure (a link group laid out in rows and columns) says per FAMILY of settings how it is shared:
//   g.scope[family] = "col" | "row"  — the same value in each figure column / row, kept in the panels' own settings
//   and copied to the column / row when it changes (app.js syncScoped); absent = the usual: shared by every linked
//   panel ("all", the group's value) unless a panel made it its own (link.own; every panel own = "own").
export const SCOPE_FAMILIES = [
  ["dataset", "dataset", ["run"]],
  ["data", "quantity / lines", ["q", "lines", "slope"]],   // v10.2: slope (an along-line map's)
  ["axes", "axes & slices", ["xdim", "ydim", "meridional", "mirror", "logx", "logy", "picks", "timeMode", "fixedTime", "xaxis", "ykind", "abs", "xfn", "yfn", "at"]],
  ["colour", "colour map", ["cmap", "reverse", "norm", "linthresh", "decades", "cbarPos", "hide"]],
  ["limits", "colour limits", ["limits", "vmin", "vmax", "vsym", "symmetric"]],
  ["view", "pan & zoom", ["view", "yview", "ylim", "ymin", "ymax", "xsym", "ysym", "xdrag", "ydrag"]],
  ["tools", "tools", ["tools"]],
  ["labels", "axis labels & legend", ["labels", "legend", "legendPos", "fonts", "infoPos"]],
  ["style", "size, scale, smoothing", ["aspect", "lockAspect", "scale", "avg", "smooth"]],   // v10.1: smooth (1D; avg stays for 2D maps)
];
const FAMILY_OF = new Map(SCOPE_FAMILIES.flatMap(([f, , keys]) => keys.map(k => [k, f])));
export const familyOf = k => FAMILY_OF.get(k) || null;
export const familyKeys = f => SCOPE_FAMILIES.find(x => x[0] === f)?.[2] || [];
/** How family f is shared in group g: "col" | "row" | "axis" | "all" (absent = "all"). (A v5.12 figure's g.viewMode
 *  "col" / "row" is the pan & zoom family's scope.) v8.22 (human 2026-11-04: plots that are different enough share
 *  "mainly pan and zoom … depends on if they share axes"; "the colormap autolinking too much"): in a figure, pan & zoom
 *  is shared by default between the plots with the same axes ("axis"); "all" for it is stored explicitly. */
export function familyScope(g, f) {
  if (!g?.figure) return "all";
  const sc = g.scope?.[f] ?? (f === "view" ? g.viewMode || "axis" : null);
  return sc === "col" || sc === "row" || sc === "axis" ? sc : "all";
}
/** "col" | "row" | "axis" when key k is shared per figure column / row / with the plots of the same axes in group g;
 *  else "all" (the usual linking). */
export function scopeOf(g, k) {
  const f = familyOf(k);
  return f ? familyScope(g, f) : "all";
}
// pan & zoom keys of each axis (v8.22): a 1D plot's x window and its y window follow different plots
const Y_VIEW = new Set(["yview", "ylim", "ymin", "ymax", "ysym", "ydrag"]);
/** What pan & zoom key k depends on in plot p: plots with the same signature share it ("axis" scope). 2D: both axes
 *  (the window is one object); 1D: the x axis (and its function) for the x window, the y axis for the y window. */
export function axisSig(p, k) {
  const s = eff(p);
  if (p.type === "2d") return JSON.stringify([s.xdim ?? null, s.ydim ?? null, !!s.meridional, !!s.mirror]);
  return JSON.stringify(Y_VIEW.has(k) ? ["y", yAxisId(s), s.yfn || "", !!s.logy] : ["x", s.xaxis ?? null, s.xfn || "", !!s.logx]);
}
/** v14.3.3 (human 2026-11-13: "I linked two table plots now their y axes are locked together and I cant separate them"):
 *  what a 1D plot's y axis shows. Its y-axis group (ykind); a plot without one (table, period-tool and lineout plots) is
 *  named by what its lines draw (table columns, period plots, lineout tools), so two of them are "the same y axis" only
 *  when they draw the same thing. */
export function yAxisId(s) {
  if (s.ykind) return s.ykind;
  const ids = (s.lines || []).map(l => lineYId(l)).filter(Boolean);
  return ids.length ? [...new Set(ids)].sort().join("|") : null;
}
// v14.4.1: what a made line draws comes from the line-source registry (linekinds.js yId), handed over when it loads
// (model.js stays free of UI imports, for the node tests); until then the same rule inline
// (a function declaration holds it: ready whichever module loads first)
function lineYId(l) { return lineYId.fn ? lineYId.fn(l) : l.tab ? `tab:${l.tab.table}/${l.tab.y}` : l.lo ? `lo:${l.lo.map}/${l.lo.tool}` : null; }
export function setLineYId(fn) { lineYId.fn = fn; }
function lineYKind() { return null; }
export function setLineYKind(fn) { lineYKind.fn = fn; }
/** v14.3.3: a figure plot whose y window was made its own (🔗 → its own) takes no common y range or y labels. */
export const ownY = p => !!p?.link?.own?.includes("yview");
/** The dataset a panel shows: a 2D panel's dataset; a 1D panel's dataset setting if its lines use it (or it has none),
 *  else the dataset of its first recorded line. Lines of this dataset follow it when a figure row changes dataset. */
export function panelRun(s, type) {
  if (type === "2d") return s.run ?? null;
  const runs = (s.lines || []).filter(l => !isFn(l) || isAn(l)).map(l => l.run);
  return !runs.length || runs.includes(s.run) ? s.run ?? runs[0] ?? null : runs[0];
}

export const isLinked = (p, k) => { const g = groupOf(p); return !!g && !p.link.own.includes(k) && k in g.settings && scopeOf(g, k) === "all"; };
export const membersOf = gid => S.panels.filter(p => p.link?.group === gid);

/** Effective settings: the group's values for linked keys, the panel's own for the rest. */
export function eff(p) {
  const g = groupOf(p), s = { ...p.settings };
  if (g) for (const k of Object.keys(g.settings)) if (!p.link.own.includes(k) && scopeOf(g, k) === "all") s[k] = g.settings[k];
  // v5.15 per-tool sharing: the shared tools this panel has not made its own (hideShared), then its own (ownTools)
  if (s.ownTools || s.hideShared) {
    const hide = new Set(s.hideShared || []);
    s.tools = [...(s.tools || []).filter(t => !hide.has(t.id)), ...(s.ownTools || [])];
    delete s.ownTools; delete s.hideShared;
  }
  return s;
}
/** Read/write settings of a panel: writes to a linked key change every panel in the group. */
export const ctxPanel = p => ({
  get: k => (isLinked(p, k) ? groupOf(p).settings[k] : p.settings[k]),
  set: (k, v) => { if (isLinked(p, k)) groupOf(p).settings[k] = v; else p.settings[k] = v; },
  inGroup: () => !!groupOf(p), linked: k => isLinked(p, k), toggleLink: k => toggleLink(p, k),
  own: k => !!groupOf(p) && p.link.own.includes(k),
  // v7.2: "col" / "row" when k is shared with this panel's figure column / row (and not made its own)
  scope: k => { const g = groupOf(p), sc = scopeOf(g, k); return g && sc !== "all" && !p.link.own.includes(k) ? sc : null; },
  // a flag that belongs to another setting (± with its window, v5.12): shared exactly when that setting is
  setWith: (k, v, like) => { if (isLinked(p, like)) groupOf(p).settings[k] = v; else p.settings[k] = v; },
});
/** Make key k this panel's own (copying the shared value), or share it again. */
export function toggleLink(p, k) {
  const g = groupOf(p);
  if (!g) return;
  if (scopeOf(g, k) !== "all") {                         // v7.2: per column / row — own ↔ shared with them again
    if (p.link.own.includes(k)) p.link.own = p.link.own.filter(x => x !== k);           // (the app copies their value)
    else { p.settings[k] = clone(p.settings[k]); p.link.own.push(k); }
    return;
  }
  if (isLinked(p, k)) { p.settings[k] = clone(g.settings[k]); p.link.own.push(k); }          // shared -> own (keeps the value)
  else {                                                                                       // own / never set -> shared
    p.link.own = p.link.own.filter(x => x !== k);
    // v5.13 fix: a setting the group never had used to be made "own" here (and its value lost); now this panel's
    // value becomes the shared one
    if (!(k in g.settings)) g.settings[k] = clone(p.settings[k]);
  }
}
/** The keys a plot keeps its own when it joins a figure (v8.22: everything but pan & zoom, which follows the plots
 *  with the same axes; the 🔗 at a settings row shares more). */
export const ownOnJoin = (...ps) => [...new Set([...SCOPE_FAMILIES.flatMap(f => f[2]), ...ps.flatMap(p => Object.keys(eff(p)))])].filter(k => familyOf(k) !== "view");
/** Panel b joins a's group (made from a's settings if a isn't linked yet). b keeps `own` keys (and so does a when the
 *  group is new). */
export function linkPanels(a, b, own = ownOnJoin(a, b)) {
  let g = groupOf(a);
  if (!g) {
    const id = `g${newId()}`;
    g = S.groups[id] = { id, type: a.type, color: newGroupColor(), settings: clone(eff(a)) };
    a.link = { group: id, own: [...own] };
  }
  b.settings = { ...clone(eff(b)) };
  b.link = { group: g.id, own: [...own] };
}
/** Exactly the plots `ids` of group g share `keys` (v8.22, the 🔗 menu: tick the plots that share a setting), with the
 *  value plot `from` shows (if it is one of them, else the first); the others keep what they show as their own.
 *  Fewer than two: nobody shares them. */
export function shareKeys(g, keys, ids, from = null) {
  const mem = membersOf(g.id), on = ids.length >= 2;
  const src = (from && ids.includes(from.id) ? from : mem.find(p => ids.includes(p.id))) || null;
  const val = Object.fromEntries(keys.map(k => [k, src ? clone(eff(src)[k]) : undefined]));
  for (const p of mem) { const s = eff(p); for (const k of keys) { if (s[k] === undefined) delete p.settings[k]; else p.settings[k] = clone(s[k]); } }
  for (const p of mem) {
    p.link.own = p.link.own.filter(k => !keys.includes(k));
    if (!on || !ids.includes(p.id)) p.link.own.push(...keys);
  }
  if (on) for (const k of keys) {
    if (val[k] === undefined) { delete g.settings[k]; for (const p of mem) if (ids.includes(p.id)) delete p.settings[k]; }
    else g.settings[k] = val[k];
  }
}
/** The plots of group g that share key k with the others (linked; "all" scope). */
export const sharersOf = (g, k) => membersOf(g.id).filter(p => isLinked(p, k));
/** Leave the group, keeping the current look as own settings; a group of one dissolves. */
export function unlinkPanel(p) {
  const g = groupOf(p);
  if (!g) return;
  p.settings = clone(eff(p)); p.link = null;
  const rest = membersOf(g.id);
  if (rest.length < 2) { for (const q of rest) { q.settings = clone(eff(q)); q.link = null; } delete S.groups[g.id]; }
}

// ---- data kinds (v15.1, DECISIONS D20) ----------------------------------------------------------------------------
// Data the core cannot plot as plain arrays over its dims register as a data kind (plugins.js registerDataKind; the
// aperture4 plugin: along-line data, a quantity at a field line's own points). The core asks the kind at every place
// such data is treated differently; every field but key / is is optional (a kind gives only what it changes):
//   key, label (what it is, in messages), is(src)            which sources are of this kind
//   dims, axes, axisOrderBefore, axisInfo: {id: {label, units}}   the dims it owns: the x-axis menu offers `axes`
//                                                            instead (placed before axis `axisOrderBefore`); names
//   fitAxis(src, id), fitsDims(dims, id)                     as model.js fitAxis / fitsDims for its sources
//   lineData({src, run, fit, need, frames, base, sx, ref, avgDims}) -> {xs, val(i, j), extra} | {error}
//                                                            a 1D curve's x and values (panel1d.js lineCurve; extra
//                                                            fields go on the curve); readsWith(src) -> [sources read
//                                                            with it] (prefetch)
//   startPicks(src | null, q) -> picks | null                a new map's first picks (null src: not cached yet)
//   setMapAxes(s, src, xd, yd), mapAxes(s, src), mapTimes(s, src, xd, yd), mapYRange(s, src, xd, yd), mapLoad(it),
//   mapPrepare(it), mapView(it), mapPaint(it, ax, ay), mapLabels(it, run)   a map of it (panel2d.js render2D)
//   mapAxisOptions, mapAxisTitle, mapPairOk(x, y), mapOtherFor(v), mapCanLog(d), mapSkipDims, mapRows(ctx, src, xd, yd),
//   mapHint(xd, yd)                                          its settings box and the new-map form (settings.js, newpanel.js)
//   lineoutDefault(cut), lineoutPositions(cut), lineoutCurve({s, line, sub, g, fns, finish})   lineouts (lineout.js)
export const DATA_KINDS = [];
export function registerDataKind(k) {
  for (const f of ["key", "is"]) if (!(f in (k || {}))) throw new Error(`missing ${f}`);
  if (typeof k.is !== "function") throw new Error("is is not a function");
  if (DATA_KINDS.some(x => x.key === k.key)) throw new Error(`there is already a data kind "${k.key}"`);
  DATA_KINDS.push(k);
  if (k.axes?.length) {                                    // the x-axis menu: its axes in its order, before axisOrderBefore
    const at = AXIS_ORDER.indexOf(k.axisOrderBefore);
    AXIS_ORDER.splice(at < 0 ? AXIS_ORDER.length : at, 0, ...k.axes.filter(a => !AXIS_ORDER.includes(a)));
  }
}
/** The data kind of source `src` (a registered one), or null (plain data). */
export const dataKindOf = src => (src ? DATA_KINDS.find(k => k.is(src)) || null : null);
/** The picks a new map of quantity q starts on (src: its source, or null when it is not cached yet), or null. */
export function startPicksOf(src, q) {
  for (const k of DATA_KINDS) { const p = k.startPicks?.(src, q); if (p) return { ...p }; }
  return null;
}
/** Data that a plugin that is not loaded draws (its plugin.json: [{plugin, dims, what}], set by plugins.js). */
let MISSING_KINDS = [], MISSING_TOOLS = [], MISSING_LINES = [];
/** v15.4 (D22): also the tools and made lines of such plugins (plugin.json "tools": [{type, what}], "lines": [{field, what}]). */
export function setMissingKinds(list, { tools = [], lines = [] } = {}) {
  MISSING_KINDS = Array.isArray(list) ? list : [];
  MISSING_TOOLS = Array.isArray(tools) ? tools : []; MISSING_LINES = Array.isArray(lines) ? lines : [];
}
/** The not-loaded plugin's data `src` is ({plugin, dims, what}), or null. */
export const missingKindOf = src => (!src?.spaceDims || dataKindOf(src) ? null : MISSING_KINDS.find(m => m.dims.some(d => src.spaceDims.includes(d))) || null);
/** The message a plot of such data shows instead of drawing (its settings are kept). */
export const missingKindText = (m, label) => `needs the ${m.plugin} plugin, which is not loaded: ${label} is ${m.what} (list the plugin in viewer/plugins/index.json; ?plugins= in the address turns plugins off). The plot's settings are kept.`;
/** v15.4 (D22): the not-loaded plugin stored tool t belongs to ({plugin, type, what}), or null (asked only for a tool that
 *  no loaded definition claims). */
export const missingToolOf = t => (t?.type ? MISSING_TOOLS.find(m => m.type === t.type) || null : null);
/** The not-loaded plugin made line l belongs to ({plugin, field, what}): the line carries that field (l.cyc …), or null. */
export const missingLineOf = l => (l ? MISSING_LINES.find(m => l[m.field] != null) || null : null);
/** What such a tool or line says instead of drawing (its settings are kept). */
export const missingToolText = m => `${m.what}: needs the ${m.plugin} plugin, which is not loaded (list the plugin in viewer/plugins/index.json; ?plugins= in the address turns plugins off). Its settings are kept.`;
// ---- axes catalogue (standard dims: r, theta, time, r_max, theta_foot ...; a data kind's own axes) ---------------
// (v15.4, D22: the "lag" axis of the period tool's autocorrelation plots needs no entry: an unknown axis reads as itself)
export function axisInfo(id) {
  if (id === "time") return { id, label: "t", units: timeUnits(), scale: "linear" };   // v15.3: the data's units
  if (typeof id === "string" && id.startsWith("tab:")) {   // v14.0: a table column (tables.js tabAxis)
    const i = id.lastIndexOf("/"), tb = S.tables?.[decodeURIComponent(id.slice(4, i))], k = id.slice(i + 1), c = tb?.cols?.find(x => x.key === k);
    return c ? { id, label: c.label || k, units: "", scale: "linear" } : { ...axisInfo(k), id };
  }
  for (const k of DATA_KINDS) if (k.axisInfo?.[id]) return { id, ...k.axisInfo[id], scale: "linear" };   // v15.1: a data kind's axis
  for (const run of Object.values(store.runs)) { const c = run.coord(id); if (c) return { id, label: c.label, units: c.units, scale: c.scale || "linear" }; }
  return { id, label: id, units: "", scale: "linear" };
}
export const axisLabel = id => { const a = axisInfo(id); return a.units ? `${a.label} [${a.units}]` : a.label; };
// v8.1 (UI review §2): the x-axis menu in a fixed order (it followed whichever manifest loaded first)
// (v15.1: a data kind's axes are placed by registerDataKind)
const AXIS_ORDER = ["time", "r", "theta", "r_max", "theta_foot", "r_out"];
export function axisCatalog() {
  const ids = new Set(["time"]);
  for (const run of Object.values(store.runs))
    for (const [n, c] of Object.entries(run.m.coords)) {
      const k = DATA_KINDS.find(x => x.dims?.includes(n));
      if (k) { (k.axes || []).forEach(a => ids.add(a)); continue; }      // v15.1: a data kind's dim: its own axes
      if (MISSING_KINDS.some(m => m.dims.includes(n))) continue;         // (a dim only a plugin that is off can draw)
      ids.add(n); if (c.alt) Object.keys(c.alt).forEach(a => ids.add(a));
    }
  const rank = a => { const i = AXIS_ORDER.indexOf(a); return i < 0 ? 99 : i; };
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
/** How source `src` provides axis `id`: {dim, values} (the dim, or an alternative coordinate of it). v15.1: a data
 *  kind's source: as the kind says (e.g. {dim, values: null, …}: x per curve, its lineData). */
export function fitAxis(src, id) {
  if (!src) return null;
  const k = dataKindOf(src);
  if (k?.fitAxis) return k.fitAxis(src, id);
  if (id === "time") return src.hasTime ? { dim: "time", values: src.times } : null;
  for (const d of src.spaceDims) {
    const c = src.run.m.coords[d];
    if (d === id) return { dim: d, values: c.values };
    if (c.alt && c.alt[id]) return { dim: d, values: c.alt[id].values, alt: id };
  }
  return null;
}
/** v11.6.1 (human 2026-11-12: "I never care about a singular grid point"): the menus do not offer a map (θ × r) as a
 *  line against time: that is the value of one grid cell over time. (Drawing still works for lines made before.) */
const gridOnly = dims => dims.includes("theta") && dims.includes("r");
export const menuFits = (s, id) => !!fitAxis(s, id) && !(id === "time" && gridOnly(s.spaceDims || []));
/** v11.4: does a quantity stored over `dims` (not cached yet: no source to ask) fit x axis `id`? As fitAxis. */
export function fitsDims(dims, id) {
  if (id === "time" && gridOnly(dims)) return false;                   // (v11.6.1, as menuFits)
  for (const k of DATA_KINDS) { const f = k.fitsDims?.(dims, id); if (f !== undefined) return !!f; }   // v15.1: a data kind's
  if (dims.includes(id)) return true;
  return dims.some(d => Object.values(store.runs).some(r => r.m.coords?.[d]?.alt?.[id]));
}
export const quantitiesFor = (run, id) => Object.values(store.runs[runOf(run)]?.sources || {}).filter(s => fitAxis(s, id)).map(s => s.name);
/** y-axis kinds that have data along x axis `id` (any run): [{kind, units}] */
export function kindsFor(id) {
  const out = new Map();
  for (const run of Object.values(store.runs)) for (const s of Object.values(run.sources)) if (menuFits(s, id) && !out.has(s.kind)) out.set(s.kind, s.units);
  // v11.4: and the y-axis groups of quantities that are not cached anywhere yet but can be computed
  for (const run of [...Object.keys(store.runs), ...ghostRuns()]) for (const c of cacheables(run)) if (fitsDims(c.dims, id) && !out.has(c.kind)) out.set(c.kind, c.units);
  return [...out].map(([kind, units]) => ({ kind, units }));
}
// ---- slope and rate lines are lines of their own (v8.30) ---------------------------------------------------------
// Human 2026-11-09: "when I do this slope method I want it to be clear that I am showing slope this is basically setting up
// a different line and should be treated as such"; "yeah make it consistent" (d/dt too). A line drawn as its slope along
// x is a "slope of K" line, one drawn as its time derivative a "rate of K" line (K = its quantity's y-axis group): they
// have their own y-axis groups, so they never share a y axis with K itself.
export const DERIVED = { slope: "slope of ", rate: "rate of " };
/** A quantity's name with an operator in front of the quantity itself: "slope of the drop of" + "along the line (true s) ·
 *  potential ∫E∥ dl" -> "along the line (true s) · slope of the drop of potential ∫E∥ dl" (a family member keeps its
 *  family first). */
export function opLabel(op, label) {
  const i = String(label).lastIndexOf(" · ");
  return i >= 0 ? `${label.slice(0, i + 3)}${op} ${label.slice(i + 3)}` : `${op} ${label}`;
}
/** "slope of potential" -> {mode: "slope", base: "potential"}; "potential" -> {mode: null, base: "potential"}. */
export function splitKind(kind) {
  for (const [mode, pre] of Object.entries(DERIVED)) if (typeof kind === "string" && kind.startsWith(pre)) return { mode, base: kind.slice(pre.length) };
  return { mode: null, base: kind ?? null };
}
/** The y-axis group of a data line: its quantity's, or "slope of …" / "rate of …" when it is drawn as one. */
export function lineKind(line, src) {
  const made = lineYKind.fn?.(line);                       // v15.0: a made line's own group (linekinds.js yKind; foot gaps …)
  if (made) return made;
  const k = src?.kind;
  if (!k) return null;
  return line?.slope?.sign ? DERIVED.slope + k : line?.ddt?.sign ? DERIVED.rate + k : k;
}
/** Slope / rate y-axis groups along x axis `id`: slopes of every group there (not on a time axis), rates of those with time. */
export function derivedKindsFor(id) {
  const out = new Map();
  for (const run of Object.values(store.runs)) for (const s of Object.values(run.sources)) {
    if (s.isAn || !menuFits(s, id)) continue;
    if (id !== "time" && !out.has(DERIVED.slope + s.kind)) out.set(DERIVED.slope + s.kind, s.units);
    if (s.hasTime && !out.has(DERIVED.rate + s.kind)) out.set(DERIVED.rate + s.kind, s.units);
  }
  return [...out].map(([kind, units]) => ({ kind, units })).sort((a, b) => a.kind.localeCompare(b.kind));
}
let SECTION_ORDER = ["maps", "raw fields", "expressions"];   // v15.0: neutral; a store's groups.json gives the real order
/** v6.1: the data manager's group order (data/groups.json) — groups only change how datatypes are listed. */
export function setSectionOrder(order) { if (Array.isArray(order) && order.length) SECTION_ORDER = [...order, "expressions"]; }
// v11.7 (human 2026-11-12: "I want the scrolldowns organized into folders not the old MAP along stuff"): the quantity
// menus are sectioned by the folders (the data manager's cache presets, <store>/groups.json "folders"), then "not in a
// folder"; a quantity in two folders is listed in both. As the sections no longer say what a quantity is over, each entry
// says it after its name ("E∥ — θ·r"), and a folder lists by it. Expressions and analytic functions keep their sections.
let FOLDERS = [];
export function setFolders(f) { FOLDERS = f && typeof f === "object" ? Object.entries(f).filter(([, qs]) => Array.isArray(qs) && qs.length) : []; }
export const hasFolders = () => FOLDERS.length > 0;
const AX_NICE = { theta: "θ", r: "r", z: "z" };
const AX_ORDER = ["θ·r", "time only"];
/** v15.0 (plugins.js): short names of a plugin's dims in the quantity menus ({dim: "name"}), and where their
 *  combinations sort (["r_max", "r_max·s", …], before "time only"). */
export function registerAxisNames(names, order = []) {
  if (!names || typeof names !== "object") throw new Error("not an object of dim: name");
  for (const [k, v] of Object.entries(names)) if (!(k in AX_NICE)) AX_NICE[k] = String(v);
  const at = AX_ORDER.indexOf("time only");
  AX_ORDER.splice(at, 0, ...order.filter(o => !AX_ORDER.includes(o)));
}
/** What a quantity stored over `dims` is over, short: "θ·r", "r_max", "r_max·s", "time only", … (as the data manager). */
export function axesText(dims) {
  const sp = (dims || []).filter(d => d !== "time"), t = sp.map(d => AX_NICE[d] || d).join("·");
  return !sp.length ? ((dims || []).includes("time") ? "time only" : "one number") : (dims || []).includes("time") ? t : `${t}, no time`;
}
const inFolder = (n, qs) => qs.includes(n) || (n.includes(".") && qs.includes(n.split(".")[0]));   // a family's members
const OWN = s => s === "expressions" || s === "analytic functions" || String(s).startsWith("expressions");
/** Menu entries {name, label, attrs, section, dims} -> [[section, [[name, label, attrs]]]]: by folder when there are
 *  folders, else by the old sections (their order from the data manager). */
export function menuSections(entries) {
  if (!FOLDERS.length) {
    const groups = new Map();
    for (const e of entries) { if (!groups.has(e.section)) groups.set(e.section, []); groups.get(e.section).push([e.name, e.label, e.attrs]); }
    return [...groups].sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]));
  }
  const ax = e => (e.dims ? axesText(e.dims) : ""), rank = e => { const i = AX_ORDER.indexOf(ax(e)); return i < 0 ? 99 : i; };
  const item = e => [e.name, e.dims && !OWN(e.section) ? `${e.label} — ${ax(e)}` : e.label, e.attrs];
  const sorted = es => es.slice().sort((a, b) => rank(a) - rank(b) || String(a.label).replace(MARK, "").localeCompare(String(b.label).replace(MARK, ""))).map(item);
  const out = [];
  for (const [f, qs] of FOLDERS) { const es = entries.filter(e => inFolder(e.name, qs)); if (es.length) out.push([f, sorted(es)]); }
  const rest = entries.filter(e => !FOLDERS.some(([, qs]) => inFolder(e.name, qs)));
  const plain = rest.filter(e => !OWN(e.section)), own = new Map();
  for (const e of rest.filter(e => OWN(e.section))) { if (!own.has(e.section)) own.set(e.section, []); own.get(e.section).push(e); }
  for (const [sec, es] of own) out.push([sec, sorted(es)]);
  if (plain.length) out.push(["not in a folder", sorted(plain)]);        // v11.7.1 (human: "not in a folder is bottom")
  return out;
}
// (v8.25: a family's section "along field lines ▸ gap" comes right after "along field lines")
export const sectionRank = n => { const [b, f] = String(n).split(" ▸ "), i = SECTION_ORDER.indexOf(b); return (i < 0 ? 99 : i) + (f ? 0.5 : 0); };
/** Datatypes of a run that fit x axis `id` (null = any 2D map) and, if given, y kind: [[section, [[name, label]]]] */
export function datatypes(run, id, kind = null) {
  const groups = [], { mode, base } = splitKind(kind);         // (v11.7: entries, sectioned by menuSections)   // v8.30: a slope / rate group lists its base quantities
  for (const s of Object.values(store.runs[runOf(run)]?.sources || {})) {
    if (s.isAn) continue;                               // v7: analytic functions go on 1D panels as analytic lines
    if (id ? !menuFits(s, id) : s.spaceDims.length < 1) continue;
    if (base && s.kind !== base) continue;
    if ((mode === "rate" && !s.hasTime) || (mode === "slope" && id === "time")) continue;
    groups.push({ name: s.name, label: s.label, section: s.section, dims: s.dims });
  }
  // v11.4 (human 2026-11-12: "see things that CAN be cached but arent"): those, marked ◌ and grey; picking one offers
  // to compute it (cacheable.js)
  for (const c of cacheables(runOf(run))) {
    if (id ? !fitsDims(c.dims, id) : c.dims.length < 2) continue;
    if (base && c.kind !== base) continue;
    if (mode === "slope" && id === "time") continue;
    groups.push({ name: c.name, label: MARK + c.label, section: c.section, dims: c.dims,
      attrs: { class: "cacheable", title: "not cached for this dataset yet: pick it, then “compute” in the plot" } });
  }
  return menuSections(groups);
}
/** Coordinates a dim can be given in: its own + alternatives: [[name, label, values]] */
export function coordChoices(src, d) {
  if (d === "time") return [["time", "t", src.times]];
  const c = src.run.m.coords[d], out = [[d, c.label + (c.units ? ` [${c.units}]` : ""), c.values]];
  for (const [a, v] of Object.entries(c.alt || {})) out.push([a, v.label + (v.units ? ` [${v.units}]` : ""), v.values]);
  return out;
}

export function dimCoord(src, d) {
  if (d === "time") return { values: src.times, label: "t", units: timeUnits(src.run), scale: "linear" };
  return src.run.m.coords[d];
}
export function indexer(values) {                     // nearest index, ascending or descending coordinates
  if (values.length < 2 || values[values.length - 1] >= values[0]) return v => R.nearestIndex(values, v);
  const rev = values.slice().reverse(), n = values.length;
  return v => { const k = R.nearestIndex(rev, v); return k < 0 ? -1 : n - 1 - k; };
}
/** The coordinate a pick is shown / typed in: `as` if the dim has it, else r_max if it has that, else its own. */
export function pickCoord(src, d, as = null) {
  const ch = coordChoices(src, d);
  return ch.find(c => c[0] === as) || ch.find(c => c[0] === "r_max") || ch[0];
}
/** Index along dim d: `value` is in d's own coordinate, or a variable ("$name") read in coordinate `as`. */
export function pickIndex(src, d, value, as = null) {
  if (isMeanPick(value)) return Math.floor(dimCoord(src, d).values.length / 2);   // averaged, not picked (v5.14)
  if (isRef(value)) {
    const vals = pickCoord(src, d, as)[2], v = numOf(value);
    return isFinite(v) ? Math.max(0, indexer(vals)(v)) : Math.floor(vals.length / 2);
  }
  const c = dimCoord(src, d).values;
  if (value === undefined || value === null) return Math.floor(c.length / 2);
  return Math.max(0, indexer(c)(value));
}
export const parseList = s => String(s ?? "").split(/[,\s]+/).filter(Boolean).map(Number).filter(isFinite);
export const extent = vals => { let a = Infinity, b = -Infinity; for (const v of vals) if (isFinite(v)) { if (v < a) a = v; if (v > b) b = v; } return [a, b]; };
export function isSpherical(src, xd, yd) {
  const g = src.run.m.geometry?.spherical;
  return !!g && xd !== yd && [xd, yd].every(d => d === g.r || d === g.theta);
}

// ---- constructors ------------------------------------------------------------------------------------------
/** v14.5.1 (architecture review Phase 3: "line at the slider's time" (`now`) = a vertical line in time mode — two stored
 *  forms of one thing): the line at the slider's time, drawn across whichever axis is time (none: not drawn). */
export const timeLine = (extra = {}) => newTool("line", { orient: "v", mode: "time", offset: 0, color: "#000000", dash: "dashed", width: 1, ...extra });
export const isTimeLine = t => t?.type === "line" && t.mode === "time";
export function newTool(type, extra = {}) {
  const base = { id: newId(), type, visible: true };
  if (type === "line") return { ...base, orient: "v", mode: "fixed", value: 0, offset: 0, color: "#555555", dash: "dotted", width: 1.2, ...extra };
  if (type === "contour") return { ...base, q: null, levelMode: "values", levels: "", color: "#39ff14", width: 1.2, ...extra };   // v15.0: q null = the map's own quantity
  // (D22: the averaged curve, fit, steps, steps from another plot and period are made by the analysis plugin,
  // plugins/analysis/)
  // v12.0 (draw): a band between two values, a point
  if (type === "band") return { ...base, orient: "v", lo: 0, hi: 1, alpha: 0.15, color: "#888888", label: null, ...extra };
  // v14.2: lineouts of a map (lineout.js): along x or y, at positions of the other axis (or a variable), its 1D plot
  if (type === "lineout") return { ...base, along: "x", at: [], plot: null, color: "#d6007a", dash: "dashed", width: 1.4, label: null, ...extra };
  if (type === "point") return { ...base, mode: "fixed", x: 0, y: 0, stat: "max", line: null, from: null, to: null, curveColors: true, size: 5, color: "#d6007a", label: null, ...extra };
  throw new Error(`unknown tool ${type}`);
}
// ---- draw (v12.0, human 2026-11-12: "why not just call it draw? like draw horizontal vertical, field lines etc"; "some of
// these draws we may as well be able to output to a variable like mean is a useful thing for instance") ---------------
// Everything that draws: a line (at a value / list / variable, at the slider's time, or from each curve: mean, max, min,
// x at the max …), a band, a point, field lines. v12.1: "draw" is a folder of the Tools tab with each as its own tool
// (horizontal line, vertical line, band, point, field lines); a line, band or point swaps to another of them in its card,
// field lines do not (setDrawKind). The types underneath stay (now, line, band, point, contour). A draw that reads its position off
// the data has values (TOOL_VALUES, shown in its card); v12.2: "→ variable" there makes a measured variable of the same
// reading (the v12.0 pins, "$name.value", are gone; old ones become measured variables on load, app.js).
export const DRAW_TYPES = ["line", "band", "point", "contour"];
export const isDraw = t => DRAW_TYPES.includes(t?.type);
export const DRAW_KINDS = [["hline", "horizontal line"], ["vline", "vertical line"], ["band", "band"], ["point", "point"], ["contour", "contours"]];   // v14.5.1: the slider's time is a vertical line's mode
export const drawKind = t => (t.type === "line" ? (t.orient === "h" ? "hline" : "vline") : t.type === "contour" ? "contour" : t.type);
/** Switch a draw tool to another kind in place (its id, look, label and name stay). */
/** v15.0 (plugins.js): ways to choose a contour tool's levels besides "at values": {key, label, title, levels(o)} where
 *  o = {levels (the numbers typed), frame, dims: [d0, d1], coords: [c0, c1], run} and it returns the contour values (the
 *  aperture4 plugin: field lines through r_max footpoints). */
export const CONTOUR_LEVELS = [];
export function registerContourLevels(m) {
  for (const f of ["key", "label", "levels"]) if (!(f in (m || {}))) throw new Error(`missing ${f}`);
  if (m.key === "values" || CONTOUR_LEVELS.some(x => x.key === m.key)) throw new Error(`there is already a level mode "${m.key}"`);
  CONTOUR_LEVELS.push(m);
}
export function setDrawKind(t, kind) {
  const keep = { id: t.id, visible: t.visible, dash: t.dash, width: t.width, label: t.label, name: t.name };
  const fresh = kind === "hline" || kind === "vline" ? newTool("line", { orient: kind === "hline" ? "h" : "v" })
    : newTool(kind);
  for (const k of Object.keys(t)) delete t[k];
  Object.assign(t, fresh, Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined && v !== null)));
  return t;
}
/** What a line / point can read off each curve. */
export const DATA_STATS = { h: [["mean", "each curve's mean"], ["max", "each curve's max"], ["min", "each curve's min"]],
  v: [["xmax", "x of each curve's max"], ["xmin", "x of each curve's min"], ["cross", "where each curve crosses"]],
  p: [["max", "each curve's max"], ["min", "each curve's min"]] };
/** One curve's statistic over a ≤ x ≤ b: {x, y} (mean: y only; cross: the first crossing of y = c), or null. */
export { curveStat } from "./stats.js";                // v14.4: statistics live in stats.js (one place)
/** A tool's values at its last draw on a plot: [{label, at, value, x, y}] (its card; "→ variable" there), per plot since
 *  a shared tool draws on every plot of its figure (v14.3.2). v14.4: result "tool:<id>" / <plot id> in results.js; `sig`
 *  (optional) says when it changed, and the plots made from the tool redraw then (the change bus). */
export const setToolValues = (panelId, tid, vals, sig = undefined) => putResult(`tool:${tid}`, panelId, vals, sig);
/** Its values on plot panelId, else on the plot that drew it last (a line that names only the tool). */
export const toolValues = (panelId, tid) => getResultOrLast(`tool:${tid}`, panelId);
export const dropToolValues = tid => dropResult(`tool:${tid}`);
const LABELS = () => ({ xlabel: null, ylabel: null, cbar: null });

export function settings2D(run, q) {
  const src = srcOf(run, q);
  const s = {
    run, q, xdim: null, ydim: null, meridional: true, mirror: false, picks: {}, timeMode: "follow", fixedTime: null,
    cmap: null, reverse: false, norm: "lin", linthresh: null, hide: null, limits: "frame", vmin: null, vmax: null, symmetric: null,
    decades: 4, abs: false, logx: false, logy: false, lockAspect: true, aspect: 0.8, view: null, tools: [], labels: LABELS(), cbarPos: "auto",
  };
  if (src) setAxes2D(s, src);
  return s;
}
export function setAxes2D(s, src, xd, yd) {
  const k = dataKindOf(src);
  if (k?.setMapAxes) { k.setMapAxes(s, src, xd, yd); return; }   // v15.1: a data kind's map sets its own axes
  const g = src.run.m.geometry?.spherical, d = src.spaceDims;
  if (!xd || !yd) {
    if (g && d.includes(g.r) && d.includes(g.theta)) { xd = g.r; yd = g.theta; }
    else if (d.length >= 2) { xd = d[d.length - 1]; yd = d[d.length - 2]; }   // v15.3: (…, y, x) data opens as x × y
    else { const all = src.hasTime ? ["time", ...d] : d; xd = all[0]; yd = all[1] ?? all[0]; }
  }
  s.xdim = xd; s.ydim = yd;
  const hint = k => k !== "time" && src.run.m.coords[k]?.scale === "log";
  s.logx = hint(xd); s.logy = hint(yd);
  s.view = null;
  if (isSpherical(src, xd, yd)) s.aspect = Math.max(s.aspect || 0, 1.0);
  if ((xd === "time" || yd === "time") && !s.tools.some(isTimeLine)) s.tools.push(timeLine({ color: "#ffffff" }));
}
export function settings1D(xaxis, run, ykind = null) {
  const s = {
    xaxis, ykind, run, lines: [], logx: axisInfo(xaxis).scale === "log", logy: false, abs: false,
    ylim: "auto", ymin: null, ymax: null, view: null, yview: null, aspect: 0.6, lockAspect: false, tools: [], labels: LABELS(),
  };
  if (xaxis === "time") s.tools.push(timeLine());
  return s;
}
export function newLine(run, q, extra = {}) {
  return { id: newId(), run, q, picks: {}, pickAs: {}, timeMode: "follow", fixedTime: null, label: null, color: null, dash: "solid", width: 1.6, visible: true, ...extra };
}
/** v3 1D "layers" (with series) -> lines (one per curve; legend styles carried over). */
export function newPanel(type, settings, extra = {}) {
  return { id: newId(), type, name: null, title: null, width: 560, pos: null, settings, link: null, ...extra };
}
export function cloneFresh(obj) {                     // deep copy with fresh ids (insert a setup, copy a panel)
  const c = clone(obj);
  const walk = o => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === "object") { if ("id" in o && typeof o.id === "number") o.id = newId(); Object.values(o).forEach(walk); }
  };
  walk(c);
  return c;
}

/** v2.x desktops had subpanels: each extra subpanel becomes its own panel, linked to the first. */
/** Defaults for panels read from storage (the v3 subpanel and v4 layer formats went in v8.1: no saved desktop or
 *  setup used them, checked 2026-10-14). */
export function migrate(panels) {
  return panels.map(p => ({ link: null, title: null, ...p }));
}

// ---- the desktop shown when nothing is saved yet -------------------------------------------------------------
/** Also sets S.vars: dataset variables A (and B) and the number variable rmax that the example panels use. */
export function defaultDesktop() {
  const runs = Object.keys(store.runs), out = [];
  S.vars = {};
  if (!runs.length) return out;
  for (const f of EXAMPLE_DESKTOPS) { const ps = f(runs); if (ps?.length) return ps; }   // a plugin's (aperture4)
  // v15.0: the plain core's example: the first dataset's first map and first quantity over time
  S.vars.A = { name: "A", type: "dataset", value: runs[0] };
  const srcs = Object.values(store.runs[runs[0]].sources || {}).filter(s => !s.isAn);
  const map = srcs.find(s => s.spaceDims.length === 2), series = srcs.find(s => s.hasTime && s.spaceDims.length === 0);
  if (map) out.push(newPanel("2d", settings2D("$A", map.name), { name: map.label || map.name }));
  if (series) { const s = settings1D("time", "$A", series.kind); s.lines.push(newLine("$A", series.name)); out.push(newPanel("1d", s, { name: series.label || series.name })); }
  return out;
}
/** v15.0 (plugins.js): a plugin's example desktop: f(datasets) -> plots (it may set S.vars); the first that gives plots wins. */
const EXAMPLE_DESKTOPS = [];
export function registerExampleDesktop(f) { if (typeof f !== "function") throw new Error("not a function"); EXAMPLE_DESKTOPS.push(f); }
/** v15.0 (plugins.js): names a plugin prefers as defaults: {scaleRef: [quantity names a scale "÷ max of …" starts on],
 *  configVars: [config keys ticked first when making config variables]}. */
export const PREFS = { scaleRef: [], configVars: [], timeUnits: "" };
export function registerDefaults(d) {
  if (!d || typeof d !== "object") throw new Error("not an object");
  for (const k of Object.keys(PREFS)) if (Array.isArray(d[k]) && Array.isArray(PREFS[k])) PREFS[k].push(...d[k]);
  if (typeof d.timeUnits === "string" && !PREFS.timeUnits) PREFS.timeUnits = d.timeUnits;   // v15.3: when a manifest has none
}
/** v15.3: the units of the time axis: the dataset's manifest (time_units, written by the data manager), else the first
 *  dataset's, else a plugin's default (aperture4: R⋆ per c), else none. */
export function timeUnits(run = null) {
  return run?.m?.time_units ?? Object.values(store.runs)[0]?.m?.time_units ?? (PREFS.timeUnits || "");
}

// ---- time range (v5.12, human 2026-10-06: "some runs are not the same length as others (for instance pairs1 crashed
// at around 70, is there a way I can change the available times?)"; "a long sim but only care about say post twist")
//   S.trange = {from, to, common, axes}: from / to a number or "$var" (unset = the data's own start / end);
//   common = only times every run on the desktop has (the range ends with the shortest run); axes: false = plots
//   with a time axis keep their full extent (default: they show the range unless they have their own window).
/** The time-dependent sources a panel shows. */
export function panelSources(panel) {
  const s = eff(panel);
  if (panel.type === "2d") { const src = srcOf(s.run, s.q); return src ? [src] : []; }
  return (s.lines || []).map(l => srcOf(l.run, l.q)).filter(Boolean);
}
const tTol = t => 1e-6 * Math.max(1, Math.abs(t));
/** The desktop's times: {all, times (inside the range; all of them if the range holds none), a, b, limited, empty,
 *  runs: [{run, t0, t1, n}] shortest first}. */
export function timeInfo() {
  const set = new Set(), runs = new Map();
  for (const p of S.panels) for (const src of panelSources(p)) {
    if (!src.hasTime || !src.times.length) continue;
    src.times.forEach(t => set.add(t));
    const r = runs.get(src.run.name) || { run: src.run.name, t0: Infinity, t1: -Infinity, n: 0 };
    r.t0 = Math.min(r.t0, src.times[0]); r.t1 = Math.max(r.t1, src.times.at(-1)); r.n = Math.max(r.n, src.times.length);
    runs.set(src.run.name, r);
  }
  const all = [...set].sort((x, y) => x - y), rs = [...runs.values()].sort((x, y) => x.t1 - y.t1), tr = S.trange || {};
  let a = num1(tr.from, -Infinity), b = num1(tr.to, Infinity);
  if (tr.common && rs.length > 1) { a = Math.max(a, ...rs.map(r => r.t0)); b = Math.min(b, rs[0].t1); }
  const limited = a > -Infinity || b < Infinity;
  const inR = limited ? all.filter(t => t >= a - tTol(a) && t <= b + tTol(b)) : all;
  return { all, times: inR.length ? inR : all, a, b, limited, empty: limited && !inR.length && all.length > 0, runs: rs };
}
/** The window plots with a time axis show: [a, b] (either may be infinite), or null = their full extent. */
export function timeWindow() {
  if (S.trange?.axes === false) return null;
  const w = timeInfo();
  return w.limited && !w.empty ? [w.a, w.b] : null;
}
/** A run that has ended (or not yet started) at time t keeps its last (first) frame: the note that says so. */
export function outsideNote(src, t) {
  if (!src?.hasTime || src.times.length < 2 || t === null || t === undefined) return null;
  const T = src.times, half = (T.at(-1) - T[0]) / (T.length - 1) / 2;
  if (t > T.at(-1) + half) return `${src.run.name} ends at t = ${R.fmt(T.at(-1))}: its last frame is shown`;
  if (t < T[0] - half) return `${src.run.name} starts at t = ${R.fmt(T[0])}: its first frame is shown`;
  return null;
}

/** A function line y = f(x) (v5.13) rather than a recorded datatype. Analytic lines (v7) are function lines too. */
export const isFn = l => typeof l?.fn === "string";

// ---- analytic functions (v7, human 2026-10-13: "a more general thing … define a new thing like
// Twist_angle_analytic = 2 * {line_current} * {r_max}^2 * sqrt(1 - 1/{r_max}) / {Bp} … when I then pull it into the
// function plotter gives me those things as options to put in numbers or variables") --------------------------------
//   line = { id, an: name, fn: its formula (kept so the line works where the definition is missing), run: the dataset
//            its data / config parameters come from, bind: {param: binding}, label, color, dash, width, visible }
//   binding = {mode: "x"} the panel's x axis · {mode: "value", value: number | "$var"} (a list: one curve per value)
//           · {mode: "data", q} a datatype of the line's dataset, read where the curve is (its x, the time, and the
//             value of a parameter named like its other dims: {r_max} …) · {mode: "conf", key} a config number
//           · {mode: "time"} the slider's time
/** An analytic line (v7). */
export const isAn = l => typeof l?.an === "string";
/** The analytic function a line uses: the desktop's definition (it follows edits), else the formula the line keeps. */
export function anDef(line) {
  const d = store.analytics?.[line.an];
  if (d) return d;
  try { const c = compileAnalytic(line.fn); return { name: line.an, formula: line.fn, label: line.anLabel || line.an, kind: line.anKind || line.anLabel || line.an, params: c.params, f: c.f, missing: true }; }
  catch (e) { return { name: line.an, formula: line.fn, label: line.an, params: [], error: e.message }; }
}
/** How each parameter is filled: the line's choice, else the automatic one (anDefault). */
export function anBindings(line, xaxis) {
  const run = store.runs[runOf(line.run)], out = {};
  for (const p of anDef(line).params) out[p] = line.bind?.[p] ?? anDefault(p, xaxis, run);
  return out;
}
/** The automatic choice for parameter p, from its name: the panel's x axis (same name; t / time on a time axis) · a
 *  datatype of the dataset · a config number · a number / measured variable · t / time = the slider's time · else a
 *  value to type ("each variable is a possible axis": any parameter can be set to the x axis by hand). */
export function anDefault(p, xaxis, run) {
  const isT = p === "t" || p === "time";
  if (p === xaxis || (isT && xaxis === "time")) return { mode: "x" };
  if (run?.sources[p] && !run.sources[p].isAn) return { mode: "data", q: p };
  if (typeof run?.conf?.[p] === "number") return { mode: "conf", key: p };
  if (["number", "measured", "config", "fit"].includes(S.vars?.[p]?.type)) return { mode: "value", value: "$" + p };
  if (isT) return { mode: "time" };
  return { mode: "value", value: null };
}
/** A new analytic line for definition `def` (data and config parameters from dataset `run`). */
export function newAnalyticLine(def, run) {
  return { id: newId(), an: def.name, fn: def.formula, anLabel: def.label, anKind: def.kind, run, bind: {}, label: null, color: null, dash: "solid", width: 1.6, visible: true };
}

/** A line's pick that averages its dim instead of picking a value (v5.14, human 2026-10-06: "mean along s/smax"):
 *  {mean: true, from, to} in the dim's shown coordinate (from / to: numbers or variables; null = the whole dim). */
export const isMeanPick = p => !!p && typeof p === "object" && p.mean === true;

// ---- per-tool sharing (v5.15, human 2026-10-06: "make each tool used a choice to link or unlink") -----------------
//   In a linked panel the group's tools are shared; settings.ownTools are this panel's own tools (an own copy of a
//   shared tool remembers it in .of) and settings.hideShared the ids of shared tools this panel does not draw.
/** Share tool t with the linked panels (share = true) or make it this panel's own; the other panels keep theirs. */
export function setToolShared(p, t, share) {
  const g = groupOf(p);
  if (!g) return;
  if (!("tools" in g.settings)) {                       // a group without a tools list: every member's tools are its own
    for (const q of membersOf(g.id)) { q.settings.ownTools = [...(q.settings.ownTools || []), ...(q.settings.tools || [])]; delete q.settings.tools; }
    g.settings.tools = [];
  }
  if (p.link.own.includes("tools")) {                    // all tools own (before v5.15): the same, per tool
    p.settings.ownTools = [...(p.settings.ownTools || []), ...(p.settings.tools || [])];
    p.settings.hideShared = [...new Set([...(p.settings.hideShared || []), ...g.settings.tools.map(x => x.id)])];
    p.link.own = p.link.own.filter(k => k !== "tools"); delete p.settings.tools;
  }
  const shared = g.settings.tools, own = p.settings.ownTools || [], hide = p.settings.hideShared || [];
  if (share) {
    p.settings.ownTools = own.filter(x => x !== t);
    if (t.of != null && shared.some(x => x.id === t.of)) p.settings.hideShared = hide.filter(id => id !== t.of);   // back to the shared one
    else { const n = { ...t }; delete n.of; shared.push(n); }
  } else {
    p.settings.ownTools = [...own, { ...clone(t), id: newId(), of: t.id }];
    p.settings.hideShared = [...hide, t.id];
  }
}
