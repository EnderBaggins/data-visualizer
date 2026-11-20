# Visualizer changelog

Release notes, newest first: what changed, the human's words, how it was tested. Moved out of README.md on 2026-11-13
(rules: RULES.md; why decisions were made: DECISIONS.md). Each entry: version, date, level (major / minor / patch),
what changed, the human's request in quotes, how it was tested.

- **v15.2.0 (2026-11-20, minor): the data manager reads through a project's reader; its page follows the project.**
  (human: "ok go ahead and swap it in" — DECISIONS D21; stage 5 of the public-release plan) Stored data untouched.
  - **The data manager** (`claude_work/datamgr/`, swapped in on the server and locally; old package archived in
    `claude_work/archive/datamgr-2026-11-20/`) knows nothing of Aperture4: runs are read through a reader class; the
    aperture4 project (`claude_work/projects/aperture4/`: reader wrapping DataSph, the 19 methods unchanged, axes, warm
    specs, field-line tools, groups, cards, `project.json` with the server paths) gives today's behaviour; a minimal
    `demo` project tests it on other data. Windows / Mac: file locks, path checks, worker count.
  - **Its page** (`viewer/datamgr.html`, `js/datamgr.js`) takes its title, how-to text, axis badges and wording from
    the project (the status JSON's new `project` / `axes`); for aperture4 it looks as before.
  - **serve.py**: `--datamgr DIR` and `--project PATH` options (defaults unchanged; takes effect at its next start).
  - Tested (background agent, server): old vs new side by side on scratch stores — 37/37 and 23/23 stored files
    byte-identical, manifests equal apart from timestamps, all 25 method versions equal, read-only `status` / `datasets` /
    `list` on the live store equal apart from two added fields; demo project end to end on Windows; the page served with
    each project. After the swap (here): `list` identical, `status --json` identical apart from `project` / `axes` and
    the methods' file paths. Not tested: `follow`, rename / remove dataset, presets, labels, `dm.save` (their code is
    unchanged apart from where groups.json lives).
- **v15.1.0 (2026-11-20, minor): along-line data moves into the aperture4 plugin.** (human: "lets start with plugin" for
  along-line data, "na just move all those features now" — DECISIONS D20) Nothing changes on screen with the plugin on.
  - **Moved to `viewer/plugins/aperture4/`:** what along-line data is (dim `pt`, arc length `<family>.s`, the s / s/s_max
    / s-from-the-south-foot axes, map kinds A/B/C) and its server transport (`alongdata.js`); the A/B/C maps (~250 lines
    of `panel2d.js`, now `alongmap.js`); its 1D curves, map axes and settings rows, new-map form, lineouts, the "line
    length" reading, "▦ linked slices" and the migration of old 200-point profiles (`alongline.js`).
  - **New hooks:** `registerDataKind` (one place where a kind of data says how its axes, curves, maps, settings rows and
    lineouts work), `registerReadingOp` (a reading operation; "line length"), `registerPlotMenu` (an entry in a plot's
    ⋯ menu; "▦ linked slices"); `api.core` gains `makeFigure`, `rebuildAll`, `save`. A plugin folder may carry
    `plugin.json` naming data only it can draw.
  - **With the plugin off:** along-line plots keep their settings and say "needs the aperture4 plugin, which is not
    loaded: …"; its dims leave the x-axis menu; a "line length" reading says it needs the plugin.
  - Done by a background agent; tested there on the local test store with synthetic along-line outputs (the store's own
    have none): every curve, map colour range, reading value and request count identical before and after (maps A/B/C,
    1D on s, s/s_max, s_south; lineouts from A and C; reading L = 6.2246); linked slices, settings-box axis swaps, new-map
    form, old-profile migration; plugin off: the message, settings kept. Reviewed here: check passes; the 7-plot example
    desktop loads with the plugin off (no warnings). Not tested: real along-line data (no access from here; please look
    at one along-line plot on the live viewer), float16 along data, foot gaps end to end, dark theme.
