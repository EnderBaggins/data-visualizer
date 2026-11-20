// plugins.js — the plugin loader (v14.9, public-release stage 2; DECISIONS D17, D18). The viewer is a core (like
// matplotlib) plus plugins that work with it: general analysis add-ons, and one plugin per person's data (aperture4).
//
// viewer/plugins/index.json  {"plugins": ["name", ...]}  lists the plugins to load, in order; ?plugins=a,b in the URL
// overrides it (?plugins= with nothing loads none). Each plugin is a folder viewer/plugins/<name>/ with an index.js whose
// default export is called once at start-up, before the desktop is read, with the register functions below:
//
//   export default function (api) {
//     api.registerLineKind({ key, label, is, expand, curve, name, editor, colour, deps, yId, caps });   // linekinds.js
//     api.registerTool({ key, label, folder, where, help, is, make, summary, rows, style, colour });     // settings.js
//     api.registerLineMenu({ key, label, help, available, form });                                      // lines.js "+ line"
//     api.registerSymbols({ name: "LaTeX" });                                                           // latex.js
//     api.registerMigration(S => { ... });                                                              // old desktops
//     api.registerOutputAction({ kind, label, title, run });                                            // vars.js: a button on a named tool's output card
//     api.registerContourLevels({ key, label, title, levels });                                         // model.js: a contour level mode
//     api.registerAxisNames({ dim: "name" }, [order]);  api.registerDefaults({ scaleRef, configVars });   // model.js
//     api.registerExampleDesktop(runs => plots);                                                        // model.js: the example desktop
//     api.registerDataKind({ key, label, is, dims, axes, fitAxis, lineData, mapLoad, … });                 // model.js DATA_KINDS (v15.1)
//     api.registerReadingOp({ key, label, value, text, help, missing, perCurve });                         // measure.js: a reading (v15.1)
//     api.registerPlotMenu({ key, label, title, available, run });                                         // a plot's ⋯ menu entry (v15.1)
//     api.core.toast(...), api.core.spawnPlot(...), api.core.redrawReaders({output | tool | table}),
//     api.core.makeFigure(group, anchor), api.core.rebuildAll(), api.core.save()                         // app.js
//   }
//
// A plugin may import core modules by relative path (../../js/model.js …). A plugin that fails to load is reported and
// skipped; the viewer starts without it. Each register function checks its entry and refuses a bad one with the reason.
// v15.1 (DECISIONS D20): a plugin folder may hold a plugin.json, {"data": [{"dims": [...], "what": "..."}]}: data only it
// can draw. For every plugin index.json lists that is not loaded (?plugins=, or it failed), the core reads it, so a plot
// of such data says which plugin it needs instead of drawing it wrong (model.js missingKindOf).
import { registerLineKind } from "./linekinds.js";
import { registerTool } from "./settings.js";
import { registerLineMenu } from "./lines.js";
import { registerSymbols } from "./latex.js";
import { registerOutputAction } from "./vars.js";
import { registerContourLevels, registerAxisNames, registerExampleDesktop, registerDefaults, registerDataKind, setMissingKinds } from "./model.js";
import { registerReadingOp } from "./measure.js";

const MIGRATIONS = [];
const PLOT_MENU = [];
/** v15.1: entries plugins add to a plot's ⋯ menu ({key, label, title, available(panel), run(panel)}; app.js panelMenu). */
export const pluginPlotMenu = () => PLOT_MENU;
export function registerPlotMenu(m) {
  for (const f of ["key", "label", "available", "run"]) if (!(f in (m || {}))) throw new Error(`missing ${f}`);
  if (typeof m.available !== "function" || typeof m.run !== "function") throw new Error("available and run must be functions");
  if (PLOT_MENU.some(x => x.key === m.key)) throw new Error(`there is already a plot-menu entry "${m.key}"`);
  PLOT_MENU.push(m);
}
const CORE = {};
/** app.js hands over what plugins may call in the wiring (toast, spawnPlot, redrawReaders …): api.core. */
export function setCoreApi(o) { Object.assign(CORE, o); }
const LOADED = [], FAILED = [];
/** Steps that convert old desktops for the plugins (run by app.js migrateDesktop, after the core's own). */
export const pluginMigrations = () => MIGRATIONS;
/** The plugins loaded ([name]) and the ones that failed ([{name, error}]). */
export const loadedPlugins = () => [...LOADED];
export const failedPlugins = () => [...FAILED];

