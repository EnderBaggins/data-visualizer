"""Aperture4's warm specs (datamgr/warm.py): the cacher's shared per-output pass also fills the caches that the
time-axis methods read (2026-11-12). Loaded before the methods (project.json "modules").

Why (claude_work/tasks/2026-11-12_cache-speed, rcs-pairs-1-ec025, 37 quantities, 401 outputs, 1708 s): every time-axis method
walked through all the dumps again on its own — line_current, line_energy, line_jpar, line_power one pass each
(455 s), twist_energy seven passes, one per r_out (375 s) — and the dumps sit on a network mount that gives ~39 MB/s
however many processes read. Human 2026-11-12: "yes do all those fixes".

A method declares what it reads, in its decorator (not part of its version):

    @dm.register(axes=("time", "r_max"), ..., warms=("line:current", "line:twist"))

    line:<q>       lib.ai_functions' field-line cache of line quantity q at width 2 (line_values' default):
                   claude_work/cache/fieldline/<run>__<q>_v<n>__<reduce>_w2_e1.npz
    twist_energy   integrals.py's energy cache, twist_energy over r < 2, 3, 5, 8, 12, 20 and the whole grid (what the
                   twist_energy method asks for): scratch/_shared/energy_cache/energies_<run>.csv

For every output the pass reads, the missing entries are computed with the same functions on the same fields the
method's own pass would use (ai_functions._reduce_step on the exact-mesh view; integrals' region weights and the
first output as reference), so the numbers, the stored data and the methods' versions are unchanged. The method then
finds everything cached and only assembles it.
"""
import os

import numpy as np

from datamgr.warm import register_warm

WIDTH = 2                                   # line_values' default, what every line method uses
ENERGY_CACHE = "/data/personal/Nicholas_Rackers/claude_work/scratch/_shared/energy_cache"   # = methods/twist_energy.py
R_OUT = (2.0, 3.0, 5.0, 8.0, 12.0, 20.0, None)                                            # = methods/twist_energy.py
_REF = {}                                   # (run path, r_out) -> region + reference output, per process


def compute(spec, data):
    """The cache entry of `spec` for the output `data` has loaded (runs in a cacher worker or in the cacher)."""
    if spec.startswith("line:"):
        from lib.ai_functions import _reduce_step, _resolve, _view_at
        _, field, red, _, _ = _resolve(spec[5:], None)
        return _reduce_step(_view_at(data), field, red, WIDTH)
    if spec == "twist_energy":
        return _twist_energy(data)
    raise ValueError(f"unknown warm spec {spec!r} (line:<q> or twist_energy)")


def _twist_energy(data):
    """(time, [twist_energy over r < r_out for r_out in R_OUT]) for the loaded output: integrate_quantities' one_step
    (its region weights, the run's first output as reference, float64 sums), without reading the dump again."""
    from integrals import ENERGY_QUANTITIES, _Fields, _read_fld_h5, _region_slices
    f = ENERGY_QUANTITIES["twist_energy"]
    keys = ("B1", "B2", "B3")                       # what twist_energy reads (integrals' probe finds the same three)
    full = {k: getattr(data, k) for k in keys}
    vals = []
    for rm in R_OUT:
        k = (data._path, rm)
        if k not in _REF:
            sl, w, coords = _region_slices(data, None, rm, None, None)
            first = os.path.join(data._path, f"fld.{list(data.fld_steps)[0]:05d}.h5")
            _REF[k] = (sl, w, coords, _Fields(_read_fld_h5(first, keys, sl)[1], coords=coords))
        sl, w, coords, ref = _REF[k]
        d = _Fields({n: a[sl].astype(np.float64) for n, a in full.items()}, ref=ref, coords=coords)
        vals.append(float(np.sum(f(d) * w)))
    return float(data.time), vals


class Cache:
    """One warm spec of one run: which outputs its cache has, the new entries, and writing them (main process)."""

    def __init__(self, spec, data):
        self.spec, self.new = spec, {}
        if spec.startswith("line:"):
            from lib.ai_functions import _line_cache_load, _line_cache_path, _resolve
            tag, _, red, _, _ = _resolve(spec[5:], None)
            self.path = _line_cache_path(data, tag, red, WIDTH)
            self.have = set(_line_cache_load(self.path))
        elif spec == "twist_energy":
            from integrals import _region_tag, _run_key
            self.path = os.path.join(ENERGY_CACHE, f"energies_{_run_key(data)}.csv")
            self.cols = [f"twist_energy_{_region_tag(None, rm, None, None)}" for rm in R_OUT]
            df = self._read()
            ok = df[self.cols + ["time"]].notna().all(axis=1) if set(self.cols + ["time"]) <= set(df.columns) else []
            self.have = {int(s) for s, good in zip(df.index, ok) if good}
        else:
            raise ValueError(f"unknown warm spec {spec!r} (line:<q> or twist_energy)")

    def _read(self):
        import pandas as pd
        if os.path.exists(self.path) and os.path.getsize(self.path) > 0:
            return pd.read_csv(self.path, index_col="step")
        return pd.DataFrame(index=pd.Index([], name="step"))

    def missing(self, steps):
        return [s for s in steps if s not in self.have]

    def add(self, step, entry):
        self.new[int(step)] = entry

    def save(self):
        """Write the new entries (merged with what is on disk now) and forget them."""
        if not self.new:
            return
        if self.spec.startswith("line:"):
            from lib.ai_functions import _line_cache_save
            _line_cache_save(self.path, self.new)
        else:                                       # integrate_quantities' layout: index step, a column per quantity+region
            df = self._read()
            df = df.reindex(sorted(set(df.index) | set(self.new)))
            df.index.name = "step"
            for c in self.cols + ["time"]:
                if c not in df.columns:
                    df[c] = np.nan
            for s, (t, vals) in self.new.items():
                df.loc[s, "time"] = t
                for c, v in zip(self.cols, vals):
                    df.loc[s, c] = v
            os.makedirs(ENERGY_CACHE, exist_ok=True)
            tmp = f"{self.path}.{os.getpid()}.tmp"
            df.to_csv(tmp)
            os.replace(tmp, self.path)
        self.have |= set(self.new)
        self.new = {}


register_warm("line:", compute, Cache)
register_warm("twist_energy", compute, Cache)
