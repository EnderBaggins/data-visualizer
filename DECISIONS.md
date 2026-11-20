# Visualizer decisions

One entry per design decision. Each entry gives:
- the question;
- what was chosen;
- the human's words;
- the date;
- what it binds.

Newest last. Sessions add an entry whenever a principle in `RULES.md` bends or a new kind of extension point is introduced. The human's quotes are kept verbatim, typos included, because a later session cannot ask what was meant.

---

**D1 — Version numbers (2026-11-09, 2026-11-10).**
- *Rule:*
  - a new concept, way of working or data format → major;
  - a new feature inside existing concepts → minor;
  - a fix, removed option or wording → patch;
  - finishing an earlier change → patch.
- *Human:* "some of these changes were big enough to up the main version number"; v10.0 "might have just been like a 9.1.1 thing".
- *Binds:* RULES §5 step 1.

**D2 — Nothing is added without explicit OK (2026-11-12).**
- *Human,* relayed by a peer session: nothing is added to the visualizer "without their explicit permission first".
- *Also:* cache only what is needed.
- *Binds:* P11.

**D3 — Tools are placed from a Tools tab, in folders, each tool its own button (v12.0–12.1, 2026-11-12).**
- *Human:*
  - "a tool drag that I drag to a plot and that turns on the tool";
  - "lets have it be both" (drag, or click then click);
  - "folders with every tool visible";
  - "there is a draw folder";
  - field lines are "its own tool";
  - "horizontal and vertical as separate things";
  - swap "if they are compatible tools like horizontal vertical".
- *Binds:* P6, the interaction map.

**D4 — Pinned values removed; tools make variables (v12.2, 2026-11-12).**
- *Human:*
  - "is pined variables just a different way of doing variables";
  - "lets just get rid of pinned values";
  - "make more tools like the fits -> variable".
- *Binds:* P2 (one result, several views).

**D5 — Variables are set or measured; ⏱ marks slider-dependent values (v13.0, 2026-11-12).**
- *Human:*
  - variables are things "I set myself for what I look at" or "direct measurements";
  - "set variables vs measured variables";
  - "config can be a measured value";
  - "I like the symbol to show moves with slider".
- *Also chosen:* time-dependent and fixed readings are "subsets of measure", not separate types.

**D6 — Tables: per desktop; a cast writes numbers that change only when cast again (v14.0, 2026-11-13).**
- *Human:*
  - "a new tab";
  - "each row is the point";
  - "allow dataset as a column";
  - "I basically want the cast to cast a number and then that number isnt updated unless I cast again … this is basically for long term results";
  - "tables are like variables so per desktop".

**D7 — The period method is `claude_work/lib/cycles.py`; the viewer's `cycles.js` is a port and must match it (v14.1, 2026-11-13).**
- The method was approved through the research session.
- *Human:*
  - "the window is the window I check for period";
  - "I would want to choose WHAT gets sent";
  - "lets do any plots rn I can choose myself meaningful stuff".
- *Binds:* P12. Fixtures in `tests/fixtures/`.

**D8 — Lineouts (v14.2–14.3, 2026-11-13).**
- *Name:* "make it lineout".
- *Several lineouts:* "multiple cuts comparing … shift click to add new one".
- *Variable:* "allow the tool to cast to variable".
- *One tool per axis:* "it should collapse down to one tool use as a list".
- *Drawing:* "should act like a horizontal or vertical tool for drawing".
- *Colours:* "make it more like the variables choice of color I like the halo option".
- *Binds:* P4. Lineouts should end up built from the line tool + a list (review, Phase 3).

**D9 — The context rule for measured values (2026-11-13).**
- *Chosen:* the value is picked per curve, else per dataset, else the default dataset.
- *Human,* after the explanation: "not sure how 2. works so go with it but i may get confused by it later".
- *So:* when this rule shows up in a result, explain it again with that case's datasets and curves. Don't refer back to the rule's text.
- *Binds:* P3.

