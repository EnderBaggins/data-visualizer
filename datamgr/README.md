# datamgr — the data manager

> **Rules for any change here:** `visualizer/RULES.md` (research_wiki repo). Decisions: `visualizer/DECISIONS.md`.
>
> **What is a method here (decided 2026-11-13, RULES P8 / DECISIONS D11).** A method stores a quantity only if it
> (1) reads the raw dumps, (2) needs a full pass over every output that the browser can't afford (tracing field lines,
> line or volume integrals), or (3) is a point-by-point map viewed so often that storing it beats downloading its inputs
> every frame. Anything made from stored quantities (ratios, d/dt, slopes and sums across lines, smoothing, readings,
> fits, periods) is computed in the viewer and never stored, so it never goes stale. Say which reason a new method meets,
> and ask the human before adding one. Retired 2026-11-13 (now made in the viewer; code in
> `claude_work/archive/datamgr-methods-2026-11-13/`): twist_rate, twist_rate_drive, twist_rate_voltage, twist_energy_rate,
> untwist_time, untwist_time_line, untwist_time_line_voltage, ohmic_power.

Compute data for the visualizer from simulation runs with **saved, reusable methods**. You try a method in a
notebook, save it, and cache it for the visualizer; the data manager page shows what is stored.
(Designed with the human 2026-10-07. Built in `claude_work/datamgr/`; it is meant to live in
`Aperture_plotting/datamgr/` under git, see the bottom.)

**Framework and project (2026-11-20, DECISIONS D17).** This package is the general framework: register, check, save,
cache, the store, the catalog, status, groups, jobs, the page. Everything about one kind of simulation output is in a
**project folder** (`projects/<name>/`, next to the package): the reader for its files, its axis catalogue, its
methods and the building blocks they share, its groups and its settings. The owner's is `projects/aperture4/`
(DataSph, the field-line caches, r_max, …); `projects/demo/` is a tiny example (one NumPy file per output).

## The project: your data's part

```
projects/<name>/
  project.json     name, reader, modules, paths (store, jobs, data_root, import_paths), page words: see config.py
  reader.py        class MyReader(datamgr.Reader): which folders are runs, outputs, times, loading one, grid, settings
  axes.py          the axis catalogue (dm.Axis ...) and sections (add_section); loaded before the methods
  warm.py          (optional) caches the cacher fills in its shared pass (register_warm)
  methods/         one file per stored quantity (dm.save writes here)
  tools/           building blocks methods share: `from datamgr.tools.<file> import f`
  groups.json      groups, shown names, y-axis groups, folders (edited from the page)
```

- **Which project:** `DATAMGR_PROJECT` (a project folder or its .json), else the one folder under `projects/` (several:
  the one named in `projects/default`). Every path in project.json can still be overridden with `DATAMGR_STORE`,
  `DATAMGR_JOBS`, `DATAMGR_METHODS`, `DATAMGR_DATA_ROOT`, `DATAMGR_VIEWER`, `DATAMGR_GROUPS`.
- **The reader** (`datamgr/reader.py` lists every call): class calls `is_run(path)`, `n_outputs(path)`,
  `field_names(path)`, `map_fields(path)`, `open(path)`, `wrap(native)`, `raw(native, key)`; per run `path`, `native`
  (what methods get as `data`), `steps()`, `is_settled(step)`, `time_of(step)`, `load(step)`, `current_step()`,
  `fields()`, `grid()` (named coordinates + optional geometry), `metadata()` (conf, conf_all); class attributes
  `grid_axes`, `time_units`, `field_labels`, `name`, `runs_word`, `not_a_run`, `raw_description`.
- The framework imports nothing from a project's libraries; only the project's files do.

## In a notebook (on the storage server)

