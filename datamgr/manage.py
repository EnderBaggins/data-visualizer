"""Housekeeping of the store (v8.1, UI review §4, human 2026-10-14 "yeah"): following running simulations, health of
stored quantities, the full config in every manifest, retiring an axis, and keeping shown names in one place.

    dm.follow()                      # new outputs of followed datasets -> computed (serve.py runs it every few minutes)
    dm.health()                      # NaN fraction of stored whole-run quantities that don't have it yet
    dm.refresh_conf()                # every config.toml number into each simulation dataset's manifest
    dm.retire("r_max_line")          # what retiring an axis takes (apply=True does it)
    dm.push_label("line_current")    # the page's shown name -> the method's code (and the override goes)
    dm.sync_labels()                 # names / groups / y-axis groups / units of every manifest from the methods
"""
import os
import re
import time

import numpy as np

from . import config
from .catalog import registry, stored
from .registry import METHODS, method
from .store import RunStore, StoreError, _atomic_write_json, dataset_lock, manifest_lock, prune_coords, read_manifest


# ---- following running simulations (§4.6) ------------------------------------------------------------------------
def followed():
    """{dataset: [quantities]} for the datasets that follow; "stored" is resolved to what is stored now."""
    out = {}
    for name, d in registry().items():
        f = d.get("follow")
        if not f or d.get("kind") != "simulation":
            continue
        qs = (read_manifest(config.STORE, name) or {}).get("quantities", {})
        names = [q for q in (list(qs) if f == "stored" else f)
                 if q in METHODS or (qs.get(q) or {}).get("version") == "raw:1"]     # computable, or a copied dump field
        if names:
            out[name] = names
    return out


def follow(job_prefix=None, quiet=False):
    """Compute the followed quantities for new outputs. Only datasets with something new start a job (one job each,
    named <job_prefix>-<dataset>, shown on the page); a dataset a job is writing is skipped this time."""
    from .cache import cache
    from .runs import open_run, settled_steps
    done = {}
    for name, names in followed().items():
        try:
            data = open_run(name)
            have = settled_steps(data)
        except Exception as e:                      # a run folder that went away, a dump being written
            if not quiet:
                print(f"{name}: cannot read the run ({type(e).__name__}: {e})")
            continue
        m = read_manifest(config.STORE, name) or {"quantities": {}}
        todo = [q for q in names if set(have) - set((m["quantities"].get(q) or {}).get("steps") or [])
                or q not in m["quantities"]]
        todo = [q for q in todo if not (m["quantities"].get(q) or {}).get("layout") == "static"]
        if not todo:
            continue
        try:
            with dataset_lock(name, wait=False):
                pass                                # free now: the job below takes it
        except StoreError:
            if not quiet:
                print(f"{name}: a job is writing it; next time")
            continue
        job = f"{job_prefix}-{name}" if job_prefix else None
        if not quiet:
            print(f"{name}: new outputs for {', '.join(todo)}")
        try:
            done[name] = cache(todo, [name], job=job, quiet=quiet)
        except Exception as e:                      # one dataset failing must not stop the others
            print(f"{name}: failed ({type(e).__name__}: {e})")
    return done


# ---- health (§4.7) -----------------------------------------------------------------------------------------------
def health(runs=None, quiet=False):
    """Fill in the NaN fraction of stored whole-run / static quantities made before it was recorded (reads data.bin;
    per-output maps get it when they are next computed). A dataset a job is writing is skipped."""
    out = {}
    for run in runs or stored():
        try:
            with dataset_lock(run, wait=False), manifest_lock(run):
                m = read_manifest(config.STORE, run)
                if not m:
                    continue
                n = 0
                for name, q in m["quantities"].items():
                    if q["layout"] not in ("whole", "static") or "nan_frac" in q:
                        continue
                    p = os.path.join(config.STORE, run, q["path"].split("/")[0], "data.bin")
                    try:
                        a = np.fromfile(p, dtype="<f4")
                    except OSError:
                        continue
                    q["nan_frac"] = round(float(np.isnan(a).mean()), 4) if a.size else 0.0
                    n += 1
                if n:
                    _atomic_write_json(os.path.join(config.STORE, run, "manifest.json"), m)
                out[run] = n
                if not quiet:
                    print(f"{run}: NaN fraction recorded for {n} quantities")
        except StoreError as e:
            if not quiet:
                print(f"{run}: skipped ({e})")
    return out


# ---- the whole config in the manifest (§4.9) -----------------------------------------------------------------------
def refresh_conf(runs=None, quiet=False):
    """Write every config.toml number of each simulation dataset into its manifest ("conf_all"), without computing."""
    from .runs import open_run
    reg = registry()
    out = {}
    for run in runs or stored():
        if (reg.get(run) or {}).get("kind") != "simulation":
            continue
        try:
            with dataset_lock(run, wait=False):
                rs = RunStore(config.STORE, open_run(run), name=run)
                rs.save()
                out[run] = len(rs.m.get("conf_all") or {})
                if not quiet:
                    print(f"{run}: {out[run]} config entries")
        except StoreError as e:
            if not quiet:
                print(f"{run}: skipped ({e})")
        except Exception as e:                      # e.g. the run folder is gone
            if not quiet:
                print(f"{run}: cannot open the run ({type(e).__name__}: {e})")
    return out


