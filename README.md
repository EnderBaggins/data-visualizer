# data-visualizer (v15.2.0, 2026-11-20)

An interactive browser plotter for simulation output, plus a data manager that turns raw simulation dumps into the
small, fast files the plotter reads. Built for Aperture4 magnetar PIC runs; made general so others can bring their own
data (fork it and adjust).

**Status:** first upload. A full guide (how to use it, how to bring your own data, a demo dataset) comes next.

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

## Quick start (until the guide lands)

```bash
python serve.py 8765 --project projects/demo
```

then open http://localhost:8765/viewer/ . The data manager's page is http://localhost:8765/viewer/datamgr.html .

Licence: MIT (see `LICENSE`).
