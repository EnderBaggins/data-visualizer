"""dm.adopt: make data stored before the data manager count as made by its method, without recomputing it.

Human 2026-10-07: "can you port over the previous caches to the new method?"

For every stored quantity that the old recorder (or a notebook) made and that now has a method of the same name,
the method is run on a few of its outputs (default 3: first, middle, last) and compared with what is stored:
    rel = max |new - stored| / max |stored|      over the cells finite in both,
and the NaN cells must be the same. Within tolerance (float16 maps 2e-3: their rounding is ~5e-4; float32
arrays 1e-4) the stored entry gets the method's version, so the page shows it up to date, and an "adopted"
record (old version, the steps checked, the difference, the date). Anything else is left as it was and reported.
The data itself is never touched; apply=False (the default) only reports.

    dm.adopt()                                   # report for every simulation dataset
    dm.adopt(runs=["pairs-1"], apply=True)       # stamp the ones that match
"""
import json
import time

import numpy as np

from . import config
from .catalog import path_of
from .check import compute
from .registry import METHODS
from .runs import open_run
from .status import store_runs
from .store import _atomic_write_json, dataset_lock, manifest_lock, read_manifest

TOL = {"float16": 2e-3, "float32": 1e-4}


def _stored(run, man, name, step):
    """One output of a stored quantity as float64, shaped like its dims without time."""
    q = man["quantities"][name]
    shape = [len(man["coords"][d]["values"]) for d in q["dims"][1:]]
    d = f"{config.STORE}/{run}/"
    if q["layout"] == "per_step":
        i = q["steps"].index(step)
        a = np.fromfile(d + q["path"].replace("{step:05d}", f"{step:05d}"), dtype="<f2").astype(float) * q["scales"][i]
        return a.reshape(shape)
    a = np.fromfile(d + q["path"], dtype="<f4").astype(float).reshape([len(q["steps"])] + shape)
    return a[q["steps"].index(step)]


def _compare(new, old):
    """(relative difference, NaN pattern equal)."""
    if new.shape != old.shape:
        return np.inf, False
    same_nan = bool(np.array_equal(np.isnan(new), np.isnan(old)))
    ok = np.isfinite(new) & np.isfinite(old)
    if not ok.any():
        return 0.0, same_nan
    top = float(np.max(np.abs(old[ok])))
    return (float(np.max(np.abs(new[ok] - old[ok]))) / top if top > 0 else float(np.max(np.abs(new[ok])))), same_nan


def candidates(runs=None, names=None):
    """{run: [quantity, ...]} stored before the data manager, with a method of the same name, simulation data only."""
    out = {}
    for run in runs or store_runs():
        man = read_manifest(config.STORE, run)
        if not man or path_of(run) is None:              # derived data: made another way, nothing to compare with
            continue
        hit = [n for n, q in sorted(man["quantities"].items())
               if n in METHODS and not METHODS[n].is_raw and not str(q.get("version")).startswith("dm:")
               and (names is None or n in names)]
        if hit:
            out[run] = hit
    return out


def adopt(runs=None, names=None, n=3, apply=False, quiet=False):
    """Check old stored data against its method on n outputs each; with apply=True stamp the ones that match.
    Returns [{run, name, steps, rel, nan_same, ok, applied, error}]."""
    report = []
    for run, hit in candidates(runs, names).items():
        man, data = read_manifest(config.STORE, run), open_run(run)
        stamped = 0
        for name in hit:
            m, q = METHODS[name], man["quantities"][name]
            st = q["steps"]
            steps = sorted({st[int(round(i))] for i in np.linspace(0, len(st) - 1, min(n, len(st)))})
            row = {"run": run, "name": name, "steps": steps, "rel": None, "nan_same": None, "ok": False,
                   "applied": False, "error": None}
            t0 = time.time()
            try:
                worst, nan_same = 0.0, True
                for s, a, _ in compute(m, data, steps):
                    rel, same = _compare(np.asarray(a, dtype=float), _stored(run, man, name, s))
                    worst, nan_same = max(worst, rel), nan_same and same
                tol = TOL["float16" if q["layout"] == "per_step" else "float32"]
                row.update(rel=worst, nan_same=nan_same, ok=bool(worst <= tol and nan_same))
            except Exception as e:                       # report it, keep going
                row["error"] = f"{type(e).__name__}: {e}"
            if row["ok"] and apply:
                q["adopted"] = {"from_version": q.get("version"), "recipe": q.get("recipe"), "checked_steps": steps,
                                "rel_diff": row["rel"], "on": time.strftime("%Y-%m-%d")}
                q["version"], q["recipe"] = m.fingerprint, f"datamgr:{name}"
                row["applied"], stamped = True, stamped + 1
            report.append(row)
            if not quiet:
                verdict = row["error"] or (f"rel diff {row['rel']:.1e}, NaN {'same' if row['nan_same'] else 'DIFFER'}")
                print(f"{run:14s} {name:26s} {'match' if row['ok'] else 'NO MATCH':8s} {verdict}"
                      f"{' -> adopted' if row['applied'] else ''}  ({time.time() - t0:.0f} s)", flush=True)
        if stamped:                                  # re-read: a cache job may have written it meanwhile (2026-10-14)
            with dataset_lock(run), manifest_lock(run):
                cur = read_manifest(config.STORE, run)
                for r in report:
                    if r["run"] == run and r["applied"] and r["name"] in cur["quantities"]:
                        q = cur["quantities"][r["name"]]
                        if q.get("version") == man["quantities"][r["name"]].get("adopted", {}).get("from_version"):
                            q.update({k: man["quantities"][r["name"]][k] for k in ("adopted", "version", "recipe")})
                _atomic_write_json(f"{config.STORE}/{run}/manifest.json", cur)
    if not quiet:
        ok = sum(r["ok"] for r in report)
        print(f"{ok} of {len(report)} match{'; adopted' if apply else ' (report only: apply=True to adopt them)'}")
    return report


if __name__ == "__main__":
    print(json.dumps(candidates(), indent=1))
