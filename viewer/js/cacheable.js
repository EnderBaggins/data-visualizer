// cacheable.js — what could be cached for a dataset but is not yet, and computing it from the viewer (v11.4).
//
// Human 2026-11-12: "when it comes to picking data in the visualizer it might be nice to see things that CAN be cached but
// arent and have visualizer request the cache"; "simplest would be a color difference when picking or a small symbol";
// a dataset you added on the data manager page with nothing cached yet is offered too; a method that needs a dump field
// the run never wrote (pair counts in a no-pair run) is not offered there.
//
// The data manager's status (serve.py GET api/dm/status) lists every saved method (its axes, label, y-axis group and the
// dump fields it needs) and every registered dataset (its dump fields, number of outputs). A quantity is offered for a
// dataset (marked ◌ in the menus) when the dataset is a simulation, its dumps have every field the method needs, and the
// quantity is not stored there. Choosing one draws nothing yet: the panel says it is not cached and offers "compute",
// which starts the same cache job as the data manager page (POST api/dm/cache, the page's token in this browser). Its
// progress (GET api/dm/jobs) shows in the panel, and the dataset is read again every ~10 outputs, so a map fills in as
// the outputs arrive. Only with serve.py (and its datamgr): without it nothing is offered and nothing changes.
import { el, popover, closePopover } from "./ui.js";

export const MARK = "◌ ";
const TOKEN_KEY = "aptvis.dmtoken";                     // the data manager page's (same site)
let DM = null;                                          // {methods: Map, families: Map, datasets: Map}
let HOOKS = { store: null, apiUrl: null, onRun: async () => false, onIndex: () => {}, toast: () => {} };
const JOBS = new Map();                                 // job id -> its progress file (api/dm/jobs)
const SEEN = new Map();                                 // job id -> outputs done when the dataset was last read
const PENDING = [];                                     // [{run, apply}]: a dataset picked before anything was stored
const BOXES = new Set();                                // the compute boxes on screen (their progress is kept current)
let pollTimer = null;

/** Start: read the data manager's status (if serve.py has the datamgr). onRun(name) reads one dataset again; onIndex()
 *  rebuilds the menus when the status arrives or changes. */
export async function initCacheable(hooks) {
  HOOKS = { ...HOOKS, ...hooks };
  await reloadIndex();
  poll();                                               // jobs already running (the data manager page, a notebook)
}
async function reloadIndex() {
  try {
    const r = await fetch(HOOKS.apiUrl("dm/status"), { cache: "no-store" }), j = r.ok ? await r.json() : null;
    if (!j?.ok) return;
    DM = {
      methods: new Map(j.methods.map(m => [m.name, m])),
      families: new Map((j.families || []).map(f => [f.name, f])),
      datasets: new Map(j.datasets.map(d => [d.name, d])),
    };
    HOOKS.onIndex();
  } catch { /* no data manager: nothing offered */ }
}

const dataset = run => DM?.datasets.get(run);
const store = () => HOOKS.store;
/** The method that makes stored quantity q (a family member: its member entry). */
export const methodOf = q => DM?.methods.get(q) || null;
/** The dims q is stored over: time first (a per-output method gets time added). */
export const storedDims = m => (m.axes[0] === "time" ? m.axes : ["time", ...m.axes]);
/** Can dataset `run` have quantity q computed (and does not have it)? */
export function canCompute(run, q) {
  const d = dataset(run), m = methodOf(q);
  if (!d || !m || d.kind === "derived" || !d.fields || d.archived) return false;
  if (store()?.runs[run]?.sources[q]) return false;
  return (m.needs || []).every(f => d.fields.includes(f));
}
/** Every quantity dataset `run` could have computed: [{name, label, section, kind, units, dims}]. */
export function cacheables(run) {
  if (!DM) return [];
  return [...DM.methods.values()].filter(m => canCompute(run, m.name)).map(m => ({
    name: m.name, label: m.label, section: m.group || m.section || "other", kind: m.yaxis || m.quantity || m.label,
    units: m.units || "", dims: storedDims(m) }));
}
/** Datasets added on the data manager page with nothing stored yet (simulations whose dumps can be read). */
export const ghostRuns = () => (DM ? [...DM.datasets.values()].filter(d => !d.stored && d.kind !== "derived" && !d.archived && d.fields
  && !store()?.runs[d.name]).map(d => d.name) : []);
export const isGhost = run => ghostRuns().includes(run);