**D10 — Docking works across plot types; only things that make sense are shared (v14.2.1, 2026-11-13).**
- *Human:*
  - "the docking should work cross type (the only reason it may not is axis linking, so just DONT link things that make sense" (meaning: don't link what doesn't make sense);
  - plots made by tools go "to the side not below by default but allow me to change it".

**D11 — Cache vs browser (proposed 2026-11-13; decided 2026-11-13, Phase 4).**
- *Rule:* RULES P8 (also in FORMAT.md and the data manager README).
- *Human:* on the rule, "seems fine"; on the stored rates, "if nothing current uses them get rid of those rates" and
  "retire them" (no saved desktop or template used them; two orphan setup files from 2026-10-07 did); on the two line
  voltages, "if they are the same units in y and same measurements why do I have two?" and, after the answer (the
  profile vs the one-number-per-line summary, 163 MB vs 168 KB on rcs-pairs-1-ec025), "yeah" to one y-axis group;
  on the browser features, "go for it"; then "go for it all".
- *Chosen:*
  - **Retired** (method files to `claude_work/archive/datamgr-methods-2026-11-13/`, stored data dropped): twist_rate,
    twist_rate_drive, twist_rate_voltage, twist_energy_rate, untwist_time, untwist_time_line,
    untwist_time_line_voltage, ohmic_power. The browser makes them: d/dt of a line (with smoothing), and "across lines"
    lines for ∂V/∂Ψ and −∫V dI. Lost: the two per-line untwist-time ratios (the browser can't divide one curve by
    another point by point).
  - **Both voltages stay** (the coarea `line_voltage` = one number per line per time; `along.phi` = the profile along
    each line, whose end is the same number: measured 0.94–1.03 of each other wherever |V| > 1). The along-line
    potential is drawn in the y-axis group "voltage" (data manager page setting; nothing recomputed).
  - **New in the browser:** "across lines" lines, and a y-axis group and units for expressions.

**D12 — Universal definitions for tools and boxes (2026-11-13).**
- *Human:*
  - "I want more universal ways of using and defining tools … (that can be overwriten but by default new tools should use the same design principles)";
  - tool cards and settings boxes "are the same design concept so should follow the same rules".
- *Binds:* P5, P6.

**D13 — How the codebase is kept consistent (2026-11-13).**
- *Human:*
  - "I want to setup this codebase to allow for me to much such varied changes as in the last like v8-v14 without breaking core principles";
  - "my main intearction with developing is through AI i dont do code";
  - "the documents I dont ccare too much about so long as they enforce consistency".
- *Chosen:*
  - an auto-loaded rules file (`RULES.md`, via `visualizer/CLAUDE.md`);
  - a check script (`tools/check.mjs`) that blocks new violations and runs tests;
  - an upload hook that refuses viewer uploads unless the check passed on exactly the local files;
  - this log.
- *Approved:* "then yeah go for it all".

**D14 — Phase 2 details chosen by the AI, open to the human (2026-11-13).**
- *Human:* "yes go phase2" (the universal definitions: boxes, tools, colours, one way to make a plot from a plot).
- *Chosen without the human's words (say if you want them otherwise):*
  - **Cards still close when you click outside every box,** like quick menus. The settings box (⚙) closes only with × or Esc. Alternative: cards stay open until × or Esc, like ⚙.
  - **A box with a title is a card** (title bar, ×, dragging); a box without one is a quick menu.
  - **Plots made from a plot dock to its right,** except "copy with another dataset", which docks below (its menu says so). Foot-gap plots: the width plot beside the steps tool's plot, the voltage plot below the width plot. A plain copy is placed after its source, not docked.
  - **Field lines:** "list colours" off by default (one colour, as before).
  - **Table points grouped by dataset** take the dataset's colour from the dataset lists; a dataset in no list gets the next free colour, as before.
