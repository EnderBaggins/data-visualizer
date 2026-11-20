"""dm.cache: compute methods for every output of runs and store them for the visualizer.

    dm.cache("Epar_over_B", runs=["baseline-19", "pairs-1"])
    dm.cache("along", runs="no-pair-1", steps="0:100:2")          # a family: all its members

Only outputs not stored yet are computed (a running simulation just gets its new outputs), so a stopped
cache resumes where it stopped. Several methods in one call share each loaded output. Data the old
recorder made is kept (adopted) as long as the method is the same quantity; data made by an older version
of the method (its code changed) is computed again. rewrite=True recomputes everything asked for.

Speed (2026-11-12, claude_work/tasks/2026-11-12_cache-speed; human: "yes do all those fixes", then "can use more workers (but
never more than like 50% of remaining" capacity of the storage server): every output is read once. The shared pass
over the outputs also fills the caches the time-axis methods read (their warms=, datamgr/warm.py), so those no longer
walk through the dumps again, and the outputs are computed by worker processes while this process writes:
workers="auto" (default) takes half of the server's free cores and memory at the start of each dataset, at most
MAX_WORKERS; a number asks for that many; 0 = everything in this process. The dumps sit on a network mount
(~39 MB/s however many processes read), so past ~8 workers the cacher only waits on reading.
"""
import json
import multiprocessing
import os
import time
import traceback

import numpy as np

from . import config
from .check import layout_for
from .registry import Family, method
from .catalog import name_of, path_of
from .axes import grid_axes
from .runs import open_reader, reader_of, run_name, select_steps, settled_steps
from .store import RunStore, StoreError, dataset_lock, stored_size_ok
from . import warm


