"""Datasets: the columns of the data manager — a name, and where its data comes from.

Registry: <STORE>/datasets.json
    {"format": "apt-vis-datasets/1", "datasets": {name: {"path", "kind", "added", "note", "notes", "tags", "about", "page",
                                                         "follow"}}}
notes / tags: the dataset's card (v8.1, UI review §4.8); about / page: what the run is and where it is described
(free text; a page name or link), copied from the project's about file by `python -m datamgr about` (v8.19); follow:
quantities computed automatically when new outputs of a running simulation appear (list of names, or "stored" =
everything stored for it; §4.6).
kind "simulation" = a run folder the project's reader opens: methods can compute from it.
kind "derived"    = data made another way (e.g. the Carlqvist model sets): stored only, nothing to compute.
A dataset's stored data is <STORE>/<name>/ whatever its folder is called on disk, so two runs with the same folder
name can live side by side under different names. Datasets already in the store are listed automatically (from
their manifest's "source"); the file is written only when one is added, renamed or removed.
"""
import datetime
import json
import os
import re
import shutil

from . import config
from .project import reader_class

FORMAT = "apt-vis-datasets/1"
NAME = re.compile(r"^\w[\w.-]{0,80}$")


def _path():
    return os.path.join(config.STORE, "datasets.json")


def _atomic_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)


def _read():
    try:
        with open(_path()) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"format": FORMAT, "datasets": {}}


def is_run(path):
    """A run folder the project's reader can open."""
    if not path or not os.path.isdir(path):
        return False
    return bool(reader_class().is_run(path))


def n_outputs(path):
    """How many outputs a run folder has (the reader counts them), None if the folder can't be listed. No path at all
    (derived data) counts 0, as before the split (os.listdir(None) listed the working folder, which has no dumps)."""
    if path is None:
        return 0
    if not path:
        return None
    return reader_class().n_outputs(path)


def stored():
    """Dataset names with a folder in the store (data/index.json)."""
    try:
        with open(os.path.join(config.STORE, "index.json")) as f:
            return json.load(f).get("runs", [])
    except (OSError, ValueError):
        return []


def registry():
    """name -> {path, kind, added, note}: the file's entries plus datasets found in the store (not written)."""
    reg = dict(_read().get("datasets", {}))
    for name in stored():
        if name in reg:
            continue
        src = ""
        try:
            with open(os.path.join(config.STORE, name, "manifest.json")) as f:
                src = json.load(f).get("source", "") or ""
        except (OSError, ValueError):
            pass
        sim = bool(src) and os.path.isabs(src) and is_run(src)
        reg[name] = {"path": src if sim else None, "kind": "simulation" if sim else "derived",
                     "added": None, "note": "" if sim else src}
    return reg


def path_of(name):
    """The run folder of a dataset (None for derived data). Unknown names fall back to DATA_ROOT/<name>."""
    d = registry().get(name)
    if d:
        return d.get("path")
    if not config.DATA_ROOT:
        return None
    p = os.path.join(config.DATA_ROOT, name)
    return p if is_run(p) else None


def name_of(path):
    """The registered name of a run folder (its folder name if it is not registered)."""
    p = os.path.normpath(path)
    for n, d in registry().items():
        if d.get("path") and os.path.normpath(d["path"]) == p:
            return n
    return os.path.basename(p)


def scan(path):
    """Runs at or directly under `path`: [{name, path, outputs, registered_as}]."""
    p = os.path.normpath(os.path.expanduser(path))
    if not os.path.isdir(p):
        raise FileNotFoundError(f"no folder {p}")
    found = [p] if is_run(p) else []
    try:
        found += [e.path for e in sorted(os.scandir(p), key=lambda e: e.name) if e.is_dir() and is_run(e.path)]
    except OSError as e:
        raise FileNotFoundError(f"cannot list {p}: {e}")
    reg = {os.path.normpath(d["path"]): n for n, d in registry().items() if d.get("path")}
    return [{"name": os.path.basename(f), "path": f, "outputs": n_outputs(f), "registered_as": reg.get(os.path.normpath(f))}
            for f in found]


def _save(reg, order=None):
    """Write the registry (keeping the file's other keys, e.g. the dataset-group order); order: a new group order."""
    d = _read()
    d["format"], d["datasets"] = FORMAT, reg
    if order is not None:
        d["group_order"] = order
    _atomic_json(_path(), d)


def add(name, path=None, kind="simulation", note="", group=""):
    """Register a dataset (a column). A simulation needs a run folder; a derived one may have no path. group: the
    dataset group it goes in (v8.24)."""
    if not NAME.match(name or ""):
        raise ValueError(f"'{name}': a dataset name is letters, digits, _ . - (starting with a letter or digit)")
    reg = registry()
    if kind == "simulation":
        if not is_run(path):
            raise ValueError(f"{path} {reader_class().not_a_run}")
        path = os.path.normpath(path)
    if name in reg and (reg[name].get("path") or None) != (path or None):
        raise ValueError(f"there is already a dataset '{name}' ({reg[name].get('path') or reg[name].get('note')})")
    reg[name] = {"path": path, "kind": kind, "added": datetime.date.today().isoformat(), "note": note}
    _save(reg)
    if group:
        set_dataset_group([name], group)
    return reg[name]