- *Human (2026-11-13), on these:* "keep yor 2" — cards keep closing on a click outside (confirmed).

**D15 — A lineout has one colour, map line and curve alike (2026-11-13).**
- *Human:* "probably keep as is I want it clear which line is which how much would autodarken even do thats complicated if I can halo it that just works for me".
- *Chosen:* one colour per lineout for its map line and its curve (no auto-darkening, no second colour). A light colour that vanishes on the white 1D plot is the user's choice; the halo handles dark maps.
- *Closes:* review bug 15.

**D16 — Focus is the only view; the grid view is removed (v14.8.0, 2026-11-20).**
- *Human (2026-11-19):* "I realize the grid vs focus may be too much I only ever use the focus now and I think it may be best to have that be default"; on removing it entirely as part of the public-release cleanup: "yes both can go in plan"; "go ahead with what you suggest now".
- *Chosen:* one large plot plus the side strip, always. Plot widths in columns stay (the focus view scales from them). Moving a plot = dropping it in the strip; docking = the dock tabs, as before.
- *Why:* one layout and one set of drags to keep working. Not for speed: code for an unused view costs nothing, and focus was already the cheaper view while playing (the strip redraws every 4th frame).

**D17 — The public release: core, analysis add-ons, your plugin (2026-11-20).**
- *Human:* "mainly for others in my group on other datasets so they can fork it and adjust as they will"; "the data management is heavily connected and nice … with just the methods being datatype specific"; tools as **core + plugin folder**; on the period and steps tools: "they while general may not be done super nicely so dont want them locked in as core stuff. I would think of it like a python library visualizer is matplotlib and these other tools are a different things that WORKS with it"; on along-line data: "lets start with plugin"; on the meridional view: "yeah seems core I want the 2D to work in general for different axes"; on history files: "I like it showing v14 … the v1.0 public may confuse me or you with later development"; "default license"; "go ahead with what you suggest now".
- *Chosen:*
  - **Three layers.** Core (the matplotlib part: plots, maps for any axes including the meridional view, figures, data, expressions, variables, readings, tables, desktops, lineouts, lines / bands / points / contours at values). General **analysis add-ons** (period, steps, across a dimension, fit, averaged curve) that work with the core but are not part of it. The **aperture4** plugin (field lines, along-line data, foot gaps, Ψ, your names and example desktop).
  - **Data manager:** the framework is general; a project folder holds each person's reader for their files plus their methods (yours = `projects/aperture4/`).
  - **Version numbers continue** (v14.x); CHANGELOG and DECISIONS keep their history; MIT licence.
  - Open: whether `projects/aperture4/` is published (the human: "not sure yet … I don't really care if they see my project"); built so it can be left out without changes.
- *Plan:* `reports/2026-11-20_public-release-plan.md` (stages 1–8). Stage 1 = D16.
- *Binds:* every later stage; new extension points (plugin register functions) get their own entry when built (RULES §4).