```python
import sys; sys.path.insert(0, "/data/personal/Nicholas_Rackers/claude_work")   # the folder holding datamgr (and projects/)
import datamgr as dm

@dm.register(axes=("theta", "r"), label="E∥/B", quantity="E∥/B")
def my_Epar_over_B(data):                     # data = the run at one output (the object fld_val lambdas get)
    B2 = data.B1**2 + data.B2**2 + data.B3**2
    return (data.E1 * data.B1 + data.E2 * data.B2 + data.E3 * data.B3) / B2

dm.check(my_Epar_over_B, "baseline-19")       # 3 outputs: a small plot, the numbers, the cost of caching it all
dm.save(my_Epar_over_B)                       # -> datamgr/methods/my_Epar_over_B.py
dm.cache("my_Epar_over_B", runs=["baseline-19", "pairs-1"])
dm.status()                                   # what is stored, per run, and whether it is up to date

ds = dm.dataset("no-pair-1")                  # a dataset: its cached measurements are attributes
ds.twist_angle                                # labelled array over (time, r_max)
ds.twist_angle.sel(r_max=3)                   # -> over time          (nearest point; alternative axes work: theta_foot=30)
ds.twist_angle.sel(t=40)                      # -> over r_max        (t = the time axis)
ds.B1.at(t=40)                                # maps read one output at a time
ds["along.epar"].frame(i), ds["along.s"].frame(i)   # along each line at its own points: (r_max, pt), NaN tail
ds.list(); ds.cache("twist_angle"); ds.data   # what is stored; compute what is missing; the raw run (DataSph)
```

Reading never computes: a measurement that is not stored says so, and how to compute it. Computing happens only
here (notebook, terminal or the data manager page); the visualizer only reads.

## A method

```python
@dm.register(axes=(...), label="...", quantity="...", units="...")
def name(data):            # or name(data, steps) when "time" is one of the axes
    ...
    return values          # an array shaped like the axes; NaN = no data there
```

- **axes** — what the numbers are over. Catalogue names (`dm.AXES`, the project's `axes.py`; Aperture4: `theta`, `r`,
  `r_max`, `r_max_line`, `s_norm`, `pt`, `surface_theta`, `r_out`) or an ad hoc axis:
  `dm.Axis("r_probe", [1.5, 2, 3], label="r_probe", units="R_*")`. The same name always means the same numbers:
  caching refuses an axis whose numbers differ from what stored data uses.
- **linked axes** (`alt=`): the data is stored once, over the axis; an alternative coordinate is a function of
  the axis values, and the viewer can show or pick in either:
  `dm.Axis("r_max", values, alt={"theta_foot": dm.Alt(lambda r: np.degrees(np.arcsin(r ** -0.5)), "θ_foot", "deg")})`.
  Keep it one-to-one (rising or falling).
- **label** — the name in the viewer's menus. **quantity** — what the numbers are: quantities with the same
  `quantity` share a y axis and can be drawn together (the measured and the drive twist are both "twist angle").
  **units** belong to the quantity. `section` (where the viewer lists it) follows from the axes unless given.
- **time** — leave it out: you get one output at a time, and the cacher walks through time (only new outputs,
  resumable, little memory). List `"time"` first only when the method needs several times at once (a time
  derivative, a time average, a whole-run cache): then it is `name(data, steps)` and returns time first.
- **warms** (time-axis methods, 2026-11-12) — the caches it reads, so the cacher's shared pass fills them and the
  method never walks through the dumps itself: names the project registers (`dm.register_warm`, `datamgr/warm.py`).
  Aperture4 (`projects/aperture4/warm.py`): `warms=("line:current", "line:twist")` (lib.ai_functions' field-line
  cache of that line quantity, width 2) or `warms=("twist_energy",)` (integrals' energy cache at the r_out values
  the twist_energy method uses). Not part of the version. A time-axis method that reads the dumps
  some other way should get a warm spec added there, or it makes its own pass over every output (slow: below).