/** The register functions a plugin gets. `who` names the plugin in error messages. */
function apiFor(who) {
  const wrap = (what, f) => entry => {
    try { return f(entry); } catch (e) { throw new Error(`${who}: ${what}(${entry?.key ?? ""}): ${e.message}`); }
  };
  return {
    registerLineKind: wrap("registerLineKind", registerLineKind),
    registerTool: wrap("registerTool", registerTool),
    registerLineMenu: wrap("registerLineMenu", registerLineMenu),
    registerSymbols: wrap("registerSymbols", registerSymbols),
    registerOutputAction: wrap("registerOutputAction", registerOutputAction),
    registerContourLevels: wrap("registerContourLevels", registerContourLevels),
    registerAxisNames: (names, order) => { try { registerAxisNames(names, order); } catch (e) { throw new Error(`${who}: registerAxisNames: ${e.message}`); } },
    registerExampleDesktop: wrap("registerExampleDesktop", registerExampleDesktop),
    registerDefaults: wrap("registerDefaults", registerDefaults),
    registerDataKind: wrap("registerDataKind", registerDataKind),           // v15.1 (D20)
    registerReadingOp: wrap("registerReadingOp", registerReadingOp),
    registerPlotMenu: wrap("registerPlotMenu", registerPlotMenu),
    core: CORE,
    registerMigration: wrap("registerMigration", fn => { if (typeof fn !== "function") throw new Error("not a function"); MIGRATIONS.push(fn); }),
  };
}

/** Load the plugins named by ?plugins= or plugins/index.json. Never throws: failures are listed in failedPlugins(). */
export async function loadPlugins(params = new URLSearchParams()) {
  let names = [], listed = [];
  try {
    const r = await fetch(new URL("../plugins/index.json", import.meta.url), { cache: "no-cache" });
    if (r.ok) listed = (await r.json()).plugins || [];
  } catch { /* no plugins/index.json: the plain core */ }
  if (params.has("plugins")) names = params.get("plugins").split(",").map(s => s.trim()).filter(Boolean);
  else names = listed;
  for (const name of names) {
    if (!/^[\w.-]+$/.test(name)) { FAILED.push({ name, error: "not a plugin folder name" }); continue; }
    try {
      const mod = await import(new URL(`../plugins/${name}/index.js`, import.meta.url));
      if (typeof mod.default !== "function") throw new Error("index.js has no default export function");
      await mod.default(apiFor(name));
      LOADED.push(name);
    } catch (e) { FAILED.push({ name, error: e.message || String(e) }); console.warn("plugin", name, e); }
  }
  // v15.1: what the listed plugins that are not loaded alone can draw (their plugin.json), for the plots that need them
  const off = [...new Set([...(Array.isArray(listed) ? listed : []), ...FAILED.map(f => f.name)])].filter(n => /^[\w.-]+$/.test(n) && !LOADED.includes(n));
  const missing = [];
  for (const name of off) {
    try {
      const r = await fetch(new URL(`../plugins/${name}/plugin.json`, import.meta.url), { cache: "no-cache" });
      if (r.ok) for (const d of (await r.json()).data || []) if (Array.isArray(d?.dims) && d.dims.length) missing.push({ plugin: name, dims: d.dims.map(String), what: String(d.what || `data of the ${name} plugin`) });
    } catch { /* no plugin.json: nothing to name */ }
  }
  setMissingKinds(missing);
  return LOADED;
}
