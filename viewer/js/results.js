// results.js — one store for every number the viewer measures, and one change signal (v14.4, architecture review §5.4,
// P2). Pure: no DOM, tested in node (tools/check.mjs).
//
// A result is what one OWNER measured in one SCOPE:
//   owner  "tool:<id>"       a tool's values at its last draw (its card, → table, → variable, the period tool's plots)
//          "reading:<name>"  a reading (measured variable)
//          "fit:<name>"      a fit variable
//          "output:<name>"   a named tool's output (steps)
//   scope  a plot's id       (a tool drawn on that plot; a shared tool has one result per plot it draws on)
//          "own"             a variable's own line, or an output
//          "run:<dataset>"   a reading or fit computed for one dataset
// The payload is the owner's own shape (a list of {at, value …} for tool cards, {val, at} for readings and fits). Where
// each value was measured is an `at` = {run, d: {dim: value}}; samePoint is the one rule for "the same dataset and
// picks", and valueAt / findAt the one lookup. Before v14.4: six Maps, three matchers and their own notify hooks.

const STORE = new Map();                                  // owner -> Map(scope -> {payload, sig})
const LAST = new Map();                                   // owner -> the scope written last
const LISTENERS = new Set();

/** The same dataset and picks? A missing run on either side matches any; a pick only one side has is ignored.
 *  Picks match within a relative tolerance (1e-9; a hand-typed table row: 1e-6). */
export function samePoint(a, b, tol = 1e-9) {
  if (!a || !b) return false;
  if (a.run && b.run && a.run !== b.run) return false;
  const ad = a.d || {}, bd = b.d || {};
  return Object.keys(ad).every(k => !(k in bd) || sameNum(ad[k], bd[k], tol));
}
export const sameNum = (a, b, tol = 1e-9) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(a)));
/** The value in `vals` (one, or one per curve) measured at the same point as `at` (`where`: where each was measured); NaN. */
export function valueAt(vals, where, at) {
  const list = Array.isArray(vals) ? vals : [vals];
  for (let k = 0; k < (where || []).length; k++) if (where[k] && samePoint(where[k], at)) return list[k] ?? NaN;
  return NaN;
}
/** The item of `items` measured at the same point as `at` (its own `.at`), or null. */
export const findAt = (items, at, tol = 1e-9) => (at ? (items || []).find(x => x?.at && samePoint(x.at, at, tol)) ?? null : null);

/** Store owner's result in a scope. `sig` (optional) says when it changed (else the payload as JSON); listeners hear
 *  only real changes. Returns whether it changed. */
export function putResult(owner, scope, payload, sig = undefined) {
  const s = sig === undefined ? JSON.stringify(payload) : sig;
  let m = STORE.get(owner);
  if (!m) STORE.set(owner, (m = new Map()));
  LAST.set(owner, scope);
  if (m.has(scope) && m.get(scope).sig === s) return false;
  m.set(scope, { payload, sig: s });
  for (const fn of LISTENERS) fn(owner, scope);
  return true;
}
/** Owner's result in `scope` (null: the scope written last), or undefined. */
export function getResult(owner, scope = null) {
  const m = STORE.get(owner);
  if (!m) return undefined;
  return m.get(scope ?? LAST.get(owner))?.payload;
}
/** Owner's result in `scope`, else in the scope written last (a line that names only the tool). */
export const getResultOrLast = (owner, scope) => getResult(owner, scope) ?? getResult(owner, null);
/** Every scope of an owner with its payload: [[scope, payload]]. */
export const resultScopes = owner => [...(STORE.get(owner) || new Map())].map(([k, v]) => [k, v.payload]);
/** Every owner starting with `prefix` ("output:"): their names after it. */
export const resultOwners = prefix => [...STORE.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
/** Forget a result: one scope, or every scope of the owner. */
export function dropResult(owner, scope = undefined) {
  if (scope === undefined) { STORE.delete(owner); LAST.delete(owner); return; }
  STORE.get(owner)?.delete(scope);
}
/** Forget every scope of an owner whose name passes `keep` = false (e.g. datasets no longer measured). */
export function keepScopes(owner, keep) { const m = STORE.get(owner); if (m) for (const k of [...m.keys()]) if (!keep(k)) m.delete(k); }
/** An owner renamed (a variable, a tool's output). */
export function renameResult(oldOwner, newOwner) {
  if (!STORE.has(oldOwner)) return;
  STORE.set(newOwner, STORE.get(oldOwner)); STORE.delete(oldOwner);
  if (LAST.has(oldOwner)) { LAST.set(newOwner, LAST.get(oldOwner)); LAST.delete(oldOwner); }
}
/** The change bus: fn(owner, scope) after a result changed. Returns a function that unsubscribes. */
export function onResult(fn) { LISTENERS.add(fn); return () => LISTENERS.delete(fn); }
/** Everything (a new desktop, a test). */
export function clearResults() { STORE.clear(); LAST.clear(); }
