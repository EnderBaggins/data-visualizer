"""Groups: how quantities are grouped in the visualizer's menus and on the data manager page.

Editable (human 2026-10-07: "ways to adjust the groupings of the quantities") and kept OUT of the methods' code, so
regrouping never makes data out of date. File: the project's groups.json (project.json "groups")
    {"order": [groups], "of": {quantity: group}, "labels": {quantity: shown name},
     "yaxis": {quantity: y-axis group}, "yunits": {y-axis group: units},       (v8.1, UI review §4.2)
     "presets": {preset: [quantity …]}}                                         (v8.24: cache presets)
Display names ("labels") work the same way: renaming a measurement only changes what is shown.
A quantity without an entry uses its method's default group (from its axes: maps, the project's sections, other).
Changing a group also updates the stored manifests (the viewer reads "section" there) and writes
<STORE>/groups.json (the order, for the viewer's menus).
"""
import json
import os

from . import config

DEFAULT_ORDER = list(config.GROUP_ORDER or ["maps", "raw fields", "other"])     # project.json "group_order"


def _path():
    return os.environ.get("DATAMGR_GROUPS", config.GROUPS_FILE)


def read():
    try:
        with open(_path(), encoding="utf-8") as f:
            g = json.load(f)
    except (OSError, ValueError):
        g = {}
    return {"order": g.get("order") or list(DEFAULT_ORDER), "of": g.get("of") or {}, "labels": g.get("labels") or {},
            "yaxis": g.get("yaxis") or {}, "yunits": g.get("yunits") or {}, "presets": g.get("presets") or {}}


def set_preset(name, names):
    """A cache preset (v8.24, human 2026-11-09): a named set of quantities cached together on a dataset in one click.
    names = None / [] deletes it."""
    name = (name or "").strip()
    if not 0 < len(name) <= 40 or any(c in name for c in "\n\r\t"):
        raise ValueError("a preset name: one line, at most 40 characters")
    g = read()
    if names:
        g["presets"][name] = sorted(set(names))
    else:
        g["presets"].pop(name, None)
    _write(g)
    return g["presets"]


def _write(g):
    p = _path()
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(g, f, indent=1, ensure_ascii=False)
    os.replace(tmp, p)
    _write_store_order(g["order"], g.get("presets"))


def _write_store_order(order, folders=None):
    """The viewer's copy (<STORE>/groups.json): the group order, and (v11.7) the folders = the cache presets, which
    section the viewer's quantity menus."""
    if folders is None:
        folders = read().get("presets") or {}
    if os.path.isdir(config.STORE):
        tmp = os.path.join(config.STORE, "groups.json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"order": order, "folders": folders}, f, ensure_ascii=False)
        os.replace(tmp, os.path.join(config.STORE, "groups.json"))


def group_of(name, default=None):
    return read()["of"].get(name, default)


def label_of(name, default=None):
    return read()["labels"].get(name, default)


def yaxis_of(name, default=None):
    return read()["yaxis"].get(name, default)


def yunits_of(group, default=None):
    return read()["yunits"].get(group, default)


def set_yaxis(names, group):
    """Draw quantities `names` in y-axis group `group` (empty: back to the code's). Nothing is recomputed."""
    names = [names] if isinstance(names, str) else list(names)
    group = (group or "").strip()
    if len(group) > 60:
        raise ValueError("a y-axis group name of at most 60 characters, please")
    g = read()
    for n in names:
        if group:
            g["yaxis"][n] = group
        else:
            g["yaxis"].pop(n, None)
    _write(g)
    _refresh_manifests(names)


def set_yunits(group, units):
    """Units of a y-axis group (used by its quantities whose code gives none). Empty: none."""
    units = (units or "").strip()
    if len(units) > 40:
        raise ValueError("units of at most 40 characters, please")
    g = read()
    if units:
        g["yunits"][group] = units
    else:
        g["yunits"].pop(group, None)
    _write(g)
    from .registry import METHODS
    _refresh_manifests([n for n, m in METHODS.items() if m.yaxis == group])


def _refresh_manifests(names):
    """Write the shown name, group, y-axis group and units of these quantities into every stored manifest."""
    from .registry import METHODS
    for key, fn in (("label", lambda m: m.display_label), ("section", lambda m: m.group), ("kind", lambda m: m.yaxis),
                    ("units", lambda m: m.units_shown)):
        for n in names:
            if n in METHODS:
                _relabel_manifests([n], fn(METHODS[n]), key=key)


def set_label(name, label):
    """Show measurement `name` as `label` (empty: back to the method's own label). Only the shown name changes."""
    label = (label or "").strip()
    if len(label) > 80:
        raise ValueError("a name of at most 80 characters, please")
    g = read()
    if label:
        g["labels"][name] = label
    else:
        g["labels"].pop(name, None)
    _write(g)
    if not label:
        from .registry import METHODS
        label = METHODS[name].label if name in METHODS else name
    _relabel_manifests([name], label, key="label")


def _relabel_manifests(names, group, key="section"):
    """Set "section" (or another key) of these quantities in every stored dataset (the viewer follows)."""
    from .catalog import stored
    from .store import _atomic_write_json, manifest_lock, read_manifest
    for ds in stored():
        with manifest_lock(ds):                         # one read-modify-write at a time (2026-10-14)
            m = read_manifest(config.STORE, ds)
            if not m:
                continue
            hit = [n for n in names if n in m["quantities"]]
            for n in hit:
                m["quantities"][n][key] = group
            if hit:
                _atomic_write_json(os.path.join(config.STORE, ds, "manifest.json"), m)


def set_group(names, group):
    """Put quantities `names` (one or a list) in `group` (created if new, at the end of the order)."""
    names = [names] if isinstance(names, str) else list(names)
    group = (group or "").strip()
    if not group or len(group) > 40:
        raise ValueError("a group name of 1-40 characters, please")
    g = read()
    for n in names:
        g["of"][n] = group
    if group not in g["order"]:
        g["order"].append(group)
    _write(g)
    _relabel_manifests(names, group)


def rename_group(old, new):
    new = (new or "").strip()
    if not new or len(new) > 40:
        raise ValueError("a group name of 1-40 characters, please")
    from .registry import METHODS
    g = read()
    names = [n for n, x in g["of"].items() if x == old] + [n for n, m in METHODS.items() if n not in g["of"] and m.section == old]
    for n in names:
        g["of"][n] = new
    g["order"] = [new if x == old else x for x in g["order"]]
    if new not in g["order"]:
        g["order"].append(new)
    _write(g)
    _relabel_manifests(names, new)


def move_group(group, to_index):
    """Reorder: put `group` at position to_index."""
    g = read()
    if group in g["order"]:
        g["order"].remove(group)
    g["order"].insert(max(0, min(len(g["order"]), int(to_index))), group)
    _write(g)
