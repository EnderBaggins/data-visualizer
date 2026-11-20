#!/usr/bin/env node
// check.mjs — the visualizer's consistency check (RULES.md; DECISIONS D13, human 2026-11-13: "the documents I dont ccare
// too much about so long as they enforce consistency"). Run from anywhere:  node visualizer/tools/check.mjs
//   --update-baseline              record the current debt counts (only if none went up)
//   --accept-raise D<n>            allow a count to go up, citing the DECISIONS.md entry that allows it
// On success it writes visualizer/.check-ok.json (md5 of every viewer file); the upload hook (.claude/hooks/wiki-hooks.mjs)
// refuses to upload viewer files that differ from it. Exit code 0 = pass, 1 = fail.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";

const VIS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JS = path.join(VIS, "viewer", "js");
const args = process.argv.slice(2);
const fails = [], notes = [];
const fail = (what, why) => fails.push(`✗ ${what}: ${why}`);
const ok = what => notes.push(`✓ ${what}`);
const read = p => fs.readFileSync(p, "utf8");
// v14.9: plugins (viewer/plugins/<name>/*.js) are checked like the core; their keys are "plugins/<name>/<file>.js"
const PLUG = path.join(VIS, "viewer", "plugins");
const plugFiles = fs.existsSync(PLUG) ? fs.readdirSync(PLUG, { withFileTypes: true }).filter(d => d.isDirectory())
  .flatMap(d => fs.readdirSync(path.join(PLUG, d.name)).filter(f => f.endsWith(".js")).map(f => `plugins/${d.name}/${f}`)).sort() : [];
const jsFiles = [...fs.readdirSync(JS).filter(f => f.endsWith(".js")).sort(), ...plugFiles];
const fileOf = f => (f.startsWith("plugins/") ? path.join(VIS, "viewer", f) : path.join(JS, f));
const src = Object.fromEntries(jsFiles.map(f => [f, read(fileOf(f))]));
const noComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

// ---- 1. every module parses as an ES module (plain `node --check` missed start-up breaks before) -----------------------
{
  const bad = [];
  for (const f of jsFiles) {
    const r = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: src[f], encoding: "utf8" });
    if (r.status !== 0) bad.push(`${f}: ${(r.stderr || "").split("\n").find(l => /Error/.test(l)) || "syntax error"}`);
  }
  bad.length ? bad.forEach(b => fail("syntax", b)) : ok(`syntax: ${jsFiles.length} modules parse`);
}

