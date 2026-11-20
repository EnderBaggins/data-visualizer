"""The visualizer's data store (apt-vis/1, visualizer/FORMAT.md): the only module that writes it.

Same writer as visualizer/recorder/store.py (binaries before the manifest, manifest replaced atomically, so
the viewer never sees an entry whose file is missing), plus: appending steps to a whole-run array, refusing
to overwrite a coordinate other quantities use with different numbers, and dropping a quantity.
"""
import contextlib
import datetime
import json
import os
import shutil

import numpy as np

from .runs import reader_of

FORMAT = "apt-vis/1"
F16_TOP = 32768.0          # max|value| is scaled to 2^15 -> ~8.7 decades of normal float16 below it


class StoreError(Exception):
    pass


def _atomic_write_bytes(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(payload)
    os.replace(tmp, path)


def _atomic_write_json(path, obj):
    _atomic_write_bytes(path, json.dumps(obj, indent=1, allow_nan=False).encode())


def _stats(a):
    finite = a[np.isfinite(a)]
    if finite.size == 0:
        return None, None, None
    nz = np.abs(finite[finite != 0])
    return float(finite.min()), float(finite.max()), (float(nz.min()) if nz.size else None)


def _clean(x):
    if isinstance(x, (list, tuple, np.ndarray)):
        return [_clean(v) for v in x]
    if isinstance(x, (float, np.floating)):
        return float(x) if np.isfinite(x) else None
    if isinstance(x, np.integer):
        return int(x)
    return x


def keep_coords():
    """The run's grid (the reader's grid_axes): kept even when no stored quantity uses it."""
    from .axes import grid_axes
    return grid_axes()


# ---- one writer per dataset (2026-10-14 fix: six cache jobs on profile-shifted at once each kept its own copy of
# the manifest and wrote it back, so the last one erased the others' entries (I_along, line_current, line_voltage
# vanished), and two jobs filling the same quantity paired one's step list with the other's data.bin (twist_angle:
# 201 steps listed, 104 rows on disk -> values at the wrong times). Now a job holds the dataset for as long as it
# writes it; another job waits. Locks live in <JOBS>/locks/ (the store holds only data); the OS releases them when
# a process ends, so a cancelled or crashed job never leaves one behind. fcntl on Linux / macOS, msvcrt on Windows
# (2026-11-20: before, Windows had no locking). ----------------------------------------------------------------------
try:
    import fcntl
except ImportError:                    # Windows
    fcntl = None
    import msvcrt


class _Busy(Exception):
    pass


def _lock(f, wait):
    """Take an exclusive lock on open file f (wait for it, or raise _Busy at once)."""
    if fcntl:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB))
        except BlockingIOError:
            raise _Busy()
        return
    import time
    f.seek(0)
    while True:                        # msvcrt: lock the file's first byte (LK_NBLCK fails at once when it is held)
        try:
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            return
        except OSError:
            if not wait:
                raise _Busy()
            time.sleep(0.2)


def _lock_file(run, kind):
    from . import config
    d = os.path.join(config.JOBS, "locks")
    os.makedirs(d, exist_ok=True)
    return open(os.path.join(d, f"{run}.{kind}.lock"), "a+")


@contextlib.contextmanager
def dataset_lock(run, wait=True, on_wait=None):
    """Hold dataset `run` for writing its data (cache jobs, drop, adopt, prune). Busy: wait (calling on_wait()
    once first), or with wait=False raise StoreError at once (for the page's quick actions)."""
    f = _lock_file(run, "data")
    try:
        try:
            _lock(f, wait=False)
        except _Busy:
            if not wait:
                raise StoreError(f"a job is computing {run} right now: try again when it has finished")
            if on_wait:
                on_wait()
            _lock(f, wait=True)
        yield
    finally:
        f.close()                      # closing releases the lock


@contextlib.contextmanager
def manifest_lock(run):
    """Hold `run`'s manifest.json for one read-modify-write (short: no computing inside)."""
    f = _lock_file(run, "manifest")
    try:
        _lock(f, wait=True)
        yield
    finally:
        f.close()