def rename(old, new):
    """Rename a dataset; its stored data moves with it."""
    reg = registry()
    if old not in reg:
        raise KeyError(f"no dataset '{old}'")
    if not NAME.match(new or "") or new in reg:
        raise ValueError(f"'{new}' is not a free dataset name")
    src, dst = os.path.join(config.STORE, old), os.path.join(config.STORE, new)
    from .store import dataset_lock
    with dataset_lock(old, wait=False):                 # not while a job writes it (2026-10-14)
        if os.path.isdir(src):
            os.rename(src, dst)
            mp = os.path.join(dst, "manifest.json")
            with open(mp) as f:
                m = json.load(f)
            m["run"] = new
            _atomic_json(mp, m)
            _index_replace(old, new)
    d = reg.pop(old)
    d["renamed_from"] = sorted(set(d.get("renamed_from", [])) | {old})     # v8.23: desktops that still say `old` follow
    reg[new] = d
    _save(reg)


def set_card(name, notes=None, tags=None, about=None, page=None):
    """A dataset's card: free notes and tags (e.g. no-pairs, cooling); about / page: what the run is and where it is
    described (free text, a page name or a link; v8.19, set by `about`). None leaves a field as it is."""
    reg = registry()
    if name not in reg:
        raise KeyError(f"no dataset '{name}'")
    d = dict(reg[name])
    for k, v in (("about", about), ("page", page)):
        if v is not None:
            if len(v) > 600:
                raise ValueError(f"{k} of at most 600 characters, please")
            d[k] = v.strip()
    if notes is not None:
        if len(notes) > 2000:
            raise ValueError("notes of at most 2000 characters, please")
        d["notes"] = notes.strip()
    if tags is not None:
        tl = [t.strip() for t in (tags.split(",") if isinstance(tags, str) else tags) if t.strip()]
        if any(len(t) > 30 for t in tl) or len(tl) > 12:
            raise ValueError("at most 12 tags of at most 30 characters")
        d["tags"] = sorted(set(tl), key=tl.index)
    reg[name] = d
    _save(reg)
    return d


ABOUT = config.ABOUT_FILE                               # the project's about file (project.json "about"), or None


def set_about(path=None):
    """Every dataset's card gets what the about file says it is (v8.19, human 2026-11-03: "when I hover over dataset it
    says whats what"). path (default: the project's about file): {run: {"about", "page"}}; the aperture4 project's is
    written on the local machine from the wiki's run sections by claude_work/tools/wiki_about.py. Returns (datasets
    set, datasets the file does not describe)."""
    path = path or ABOUT
    if not path:
        raise ValueError("no about file: name one (python -m datamgr about FILE) or set \"about\" in project.json")
    with open(path, encoding="utf-8") as f:
        about = json.load(f)
    reg, done, missing = registry(), [], []
    for name in sorted(reg):
        a = about.get(name)
        if not a:
            missing.append(name)
            continue
        d = dict(reg[name])
        d["about"], d["page"] = a["about"].strip()[:600], a.get("page", "")
        reg[name] = d
        done.append(name)
    _save(reg)
    return done, missing


# ---- dataset groups and the archive (v8.24, human 2026-11-09: "I like the collapsible dataset groups … to improve my
# choosing of datasets on a new desktop"; "I or AI forms groups so can make name then"). Only how datasets are listed:
# a group is a dataset's "group", the order the file's "group_order"; "archived" datasets stay stored but leave the
# visualizer's menus. ---------------------------------------------------------------------------------------------
GROUP_OK = re.compile(r"^[^\n\r\t]{1,40}$")


def dataset_groups():
    """{"order": [group …], "of": {dataset: group}, "archived": [dataset …]}."""
    reg, saved = registry(), _read().get("group_order", [])
    of = {n: d["group"] for n, d in reg.items() if d.get("group")}
    used = set(of.values())
    order = [g for g in saved if g in used] + sorted(used - set(saved))
    return {"order": order, "of": of, "archived": sorted(n for n, d in reg.items() if d.get("archived"))}


def set_dataset_group(names, group):
    """Datasets `names` go into `group` (a new group is added at the end of the order); "" = no group."""
    group = (group or "").strip()
    if group and not GROUP_OK.match(group):
        raise ValueError("a group name: one line, at most 40 characters")
    reg = registry()
    missing = [n for n in names if n not in reg]
    if missing:
        raise KeyError(f"no dataset {', '.join(missing)}")
    for n in names:
        d = dict(reg[n])
        if group:
            d["group"] = group
        else:
            d.pop("group", None)
        reg[n] = d
    used = {d.get("group") for d in reg.values()}                  # (a group left empty drops out of the order)
    order = [g for g in dataset_groups()["order"] if g in used]
    _save(reg, order + ([group] if group and group not in order else []))