// ---- 2. debt ratchet: known violations may not increase (RULES §6) ----------------------------------------------------
const count = (re, { skip = [], only = null } = {}) => {
  const per = {};
  for (const f of jsFiles) {
    if (skip.includes(f) || (only && !only.includes(f))) continue;
    const n = (noComments(src[f]).match(re) || []).length;
    if (n) per[f] = n;
  }
  return per;
};
const RULES = {
  "P5 popover() outside ui.js": count(/(?<![\w.])popover\(/g, { skip: ["ui.js"] }),
  "line-kind checks outside their modules": (() => {
    const own = { "isTab(": "tables.js", "isCyc(": "cycleplots.js", "isLo(": "lineout.js", "isGap(": "plugins/aperture4/gapseries.js" }, per = {};
    for (const f of jsFiles) {
      const body = noComments(src[f]).split("\n").filter(l => !/^\s*import\b/.test(l)).join("\n");
      let n = 0;
      for (const [k, home] of Object.entries(own)) if (f !== home && f !== "linekinds.js") n += body.split(k).length - 1;   // v14.4: the registry asks every kind
      if (n) per[f] = n;
    }
    return per;
  })(),
  "P2 result-cache writers": count(/\b(?:TOOL_VALUES|OUTPUTS|READVALS|FITVALS|MEASURED|MEASURED_AT)\.set\(/g),
  "P2 module-level caches outside results.js": count(/^(?:export )?const [A-Z_]+ = new Map\(\)/gm, { skip: ["results.js"] }),
  "native alert/confirm/prompt": count(/(?<![\w.])(?:alert|confirm|prompt)\(/g),
  "plot-from-plot paths (addPanel/dock calls)": count(/(?<!function )(?<![\w.])(?:addPanel|dock)\(/g),
  "P3 RUN_CTX via setRunContext": count(/(?<![\w.])setRunContext\(/g),
  // v14.5.1: also "panel" in text the human reads (glossary: plot / map); the one left names old desktops' pinned values
  "P10 retired words in UI text": count(/Outputs tab|panel setups?|pinned value|record\.yml|[12]D panel|(?:this|another|a|the|separate|linked|independent) panels?\b(?!\.)|panel'?s (?:corner|menu|axes|x axis|lines)/gi),
};
const BASE = path.join(VIS, "tools", "check-baseline.json");
const base = fs.existsSync(BASE) ? JSON.parse(read(BASE)) : {};
const totals = Object.fromEntries(Object.entries(RULES).map(([k, per]) => [k, Object.values(per).reduce((a, b) => a + b, 0)]));
const accept = args.includes("--accept-raise") ? args[args.indexOf("--accept-raise") + 1] : null;
const raised = [];
for (const [k, n] of Object.entries(totals)) {
  const b = base[k];
  if (b === undefined) { notes.push(`• ${k}: ${n} (no baseline yet)`); continue; }
  if (n > b) {
    raised.push(k);
    const where = Object.entries(RULES[k]).map(([f, c]) => `${f}:${c}`).join(" ");
    if (accept) notes.push(`! ${k}: ${b} → ${n} accepted under ${accept}`);
    else fail(k, `${b} → ${n} (a new instance of known debt; see RULES.md §6). Now: ${where}`);
  } else ok(`${k}: ${n}${n < b ? ` (down from ${b} — run --update-baseline)` : ""}`);
}
// pure computation modules touch no DOM (P7, strict)
for (const f of ["cycles.js", "fit.js", "stats.js", "results.js"]) {
  if (!src[f]) continue;
  /\bdocument\b|\bwindow\.|\blocalStorage\b|(?<![\w.])el\(/.test(noComments(src[f])) ? fail("P7 layers", `${f} uses the DOM`) : ok(`P7 layers: ${f} is pure`);
}

// ---- 3. one desktop schema (P9) ---------------------------------------------------------------------------------------
// v14.4: the schema itself is model.js DESKTOP_SCHEMA (one list); this checks the code uses it everywhere.
{
  const { DESKTOP_SCHEMA } = await import(pathToFileURL(path.join(JS, "model.js")).href);
  const used = new Set();
  for (const f of jsFiles) {
    if (!/import\s*\{[^}]*(?<![\w.])S(?![\w])[^}]*\}\s*from\s*"(?:\.\/|(?:\.\.\/)+js\/)model\.js"/.test(src[f]) && f !== "model.js") continue;   // (files with their own local `S`; v14.9: plugins too)
    for (const m of noComments(src[f]).matchAll(/(?<![\w.])S\.([A-Za-z_]\w*)/g)) used.add(m[1]);
  }
  const unknown = [...used].filter(k => !(k in DESKTOP_SCHEMA));
  unknown.length ? fail("P9 desktop schema", `state fields not in model.js DESKTOP_SCHEMA: ${unknown.join(", ")} — add each there (save, open, undo and reset then handle it)`) : ok(`P9 desktop schema: ${used.size} fields used, all in DESKTOP_SCHEMA`);
  // save, undo, open and reset read the schema (no hand-written field lists)
  const app = noComments(src["app.js"] || ""), fn = re => (app.match(re) || [""])[0];
  const sites = { "desktopBody()": fn(/function desktopBody[\s\S]*?\n}/), "the undo snapshot": fn(/const snapshot = [^\n]*/), "undo restore": fn(/function restore\(snap\)[\s\S]*?\n}/),
    "openDesktop()": fn(/async function openDesktop[\s\S]*?\n}/), "resetDesktop()": fn(/function resetDesktop[\s\S]*?\n}/) };
  const handmade = Object.entries(sites).filter(([, t]) => !/DESKTOP_SCHEMA|desktopFields\(/.test(t)).map(([k]) => k);
  handmade.length ? fail("P9 schema used", `${handmade.join(", ")} do not read DESKTOP_SCHEMA`) : ok("P9 schema used by save, undo, open and reset");
  // one migration pipeline: the steps are called only inside migrateDesktop()
  const pipe = fn(/function migrateDesktop[\s\S]*?\n}/), rest = app.replace(pipe, "");
  const steps = ["migrateRows", "migrateLinks", "migrateDerivedKinds", "remapRenamed", "sanitize", "bumpNextId"];
  const stray = steps.filter(s => new RegExp(`(?<!function )(?<![\\w.])${s}\\(`).test(rest));
  !pipe ? fail("P9 migrations", "migrateDesktop() not found in app.js")
    : stray.length ? fail("P9 migrations", `${stray.join(", ")} called outside migrateDesktop() — every way a desktop arrives runs the whole pipeline`) : ok("P9 migrations: one pipeline (migrateDesktop)");
}

// ---- 3b. plugins (v14.9, DECISIONS D18) --------------------------------------------------------------------------------
{
  const probs = [], idx = path.join(PLUG, "index.json");
  let listed = [];
  if (!fs.existsSync(idx)) probs.push("viewer/plugins/index.json is missing (write {\"plugins\": []} for none)");
  else { try { listed = JSON.parse(read(idx)).plugins; if (!Array.isArray(listed)) throw new Error("no \"plugins\" list"); } catch (e) { probs.push(`plugins/index.json: ${e.message}`); listed = []; } }
  for (const n of listed) {
    const f = `plugins/${n}/index.js`;
    if (!src[f]) probs.push(`${n} is listed but ${f} does not exist`);
    else if (!/export\s+default\s+(async\s+)?function/.test(src[f])) probs.push(`${f} has no "export default function (api)"`);
  }
  // every register function a plugin gets is exported by its module
  const reg = { registerLineKind: "linekinds.js", registerTool: "settings.js", registerLineMenu: "lines.js", registerSymbols: "latex.js", registerOutputAction: "vars.js",
    registerDataKind: "model.js", registerReadingOp: "measure.js", registerPlotMenu: "plugins.js" };   // v15.1 (D20): + data kinds, readings, plot menu
  for (const [fn, f] of Object.entries(reg)) if (!new RegExp(`export function ${fn}\\b`).test(src[f] || "")) probs.push(`${f} does not export ${fn}`);
  if (!/loadPlugins\(/.test(noComments(src["app.js"] || ""))) probs.push("app.js does not call loadPlugins()");
  probs.length ? probs.forEach(p => fail("plugins", p)) : ok(`plugins: ${listed.length} listed (${listed.join(", ") || "none"}), ${plugFiles.length} plugin files checked like the core`);
}

// ---- 3c. TOOLS.md is up to date (v15.3) ----------------------------------------------------------------------------------
{
  const { toolsMarkdown } = await import(pathToFileURL(path.join(VIS, "tools", "tools_md.mjs")).href);
  const p = path.join(VIS, "TOOLS.md"), want = toolsMarkdown();
  !fs.existsSync(p) ? fail("TOOLS.md", "missing — run: node tools/tools_md.mjs")
    : read(p).replace(/\r\n/g, "\n") !== want ? fail("TOOLS.md", "out of date with the tool definitions — run: node tools/tools_md.mjs")
    : ok("TOOLS.md matches the tool definitions");
}

// ---- 4. tests (P12) ---------------------------------------------------------------------------------------------------
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const close = (a, b, tol) => (a == null && !Number.isFinite(b)) || Math.abs(a - b) <= tol;
test("cycles.js equals cycles.py on ec025 (every detrend, lags, in_phase, sliding)", async () => {
  const C = await import(pathToFileURL(path.join(JS, "cycles.js")).href);
  const ref = JSON.parse(read(path.join(VIS, "tests", "fixtures", "cycles_ec025.json")));
  let worst = 0;
  for (const [how, R] of Object.entries(ref.results)) {
    const W = ref.y.map(y => C.window(ref.t, y, ref.window[0], ref.window[1]));
    W.forEach(([tw, yw], k) => {
      const r = C.period(tw, yw, how), p = R.period[k];
      if (!close(p.period, r.period, 1e-9) || !close(p.regularity, r.regularity, 1e-9)) throw new Error(`${how} line ${k}: ${r.period}/${r.regularity} vs ${p.period}/${p.regularity}`);
      worst = Math.max(worst, Math.abs((p.period ?? 0) - (Number.isFinite(r.period) ? r.period : 0)));
    });
    const L = C.lines(W[0][0], W.map(([, yw]) => yw), how);
    L.lag.forEach((x, j) => { if (!close(R.lines.lag[j], x, 1e-9)) throw new Error(`${how} lag ${j}`); });
    if (!close(R.lines.in_phase, L.in_phase, 1e-9)) throw new Error(`${how} in_phase`);
    const S = C.sliding(ref.t, ref.y[0], 32, 2, how);
    S.period.forEach((x, i) => { if (!close(R.sliding0.period[i], x, 1e-9)) throw new Error(`${how} sliding ${i}`); });
  }
  return `largest period difference ${worst.toExponential(1)}`;
});
test("fit.js: a straight line and an exponential are recovered", async () => {
  const F = await import(pathToFileURL(path.join(JS, "fit.js")).href);
  const xs = Array.from({ length: 50 }, (_, i) => i), lin = xs.map(x => 3 * x - 2), ex = xs.map(x => 5 * Math.exp(-x / 7));
  const a = F.fitCurve(xs, lin, "poly", 1, -Infinity, Infinity), b = F.fitCurve(xs, ex, "exp", 2, -Infinity, Infinity);
  if (a.error || !(a.r2 > 0.999999)) throw new Error(`linear fit: ${a.error || a.r2}`);
  if (b.error || !close(b.params.tau, 7, 1e-6)) throw new Error(`exp fit tau ${b.params?.tau}`);
  return "ok";
});
test("stats.js: one statistic for tools, readings and fits (gaps left out, ranges, crossing, single points)", async () => {
  const St = await import(pathToFileURL(path.join(JS, "stats.js")).href);
  const near = (a, b, what) => { if (!(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)))) throw new Error(`${what}: ${a}, expected ${b}`); };
  const xs = [0, 1, 2, 3, 4, 5], ys = [0, 2, NaN, 4, 6, 1];
  near(St.statValue(xs, ys, "max"), 6, "max"); near(St.statValue(xs, ys, "xmax"), 4, "x at max");
  near(St.statValue(xs, ys, "min"), 0, "min"); near(St.statValue(xs, ys, "xmin", 2.5, 5), 5, "x at min over 2.5–5");
  // the mean leaves the gap out: pieces 0–1 (mean 1) and 3–5 (∫ = 5 + 3.5 = 8.5): (1 + 8.5) / (1 + 2)
  near(St.statValue(xs, ys, "mean"), 9.5 / 3, "mean with a gap"); near(St.meanOf(xs, ys), 9.5 / 3, "meanOf = mean");
  near(St.statValue([0, 1, 3], [1, 1, 5], "mean"), (1 + 6) / 3, "mean on uneven spacing");
  near(St.statValue([2], [7], "mean"), 7, "mean of one point");
  if (!Number.isNaN(St.statValue([0, 1], [NaN, NaN], "mean"))) throw new Error("mean of no points should be NaN");
  near(St.statValue(xs, ys, "cross", -Infinity, Infinity, 5), 3.5, "first crossing of 5 (between x = 3 and 4)");
  near(St.statValue(xs, ys, "cross", -Infinity, Infinity, 1), 0.5, "first crossing of 1");
  if (!Number.isNaN(St.statValue(xs, ys, "cross", -Infinity, Infinity, 99))) throw new Error("no crossing should be NaN");
  return "ok";
});
test("readings' measure menu keeps every operation (the v14.1 'mean' regression)", () => {
  const m = (src["vars.js"] || "").match(/export const MEASURE_OPS = (\[[\s\S]*?\]\]);/);
  if (!m) throw new Error("MEASURE_OPS not found");
  const ops = Function(`return ${noComments(m[1])}`)().map(x => x[0]);
  const need = ["max", "min", "xmax", "xmin", "cross", "at", "mean", "period", "regularity", "ncycles"];
  const miss = need.filter(k => !ops.includes(k));
  if (miss.length) throw new Error(`missing: ${miss.join(", ")}`);
  // v15.1 (D20): the line length is the aperture4 plugin's reading (registerReadingOp), offered with the core's (vars.js measureOps)
  if (!/registerReadingOp\(\{\s*key: "length"/.test(src["plugins/aperture4/alongline.js"] || "")) throw new Error("the aperture4 plugin no longer registers the \"length\" reading");
  if (!/export const measureOps = /.test(src["vars.js"] || "")) throw new Error("vars.js measureOps (core + plugin readings) not found");
  return `${ops.join(",")} + plugin: length`;
});
test("measured values: the context rule (P3), per-curve fits, typed lists, delete keeps the value (v14.3.2 bugs 5, 7, 8, 9)", async () => {
  const M = await import(pathToFileURL(path.join(JS, "model.js")).href), Rs = await import(pathToFileURL(path.join(JS, "results.js")).href);
  const S = M.S, eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
  const keep = { vars: S.vars, panels: S.panels, groups: S.groups };
  try {
    S.vars = { m: { name: "m", type: "measured" }, f: { name: "f", type: "fit", run: "A" } }; S.panels = []; S.groups = {};
    eq(M.listOf([0.5, 1, 2]), [0.5, 1, 2], "a typed list's values"); eq(M.numOf([0.5, 1]), 0.5, "a typed list as one number");
    // a reading on a line that follows the dataset list [A, B]: a plot of B gets B's value (it got A's)
    Rs.putResult("reading:m", "own", { val: [10, 20], at: [{ run: "A", d: {} }, { run: "B", d: {} }], ref: null, err: null });
    const old = M.setRunContext("B"); eq(M.numOf("$m"), 20, "reading on a plot of B"); M.setRunContext("A"); eq(M.numOf("$m"), 10, "reading on a plot of A");
    // the same reading on a dataset its own line does not show (v13.0: per dataset)
    Rs.putResult("reading:m", "run:C", { val: 30, at: [{ run: "C", d: {} }] }); M.setRunContext("C"); eq(M.numOf("$m"), 30, "reading on a plot of C");
    // a fit on an r_max-list line: each curve its own r_max's value (they all got the first)
    Rs.putResult("fit:f", "run:A", { val: [1, 2], at: [{ run: "A", d: { r_max: 3 } }, { run: "A", d: { r_max: 5 } }] });
    M.setRunContext("A");
    eq(M.curveValue("f", { run: "A", d: { r_max: 5 } }), 2, "fit for the r_max = 5 curve"); eq(M.numOf("$f"), 1, "fit as one number");
    // deleting a fit variable keeps its current value where it was used (it became 0), and drops its results
    S.panels = [{ id: 1, settings: { tools: [{ value: "$f" }] } }]; M.deleteVar("f"); eq(S.panels[0].settings.tools[0].value, 1, "a deleted fit's uses");
    eq(Rs.getResult("fit:f", "run:A"), undefined, "a deleted fit's results");
    M.setRunContext(old);
  } finally { Rs.dropResult("reading:m"); Rs.dropResult("fit:f"); Object.assign(S, keep); }
  return "ok";
});
test("across lines (stats.js acrossValue): slope at a line, ∫ dr_max, ∫ q dq2, mean, max (v14.6, replaces the stored rates)", async () => {
  const St = await import(pathToFileURL(path.join(JS, "stats.js")).href);
  const near = (a, b, what) => { if (!(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)))) throw new Error(`${what}: ${a}, expected ${b}`); };
  const rm = [1, 2, 3, 4, 5], psi = rm.map(r => 10 / r), V = rm.map(r => 3 * r * r), I = rm.map(r => 2 * r);
  near(St.acrossValue("slope", rm, rm, V, { at: 3 }), (48 - 12) / 2, "dV/dr_max at 3 (central)");
  near(St.acrossValue("slope", rm, psi, V, { at: 3 }), (48 - 12) / (10 / 4 - 10 / 2), "dV/dΨ at 3");
  near(St.acrossValue("slope", rm, rm, V, { at: 5 }), (75 - 48) / 1, "one-sided at the last line");
  near(St.acrossValue("int", rm, rm, I), 2 * (25 - 1) / 2, "∫ 2r dr from 1 to 5 (exact for a line)");
  near(St.acrossValue("intd", rm, rm, I, { q2: I }), (100 - 4) / 2, "∫ I dI = ΔI²/2");
  near(St.acrossValue("int", rm, rm, I, { from: 2, to: 4 }), 2 * (16 - 4) / 2, "between r_max 2 and 4");
  near(St.acrossValue("max", rm, rm, V), 75, "max");
  near(St.acrossValue("slope", rm, rm, [3, 12, NaN, 48, 75], { at: 3 }), (48 - 3) / (4 - 1), "the picked line missing: the nearest finite line (r_max 2), its finite neighbours");
  return "ok";
});
test("expressions: `# label [y-axis group | units]` (data.js parseExpressionText, v14.6)", async () => {
  let D;
  try { D = await import(pathToFileURL(path.join(JS, "data.js")).href); } catch (e) { return `skipped (data.js needs the browser: ${e.message.split("\n")[0]})`; }
  const { defs, errors } = D.parseExpressionText("a = B3 * r  # B_φ r [current | code units]\nb = B1  # plain\nc = B2 # g only [twist rate]");
  if (errors.length) throw new Error(errors.join("; "));
  const eq = (x, y, w) => { if (JSON.stringify(x) !== JSON.stringify(y)) throw new Error(`${w}: ${JSON.stringify(x)}`); };
  eq([defs.a.label, defs.a.kind, defs.a.units], ["B_φ r", "current", "code units"], "group and units");
  eq([defs.b.label, defs.b.kind, defs.b.units], ["plain", undefined, undefined], "no brackets: as before");
  eq([defs.c.label, defs.c.kind, defs.c.units], ["g only", "twist rate", undefined], "group only");
  return "ok";
});
test("tool labels: {v}, {dataset}, {t} filled the same way for every tool (model.js toolLabel)", async () => {
  const M = await import(pathToFileURL(path.join(JS, "model.js")).href);
  const got = M.toolLabel({ label: "r = {v} · {dataset} · t {t}" }, 2.5, { dataset: "baseline-19", t: "40" });
  if (got !== "r = 2.5 · baseline-19 · t 40") throw new Error(`got "${got}"`);
  if (M.toolLabel({ label: null }, 1) !== null) throw new Error("no label should give null");
  if (M.timeLine().type !== "line" || M.timeLine().mode !== "time" || !M.isTimeLine(M.timeLine())) throw new Error("the slider-time line is a line in time mode");
  return "ok";
});
test("results.js: one store, one 'same point', one change signal (P2)", async () => {
  const Rs = await import(pathToFileURL(path.join(JS, "results.js")).href);
  const heard = [], off = Rs.onResult((o, s) => heard.push(`${o}@${s}`));
  try {
    if (!Rs.samePoint({ run: "A", d: { r_max: 3 } }, { run: "A", d: { r_max: 3 + 1e-12, t: 5 } })) throw new Error("same dataset and picks (tolerance, extra pick) should match");
    if (Rs.samePoint({ run: "A", d: {} }, { run: "B", d: {} })) throw new Error("different datasets matched");
    if (Rs.samePoint({ run: "A", d: { r_max: 3 } }, { run: "A", d: { r_max: 3.001 } })) throw new Error("different picks matched");
    if (!Rs.samePoint({ d: { r_max: 3 } }, { run: "A", d: { r_max: 3.0000001 } }, 1e-6)) throw new Error("table tolerance 1e-6");
    if (Rs.valueAt([5, 6], [{ run: "A", d: { k: 1 } }, { run: "A", d: { k: 2 } }], { run: "A", d: { k: 2 } }) !== 6) throw new Error("valueAt");
    if (!Rs.putResult("tool:1", 7, [{ value: 1 }]) || Rs.putResult("tool:1", 7, [{ value: 1 }])) throw new Error("put: changed once, then not");
    Rs.putResult("tool:1", 8, [{ value: 2 }]);
    if (Rs.getResult("tool:1", 7)[0].value !== 1 || Rs.getResultOrLast("tool:1", 99)[0].value !== 2) throw new Error("per scope / last scope");
    if (heard.join() !== "tool:1@7,tool:1@8") throw new Error(`change signals: ${heard.join()}`);
    Rs.renameResult("tool:1", "tool:2"); if (Rs.getResult("tool:2", 7)?.[0].value !== 1) throw new Error("rename");
    Rs.dropResult("tool:2"); if (Rs.getResult("tool:2", 7) !== undefined) throw new Error("drop");
  } finally { off(); Rs.dropResult("tool:1"); Rs.dropResult("tool:2"); }
  return "ok";
});
test("every line kind in the registry (linekinds.js) has every field", () => {
  const s = noComments(src["linekinds.js"] || ""), fields = JSON.parse((s.match(/LINE_KIND_FIELDS = (\[[^\]]*\])/) || [])[1] || "null");
  if (!fields) throw new Error("LINE_KIND_FIELDS not found");
  const block = (s.match(/export const LINE_KINDS = \[([\s\S]*?)\n\];/) || [])[1];
  if (!block) throw new Error("LINE_KINDS not found");
  const entries = block.split(/\n\s*\{ key: /).slice(1);
  const bad = entries.map(e => [e.match(/^"(\w+)"/)?.[1], fields.filter(f => f !== "key" && !new RegExp(`\\b${f}:`).test(e))]).filter(([, m]) => m.length);
  if (bad.length) throw new Error(bad.map(([k, m]) => `${k}: no ${m.join(", ")}`).join("; "));
  return `${entries.length} kinds: ${entries.map(e => e.match(/^"(\w+)"/)?.[1]).join(", ")}`;
});
test("every tool is one definition with its own fields (settings.js TOOL_DEFS, P6)", () => {
  const s = noComments(src["settings.js"] || ""), block = (s.match(/const TOOL_DEFS = \[([\s\S]*?)\n\]\.map\(d => \(\{ \.\.\.TOOL_DEFAULTS, \.\.\.d \}\)\);/) || [])[1];
  if (!block) throw new Error("TOOL_DEFS (merged with TOOL_DEFAULTS) not found");
  // every tool states these itself; the rest (addTo, afterAdd) come from TOOL_DEFAULTS when it has none
  const need = ["key", "label", "folder", "where", "help", "is", "make", "summary", "rows", "style", "colour"];
  const entries = block.split(/\n  \{ key: /).slice(1);
  const bad = entries.map(e => [e.match(/^"(\w+)"/)?.[1], need.filter(f => f !== "key" && !new RegExp(`\\b${f}:`).test(e))]).filter(([, m]) => m.length);
  if (bad.length) throw new Error(bad.map(([k, m]) => `${k}: no ${m.join(", ")}`).join("; "));
  const where = entries.filter(e => !/where: "(any|1d|2d|map)"/.test(e) || !/folder: "(draw|curves|more)"/.test(e)).map(e => e.match(/^"(\w+)"/)?.[1]);
  if (where.length) throw new Error(`bad where / folder: ${where.join(", ")}`);
  // no if-chain on tool type for summaries, card rows or adding
  for (const f of ["toolSummary", "toolControls", "addTool"]) {
    const body = (s.match(new RegExp(`function ${f}\\b[\\s\\S]*?\\n}|const ${f} = [^\\n]*`)) || [""])[0];
    if (/t\.type === "/.test(body) || /what === "/.test(body)) throw new Error(`${f} still branches on the tool type`);
  }
  return `${entries.length} tools: ${entries.map(e => e.match(/^"(\w+)"/)?.[1]).join(", ")}`;
});

// ---- 5. version consistency -------------------------------------------------------------------------------------------
{
  const html = read(path.join(VIS, "viewer", "index.html")), vs = [...html.matchAll(/v(\d+\.\d+(?:\.\d+)?)/g)].map(m => m[1]);
  const readme = (read(path.join(VIS, "README.md")).match(/^# .*\(v([\d.]+),/m) || [])[1];
  const log = fs.existsSync(path.join(VIS, "CHANGELOG.md")) ? (read(path.join(VIS, "CHANGELOG.md")).match(/^- \*\*v([\d.]+) /m) || [])[1] : null;
  const set = new Set([...vs.slice(0, 2), readme, log].filter(Boolean));
  set.size === 1 ? ok(`version: v${[...set][0]} everywhere`) : fail("version", `index.html ${vs.slice(0, 2).join("/")}, README ${readme}, CHANGELOG ${log} — bump all (RULES §5 step 7)`);
}

for (const [name, fn] of tests) {
  try { const r = await fn(); ok(`test: ${name}${r ? ` — ${r}` : ""}`); } catch (e) { fail(`test: ${name}`, e.message || String(e)); }
}

// ---- result ----------------------------------------------------------------------------------------------------------
console.log(notes.join("\n"));
if (fails.length) { console.log(fails.join("\n")); console.log(`\nFAIL (${fails.length}) — fix these, or see RULES.md`); }
if (args.includes("--update-baseline")) {
  if (raised.length && !accept) { console.log(`baseline NOT updated: ${raised.join(", ")} went up (use --accept-raise D<n>)`); process.exit(1); }
  fs.writeFileSync(BASE, JSON.stringify({ ...totals, _updated: new Date().toISOString().slice(0, 10), ...(accept ? { _accepted: accept } : {}) }, null, 2) + "\n");
  console.log("baseline updated:", BASE);
}
if (fails.length && !(args.includes("--update-baseline") && raised.length === 0 && fails.every(f => /no baseline|went up/.test(f)))) process.exit(1);
// stamp: the md5 of every viewer file that passed (the upload hook compares against it)
const stamp = {};
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else stamp[path.relative(VIS, p).split(path.sep).join("/")] = crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex"); } };
for (const d of ["viewer", "tools", "tests"]) if (fs.existsSync(path.join(VIS, d))) walk(path.join(VIS, d));
for (const f of ["README.md", "CHANGELOG.md", "RULES.md", "DECISIONS.md", "FORMAT.md", "serve.py", "TOOLS.md", "HOWTOUSE.md", "BRING_YOUR_DATA.md", "AGENTS.md"]) if (fs.existsSync(path.join(VIS, f))) stamp[f] = crypto.createHash("md5").update(fs.readFileSync(path.join(VIS, f))).digest("hex");
fs.writeFileSync(path.join(VIS, ".check-ok.json"), JSON.stringify({ passed: new Date().toISOString(), files: stamp }, null, 1));
console.log(`\nPASS — stamp written (${Object.keys(stamp).length} files); viewer uploads of exactly these files are allowed`);
