# Viewer plugins

The viewer is a core (plots, maps, figures, data, variables, readings, tables, lineouts, simple drawing tools) plus
plugins that work with it, the way other libraries work with matplotlib. Two come with it: `analysis/` (general analysis
add-ons: fit, averaged curve, period, steps, steps from another plot; DECISIONS D22) and `aperture4/` (one person's data:
foot gaps, across lines, field lines, along-line data, names). A plugin adds kinds of lines, tools, "+ line" entries, symbols for
labels, and conversions of old desktops, without changing the core. (DECISIONS D17, D18.)

## Turning plugins on

`index.json` lists the plugins to load, in order:

```json
{ "plugins": ["analysis", "aperture4"] }
```

`?plugins=a,b` in the viewer's URL overrides the list for one visit; `?plugins=` loads none. A plugin that fails to load
is reported in a message and skipped; the viewer starts without it. A saved desktop that uses a plugin's lines keeps
them when the plugin is off: those lines show "a line made by a plugin that is not loaded" until it is on again.

## Writing one

A plugin is a folder here with an `index.js` whose default export is called once at start-up, before any desktop is
read:

```js
// plugins/myplugin/index.js
import { el } from "../../js/ui.js";          // core modules by relative path
import { newId } from "../../js/model.js";

export default function (api) {
  api.registerSymbols({ my_q: "Q_{\\rm my}" });               // names written as LaTeX in labels
  api.registerLineKind({ key, label, is, expand, curve, name, editor, colour, deps, yId, caps });
  api.registerLineMenu({ key, label, help, available, form }); // an entry in a 1D plot's "+ line"
  api.registerTool({ key, label, folder, where, help, is, make, summary, rows, style, colour });
  api.registerMigration(S => { /* convert old desktops */ });
  api.registerOutputAction({ kind, label, title, run });       // a button on a named tool's output card
  api.registerOutputKind({ kind, fields, values });            // what a named tool publishes ("$name.field" reads it)
  api.registerContourLevels({ key, label, title, levels });    // a way to choose contour levels
  api.registerAxisNames({ dim: "short name" }, [order]);       // how a plugin's dims read in the quantity menus
  api.registerDefaults({ scaleRef: [...], configVars: [...] }); // default quantities / config keys
  api.registerExampleDesktop(runs => plots);                   // the example desktop for this data
  api.registerDataKind({ key, label, is, dims, axes, fitAxis, lineData, mapLoad, mapPaint, … });   // data the core can't plot plainly
  api.registerReadingOp({ key, label, value, text, help, missing, perCurve });   // a reading (measured variable) operation
  api.registerPlotMenu({ key, label, title, available, run });  // an entry in a plot's ⋯ menu
  // api.core.toast(msg), api.core.spawnPlot(source, newPlot, opts), api.core.redrawReaders({output | tool | table}),
  // api.core.makeFigure(group, anchorPlot), api.core.rebuildAll(), api.core.save()
}
```

A plugin that adds a data kind should also have a `plugin.json` naming the dims only it can draw:

```json
{ "data": [{ "dims": ["pt"], "what": "data at a field line's own points (along-line data)" }] }
```

When the plugin is listed in `index.json` but not loaded (`?plugins=`, or it failed), the core reads this file, and a
plot of such data says "needs the <name> plugin, which is not loaded" instead of drawing it wrong; its settings are kept.

A plugin's tools and made lines can be named the same way (D22), so a saved desktop that has them keeps them and says
which plugin they need when it is off:

```json
{ "tools": [{ "type": "fit", "what": "the fit tool" }], "lines": [{ "field": "cyc", "what": "a line made from a period tool" }] }
```