# ---- retiring an axis (§4.4) ---------------------------------------------------------------------------------------
SCRIPT_DIRS = tuple(config.RETIRE_SCAN.get("dirs") or ())     # project.json "retire_scan": scripts that may read an axis by name


def retire(axis, runs=None, apply=False, quiet=False):
    """Retire axis `axis` from the store. For each dataset that has it: quantities on it whose method has moved to
    another axis are computed again (their data on the old axis goes), quantities whose method still uses it (or that
    have no method) are listed, and the axis is removed once nothing uses it. Also lists scripts that read it by name.
    apply=False: only the plan."""
    from .cache import cache
    plan, scripts = [], []
    for run in runs or stored():
        m = read_manifest(config.STORE, run)
        if not m or axis not in m.get("coords", {}):
            continue
        users = [n for n, q in m["quantities"].items() if axis in q.get("dims", [])]
        again = [n for n in users if n in METHODS and axis not in METHODS[n].axis_names]
        stuck = [n for n in users if n not in again]
        plan.append({"dataset": run, "recompute": again, "still_on_it": stuck, "remove_axis": not stuck})
    root = os.path.expanduser(config.RETIRE_SCAN.get("root") or config.ROOT)
    pat = re.compile(r"""["']%s["']""" % re.escape(axis))
    for d in SCRIPT_DIRS:
        for dp, _, fs in os.walk(os.path.join(root, d)):
            for f in fs:
                if not f.endswith(".py"):
                    continue
                p = os.path.join(dp, f)
                try:
                    with open(p, encoding="utf-8", errors="replace") as fh:
                        for i, line in enumerate(fh, 1):
                            if pat.search(line):
                                scripts.append(f"{os.path.relpath(p, root)}:{i}")
                except OSError:
                    continue
    if not quiet:
        for x in plan:
            print(f"{x['dataset']}: recompute {', '.join(x['recompute']) or '-'}; still on {axis}: {', '.join(x['still_on_it']) or '-'}"
                  f"{'; the axis goes' if x['remove_axis'] else ''}")
        print(f"scripts that name '{axis}': " + (", ".join(scripts) if scripts else "none"))
        if not apply:
            print("(plan only: apply=True / --yes does it)")
    if apply:
        for x in plan:
            if x["recompute"]:
                cache(x["recompute"], [x["dataset"]], quiet=quiet)
            with dataset_lock(x["dataset"], wait=False), manifest_lock(x["dataset"]):
                m = read_manifest(config.STORE, x["dataset"])
                gone = prune_coords(m)
                if gone:
                    _atomic_write_json(os.path.join(config.STORE, x["dataset"], "manifest.json"), m)
                    if not quiet:
                        print(f"{x['dataset']}: removed unused axes {', '.join(gone)}")
    return {"plan": plan, "scripts": scripts}


# ---- shown names in one place (§4.3) -------------------------------------------------------------------------------
_LABEL = re.compile(r"""(label\s*=\s*)(["'])(.*?)(?<!\\)\2""", re.S)


def push_label(name):
    """Make the page's shown name of `name` the label in its method's code, and drop the override (only the
    decorator changes: nothing is recomputed)."""
    from .groups import label_of, set_label
    m = method(name)
    new = label_of(name)
    if not new:
        raise ValueError(f"{name} has no renamed label to push (it shows its code's label)")
    if not m.path or not os.path.exists(m.path):
        raise ValueError(f"{name} has no saved method file")
    with open(m.path, encoding="utf-8") as f:
        src = f.read()
    dec = re.search(r"@dm\.register\((.*?)\)\s*\n\s*def\s+" + re.escape(m.fn.__name__), src, re.S)
    if not dec or not _LABEL.search(dec.group(1)):
        raise ValueError(f"cannot find label= in the @dm.register line of {m.path}")
    q = '"' if '"' not in new else "'"
    body = _LABEL.sub(lambda x: f"{x.group(1)}{q}{new}{q}", dec.group(1), count=1)
    src = src[:dec.start(1)] + body + src[dec.end(1):]
    tmp = m.path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(src)
    os.replace(tmp, m.path)
    m.label = new
    set_label(name, "")
    return m.path


def sync_labels(runs=None, quiet=False):
    """Write the shown name, group, y-axis group and units of every quantity with a method into every manifest."""
    n = 0
    for run in runs or stored():
        with manifest_lock(run):
            m = read_manifest(config.STORE, run)
            if not m:
                continue
            ch = 0
            for name, q in m["quantities"].items():
                meth = METHODS.get(name)
                if not meth or not str(q.get("recipe", "")).startswith("datamgr:"):
                    continue
                new = {"label": meth.display_label, "section": meth.group, "kind": meth.yaxis, "units": meth.units_shown}
                if any(q.get(k) != v for k, v in new.items()):
                    q.update(new); ch += 1
            if ch:
                _atomic_write_json(os.path.join(config.STORE, run, "manifest.json"), m)
                n += ch
                if not quiet:
                    print(f"{run}: {ch} quantities updated")
    return n