**D18 — Plugins register into the core's registries (v14.9.0, 2026-11-20).**
- *Human:* "yes go ahead with stage 2" (the plugin loader; stage 2 of the plan, D17).
- *Chosen:*
  - `viewer/plugins/index.json` lists the plugins; `?plugins=a,b` overrides it for one visit. Each plugin is a folder with an `index.js` whose default export gets the register functions, once, before any desktop is read (`js/plugins.js`).
  - Five hooks now, each the existing registry opened up, not a new mechanism (P1): `registerLineKind` (LINE_KINDS), `registerTool` (TOOL_DEFS; a new folder name gets its own Tools folder), `registerLineMenu` ("+ line" entries), `registerSymbols` (latex.js KNOWN), `registerMigration` (run inside `migrateDesktop`, after the core's steps). Each checks its entry and refuses a bad one with the reason.
  - A plugin that fails is reported and skipped; the viewer starts without it. A desktop's lines from a plugin that is off are kept and say so ("a line made by a plugin that is not loaded").
  - Plugin files are checked like the core (`check.mjs`: syntax, debt counts, desktop schema; `plugins/index.json` names real plugins).
  - Further hooks (a tool's own drawing, a plugin's axes and data kinds, reading operations, plot-menu entries, server endpoints) are added when a feature moves and needs them, each with its own entry.
- *Binds:* RULES §4 (new row: non-core features go in a plugin), P1, P9.

**D19 — Your physics moves into the aperture4 plugin (v15.0.0, 2026-11-20).**
- *Human:* "na just move all those features now" (after the plan proposed one feature per release).
- *Moved* to `viewer/plugins/aperture4/` (listed in `plugins/index.json`): foot gaps (`gapseries.js`), "across lines" (`across.js`), field lines (`fieldlines.js`: the r_max-footpoint level mode and the "field lines" tool), and the names (`names.js`: LaTeX symbols, axis names in the menus, default quantities, the example desktop). Along-line data follows as its own release (it needs hooks for axes, map rendering, readings and plot menus).
- *Chosen (new hooks, each the smallest that the move needed):*
  - `registerOutputAction` (a button on a named tool's output card), `registerContourLevels` (a contour level mode), `registerAxisNames`, `registerExampleDesktop`, `registerDefaults` (`scaleRef`, `configVars`); `api.core` = `toast`, `spawnPlot`, `redrawReaders` from the wiring.
  - Line kinds may give `yKind(l)` (their y-axis group); "+ line" kinds may give `prefer(ctx)` (the menu opens on them); a tool may give `problem(ctx)` (why it can't go on a plot). A curve may carry `progress` / `progressLabel` and `warn` (the plot's note and error line; was foot-gap-only).
  - **A later tool definition wins** for the same stored tool (`defOf` = last match): the plugin's field lines (contours with `levelMode: "rmax"`) over the core's contours.
  - The core's contour tool is general ("contours", any 2D quantity at values; `q` null = the map's own). A level mode whose plugin is off draws nothing (not wrong lines).
- *With the plugin off:* the general tools only; the core's example desktop (the first map and first time series); saved field lines draw nothing and saved plugin lines say "a line made by a plugin that is not loaded"; nothing is lost.

**D20 — Along-line data moves into the aperture4 plugin (v15.1.0, 2026-11-20).**
- *Human:* "lets start with plugin" (on along-line data, D17); D19: "Along-line data follows as its own release (it needs hooks for axes, map rendering, readings and plot menus)".
- *Moved* to `viewer/plugins/aperture4/`: `alongdata.js` (what along-line data is: dim `pt`, its arc length `<family>.s`, the axes s / s/s_max / s from the south foot, the map kinds A/B/C, and the api/window transport that was `data.js` lineWindow), `alongmap.js` (the A/B/C maps that were ~250 lines of `panel2d.js`, and the series a lineout of such a map reads), `alongline.js` (the 1D curve per frame from `panel1d.js`, the map axes and settings rows from `model.js` / `settings.js`, the new-map form, lineouts, the "line length" reading, "▦ linked slices" from `app.js`, and the v10.0 migration of old 200-point profiles). `plugin.json` names the dim only it can draw.
- *Chosen (new hooks; each is a registry opened up, P1):*
  - **One data-kind hook,** `api.registerDataKind({key, is, …})` (`model.js` `DATA_KINDS`, every optional field documented there). The core asks the kind wherever such data are treated differently: its x axes (`dims`, `axes`, `axisInfo`, `fitAxis`, `fitsDims`), a 1D curve's x and values per frame (`lineData`, `readsWith`), a map of it (`setMapAxes`, `mapAxes`, `mapTimes`, `mapYRange`, `mapLoad`, `mapPrepare`, `mapView`, `mapPaint`, `mapLabels`), its settings rows and the new-map form (`mapAxisOptions`, `mapPairOk`, `mapOtherFor`, `mapCanLog`, `mapSkipDims`, `mapRows`, `mapHint`, `startPicks`), lineouts (`lineoutDefault`, `lineoutPositions`, `lineoutCurve`). One hook instead of a dozen small ones, so a second kind of data (another person's plugin) has one place to look.
  - `api.registerReadingOp({key, label, value(curve), text, help, missing, perCurve})` (`measure.js`; list `model.js` `READING_OPS`): a reading operation; perCurve = each curve uses its own value where a setting uses it (the line length `$L`).
  - `api.registerPlotMenu({key, label, title, available(panel), run(panel)})` (`plugins.js`): an entry in a plot's ⋯ menu. `api.core` gains `makeFigure`, `rebuildAll`, `save` (linked slices make a figure).
  - **With the plugin off:** `plugin.json` (`{"data": [{"dims", "what"}]}`) of each plugin `index.json` lists but is not loaded is read by the loader; a map, 1D line, lineout or settings box of such data says "needs the aperture4 plugin, which is not loaded: …" and draws nothing; its settings stay as saved (checked: identical after a load with `?plugins=`). A reading with the plugin's operation says "a reading made by a plugin that is not loaded". Dims claimed this way leave the x-axis menu. Old 200-point profiles are only moved when the plugin is on.
  - **Stays core:** `data.js` lineRows (row r of every output via serve.py api/rows: general for any data whose last dim is a line), `store.rowsApi`; the map settings keys `slope`, `smooth`, `at` (they are in the desktop schema; only the kind uses them); `AXIS_ORDER` keeps the other aperture4 dims (r_max, theta_foot, r_out) as before (D19 left names to `names.js`, ordering was not moved). `serve.py` unchanged.