- **v15.0.0 (2026-11-20, major): your physics moves into the aperture4 plugin.** (human: "na just move all those
  features now" — DECISIONS D19; stage 3 of the public-release plan, D17) Nothing changes on screen with the plugin on
  (it is listed in `viewer/plugins/index.json`); with it off, the core is general.
  - **Moved to `viewer/plugins/aperture4/`:** foot gaps (`gapseries.js`: the line kind, the "foot gap…" entry in
    + line, its editor, "→ foot gaps vs t" on a steps tool's card), "across lines" (`across.js`: line kind, "+ line"
    entry, editor), field lines (`fieldlines.js`: the r_max-footpoint level mode, the "field lines" tool and its "no Ψ"
    check), names (`names.js`: LaTeX symbols r_max, Bp, θ_foot …, the axis names in the quantity menus, ÷ drive_twist
    and twist_rmax_1/2 as defaults, the example desktop with baseline-19/18).
  - **The core instead has:** a general "contours" tool (any 2D quantity at values; the field lines are the plugin's
    version of it); a plain example desktop (the first map and first time series); neutral menu order and axis names.
  - **New hooks** (plugins.js): output-card buttons, contour level modes, axis names, example desktop, defaults,
    `api.core` (toast, spawnPlot, redrawReaders); optional `yKind` on line kinds, `prefer` on "+ line" kinds, `problem`
    on tools; curves may carry `progress` / `warn` (the foot-gap progress note and errors are now general). A later tool
    definition wins for the same stored tool.
  - **Not moved yet:** along-line data (its own release; it needs hooks for axes, map rendering, readings, plot menus).
  - Tested in the browser (local test store): with the plugin on — it loads; "+ line" on a time plot lists "across
    lines…", and an across line (mean of line_current over the lines) gives 201 finite values; the field lines draw on
    both linked maps ("field lines at r_max 2,4,6,8" in the tool list); draw tools are horizontal / vertical line, band,
    point, contours, field lines; symbol r_max typesets as r_max. With the plugin off — the viewer starts, no errors;
    draw tools without field lines; saved field lines draw nothing; the core's example desktop is used. Test plots removed.
    Not tested end to end: foot gaps (the test desktop has no named steps tool; their code moved unchanged).
- **v14.9.0 (2026-11-20, minor): plugins.** (human: "yes go ahead with stage 2" — DECISIONS D18; stage 2 of the
  public-release plan, D17) No feature changes: the viewer can now load plugins that add to it from outside the core.
  - **The loader** (`js/plugins.js`): `viewer/plugins/index.json` lists the plugins (empty for now); `?plugins=a,b` in
    the URL overrides it for one visit. Each plugin is a folder `viewer/plugins/<name>/` whose `index.js` is called once
    at start-up, before any desktop is read. A plugin that fails is named in a message and skipped.
  - **Five hooks**, each an existing registry opened up: `registerLineKind` (made lines, `linekinds.js`), `registerTool`
    (tools; a new folder name gets its own folder in the Tools tab), `registerLineMenu` (entries in "+ line"),
    `registerSymbols` (LaTeX names in labels), `registerMigration` (conversions of old desktops, inside
    `migrateDesktop`). Each checks its entry and refuses a bad one with the reason.
  - **A desktop line from a plugin that is off** is kept and its plot says "a line made by a plugin that is not loaded
    (…): add the plugin to viewer/plugins/index.json" (it said "undefined is not cached").
  - **The check covers plugins:** their files get the syntax, debt and desktop-schema checks; `plugins/index.json` must
    name real plugins with a default export. Guide for plugin authors: `viewer/plugins/README.md`; RULES §4 has a new
    row (non-core features go in a plugin).
  - Tested in the browser (local test store) with a throwaway test plugin (not kept): a plugin with a bad tool entry is
    refused with the reason ("registerTool(hline): missing folder, where, …") and the viewer starts normally; a good one
    adds a symbol (typeset), a line kind, a "+ line" entry (shown only on time plots; its line was placed in a new plot
    docked beside, drawn at y = 7), a tool in its own "test plugin" folder of the Tools tab, and a migration (ran on
    load); with the plugin off, the desktop keeps the line and shows the new message. Test plot removed afterwards; no
    console errors. Not tested: a plugin line's editor (click on its legend entry).
- **v14.8.0 (2026-11-20, minor): focus is the only view; the grid view is removed.** (human: "I realize the grid vs
  focus may be too much I only ever use the focus now and I think it may be best to have that be default"; "yes both
  can go in plan"; "go ahead with what you suggest now" — DECISIONS D16; stage 1 of the public-release plan, D17)
  - **The viewer always shows one plot (or figure) large and the others small in the side strip.** The Grid / Focus
    switch is gone from the header. Hover a small one to see it bigger, click it to make it the large one, Tab /
    Shift+Tab step through them; a new plot becomes the large one.
  - **Moving plots:** drag by ⠿ into the strip to change the order, or onto a dock tab to dock it (as before in focus).
    The width corner works as in focus before (grows on both sides, snaps to whole columns within 8 px).
  - **Removed code:** the column packing (`place`), the grid half of dragging (ghost, slot, live preview), the
    view-mode switch and its ~15 checks, grid-only styles. Plot widths in columns stay (focus scales from them); old
    desktops open unchanged.
  - Not for speed (unused code costs nothing; focus was already the cheaper view while playing).
  - Tested in the browser (local test store, the example desktop: 1 large + 5 small): opens in focus with no switch;
    clicking a small plot makes it the large one; Tab moves on and Shift+Tab back; dragging a small plot in the strip
    moves it (undo restores the order); the width corner narrows the large plot (707 → 347.5 px) and undo restores it;
    no console warnings or errors. Not tested: docking by drag in this release (that code is unchanged).
- **v14.7.0 (2026-11-13, minor): a table opens in its card.** (human: "one suggestion for tables when i click it its
  actually a popup box so I dont have this awkward scrolling"; on the box: "I thought boxs were like settings box which
  are draggable. I need you to ensure you follow the new structure we defined" — RULES P5, D12)
  - **Tables tab** lists the tables (▦ name, rows × columns, plot…, CSV); the grid no longer unfolds in the sidebar.
  - **Click a table's name:** its rows open in a card (`popover()` with a title, so the shared box: title bar, ×, drag,
    kept on screen, Esc), beside the click, at the table's full width. The grid scrolls inside the card only when it is
    taller than the window, with the column names kept in view. The card holds the size, plot…, CSV, **rename** and
    **delete** (the sidebar's ⋯ menu is gone: one place, P1), the grid, + row and + column…. A column's menu opens over
    the card. "+ table" opens the new table's card. Edits, casts and undo fill the open card again; a cell keeps the
    focus (Tab between cells works).
  - **Blocking questions keep the cards under them** (`ui.js`): naming a column, renaming or a delete question no longer
    closes every card (it closed the table you were editing). The question sits over the cards, answers its own Esc, and
    a click in it is not a click outside the cards.
  - Debt counts unchanged (popover() outside ui.js: 21; the table card replaced the ⋯ menu's box).
  - Tested in the browser (local test store, table T 3 × 3): the card opens with 3 rows and the column names, × and a
    title bar; dragged by the title (400, 200 px); + row → 4 rows; a typed cell (42) is kept and keeps the focus; + column
    → typed → the name question sits over the card (z 44 over 35), the card stays and shows the new column; rename
    T → T2 and back updates the title and the sidebar; a column's menu opens over the card and its delete keeps the card;
    Esc closes the card; undo of a rename shows "This table no longer exists" in the card (the name it showed is gone);
    48 rows: the grid scrolls inside the card, the column names stay at its top and + row stays on screen; no console
    errors. Table T restored to 3 × 3. Not tested: dark mode.
- **v14.6.0 (2026-11-13, minor): Phase 4 of the architecture review: what is stored vs computed; "across lines" lines;
  y-axis groups for expressions.** (human: "seems fine" to the rule; "if nothing current uses them get rid of those
  rates" / "retire them"; on the two voltages "why do I have two?", then "yeah"; on the features "go for it"; "then go
  for it all" — DECISIONS D11)
  - **The rule** (RULES P8, FORMAT.md, data manager README): store only what needs the dumps, a full pass over every
    output, or is a map viewed very often; everything made from stored quantities is computed in the browser, never
    stored (never stale).
  - **"across lines…"** in + line (on a time axis; `across.js`, arithmetic `stats.js` acrossValue, tested): from a
    quantity with one value per field line, at every output its slope across the lines at a line (d/dΨ, Ψ = Bp / r_max,
    or d/dr_max; an r_max list gives one curve each), or ∫ dr_max, ∫ q d(another), mean or max over the lines, × a factor
    k. Checked against the stored rates before they go (rcs-pairs-1-ec025, rcs-pairs-chen-1): ∂V/∂Ψ at r_max 3 / 4.9 /
    8.1 with a mean over ±2.5 in time = stored twist_rate_voltage to 0.1–4.5 % rms; 2π × ∫ line_voltage d(line_current)
    = stored ohmic_power to 4 digits.
  - **Expressions** take `# label [y-axis group | units]` (as analytic functions take [group]): they then share a y axis
    with stored quantities of that group, with their units.
  - **The two line voltages:** the along-line potential is drawn in the y-axis group "voltage", like line_voltage
    (data manager setting; nothing recomputed). Measured: its end = line_voltage within 0.94–1.03 wherever |V| > 1
    (they differ only in what they keep: one number per line vs the whole profile).
  - Tested: check passes (new tests: across-lines arithmetic, expression [ ] parsing). In the browser (local test
    store): "across lines…" in + line; slope, ∫ dr_max, ∫ q dq₂, mean and max each give 201 finite values on
    baseline-19; an r_max list (3, 5, 8) draws three curves in a plot docked beside its source; its editor opens; an
    expression with [current | code units] lands in the "current" group with its units. Not tested in the browser:
    line_voltage itself (its files are not in the local test store; the arithmetic was checked on the server data).
- **v14.5.1 (2026-11-13, patch): Phase 3 of the architecture review: simplify.** (human: "now lets do 3"; on bug 15:
  "keep as is ... if I can halo it that just works for me" — DECISIONS D15; on cards closing on a click outside: "keep
  yor 2")
  - **One way to draw a tool's line and its label** (render.js `drawToolRule`, model.js `toolLabel`): horizontal and
    vertical lines, the slider-time line and lineouts draw and label alike on maps and 1D plots. Fixed on the way:
    `{v}` in a fixed line's or a fixed point's label was never filled (their cards promised it); lineout labels now
    fill `{dataset}` and `{t}`. The lineout's curve was already built from a plain data line cut at each position, so
    it keeps its own card (positions, colours, its plot) — no change to how lineouts are saved.
  - **Retired "line at the slider's time"** (`now`): it is a vertical line in "at the slider's time" mode, drawn across
    whichever axis is time and not at all without one. Old desktops convert as they open; new time plots get the
    time-mode line. The tool switcher no longer lists it separately.
  - **Retired "averaged curve along x"** from the card: a line at each curve's mean is a horizontal line "from each
    curve" (old ones converted since v12.0); the averaged curve offers only other axes.
  - **Retired the "free" state** (a plot linked to a figure but outside it): every group is a figure and a plot dragged
    out is unlinked at once; old desktops lose the flag as they open. The guards for a figure being made stay.
  - **Wording** (RULES §2): plot / map instead of panel in everything you read ("+ map", "+ 1D plot", "plot size",
    "linked plots" …), dataset instead of run, reading instead of "measured variable" for one reading, "setup files"
    for the pre-v8.1 panel setups, no more "Outputs tab" or "record.yml". The check now also counts "panel" in on-screen
    text (8 → 1; the 1 names old desktops' pinned values).
  - **README "Using the viewer"** rewritten for today's viewer (it described v4: free-floating panels, panel setups,
    the now tool).
  - Check: a test for tool labels and the time-mode line.
  - Tested in the browser (local test store): three old `now` lines converted to time-mode lines on load and drawn at
    the slider's time; a line labelled "E = {v}" shows "E = 2500"; the averaged curve's card offers only r_max; the
    header shows "+ map" / "+ 1D plot"; no console errors.
- **v14.5.0 (2026-11-13, minor): Phase 2 of the architecture review: one way for boxes, tools, colours and plots
  made from plots.** (human: "yes go phase2"; D12: tool cards and settings boxes "are the same design concept so should
  follow the same rules"; tools should share "the same design principles" by default)
  - **Boxes** (`ui.js` popover): every card (a box with a title) has a title bar with × and is dragged by it, stays on
    screen as its content changes, and Esc closes the top box. A colour picker opens over its card instead of closing
    it. Quick menus (no title) are plain. Cards still close on a click outside every box (a choice, DECISIONS D14).
  - **One definition per tool** (`settings.js` TOOL_DEFS, defaults in TOOL_DEFAULTS): label, help, folder, where it can
    go, how a new one starts, its summary, its card rows, whether it draws lines, how it is coloured. The card shows
    line style and width only for tools that draw lines, and the colour picker only for tools drawn in one colour
    (it was shown and ignored for curve-coloured and list-coloured tools). Fixed on the way: the period tool's card
    had a "line width" box that overwrote its sliding-window width.
  - **One way to make a plot from a plot** (`spawnPlot`): period, lineout, foot-gap and "plot beside" plots and linked
    copies dock beside their source; foot-gap plots and plot-beside plots were placed after it, not docked.
    "Copy with another dataset" still docks below (its menu says so); a plain copy is placed after its source.
  - **Colours** (RULES P4, a list owns its colours): field lines can take their list's colours ("list colours") and
    every map line (horizontal / vertical line, slider-time line, field lines) can have a halo, like lineouts. Table
    points grouped by dataset take the dataset's colour from the dataset lists; period-tool plots take their source
    curves' colours.
  - Check: a test that every tool is one definition with every field and that summaries, card rows and adding no
    longer branch on the tool type. Plot-from-plot paths 14 → 9 (the rest: drag-docking, templates, "+ plot").
  - Tested in the browser (local test store): cards drag by their title, × and Esc close them, a picker opens over its
    card and Esc closes it first; every one of the 11 tools adds from the Tools tab and its card shows style and colour
    only where they are used; linked copy docks beside its source, copy goes after it; field lines in list colours with
    a halo and a haloed line on a map (screenshot); no console errors. Not tested: foot-gap plots (no foot-gap data).
- **v14.4.1 (2026-11-13, patch): linked table plots no longer lock their y axes together.** (human: "I linked two table
  plots now their y axes are locked together and I cant separate them even with the choosing link as their own"; the fix
  was made in the Interactive Plotter Work session as v14.3.3 and went live inside v14.4.0 without a note; this entry
  records it.)
  - Cause: table, period and lineout plots have no y-axis group, so any two counted as "the same y axis": one y range,
    the right plot's y numbers hidden, one y pan & zoom; "its own" was ignored, and the y row's 🔗 menu offered no
    per-plot pan & zoom choice.
  - Now a plot without a y-axis group is named by what its lines draw (`yAxisId`: table column, period plot, lineout).
    Two plots share a y axis only when they draw the same thing, and a plot whose y window is "its own" never shares.
    The y row's 🔗 menu adds "this plot · pan & zoom: follows the plots with the same axes / its own".
  - v14.4.1: what each made line draws is now the line registry's `yId` field (linekinds.js), not a check of its own.
  - Tested (both sessions, local test store): two linked table plots of different columns each keep their own y axis;
    of the same column they share one; "its own" separates them again.
- **v14.4.0 (2026-11-13, minor): Phase 1 of the architecture review: the foundations.** (human: "yes for phase 1")
  Mostly invisible; what a later change builds on, each enforced by `tools/check.mjs` (RULES.md §4 table):
  - **One "curve as drawn"** (`asDrawn` in panel1d.js): plots, readings, fit variables, foot gaps and the averaged curve
    read a line the same way (f(x), scale, smoothing, slope, f(y)); there were five copies.
  - **One place for statistics** (`stats.js`, no DOM, tested): max, min, x at max/min, mean, crossing. Visible: a mean on
    a curve with gaps now leaves the gaps out everywhere (readings, the averaged curve and "÷ mean" drew a straight line
    across them; the draw tools' "mean of each curve" left them out), and a mean of one point is that point.
  - **The line-source registry** (`linekinds.js`): foot-gap, table, period and lineout lines are one entry each (expand,
    curve, name, editor, colour, what they read, what they can do). Every if-chain on line kind is gone (19 → 0).
  - **One desktop schema** (`DESKTOP_SCHEMA` in model.js) for save, open, undo, reset and startup, and **one migration
    pipeline** (`migrateDesktop`) for every way a desktop arrives (startup, open, restore previous, new / example
    desktop, template inserts; they ran different subsets). Visible: "new empty desktop" also clears the style, time
    range, expressions and their notes (it kept the old desktop's); undo now includes the old per-desktop functions.
  - **One result store and change bus** (`results.js`, no DOM, tested): tool card values, readings (own line and per
    dataset), fit variables and named outputs live in one store keyed (owner, scope), with one "same dataset and picks"
    rule (`samePoint`, also used by table casts) and one change signal (`onResult`) that replaced three notify hooks
    (period plots, lineout plots and output users redraw from it). Eight Maps and three matchers are gone.
  - The check now also tests: stats.js, results.js, the registry's fields, that save/undo/open/reset read the schema,
    that migrations run only inside the pipeline, and it counts module-level caches (none may hold measured values).
  - Tested: check passes (8 tests). In the browser (local test store): every plot draws on reload with no warnings; a
    table, lineout and period plot each show their name in ⚙, open their own editor, and draw; moving a lineout and
    changing a period window redraw their plots through the change bus; a reading's own value and per-dataset values
    (baseline-18 / baseline-19), a fit variable per dataset matching its card (c1 = −17.389 / −17.665), a steps tool's
    output ("$steps1.from": 107 values), table casts filling the right rows, undo/redo of a tool, new empty desktop,
    restore previous, opening a saved desktop. Not tested: foot-gap lines (no foot-gap data in the test store).
- **v14.3.2 (2026-11-13, patch): Phase 0 of the architecture review: fourteen bug fixes.** (human: "yes start it", the
  first work under RULES.md; bugs numbered as in `reports/2026-11-13_architecture-review.md` §4)
  - **Crashes and names (1–3, 12).** The averaged-curve tool and the "÷ max of another quantity" scale no longer break on
    table, period, foot-gap and lineout lines (the scale says it needs a recorded line). The ⚙ line list, the legend and
    the period / fit cards name every kind of line with one shared name (they showed "undefined · …" and a ⚠). A
    lineout's hover in the Tools tab says "maps (2D plots)", not "any plot".
  - **Typed lists (5).** The horizontal / vertical line's "at" box takes "0.5, 1, 2" as it says (one line each); other
    number boxes say a list belongs in a number variable.
  - **Readings and fits (6–9).** A reading uses the line as drawn, its scale included (÷ max: a max reads 1). A reading
    on a dataset-list line gives a plot of dataset B dataset B's value (P3: the same dataset first; it gave A's). A fit
    variable on an r_max-list line gives each curve its own r_max's fit (they all got the first). Deleting a fit or
    config variable leaves its current value where it was used (it left 0).
  - **Tools (10, 11).** A shared tool's card shows its own plot's values (the values are kept per plot; it showed the
    plot drawn last). Every way of removing a tool (card, ⚙ list, 🛠 list) also drops its values and output.
  - **Figures (13).** A figure with both maps and 1D plots (e.g. a map with its lineout docked) redraws all of them when
    the time slider moves (only the first plot's type was drawn).
  - **Foot gaps (14).** They recompute when a variable they use changes value ($rmax …), and fill in new outputs when a
    run grows (they kept the old results).
  - **Desktops (16, 17).** Notes on expressions are saved with the desktop and in undo (they were lost, and carried over
    to the next desktop opened). Tagging from a plot re-reads the dataset cards first, so notes edited on the data
    manager page meanwhile are kept.
  - Not changed: bug 15 (a white lineout colour on the white 1D plot), a design choice for the human.
  - Debt counts went down: line-kind checks 26 → 19 (one shared line name), result-cache writers 9 → 7 (one setter for
    tool values), unsaved desktop fields 1 → 0.
  - Tested: `tools/check.mjs` passes with a new node test (context rule, per-curve fits, typed lists, delete keeps the
    value; it fails on the old code). In the browser (local test store): a table plot with a ÷-max scale and an averaged
    curve shows the message, no crash; ⚙ list names; "0.5, 1, 2" draws three lines; a lineout docked into a map figure
    redraws with the slider; a ÷ max reading reads 1; tool values keyed per plot; no console errors. Not tested in the
    browser: shared tools across a linked figure (code path only), foot-gap recompute (no foot-gap test data), tagging
    (needs the server token).
- **v14.3.1 (2026-11-13, patch): "mean along …" is back in the readings' measure menu.** v14.1 put it inside a comment by
  mistake: "→ variable" from a mean (draw tool, averaged curve) opened on "max", and mean readings showed "max" in their menu
  (they still computed the mean). Found by the architecture review.
- **v14.3.0 (2026-11-13, minor): a lineout's colours per position, like a list variable's; halo.** (human: "a blue will be
  hard to see on blue background ... see and change list colors for a single tool"; "make it more like the variables choice
  of color I like the halo option"; the colour could not be changed: "list colours" ignored the card's colour silently)
  - The lineout card shows one chip per position (its value, × to remove it); click a chip: its colour, picked in the card.
    The colour is used by its line on the map and its curve in the lineout plot. A tool that follows a variable uses (and
    sets) the variable's colours; → variable takes the colours along.
  - "halo": a thin contrasting edge under each lineout line on the map (white under dark lines, black under light ones).
  - "list colours" off: one colour for all (the card's colour picker appears only then).
- **v14.2.2 (2026-11-13, patch): one lineout tool per axis; its lines drawn as line tools; the 🛠 list can hide / remove.**
  (human: "when I add multiple lineouts of same type ... it should collapse down to one tool use as a list"; "the cut ...
  should act like a horizontal or vertical tool for drawing"; the 🛠 dropdown should have "more ... than just the list
  (maybe the x to delete")
  - Dropping a lineout on a map that has one along the same axis adds a position to it (no second tool or plot). Old
    desktops: duplicates merge on load (positions in order); their extra plots read the one kept.
  - A lineout's lines on the map use its card's style, width, colour, "list colours" (each its curve's colour; default)
    and label ({v} = the position), like a horizontal / vertical line tool.
  - Each row of a plot's 🛠 list has a "shown" box and × (remove; a shared tool from every linked plot).
- **v14.2.1 (2026-11-13, patch): a lineout (and a period tool's new plot) docks beside its source, and can be dragged.**
  (human: "why can I not drag this lineout plot around? I want it to the side not below by default but allow me to
  change it"; "the docking should work cross type ... just DONT link things that [don't] make sense") Dock tabs were offered
  only on plots of the same type; now any plot docks to any plot (a map and a 1D plot share one figure). A joined plot
  links nothing but pan & zoom, and that only with plots of the same axes (a map's and a 1D plot's never match).
- **v14.2.0 (2026-11-13, minor): lineouts of a map** (Tools → curves → lineout, on any map; human: "a tool to make a
  linked plot that shows cuts of the 2D", "make it lineout", "multiple cuts comparing ... shift click to add new one",
  "allow the tool to cast to variable", "make the new plot linked in the same panel").
  - Dropping it on a map makes a 1D plot docked under the map in its figure (sharing pan & zoom where the axes match):
    the map's quantity along one axis, one curve per position on the other (the cut), in the colour of its dashed line on
    the map (a ray or an arc on a meridional map). Click the map: the last lineout moves there; shift-click on the map:
    one more (shift-click elsewhere on the plot still selects it). The card: direction, positions (typed), → variable (a
    number variable the positions then follow).
  - Ordinary maps: the 1D line of the same quantity with the cut as a pick (a fixed time when the cut is time). Along-line
    maps: along the line at a time or on a line (the 1D along-line line, with the map's smoothing and slope), and along
    time (C: on a line r_max at the map's position; A: at a position of the map's line) read as the map reads each output
    — the foot→equator voltage over time is a lineout of the t × r_max map of along.phi at s/s_max = 0.5. Not yet: along
    r_max of an along-line map.
  - The period tool's new plots are docked under their source plot too.
- **v14.1.0 (2026-11-13, minor): the period tool** (Tools → curves → period; approved via the research session; human: "I
  would want to choose WHAT gets sent", "tools have option of make new plot (and can choose which plot) ... default linked
  to same panel", "lets do any plots").
  - The method is `claude_work/lib/cycles.py` ported to `viewer/js/cycles.js`: inside the window, detrend (linear default;
    mean, quadratic, running mean W), normalised autocorrelation, period = first peak after the first zero crossing
    (parabola-refined), regularity = the autocorrelation there (< 0.2: no clear cycle), n_cycles = window / period; curves on
    one time grid also get their lag against the most regular one and "in phase". Checked against cycles.py on ec025's
    foot→equator voltage (6 lines, every detrend, lags, sliding): differences ≤ 2e-14 (`claude_work/scratch/cycle-port/`).
  - On any 1D plot, along its x. The card: which line, the window (typed, or "use the zoom"), detrend, each curve's period /
    regularity / cycles / lag; the window is shaded and the numbers go in the plot's text box.
  - → table (tick period, regularity, cycles, lag), → variable (a reading: cycle period / regularity / number of cycles,
    with its own copy of the window and detrend; readings gained these three ops), new plot… : autocorrelation (the chosen
    peak marked), period or regularity in sliding windows (width / step on the card, the window shaded), and, when the curves
    differ by a pick (r_max …), period / regularity / lag / cycles per curve. New plots go next to the source and follow
    the tool. The foot→equator voltage is `along.phi` at s/s_max = 0.5 (the equator is at 0.502 of the line, eqvolt.py).
- **v14.0.1 (2026-11-13, patch): a fit (or mean) on a table plot takes all of a table line's points together.** It
  showed nothing: the points are one curve per dataset (their colours), so with one point per run each fit had one
  point (human: "I dont see the fit ... they are of different datsets though").
- **v14.0.0 (2026-11-13, major): tables of points.** (human: points "that I define from given datasets and given
  datatypes"; "a new tab"; "each row is the point", with dataset as a column; "the cast to cast a number and then that
  number isnt updated unless I cast again ... long term results"; "tables are like variables so per desktop"; first use:
  decay time from the energy fit, ζ, period per run.)
  - Sidebar → **Tables**. A table's rows are points: dataset, the picks of the curve a number came from (r_max, r_out …),
    and number columns. Cells can be typed or deleted; rows added or removed; copy as CSV; rename / delete.
  - **→ table** on a fit's card (τ, k, A, R² … of each curve) and on a draw tool that reads each curve: a form picks the
    table (or a new one), the columns (by name: an existing name writes into it) and the rows ("fill the rows of the same
    dataset and picks" or "always new rows"). The numbers stay until cast again. A column's header says where its numbers
    came from and when.
  - **+ column → config: <key>** reads each row's dataset's config number (no variable needed); its "re-cast" reads again.
  - **plot…**: a 1D plot of the table (x column, y columns, colour by dataset or a column): one marker per row, hover a
    point for its row; ⚙ → x picks another column; + line adds another column; a table line's editor: size, joined, colour.
  - Tables are saved with the desktop (also undo, desktops, new desktop). Not in this version: the period reading
    (wiki/todo.md), tables shared across desktops, computed columns.
- **v13.1.1 (2026-11-12, patch): a tool along time copies onto a spacetime map with time on x.** It was refused with
  "its position is along time, and this plot's x is time" (human): a map's x axis was compared to a 1D plot's in a
  different form.
- **v13.1.0 (2026-11-12, minor): drag a tool from a plot's 🛠 list onto another plot to copy it there.** (human: "dragging
  a set tool from one plot to another (for instance I set a vertical band to red out t <40 ...) ... when I click the hammer
  icon and see dropdown list of tools i can drag over")
  - The copy keeps every setting (look, range, label); "one line" becomes every line if the other plot has no such line;
    a steps tool gets a new name. To move a tool, remove it from the first plot afterwards.
  - While dragging, plots that cannot take it say why: the same checks as adding a tool, plus a position typed along x
    (a vertical line, a band across x, a point) only onto a plot with the same x axis ("its position is along time, and
    this plot's x is r sinθ"), a slider-time line only onto a plot with time, a "from each curve" draw only onto 1D plots.
- **v13.0.0 (2026-11-12, major): set variables and measured variables; readings are per dataset.** (human: a variable
  either is something "I set myself for what I look at" or a "direct measurement"; "set variables vs measured
  variables"; "config can be a measured value"; "I like the symbol to show moves with slider")
  - The Variables tab has two groups: **set variables** (datasets, numbers) and **measured variables** (configs, fits,
    readings). ▦ on a measured variable lists its value per dataset.
  - A reading (the old "measured" variable) keeps a recipe of its line (quantity, picks, averaging, smoothing, slope, axis
    functions), like a fit, and is read on every dataset that has that quantity: a plot or curve of a dataset its own
    line does not show uses that dataset's value (NaN if it has none). On datasets its line shows, values are as before.
  - ⏱ marks a reading that moves with the slider: its line's x is not time (and the line is not at a fixed time or
    time-averaged), or it reads "now" on a time axis. It is worked out, never chosen.
  - Readings are computed on the datasets on screen; ▦ computes the others (a reading on a line cut from a map would
    otherwise download it for every dataset). ⏱ readings are recomputed each frame.
  - The sidebar shows a crossing reading's level and a from–to range for max / min / x at max / x at min / crossing.
- **v12.2.0 (2026-11-12, minor): draw tools → variable; pinned values are gone.** (human: "make more tools like the fits
  -> variable"; "lets just get rid of pinned values and steps tool can keep its own things")
  - A line or point read off each curve (mean, max, min, x at max / min, a crossing) shows its values in its card and has
    "→ variable": a measured variable of the same reading (line, statistic, from–to range, level), in the Variables tab
    like a fit's numbers. A line that follows a dataset list gives one value per dataset, each used by its own curve.
  - Measured variables gained "x where it crosses" (a level) and a from–to range for max / min / x at max / x at min.
  - The Tools tab's "pinned values" section and the 📌 pin are gone. A pinned draw in an old desktop becomes a measured
    variable of the same name on load; "$name.value" / ".x" / ".y" become "$name". A pin over every line of a plot becomes
    a variable of the plot's first line (a measured variable reads one line).
  - A steps tool keeps its name, its "$steps1.from …" values and "steps from another plot"; what it found (table, copy
    CSV, → foot gaps vs t) is in its own card.
- **v12.1.1 (2026-11-12, patch): the Tools tab's "on the plots" list is last and collapsed** (remembered if opened; human:
  "isnt necessary maybe ... a default collapsed section ... each plot already says what it is"). Pinned values come right
  after the tool buttons.
- **v12.1.0 (2026-11-12, minor): the Tools tab in folders, every tool its own button.** (human: "folders with every tool
  visible"; "there is a draw folder"; field lines are "its own tool"; "horizontal and vertical as separate things";
  "swap what tool something is from the tools own thing (if they are compatible tools like horizontal vertical)")
  - draw: horizontal line · vertical line · band · point · field lines. curves: fit · averaged curve. more (collapsed,
    remembered): steps · steps from another plot. ⚙ → Tools lists the same folders; what the plot cannot take is greyed,
    the reason on hover.
  - A line, band or point swaps to another of them in its card ("tool ▾"); field lines are their own tool and do not swap.
  - The slider-time line is a vertical line "at the slider's time" (the old kind stays in the swap list on a time axis).
  - Field lines refuse 1D plots, spacetime and along-line maps, and datasets without Ψ, saying which.
- **v12.0.1 (2026-11-12, patch): tools say why they cannot go on a plot; remove from the card; names never clash.**
  - Dragging or arming a tool marks each plot that refuses it with the reason ("it works on the curves of a 1D plot,
    and this is a map"; "no data curves yet"; "no steps tool on any plot yet"); dropping or clicking there says it.
    (human: "if applied to wrong thing it says cant do that for this reason")
  - The tool card (from 🛠, the Tools tab or ⚙ → Tools) has "shown" and "remove" (a shared tool: from every linked plot).
    (human: "tapped the hammer symbol and cant see a remove")
  - Field lines are offered only on maps whose axes are the quantity's two space axes (r–θ, plain or meridional; x–y),
    not on spacetime or along-line maps; an existing one there says it draws nothing. (human: "not even spacetime")
  - Variables and pinned tools never share a name: new and renamed variables skip tool names, and the reverse.
    (human: "the tool name vs variables so its not confusing")
- **v12.0.0 (2026-11-12, major): tools you drag onto plots; one "draw" tool; values you can pin.** (human: tools were
  "locked in a dropdown inside a dropdown in the bottom of a settings … what if we have like a tool drag that I drag to a
  plot and that turns on the tool"; "lets have it be both"; "why not just call it draw?"; "some of these draws we may as
  well be able to output to a variable like mean"; "I dont want tools to become super expensive")
  - **Tools tab** (sidebar, was Outputs). It holds three things:
    - the tools to add: draw, fit, averaged curve, steps, steps from another plot. Hovering says what each does and where
      it fits. Drag one onto a plot, or click it and then click a plot (Esc cancels). Plots that can take it are outlined
      and the others dimmed;
    - the tools on each plot (click one: its card);
    - the pinned values.
  - **🛠 n** in a plot's header: its tools (click: open one). ⚙ → Tools keeps the full list and its "+ tool…" menu
    (now: draw · fit · averaged curve · steps · steps from another plot).
  - **draw**: one tool whose card starts with what it draws. Its kinds:
    - horizontal or vertical line, at a value, a list typed in (0.5, 1, 2: one line each) or a variable;
    - a line at the slider's time + offset (was the now line);
    - on 1D plots, a line **from each curve**: its mean, max or min (horizontal), or x of its max, x of its min, or
      where it crosses a value (vertical), over an x range;
    - a band between two values;
    - a point, at x, y, or at each curve's max or min;
    - field lines (maps).

    Switching kind keeps the look and label. A new draw starts as field lines on a meridional map that has Ψ and none
    yet, else as a horizontal line.
  - **Values and pins**: a draw that reads off the curves shows its values in its card. 📌 pin names it (mean1, xmax1 …).
    Its values then become `$mean1.value` (one per curve), `.x`, `.y`, which number fields and typed lists now accept.
    Before, `$steps1.from` was refused when typed. Only pinned tools publish; nothing goes into the variables on its
    own; a tool only offers values it computes to draw.
  - **Converted on load**: "mean of each curve" is now "horizontal line at each curve's mean" (range, colours, label kept).
    Now lines, lines and contours are draw kinds as they were. "Mean along another axis" is the "averaged curve" tool.
- **v11.9.0 (2026-11-12, minor): tag a dataset from its plot.** (human: "can i add tag from visualizer? basiclly rn I
  will see if there is cycle then add to has cycle") A plot's ⋯ → "🏷 tag its dataset…": the plot's dataset(s) (a 1D
  plot's lines, lists resolved; tick which), the existing tags as ticks, and a new one. Saving writes the data manager
  card (notes kept), then the menus show the tag and lists following a tag take the dataset in at once. With serve.py
  and its datamgr only (the data manager page's token).
- **v11.8.0 (2026-11-12, minor): tags, a second grouping of datasets by what they show.** (human: "a secondary folder
  setup that doesn't really affect much else but that I can link datasets that have similar phenomena"; "lets do that")
  - Tags are the dataset cards' tags: any number per dataset, across the groups.
  - Data manager page: a "tags" block under the groups in the datasets list. Each tag is folded; click ▸ for its
    datasets, or its name for a grid of just them. Ticked datasets get "tag…" to add or remove a tag for all of them
    (their notes are kept).
  - Visualizer: a dataset list's entry can be a tag, "#cycles", which stands for every dataset with that tag, now
    and later. Tag a run on the data manager page, reload, and every line following the list draws it too.
    "+ line" dataset menus offer "a tag as a list" (one variable per tag, reused). A list's "+ dataset…" menu offers
    tags, and the chip reads "#cycles (3)".
  - Archived datasets are left out of a tag.
  - Also: "not in a folder" is the last section of the quantity menus (human: "not in a folder is bottom").
- **v11.7.0 (2026-11-12, minor): the quantity menus are sectioned by folder.** (human: "I want the scrolldowns
  organized into folders not the old MAP along stuff")
  - Every quantity menu (a map's header and ⚙, "+ line", both new-panel forms, an analytic line's datatypes) lists
    Drive & twist, Gaps & voltage, … (the data manager's folders), then "not in a folder". A quantity in two folders
    is in both.
  - Each entry says what it is over after its name ("E∥ — θ·r", "voltage (∫E∥ dl) — r_max"), and a folder lists
    by that. Expressions and analytic functions keep their own sections.
  - The folders come with the store (data/groups.json "folders", written by the datamgr whenever a folder changes),
    so the menus need no data manager to be running. Without folders, the old sections are used.
  - The axes rules, the ◌ (not cached) marks and the hidden map-against-time entries apply as before.
- **v11.6.2 (2026-11-12, patch): a dataset's page is sorted like the grid.** (human: "you didnt change the grid form for
  looking at individual dataset") Folder sections (then "not in a folder", "also in"), the axes badge in the axes
  column, rows sorted by it, and the folder / axes chips above the table (they stay on the dataset's page).
- **v11.6.1 (2026-11-12, patch): no map quantities in the lines-against-time menus.** (human: "I never care about a
  singular grid point"; "hide them") A map (θ × r) drawn against time is one grid cell's value over time: "+ line",
  the new 1D panel form and the y-axis menus no longer offer maps (or raw fields) when x is time. Cuts along r or θ
  still list them; lines made before still draw.
- **v11.6.0 (2026-11-12, minor): the data manager grid is sorted by folder; each row shows its axes.** (human: "for the
  datatab I want the sections to not show TYPE anymore but show the groups"; on type: "its the axes that allow stuff")
  - The grid's sections are the folders, then "not in a folder". A quantity in two folders is listed in both, marked
    "also in: …".
  - Each row has a badge of what it is stored over: θ·r, r_max, r_max·s, θ_foot, r_out, time only, z (no time). That
    is what it can be drawn against. Rows are sorted by it, and "axes:" chips beside the folder chips filter by it.
  - Rows can be dropped on a folder heading (added to that folder) or on "not in a folder" (taken out of every
    folder), or dropped on the last row (a new folder). A row's ⋯ and the ticked rows' bar tick and untick folders.
  - The old type groups (maps, Data OF field line, …) still order the visualizer's quantity menus ("menu section" in a
    row's ⋯).
  - Rows stored only in archived datasets (e.g. the old s/s_max set of no-pair-1_carlqvist-rescaled) leave the grid.
- **v11.5.0 (2026-11-12, minor): folders as views on the data manager page.** (human: "make folders a view for the grid and
  the methods tab so everything is much cleaner") A "folder:" bar above the grid and the Methods tab: "all" or one
  folder (the cache presets: Drive & twist, Gaps & voltage, Duty cycle, Pairs & photons, Energy, Charge maps), which then
  shows only its quantities (a folder naming a family shows its members; group headings with none are left out). The
  choice is kept in this browser and shared by both tabs. Nothing about the groups or the store changes.
- **v11.4.2 (2026-11-12, patch): column headings on a dataset's page.** (human: "there is also no headers for the other
  columns") quantity · outputs (stored / the run's) · axes · size.
- **v11.4.1 (2026-11-12, patch): a dataset's page lists its quantities compactly.** (human: "when looking at datasets I see
  massive white space from name to number of outputs") The table stretched to the page's width and the slack went to
  the name column, pushing the outputs, axes and size to the right (the axes were cut off). It is now as wide as its
  content; axes and size do not wrap.
- **v11.4.0 (2026-11-12, minor): compute what is not cached, from the plot; several datasets at once on the data
  manager page.** (human: "when it comes to picking data in the visualizer it might be nice to see things that CAN be
  cached but arent and have visualizer request the cache"; "simplest would be a color difference when picking or a
  small symbol"; "on the all datasets list pick multiple to do things like arxiv or delete"; "can it also show how many
  desktops that dataset is used in")
  - Quantity menus (2D maps, "+ line", the new-panel forms) also list what the dataset could compute but has not
    cached: grey, marked ◌. Dataset menus mark a dataset that lacks the plot's quantity but can compute it, and list
    datasets added on the data manager page with nothing cached yet (◌).
  - Not offered: a dataset with no run behind it (the b06 models, derived data), an archived one, or a run whose dumps
    lack a field the method reads. Each method now names its fields (`needs=` in its decorator, not part of its version;
    e.g. line_pairs needs pair_produced, which pairs-10's dumps do not have).
  - A plot with a ◌ quantity says "◌ E∥ is not cached for pairs-10 · compute (201 outputs · 100 MB)". Clicking
    compute starts the data manager's cache job (the page's token, asked once). The status then shows "⏳ … 120/201
    outputs · about 2 min left · stop", and the dataset is read again every ~10 outputs, so the plot fills in as the
    outputs arrive.
  - Picking a dataset with nothing cached offers to compute the plot's quantity. The plot switches to it when its first
    outputs are stored.
  - "+ 1D panel": lines whose dataset can compute the quantity are made too ("compute the N ◌ lines not cached yet",
    one job per dataset).
  - Only with serve.py and its datamgr (cacheable.js; api/dm/status now gives each method's `needs` and each run's
    dump fields, remembered in datamgr_jobs/dump_fields.json).
  - Data manager page: tick datasets in the list, then archive / un-archive / group… / remove… them together (removing
    deletes their stored data and asks first, naming any desktop that still uses them). Each dataset shows how many
    saved desktops use it (hover: which ones; also whether the desktop open in this browser does).
- **v11.3.0 (2026-11-12, minor): cache folders, and a faster cacher.** (human, via the Intermittent_discharge session:
  "caching seems to take forever … placing the cachable quantities into classifiable folders, a folder containing things
  related to driving, another related to gaps another to duty cycles etc. then I can select which folder to cache from
  (if folders overlap it only caches ones of course)") On the data manager page, "cache more…" shows the **folders**
  (the cache presets) as buttons that switch on and off: the ticks are the union of the folders that are on, each
  quantity once; a dump field in a folder (Rho_e, pair_produced, …) is listed after the count and copied with them.
  Folders (human-approved): Drive & twist, Gaps & voltage, Duty cycle, Pairs & photons, Energy, Charge maps;
  `python -m datamgr cache --preset …` does the same from a terminal. The cacher itself (claude_work/datamgr, no viewer
  change) reads every output once and computes on worker processes, at most half of the storage server's free cores:
  rcs-pairs-1-ec025, 37 quantities, 401 outputs, 1708 s before → 661 s with 2 workers on a busy server, every stored
  byte the same (claude_work/tasks/2026-11-12_cache-speed; datamgr README § Speed).
- **v11.2.2 (2026-11-11, patch): a 2D map keeps its quantity across datasets.** (human: "when I made the sapcetime plot
  … I then tried to change to different dataset and it defaulted to meridional now I cant change back") In the
  "+ 2D panel" dialog, a dataset without the chosen quantity used to replace it with B_φ/B (a meridional map) for good:
  choosing the first dataset again kept B_φ/B. Now the dialog remembers the chosen quantity and its axes, says
  "<dataset> has no …: showing B_φ/B meanwhile", and brings it back when a dataset that has it is chosen. The dialog's
  axes menus for an along-line map offer s, s/s_max, s from the south foot, t and r_max (before: the raw dims, which
  showed "time, time"), and the map starts on the line r_max = 3 as from ⚙. In a panel's header and its ⚙ box (where a
  dataset change never changed the quantity), a quantity the dataset lacks now shows as itself in the menu, marked
  "(… has none)", instead of the dataset's first quantity, which the plot was not drawing.
- **v11.2.1 (2026-11-11, patch): fit variables per curve in a dataset list.** (human: "is there a way I can make such
  things work with the list methods? … with one fit tool I get the value and it is set to my datalist where I plot the
  datas") A fit variable in an axis function f(x) / f(y), and in a line's per-curve number settings (scale "÷ number /
  variable" and "÷ its value at x =", smoothing, slope, steps), is now the value of each curve's own dataset: with the
  fit on one plot of the list and f(y) = y/(A*exp(-x/tau)) on another, every dataset's curve is divided by its own fit
  (before: every curve by the plot's first dataset's). In f(x) / f(y), a curve whose dataset has no value for that
  fit is not drawn and the plot says so.
  Number boxes elsewhere and {name} in texts still take the plot's dataset. The "default" menu of a fit variable made
  on a list line read "(missing)"; it now reads "(its first: <dataset>)", the dataset it stands for there.
- **v11.2 (2026-11-11, minor): a variable in a dataset list.** (human: "it will be common for me to have say a main
  dataset for looking at just one at a time … but other things like energy I may plot multiple. I think it would be nice
  to be able to add a variable to the list (if there are duplicates in the list then it still works to add but it is
  treated as the list with no duplicates)") A dataset list's "+ dataset…" menu (its chips in the sidebar, a list line's
  editor, a dataset chip) now lists the one-dataset variables first ("variables (follow it)"): the entry follows that
  variable, so changing `main` in the sidebar also changes that curve of every plot that follows the list. Its chip
  reads "main · rcs-pairs-chen-1" (italic). A dataset that comes twice (a variable set to a dataset already listed, or
  two variables on the same one) is drawn once, by the first entry, in that entry's colour; the later chip is greyed
  until the variable moves elsewhere. A variable that is itself a list adds its datasets (in its own colours); one that
  leads back to the list is skipped. Renaming a variable renames it inside lists; deleting it leaves its dataset there.
  The list's ×N, menus, tooltips ("… (via main)"), {name} in text and the legend's "remove" / colour act on what is
  drawn. "+ dataset" on a plot keeps the list's variable entries. A saved panel setup carries the variables inside its
  lists. (model.js listEntries / listRefs; vars.js runListChips.)
- **v11.1.1 (2026-11-10, patch): less white space around the axes.** (human, with visualizer_plots/test1.png, the linked
  slices: "this is way more whitespace than necessary so yeah fix it") A plot's left margin is now what its y numbers
  and title need (measured for the range it shows: render.js yAxisRoom), not a fixed allowance for about three and a
  half characters of numbers (67 px at the default sizes; now ≈ 50 px for numbers like "200", more for long ones like
  "−0.0818"). Plots drawn together (a figure) take the widest, so their axes still line up; a plot sharing its
  neighbour's y axis keeps its narrow edge. An along map with a position on y and no zoom keeps the old allowance (its
  range comes from its data). Top colour bars sit 6 px lower (less blank between their numbers and the plot).
  Checked (local test viewer): linked slices (A, B at 50 px, C sharing B's y axis at 8), the regular-map test desktop
  (meridional, log x, time maps: 50 px) and 1D plots (57 px with that desktop's larger font): every y title and its
  numbers fully drawn; the y titles now start ≈ 2–3 px from the panel's edge. Maps whose colour limits follow the visible
  area can change slightly (the plots are a little wider).
- **v11.1 (2026-11-10, minor): {dataset} and {t} in titles; reopened desktops keep their figures.** (human: "I want to
  have the {dataset} option that just fills that in"; "is there an option to have a variable up top? say one of them
  needs to show rmax in the title another t and a third s")
  - Any title, axis label, colour-bar label, tool label or legend label takes **{dataset}** (the plot's dataset; a 1D
    plot: the datasets its lines draw; a legend label: its own curve's) and **{t}** (the plot's time: a map fixed at a
    time shows that time, else the slider's), next to every variable as before: **{rmax}**, **{spos}** … A variable named
    dataset or t wins. Linked slices, for example: A "{dataset} · r_max = {rmax}", B "t = {t}", C "s = {spos} R*"
    (click the title to type it). {rmax} is the variable's value (what was clicked); the line drawn is the nearest
    stored one — the automatic title names that one.
  - The automatic title of an r_max × time map now gives the position's value ("at s = 19.6 R*"), not the variable's name.
  - **Fix (since v8.1):** opening a saved desktop gave every panel, line and tool a new id, so whatever points to them
    was lost on every reopen: a figure's rows (a two-row figure came back as one row — found with linked slices), and by
    the code also measured and fit variables, a steps tool's line and foot-gap lines. Desktops now open with their
    saved ids (the id counter moves past them).
  Checked (local test viewer): subVars fills {dataset}, leaves unknown names; on linked slices B's title "t = {t}" →
  "t = 78", C's "s = {spos} R*" → "s = 19.6 R*", A's "{dataset} · r_max = {rmax}" → "rcs-pairs-chen-1 · r_max = 3";
  a two-row linked-slices figure saved, another desktop opened, then this one again: rows and ids unchanged.
- **v11.0 (2026-11-10, major): click to set, and linked slices of r_max × s × t.** (human: "click to set would be like a
  choice for measuring where cursor click sets some things right? it would default off"; "how would these linked work? is
  it like a special panel"; "just do it all as v11 then tell me how to test it")
  - **Click sets** (any plot, ⚙ → More → Tools, first row; off by default): x → and y → the time slider (on a time axis:
    the nearest output) or a number variable ("＋ new variable" makes one). A click on the plot (not a drag; not on the
    legend, axes, title or colour bar) sets them; dragging still pans, a double-click still resets the view. Choosing a
    variable also adds the plot's crosshair: a line tool at it (the time slider: the "now" line).
  - **Along-line maps, two more kinds** (2D panel, an `along.*` quantity; axes now also offer r_max): **r_max × position**
    = every line at one output (time: the usual "t" row, slider or fixed; from that output's frames; each line ends at
    its own length) and **r_max × time** = every line at every output read at one position (new "at" row: s from the
    north foot / s/s_max / s from the south foot = a number or a variable). The same smoothing and slope as 1D, per
    curve; r_max may be log. The r_max × time map reads every line's points near the position through serve.py's new
    **api/window** (≈ 1 MB for 201 outputs without slope / smoothing; with them, every point within ± (h + w/2) of the
    position is sent — near a foot ≈ 10–15 MB; whole frames would be ≈ 260 MB).
  - **Linked slices** (a 2D along map's ⋯ → "▦ linked slices (r_max × s × t)"): three maps as one figure — A: s × t on
    the line `$rmax`; B: s × r_max at the slider's time; C: t × r_max at s = `$spos` from the north foot. `$rmax` and
    `$spos` are made if missing (3 and 0.3). Click sets: A → `$spos`, t; B → `$spos`, `$rmax`; C → t, `$rmax`; each
    has crosshairs at them. Dataset, quantity, slope, smoothing and colour are shared (one colour range); axes, slices,
    tools and zoom are each map's own.
  - **serve.py must be restarted again** (api/window). Without it, r_max × time maps read every output's whole frames.
  Checked (local test viewer, test server restarted with the new serve.py): the five regular 2D maps still pixel-
  identical to v10.1.1; r_max × position (rcs-pairs-chen-1 E∥, −d/ds over 0.5 after median ± 0.25, t = 80) = the 1D
  curve at all 10 pixels compared on r_max 3.01 and 8.07; r_max × time at s = 0.3 = the 1D curve at s = 0.3 at
  (t = 80, r_max 3.01) (−93.65231); linked slices: the figure, variables, click settings and crosshairs as above, one
  shared colour range; clicks in B set `$rmax` 5.02 (A moved to the r_max 5.1 line) and `$spos`, a click in C moved t to
  78 and `$rmax` to 8.05; "click sets" on another 2D map and on a 1D plot made a new variable and set it (aimed 3.0 →
  2.97, 2.0 → 1.998: one pixel); the maps came through api/rows and api/window.
- **v10.2 (2026-11-10, minor): along-line maps — one field line at every output, position × time.** (human, via the
  intermittent-discharge session: "can we have that option of spacetime where there may be some choice"; "it would fit
  best in the normal 2D"; "I want the first draw to not take forever")
  - **Use:** a 2D panel's quantity menu now lists the along-line data (section "along one field line ▸ along the line
    (true s)": E∥, Φ, j∥/B, I_enc, |B|, s). Axes (⚙ → Axes): time and one position — s from the north foot, s/s_max or s
    from the south foot; picking one moves the other, ⇄ swaps them. The line: the **r_max** row (slider or a variable);
    a new map starts on r_max 3. The **line** row: slope (d/ds or −d/ds over w) and smoothing (mean / median over ± h),
    in the position's units, as on a 1D plot (smoothing first). Colour settings as on any map; the "now" line shows the
    slider's time.
  - **Each row is that output's 1D curve:** the line's own points and s, then the same smoothing and slope code as 1D.
    A pixel shows the mean of the line's points inside it, else the curve at its centre; a row ends where that output's
    line ends; outputs where the line is not closed are blank.
  - **Speed:** serve.py has a new **api/rows**: row r (one field line) of every output's file in one response, read by
    seeking to the row (≈ 2.5 MB for 201 outputs instead of ≈ 260 MB of whole frames). **serve.py must be restarted once**
    to offer it; until then the map still works but reads every output's whole frame (slow the first time).
  - Regular 2D maps run the same code as before: the along path is taken only for data at a line's points.
  Checked (local test viewer, restarted test server with the new serve.py): five regular maps (meridional with Ψ
  contours, r–θ log x symlog, two time maps, a mirrored zoom with "hide <") are pixel-identical to v10.1.1 (same canvas
  hashes); along maps of rcs-pairs-chen-1 (Φ on s × t r_max 3; E∥ on t × s/s_max r_max 5 smoothed ± 0.01; −dΦ/ds on
  s from the south foot r_max 8) equal the 1D curve at t = 80, averaged over each pixel, at all 17 pixels compared
  (beyond the line's end: blank); the data came in two api/rows requests per map; axis choices, swap, slope, smoothing
  and switching to a regular map and back behave as above.
- **v10.1.1 (2026-11-10, patch): smoothing is a window along x; averaging over outputs is in the time row.** (human:
  "can we not just make it be average over x axis call it good?" … "a window defined in the UNITS of the x axis";
  "I am plotting things along rmax and then averaging over outputs, that is still something I need access to")
  - **smooth** (⚙ → Lines → all lines, or a line's own): mean or median over **x ± h**, h in the x axis's units — R\* on
    an s axis, R\*/c on a t axis (a variable works; $L is each line's own). The "over time" and "± outputs" choices of
    v10.1 are gone from it. On a t plot (foot gaps vs t, time series) this is the smoothing along t.
  - **A profile's average over outputs** (vs r_max, s, …) is in the line's **time** row: "follows the slider / fixed at"
    · **mean over t ± h** (R\*/c) = the plain mean of the outputs within it. Every run checked writes an output every
    1 R\*/c (rcs-pairs-chen-1, no-pair-2, profile-centered, pairs-6, replicate_2017_7), so ± N is the same 2N + 1 outputs
    "average ±N" took. 2D maps' "avg ±N" (⚙ → Axes, t) is the same: mean over t ± h in R\*/c.
  - Desktops, when opened: a profile plot's or line's "average ±N" → each line's time row ± N (a variable stays a
    variable: Analytics' `$avg_frame`); on a t plot → smooth ± N; v10.1's settings → the same (a window w → ± w/2).
  - On a t plot the mean over t ± N is the integral over the window ÷ its length, so its two end outputs count half
    (the old ± N counted them fully): e.g. baseline-19 twist angle, ± 2 at t = 100: −0.103825 (was −0.103699).
  Checked (local test viewer): along s ± 0.25 = the exact window integral (as v10.1's w 0.5); a profile's mean over
  t ± 2 = the old "average ±2" exactly (line's or plot's); a test desktop opened as the table in wiki/log.md says; the
  plot and line editors show "over x ± h" and "mean over t ± h R\*/c".
- **v10.1 (2026-11-10, minor): smoothing along any axis, replacing "average ±N".** (human: "is there lets say a general
  thing I could smooth over axis?" … "yeah do the replace") One **smooth** setting, for every line of a plot (⚙ →
  Lines → all lines) or a line's own (its legend editor: "as the plot" / none / mean / median):
  - **along x**: over a window w in x as drawn (R\* on an s axis; a variable works, and a line length $L is each line's
    own). **over time**: a profile is taken over the outputs around the time shown; on a plot whose x is time the two
    are the same. The window over time: **± N outputs** (what "average ±N" was) or a **window in t** (full width Δt).
  - **mean** = the integral of the curve (straight between its points) over the window ÷ the window's length, so points
    spread unevenly (a traced line is dense near the star) do not weigh more; over outputs in t: trapezoid weights in t;
    ± N outputs: the plain mean, as before. **median** = of the points in the window, each weighted by the stretch of x
    it stands for: a lone spike is outvoted and a jump stays sharp. Windows are shorter at the ends; empty points stay
    empty (a foot-gap output with no gap is not filled in).
  - It comes before any slope or d/dt (a slope line is the slope of the smoothed curve), after the line's scale.
    Measured and fit variables and the mean tool read the curve smoothed as drawn.
  - **Foot gaps**: a foot-gap line (width / voltage vs t) has its own smooth row (over t). The steps tool's line, if
    smoothed along x, finds its steps on the smoothed curve at every output; a gap's voltage is still the drop of the
    unsmoothed quantity across the step.
  - Desktops: "average ±N" of a line plot or line becomes "± N outputs, mean" when opened (the same curve); 0 → none.
    2D maps keep their own "avg ±N" (⚙ → Axes, t).
  Checked (local test viewer): mean along s (rcs-pairs-chen-1 along.phi, r_max 3, t = 80, w 0.5) = the exact window
  integral ÷ its length at all 609 points (largest difference 1.8e-13); "± 2 outputs, mean" = the old "average ±2" at
  every point, for a profile and a time series (baseline-19 twist angle); the median and the Δt window (outputs
  79–81 with weights ¼ ½ ¼) = by hand; a foot-gap width series ±1 mean / median = by hand; a synthetic spike (100 among
  1–7) is removed by the median (6) and not by the mean (52.5); an old desktop's avg 3 / line avg 1 / avg 0 opened as
  ±3 / ±1 outputs mean / none, its 2D maps' avg kept.
- **v10.0.1 (2026-11-10, patch): the old profiles are gone from the store.** (human: "yeah all that removed for these")
  Deleted from the visualizer store: `epar_along`, `phi_along`, `I_along`, `B_along`, `jpar_over_B_along` and
  `line_smax` of every dataset that has `along` (≈ 1.1 GB); kept: the Carlqvist model dataset (only on the old grid) and
  pairs-3's `jpar_over_B_along` (no `along` there). The data manager's methods for them and their helper
  `along_profiles` moved to `claude_work/archive/2026-11-10_datamgr-old-along/`; the old recorder's recipes for them are
  gone (`recorder/quantities.py`, `record.yml`). The same ideas: `along.epar`, `along.phi`, `along.I_enc`, `along.Bmag`,
  `along.jpar_over_B`; `line_smax` = `along.s` at a line's last point. Fix: inserting an old panel setup (templates…
  → old panel setups → insert / make template) now moves its lines to the `along` data too, as opening a desktop does.
  Checked (local test viewer): an old setup with `phi_along` on s/s_max (rcs-pairs-chen-1) was inserted as `along.phi`
  on s/s_max and draws.
- **v10.0 (2026-11-10, major): one way to measure distance along a field line — true s.** (human: "yeah can you make
  it so all the old clunky stuff is gone") Distance along a line now comes only from the `along` data (each line's
  own points, s stored exactly, v8.28). Removed: the "R\* ▾" menu beside f(x) (`x * L`, `(1 − x) * L`); the field-line
  length measured from Ψ (v8.27) and the per-output Ψ length of foot gaps (v9.1). A length variable is now the line's
  stored length (its last s); on a line without `along` data it says "a line length needs along-line data at the
  line's points (true s)". On opening (and on every desktop opened), a 1D plot that draws the old 200-point profiles
  (`epar_along`, `phi_along`, `I_along`, `B_along`, `jpar_over_B_along`) moves to `along.epar`, `along.phi`,
  `along.I_enc`, `along.Bmag`, `along.jpar_over_B`, if every dataset of those lines has them; a plot that drew them as
  `x * L` / `(1 − x) * L` switches to x = s / s from the south foot (f(x), zoom and a custom x label cleared). A toast
  says how many lines moved. Plots of datasets without `along` (the Carlqvist model datasets) are left as they were.
  Also fixed: a slope or steps window that follows a length variable ($L) now uses each curve's own length (before:
  the first curve's, so r_max 5 and 8 got r_max 3's window). `along` is now cached for every dataset that had the old
  profiles (≈ 0.6 GB per 201 outputs; the old five took ≈ 80 MB); b06-*, rcs-nopair-1, rcs-pairs-1, replicate_2017_5
  and pairs-3 have none (pairs-3 has only the old `jpar_over_B_along`).
  Checked (local test viewer, rcs-pairs-chen-1, a desktop with `phi_along` on `x * L`, r_max 3 / 5 / 8): it moved to
  `along.phi` on x = s with one toast; L = 6.643 / 16.831 / 45.622 (the stored lengths); steps windows per curve
  6.643 / 16.831 / 45.622; foot gaps vs t 10 / 10 outputs computed, no error.
- **v9.1 (2026-11-10, minor): foot gaps on an `x * L` plot.** (human: "undefined in the legend then underneath I have
  this error ⚠ foot gaps: the plot of gaps draws with "x * L", and L is measured at the time shown only") A steps tool
  on a plot that draws s/s_max as `x * L` (the older 200-point profiles, e.g. replicate_2017_8, which has no
  along-line data at the line's points) now works over time: at every output L is that field line's length at that
  output — the stored one for data at the line's points, else measured from Ψ like the length variable (one Ψ frame,
  ≈ 0.5 MB, per output). Other measured variables in the x / y function are still refused (with that message). The
  legend of a foot-gap line that has no curve yet (or failed) names it ("north foot gap width (gaps)"), not "undefined".
  Checked (local test viewer, rcs-pairs-chen-1 phi_along, x * L, −d/dx 0.5, median 3, k 3): 201 outputs computed; at
  t = 80 the north widths 1.56 / 0.7848 / 0.7116 equal the tool's steps; voltages 35.8 / 56.8 / 37.4 (along-line data:
  34.8 / 57.0 / 37.4).
- **v9.0.1 (2026-11-10, patch): foot gaps say why they are empty.** (human, via the intermittent-discharge session: "I
  clicked the foot gaps vs t and the plot is blank with undefined") When the steps tool's line cannot be rebuilt at an
  output (e.g. its data has no s axis — the older 200-point profiles on an s plot), the foot-gap plot now says so: "foot
  gaps: could not rebuild <tool>'s line: …" (or "n of N outputs failed: …"); before, it stayed blank without a word. A
  line without a dataset says so too. Not reproduced: an "undefined" with v9.0 and the live data (rcs-pairs-chen-1,
  x = s, median window = $L); if it still shows, Ctrl+Shift+R and report where the word appears.
- **v9.0 (2026-11-09, major): foot gaps over time — a steps tool's footpoint gaps as lines against t.** (human: "lets
  start with footpoint gaps though this method can FInd other gaps, I want to plot the footpoints as fns of time their
  voltage and width"; "is this needing new cachine? it seems quick to compute these values so maybe not")
  - **One click**: Outputs tab → a steps tool's **→ foot gaps vs t** makes two plots after its plot: **foot-gap width**
    and **foot-gap voltage** against time, the north foot solid and the south foot dashed, one curve per curve of the
    tool's line (each r_max, in its list's colours). Or, on any time plot: **+ line → foot gap…** (tool, foot or both,
    number); a foot-gap line's legend click edits it.
  - **What is computed** (`viewer/js/gapseries.js`): at every output the tool's own line is rebuilt at that time on the
    tool's plot (its x axis, x function, scale, slope, f(y)) and its steps found with the tool's own settings (median
    window, k) — change the tool and every output is recomputed. The **north-foot gap** is the step touching the start
    of s (the south-foot gap: its end). Numbers: **width** = from the foot to the step's far edge; **10–90 % width** of
    its excess drop; **voltage** = the drop of the line's own quantity across it (the potential, from the foot to the
    far edge, in the slope's sign: −d/dx → a falling potential reads positive); **excess drop**. No step touching that
    foot at an output: no value there (a gap that comes and goes shows as breaks).
  - **Nothing is cached**: computed in the browser, three outputs at a time, nearest the slider first; the plot fills in
    and says "foot gaps: n of N outputs computed…". The cost is loading each output's along-line data once (new
    `along` data: ≈ 1.3 MB per output, so minutes the first time through the port forward; old `phi_along`: one file).
    A plot whose x function uses a measured variable (x * L) is refused (L is measured at the time shown only): use x = s.
  - Checked (local test viewer, rcs-pairs-chen-1, 10 outputs): at t = 80 the north-foot widths equal the tool's steps
    (1.3848 / 0.8087 / 0.8244 R* for r_max 3.01 / 4.93 / 8.07) and the voltages equal Φ(0) − Φ(far edge) read straight
    from the stored potential (34.848 / 56.957 / 37.427).
- **v8.32.1 (2026-11-09, patch): Outputs reachable.** (human: "how do I get to see the output for the steps above median
  fn?") Steps tools made before v8.32 had no name, so no output: they get one (steps1 …) when the layout opens. The
  sidebar's four tabs wrap to two rows in a narrow sidebar (the fourth, Outputs, was cut off).
- **v8.32 (2026-11-09): tool outputs — a tool's results by name, in their own sidebar tab.** (human: "I want its outputs
  as variables or maybe even a nice table thing … I may want to use those values it computes elsewhere (simple first bit
  is basically plotting the same vertical bars on the true potential and not ddx"; "can we make it so a tool can define
  its own "output" as like variables and stuff, lets say those get their own tab … so that it doesn't clutter things")
  - A steps tool has a **name** (steps1, steps2 …; ⚙ → the tool → name). Its output at the time shown, per curve: σ and
    each step's 10–90 % span, whole span and excess.
  - **Sidebar → Outputs**: one table per named tool (per curve: σ, number of steps, each step), **copy CSV**, and the
    field names to type.
  - **Other plots**: + tool → **steps from an output** shades a named tool's steps on this plot — each curve gets the
    steps of its own field line (same dataset and r_max), in its colour: light = whole step, dark = 10–90 %. Typical:
    the steps found on the slope plot drawn on the potential plot. The x axes must match (the plot says so if not).
  - **Number fields**: `$steps1.from`, `.to`, `.start`, `.end`, `.excess`, `.count`, `.sigma` — every curve's values as
    one list (a vertical line tool at `$steps1.from` draws one line per step; one number where one is needed: the
    first). Plots using an output redraw when it changes; renaming the tool renames its uses.
  - Only the steps tool has outputs so far; the others (mean, fit) can join the same way.
- **v8.31 (2026-11-09): no "slope of the drop" — a slope is d/dx or −d/dx.** (human, via the intermittent-discharge
  session: "get rid of slope of the drop then I can determine whether to use + or - ddx why add needless complexity")
  The slope menu has d/dx (the new default) and −d/dx; you choose the sign (−d/dx when the quantity falls along x, e.g. the
  potential from the north foot, so its steps read positive for the steps tool). Lines that had "slope of the drop"
  become −d/dx when their layout or desktop opens (a message says how many); no saved desktop on the server had one.
  (The notes for v8.29–v8.30 below still mention it.)
- **v8.30 (2026-11-09): slope and d/dt lines are lines of their own.** (human: "when I do this slope method I want it to
  be clear that I am showing slope this is basically setting up a different line and should be treated as such"; "yeah
  make it consistent")
  - A line drawn as its slope along x has the y-axis group **"slope of K"**, one drawn as its time derivative **"rate of
    K"** (K = its quantity's group), so they never share a y axis with K. Their y labels: "slope of potential (of the
    drop, w = 0.5) [per R\*]", "rate of current [per R\*/c]"; their names: "slope of the drop of Φ · r_max = 3.01 · over
    0.5", "d/dt current · …" (a family member keeps its family first: "along the line (true s) · slope of the drop of …").
  - **Making one**: a line's editor → **new line: → its slope / → its d/dt** (a copy drawn that way; the original stays),
    or **+ line → slope of… / rate of…**. A line whose y axis differs from the plot's goes into a new plot right after it
    (same x axis, x function, x label and zoom); a slope / rate plot's "+ line" opens on its own kind and lists its
    quantities. A slope / rate line's editor sets the sign and window (d/dx, −d/dx, the drop; or ±n, fit / difference) —
    no "off": the plain quantity is its own line.
  - The y-axis menu lists "slope of …" and "rate of …" groups too. A plot that mixes them with other lines says so.
  - Older desktops: a plot whose lines are all slope (or all d/dt) lines of its y-axis group K becomes "slope of K"
    ("rate of K") when it opens; plots that mix them keep their y axis and show the note.
- **v8.29 (2026-11-09): slope along x, and a steps tool — the "slope of the drop" live.** (human, via the
  intermittent-discharge session: "I like the slope of the drop plot is there a way to do that in visualizer without
  caching everything? should be pretty cheap on the 1D stuff") Computed from the curve as drawn; nothing stored.
  Definitions as `claude_work/scratch/gap-proto/steps.py`.
  - **Line → slope** (beside d/dt; data lines, not on a time x axis): off | d/dx | −d/dx | **slope of the drop**, over a
    window w (a number or variable): (y(x + w/2) − y(x − w/2)) / w, the curve held at its ends, in x as drawn (after
    f(x): per R\* with x * L or on an s axis); the drop: signed so the curve's net change counts positive. After the
    line's scale, before f(y). Measured variables and fits read it too.
  - **+ tool → steps above a running median** (1D): for each curve of a line (or every line), the background b = the
    running median over a window w along x (dashed), the threshold b + kσ (dotted; σ = 1.4826 × the median absolute
    deviation of curve − b over the curve), and the steps shaded — light from where the excess starts to where it
    ends, dark = 10–90 % of its excess ∫(curve − b) dx. The text box gives σ, the number of steps and the three
    largest (10–90 % span, excess). w and k take variables. The median and σ are taken over x (the curve resampled to a
    uniform grid of w/40), so densely sampled parts (a traced line near the star) do not weigh more; on evenly sampled
    curves this is the prototype's, up to interpolation.
  - Checked against the prototype (rcs-pairs-chen-1, t = 80, phi_along with s = s/s_max × line_smax, w 0.5, median over
    3, k 3): r_max 3.01 σ 1.82 vs 1.89, step 0–1.54 vs 0–1.44, 10–90 % 0.06–0.59 both, excess 17.3 vs 17.2; r_max 8.07:
    the same steps at the same places. On a long smooth line σ is tiny (0.0077 there; the prototype's 0), so small
    bumps (excess ≈ 0.04 against the footpoint's 28) pass 3σ.
- **v8.28 (2026-11-09): along-line data at the line's own points, plotted against true s.** (human: "make all of the
  along field lines data saved naturally as along s, then when I want to plot s/smax it can just do that scaling
  automatically … I fear there may be some bad conversion in what is currently saved")
  - **New data** (data manager family `along`: s, E∥, Φ, j∥/B, r sinθ B_φ, |B|; menus: "along one field line ▸ along
    the line (true s)"): the values at the traced line's own points (its crossings of the grid cells, ≈ 600–1,700 per
    line), each with its arc length s. Nothing resampled. Why: the older "… along the line" quantities (200 points in
    s/s_max) missed most of the footpoint E∥ peak on long lines — chen-1, r_max 8, t = 50–80: the south-foot peak 17 %
    of the one at the line's points (`claude_work/tasks/2026-11-09_along-s-check`). The older ones stay.
  - **x axes for them**: "s from the north foot [R\*]", "s/s_max" (computed per line and output: s / its last s; the
    same axis as the older data, so both can be compared), "s from the south foot [R\*]". Each line and each output
    has its own points; a ±N-frame mean, a "mean over" window or d/dt interpolates the other outputs onto the shown
    output's points (fixed position along the line). Not offered as 2D maps, on time axes or on r_max axes; a mean over
    r_max is refused (no common s).
  - A field-line length variable (v8.27) on these lines is the stored length (exact), not measured from Ψ.
  - Loading: per output about 0.85 MB (s, float32) + 0.43 MB per quantity (float16); precache loads both.
- **v8.27 (2026-11-09): s along the field line in R\* — field-line length as a measured variable, used per curve.**
  (human: "per line axis scaling (like using the variables/measurements methods"; "measuring a value isn't caching but
  computation off of cached stuff") Nothing new is cached.
  - **New measure: field-line length (R\*)** (+ measured variable, or the sidebar's measure menu). For each curve of
    its line (a quantity along field lines, r_max picked or a list), the poloidal length of that curve's own closed field
    line — its dataset, its r_max, its time — measured from the dataset's Ψ: the contour of Ψ through the north
    footpoint (θ_foot = asin √(1/r_max), as the field-line tool), traced and summed. A line that does not come back to
    the star (other end at r ≥ 1.1) has no length (—). Needs Ψ cached; ⚠ beside the value says why when it has none.
    Precache loads Ψ ahead for it (≈ 0.5 MB per frame).
  - **Per curve in f(x) and f(y)**: a measured variable with one value per curve (a field-line length, or any measured
    variable of a line that follows a list) is, in an axis function, each curve's own value — matched by dataset and
    picks (r_max), so other lines of the plot with the same r_max values use it too. A curve it has no value for is not
    drawn, and the plot says so. (Before, f(x) used the first value for every curve.)
  - **One click**: on the s/s_max axis, the "R\* ▾" menu beside f(x) — "s from the north foot" (`x * L`), "from the south
    foot" (`(1 - x) * L`, s/s_max = 0 is the north foot), "back to s/s_max". It makes the length variable L for the plot's
    line (or reuses it) and sets the axis label.
  - Checked against the cached `line_smax` (rcs-pairs-chen-1, r_max 3 / 5 / 8, t = 0 – 160): the measured lengths are
    0.1 – 3.6 % longer; at t = 0 they are closer to the exact dipole length (−0.4 % vs −0.5 to −1.9 %).
  - Variables named in f(x) / f(y) now count as used in the sidebar, and renaming a variable renames it there too.
- **v8.26 (2026-11-09): "hide <" for 2D maps.** (human, via the intermittent-discharge session: "what I would care
  about is giving it a particular number and to have me be doing it, so lets keep it simple") ⚙ → Colour, the "map"
  row: **hide <** takes a number or a number variable (▾); cells whose |value| is below it are drawn in the plot
  background, so only the strong parts show. Grey still means no data (inside the star, outside the grid), so the two
  stay apart, in the dark plot theme too. Empty = off (the default; existing desktops unchanged). Own by default like
  the other colour settings; 🔗 or shift-click shares it inside a figure. The colour bar and limits are unchanged.
- **v8.25 (2026-11-09): quantity families, named axes, derived quantities.** (human, via the intermittent-discharge
  session: "improve quantity management … kinda like a dictionary or class system … there is a ton of stuff in this gap
  most of it is cheap to compute from precached things"; "then yes I want you to work on this quantity family concept")
  - **Families** (data manager): one computation, several members — `@dm.family(axes=…, label="gap", members={"length":
    dict(label="length", yaxis=…, units=…), "mask": dict(…, axes=(…))})`, the function returns `{member: array}`. Each
    member is stored as `gap.length` etc. (same files as any quantity), all with one version, computed in one pass and
    cached as one item (asking for any member caches the family). Menus list them in their own section, "along field
    lines ▸ gap", labelled "gap · length". The page's "cache more…" offers the family once; the Methods tab lists the
    families. `dm.check` checks each member.
  - **Named axes**: `dm.Axis("leg", [1, 2], names=["north", "south"])` — picks show and accept the names ("north",
    or "north, south" for one line each), legends say "leg = south". Names are display only (no new version).
  - **Derived quantities** (viewer, never cached): the expressions now take comparisons (`>= > <= < == !=`, 1 or 0),
    `where(c, a, b)`, `and(…)`, `or(…)`, `not(…)`, a family's members (`gap.voltage`), other expressions, and number /
    measured variables from the sidebar (read at every draw, so changing V_min redraws at once). A dotted name
    (`gap.on = abs(gap.voltage) >= V_min`) is listed with its family. **For: every desktop** (the expression box) keeps
    it in the shared library (`views/library/derived.json`, 📚 in the list; the data manager's Methods tab lists them).
  - On-fraction or switching rate over time: a 1D line of the derived 0/1 quantity vs time with "±n-frame mean" (and
    d/dt). Not point-by-point (e.g. a north–south cross-correlation) is not covered yet.
- **v8.24 (2026-11-09): dataset groups, an archive, a page per dataset, cache presets.** (human: "my main gripe isn't
  slowness its managing things"; "I like the collapsible dataset groups, there may be a way to use those to improve my
  choosing of datasets on a new desktop"; "there may be some particular datas that I cache for one dataset and not for
  others so I think the current dataviewer of the grid isn't the best way"; "I or AI forms groups"). **Restart serve.py
  once** (new data manager actions).
  - **Data manager, left: a tree of dataset groups.** ▾ folds a group (remembered per browser); drag a dataset onto a
    group to move it, a group heading to reorder; ⋯ on a group: its grid, cache for all of it, rename, archive all,
    ungroup. "+ group" (name it, tick its datasets), "suggest…" (groups from the names, for datasets in no group:
    rcs-*, replicate_2017_*, b06-*; rename them before making them). Groups only list datasets: nothing is recomputed.
  - **Click a group: its grid** — just its datasets, and only the quantities one of them has ("show them" for all).
    **"all datasets"** is the old grid (archived and hidden datasets left out).
  - **Click a dataset: its page** — what it is (wiki line), its group (menu), outputs and size, and only what is stored
    for it, by quantity group (click a state for compute / redo / delete). Buttons: cache more…, raw fields…, card…,
    follow…, compare config…, the group's grid, archive, more….
  - **Cache more…** lists the quantities not (fully, up to date) stored there, by group; for a group, how many of its
    datasets have each. **Presets**: "save ticks as a preset…", then one click ticks the preset's quantities (× deletes
    one). Stored in `datamgr/groups.json` ("presets").
  - **Archive**: the dataset's stored data stays; the visualizer's menus leave it out (unless a plot uses it); the
    data manager lists it under "archived" (drag it into a group, or "un-archive", to bring it back).
  - **Visualizer**: dataset menus are sectioned by group (archived left out); a 1D line's dataset menu offers "a whole
    group as a list" (a dataset list named after the group, one curve per dataset); the new-panel and "+ dataset"
    tick lists have group headings (tick a heading = the whole group); the hover text says the group.
  - Stored in `data/datasets.json`: each dataset's `group` and `archived`, and `group_order`. CLI: `python -m datamgr
    dataset-group NAME … --to GROUP`, `rename-dataset-group`, `move-dataset-group`, `suggest-groups`, `archive NAME …
    [--undo]`, `preset NAME [QUANTITY …] [--delete]`, `add-dataset … --group GROUP`.
  - The status the page reads now lists each run folder and reads each manifest once (they were read twice).
- **v8.23 (2026-11-04): desktops follow renamed datasets.** (human: "why is my visualizer frozen" — the RCS desktop
  showed no data: its datasets had been renamed rics-* → rcs-*; "can you just clean up my current desktops?") Renaming
  a dataset (data manager) now keeps its old name on the card (`renamed_from` in `data/datasets.json`). When a desktop
  opens (and at start), references to an old name that is no longer in the store become the new name, with a note
  ("renamed datasets updated in this desktop: … (save it to keep that)"). The rcs-* cards carry their rics-* names;
  the saved desktops were fixed the same way (backup: `views/backup/desktops-2026-11-04/`).
- **v8.22 (2026-11-04): linking redone — own by default, zoom by axes, 🔗 per setting, shift-click.** (human: plots
  "different enough" share "mainly pan and zoom (but like that depends on if they share axes"; "the colormap
  autolinking too much and messing me up"; "oh i like the concept of shift click"; "lets just do all of them"; "and any
  linking remains within a single panel")
  - **Links live only inside a figure.** A plot dragged out of a figure is unlinked and keeps its look; "split into
    separate panels" (the figure's 🔗 badge) unlinks every plot. Desktops saved before: linked panels outside a figure
    become panels of their own on loading (same look).
  - **Joining a figure shares only pan & zoom, with the plots of the same axes** (2D: same x / y dims and meridional;
    1D: the x window with plots of the same x axis, the y window with plots of the same y axis). Everything else is
    the plot's own. No link box any more. In a figure saved before, what was shared stays shared; its one pan & zoom
    becomes each plot's, following the plots with the same axes.
  - **🔗 at the end of each settings row** replaces ALL / OWN / COL / ROW / PART / MIX: lit = shared (hover: with which
    plots), grey = this plot's own; "axes" / "col" / "row" under it for those rules. Click: tick the plots of the figure
    that share it (this plot's value is the one they take), or, for settings shared per column / row / axes, whether
    this plot follows; below, the figure-wide rule for every plot (all / same axes for pan & zoom / per column / per
    row / each its own).
  - **Shift-click a plot to select it** (blue outline; a bar at the top says how many). With several selected, a
    setting you change for one of them (settings box or a click-to-set pop-up) is set in every selected plot of the
    same kind (maps / 1D), except lines and tools. Nothing stays tied. Shift-click again removes one; Esc or a click on
    the empty desktop clears.
- **v8.21 (2026-11-04): two fixes.**
  - **The board follows a screen change.** (human: "the panels don't really update to fill my screen unless i leave
    the panel and come back"; text "the wrong size") The layout re-ran only on the window's resize event, which VS Code's
    browser doesn't always send when the screen or resolution changes. Now the page's own size and the pixel ratio are
    watched too. Bug page: wiki `debugging/visualizer-screen-change-layout`.
  - **The sharing menu no longer closes the pop-up it was opened from.** (human: "when I click colorbar and then try
    to set linking as own … makes my original settings dissapear") The ALL / OWN tag's menu opens as a small sub-menu
    over the colour bar's (or an axis's) pop-up, which stays open and shows the new state. Bug page: wiki
    `debugging/visualizer-sharing-menu-closes-popup`.
- **v8.20 (2026-11-04): a variable menu for field-line r_max / contour levels.** (human: "when I do r_max field lines it
  doesn't let me dropdown from variables") The levels box of a map's "contours / field lines" tool now has the same ▾
  menu as number boxes: number, measured and fit variables. Picking one replaces the list (type e.g. `2, rmax` to mix
  numbers and variables, as before).
- **v8.19 (2026-11-03): hover a dataset to see what it is; compare two datasets' configs.** (human: "I have tons of
  datasets and they are … hard to remember which is which"; "I like the idea of tooltips so when I hover over dataset it
  says whats what")
  - **Hover text.** Every place that names a dataset shows what the run is, from the wiki: dataset menus (the menu itself
    and each option), the dataset chips above 1D plots, legend entries (1D), a 2D plot's title, the sidebar's dataset
    variables, the new-panel and "+ dataset" tick lists, and the data manager's column headings. It reads e.g.
    "pairs-10: the replicate_2017 fixes on the project's 2–8 drive / = replicate_2017_7 with the project's drive /
    wiki: twist-structure/pairs-runs · stored to t = 200", then the card's tags and notes.
  - **Where the text comes from.** Each run section heading in the wiki (`## <run> — <what it is> (`<run>`)`) and its
    "**= X with Y.**" line; runs described only in a table are written out in the tool. `claude_work/tools/wiki_about.py`
    (local) writes `claude_work/datamgr/wiki_about.json`; `python -m datamgr about` (server) copies it into the cards
    (`about`, `page` in `data/datasets.json`). Re-run both after a new run section; to fix a line, fix the wiki heading.
  - **Compare.** A dataset's pop-up (click a dataset chip, or a dataset in a list legend) and the data manager's column
    menu ("compare its config with another dataset…") have "compare with…": a table of only the config numbers that
    differ (`output_dir` left out). Config only: a code change without a config switch does not show, which is what the
    wiki line is for.
- **v8.18 (2026-11-02): dataset lists, and a legend that says what it acts on.** (human: "there are enough times where I
  have a single line (like my twist energy as fn of time) that I want to plot for a list of datasets, its kinda weird how
  datasets act differently and lists dont work for them"; "clicking the legend is useful but its confusing once you get
  to lists, could it be made to basically show what things are acted on")
  - **A dataset variable can be a list** (sidebar: "+ dataset (makes it a list)…" under a dataset variable, or tick
    "more datasets" when making one). A 1D line that follows it is drawn once per dataset, each dataset in its own
    colour (set per dataset in the sidebar; the same in every plot); several lines on one list are told apart by line
    style, and the legend has one entry per dataset (colour) and one per line (style). With an r_max (or time) list as
    well, every combination: the dataset's colour, shaded per r_max. A measured variable of such a line has one value
    per dataset.
  - Lists are offered only where several datasets make sense: a 1D line's dataset (line editor, + line, the header
    chip). Not for 2D maps, analytic parameters, config variables or a function line's config.
  - **"+ dataset"** ticks the datasets the plot's lines are drawn for: as a list (default; the list they follow, else a
    new one named runs, runs2 …) or as separate copies (the old way, e.g. to style one dataset differently). It also
    offers **merge**: lines that differ only in their dataset (old copies) become one line each that follows a list,
    keeping their colours.
  - **Legend clicks:** a line opens its editor, which now starts with what it draws ("drawn 4 times: once per dataset
    of runs (baseline-19, baseline-18) × r_max of rmax (2, 4)") and has the list's datasets right there (colour, ×,
    + dataset). A dataset's (or value's) colour entry opens that value: its colour, the lines here that use it (click to
    edit), "remove from the list". Changing a list changes every plot that uses it (the box says how many).
  - A curve whose data can't be read (e.g. one dataset of a list not cached) is reported under the plot; the other
    curves are still drawn (before, the whole plot stayed empty).
- **v8.17 (2026-10-30): a function on a 1D plot's axis.** (human: "click an axis and apply a fn to it. Like if my x
  axis is r_max can I make it be 1/r_max easily? because the value shouldn't have to change right") Click an axis of a
  1D plot: the box **f(x)** (x axis) or **f(y)** (y axis) takes a formula, e.g. `1/x`, `log10(x)`, `y*x^3`, `1/y`.
  The data are not changed, only where they are drawn: each point moves to x′ = f(x), each value to y′ = f(y, x).
  - x is always the x axis's own coordinate (r_max …; its name works too: `1/r_max`); y is the value as it would be
    drawn without the function (after |y| and the line's scale). Also: t (the slider's time), pi, variables, the
    config numbers of the plot's dataset. Empty = none. A formula that can't be read is reported under the plot and
    the axis is drawn without it.
  - The axis label becomes the formula ("1/r_max", "|current|*r_max", no units). Hovering shows both: "1/r_max =
    0.227 (r_max ≈ 4.47)".
  - Things on the plot work on the axis as drawn: zoom and pan, fits (the formula is in the new variable: "y = −0.88
    (1/r_max) + 0.33"), means, positions typed for lines and ranges. A mean along x therefore weights by steps in
    f(x). Fit and measured variables read the plot as drawn too.
  - Function and analytic lines are still evaluated in the axis's own x ({r_max} keeps its meaning), then moved like
    the data; they are sampled finer where f stretches the axis, so they stay smooth.
  - Scales (÷ max, ÷ value at x, ÷ mean) use the axis's own x. The slider's time (the now line) is moved on a time axis.
  - 2D maps: not done (the image would need resampling through the inverse of f).
- **v8.16 (2026-10-30): where a movie's time goes.** (human: "why did my movie take 10 minutes to save when I already
  have everything cached?") The movie's progress bar and its last message give the time per frame: drawing (and of
  that, measured variables), PNG encoding, and waiting for the upload. While a movie is made, the other plots that use
  measured or fit variables are no longer redrawn every frame (as in playback); they are once it ends. Measured the
  same day: uploads through the port forward ~0.1 s for a 0.8 MB frame, PNG ~55 ms for 1150×600, so a cached 351-frame
  three-map movie should take about a minute; the one that took 9 min (1.5 s a frame) was slow in drawing.
- **v8.15.2 (2026-10-28): fixes.** (1) A plot dragged out of its figure but still linked to it had no dock tabs, and a
  linked copy of it crashed ("Cannot read properties of undefined (reading 'indexOf')"): now it is a target like any
  plot — docking onto it (or a linked copy of it) makes a new figure, and it leaves its old figure's link (keeping its
  look); dock tabs are named by the plot's title. (2) A data request the port forward stalls (no error, no data) used to
  hang forever and leave a plot blank until a restart: a request that receives nothing for 20 s is aborted and tried
  again (twice), then fails with a message under the plot; a draw that waits more than 20 s no longer blocks the next.
- **v8.15.1 (2026-10-21): axis labels from the axis click.** The box a click on an axis (its label or numbers) or the
  colour bar opens starts with **label [ … ] ↺**: the label as text, already focused, applied as you type (empty or ↺ =
  automatic; {name} = a variable, $…$ = LaTeX). It used to be behind the small ✎ in the axis line.
- **v8.15 (2026-10-20): linking keeps what you set up.** Docking a plot onto another (grid or focus) compares them by
  group — 1D: x axis, y axis, labels & legend, tools, size & scale; 2D: axes & zoom, slice & time, colour map, colour
  limits, labels, tools, size. A group where the joining plot differs **and** it was changed from a new plot's default
  stays its own; one where the joining plot is at the default takes the other's (another y axis, x axis or quantity
  keeps those groups its own, as before). When anything differs, a **link box** shows the plan — each differing group
  with "share …'s / keep its own", pre-set by that rule — and "link" or "cancel". Copies (linked copy, copy with another
  dataset) link without asking. The toast says what was kept; the tags in ⚙ show it afterwards.
- **v8.14 (2026-10-20): d/dt on lines (nothing stored).** A data line of a quantity with a time axis ("+ line" or its
  legend box) has **d/dt: off | d/dt | −d/dt**, smoothing **± n** outputs, and **local fit** (the slope of a straight
  line through 2n + 1 outputs) or **difference** (the centred difference of ±n means).
  - x = time: the derivative along x.
  - Another x (e.g. r_max): the derivative along time at each x — around the time shown (the slider, fixed, or each of a
    list of times; ±n outputs, at least ±1), or with time "mean over" a window: the **rate over the window** (local fit:
    the slope through all of it; difference: of its ends, n = 0 = exactly (y(t₂) − y(t₁)) / (t₂ − t₁), the mean of the
    derivative).
  - With d/dt on, the quantity menu lists every quantity with a time axis, so −d/dt of an energy can go on a power
    panel's y axis. The legend says it ("−d/dt twist energy · … · fit over ±2 outputs", "… · rate over t 60–100").
- **v8.13.1 (2026-10-20): sharing tags look at every linked plot.** A setting one plot made its own left the others
  saying ALL. Now ALL = every linked plot shares it; **MIX** = this plot shares it but some others have their own (the
  hover box names them); OWN = this plot's own, or shared but every other plot has its own (edits change only this
  plot); COL / ROW = per figure column / row; PART = this plot's line is partly shared (e.g. the y range shared, log own).
- **v8.13 (2026-10-20): 2D maps averaged over ±N outputs.** A 2D map's time line (⚙ → Axes, "t") has **avg ±N**:
  each pixel is the mean of the outputs i − N … i + N around the time shown (the slider's or the fixed one; cut at the
  run's ends; N ≤ 50; a number or a variable). The title says which times were averaged ("mean of t 90–110"); the
  colour range comes from the averaged map (the recorded per-output ranges are wider). It shares like averaging in 1D
  ("size, scale, averaging").
- **v8.12 (2026-10-20): a fit's (or mean's) range is just bounds; view_x0 / view_x1.** The "whole curve / shown
  part" menu is gone: **x from [ ] to [ ]**, empty = the whole curve (inside the ⏱ time range on a time axis). Built-in
  variables **view_x0, view_x1, view_y0, view_y1** = the part of a plot shown (its pan & zoom), in every plot and every
  number box (▾ menu or typed), so a fit from view_x0 to view_x1 follows the zoom. A tool or measured mean set to "shown
  part" before becomes view_x0 – view_x1 when opened (same result).
- **v8.11 (2026-10-20): the fit text works like the legend.** Drag it anywhere on the plot (it snaps to corners and
  edges; double-click it: back to the upper left); no box behind it, a halo behind the letters. **Click a fit's text**
  to edit that fit: besides the fit itself, its **text** (a label before the formula — `{c}` = the curve's name,
  `{name}` a variable, `$…$` LaTeX; empty = automatic — and R² / the fitted x range on or off), and where the fit text
  sits and its size (**Aa**). The settings box has a "fit text" line (position + size) under the legend when the plot
  has a fit; 🎨 style has a desktop size for fit text.
- **v8.10 (2026-10-16): fit variables — a number of a fit, one value per dataset.** A fit tool's **→ variable** (or
  sidebar → fits → + fit variable) keeps one of its numbers: k, τ = −1/k or A of an exponential, p or A of a power law,
  a coefficient of a polynomial, or R². The viewer runs the same fit (the line's quantity and picks, its averaging,
  |value| and scale, the fit's model and x range) on every dataset that has the quantity; the sidebar card lists the
  values per dataset. It follows later changes of the fit (and keeps its last recipe if the plot is removed).
  - In a plot its name (a number box, a tool position, a y range…) and `{name}` in a text are the value for that plot's
    dataset. Where no plot says which (the sidebar), the card's "default" dataset is used.
  - In an analytic function, a parameter bound to it gets a dataset menu (like quantities and config numbers).
  - The exponential fit's formula label can show k (`e^(kt)`) or the decay time τ (`e^(−t/τ)`).
- **v8.9.9 (2026-10-15): switching desktops saves the one you leave.** Opening another desktop, a new empty one, the
  example or "restore previous desktop" first writes a named desktop back to views/desktops if it changed since it was
  opened or saved ("saved … before switching"); one only looked at isn't rewritten (the automatic things its first
  draws fill in don't count). An unnamed desktop with panels asks for a name (cancel = switch without saving; it stays
  under "restore previous desktop"). If the save fails it asks before switching.
- **v8.9.8 (2026-10-15): smooth left / right resizing.** A plot's canvas filled its box (CSS width 100 %), so while
  the box changed width the old picture was stretched or squeezed until the redraw came (2D maps by 25–33 % during a
  drag): that was the jitter. Up / down never did it, because the height is set by the redraw. Now a canvas is shown
  at the size it was drawn (cut at the box edge until redrawn), a new width asks for a redraw at once (not only through
  the browser's resize notice), and the snap to whole columns is 8 px (was 14).
- **v8.9.7 (2026-10-15): figure cells fill the figure.** Plots in a figure keep equal plot areas, so a cell that shares
  its neighbour's y axis or has its colour bar on top is narrower; the cell width was chosen as if nothing were saved,
  so that space stayed blank at the right of the frame (with three maps side by side about a third of it, and the maps
  — which keep their aspect — got short too). The cell width is now chosen so the widest row fills the frame.
- **v8.9.6 (2026-10-15): text sizes per plot, where you click the text.** Every box a click on a plot's text opens has
  an **Aa** size (px; a number or a variable; empty = the desktop's size from 🎨 style): the title; an axis's numbers
  (numbers + axis-label sizes); ✎ axis label (x and y labels together); the colour bar (its numbers + label); a legend
  entry's line box (legend text). The settings box has them all on one "text" line (Layout) and the legend line. Stored
  as `fonts` in the axis labels & legend family (shared like the labels); margins grow with the text.
- **v8.9.5 (2026-10-15): drag per axis (1D).** The x and y lines (settings box, and the box a click on an axis's
  numbers opens) have a drag switch: ⇆ = a drag inside the plot moves x (on by default, as before), ⇅ = it moves y (off
  by default; makes the y range manual; not with ±). Both on = the plot drags like a map. They share like the rest of
  pan & zoom (the row's tag).
- **v8.9.4 (2026-10-15): the corner's width is smooth.** Left / right used to jump a whole board column (≈ 310 px, ×
  the scale in focus mode); now the width follows the pointer and snaps to whole columns only within 14 px of one. A
  block's left edge stays on a column and it takes the columns it reaches (a part-column width leaves a gap at its
  right). In focus mode the block grows on both sides, so the corner stays under the pointer.
- **v8.9.3 (2026-10-15): fixes.** A double-click on a 1D plot (its legend: back to the corner; the plot: whole view)
  threw an error every time (a name clash in panel1d.js) — fixed. Dark mode: a switched-on toggle (|y|, log, ±, ✎ …)
  had dark-blue text on the dark-blue "on" colour and looked empty — now light text; dock tabs and the drag label get
  dark colours too. An error after the viewer has started now says so ("your layout is saved"; reload or close and keep
  working) instead of the start-up screen that offered a fresh layout.
- **v8.9.2 (2026-10-15): focus mode works like the grid; legends without a box.**
  - Focus is only another way of showing the desktop: the same moves work there. ⠿ on the focused panel / figure /
    figure cell drags as on the grid: onto a dock tab ◀ ▶ ▲ ▼ of a focused plot = link (rearranges a figure), into the
    strip = it goes there in the desktop's order (a cell dragged out of its figure becomes a plot of its own, still
    linked; the focus stays with the plots left). A thumbnail dragged in the strip moves there; onto a dock tab it
    links (v8.9). A press on a thumbnail without a move still focuses it.
  - The corner does what it does on the grid (columns left / right, shape up / down); the focused block keeps the size
    it got when focused, and is shown smaller only when it would leave the screen (never bigger). The gaps of a
    focused figure drag in grid pixels too. A new / copied panel is focused.
  - **Legends:** no box any more; a soft halo of the page colour sits behind the letters only, so the curves stay
    visible around the words.
- **v8.9.1 (2026-10-15): the focused panel's corner resizes it like a window** (replaced by v8.9.2: the corner works as
  on the grid).
- **v8.9 (2026-10-15): equations edited in place; focus mode keeps its size; drag to link in focus; layout backup.**
  - The function / expression box shows the formula as an **equation you edit in place** (MathLive, vendored in
    `viewer/vendor/mathlive`, loaded the first time a box opens). Type `/` for a fraction, `^` for a power, `sqrt`;
    "insert a name…" puts in a quantity, config number or coordinate. What the equation says is read back into the
    formula text; "⌨ text" switches to the text (remembered). An equation it can't read is shown and not saved.
  - **Focus mode:** the focused panel is sized to fill the screen once, when it is focused; changing its aspect ratio
    after that keeps the size (no refit). Its header, hover buttons and status line stay at their normal size (one line)
    when it is scaled up.
  - **Focus mode: drag a thumbnail onto the focused plot** — dock tabs ◀ ▶ ▲ ▼ appear on it, as on the grid, and the
    drop links the two into a figure (same type only: 1D with 1D, 2D with 2D). A press without a move still focuses.
  - Analytic lines have no line-level dataset any more: each quantity / config parameter picks its own.
  - **Layout backup:** "start with a fresh layout" (error screen) and `?fresh=1` keep the old layout as a backup and
    ask before replacing an earlier one. ☰ → "↺ restore the layout backup" (and the error screen) swap the backup and
    the current layout, so neither is lost. The harmless browser notice "ResizeObserver loop …" no longer opens the
    error screen.
- **v8.8 (2026-10-15): "+ line" data | analytic; a dataset per parameter; legend values.**
  - "+ line" starts with **data | analytic** (data by default; the last choice is remembered). Analytic: pick the
    function and set every {parameter} right there (x axis, number / variable, quantity, config number, slider's time).
  - A quantity or config parameter has **its own dataset** (default: the line's), so one function can take data from
    several runs. New lines start with the panel's dataset (it used to be the last line's).
  - Legend: lines of one function that differ only in typed values say so ("parabola · a = 2"); a parameter's
    description (Functions box) is the hover box of its name in "+ line".
- **v8.7 (2026-10-15): focus mode = the grid, scaled.** Every panel / figure is drawn exactly as on the grid (its grid
  width, fonts, margins) and then scaled: the focused one as large as fits the main area and the screen's height, the
  others down to the strip. Canvases are drawn at their scale, so they stay sharp. The focused panel's corner changes its
  aspect ratio (it is scaled to fit again after).
- **v8.6 (2026-10-15): focus mode fits the screen.** The focused panel or figure gets the width at which its whole height
  fits between the header and the footer (no scrolling; centred); a new window size fits again. Thumbnails are drawn
  without legends.
- **v8.5 (2026-10-15): focus mode; notes and parameters in the equation box.**
  - **Grid | Focus** (header): in Focus one panel or figure is large on the left; every other one is a thumbnail with its
    name in a strip on the right (dimmed; hover = bigger, in place; click = focus it; Tab / Shift+Tab = next / previous).
    A figure's thumbnail is the whole figure shrunk. While playing, thumbnails redraw every 4th frame. Grid brings the
    board back as it was. Kept per browser.
  - **Equation box:** a notes field (functions: in the shared library; expressions: in the desktop), shown in the name's
    hover box too; the parameters ({…}) the formula uses are listed as it is typed, each with how it is filled by default
    (quantity / config / variable / the slider's time / the x axis / a typed number) and a short description of its own.
- **v8.4 (2026-10-15): compact settings, hover help, function lists, sidebar width.**
  - **Settings:** one line per axis — axis · from – to · ± · log (· |y|) · ✎ label · ↺; colour on two lines (map ⇄
    scale ✎ / limits ± |v|); data on one line; aspect and colour-bar place under More → Layout; tools are one summary
    line each (click: an editor with all of their settings); 1D "all lines" (scale + average) and "legend" one line
    each; the Sharing section keeps "rows are datasets", "all shared", shared axes and gaps (the rest: the row tags).
  - **Hover help everywhere:** every tooltip shows at once, styled; help paragraphs are gone — the words are in the hover
    box of the thing they explain (a pop-up's own help: its title, marked ⓘ). Number boxes: the variable menu ▾ shows
    inside the box on hover.
  - **Functions / Expressions tabs:** the names as a list; hover = the equation (typeset); click = a box to change the
    name, formula, label, y-axis group and LaTeX (live preview; save / delete; renaming updates the plots that use it);
    ＋ = a new one; "edit as text" (folded) keeps the old text box.
  - **Sidebar width:** drag its right edge (kept per browser).
- **v8.3 (2026-10-15): sharing tags.** In a linked panel every settings row ends with a tag: **ALL** (shared by every
  linked plot), **COL** / **ROW** (per figure column / row), **OWN** (this plot only), **PART** (partly). Click it: this
  plot shared or its own, and (in a figure) how every plot shares that family of settings — the Sharing table's line.
- **v8.2 (2026-10-15): ⚙ back in the panel header; the Functions tab lists its functions as equations.**
  - **⚙ settings** is one click in every panel header again (and figure cell); ⋯ holds PNG, movie, copies, template,
    remove; the bar over the plot keeps ⟲ and PNG. (v8.1.1 the same day: the ⚙ part alone.)
  - **Functions tab:** under the box, one card per analytic function: its equation typeset with KaTeX (made from the
    formula: fractions, roots, powers, r_max → r_{max}, Bp → B_p, Greek names, line_current → I …), its y-axis group,
    parameters, and where it can be drawn. **✎ LaTeX** writes your own LaTeX for it (live preview; kept in the shared
    library with the functions, so every desktop shows it); "↺ from the formula" goes back. Only the display changes:
    the formula in the box is what is computed. The help text folds away under "how to write one".
  - KaTeX 0.16.11 (MIT) is part of the viewer (`viewer/vendor/katex/`): no internet needed.
- **v8.1 (2026-10-14): the rest of the UI review** (human: "make all the changes").
  - **Templates** (header → templates…; a panel's ⋯ → ☆ save as template…): a panel saved on purpose, its type filled
    in ("1D · twist angle vs t", "2D map · B_φ/B"), a tag, a preview; the picker groups by type and searches. Insert =
    an independent copy, or "keep in sync" (the panel's ⋯ can then reload or update the template).
  - **Desktops hold their panels** (💾 no longer writes panel setup files, so two desktops can't change each other's
    panels; "save current as…" is a real copy). Desktops saved before still open (their setup files are read; save once
    to keep the panels inside). Templates… → **old panel setups** lists those files: insert, make a template, delete.
  - **Panel header** = ⠿ · type · name · data · 🔗 · **⋯** (the menu: settings, PNG, movie, copies, template, remove — the
    same ⋯ is in the settings box). Hover a plot for **⚙ ⟲ PNG** in its corner.
  - **Settings box:** a search box ("limit", "legend", "log" …); Data / Axes / Colour / Lines open on top, the rest
    under **More**. On a narrow window it is a drawer on the right edge; otherwise it is kept on screen.
  - **One look:** linked = tinted rows; bound to a variable = a dashed blue underline; editing outline grey; the group
    colour only on the frame and the 🔗 badge. The group pop-up no longer has its own pan & zoom menu (Sharing table).
  - **Header ☰:** style, auto-refresh. **Footer** wraps on narrow windows; the cache text has a fixed width.
  - **Keys:** Ctrl+0 / Ctrl+= / Ctrl+− = panel size (like Ctrl + wheel).
  - **1D y range:** Shift + wheel sets the y range (as typing it); double-click / ⟲ goes back to automatic.
  - The x-axis menu has a fixed order; the 2D quantity menu follows the data manager's group order; the now-line tool
    only where an axis is time; "not cached" messages link to the data manager on that cell.
  - Config variables reach every config.toml number (after the data manager stored them: `python -m datamgr conf`).
    Dataset menus show the datasets' tags (notes as the tooltip).
  - **Data manager:** tabs Data · Methods · y-axis groups; a cell shows its health (outputs, missing, NaN fraction, size,
    when written, version); a column's ⋯ → **card** (notes, tags, config) and **↻ follow** (compute new outputs of a
    running simulation automatically, every 5 min); Methods: y-axis group per quantity, "→ code" for a renamed label;
    y-axis groups with units. Same words everywhere: dataset, quantity, y-axis group, group. **Restart serve.py** (templates,
    follow, the new data manager calls).
  - Removed: v2/v3 saved-state reading, the subpanel / layer migrations, the unused legend editor, the corner's
    double-click (🔒 and the setting stay), PNG / 🎬 / copy buttons in two places.
- **v8.0 (2026-10-14): board layout, click-to-set, link highlight, sidebar tabs, dark mode, naming** (UI review,
  wiki aperture4/reports/2026-10-14_ui-review; human decisions that day).
  - **Board:** the desktop is a grid of columns. Each panel or figure takes whole columns (drag its corner: the
    width snaps to columns) and stacks under what is above it in its columns, so a narrow panel fits a gap without
    pushing a wide one sideways. Drag a panel by ⠿ into any column; the others make room. **Ctrl + wheel / pinch =
    panel size** (the column width; "panel size − 100% +" in the footer); buttons and text keep their size. Placed
    columns hold for that number of columns; on another screen or panel size the panels flow to the free spots and
    get their places back when you return. Old desktops are converted from their pixel places once.
  - **Wheel zoom on a plot** follows how far the wheel moved (a mouse notch ≈ 25 %, trackpads zoom smoothly);
    sideways swipes do nothing; Shift + wheel = y zoom in 1D (mouse too).
  - **Click to set:** click a colour bar (map, reverse, norm, limits incl. manual / ± symmetric, |value|, label) or an
    axis's numbers or label (axis, range, ± symmetric, log, label). Changes apply at once; "all settings…" opens the
    box, which keeps every row too.
  - **Linked settings:** shared rows are tinted (blue bar); own rows are plain; "partly shared" / "per figure
    column / row" in a small tag. Hover a row for its switch (make own / share). The chain buttons are gone.
  - **Sidebar tabs:** Variables · Functions (analytic functions) · Expressions. The header is one row now.
  - **Theme:** ☀ ◐ ● in the header: light · dark page · dark page and dark plots. Saved PNGs, figure PNGs and movies
    are always drawn light.
  - **Naming:** what a plot shows is a **quantity** everywhere (was datatype / measurement); "window" → **view**; ±
    checkboxes say "± symmetric"; colour limits "auto: all times".
  - Data manager (same day, fix): one job per dataset at a time (a second one waits, "waiting"); a stored file that
    doesn't match its entry is recomputed; the jobs list keeps finished jobs as one line (gone after 10 min) with
    "clear N finished" and "earlier jobs". **Restart serve.py** for the "waiting" state. Bug page: wiki
    debugging/datamgr-concurrent-jobs.
- **v7.6 (2026-10-14): fix — docking 1D panels with different x axes.** The docked panel took the other's x axis
  (it was a shared setting), so a list over its own x axis (e.g. r_max values on a time plot) collapsed. Now a
  panel with another x axis keeps its own x axis, x window, labels and tools. Panels linked before: click 🔗 on the
  x axis row of the docked panel (→ own) and pick its x axis again. Bug page: wiki
  debugging/visualizer-dock-shared-x-axis.
- **v7.5 (2026-10-14): analytic functions shared by every desktop.** The analytic functions box is one library
  (`views/library/analytics.json`, written by serve.py), the same in every desktop and every browser; desktops no
  longer save their own. A desktop saved before still carries its functions: opening it adds them to the library
  (new names only; a name the library already has with another formula keeps the library's, with a note). If two
  tabs / browsers edit it, "apply" keeps functions added elsewhere meanwhile. **Restart serve.py once** (it offers the
  "library" now); until then the functions are kept in this browser (every desktop here) and move to the server at
  the first start with the new serve.py. Expressions stay per desktop.
- **v7.4 (2026-10-14): config variables.** Sidebar → configs → **+ config variable**: numbers from a dataset's
  config (as recorded: Bp, dt, fld_output_interval, downsample, twist_omega, twist_time, twist_rmax_1, twist_rmax_2,
  atm_time), from a dataset or a dataset variable (A …; it then follows A). One number, or several = a list: e.g.
  `band` = twist_rmax_1, twist_rmax_2 → a vertical line tool at `band` draws both band edges (list colours). Usable
  wherever a number variable is: number fields (typed or var ▾), picks, function lines and analytic functions,
  titles ({band}). Edit it in the sidebar: dataset, × a number, "+ number…".
- **v7.3 (2026-10-14): "fit" on small screens.** "fit" did nothing when the desktop was wider than the window (a
  laptop screen): it measured the desktop against itself. It now fits the desktop to the window, and keeps fitting
  (window resized, sidebar shown / hidden, moved to another screen) until you zoom by hand (−, +, 100 %); the fit
  button stays highlighted while it does. Plots are redrawn sharp when the window moves to a screen with another
  pixel ratio. Bug page: wiki debugging/visualizer-fit-zoom-laptop.
- **v7.2 (2026-10-13): sharing per figure column / row.** A figure's settings box → **Sharing (figure)** has one
  line per family of settings — dataset · datatype (2D) / lines (1D) · axes & slices · colour map · colour limits ·
  pan & zoom · tools · axis labels & legend · size, scale, averaging — each shared by **every plot**, **per
  column**, **per row**, or **each plot its own**. **rows are datasets** sets: dataset per row; datatype / lines,
  axes, colours, limits, pan & zoom, tools, labels per column; size etc. shared. Then a change in one plot goes to
  its column (or row): a new colour map or zoom in the top-left map also changes the bottom-left one; a new dataset
  in a row (2D: its dataset menu; 1D: a dataset chip) changes the whole row. 1D lines shared per column keep each
  row's dataset (a line added top-left appears bottom-left for the bottom row's dataset). A plot can still make a
  setting its own: its rows show 🔗 col / 🔗 row (click → own; click again → takes the column's / row's value).
  A plot docked into such a figure takes its column's and row's settings. The old "pan & zoom per figure column /
  row" is now this table's pan & zoom line (old desktops are converted). Titles can name dataset variables:
  "voltage vs r_max {B}" shows B's dataset.
- **v7.1 (2026-10-13): fixes.** The analytic line editor says at the top when nothing can be drawn yet (a
  {parameter} without a value, e.g. {r_max} on a time axis) and marks that row. Pop-up editors no longer show stray
  "null" text.
- **v7.0 (2026-10-13): analytic functions.** Header → **analytic functions**: one per line,
  `name = formula with {parameters}  # label [y axis quantity]`, e.g.
  `twist_an = 2 * {line_current} * {r_max}^2 * sqrt(1 - 1/{r_max}) / {Bp}  # twist angle (analytic) [twist angle]`
  (same grammar as the expressions; bare names only pi, e and functions). **apply** checks them.
  - **1D panels:** "+ line" → analytic → + add. The editor shows one row per {parameter}: the **x axis**, a **number
    or variable** (var ▾; a list draws one curve per value, several lists every combination with colours by the
    first), a **datatype** of the line's dataset, a **config number** (Bp …), or the **slider's time**. Each row starts
    "automatic" from the name: the x axis if it is the panel's x axis (t / time on a time axis), a datatype or config
    number of that name, a variable of that name, the slider's time for t / time; ↺ goes back to automatic.
  - **Datatypes are read where the curve is:** along the x axis (on a time axis: the whole history), at the slider's
    time (or at {t} when that is a value), and at the value of the parameter named like their other dims ({r_max}
    for line_current's r_max; the formula then uses the stored field line's r_max). A datatype without the x axis
    gives one number. With datatypes the curve has their points; without, 400 points across the window.
  - **2D maps:** each function is also a datatype "ƒ …" (menu section "analytic functions") wherever its {names}
    can be read by name: stored quantities (same output), coordinates (r, theta, r_max …), t, config numbers,
    number variables. E.g. twist_an is a map over t and r_max. The box says where each function works as a map.
  - A line keeps a copy of its formula, so a panel setup copied to another desktop still draws; it follows the
    definition wherever the definition exists. Desktops save the box.
- **v6.4 (2026-10-13): fix + variable menus.**
  - **Fix:** the new 1D panel form started with one dataset ticked, so clicking that dataset to pick it unticked it
    and the panel came out without lines. Now nothing starts ticked, the form lists the lines it will add (and
    pairs that don't exist), and the button says "create with N lines" or "create empty".
  - **var ▾** beside every box that takes a number or a variable (settings, tools, "+ line" values such as r_max,
    the line editor): pick a number or measured variable and its name goes into the box. Only shown when there are
    such variables.
- **v6.3 (2026-10-13): new panels start from their axes; legend you can move; ± for manual colour limits.**
  - **+ 1D panel / + 2D panel** open a small form with what defines the panel. 1D: x axis, y axis, and the first
    lines (tick datatypes and datasets: one line per pair that exists; the first datatype ticked sets the y axis).
    2D: dataset, datatype, x / y axes (meridional plane for r, θ). "create" makes it, "more settings…" also opens
    the settings box, cancel makes nothing.
  - **1D legend:** drag it anywhere on the plot; it snaps to the corners, edge middles and centre; dragged to the
    right of the plot it goes outside (the plot narrows to make room). Settings → Labels → "position" has the same
    places as a menu. Double-click the legend: back to the top right. Clicking an entry still edits its line.
  - **2D manual colour limits** have a **±** like the axis windows: type one value (40 → −40 to 40).
  - **Data manager:** the total stored (every dataset) is in the grid's top-left cell.
- **v6.2 (2026-10-07): the data manager works like a file browser.** Drag ⠿ a measurement onto a group heading to
  move it (ticked rows move together; drop on the dashed line at the bottom for a new group), drag group headings to
  reorder them, drag a dataset's column heading to reorder the columns. Click a name to rename it, as in the
  visualizer: a dataset (its stored data moves with it), a group, or a measurement's shown name (↺ goes back to
  the method's own label; only the shown name changes, nothing is recomputed). ⋯ or right-click opens the actions.
  A dataset's ⋯ → **raw fields from its dumps…** lists the 2D fields in its `fld.*.h5` files (B1–3, E1–3, J,
  num_e/p, stress_…); ticked ones are copied into the store as they are (float16 per output, not computed; no
  downsampling yet). serve.py now keeps its token in `.serve_token` across restarts, so a browser needs it once.
- **v6.1 (2026-10-07): data manager, round 2.** Datasets are the columns: **+ dataset** lists the runs in a folder you
  paste and adds the ones you tick (named as you like); columns can be hidden, moved, renamed or removed (removing
  deletes their stored data, after asking). Rows can be ticked to compute or delete them in every dataset at once.
  Groups are editable (rename, reorder, move rows) and only change how things are listed — here and in the
  visualizer's datatype menus (sections follow the data manager's order). In notebooks: `dm.dataset("no-pair-1")`
  gives each cached measurement as a labelled array (`ds.twist_angle.sel(r_max=3)`, `ds.B1.at(t=40)`). A missing
  datatype in a plot now says "not cached for <dataset>: compute it in the data manager". Restart serve.py once.
- **v6.0 (2026-10-07): the data manager.** Header → **🗂 data** opens `viewer/datamgr.html` (a new tab; it links
  back): a grid of stored quantities × runs (outputs stored, MB, up to date / kept / out of date), the saved methods
  with their code, and cache jobs with progress and cancel. Click a cell to cache the missing outputs, recompute, or
  drop it; "cache for…" on a method picks runs. The methods and the Python side are the `datamgr` package
  (`claude_work/datamgr/README.md`; planned home `Aperture_plotting/datamgr/`): `@dm.register` a function in a
  notebook, `dm.check` it on a few outputs, `dm.save` it, `dm.cache` it. The recorder's 19 recipes are its first
  methods (numbers checked against the store). **Restart serve.py once**; it prints the data manager link with a
  token: starting or deleting data needs it (other users of the server can reach 127.0.0.1 too).
- **v5.18 (2026-10-06): movies.** 🎬 next to every PNG button (panel and figure): name, fps (default the
  viewer's), times (default the ⏱ range), every N-th step, size (% of the plot as drawn). Each step is drawn as in
  the PNG and sent to serve.py, which runs ffmpeg like Aperture_plotting does (libx264, yuv420p) into
  `movies/<name>.mp4` (a free name: -2, -3 … if taken); the movie then downloads. Progress + cancel at the bottom
  right; the slider comes back afterwards. **Needs the new serve.py: restart it once.** Frames are sent as PNG
  (~0.4 MB for a two-map figure), so a long movie takes a while through the port forward; "size" makes it smaller.
- **v5.17 (2026-10-06):** fix — after dragging a panel whose settings box is open, the orange outline and connector
  stayed at the old place until the panel was moved again (they were measured while the panel was still gliding).
- **v5.16 (2026-10-06): measured means along any axis.** A measured variable "mean along …" picks the axis: the
  plot's x axis (as before; a time average on a time axis), or any other axis of the line — e.g. j∥/B along
  s/s_max: the line averaged over s/s_max (from – to optional), read at the slider's time (or at x = a value; on a
  non-time x axis an empty "at x" also averages over x). One value per curve for a list line; averaging along the
  list's own axis gives one value. Set it in "+ measured variable", the sidebar, or the mean tool's "→ variable"
  (now also for a tool along another axis).
- **v5.15 (2026-10-06):**
  - **Each tool is shared or own** in linked panels (settings → Tools: 🔗 / own on every tool). Own = this panel
    gets its own copy and the other panels keep theirs; 🔗 again = back to the shared one. New tools are shared, a
    mean or a fit starts as the panel's own. × on a shared tool removes it from every panel that shares it.
  - **Means as variables:** the mean tool (along x) has "→ variable"; measured variables of a line that follows a
    list hold one value per curve (e.g. `jm` = 0.039, 0.039, 0.014 for r_max_line = 2, 4, 8), and a line tool set
    to that variable draws one line per value in the list's colours — e.g. a horizontal / vertical line on another
    plot at each field line's mean. "mean" variables have the tool's range options (whole curve with from / to,
    or the plot's window).
- **v5.14 (2026-10-06): means along any axis.**
  - **In a line** (legend editor or "+ line"): every dim other than x has "=" (one value) or **"mean over"** with
    optional from – to in the shown coordinate (empty = all), e.g. j∥/B vs t with s/s_max = mean over → the
    line-averaged j∥/B. Time has "mean over" too (profiles: the time average; empty = the ⏱ time range). The
    line then works with everything else (scale, fit, mean tool, lists).
  - **Mean tool "along"**: x (one horizontal line per curve, as before) or another dim of the line (e.g.
    s/s_max, r_max (line), time): each curve averaged over it, drawn dashed in the curve's colour, with a legend
    entry "mean over …".
  - Means are trapezoid-weighted in the coordinate (right for uneven spacing); points without data are skipped.
- **v5.13 (2026-10-06):**
  - **Function lines** ("+ line" → "+ function y = f(x)"): type a formula, e.g. `a*x^2 + b*x + c`. Names: `x`, `t`
    (the slider's time), `pi`, `e`, number / measured variables (a list variable draws one curve per value, in the
    list's colours), and — if a dataset is chosen under "config of" — that run's config numbers (e.g.
    `twist_omega * min(x, twist_time)` is the drive ramp). Functions: sqrt abs exp log ln log10 sin cos tan asin
    acos atan atan2 sign min max pow. Dashed by default; the automatic y range follows the data and grows to show a
    function up to one data height beyond it.
  - **Fit tool** (settings → Tools → "fit"): polynomial (degree 0–8), power law A x^p or exponential A e^(kx), of
    one line or every line (one fit per curve, e.g. per r_max), over the shown window or the whole curve (from /
    to optional). Draws the fit and writes the formula and R² in the upper-left corner. Power law and exponential
    are straight-line fits of ln|y|.
  - **Mean tool** (Tools → "mean"): a horizontal line at each curve's mean, in its colour (one per r_max of a list
    line); over the whole curve — inside the time range on a time axis, from / to optional — or the shown window.
    The mean is the trapezoid average over x (the time average on a time axis). Label: `{v}` = the mean.
  - **Scale "÷ its own mean"** (settings → Lines → scale, or a line's legend editor): deviation from the mean
    shows as the distance from 1. Measured variables have a "mean" too.
  - **Average ±N frames** (settings → Lines → average, a line's own in its legend editor): a profile that follows
    the slider is the mean of the frames t−N … t+N; a time series gets a running mean over ±N points. Legend part
    "±2-frame mean". Line plots only.
  - **Fix:** a settings row that was only partly shared (1D y window) said "own" while editing it still changed
    the linked panels; it now says "🔗 part" and one click makes it own.
- **v5.12 (2026-10-06):**
  - **Time range** (the ⏱ button beside the time slider): "from" / "to" boxes (numbers or variables; empty = the
    data's own start / end) and "only times every run here has" (ends where the shortest run ends, e.g. pairs-1 at
    t = 72). The slider, ▶ and precaching stay inside the range, so only its frames are loaded ahead; plots with a
    time axis show only the range unless they have their own window (can be switched off). Saved with the desktop.
  - **Runs that end early** keep their last frame, with a note on the plot ("pairs-1 ends at t = 72: its last frame
    is shown").
  - **± on every window row** (x and y, 1D and 2D): the axis is centred on 0; type one value (40 -> -40 to 40), or a
    variable. Automatic ranges and zooms stay centred.
  - **Pan & zoom per figure column / per row** (linked panels → 🔗 badge, or settings → Sharing): e.g. rows =
    datasets, columns = datatypes, and each column zooms together. The typed x / y windows and ± follow the same
    rule. Options: shared by all, per figure column, per figure row, each plot its own.
  - A datatype recorded after the page loaded now says "not recorded for … (⟳ refresh data)" instead of "has no time
    axis".
- **v5.11 (2026-10-05): LaTeX in labels.** Put math between `$...$` in any title, axis label, colour-bar label,
  legend label or tool label: `$B_\phi/B$`, `$E_\parallel$`, `$r_{\rm max}$`, `$\Delta\phi$`, `$10^{-3}$`,
  `$\partial_t B_\phi$`, `$t$ [$R_\star/c$]`. Supported: Greek letters, common symbols (`\parallel \perp \partial
  \nabla \int \propto \approx \sim \le \times \cdot \star \odot \infty \to`), `_x` / `_{..}` / `^{..}`,
  `\rm` / `\mathrm{}` / `\text{}` (upright), `\mathbf{}` (bold), `\frac{a}{b}` (drawn inline as a/b), spaces
  `\, \; \quad`. Like matplotlib's mathtext, not full LaTeX (no stacked fractions, no matrices); an unknown command
  is shown as typed. `\$` is a literal dollar. `{name}` variables work inside and outside the math.
  **Scaling note moved to the y-axis label** ("|twist angle| ÷ max twist angle (drive)"); legend labels only tell
  the curves apart. When lines of one panel are scaled differently the axis says "(scaled)" and each legend entry
  carries its own note.
- **v5.10 (2026-10-05):** a line's own label is used **as typed**; `{v}` puts this curve's list value in it
  ("twist at {v}" -> "twist at 3"). A single list line shows its values as legend entries under its label; the value
  is appended only where curves could not be told apart otherwise (lines on different lists, or legend "full").
- **v5.9 (2026-10-05): compact legends** (settings → Labels → legend: compact / full / hidden). Compact shows
  only what differs between curves ("measured · baseline-19"), with what they share as a grey heading; lines that
  follow one list with list colours get a two-part legend: one colour entry per value, one style entry per line.
  A line's own label (legend editor) still wins.
- **v5.8 (2026-10-05): desktop style** (header "🎨 style"): font sizes for titles, axis labels, tick numbers,
  legends, colour-bar label and numbers; the font (sans / serif / LaTeX-like if installed / mono); a multiplier for
  all line widths; axis-frame width; tick length. One style for the whole desktop, saved with it; empty boxes
  use the defaults; each box also takes a number variable. Margins grow with the text, plot areas keep their size.
- **v5.7 (2026-10-05): variables everywhere** (human: "pretty much anything physically possible to be altered by
  variables"). Every number box takes a number variable's name: tool and line widths, tool offsets, colour
  limits, log decades, symlog threshold, aspect, window and y-window boxes (as well as picks, fixed times, tool
  positions, scale values, contour levels). Text takes `{name}`: titles, axis and colour-bar labels, legend and
  tool labels show the variable's value (lists as "3, 5, 8", datasets as the run, measured values live).
- **v5.6 (2026-10-05):** tools have a **width** box (every tool) and vertical / horizontal lines a **label**
  drawn beside the line (e.g. "drive off"; `{v}` = the line's value, handy for list-valued lines).
- **v5.5 (2026-10-05):**
  - **Fixed time at a list** draws one curve per time (snapshots, e.g. twist vs r_max at t = 20, 40, 60), in
    the list's colours. One list expands per line (a pick list first, else the time list).
  - **Scaling lines:** settings → Lines → "scale" for every line of the panel, or a line's own in its legend
    editor: ÷ its own max |y|, ÷ max |y| of another datatype on the same line (e.g. twist angle ÷ max |drive
    twist| of that field line, to compare shapes), ÷ its value at an x, ÷ a number / variable. Scaled curves
    say so in the legend and the y label; a curve whose scale is 0 (no drive on that line) is left as it is.
- **v5.4 (2026-10-05):**
  - **List colours:** each value of a list variable has a colour (default series colours; click a swatch under
    the list in the sidebar to change it). Every line and every line tool following the list uses those
    colours, so r_max = 3 is the same colour everywhere; lines differ by line style (a second line with the
    same style gets the next one automatically). A line's legend editor / a tool's row can opt out (shades of
    its own colour / the tool colour).
  - **Typed window:** settings box → Axes → "window": x/y from-to boxes (grey = what is drawn now), "full";
    maps also have r < 3 / 6 / 12 / 20 presets (the meridional plane keeps its shape, so the box is widened to
    fit). 1D: x window + y window ("auto" refits y).
  - **Pan & zoom linking:** "pan & zoom shared" (settings → Sharing (figure), or the 🔗 pop-up) unlinks zoom
    and pan while every other setting stays linked; per plot, the window row's 🔗 / own does the same.
- **v5.3 (2026-10-05):** **list variables**: a number variable can be a list (sidebar: "3, 5, 8"). A line whose
  r_max (or other value) is that variable draws one curve per value, in shades of the line's colour; a line tool
  at it draws one rule per value; contour levels take all values; elsewhere the first value is used. Fixes:
  the play button shows ▶ again after pausing; pop-ups (e.g. "+ line") open above the settings box.
- **v5.2 (2026-10-05, from the audit `AUDIT-2026-10-05.md`):**
  - **Downloads run in parallel** (up to 4 for read-ahead, 6 with the frame on screen first) and a figure's maps
    and field lines are fetched together. serve.py keeps connections open (HTTP/1.1). Restart serve.py.
  - **Maps paint ~3-5x faster** (one colour per stored value instead of per pixel; identical pixels).
  - **Settings clicks redraw** the panel instead of rebuilding it; refresh with nothing new does nothing.
  - **Loading is visible:** a panel waiting for data dims after 0.25 s ("loading t = …"), the time label
    says "· loading…", the footer reads "ready ahead N/M steps · ↓ downloads · MB/s". If serve.py or the
    port forward drops, one banner appears, playback pauses, and it retries every 5 s.
  - **Safer layouts:** undo works after "⧉ dataset" and docking; the layout lives under its own browser key
    (older frozen versions can't overwrite it); "desktops… → restore previous desktop" brings back the one
    replaced by new / example / open; panels of a run that can't be read right now are kept.
  - **New datatype:** voltage (∫E∥ dl) along field lines, V(t, r_max) — the notebook's
    `fieldline_time(q="voltage")` (full line, dl = ds |B|/|B_pol|).
