# Bring your own data

The viewer draws whatever is stored in the **`apt-vis/1` store** (`FORMAT.md`): a folder of datasets, each with a
`manifest.json` and binary arrays. You get your data there in one of two ways:

| Way | When | Work |
|---|---|---|
| **A. A data-manager project** (recommended) | your simulation writes one file (or folder) per output | a *reader* class for your files + one small Python *method* per quantity you want to see |
| **B. Write the store yourself** | you already have arrays in Python and just want to look | follow `FORMAT.md` (a manifest + `.bin` files) |

Way A gives you the data manager's page (compute buttons per dataset × quantity), caching, versioning (a changed method
recomputes, an unchanged one never does) and readable names in the viewer's menus.

---

## A. A data-manager project, step by step

A project is a folder `projects/<yourname>/`. Start by copying `projects/demo/` (a working example: a folder of
`out.NNNNN.npz` files, a 2D flow on a y × x grid).

```
projects/mydata/
  project.json     which reader, which extra modules, where methods / store live
  reader.py        how to find runs, list outputs, load one, describe the grid
  axes.py          (optional) names / labels of extra axes your methods use
  methods/         one .py file per stored quantity (or family)
```

### 1. The reader (`reader.py`)

Subclass `datamgr.reader.Reader` (see `datamgr/reader.py` for every hook and its default). The demo's
`NpzReader` is ~80 lines; what you must provide:

| Hook | Returns |
|---|---|
| `is_run(path)` (class method) | is this folder one run? |
| `n_outputs(path)`, `field_names(path)` | how many outputs; the raw fields in them |
| `open(path)` | a reader for that run (`cls(path)`) |
| `steps()` | the output numbers, e.g. `[0, 1, 2, …]` |
| `time_of(step)` | the time of an output (in `time_units`) |
| `load(step)` | load that output; return the object your methods get as `data` (the demo returns itself, with the arrays as attributes: `data.vx`) |
| `grid()` | `{"coords": {"y": {"values", "label", "units"}, "x": {…}}}` — the grid axes named in `grid_axes` |
| `metadata()` | `{"conf": {...}}` — numbers from your run's settings (usable in the viewer's expressions and as variables) |

Set the class attributes `grid_axes` (e.g. `("y", "x")`), `time_units`, and the words the page shows (`runs_word`,
`not_a_run`).

### 2. The project file (`project.json`)

```json
{ "name": "mydata", "reader": "reader.py:MyReader", "modules": ["axes.py"], "methods": "methods",
  "store": "/path/to/store", "data_root": "/path/to/my/runs" }
```

`store` is where the stored quantities go (the viewer reads it); `data_root` where the data manager looks for runs.
Leave them out and they default to `data/` and `datamgr_jobs/` next to the `datamgr` package. Point the data manager at
your project with `DATAMGR_PROJECT=projects/mydata` (or `serve.py --project projects/mydata`); with only one project
under `projects/` it is found by itself.

### 3. Methods (`methods/*.py`)

A method computes one quantity from one loaded output:

```python
import numpy as np
import datamgr as dm

@dm.register(axes=("y", "x"), label="|v|", yaxis="speed", units="m/s", needs=("vx", "vy"))
def speed(data):
    return np.hypot(data.vx, data.vy)          # an array over the axes: here a map

@dm.register(axes=(), label="max |v|", yaxis="speed", units="m/s", needs=("vx", "vy"))
def speed_max(data):
    return np.nanmax(np.hypot(data.vx, data.vy))   # one number per output: a line over time
```

- `axes` = the quantity's dims besides time. `()` = one number per output; your grid axes = a map; other axes need a
  name and values in `axes.py`.
- `yaxis` = the y-axis group: quantities of one group share a y axis in the viewer.
- Try it first, then save and cache:

```python
import datamgr as dm
dm.check(speed, "myrun")          # a few outputs, shape / NaN / timing / cost; a quick plot
dm.save(speed)                    # writes methods/speed.py
dm.cache("speed", "myrun")        # every output into the store
```

or from the data manager's page (`viewer/datamgr.html`: datasets as columns, quantities as rows, click to compute).

**What to store and what not** (`RULES.md` P8): store what needs the raw files or a full pass over every output, or a
map viewed very often. Anything you can make from stored quantities (ratios, d/dt, slopes, fits, periods, readings) is
computed in the viewer and never stored.

### 4. Look at it

```bash
python serve.py 8765 --project projects/mydata
```

Open `http://localhost:8765/viewer/`: your datasets are in the dataset menus, your quantities in the quantity menus.

---

## B. Writing the store yourself

`FORMAT.md` is the contract. The smallest dataset that shows a map and a line:

- `data/index.json`: `{"format": "apt-vis/1", "runs": ["myrun"]}`
- `data/myrun/manifest.json`: `steps` and `times` (one per output), `coords` (`{"x": {"values": [...]}, "y": {...}}`),
  and `quantities`, e.g. a map `rho: {dims: ["time", "y", "x"], layout: "per_step", dtype: "float32",
  path: "rho/{step:05d}.bin", steps: [...], scales: [1, 1, …]}` and a line `energy: {dims: ["time"], layout: "whole",
  dtype: "float32", path: "energy/data.bin", steps: [...]}`.
- the `.bin` files: raw little-endian arrays in that layout.

---

## Special data needs a viewer plugin

Plain maps, lines and profiles need nothing more. If your data has its own geometry or meaning (Aperture4's data along
traced field lines, for example), the viewer learns it from a plugin: see `viewer/plugins/README.md`, and
`viewer/plugins/aperture4/` for a complete one.
