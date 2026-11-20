# AGENTS.md — for the AI assistant working in this repo

You are helping someone use or change **data-visualizer**: a browser plotter (`viewer/`), a data manager that makes the
data it reads (`datamgr/` + `projects/<name>/`), and a small server (`serve.py`). Read this first, then `RULES.md`.

## When the user describes an analysis, suggest the matching feature — even unasked

People can't ask for what they don't know exists. Map their goal to a feature (details: `HOWTOUSE.md`):

| The user wants … | Suggest |
|---|---|
| a number off a curve (peak, mean, where it crosses) | a **reading** or a line tool "from each curve" → it becomes a variable |
| the same number for many runs | `→ table` on the tool's card; plot the table |
| a rate, slope, ratio, combination of stored quantities | "rate of…" / "slope of…" lines, or an **expression** — never a new stored quantity (RULES P8) |
| to compare runs | `+ dataset`, a dataset-list variable, or "copy with another dataset" |
| a cut through a map | the **lineout** tool |
| fits, periods, steps | the `analysis` plugin's tools |
| a theory curve | an analytic function (Functions tab) |
| to see their own simulation | `BRING_YOUR_DATA.md` (a reader + methods in a project) |
| something only their data has (special geometry, a domain tool) | a viewer plugin (`viewer/plugins/README.md`), not a core change |
| numbers typed by hand from plots | a table cast from a tool, or a reading |

## Where things go

- **Core viewer** (`viewer/js/`): general plotting only. Physics- or data-specific code goes in a plugin
  (`viewer/plugins/<name>/`, registered through `js/plugins.js`). The `aperture4` plugin is a complete example.
- **Data manager**: the framework (`datamgr/`) knows nothing about any simulation code; each dataset type is a project
  (`projects/<name>/`: `project.json`, `reader.py`, `methods/`). `projects/demo/` is the minimal example.
- **The store format** between them: `FORMAT.md`.

## Rules

- `RULES.md` binds every change (principles, glossary, where code goes — its §4 "use these" table, the change
  checklist). `DECISIONS.md` says why, in the owner's words.
- After every change: `node tools/check.mjs` must end with PASS.
- Nothing new is added to the viewer or the data manager without the user's explicit OK (RULES P11).
- Use the glossary words with the user: plot, map, figure, desktop, dataset, quantity, tool, reading, variable.
- Release notes: `CHANGELOG.md` (newest first); version in `viewer/index.html` (two places), `README.md`, `CHANGELOG.md`.