/** Everything computed with q: a family member brings its whole family. */
function partsOf(q) {
  const m = methodOf(q), f = m?.family ? DM.families.get(m.family) : null;
  return f ? f.members : [q];
}
/** Outputs and MB of computing `names` for `run` (stored as the cacher stores: maps float16 per output, the rest float32). */
export function estimate(run, names) {
  const d = dataset(run), n = d?.outputs || 0;
  const len = dim => {
    for (const r of [store()?.runs[run], ...Object.values(store()?.runs || {})]) { const c = r?.m.coords?.[dim]; if (c) return c.values.length; }
    return 512;
  };
  let bytes = 0;
  for (const name of new Set(names.flatMap(partsOf))) {
    const m = methodOf(name);
    if (!m) continue;
    const size = storedDims(m).filter(x => x !== "time").reduce((a, x) => a * len(x), 1);
    bytes += n * size * (size >= 65536 ? 2 : 4);
  }
  return { outputs: n, MB: bytes / 1e6 };
}
export const fmtMB = x => (x >= 1000 ? `${(x / 1000).toFixed(1)} GB` : x < 0.1 ? "< 0.1 MB" : `${x >= 10 ? Math.round(x) : x.toFixed(1)} MB`);
export const labelOf = q => methodOf(q)?.label || q;

