// linekinds.js — the line-source registry (v14.4, architecture review §5.6, P1). A 1D plot's line is one of:
//   - a recorded quantity of a dataset (the default: panel1d.js lineCurve reads it from the store);
//   - a function y = f(x) or an analytic function (model.js isFn / isAn; panel1d.js fnCurve / analyticCurve);
//   - a line made by a tool or a table: one entry below each.
// Every place that needs to know what a made line does asks this registry (madeKind) instead of its own if-chain: how
// it expands into curves, computes a curve, is named, is coloured and edited, what it depends on, and what it can do.
// Before v14.4 each kind added 5–8 such branches by hand, and the missed ones were the "undefined · …" bugs.
//
// Adding a kind: one entry here (every field), plus its module (expansions, curve, name) and its editor (lines.js).
// tools/check.mjs checks every entry has every field.
import { isFn, isAn, setLineYId, setLineYKind, datasetColor, toolValues } from "./model.js";
import { isTab, tableExpansions, tableCurve, tabLineText } from "./tables.js";
import { isCyc, cycExpansions, cycCurve, cycLineText } from "./cycleplots.js";
import { isLo, loExpansions, loCurve, loLineText, loLineColor } from "./lineout.js";
import { editTab, editCyc, editLo } from "./lines.js";

// Calls go through arrows, so the modules can import each other in any order.
// caps (what the line can do; false = it can't):
//   slider     its values move with the time slider (a reading on it is ⏱; a period reading can use it)
//   perDataset a reading on it can be recomputed for another dataset (else: its own value only)
//   smooth     the plot's smoothing along x applies to it
// colour(l, sub): the colour of one of its curves (null: the plot picks one), so a list owns its colours (RULES P4).
// deps(l): what it reads, so redraws can find it: {tool} a tool's id, {output} a named tool's output, {table} a table.
// yId(l): what it draws on a y axis (v14.4.1): two plots without a y-axis group share a y range only when these match.
// yKind(l) (optional, v15.0): its y-axis group (e.g. "foot-gap width"); without it the line has none of its own.
// v15.0: foot gaps and across lines are registered by the aperture4 plugin (plugins/aperture4/).
export const LINE_KINDS = [
  { key: "tab", label: "table", is: l => isTab(l),
    expand: l => tableExpansions(l), curve: (s, l, sub) => tableCurve(s, l, sub), name: l => tabLineText(l),
    editor: (...a) => editTab(...a), colour: (l, sub) => ((l.tab.by ?? "dataset") === "dataset" ? datasetColor(sub.tab) : null),
    deps: l => ({ table: l.tab.table }), yId: l => `tab:${l.tab.table}/${l.tab.y}`,
    caps: { slider: false, perDataset: false, smooth: false } },
  { key: "cyc", label: "period tool", is: l => isCyc(l),
    expand: l => cycExpansions(l), curve: (s, l, sub) => cycCurve(s, l, sub), name: l => cycLineText(l),
    editor: (...a) => editCyc(...a), colour: (l, sub) => toolValues(l.cyc.panel ?? null, l.cyc.tool)?.curves?.[sub.k]?.color ?? null,
    deps: l => ({ tool: l.cyc.tool }), yId: l => `cyc:${l.cyc.what}`,
    caps: { slider: false, perDataset: false, smooth: false } },
  { key: "lo", label: "lineout", is: l => isLo(l),
    expand: l => loExpansions(l), curve: (s, l, sub, fns) => loCurve(s, l, sub, fns), name: l => loLineText(l),
    editor: (...a) => editLo(...a), colour: (l, sub) => loLineColor(l, sub.k), deps: l => ({ tool: l.lo.tool }), yId: l => `lo:${l.lo.map}/${l.lo.tool}`,   // v14.3: map line = curve
    caps: { slider: true, perDataset: false, smooth: true } },

];
export const LINE_KIND_FIELDS = ["key", "label", "is", "expand", "curve", "name", "editor", "colour", "deps", "yId", "caps"];
/** v14.9 (plugins.js): a plugin adds a kind of made line. Every field is required (colour may be null); a key that
 *  exists is refused. */
export function registerLineKind(k) {
  const missing = LINE_KIND_FIELDS.filter(f => !(f in (k || {})));
  if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
  if (LINE_KINDS.some(x => x.key === k.key)) throw new Error(`there is already a line kind "${k.key}"`);
  for (const f of ["is", "expand", "curve", "name", "editor", "deps", "yId"]) if (typeof k[f] !== "function") throw new Error(`${f} is not a function`);
  LINE_KINDS.push({ ...k, caps: { slider: true, perDataset: true, smooth: true, ...k.caps } });
}

/** The registry entry of a line made by a tool or a table, or null (a recorded quantity, a function). */
export const madeKind = l => (l ? LINE_KINDS.find(k => k.is(l)) ?? null : null);
/** A line read from a recorded quantity (it has a source and a dataset), not a function nor a made line. */
export const isRecordedLine = l => !isFn(l) && !isAn(l) && !madeKind(l);
/** Can line l do `cap` (registry caps)? Recorded lines and functions can do everything. */
export const lineCan = (l, cap) => madeKind(l)?.caps[cap] !== false;
/** Does line l read this {tool | output | table}? (true: any of that kind, e.g. {table: true}) */
export function lineReads(l, what) {
  const d = madeKind(l)?.deps(l);
  return !!d && Object.entries(what).some(([k, v]) => v != null && d[k] != null && (v === true || d[k] === v));
}

// v14.4.1: model.js yAxisId asks the registry what a made line draws
setLineYId(l => madeKind(l)?.yId(l) ?? null);
setLineYKind(l => madeKind(l)?.yKind?.(l) ?? null);   // v15.0