- **needs** (v11.4, 2026-11-12) — the dump fields it reads: `needs=("B1", "B2", "B3", "pair_produced")`. The viewer
  offers a not-yet-cached quantity (◌) only for runs whose dumps have every one (each run's fields: `catalog.dump_fields`,
  remembered in `<jobs>/dump_fields.json`; in `status --json` as each dataset's `fields`). Not part of the version.
- **self-contained** — a saved method may use imports (numpy, the plotting library, `lib.ai_functions`,
  `datamgr.tools`) but not variables or helpers that exist only in a notebook; `dm.save` names any it finds.
- **version** — a fingerprint of the computation: the function body (without decorator, docstring or comments)
  and its axes. Change what it computes and its cached data shows as out of date; caching computes it again. Change
  its label, quantity, units or group and nothing is recomputed. Only the latest version is kept (to keep an old
  one, save the new code under a new name, e.g. `twist_angle2`). Data made before the data manager (the old
  recorder, `vis.record`) is kept; `dm.adopt` turns it into the method's own data when the two agree (below).

## A family (v8.25): one computation, several quantities

```python
LEG = dm.Axis("leg", [1, 2], label="leg", names=["north", "south"])          # names: shown in the viewer's picks
@dm.family(axes=(LEG, "r_max"), label="gap", members={
    "length":  dict(label="length", yaxis="length along B", units="R_*"),
    "voltage": dict(label="voltage", yaxis="voltage"),
    "mask":    dict(label="mask", yaxis="gap mask", axes=("r_max", "s_norm"))})   # a member may have its own axes
def gap(data):                       # (or gap(data, steps) with "time" first in the axes, as for a method)
    g = ...                          # the one computation
    return {"length": ..., "voltage": ..., "mask": ...}       # every member, each shaped like its axes
```

- Stored as `gap.length`, `gap.voltage`, `gap.mask` (the same files as any quantity), all with the family's one
  version (its code + every member's axes): computed in one pass, cached as one item — `dm.cache("gap", …)` or any
  member's name. Member labels are short: the viewer shows "gap · length", listed in a section "<group> ▸ gap".
- `dm.check("gap", run)` checks each member. The status / page list the members (each names its family) and the
  families (`families`). Member settings: label, yaxis (or quantity), units, axes, dtype, section.
- Cheap things computed from cached members (thresholds, ratios, on/off) are **not** members: they are derived
  quantities in the viewer (Expressions, "every desktop"), e.g. `gap.on = abs(gap.voltage) >= V_min`, never cached.

## Along a field line at its own points: the `along` family (v8.28)

Human 2026-11-09: "make all of the along field lines data saved naturally as along s, then when I want to plot s/smax
it can just do that scaling automatically … I fear there may be some bad conversion in what is currently saved".

- `along.s`, `along.epar`, `along.phi`, `along.jpar_over_B`, `along.I_enc`, `along.Bmag` — axes (time,) r_max, `pt`.
  Point k of a line = its k-th crossing of a grid cell edge from the north footpoint, as `tools/fieldlines.py`
  traces it (`along_points`). Nothing is resampled along the line; `along.s` is
  each point's poloidal arc length from the north footpoint (R*, float32), so s/s_max = s / s[last] and the distance
  from the south foot = s[last] − s. The others are float16 like the maps. NaN past a line's last point and for lines
  that are not closed. `pt` has 2,048 slots (the most seen: 1,716); a longer line is an error, never cut.
- Why: the older `*_along` (200 points uniform in s/s_max) missed most of the footpoint E∥ peak on long lines (chen-1
  r_max 8 at t = 50–80: south foot 17 % of it) — `claude_work/tasks/2026-11-09_along-s-check`. Removed 2026-11-10
  (human: "yeah all that removed"): the methods `epar_along`, `phi_along`, `I_along`, `B_along`, `jpar_over_B_along`,
  `line_smax` and their helper `along_profiles` (last versions in `claude_work/archive/2026-11-10_datamgr-old-along/`),
  their stored data, and the old recorder's recipes for them. Same ideas here: `along.epar`, `along.phi`, `along.I_enc`,
  `along.Bmag`, `along.jpar_over_B`; `line_smax` = `along.s` at each line's last point.
- Checked (2026-11-09, before line_smax was removed): `along.s` at each line's last point equals `line_smax` exactly (104 lines, 2 outputs); stored E∥ = a fresh
  `along_points` to 2.4e-4 of the frame's max (float16). ≈ 1–1.8 s per output, ≈ 600 MB per 201-output dataset.
- Reading: `ds["along.epar"].frame(i)` and `ds["along.s"].frame(i)` (r_max × pt), then each line's row without its
  NaN tail.
- In the viewer: x axes "s from the north foot", "s/s_max", "s from the south foot" (per line, per output); not a
  2D map. A ±N-frame mean, a "mean over" window or a d/dt interpolates the other outputs onto the shown output's points.

## Datasets (the page's columns)

A dataset is a name and where its data comes from: a **simulation** (an Aperture4 run folder: methods can compute
from it) or **derived** data (made another way, e.g. the Carlqvist model sets: stored only). The registry is
`<store>/datasets.json`; datasets already in the store are listed automatically. Its stored data lives in
`<store>/<name>/`, so you can give a run any name (two runs with the same folder name can live side by side).

```python
dm.datasets()                                         # name -> {path, kind, added, note}
from datamgr.catalog import scan, add, rename, remove
scan("/data/RIS/cyuran/Active/giantflares/Nicholas/Aperture4/data")    # runs at / under a folder
add("pairs-2", "/data/.../pairs-2"); rename("pairs-2", "p2"); remove("p2", drop_data=True)
```

## Groups

How measurements are listed (the page's row sections and the visualizer's menu sections). Only that: they never
change data or versions. `dm.set_group(["twist_angle", "drive_twist"], "twist")`, `dm.rename_group(old, new)`;
stored in `datamgr/groups.json`, also on the page (drag rows onto a group heading, drag headings to reorder, click a
heading to rename). The same file keeps edited display names: `dm.set_label("Bphi_over_B", "B_φ/|B|")` (empty
text = the method's own label) changes what the page and the visualizer show, never the data or its version.

## Words, y-axis groups, cards, following (v8.1, 2026-10-14; UI review §4)

- **Words** (the same on the page, in the viewer and in FORMAT.md): a *dataset* is a simulation (or derived data); a
  *quantity* is what is stored and plotted; a *y-axis group* is what shares a y axis (`yaxis=` in `@dm.register`;
  older methods say `quantity=`, which means the same); a *group* is how quantities are listed. `--datasets` works
  wherever `--runs` does.
- **y-axis groups** (page → "y-axis groups" tab): move a quantity to another group without touching its code
  (`dm.set_yaxis(names, group)`; `""` = the code's), give a group units (`dm.set_yunits(group, units)`: used by its
  quantities whose code gives none). Both in `groups.json`; nothing is recomputed.
- **Shown names in one place:** a name renamed on the page can be written into the method's code ("→ code" on the
  Methods tab, `dm.push_label(name)`; only the `@dm.register` line changes). `dm.sync_labels()` writes names, groups,
  y-axis groups and units into every manifest (jobs also do it when they save).
- **Dataset cards** (a column's ⋯ → card): notes and tags (`dm.set_card(name, notes=, tags=)`, in `datasets.json`);
  the visualizer shows the tags in its dataset menus and the notes as the tooltip.
- **What each run is** (v8.19, 2026-11-03): the card's `about` and `page` (free text; a page name or link), shown
  wherever the visualizer names a dataset (hover). `python -m datamgr about [FILE]` (`dm.set_about()`) sets every
  dataset the project's about file (project.json "about") describes and lists the ones it doesn't. Aperture4: the
  run's wiki section heading (and its "**= X with Y.**" line); `python claude_work/tools/wiki_about.py` on the local
  machine writes `projects/aperture4/wiki_about.json` from the wiki; upload it, then `about`. Re-run both after a new
  run section.
- **Dataset groups and the archive** (v8.24, 2026-11-09): only how datasets are listed (page tree, visualizer menus),
  never the data. In `datasets.json`: a dataset's `group` and `archived`, the file's `group_order`.
  `catalog.set_dataset_group(names, group)` ("" = none), `rename_dataset_group`, `move_dataset_group`,
  `set_archived(names, True/False)`, `suggest_groups()` (2+ datasets in no group sharing a first word), `add(…, group=)`.
  Archived datasets keep their stored data and leave the visualizer's menus.
- **Cache presets** (v8.24) = **folders** (2026-11-12): named sets of quantities, `groups.set_preset(name, [names] |
  None)`, in `groups.json` ("presets"); a quantity can be in several. The page's "cache more…" switches folders on
  and off (their quantities ticked, each once); `python -m datamgr cache --preset "Gaps & voltage" Energy --runs X`
  caches the union. Folders (human-approved 2026-11-12): Drive & twist, Gaps & voltage, Duty cycle (until the duty
  cycle is defined), Pairs & photons, Energy, Charge maps.
- **Follow a running simulation** (a column's ⋯ → follow): `serve.py` runs `python -m datamgr follow` every 5 minutes;
  it starts a job for each followed dataset with new outputs (`dm.set_follow(name, ["twist_angle", …] | "stored" |
  None)`).
- **Health** of each stored quantity (a cell's tooltip and menu): outputs stored / missing, NaN fraction, size, when it
  was written, the method version. `dm.health()` records the NaN fraction of whole-run quantities stored before.
- **The whole config** goes into each manifest (`conf_all`), so config variables in the visualizer reach every
  config.toml number; `dm.refresh_conf()` does it without computing.
- **Retiring an axis:** `dm.retire("r_max_line")` shows what it takes (quantities computed again on their new axis,
  ones still on it, scripts that name it: project.json "retire_scan"); `apply=True` / `--yes` does it and removes the axis.
- **One job per dataset** at a time (2026-10-14 fix): a second job on the same dataset waits ("waiting" on the page).

## The other calls

| call | does |
|---|---|
| `dm.check(m, run, steps=None, plot=True)` | a few outputs (default 3): shape against the axes, min / max / NaN, seconds per output, size and time of caching every output; a small plot |
| `dm.save(m)` | writes `methods/<name>.py` (the code as written, plus the imports it needs) and loads it from there |
| `dm.cache(names, runs, steps=None, rewrite=False, workers="auto")` | every output (or `steps="a:b:c"`) into the visualizer store; several methods share each loaded output; `workers` processes compute the outputs ("auto": half the server's free cores and memory, at most 8; a number; 0 = all in this process) |
| `dm.status(runs=None)` | per run and quantity: outputs stored / existing, MB, up to date? |
| `dm.drop(name, run, confirm=True)` | deletes a stored quantity of one run |
| `dm.adopt(runs=None, names=None, n=3, apply=False)` | old data (recorder / notebook) that has a method of the same name: runs the method on n of its outputs and compares; with `apply=True` the matching ones get the method's version (shown up to date; an `adopted` record in the manifest says what was checked). The data is not touched; mismatches are reported and left as they are |
| `dm.methods()`, `dm.AXES`, `dm.method("name")` | what is there |

**Speed** (2026-11-12, measured in `claude_work/tasks/2026-11-12_cache-speed`). The dumps sit on the RIS storage, mounted
over the network at ~39 MB/s in total, however many processes read (1, 4, 8, 16 processes: 30, 39, 39, 39 MB/s). A
dump is 124 MB; the usual quantities need ~20 MB of it. So the cacher reads every output once: one shared pass
computes the per-output methods and fills the caches the time-axis methods declare (`warms`), and the time-axis
methods then only assemble cached numbers. Worker processes compute the outputs, at most half of the server's free cores and memory and at most 8 (human
2026-11-12: "never more than like 50% of remaining"; past ~8 the job only waits on reading) (the field-line tracing of
`along` is ~1.1 s per output) while the main process writes. Before (rcs-pairs-1-ec025, 37 quantities, 401
outputs): 1708 s, of which 455 s were four line quantities re-reading every dump and 375 s twist_energy's seven
passes.

How it is stored: per-output data of ≥ 65 536 values (maps) one file per output as float16 (like the visualizer's
maps); smaller data one float32 array for the whole run (one download for the viewer). Raw dump fields (`B1`, `E2`,
`num_e`, `stress_e00`, …: any 2D dataset in the dumps) need no method: `dm.cache("B1", ...)` copies it as it is
(version `raw:1`; a run whose dumps lack it is skipped). `python -m datamgr fields RUN` lists them.

## The data manager page

Visualizer header → **🗂 data** (`viewer/datamgr.html`, served by `serve.py`): a grid of measurements (rows, in
groups) × datasets (columns) with outputs stored, MB and state; the methods with their code; jobs with progress.
It works like a file browser (v6.2): **drag** ⠿ rows onto a group heading (ticked rows move together; the dashed
line at the bottom makes a new group), group headings to reorder groups, column headings to reorder columns;
**click a name** to rename it (dataset, group, or a measurement's shown name); **⋯ or right-click** for actions.
- a **cell**: compute (or copy, for a raw field) the missing outputs, redo, delete, open the visualizer;
- a **row**: fill in every dataset, redo, delete it in every dataset, rename, move to a group; **tick rows** to do
  that for several at once (the bar above the grid);
- a **dataset (column)**: hide (shown again from the "hidden:" bar), rename, **raw fields from its dumps…** (tick
  fields to copy them in), compute every method's missing outputs, remove (deletes its stored data, after asking);
- **+ dataset**: paste a folder, list the runs in it, tick and name the ones to add (new columns).
Changes need the token `serve.py` prints (the link it prints carries it; also in `visualizer/.serve_token`). It is
kept across restarts, so a browser needs it once. It is there because other users of the storage server can reach
the port too.

## Terminal

```
python -m datamgr list | status [--json] | check NAME RUN [--steps 50,100] | source NAME
python -m datamgr cache [NAME ...] [--preset FOLDER ...] --runs A [B ...] [--steps a:b:c] [--rewrite] [--workers auto|N]
python -m datamgr drop NAME [NAME ...] --runs A [B ...] --yes
python -m datamgr scan PATH | datasets | add-dataset NAME PATH | rename-dataset OLD NEW | remove-dataset NAME [--drop-data --yes]
python -m datamgr group NAME [NAME ...] --to GROUP | rename-group OLD NEW | move-group GROUP INDEX
python -m datamgr label NAME [TEXT]        # shown name (no TEXT = the method's own)
python -m datamgr fields RUN [--json]      # raw fields in a dataset's dumps
python -m datamgr adopt [--runs A ...] [--names N ...] [--apply]   # old data -> its method, where they agree
python -m datamgr yaxis NAME [NAME ...] --to GROUP | yunits GROUP [UNITS] | push-label NAME | sync-labels
python -m datamgr card DATASET [--notes TEXT] [--tags a,b] [--about TEXT --page P] | about [FILE]
python -m datamgr dataset-group NAME [NAME ...] --to GROUP | rename-dataset-group OLD NEW | move-dataset-group GROUP INDEX
python -m datamgr suggest-groups [--json] | archive NAME [NAME ...] [--undo] | preset NAME [QUANTITY ...] [--delete]
python -m datamgr set-follow DATASET [NAME ...] [--stored | --off] | follow
python -m datamgr health | conf | prune DATASET ... | retire AXIS [--yes]     # (--datasets A ... limits them)
```
(from the folder that holds `datamgr/`; the project and paths: project.json, or `DATAMGR_PROJECT`, `DATAMGR_STORE`,
`DATAMGR_DATA_ROOT`, …, see `config.py`)

## Files

| | |
|---|---|
| `config.py`, `project.py` | which project, its paths; loading its reader and modules |
| `reader.py` | `Reader`: the interface a project's reader implements |
| `axes.py` | `Axis`, `Alt`, the catalogue (filled by the project) |
| `registry.py` | `@register`, versions, sections, loading `methods/` |
| `check.py`, `save.py`, `cache.py`, `status.py` | the calls above |
| `store.py` | the only writer of the visualizer store (apt-vis/1, `visualizer/FORMAT.md`) |
| `runs.py` | opening runs (through the reader) |
| `catalog.py` | the dataset registry (`datasets.json`), scanning folders for runs |
| `data.py` | `dm.dataset(...)`, labelled arrays (`.sel`, `.at`, `.values`) |
| `groups.py` | groups, shown names, y-axis groups and their units (`groups.json`) |
| `manage.py` | follow, health, refresh_conf, retire, push_label, sync_labels |
| `warm.py` | the warm-spec hook (`register_warm`) |
| `tools/` | the project's tools/ folder, as `datamgr.tools` |
| `projects/aperture4/` | the owner's project: `reader.py` (DataSph), `axes.py`, `warm.py`, `methods/` (the 19 recorder recipes were ported 2026-10-07; numbers checked against the store), `tools/` (`fieldlines.along_points`, `energetics`), `groups.json`, `wiki_about.json`, `howto.txt` |

## Moving into Aperture_plotting (git)

Planned home: `Aperture_plotting/datamgr/` (git). Copy the folder there; `serve.py` and notebooks find it there
first (`import datamgr` with the library on the path). Until then it runs from `claude_work/datamgr/`.