def stored_size_ok(root, run, m, name):
    """Whether a stored quantity's files match its manifest entry (whole / static: data.bin has exactly the rows
    the entry lists; per_step: every listed step has its file). A mismatch = it was written by two jobs at once."""
    q = m["quantities"].get(name)
    if q is None:
        return True
    d = os.path.join(root, run, q["path"].split("/")[0])
    if q["layout"] == "per_step":
        return all(os.path.exists(os.path.join(d, f"{int(s):05d}.bin")) for s in q["steps"])
    try:
        n = int(np.prod([len(m["coords"][dim]["values"]) for dim in q["dims"] if dim != "time"]))
    except KeyError:                   # an axis it uses is missing from the manifest
        return False
    rows = len(q["steps"]) if q["layout"] == "whole" else 1
    p = os.path.join(d, "data.bin")
    return os.path.exists(p) and os.path.getsize(p) == 4 * rows * n


def prune_coords(m):
    """Remove from manifest `m` the coordinates no stored quantity uses (2026-10-14: a retired axis — r_max_line,
    surface_theta — stayed in the manifests after its data was recomputed or never stored, and the viewer kept
    offering it as an x axis). The grid (the reader's grid axes) stays. Returns the removed names."""
    used = {d for q in m.get("quantities", {}).values() for d in q.get("dims", [])}
    keep = keep_coords()
    gone = [c for c in list(m.get("coords", {})) if c not in used and c not in keep]
    for c in gone:
        m["coords"].pop(c)
    return gone


def read_manifest(root, run):
    p = os.path.join(root, run, "manifest.json")
    if not os.path.exists(p):
        return None
    with open(p) as f:
        return json.load(f)


def quantity_bytes(root, run, q):
    """Bytes a stored quantity takes on disk."""
    d = os.path.join(root, run, q["path"].split("/")[0])
    try:
        return sum(e.stat().st_size for e in os.scandir(d) if e.is_file())
    except OSError:
        return 0


