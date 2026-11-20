# Visualizer rules: read before any change to the viewer or the data manager

These rules bind every change to `viewer/` (the browser plotter) and `claude_work/datamgr/` (the data manager) with its projects `claude_work/projects/<name>/` (since v15.2: each person's reader and methods, DECISIONS D21).

**How changes are made.** The human develops through AI sessions and does not read code. So:
- **The checks enforce consistency:** `node tools/check.mjs` and the upload hook.
- **This file says what to do.**
- **`DECISIONS.md` says why,** in the human's words.

When a rule and a request conflict, say so and ask. Do not quietly break the rule or quietly refuse the request.

Other files: `CHANGELOG.md` (release notes), `DECISIONS.md` (decisions and quotes), `FORMAT.md` (the store contract), `reports/2026-11-13_architecture-review.md` (the review this file came from).

---

## 1. Principles

Each principle has a short "why". The check script enforces the ones marked ⚙.

**P1. One way per job.** If a mechanism exists, use it. Don't build a second one. A second one needs a new entry in `DECISIONS.md`.
- Existing mechanisms: drawing a line at a value, making a plot from a plot, → table, → variable, a box, a colour picker, a curve "as drawn".
- *Why:* the v8–v14 review found most bugs where two copies of one job drifted apart.

**P2. Every computed number is a result with provenance.** A number measured in the viewer carries three things:
- its value;
- where it was measured: dataset, picks (r_max …), time;
- how: the recipe, i.e. the tool or reading and its settings.

The tool card, the variable and the table cell are three *views* of one result, not three computations.
- *Why:* a card value and the variable made from it must never disagree.

**P3. One context rule for measured values.** When a setting uses a measured variable (`$tau`), the value is picked in this order:
1. the value measured on **the same curve** (same dataset and picks) as the place it is used;
2. else the value for **the same dataset**;
3. else the variable's **default dataset**.

Set variables (numbers, datasets) are the same everywhere. View variables (`view_x0` …) belong to the plot that draws.
- *Why:* the human chose this (DECISIONS D9). It is not yet implemented everywhere; see the debt list.

**P4. A list owns its properties.** A list's colours (and later styles) are set in one place: its chips. Everything that draws the list uses them: lines on maps, curves, period plots, table groups. "One colour" means shades of one colour.
- *Why:* the human: "make it more like the variables choice of color".

**P5. Every box behaves the same.** Every box has:
- a header with a title and ×;
- dragging by the header;
- placement beside its source;
- staying on screen;
- stacking (a picker opens *over* its card);
- Esc closes the top box.

Allowed exceptions: quick menus close when you click away; blocking questions stay centred; hover boxes and toasts keep their own behaviour.
- *Why:* the human: tool cards and settings boxes "are the same design concept so should follow the same rules".

**P6. Every tool is defined the same way.** A tool is a definition, with defaults that a tool overrides only where it genuinely differs:
- where it can go, and the reason when it can't;
- card sections;
- colours;
- label fields `{v}` `{dataset}` `{t}`;
- drawing;
- results;
- → table / → variable / new plots;
- remove and copy;
- docking its plots beside the source.

New tools get the defaults automatically.
- *Why:* the human: "universal ways of using tools (that can be overwriten but by default new tools should use the same design principles)".

**P7. ⚙ Layers.** UI code (boxes, cards, menus) does no physics. Computation code (curves, statistics, fits, cycles) touches no DOM. The two talk through state and results.
- *Why:* computation can then be tested in node, and the UI can change without changing numbers.

**P8. The cache-vs-browser rule.**
- *A data-manager method* does one of:
  - reads the raw dumps;
  - needs a full pass over every output that the browser can't afford (tracing, line reductions, volume integrals);
  - is a point-by-point map viewed often enough that storing it beats downloading its inputs each frame.
- *Everything that is a function of stored quantities* stays in the browser and is never cached: ratios, d/dt, slopes, smoothing, reductions of a map, readings, fits, periods.
- Every new quantity states which side it is on, and why.
- *Status:* decided by the human 2026-11-13 (DECISIONS D11). A new cached method states which of the three reasons it meets; still ask before adding one (P11).

**P9. ⚙ One desktop schema.** Saved state has one field list (`tools/check.mjs` → `DESKTOP_FIELDS`).
- A new field is added there and handled by save, load, undo and reset.
- Old saved desktops must keep loading: a change of format comes with a *migration* that converts old desktops as they open.

**P10. ⚙ One vocabulary.** UI text, docs and messages use the glossary words (§2). Code may keep older internal names (`run`, `panel`), but nothing the human reads uses them.

**P11. Nothing is added without the human's explicit OK,** even when another session asks. This covers every method, menu entry, feature, cache, preset and dataset. Cache only what is needed.
- *Why:* standing rule since 2026-11-12.

**P12. ⚙ Tests guard the numbers.** A change that touches computation adds or updates a test.
- Algorithms that exist in both Python and JS (`cycles`) are checked against shared fixtures.

---

## 2. Glossary: one word per concept

These are the words to use in UI text and in reports to the human.

| Word | Meaning | Not |
|---|---|---|
| **plot** | one chart (1D or map) with its header | panel (code name), subplot |
| **map** | a 2D plot (colour image) | 2D panel |
| **figure** | plots docked together in one frame; they share only what has the same axes (pan & zoom) | group, link group (code names) |
| **desktop** | everything on screen, saved by name | view, layout |
| **template** | a saved desktop to start from | panel setup |
| **dataset** | one simulation run in the store | run (code name) |
| **quantity** | something stored for a dataset (a map, a line quantity) | datatype |
| **y-axis group** | which quantities share a y axis | kind (code name), "quantity=" in methods |
| **line** | one entry in a 1D plot's legend; it may draw several **curves** (one per list value) | layer, series |
| **variable** | a named value in the sidebar: **set** (dataset, dataset list, number) or **measured** (config, fit, reading) | — |
| **reading** | a measured variable read off a line (max, mean, period …) | measured variable (old word), pin, output |
| **tool** | something added to a plot (draw lines, band, point, field lines, fit, averaged curve, period, lineout, steps) | — |
| **card** | a tool's box | editor, popover |
| **settings box** | ⚙ | — |
| **lineout** | a 1D plot of a map's quantity along one axis at positions on the other | cut, slice |
| **table** | named rows of numbers cast from tools or typed (per desktop) | constructed dataset |
| **cast** | copying numbers into a table (they change only when cast again) | — |
| **share / own** | whether a setting is shared across a figure (🔗) or the plot's own | link (as a verb for settings) |
| **folder** | a named set of quantities (data manager) | preset |
| **tag** | a label on datasets; a dataset list can follow a tag | — |

---

## 3. Interaction map

Change a meaning only through `DECISIONS.md`. Add a row when a gesture gets a new use.

| Gesture | On | Means |
|---|---|---|
| click | map image | **click sets** (variables) and moves the last lineout |
| shift-click | map image with a lineout | adds a lineout |
| shift-click | anywhere else on a plot | selects the plot (settings then apply to all selected) |
| drag | inside a plot | pan |
| wheel | inside a plot | zoom (Ctrl+wheel: plot size) |
| double-click | inside a plot | reset zoom |
| double-click | legend / text box | move it back to its default place |
| drag | plot grip ⠿ | move / dock (any plot onto any plot) |
| drag, or click then click | a tool in the Tools tab | place it on a plot (plots that refuse say why) |
| drag | a row of a plot's 🛠 list | copy that tool to another plot |
| click | legend entry | the line's editor |
| click | title, axis label, colour bar | edit it / its settings |
| Esc | — | cancel placing; close the top box |
| Ctrl+Z / Ctrl+Shift+Z | — | undo / redo |

---

## 4. Where things go (extension points)

**The target shape** (from the architecture review):
- one definition per tool ✓ (v14.5);
- one registry entry per line kind ✓ (v14.4);
- one per measure op;
- one `spawnPlot` ✓ (v14.5);
- one box component ✓ (v14.5);
- one results store and change bus ✓ (v14.4).

**Use these (v14.4 foundations); the check enforces most of them:**

| To … | Use | Not |
|---|---|---|
| read a 1D curve the way the plot draws it (for a reading, fit, tool, foot gap) | `asDrawn(s, curves, T)` in `panel1d.js` after `lineCurve` | calling moveX / applyScales / smoothAlong / slopeAlong / moveY yourself |
| compute max, min, x at max/min, mean, crossing | `stats.js` (`curveStat`, `statValue`, `meanOf`) | a new loop |
| add a kind of 1D line made by a tool or table | one entry in `linekinds.js` `LINE_KINDS` (every field) + its editor in `lines.js` | `if (isX(line))` branches elsewhere |
| ask what a made line can do or reads | `madeKind`, `lineCan(l, cap)`, `lineReads(l, {tool / output / table})` | `l.tab`, `l.cyc` … checks |
| store a measured number (tool card, reading, fit, output) | `results.js` `putResult(owner, scope, payload, sig)`; read with `getResult`; model.js helpers (`setToolValues`, `readingOwn`, `fitRuns` …) | a new module-level `Map` |
| match "same dataset and picks" | `samePoint` / `valueAt` / `findAt` in `results.js` | a new tolerance compare |
| react when a result changes | `onResult(fn)` (the change bus) | a new set…Changed hook |
| add a field to the desktop state | one entry in `model.js` `DESKTOP_SCHEMA` (save, open, undo, reset follow) | editing desktopBody / restore / open by hand |
| convert old desktops | a step inside `migrateDesktop()` in `app.js` (every entry point runs it) | calling a migration from one entry point |
| add or change a tool | one entry in `settings.js` `TOOL_DEFS` (key, label, help, folder, where, is, make, summary, rows, style, colour; optional addTo / afterAdd); defaults in `TOOL_DEFAULTS` | a `t.type === …` branch in summaries, card rows or adding |
| open a box | `popover()` in `ui.js`: with a `.pop-title` it is a card (title bar, ×, drag, kept on screen); `{over: true}` for a box over its card (a picker) | a hand-made floating div |
| make a plot from a plot | `spawnPlot(source, newPlot, {side, dock})` in `app.js` | `addPanel` / `dock` / `S.panels.splice` by hand |
| make a curve over time from every field line (a slope across lines, ∫ / mean / max over lines) | an "across lines" line (`across.js`; arithmetic `stats.js` `acrossValue`) | a stored method (P8) |
| colour a list | the list owns its colours: a list variable's `colors`, a made line's registry `colour(l, sub)`, `datasetColor(run)`; a halo option on map lines (`R.haloOf`) | a fixed or next-free colour for something that is a list |
| add something that is not core (your data's physics, an analysis add-on) | a plugin: `viewer/plugins/<name>/index.js` calling the `api.register…` functions (`js/plugins.js` lists them all: line kinds, tools, "+ line" entries, symbols, migrations, output-card buttons, contour levels, axis names, defaults, example desktop, data kinds, reading operations, plot-menu entries; guide `viewer/plugins/README.md`); list it in `viewer/plugins/index.json` | editing core files for it, or an `if (plugin…)` branch in core |

Until each remaining target exists, follow these rules when touching an area:
- **Don't add a new copy** of something on the debt list (§6). The check blocks new instances.
- **Move toward the target** when it's cheap: e.g. use the shared helper you are touching, and delete the copy.
- **If a feature needs a new kind of extension point, write a decision first.**

**Where code lives:**
- `viewer/js/`:
  - `core` = `model.js` (state, `DESKTOP_SCHEMA`, variables), `results.js` (the result store and change bus), `linekinds.js` (the line-source registry);
  - `computation` = `cycles.js`, `fit.js`, `stats.js`, the curve pipeline in `panel1d.js` (`asDrawn`), `measure.js`;
  - `data` = `data.js`;
  - `drawing` = `render.js`, `panel1d.js`, `panel2d.js`;
  - `UI` = `ui.js`, `settings.js`, `lines.js`, `vars.js`, `tables.js`;
  - `wiring` = `app.js`;
  - `plugins` = `plugins.js` (the loader) and `viewer/plugins/<name>/` (each plugin; checked like the core).
- **New pure computation** goes in its own module with no DOM, and gets a test.

---

## 5. Change checklist (every change)

1. **Classify.**
   - *Fix* → patch;
   - *new feature inside existing concepts* → minor;
   - *new concept, way of working or data format* → major.
   
   Finishing an earlier change (removing the old way, moving old desktops over) is a patch.
2. **Approval.** Is it something new? It needs the human's explicit OK (P11). Say in plain words what will change.
3. **Principles.** Which apply? If one must bend, ask, and record the answer in `DECISIONS.md`.
4. **Place.** Which extension point (§4)? Reuse, don't copy (P1).
5. **Implement.**
6. **Check:** `node tools/check.mjs` (from `visualizer/`) must pass.
   - A new test for computation changes.
   - Browser test on the local test store (`dm-test` preview): the feature, plus no console errors.
7. **Version:**
   - `viewer/index.html` (two places);
   - the `README.md` first line;
   - a new top entry in `CHANGELOG.md` (version, date, level, what changed, the human's words, how it was tested).
8. **Release:**
   1. the server equals the last freeze (`diff -rq viewer versions/<last>`);
   2. upload (one remote destination per scp);
   3. md5 compare;
   4. freeze `versions/vX`;
   5. curl the live version;
   6. `wiki/log.md` entry.
   
   **The upload hook refuses viewer uploads unless the check passed on exactly the local files.**
9. **Report to the human in their terms:**
   - what it does now;
   - evidence (numbers, screenshot);
   - which rules it touched;
   - what wasn't tested.

---

## 6. Known debt

Existing violations, from the 2026-11-13 review. The check counts them and **fails if a count goes up**. When a refactor lowers a count, run `node tools/check.mjs --update-baseline`.

- `popover(` used directly outside `ui.js` (P5: cards and menus are not yet the shared box).
- `alert(` / `confirm(` / `prompt(` (use the toast / box).
- `addPanel(` and `dock(` calls that make plots from plots (one `spawnPlot`).
- Context still passed through the `RUN_CTX` global (P3 not yet implemented).
- Module-level caches (`const X = new Map()`) outside `results.js`: drawing and download caches (contours, palettes, jobs, foot-gap memo, sliding periods). Measured values must not be added here.
- Still separate notify hooks: foot-gap progress (`setGapProgress`), `varsChanged`, and plots that use a measured variable or an output found by searching settings text (`refsIn`, `"source":` in app.js). The change bus (`onResult`) should take them over.

**Cleared (count 0, kept at 0 by the check):** line-kind checks outside `linekinds.js` and their own modules (v14.4); writers to the old result maps `TOOL_VALUES` / `OUTPUTS` / `READVALS` / `FITVALS` / `MEASURED` (v14.4, now `results.js`).
