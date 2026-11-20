"""dm.status: what is stored for the visualizer, per run and quantity, and whether it is up to date."""
import json
import os

from . import config
from .registry import FIELD_LABELS, LOAD_ERRORS, METHODS, Family, method
from .catalog import n_outputs as count_outputs, dump_fields
from .catalog import dataset_groups, registry
from .groups import read as read_groups
from .store import quantity_bytes, read_manifest


def store_runs():
    p = os.path.join(config.STORE, "index.json")
    try:
        with open(p) as f:
            return json.load(f).get("runs", [])
    except OSError:
        return []


def _state(name, q):
    v = q.get("version")
    if v == "raw:1" or str(q.get("recipe", "")).startswith("field:"):
        return "raw field (copied from the dumps)"
    try:
        m = method(name)
    except KeyError:
        return "no method (notebook / old recorder)" if name not in FIELD_LABELS else "raw field"
    if v == m.fingerprint:
        return "up to date"
    if not str(v).startswith("dm:"):
        return "made before the data manager (kept)"
    return "out of date (method changed)"


def _once(memo, key, fn):
    """fn() once per status call (v8.24: each run folder was listed and each manifest read twice)."""
    if key not in memo:
        memo[key] = fn()
    return memo[key]


def rows(runs=None, memo=None):
    out, memo = [], {} if memo is None else memo
    reg = registry()
    for run in runs or store_runs():
        man = _once(memo, ("man", run), lambda: read_manifest(config.STORE, run))
        if not man:
            continue
        path = (reg.get(run) or {}).get("path")
        avail = _once(memo, ("out", path), lambda: count_outputs(path))
        derived = (reg.get(run) or {}).get("kind") == "derived"
        for name, q in sorted(man["quantities"].items()):
            raw = q.get("version") == "raw:1" or str(q.get("recipe", "")).startswith("field:")
            nanf = [x for x in (q.get("nanf") or []) if x is not None]
            nan = q.get("nan_frac", round(sum(nanf) / len(nanf), 4) if nanf else None)
            out.append({"run": run, "quantity": name, "label": q.get("label", name), "kind": q.get("kind"), "raw": raw,
                        "dims": q["dims"], "layout": q["layout"], "steps": len(q.get("steps") or []),
                        "outputs": avail, "MB": round(quantity_bytes(config.STORE, run, q) / 1e6, 2),
                        "state": "derived data (stored only)" if derived else _state(name, q), "version": q.get("version"),
                        # v8.1 health (UI review §4.7): when it was last written, NaN fraction, steps it lacks
                        "made": q.get("made"), "nan": nan,
                        "first": (q.get("steps") or [None])[0], "last": (q.get("steps") or [None])[-1]})
    return out


def methods_info():
    """Every stored-quantity maker: plain methods and family members (a member names its family; v8.25). The families
    themselves are in families_info()."""
    return [{"name": m.name, "label": m.display_label, "code_label": m.label, "quantity": m.yaxis, "yaxis": m.yaxis, "code_yaxis": m.quantity,
             "units": m.units_shown, "code_units": m.units, "axes": list(m.axis_names),
             "section": m.section, "group": m.group, "version": m.fingerprint, "path": m.path, "description": m.description,
             "source": m.source, "family": getattr(getattr(m, "family", None), "name", None), "member": getattr(m, "member", None),
             "needs": list(getattr(m, "needs", ()))}
            for m in sorted(METHODS.values(), key=lambda m: (m.section, m.name)) if not isinstance(m, Family)]


def families_info():
    """Quantity families (v8.25): name, label, members (stored names), version, code."""
    return [{"name": f.name, "label": f.label, "members": [m.name for m in f.members.values()], "version": f.fingerprint,
             "path": f.path, "source": f.source, "description": f.description, "axes": list(f.axis_names),
             "needs": list(getattr(f, "needs", ()))}
            for f in sorted((x for x in METHODS.values() if isinstance(x, Family)), key=lambda f: f.name)]


def project_info():
    """The project (2026-11-20, the framework split): its name, reader, and the data manager page's words (title,
    how-to text, axis badges) from project.json "page"."""
    from .project import reader_class
    R = reader_class()
    return {"name": config.NAME, "dir": config.PROJECT_DIR, "reader": R.name, "runs_word": R.runs_word,
            "grid_axes": list(R.grid_axes), "time_units": R.time_units, "page": dict(config.PAGE),
            "howto": _howto()}


def _howto():
    """The page's how-to text: the project's file (project.json "page": {"howto": "howto.txt"}), or None."""
    f = config.PAGE.get("howto")
    if not f or not config.PROJECT_DIR:
        return None
    try:
        with open(os.path.join(config.PROJECT_DIR, f), encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return None


def axes_info():
    """The axis catalogue: name -> {label, units, scale, doc} (the page's badges name a quantity's axes by these)."""
    from .axes import AXES
    return {n: {"label": a.label, "units": a.units, "scale": a.scale, "doc": a.doc} for n, a in sorted(AXES.items())}


def status(runs=None, as_json=False):
    """A table of stored quantities (a pandas DataFrame in a notebook when pandas is there)."""
    memo = {}
    r = rows(runs, memo)
    if as_json:
        if os.path.isdir(config.STORE) and not os.path.exists(os.path.join(config.STORE, "groups.json")):
            from .groups import _write_store_order           # the viewer reads the group order from the store
            _write_store_order(read_groups()["order"])
        reg, stored = registry(), set(store_runs())
        def conf(n):                                         # the card's config summary (the recorded numbers)
            m = _once(memo, ("man", n), lambda: read_manifest(config.STORE, n)) if n in stored else None
            return (m or {}).get("conf") or {}
        datasets = [{"name": n, "path": d.get("path"), "kind": d.get("kind"), "note": d.get("note", ""), "added": d.get("added"),
                     "outputs": _once(memo, ("out", d.get("path")), lambda: count_outputs(d.get("path"))), "stored": n in stored,
                     "notes": d.get("notes", ""), "tags": d.get("tags") or [], "follow": d.get("follow"), "conf": conf(n),
                     "about": d.get("about", ""), "page": d.get("page", ""),
                     "group": d.get("group", ""), "archived": bool(d.get("archived")),           # v8.24
                     "fields": None if d.get("kind") == "derived" else dump_fields(d.get("path"))}    # v11.4
                    for n, d in sorted(reg.items())]
        return {"store": config.STORE, "data_root": config.DATA_ROOT, "runs": runs or store_runs(), "datasets": datasets,
                "dataset_groups": dataset_groups()["order"],                                    # v8.24
                "groups": read_groups(), "rows": r, "methods": methods_info(), "families": families_info(), "load_errors": dict(LOAD_ERRORS),
                "project": project_info(), "axes": axes_info()}                               # 2026-11-20: the page's words
    try:
        import pandas as pd
        return pd.DataFrame(r, columns=["run", "quantity", "label", "steps", "outputs", "MB", "state", "layout", "dims"])
    except ImportError:
        for x in r:
            print(f"{x['run']:24s} {x['quantity']:22s} {x['steps']:>4}/{x['outputs'] or '?':<4} {x['MB']:>8.1f} MB  {x['state']}")
        return r
