# data-visualizer (v15.3.0, 2026-11-20)

An interactive browser plotter for simulation output, plus a data manager that turns raw simulation dumps into the
small, fast files the plotter reads. Built for Aperture4 magnetar PIC runs; made general so others can bring their own
data (fork it and adjust).

**Guides:** [HOWTOUSE.md](HOWTOUSE.md) (by goal: see, measure, arrange) · [BRING_YOUR_DATA.md](BRING_YOUR_DATA.md) (connect your
simulation's files to the data manager, or write the store yourself) · [TOOLS.md](TOOLS.md) (every tool, also behind the viewer's **?** button) ·
[AGENTS.md](AGENTS.md) (for your AI assistant: what to suggest, where code goes).

## What is here

| Folder | What it is |
|---|---|
| `viewer/` | the plotter (open `viewer/index.html` through `serve.py`); `viewer/js/` the core, `viewer/plugins/` add-ons |
| `viewer/plugins/aperture4/` | one person's plugin: physics-specific tools for Aperture4 runs (an example to copy) |
| `datamgr/` | the data manager framework (Python): methods → stored quantities in the `apt-vis/1` format |
| `projects/` | per-data projects for the data manager: a reader for your files + your methods (`aperture4/`, `demo/`) |
| `serve.py` | a small local server: serves the viewer and the data, saves desktops, runs data-manager jobs |
| `FORMAT.md` | the store format the viewer reads (anything that writes it can be viewed) |
| `RULES.md`, `DECISIONS.md`, `CHANGELOG.md` | how the code is kept consistent, why things are as they are, release notes |
| `tools/check.mjs` | the consistency check: `node tools/check.mjs` must pass after every change |

## Quick start: the demo

```bash
python projects/demo/setup_demo.py
python serve.py 8765 --project projects/demo
```

then open http://localhost:8765/viewer/ and choose **desktops… → demo**: a synthetic rotating, decaying vortex (dataset
`vortex`, 100 outputs) shown with the tools: contours, a lineout, an exponential fit (it finds the decay time, 6), the
period tool (the rotation, about π), points and lines at a curve's max / mean, an averaged curve, steps and a band. The first command makes the run (`demo_runs/`), registers it with the data manager and computes its
quantities into `data/` (needs Python with numpy). The data manager's page: http://localhost:8765/viewer/datamgr.html .
Next: your own data, [BRING_YOUR_DATA.md](BRING_YOUR_DATA.md).

Licence: MIT (see `LICENSE`).