- *Behaviour with the plugin on:* the same (test store with synthetic along-line outputs: every curve, map colour range, reading value and request count identical before and after the move).
- *Done with the release:* RULES.md §4 "add something that is not core" lists `registerDataKind` / `registerReadingOp` / `registerPlotMenu` too. The move was made by a background agent (brief: one coherent hook, identical behaviour); reviewed in the main session (check, plugin-off load of the 7-plot desktop).

**D21 — The data manager reads through a project's reader (v15.2.0, 2026-11-20).**
- *Human:* the data manager "is heavily connected and nice (with just the methods being datatype specific (the data management remains with just different methods for different peoples data" (D17); "ok go ahead and swap it in" (after "is this swapping my current stored data or what?" — no: only the code).
- *Chosen:*
  - **The framework** (`claude_work/datamgr/`) imports nothing of Aperture4: it reads runs through a **reader** class (`datamgr/reader.py`: `is_run`, `n_outputs`, `field_names`, `open`; per run `steps`, `is_settled`, `time_of`, `load`, `fields`, `grid` → coordinates + geometry, `metadata` → config numbers).
  - **A project** (`claude_work/projects/<name>/project.json`) names its reader, the modules loaded before the methods (axes, warm specs), its methods / tools folders, groups and about files, the store / jobs / data paths, extra import paths and the page's words (title, how-to, axis badges). Found by `DATAMGR_PROJECT`, else the only project, else `projects/default`. Environment overrides (`DATAMGR_STORE` …) still win.
  - **aperture4** = the old behaviour: its reader wraps DataSph; methods, field-line tools, warm specs, axis list, groups and cards moved there unchanged. `demo` = a minimal second project (one .npz per output) used to test the framework on other data.
  - Portability: file locks on Windows (msvcrt), `os.path.isabs`, worker count without `/proc`.
  - The swap kept stored data untouched: same method versions (25), same `list`, same `status` apart from two added fields (`project`, `axes`); a side-by-side cache on scratch stores gave byte-identical files (37/37, 23/23). Old package archived in `claude_work/archive/datamgr-2026-11-20/`.
- *Binds:* RULES (the data manager's projects), FORMAT, the public-release plan stage 5.
