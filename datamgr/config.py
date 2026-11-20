"""Where things are: the project (your reader, methods, axes …) and its paths. No machine's paths are built in here.

The project is a folder with a project.json (e.g. projects/aperture4/):
  1. DATAMGR_PROJECT: a project folder, or a project's .json file;
  2. else the one folder under <the folder holding this package>/projects/ that has a project.json (several: the one
     named in projects/default).
Without a project the framework still reads a store (status, the page), but it cannot open runs.

project.json (paths relative to the project folder; "~" works):
  {"name": "aperture4",                       shown on the page
   "dir": ".",                                 the project folder, if this file lives elsewhere (e.g. a test config)
   "reader": "reader.py:Aperture4Reader",      the class that reads your runs (a datamgr.Reader)
   "modules": ["axes.py", "warm.py"],          loaded before the methods (axis catalogue, sections, warm specs)
   "methods": "methods",  "tools": "tools",    saved methods; building blocks (import them as datamgr.tools.<file>)
   "groups": "groups.json", "about": "wiki_about.json",
   "store": "...", "jobs": "...", "data_root": "...",   the visualizer store, job progress files, where runs are
   "import_paths": ["..."],                     added to sys.path (libraries your reader and methods import)
   "viewer": "http://localhost:8765/viewer/",
   "group_order": [...],                        default order of the groups (sections) in menus
   "retire_scan": {"root": "...", "dirs": [...]},   scripts listed by `retire` when they name an axis
   "page": {...}}                               the data manager page's words (title, how-to, axis badges)
Every path can still be overridden with an environment variable (e.g. a test store): DATAMGR_STORE, DATAMGR_JOBS,
DATAMGR_METHODS, DATAMGR_DATA_ROOT, DATAMGR_VIEWER, DATAMGR_GROUPS.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                         # the folder holding the package (and, by default, projects/)


def _find_project():
    """(project.json path, project folder) or (None, None)."""
    p = os.environ.get("DATAMGR_PROJECT")
    if p:
        p = os.path.abspath(os.path.expanduser(p))
        f = p if os.path.isfile(p) else os.path.join(p, "project.json")
        if not os.path.isfile(f):
            raise FileNotFoundError(f"DATAMGR_PROJECT={p}: no project.json there")
        return f, os.path.dirname(f)
    base = os.path.join(ROOT, "projects")
    try:
        found = sorted(os.path.join(base, d, "project.json") for d in os.listdir(base)
                       if os.path.isfile(os.path.join(base, d, "project.json")))
    except OSError:
        found = []
    if len(found) == 1:
        return found[0], os.path.dirname(found[0])
    if len(found) > 1:
        try:                                         # projects/default: one line, the project's folder name
            with open(os.path.join(base, "default"), encoding="utf-8") as f:
                name = f.read().strip()
        except OSError:
            name = ""
        pick = os.path.join(base, name, "project.json") if name else None
        if pick and os.path.isfile(pick):
            return pick, os.path.dirname(pick)
        raise RuntimeError(f"several projects in {base} ({', '.join(os.path.basename(os.path.dirname(f)) for f in found)}): "
                           "set DATAMGR_PROJECT to one of them, or name one in projects/default")
    return None, None


PROJECT_FILE, _cfg_dir = _find_project()
if PROJECT_FILE:
    with open(PROJECT_FILE, encoding="utf-8") as _f:
        P = json.load(_f)
else:
    P = {}
PROJECT_DIR = os.path.normpath(os.path.join(_cfg_dir, os.path.expanduser(P.get("dir", ".")))) if _cfg_dir else None
NAME = P.get("name") or (os.path.basename(PROJECT_DIR) if PROJECT_DIR else "")


def _path(key, default=None):
    """A path from project.json (relative to the project folder), or `default`."""
    v = P.get(key)
    if not v:
        return default
    v = os.path.expanduser(v)
    return v if os.path.isabs(v) or not PROJECT_DIR else os.path.normpath(os.path.join(PROJECT_DIR, v))


def _in_project(name):
    return os.path.join(PROJECT_DIR, name) if PROJECT_DIR else None


# where runs are (scan / add start here; a dataset name that is not registered is looked for here)
DATA_ROOT = os.environ.get("DATAMGR_DATA_ROOT", _path("data_root", ""))
# the visualizer's data store (apt-vis/1, see visualizer/FORMAT.md)
STORE = os.environ.get("DATAMGR_STORE", _path("store", os.path.join(ROOT, "data")))
# progress files of cache jobs (the data manager page reads them), locks, the dump-field memo
JOBS = os.environ.get("DATAMGR_JOBS", _path("jobs", os.path.join(ROOT, "datamgr_jobs")))
# saved methods: one file per method
METHODS_DIR = os.environ.get("DATAMGR_METHODS", _path("methods", _in_project("methods") or os.path.join(ROOT, "methods")))
# building blocks the methods share: datamgr.tools.<name> is <tools>/<name>.py
TOOLS_DIRS = [d for d in [_path("tools", _in_project("tools"))] if d]
# groups, shown names, y-axis groups, folders (groups.py)
GROUPS_FILE = _path("groups", _in_project("groups.json") or os.path.join(ROOT, "groups.json"))
# what each dataset is: {dataset: {"about", "page"}} for `python -m datamgr about` (catalog.set_about)
ABOUT_FILE = _path("about", None)
# the viewer, for links printed by show()
VIEWER_URL = os.environ.get("DATAMGR_VIEWER", P.get("viewer", "http://localhost:8765/viewer/"))
# the reader class ("file.py:Class" in the project folder) and the project modules loaded before the methods
READER = P.get("reader")
MODULES = list(P.get("modules") or [])
# default group order (a groups.json without "order"); the page's words; retire's script scan
GROUP_ORDER = P.get("group_order")
PAGE = P.get("page") or {}
RETIRE_SCAN = P.get("retire_scan") or {}

# per-output data at least this big (values per step) is stored one file per step (float16, like the maps);
# smaller data is kept as one array for the whole run (float32), which the viewer reads in one request
PER_STEP_MIN_VALUES = 65536

# libraries the project's reader and methods import (appended to sys.path, in order, if they exist)
for _p in P.get("import_paths") or []:
    _p = os.path.expanduser(_p)
    _p = _p if os.path.isabs(_p) or not PROJECT_DIR else os.path.normpath(os.path.join(PROJECT_DIR, _p))
    if os.path.isdir(_p) and _p not in sys.path:
        sys.path.append(_p)
