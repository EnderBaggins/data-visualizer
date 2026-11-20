// views.js — saved desktops and panel setups (human 2026-10-01). Stored as files in visualizer/views/
// through serve.py's small API; if the viewer is served without it, they go to browser storage instead.
//
//   views/desktops/<name>.json  = { version: 8, panels: [the panels themselves], groups, vars, t, fps, loop, expressions }
//   views/templates/<name>.json = { type, label, tag, panel, vars, thumb } — a panel saved on purpose (v8.1)
//   views/panels/<name>.json    = panel setups of desktops saved before v8.1 ({panels: [{ref}]}); still read, never
//                                 written (UI review §F, human 2026-10-14: desktops kept rewriting each other's panels)
//
// Paths are relative to the visualizer root (the folder that holds data/ and views/), found from the
// data location — so the API works behind a proxied address and from versions/vN/ too (bug fix
// 2026-10-01, wiki debugging/visualizer-save-not-reaching-server).
let hasApi = null, ROOT = "/", FEATURES = [];
const LS = "aptvis.views.";

/** dataBase = the store's data URL (e.g. "../data/"); the root is its parent folder. */
export function setRoot(dataBase) { ROOT = new URL("../", new URL(dataBase, location.href)).href; hasApi = null; }

export async function apiAvailable(recheck = false) {
  if (hasApi === true || (hasApi === false && !recheck)) return hasApi;
  try { const r = await fetch(ROOT + "api/ping", { cache: "no-store" }), j = r.ok ? await r.json() : {}; hasApi = j.ok === true; FEATURES = j.features || []; }
  catch { hasApi = false; FEATURES = []; }
  return hasApi;
}
/** Does the running serve.py offer this API ("cols" = r-band downloads, v5.1)? Ask apiAvailable() first. */
export const hasFeature = f => hasApi === true && FEATURES.includes(f);
export const apiUrl = p => ROOT + "api/" + p;

export async function listViews() {
  if (await apiAvailable(true)) {
    const r = await fetch(ROOT + "api/views", { cache: "no-store" });
    if (!r.ok) throw new Error(`listing views: HTTP ${r.status}`);
    return r.json();
  }
  const out = { desktops: [], panels: [], templates: [] };
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k.startsWith(LS)) continue;
    const [kind, ...rest] = k.slice(LS.length).split("/"), name = rest.join("/");
    if (!out[kind]) continue;
    const obj = JSON.parse(localStorage.getItem(k));
    out[kind].push({ name, mtime: obj._saved || 0, refs: kind === "desktops" ? (obj.panels || []).map(p => p.ref).filter(Boolean) : undefined,
      n: kind === "desktops" ? (obj.panels || []).length : undefined, type: obj.type, label: obj.label, tag: obj.tag });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Returns "server" or "browser" (the caller warns about the latter). */
export async function saveView(kind, name, obj) {
  obj = { ...obj, _saved: Date.now() / 1000 };
  if (await apiAvailable(true)) {
    const r = await fetch(`${ROOT}api/views/${kind}/${encodeURIComponent(name)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
    const res = await r.json();
    if (!res.ok) throw new Error(res.error || "save failed");
    return "server";
  }
  localStorage.setItem(`${LS}${kind}/${name}`, JSON.stringify(obj));
  return "browser";
}

export async function loadView(kind, name) {
  if (await apiAvailable(true)) {
    const r = await fetch(`${ROOT}views/${kind}/${encodeURIComponent(name)}.json`, { cache: "no-store" });
    if (!r.ok) throw new Error(`${kind}/${name}: HTTP ${r.status}`);
    return r.json();
  }
  const s = localStorage.getItem(`${LS}${kind}/${name}`);
  if (!s) throw new Error(`${kind}/${name} not found`);
  return JSON.parse(s);
}

export async function deleteView(kind, name) {
  if (await apiAvailable(true)) { await fetch(`${ROOT}api/views/${kind}/${encodeURIComponent(name)}`, { method: "DELETE" }); return; }
  localStorage.removeItem(`${LS}${kind}/${name}`);
}

export const validName = n => /^[\w.\- ]{1,80}$/.test(n || "") && !n.startsWith(".");

// ---- the shared library (v7.5, human 2026-10-14: "when I make an analytic function I want it available everywhere,
// not just in one specific desktop") ----------------------------------------------------------------------------
//   views/library/<name>.json through serve.py: every desktop, every browser. With a serve.py that does not offer it
//   (an old one still running): this browser's storage, shared by every desktop in this browser.
const LIB = "aptvis.library.";
/** {obj (null if there is none yet), where: "server" | "browser"} */
export async function loadLibrary(name) {
  if ((await apiAvailable()) && hasFeature("library")) {
    const r = await fetch(`${ROOT}views/library/${encodeURIComponent(name)}.json`, { cache: "no-store" });
    if (r.status === 404) return { obj: null, where: "server" };
    if (!r.ok) throw new Error(`library/${name}: HTTP ${r.status}`);
    return { obj: await r.json(), where: "server" };
  }
  const s = localStorage.getItem(LIB + name);
  return { obj: s ? JSON.parse(s) : null, where: "browser" };
}
/** Returns "server" or "browser". */
export async function saveLibrary(name, obj) {
  if ((await apiAvailable()) && hasFeature("library")) return saveView("library", name, obj);
  localStorage.setItem(LIB + name, JSON.stringify({ ...obj, _saved: Date.now() / 1000 }));
  return "browser";
}
/** What this browser kept while serve.py did not offer the library (moved to the server once it does). */
export const browserLibrary = name => { try { return JSON.parse(localStorage.getItem(LIB + name)); } catch { return null; } };
export const forgetBrowserLibrary = name => localStorage.removeItem(LIB + name);