def rename_dataset_group(old, new):
    new = (new or "").strip()
    if not GROUP_OK.match(new):
        raise ValueError("a group name: one line, at most 40 characters")
    reg = registry()
    if not any(d.get("group") == old for d in reg.values()):
        raise KeyError(f"no dataset group '{old}'")
    for n, d in reg.items():
        if d.get("group") == old:
            reg[n] = {**d, "group": new}
    order = [new if g == old else g for g in dataset_groups()["order"]]
    _save(reg, list(dict.fromkeys(order)))


def move_dataset_group(group, index):
    order = [g for g in dataset_groups()["order"] if g != group]
    order.insert(max(0, min(int(index), len(order))), group)
    _save(registry(), order)


def set_archived(names, archived=True):
    """Archive datasets (stored data kept; the visualizer's menus leave them out) or bring them back."""
    reg = registry()
    missing = [n for n in names if n not in reg]
    if missing:
        raise KeyError(f"no dataset {', '.join(missing)}")
    for n in names:
        d = dict(reg[n])
        if archived:
            d["archived"] = True
        else:
            d.pop("archived", None)
        reg[n] = d
    _save(reg)


def suggest_groups():
    """Groups from the names, for the datasets in no group yet: {group: [datasets]} where 2+ share their first word
    (rcs-*, replicate_2017_*, b06-*; "no-pair" counts as one word). Nothing is written."""
    reg = registry()
    def word(n):
        w = re.split(r"[-_]", n)
        return "-".join(w[:2]) if w[0] == "no" and len(w) > 1 else w[0]
    out = {}
    for n in sorted(reg):
        if not reg[n].get("group"):
            out.setdefault(word(n), []).append(n)
    return {g: ns for g, ns in out.items() if len(ns) > 1}


def set_follow(name, names):
    """Follow a running simulation: compute `names` (a list, "stored" = whatever is stored for it, or None = stop)
    for its new outputs as they appear (serve.py checks every few minutes)."""
    reg = registry()
    if name not in reg:
        raise KeyError(f"no dataset '{name}'")
    if names and reg[name].get("kind") != "simulation":
        raise ValueError(f"{name} is derived data: there are no new outputs to follow")
    d = dict(reg[name])
    if names:
        d["follow"] = "stored" if names == "stored" else sorted(set(names))
    else:
        d.pop("follow", None)
    reg[name] = d
    _save(reg)
    return d


def remove(name, drop_data=False):
    """Forget a dataset (a column). drop_data=True also deletes everything stored for it."""
    reg = registry()
    if name not in reg:
        raise KeyError(f"no dataset '{name}'")
    d = os.path.join(config.STORE, name)
    if os.path.isdir(d):
        if not drop_data:
            raise ValueError(f"'{name}' has stored data: remove it with drop_data=True (deletes {d})")
        from .store import dataset_lock
        with dataset_lock(name, wait=False):
            shutil.rmtree(d)
        _index_replace(name, None)
    reg.pop(name)
    _save(reg)


def _index_replace(old, new):
    from .store import manifest_lock
    with manifest_lock("_index"):
        _index_replace_locked(old, new)


def _index_replace_locked(old, new):
    p = os.path.join(config.STORE, "index.json")
    try:
        with open(p) as f:
            idx = json.load(f)
    except (OSError, ValueError):
        return
    runs = [r for r in idx.get("runs", []) if r != old] + ([new] if new else [])
    idx["runs"] = sorted(set(runs))
    _atomic_json(p, idx)


def dump_fields(path):
    """Every field name in the run's outputs, as the reader lists them (v11.4, 2026-11-12: the viewer offers a method
    only where the dumps have what it needs). Remembered in <jobs>/dump_fields.json per run folder (the dumps of one run
    all have the same fields), so the status needs no dump opened after the first time. None: no dumps (yet)."""
    if not path or not os.path.isdir(path):
        return None
    from . import config
    memo_path = os.path.join(config.JOBS, "dump_fields.json")
    try:
        with open(memo_path) as f:
            memo = json.load(f)
    except (OSError, ValueError):
        memo = {}
    if path in memo:
        return memo[path]
    keys = reader_class().field_names(path)
    if keys is None:                                        # no outputs yet, or unreadable now: next time
        return None
    keys = sorted(keys)
    memo[path] = keys
    os.makedirs(config.JOBS, exist_ok=True)
    tmp = f"{memo_path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(memo, f)
    os.replace(tmp, memo_path)
    return keys


def fields(name):
    """The maps in a simulation's outputs: raw fields that can be copied into the store (not computed)."""
    p = path_of(name)
    if not p:
        return []
    return reader_class().map_fields(p)
