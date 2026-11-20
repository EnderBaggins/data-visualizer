# visualizer data format — `apt-vis/1`

The contract between the **data manager** (Python, writes: `claude_work/datamgr/`, since 2026-10-07; the older
`recorder/` wrote the first datasets) and the **viewer** (browser, reads). Neither side knows about the other beyond
this file. Anything that writes this layout can be viewed.

**What is stored and what the browser computes** (the rule, decided by the human 2026-11-13, DECISIONS D11 / RULES P8):
- **The data manager stores** a quantity only if it reads the raw dumps, needs a full pass over every output that the
  browser can't afford (tracing field lines, line or volume integrals), or is a point-by-point map viewed so often that
  storing it beats downloading its inputs every frame.
- **The browser computes, and nothing stores,** everything made from stored quantities: ratios, d/dt and slopes,
  smoothing, slopes and sums across lines, readings, fits, periods. These never go stale when their inputs change.
- Every new stored quantity says which of the three reasons it meets.

Server home: `/data/personal/Nicholas_Rackers/visualizer/` (human-approved 2026-10-01).

```
visualizer/
  FORMAT.md             this file
  (claude_work/datamgr/  the data manager framework; claude_work/projects/aperture4/ its project: the reader, methods/ =
   one file per stored quantity (v15.2, D21); its page: viewer/datamgr.html)
  record.yml, recorder/ the older recorder (first datasets; new quantities come from the data manager)
  viewer/index.html     the viewer (+ viewer/*.js)
  data/
    index.json          {"format": "apt-vis/1", "runs": ["baseline-19", ...]}
    <run>/
      manifest.json     everything about this run's stored quantities
      <quantity>/       binary arrays (see Layouts)
```

## Words (v8.1, 2026-10-14: one word per thing in the viewer, the data manager and here)

| word | means | field in this format |
|---|---|---|
| dataset | a simulation (or derived data) | `<run>/` folder, `index.json` `runs` |
| quantity | what is stored and plotted | an entry of `quantities` |
| y-axis group | what shares a y axis (and can be drawn together) | the entry's `kind` (a method's `quantity=`, or the group set on the data manager page) |
| group | how quantities are listed in menus | the entry's `section` |
| view | the part of a plot shown (pan / zoom) | (viewer settings only) |

Entries written by the data manager also carry `made` (when last written), `nan_frac` (whole / static) or `nanf`
(per output, aligned with `steps`); a run manifest carries `conf_all` (every config.toml number) beside `conf`.

## 1. A stored quantity = an array with named dims

Every quantity is an N-dimensional array with an ordered list of **dims**. Each dim name refers
to a **coordinate** in the run manifest (its values, label, units). The special dim `time` is the
output axis: values come from the quantity's own `steps` list. Any number of dims is allowed;
the viewer decides per panel which dims go on x / y / series / frame / pick.

## 2. `data/<run>/manifest.json`

```jsonc
{
  "format": "apt-vis/1",
  "run": "baseline-19",
  "source": "/data/RIS/.../baseline-19",        // data directory
  "updated": "2026-10-01T15:00:00",
  "conf": {"Bp": 1000.0, "dt": 0.001, ...},     // small subset of config.toml
  "steps": [0, 1, 2, ...],                      // fld steps recorded by any quantity (sorted)
  "times": [0.0, 1.0, 2.0, ...],                // simulation time of each entry of "steps"
  "coords": {
    "r":     {"values": [...], "label": "r", "units": "R_*", "scale": "log"},
    "theta": {"values": [...], "label": "θ", "units": "rad"},
    "r_max": {"values": [...], "label": "r_max", "units": "R_*", "scale": "log",
              "alt": {"theta_foot": {"values": [...], "label": "θ_foot", "units": "deg"}}}
  },
  "geometry": {"spherical": {"r": "r", "theta": "theta"}},   // (theta, r) pairs can be drawn in the x-z plane
  "quantities": {
    "B3": {
      "dims": ["time", "theta", "r"],
      "layout": "per_step",                      // one file per step
      "dtype": "float16",
      "path": "B3/{step:05d}.bin",
      "steps":  [0, 1, ...],                     // steps present (ascending)
      "scales": [0.0012, ...],                   // per step: physical = stored * scale
      "stats":  {"min": [...], "max": [...], "minpos": [...]},   // per step, physical units; minpos = smallest nonzero |value|
      "label": "B_φ", "units": "", "recipe": "field:B3", "version": 1, "description": "..."
    },
    "line_current": {
      "dims": ["time", "r_max"],
      "layout": "whole",                         // one file, whole array
      "dtype": "float32",
      "path": "line_current/data.bin",
      "steps": [0, 1, ...],                      // length of the time dim
      "stats": {"min": [...], "max": [...], "minpos": [...]},     // per step
      "label": "r sinθ B_φ", ...
    }
  },
  "expressions": {                               // defaults offered by the viewer (editable there)
    "Bphi_over_B": {"expr": "B3 / sqrt(B1^2 + B2^2 + B3^2)", "label": "B_φ/B"}
  }
}
```

## 3. Layouts (binary files)

All binaries are raw little-endian, **C order (last dim fastest)**, no header.

| layout | file(s) | shape inside the file | dtype |
|---|---|---|---|
| `per_step` | one per step: `path` with `{step:05d}` filled | the dims **after** `time` | `float16` (scaled) or `float32` |
| `whole` | one: `path` | all dims, `time` first if present | `float32` |
| `static` | one: `path` | all dims (no `time`) | `float32` |

- **float16 scaling:** stored = value / scale, with scale = max\|value\| / 32768 per step, so the
  largest value sits near 2^15 and float16's normal range covers about 8.7 decades below it at full
  11-bit precision. Physical value = stored × `scales[i]`. NaN = missing / masked.
- **Appending:** the recorder writes binaries first and the manifest last (atomic rename), so a
  reader never sees a manifest entry whose file is missing. New steps only append to `steps`.

## 4. Expressions (viewer side)

`name = expr  # label [y-axis group | units]` over quantities of the same run **with identical dims**, plus the
coordinates of those dims as variables (e.g. `r`, `theta`) and `Bp`, `pi`. Operators `+ - * / ^`, functions
`sqrt abs log log10 exp sin cos tan sign min max`. Evaluated point by point per frame; costs no storage. The `[ ]` part
is optional (v14.6): the y-axis group it is drawn in (it then shares a y axis with stored quantities of that group) and
its units. A point-by-point map viewed very often may be stored under the same name (the rule's third reason).

**Across lines** (v14.6, viewer side): from a stored quantity over (time, r_max) the browser makes, at every time, the
slope across lines at a chosen line (d/dΨ, Ψ = Bp / r_max, or d/dr_max) or a sum over lines (∫ Q dr_max, ∫ Q₁ dQ₂, mean,
max). Nothing is stored.

## 5. Storing (what gets stored)

- **The data manager** (`claude_work/datamgr/README.md`; since v15.2 the methods are in `claude_work/projects/<project>/methods/`): a method per stored quantity (`@dm.register`, one file in
  `methods/`), `dm.cache(...)` or the data manager page computes only outputs not stored yet (append; safe on running
  runs). Retired methods go to `claude_work/archive/` (2026-11-13: the stored twist / energy rates and untwist times,
  now made in the browser).
- **The older recorder** (`record.yml`, `recorder/`) wrote the first datasets; its quantities were ported to the data
  manager on 2026-10-07.

Version history: `apt-vis/1` (2026-10-01) first version.