// ---- jobs ---------------------------------------------------------------------------------------------------------
/** The running (or waiting) job that computes q for run, if any. */
export function jobFor(run, q) {
  const m = methodOf(q), fam = m?.family;
  for (const j of JOBS.values()) {
    if (!["running", "waiting"].includes(j.state) || !(j.runs || []).includes(run)) continue;
    if ((j.methods || []).some(x => x === q || x === fam)) return j;
  }
  return null;
}
/** Start computing `names` for `run` (the data manager's cache job). */
export async function startCompute(run, names) {
  const token = localStorage.getItem(TOKEN_KEY) || "";
  if (!token) { askToken(() => startCompute(run, names)); return null; }
  try {
    const r = await fetch(HOOKS.apiUrl("dm/cache"), { method: "POST", headers: { "Content-Type": "application/json", "X-Token": token },
      body: JSON.stringify({ names, runs: [run] }) });
    const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    if (!j.ok) {
      if (r.status === 403) { localStorage.removeItem(TOKEN_KEY); askToken(() => startCompute(run, names)); return null; }
      HOOKS.toast(`computing ${names.map(labelOf).join(", ")} for ${run} did not start: ${j.error}`, true);
      return null;
    }
    JOBS.set(j.job, { id: j.job, state: "running", methods: names, runs: [run], run, done: 0, total: 0 });
    SEEN.set(j.job, 0);
    HOOKS.toast(`computing ${names.map(labelOf).join(", ")} for ${run}: it fills in as the outputs arrive`);
    refreshBoxes(); poll();
    return j.job;
  } catch (e) { HOOKS.toast(`could not reach serve.py: ${e.message}`, true); return null; }
}
/** The page's token, asked once (the data manager page keeps it in this browser too). */
function askToken(then) {
  const inp = el("input", { type: "text", size: 26, placeholder: "token from serve.py's terminal" });
  const go = () => { const v = inp.value.trim(); if (!v) return; localStorage.setItem(TOKEN_KEY, v); closePopover(); then(); };
  inp.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  popover(innerWidth / 2 - 160, 120, [el("div", { class: "pop-title" }, "computing needs serve.py's token (once)"),
    el("div", { class: "dim", style: "max-width:340px;margin:2px 0 6px;white-space:normal" }, "serve.py printed it when it started (also in visualizer/.serve_token); the data manager page asks for the same one."),
    el("div", { class: "pop-row" }, inp, el("button", { class: "on", onclick: go }, "use"), el("button", { onclick: closePopover }, "cancel"))]);
  inp.focus();
}
async function cancel(job) {
  const r = await fetch(HOOKS.apiUrl("dm/cancel"), { method: "POST", headers: { "Content-Type": "application/json", "X-Token": localStorage.getItem(TOKEN_KEY) || "" },
    body: JSON.stringify({ job }) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  HOOKS.toast(j.ok ? "stopped (what was stored stays)" : `could not stop it: ${j.error || "serve.py not reachable"}`, !j.ok);
  poll();
}
/** Read the jobs every 3 s while one is running; read a dataset again every ~10 new outputs (the cacher stores in tens)
 *  and when its job ends; rebuild the menus when a job ends (what is stored changed). */
async function poll() {
  clearTimeout(pollTimer);
  let list = [];
  try { const r = await fetch(HOOKS.apiUrl("dm/jobs"), { cache: "no-store" }); list = r.ok ? (await r.json()).jobs || [] : []; } catch { return; }
  let ended = false;
  for (const j of list) {
    const before = JOBS.get(j.id);
    if (!before && !["running", "waiting"].includes(j.state)) continue;      // finished before this page opened
    JOBS.set(j.id, j);
    const run = j.run || j.runs?.[0], done = j.done || 0;
    if (!SEEN.has(j.id)) SEEN.set(j.id, done);
    const fin = !["running", "waiting"].includes(j.state);
    if (run && (fin || done - SEEN.get(j.id) >= 10)) {
      SEEN.set(j.id, done);
      if (await HOOKS.onRun(run)) for (const p of PENDING.filter(p => p.run === run)) { PENDING.splice(PENDING.indexOf(p), 1); try { p.apply(); } catch { /* its menu is gone */ } }
    }
    if (fin && before && ["running", "waiting"].includes(before.state)) {
      ended = true;
      if (j.state !== "done") HOOKS.toast(`computing for ${run} ${j.state}${j.error ? `: ${j.error}` : ""}`, true);
    }
  }
  if (ended) await reloadIndex();
  refreshBoxes();
  if ([...JOBS.values()].some(j => ["running", "waiting"].includes(j.state))) pollTimer = setTimeout(poll, 3000);
}

// ---- what the panels show ------------------------------------------------------------------------------------------
/** The compute line for a panel's status: "◌ E∥ is not cached for pairs-10 · compute (201 outputs · 100 MB)", or the
 *  progress of the job computing it. names: the quantities of this dataset the panel lacks. */
export function computeBox(run, names) {
  const box = el("span", { class: "cbox" });
  box._run = run; box._names = names;
  fillBox(box);
  BOXES.add(box);
  return box;
}
function fillBox(box) {
  const { _run: run, _names: names } = box, job = names.map(q => jobFor(run, q)).find(Boolean);
  const what = names.map(labelOf).join(", ");
  if (job) {
    const eta = job.eta_s ? ` · about ${job.eta_s < 90 ? `${Math.max(1, Math.round(job.eta_s))} s` : `${Math.round(job.eta_s / 60)} min`} left` : "";
    const where = job.state === "waiting" ? "waiting for the job before it on this dataset" : job.total ? `${job.done}/${job.total} outputs${eta}` : "starting";
    box.replaceChildren(`⏳ computing ${what} for ${run}: ${where} `, el("button", { class: "small", onclick: () => cancel(job.id), title: "stop it (what is stored stays)" }, "stop"));
  } else {
    const e = estimate(run, names);
    box.replaceChildren(`${MARK}${what} ${names.length > 1 ? "are" : "is"} not cached for ${run} `,
      el("button", { class: "small on", title: "compute it on the storage server (the data manager's cache job; workers: half of the server's free cores)",
        onclick: () => startCompute(run, names) }, `compute (${e.outputs} outputs · ${fmtMB(e.MB)})`));
  }
}
function refreshBoxes() {
  for (const b of [...BOXES]) { if (!b.isConnected) BOXES.delete(b); else fillBox(b); }
}

// ---- tags from the plot (v11.8.1, human 2026-11-12: "can i add tag from visualizer? basiclly rn I will see if there is
// cycle then add to has cycle") ----------------------------------------------------------------------------------------
/** Can this page change tags (serve.py with the datamgr)? */
export const canTag = () => !!HOOKS.apiUrl && !!HOOKS.store;
/** Tag / untag the datasets `runs` (a plot's) — their data manager cards, notes kept; the menus then show it, and lists
 *  that follow a tag take it up at once. */
export function tagForm(runs, x, y) {
  const st = store(), cards = st?.cards || {}, tagsOf = r => cards[r]?.tags || [];
  const all = [...new Set(Object.values(cards).flatMap(c => c?.tags || []))].sort();
  const picked = new Set(runs.length === 1 ? runs : []), add = new Set(), drop = new Set();
  const inp = el("input", { type: "text", size: 20, placeholder: "new tag, e.g. has cycle" });
  const tagRow = t => {
    const cb = el("input", { type: "checkbox" });
    const sync = () => { const ps = [...picked], have = ps.filter(r => tagsOf(r).includes(t)).length;
      cb.checked = add.has(t) || (!drop.has(t) && ps.length > 0 && have === ps.length); cb.indeterminate = !add.has(t) && !drop.has(t) && have > 0 && have < ps.length; };
    cb.addEventListener("change", () => { add.delete(t); drop.delete(t); (cb.checked ? add : drop).add(t); });
    cb._sync = sync; sync();
    return el("label", { class: "chk" }, cb, " #" + t);
  };
  const tagRows = all.map(tagRow);
  const runRows = runs.map(r => el("label", { class: "chk", title: tagsOf(r).length ? `tags now: ${tagsOf(r).map(t => "#" + t).join(" ")}` : "no tags yet" },
    el("input", { type: "checkbox", checked: picked.has(r), onchange: e => { if (e.target.checked) picked.add(r); else picked.delete(r); tagRows.forEach(l => l.querySelector("input")._sync()); } }),
    ` ${r}${tagsOf(r).length ? "  · " + tagsOf(r).map(t => "#" + t).join(" ") : ""}`));
  const save = async () => {
    const nt = inp.value.trim().replace(/^#/, "");
    if (nt) { if (/[,\n]/.test(nt) || nt.length > 30) return HOOKS.toast("a tag: no commas, at most 30 characters", true); add.add(nt); }
    if (!picked.size) return HOOKS.toast("tick the dataset(s) to tag", true);
    if (!add.size && !drop.size) return closePopover();
    const token = localStorage.getItem(TOKEN_KEY) || "";
    if (!token) { closePopover(); askToken(() => tagForm(runs, x, y)); return; }
    closePopover();
    const bad = [];
    // v14.3.2: the cards as they are now (notes edited on the data manager page since this plot loaded them were
    // overwritten with the old ones: the server's card call sets notes and tags together)
    try { await st.loadCards(); } catch { /* offline: the cards loaded before */ }
    const card = r => st.cards?.[r] ?? cards[r], tagsNow = r => card(r)?.tags || [];   // a failed reload: the ones from before
    for (const r of picked) {
      const cur = tagsNow(r), next = [...cur.filter(t => !drop.has(t)), ...[...add].filter(t => !cur.includes(t))];
      if (next.join(",") === cur.join(",")) continue;
      try {
        const res = await fetch(HOOKS.apiUrl("dm/meta"), { method: "POST", headers: { "Content-Type": "application/json", "X-Token": token },
          body: JSON.stringify({ action: "card", name: r, notes: card(r)?.notes || "", tags: next.join(", ") }) });
        const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
        if (res.status === 403) { localStorage.removeItem(TOKEN_KEY); bad.push(`${r}: the token was not accepted (asked again next time)`); }
        else if (!j.ok) bad.push(`${r}: ${j.error}`);
      } catch (e) { bad.push(`${r}: ${e.message}`); }
    }
    await st.loadCards();                                 // the new tags: menus, tooltips, lists following a tag
    HOOKS.onIndex();
    HOOKS.toast(bad.length ? `could not tag ${bad.join("; ")}` : `tagged ${[...picked].join(", ")}`, !!bad.length);
  };
  inp.addEventListener("keydown", e => { if (e.key === "Enter") save(); });
  popover(x, y, [el("div", { class: "pop-title" }, "tag the plot's dataset" + (runs.length > 1 ? "s" : "")),
    runs.length > 1 ? el("div", { class: "np-list" }, runRows) : el("div", { class: "dim" }, runs[0]),
    tagRows.length ? el("div", { class: "np-list" }, tagRows) : null,
    el("div", { class: "pop-row" }, el("span", { class: "lab" }, "new"), inp),
    el("div", { class: "dim", style: "max-width:320px;white-space:normal;margin:2px 0 6px" }, "Tags are the data manager's (its tags block, a grid per tag); a dataset list in the visualizer can follow one."),
    el("div", { class: "pop-row" }, el("button", { class: "on", onclick: save }, "save"), el("button", { onclick: closePopover }, "cancel"))]);
  inp.focus();
}

/** A dataset picked in a menu that has nothing stored yet: offer to compute the plot's quantity for it; once its first
 *  outputs are stored the choice is made (apply). */
export function ghostPick(run, q, apply, anchor) {
  const r = anchor?.getBoundingClientRect?.() || { left: innerWidth / 2 - 160, bottom: 120 };
  const ok = q && canCompute(run, q), e = ok ? estimate(run, [q]) : null;
  popover(r.left, r.bottom + 4, [el("div", { class: "pop-title" }, `${MARK}${run}: nothing cached yet`),
    ok ? el("div", { class: "dim", style: "max-width:340px;margin:2px 0 6px;white-space:normal" }, `Compute ${labelOf(q)} for it (${e.outputs} outputs · ${fmtMB(e.MB)})? The plot switches to it when the first outputs are stored.`)
       : el("div", { class: "dim", style: "max-width:340px;margin:2px 0 6px;white-space:normal" }, `${q ? `${labelOf(q)} cannot be computed for it (its dumps lack a field it needs). ` : ""}Cache something for it on the data manager page (🗂 data).`),
    el("div", { class: "pop-row" },
      ok ? el("button", { class: "on", onclick: async () => { closePopover(); if (await startCompute(run, [q])) PENDING.push({ run, apply }); } }, "compute") : null,
      el("button", { onclick: closePopover }, ok ? "cancel" : "close"))]);
}