(`type` = the stored tool's `type`; `field` = the field a made line carries, e.g. `l.cyc`.)

Optional fields the registries accept: a line kind's `yKind(l)` (its y-axis group), a "+ line" kind's `prefer(ctx)`
(the menu opens on it), a tool's `problem(ctx)` (why it can't go on a plot). A tool that computes on a 1D plot's curves
gives `prepare1d(env, t)` (before the y range: its own curves in `env.toolCurves`, a named output), `draw1d(env, t,
prepared)` (its drawing, in the plot's tool order; text in `env.info`, problems through `env.error`), `legend1d(env, t)`
(legend entries) and `textRow: true` (the "fit text" row in ⚙ → Lines); every field of `env` is listed above
`TOOL_DEFAULTS` in `js/settings.js`. A curve may carry `progress: [done, of]`,
`progressLabel` and `warn`, an x range `window` (shaded) and a marked `peak`. A later tool definition wins over an earlier
one for the same stored tool. Example plugins: `analysis/` (tools with their own drawing, a line kind, an output kind),
`aperture4/` (foot gaps, across lines, field lines, names, along-line data). A plugin may read another's tools
(aperture4's foot gaps read the analysis plugin's named steps tools): it checks `toolDefined(key)` (`js/settings.js`) and
works without them when that plugin is off.

What each field means is documented where the registry lives:

| Register | Fields documented in | Example to copy |
|---|---|---|
| `registerLineKind` | `js/linekinds.js` (top comment, `LINE_KIND_FIELDS`) | `aperture4/across.js` (a curve over time made in the browser) |
| `registerLineMenu` | `js/lines.js` (`registerLineMenu`) | `aperture4/across.js` `registerAcross` |
| `registerTool` | `js/settings.js` (the comment above `TOOL_DEFAULTS`) | the `hline` entry of `TOOL_DEFS`; `analysis/curvetools.js` (a fit: `draw1d`), `analysis/steps.js` (`prepare1d` + `draw1d`) |
| `registerSymbols` | `js/latex.js` | `KNOWN` in the same file |
| `registerMigration` | `js/app.js` `migrateDesktop` (runs after the core's steps) | `migrateDerivedKinds` |
| `registerOutputAction` | `js/vars.js` (`outputActions(kind)` gives a card its buttons) | `aperture4/gapseries.js` (→ foot gaps vs t) |
| `registerOutputKind` | `js/model.js` (`OUTPUT_FIELDS`, `outputValues`) | `analysis/steps.js` (the "steps" output) |
| `registerContourLevels`, `registerAxisNames`, `registerExampleDesktop`, `registerDefaults` | `js/model.js` | `aperture4/fieldlines.js`, `aperture4/names.js` |
| `registerDataKind` | `js/model.js` (the comment above `DATA_KINDS`: every field and where the core asks it) | `aperture4/alongline.js` (+ `alongmap.js`, `alongdata.js`) |
| `registerReadingOp` | `js/measure.js` (`registerReadingOp`), `js/model.js` (`READING_OPS`) | `aperture4/alongline.js` (the line length) |
| `registerPlotMenu` | `js/plugins.js` (`registerPlotMenu`) | `aperture4/alongline.js` (▦ linked slices) |

Each register function checks its entry and refuses a bad one with the reason (a missing field, a key that exists).

Rules (`../../RULES.md`): plugin files are checked like the core by `node tools/check.mjs` (syntax, the debt counts,
the desktop schema); a plugin that keeps state on the desktop adds its fields to `DESKTOP_SCHEMA` in `js/model.js`.

Not yet hooks (they come as features move into plugins, each with a DECISIONS entry): a tool's own drawing on a map,
server endpoints (the aperture4 plugin reads serve.py's api/window itself).
Moved so far: foot gaps, across lines, field lines, names and the example desktop (DECISIONS D19); along-line data
(D20: a data kind, the line-length reading, linked slices, the old-profile migration); the analysis add-ons (D22: fit,
averaged curve, period and its plots, steps, steps from another plot; their maths stay core: `fit.js`, `cycles.js`,
`stats.js`, because fit variables and the period readings use them).