class _Job:
    """Progress file for the data manager page (visualizer/datamgr_jobs/<id>.json); a no-op without an id."""

    def __init__(self, job_id, methods, runs):
        self.path = os.path.join(config.JOBS, f"{job_id}.json") if job_id else None
        self.s = {"id": job_id, "state": "running", "methods": methods, "runs": runs, "run": None, "done": 0,
                  "total": 0, "started": time.time(), "updated": time.time(), "log": [], "error": None, "pid": os.getpid()}

    def update(self, **kw):
        self.s.update(kw, updated=time.time())
        if self.path:
            os.makedirs(config.JOBS, exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(self.s, f)
            os.replace(tmp, self.path)

    def log(self, msg, quiet=False):
        if not quiet:
            print(msg, flush=True)
        self.s["log"] = (self.s["log"] + [msg])[-200:]
        self.update()


def _status_of(rs, m, rewrite):
    """Which stored outputs count for method m: (set of steps kept, note)."""
    q = rs.entry(m.name)
    if q is None:
        return set(), None
    if rewrite:
        rs.forget(m.name)
        return set(), "recomputing (rewrite)"
    if not stored_size_ok(rs.root, rs.run, rs.m, m.name):   # written by two jobs at once (before 2026-10-14)
        rs.forget(m.name)
        return set(), "its stored data did not match its manifest entry: computing it again"
    v = q.get("version")
    if v == m.fingerprint:
        return set(q["steps"]), None
    if not str(v).startswith("dm:"):                    # made by the old recorder / a notebook: keep it
        return set(q["steps"]), f"keeping {len(q['steps'])} outputs made before the data manager"
    rs.forget(m.name)
    return set(), "its code changed since it was cached: computing again"


def _parts(m):
    """What a method stores: a family's members (v8.25), else the method itself."""
    return list(m.members.values()) if isinstance(m, Family) else [m]


def _arrays(m, out):
    """The function's result as {stored name: float array}."""
    if isinstance(m, Family):
        return {f"{m.name}.{k}": a for k, a in m.split(out).items()}
    return {m.name: np.asarray(out, dtype=float)}


def _compute_output(reader, s, ms, specs):
    """One output: (({stored name: array}, {warm spec: cache entry}), None), or (None, why) if its dump can't be read."""
    try:
        data = reader.load(s)                           # the object methods get, holding output s
    except (OSError, KeyError) as e:                    # unreadable dump (being written / damaged): skip it
        return None, f"{type(e).__name__}: {e}"
    arrays = {}
    for m in ms:
        arrays.update(_arrays(m, m.fn(data)))
    return (arrays, {sp: warm.compute(sp, data) for sp in specs}), None


MAX_WORKERS = 8         # past this the cacher waits on the network mount (~39 MB/s) anyway
WORKER_GB = 1.0         # memory counted per worker (measured: ~0.23 GB resident on rcs-pairs-1-ec025, 2026-11-12)


def _free_proc():
    """(idle cores, available GB) from /proc (Linux): idle + iowait over half a second, MemAvailable."""
    def cpu():
        with open("/proc/stat") as f:
            v = [float(x) for x in f.readline().split()[1:]]
        return v[3] + v[4], sum(v)
    i0, t0 = cpu()
    time.sleep(0.5)
    i1, t1 = cpu()
    cores = (os.cpu_count() or 1) * (i1 - i0) / max(t1 - t0, 1e-9)
    with open("/proc/meminfo") as f:
        mem = next(int(x.split()[1]) for x in f if x.startswith("MemAvailable")) / 1e6
    return cores, mem


def _free_psutil():
    """(idle cores, available GB) from psutil (Windows, macOS), if it is installed."""
    import psutil
    busy = psutil.cpu_percent(interval=0.5) / 100.0
    return (os.cpu_count() or 1) * (1.0 - busy), psutil.virtual_memory().available / 1e9


def auto_workers():
    """(n, why): worker processes for a cache job, at most half of what the machine has free right now (human
    2026-11-12: "never more than like 50% of remaining"): idle cores measured over half a second (/proc/stat idle +
    iowait on Linux; psutil elsewhere), available memory at WORKER_GB per worker, and at most MAX_WORKERS. 0 when less
    than 2 cores are free, or when neither can be read."""
    cores = mem = None
    for probe in (_free_proc, _free_psutil):
        try:
            cores, mem = probe()
            break
        except (OSError, ValueError, StopIteration, ImportError):
            continue
    if cores is None:
        return 0, "the server's free capacity could not be read"
    n = int(min(cores / 2, mem / 2 / WORKER_GB, MAX_WORKERS))
    return n, f"{cores:.1f} cores and {mem:.0f} GB free on the server"


_W = {}                                                 # a worker process's own run object
_ONE_THREAD = ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS")


def _worker_init(path):
    from .runs import open_reader                       # (importing datamgr loaded the project and the saved methods)
    _W["data"] = open_reader(path)


def _worker_output(task):
    s, names, specs = task
    return s, _compute_output(_W["data"], s, [method(n, raw_ok=True) for n in names], specs)


class _Outputs:
    """The outputs computed in this process, or by `n` worker processes (in order; this process only writes).
    Workers start fresh (spawn) and load the saved methods by name, so a method defined only in a notebook keeps
    everything in this process. Each worker is held to one thread for numpy's libraries."""

    def __init__(self, data, tasks, n):
        self.data, self.tasks, self.n, self.pool = data, tasks, n, None

    def __enter__(self):
        if not self.n:
            return ((s, _compute_output(self.data, s, ms, specs)) for s, ms, specs in self.tasks)
        saved = {k: os.environ.get(k) for k in _ONE_THREAD}
        os.environ.update({k: "1" for k in _ONE_THREAD})
        try:
            self.pool = multiprocessing.get_context("spawn").Pool(self.n, _worker_init, (self.data.path,))
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        return self.pool.imap(_worker_output, [(s, [m.name for m in ms], specs) for s, ms, specs in self.tasks])

    def __exit__(self, *exc):
        if self.pool is not None:
            self.pool.terminate()
            self.pool.join()


def _loadable(m):
    """Can a fresh process get this method by name (a saved file, or a dump field)?"""
    return m.is_raw or bool(getattr(m, "path", None))


def cache(names, runs, steps=None, rewrite=False, job=None, quiet=False, workers="auto"):
    """Store methods `names` (one or a list) for `runs` (one or a list of names / paths / opened runs). Returns a summary.
    A family member's name (gap.length) or the family's (gap) caches the whole family, in one pass.
    workers: processes that compute the outputs: "auto" (half the server's free capacity, auto_workers), a number,
    or 0 = all in this process."""
    ms = [method(n, raw_ok=True) for n in ([names] if isinstance(names, (str,)) or callable(names) else names)]
    ms = list(dict.fromkeys(getattr(m, "family", None) or m for m in ms))
    runs = [runs] if isinstance(runs, str) or not hasattr(runs, "__iter__") else list(runs)
    J = _Job(job, [m.name for m in ms], [r if isinstance(r, str) else run_name(r) for r in runs])
    summary, held = {}, None
    try:
        for run in runs:
            if isinstance(run, str) and not os.path.isabs(run) and path_of(run) is None:
                J.log(f"{run}: derived data (no run folder) — nothing to compute", quiet)
                continue
            rd = open_reader(run)
            data = rd.native                            # what methods get
            rname = run if isinstance(run, str) and not os.path.isabs(run) else name_of(rd.path)
            if held:
                held.__exit__(None, None, None)
            held = dataset_lock(rname, on_wait=lambda: (J.log(f"{rname}: another job is writing this dataset: waiting for it", quiet),
                                                         J.update(state="waiting", run=rname)))
            held.__enter__()                            # (released when the next dataset starts, or at the end)
            J.update(state="running", run=rname)
            rs = RunStore(config.STORE, rd, name=rname)     # read the manifest only now: what the job before wrote
            want = select_steps(settled_steps(rd), steps)
            todo = {}
            keys = set(rd.fields() or [])
            for m in [m for m in ms if m.is_raw and keys and m.name not in keys]:
                J.log(f"{rname} · {m.name}: not in this run's dumps — skipped", quiet)
            run_ms = [m for m in ms if not (m.is_raw and keys and m.name not in keys)]
            for m in run_ms:
                haves = []
                for part in _parts(m):
                    for a in part.space:                # coordinates first: refuse a clash with stored data
                        if a.name not in grid_axes():       # (the grid's own come from the reader)
                            rs.set_coord(a.name, a.coord(data), check=True)
                    have, note = _status_of(rs, part, rewrite)
                    if note:
                        J.log(f"{rname} · {part.name}: {note}", quiet)
                    haves.append(have)
                todo[m.name] = [s for s in want if any(s not in h for h in haves)]   # (a family: any member missing it)
            per = [m for m in run_ms if not m.time_in_axes and todo[m.name]]
            whole = [m for m in run_ms if m.time_in_axes and todo[m.name]]
            caches = {sp: warm.Cache(sp, data) for sp in warm.specs_of(whole)}      # what the time-axis methods read
            warm_todo = {sp: set(c.missing(want)) for sp, c in caches.items()}
            steps_needed = sorted({s for m in per for s in todo[m.name]}.union(*warm_todo.values()))
            J.update(run=rname, done=0, total=len(steps_needed) + len(whole))
            summary[rname] = {m.name: len(todo[m.name]) for m in run_ms}
            if not steps_needed and not whole:
                J.log(f"{rname}: everything asked for is stored already", quiet)
                continue
            layouts = {p.name: layout_for(p, data) for m in per for p in _parts(m)}
            buf = {n: {} for n, lay in layouts.items() if lay[0] == "whole"}
            dims = {p.name: tuple(a.name for a in p.space) for m in run_ms for p in _parts(m)}
            mobj = {p.name: p for m in run_ms for p in _parts(m)}
            previous, t0 = rd.current_step(), time.time()

            def flush():
                for n, b in buf.items():
                    if b:
                        ks = sorted(b)
                        rs.append_whole(n, ks, np.stack([b[k] for k in ks]), ("time",) + dims[n], mobj[n].meta())
                        b.clear()
                rs.save()
                for c in caches.values():
                    c.save()

            tasks = [(s, [m for m in per if s in todo[m.name]], [sp for sp in caches if s in warm_todo[sp]])
                     for s in steps_needed]
            nw, why = (auto_workers() if workers == "auto" else (max(0, int(workers or 0)), "asked for"))
            if len(tasks) < 4:                                              # a few new outputs: not worth starting workers
                nw = 0
            if nw and not all(_loadable(m) for m in per):
                J.log(f"{rname}: {', '.join(m.name for m in per if not _loadable(m))} not saved: computing in this "
                      "process (dm.save a method to use worker processes)", quiet)
                nw = 0
            if steps_needed and (caches or nw):
                J.log(f"{rname}: {len(steps_needed)} outputs" + (f", also filling {', '.join(caches)}" if caches else "")
                      + (f"; {nw} worker processes ({why})" if nw else f"; computed in this process ({why})"), quiet)
            try:
                with _Outputs(rd, tasks, nw) as results:
                    for i, (s, (res, err)) in enumerate(results):
                        if err:
                            J.log(f"{rname} step {s}: skipped ({err})", quiet)
                            continue
                        arrays, entries = res
                        for n, a in arrays.items():
                            layout, dtype = layouts[n]
                            if layout == "per_step":
                                rs.write_step(n, s, a, mobj[n].meta(), dims[n], dtype)
                            else:
                                buf[n][s] = a
                        for sp, e in entries.items():
                            caches[sp].add(s, e)
                        if (i + 1) % 10 == 0:
                            flush()
                        el = time.time() - t0
                        J.update(done=i + 1, eta_s=el / (i + 1) * (len(steps_needed) - i - 1))
                        if not quiet and ((i + 1) % 20 == 0 or i + 1 == len(steps_needed)):
                            print(f"\r{rname}: {i + 1}/{len(steps_needed)} outputs ({el:.0f} s)", end="", flush=True)
                flush()
                if steps_needed and not quiet:
                    print()
            finally:
                if previous is not None:
                    try:
                        rd.load(previous)
                    except OSError:
                        pass
            for m in whole:
                J.log(f"{rname} · {m.name}: {len(todo[m.name])} outputs (whole run at once)", quiet)
                for n, a in _arrays(m, m.fn(data, todo[m.name])).items():
                    rs.append_whole(n, todo[m.name], a, ("time",) + dims[n], mobj[n].meta())
                rs.save()
                J.update(done=J.s["done"] + 1)
            gone = rs.prune_coords()                    # an axis nothing uses any more (a recomputed quantity moved off it)
            if gone:
                rs.save(); J.log(f"{rname}: removed unused axes {', '.join(gone)}", quiet)
            J.log(f"{rname}: done in {time.time() - t0:.0f} s -> {rs.dir}", quiet)
        J.update(state="done")
    except (StoreError, Exception) as e:
        J.update(state="failed", error=f"{type(e).__name__}: {e}", trace=traceback.format_exc()[-2000:])
        raise
    finally:
        if held:
            held.__exit__(None, None, None)
    return summary


def drop(name, run, confirm=False):
    """Delete a stored quantity of one run (files + entry). Needs confirm=True: it cannot be undone."""
    if not confirm:
        raise ValueError(f"dm.drop('{name}', '{run}', confirm=True) deletes it from the visualizer store for good")
    from .store import _atomic_write_json, prune_coords, read_manifest
    import shutil
    rname = run if isinstance(run, str) else name_of(reader_of(run).path)
    with dataset_lock(rname, wait=False):                   # not while a job writes this dataset
        m = read_manifest(config.STORE, rname)              # no need to open the run: works for derived data too
        if not m or name not in m["quantities"]:
            print(f"{name} is not stored for {rname}")
            return False
        q = m["quantities"].pop(name)
        shutil.rmtree(os.path.join(config.STORE, rname, q["path"].split("/")[0]), ignore_errors=True)
        gone = prune_coords(m)                              # axes only it used
        _atomic_write_json(os.path.join(config.STORE, rname, "manifest.json"), m)
    print(f"dropped {name} from {rname}" + (f" (and the axes only it used: {', '.join(gone)})" if gone else ""))
    return True