class RunStore:
    """One run's folder in the store: data/<run>/manifest.json + <quantity>/ binaries."""

    def __init__(self, root, data, name=None):
        self.root, self.reader = root, reader_of(data)       # data: a reader, or the object methods get
        self.data = self.reader.native
        self.run = name or os.path.basename(os.path.normpath(self.reader.path))   # the dataset's name (its folder name by default)
        self.dir = os.path.join(root, self.run)
        self.manifest_path = os.path.join(self.dir, "manifest.json")
        self.m = read_manifest(root, self.run) or {
            "format": FORMAT, "run": self.run, "quantities": {}, "coords": {}, "geometry": {},
            "expressions": {}, "steps": [], "times": []}
        self.m["source"] = os.path.abspath(self.reader.path)
        md = self.reader.metadata()
        self.m["conf"] = dict(md.get("conf") or {})     # a few settings, for the dataset cards
        self.m["conf_all"] = dict(md.get("conf_all") or {})   # §4.9: every config number, for config variables
        if getattr(self.reader, "time_units", ""):            # v15.3: the viewer labels its time axis with these
            self.m["time_units"] = self.reader.time_units
        axes = keep_coords()
        if axes and not all(a in self.m["coords"] for a in axes):      # the grid: written once, from the reader
            g = self.reader.grid()
            for name, c in (g.get("coords") or {}).items():
                self.set_coord(name, c)
            self.m.setdefault("geometry", {}).update(g.get("geometry") or {})

    # ---- coordinates ---------------------------------------------------------------------------------------
    def users_of(self, cname):
        return sorted(n for n, q in self.m["quantities"].items() if cname in q["dims"])

    def set_coord(self, name, c, check=False):
        """Store coordinate `name` = {values, label, units, scale, alt}. check: refuse different numbers if
        stored quantities already use this coordinate (they would be read on the wrong axis)."""
        vals = np.asarray(c["values"], dtype=float)
        old = self.m["coords"].get(name)
        if check and old is not None:
            ov = np.asarray([np.nan if v is None else v for v in old["values"]], dtype=float)
            if ov.shape != vals.shape or not np.allclose(ov, vals, rtol=1e-6, equal_nan=True):
                users = self.users_of(name)
                if users:
                    raise StoreError(f"axis '{name}' in {self.run} already has different numbers ({len(ov)} values), "
                                     f"used by {', '.join(users)}. Give the new axis another name, or re-cache those.")
        e = {"values": _clean(vals), "label": c.get("label") or name, "units": c.get("units", ""),
             "scale": c.get("scale", "linear")}
        if c.get("alt"):
            e["alt"] = {k: {"values": _clean(np.asarray(v["values"], dtype=float)), "label": v.get("label", k),
                            "units": v.get("units", "")} for k, v in c["alt"].items()}
        if c.get("names"):                                   # v8.25: a categorical axis's value names
            e["names"] = [str(x) for x in c["names"]]
        self.m["coords"][name] = e

    # ---- bookkeeping ---------------------------------------------------------------------------------------
    def entry(self, name):
        return self.m["quantities"].get(name)

    def stored_steps(self, name):
        q = self.entry(name)
        return set(q["steps"]) if q else set()

    def forget(self, name):
        """Drop the manifest entry (files are overwritten when recomputed)."""
        self.m["quantities"].pop(name, None)

    def prune_coords(self):
        """Remove the coordinates no stored quantity uses; returns their names (see prune_coords below)."""
        return prune_coords(self.m)

    def drop(self, name):
        """Delete a quantity: manifest entry and files."""
        q = self.m["quantities"].pop(name, None)
        if q:
            shutil.rmtree(os.path.join(self.dir, q["path"].split("/")[0]), ignore_errors=True)

    def _note_steps(self, steps):
        known = dict(zip(self.m["steps"], self.m["times"]))
        for s in steps:
            known[int(s)] = self.reader.time_of(s)
        keys = sorted(known)
        self.m["steps"], self.m["times"] = keys, [known[k] for k in keys]

    def _entry(self, name, dims, layout, dtype, path, meta):
        q = self.m["quantities"].get(name)
        if q is None or q["dims"] != list(dims) or q["layout"] != layout:
            q = {"dims": list(dims), "layout": layout, "dtype": dtype, "path": path, "steps": [],
                 "scales": [], "stats": {"min": [], "max": [], "minpos": []}}
            self.m["quantities"][name] = q
        for k in ("label", "units", "recipe", "version", "description", "section", "kind", "family", "family_label", "member"):
            if k in meta:                                    # (v8.25: a family member names its family, for the menus)
                q[k] = meta[k]
        q["made"] = datetime.datetime.now().isoformat(timespec="seconds")      # §4.7: when it was last written
        return q

    # ---- writers -------------------------------------------------------------------------------------------
    def write_step(self, name, step, array, meta, dims, dtype="float16"):
        """One output of a per-step quantity (one file per step). `dims` = the dims of `array`."""
        a = np.asarray(array, dtype=np.float64)
        a = np.where(np.isfinite(a), a, np.nan)
        q = self._entry(name, ("time",) + tuple(dims), "per_step", dtype, f"{name}/{{step:05d}}.bin", meta)
        if dtype == "float16":
            top = np.nanmax(np.abs(a)) if np.isfinite(a).any() else 0.0
            scale = top / F16_TOP if top > 0 else 1.0
            payload = (a / scale).astype("<f2").tobytes()
        else:
            scale = 1.0
            payload = a.astype("<f4").tobytes()
        _atomic_write_bytes(os.path.join(self.dir, name, f"{int(step):05d}.bin"), payload)
        lo, hi, mp = _stats(a)
        nanf = round(float(np.isnan(a).mean()), 4) if a.size else 0.0
        steps = q["steps"]
        if "nanf" not in q or len(q["nanf"]) != len(steps):              # §4.7: NaN fraction per output (None = not recorded)
            q["nanf"] = [None] * len(steps)
        if int(step) in steps:
            i = steps.index(int(step))
            q["scales"][i] = scale
            q["nanf"][i] = nanf
            for k, v in zip(("min", "max", "minpos"), (lo, hi, mp)):
                q["stats"][k][i] = v
        else:
            i = int(np.searchsorted(steps, int(step)))
            steps.insert(i, int(step))
            q["scales"].insert(i, scale)
            q["nanf"].insert(i, nanf)
            for k, v in zip(("min", "max", "minpos"), (lo, hi, mp)):
                q["stats"][k].insert(i, v)
        self._note_steps([step])

    def read_whole(self, name):
        """(steps, array) of a stored whole-run quantity, or ([], None)."""
        q = self.entry(name)
        if not q or q["layout"] != "whole":
            return [], None
        shape = [len(q["steps"])] + [len(self.m["coords"][d]["values"]) for d in q["dims"][1:]]
        try:
            a = np.fromfile(os.path.join(self.dir, name, "data.bin"), dtype="<f4")
        except OSError:
            return [], None
        if a.size != int(np.prod(shape)):  # 2026-10-14: was dropped silently (and the old rows with it)
            raise StoreError(f"{self.run} · {name}: data.bin has {a.size} values, its manifest entry needs "
                             f"{int(np.prod(shape))} ({len(q['steps'])} steps); recompute it (rewrite)")
        return list(q["steps"]), a.reshape(shape).astype(np.float64)

    def write_whole(self, name, steps, array, dims, meta):
        """A whole quantity at once (layout `whole` if it has a time dim, else `static`)."""
        a = np.asarray(array, dtype=np.float64)
        a = np.where(np.isfinite(a), a, np.nan)
        has_time = "time" in dims
        q = self._entry(name, dims, "whole" if has_time else "static", "float32", f"{name}/data.bin", meta)
        _atomic_write_bytes(os.path.join(self.dir, name, "data.bin"), a.astype("<f4").tobytes())
        q["nan_frac"] = round(float(np.isnan(a).mean()), 4) if a.size else 0.0      # §4.7
        q.pop("nanf", None)
        if has_time:
            q["steps"] = [int(s) for s in steps]
            per = [_stats(a[i]) for i in range(a.shape[0])]
            q["stats"] = {k: [p[j] for p in per] for j, k in enumerate(("min", "max", "minpos"))}
            self._note_steps(steps)
        else:
            q["steps"] = []
            lo, hi, mp = _stats(a)
            q["stats"] = {"min": [lo], "max": [hi], "minpos": [mp]}
        q.pop("scales", None)

    def append_whole(self, name, steps, array, dims, meta):
        """Merge new steps into a whole-run quantity (new values win for steps stored before)."""
        old_steps, old = self.read_whole(name) if self.entry(name) and self.entry(name)["dims"] == list(dims) else ([], None)
        merged = {}
        if old is not None:
            merged.update({s: old[i] for i, s in enumerate(old_steps)})
        a = np.asarray(array, dtype=np.float64)
        merged.update({int(s): a[i] for i, s in enumerate(steps)})
        keys = sorted(merged)
        self.write_whole(name, keys, np.stack([merged[k] for k in keys]), dims, meta)

    def save(self):
        self.m["updated"] = datetime.datetime.now().isoformat(timespec="seconds")
        from .registry import METHODS                   # shown names and groups as they are now (groups.json): an
        for n, q in self.m["quantities"].items():       # edit on the page during a long job is not reverted
            if n in METHODS and str(q.get("recipe", "")).startswith("datamgr:"):
                m = METHODS[n]
                q["label"], q["section"], q["kind"], q["units"] = m.display_label, m.group, m.yaxis, m.units_shown
        for q in self.m["quantities"].values():
            if "scales" in q:
                q["scales"] = _clean(q["scales"])
            q["stats"] = {k: _clean(v) for k, v in q["stats"].items()}
        with manifest_lock(self.run):
            _atomic_write_json(self.manifest_path, self.m)
        index_path = os.path.join(self.root, "index.json")
        with manifest_lock("_index"):                   # jobs on other datasets write it too
            runs = []
            if os.path.exists(index_path):
                with open(index_path) as f:
                    runs = json.load(f).get("runs", [])
            if self.run not in runs:
                _atomic_write_json(index_path, {"format": FORMAT, "runs": sorted(runs + [self.run])})
