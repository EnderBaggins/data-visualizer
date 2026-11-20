"""Datasets as objects, measurements as attributes (human 2026-10-07: "each dataset is a class, it has methods which
are the measurements say no-pair1.twist_angle").

    ds = dm.dataset("no-pair-1")
    ds.twist_angle                    # labelled array over (time, r_max)
    ds.twist_angle.sel(r_max=3)       # -> over time
    ds.twist_angle.sel(t=40)          # -> over r_max (t = the time axis; nearest output)
    ds.B1.at(t=40)                    # maps load one output at a time
    ds["along.epar"].frame(i), ds["along.s"].frame(i)   # along a line at its own points: (r_max, pt), NaN tail
    ds.list(); ds.cache("twist_angle"); ds.data   # what is stored; compute what is missing; the raw run (as methods get it)

Reading never computes: a measurement that is not stored says so (cache it here or on the data manager page).
"""
import json
import os

import numpy as np

from . import config
from .catalog import path_of, registry


def _coord_entry(c):
    vals = np.asarray([np.nan if v is None else v for v in c["values"]], dtype=float)
    alt = {k: np.asarray([np.nan if v is None else v for v in a["values"]], dtype=float) for k, a in (c.get("alt") or {}).items()}
    return {"values": vals, "label": c.get("label", ""), "units": c.get("units", ""), "alt": alt}


class Labelled:
    """An array with named axes and their coordinates. .values, .dims, .coords; .sel(axis=value | slice(a, b))
    picks by coordinate value (nearest point; any alternative coordinate works too, e.g. theta_foot); "t" = time."""

    def __init__(self, values, dims, coords, label="", units="", quantity=""):
        self.values, self.dims, self.coords = np.asarray(values), tuple(dims), coords
        self.label, self.units, self.quantity = label, units, quantity

    @property
    def shape(self):
        return self.values.shape

    def __array__(self, dtype=None):
        return self.values.astype(dtype) if dtype else self.values

    def coord(self, name):
        """Values of an axis (or an alternative coordinate of one)."""
        dim, vals = self._resolve(name)
        return vals

    def _resolve(self, key):
        key = "time" if key == "t" else key
        if key in self.dims:
            return key, self.coords[key]["values"]
        for d in self.dims:
            if key in self.coords[d]["alt"]:
                return d, self.coords[d]["alt"][key]
        options = [*self.dims, *(a for d in self.dims for a in self.coords[d]["alt"])]
        raise KeyError(f"'{key}' is not an axis of {self.label} (axes: {', '.join(options)}; t = time)")

    def _take(self, dim, idx):
        i = self.dims.index(dim)
        vals = np.take(self.values, idx, axis=i)
        if np.ndim(idx) == 0:                         # a single point: that axis goes
            dims = self.dims[:i] + self.dims[i + 1:]
            coords = {d: c for d, c in self.coords.items() if d != dim}
        else:
            dims = self.dims
            c = self.coords[dim]
            coords = dict(self.coords, **{dim: {**c, "values": c["values"][idx], "alt": {k: v[idx] for k, v in c["alt"].items()}}})
        return Labelled(vals, dims, coords, self.label, self.units, self.quantity)

    def sel(self, **kw):
        out = self
        for key, v in kw.items():
            dim, vals = out._resolve(key)
            if isinstance(v, slice):
                lo = -np.inf if v.start is None else v.start
                hi = np.inf if v.stop is None else v.stop
                idx = np.nonzero((vals >= min(lo, hi)) & (vals <= max(lo, hi)))[0]
            else:
                idx = int(np.nanargmin(np.abs(vals - float(v))))
            out = out._take(dim, idx)
        return out

    at = sel

    def isel(self, **kw):
        out = self
        for key, i in kw.items():
            dim = "time" if key == "t" else key
            out = out._take(dim, i if isinstance(i, (int, np.integer)) else np.arange(len(out.coords[dim]["values"]))[i])
        return out

    def __repr__(self):
        ax = ", ".join(f"{d} {len(self.coords[d]['values'])}" for d in self.dims) or "a number"
        return f"<{self.label}{' [' + self.units + ']' if self.units else ''}: {ax}>"


class Stored(Labelled):
    """A stored measurement. Small ones load at once; maps (one file per output) load the outputs you ask for."""

    def __init__(self, ds, name, q, man):
        self.ds, self.name, self.q = ds, name, q
        self.label, self.units, self.quantity = q.get("label", name), q.get("units", ""), q.get("kind", "")
        self.dims = tuple(q["dims"])
        step_t = dict(zip(man["steps"], man["times"]))
        self.coords = {d: _coord_entry(man["coords"][d]) for d in self.dims if d != "time"}
        if "time" in self.dims:
            st = np.asarray(q["steps"], dtype=int)
            from .project import reader_class
            self.coords["time"] = {"values": np.asarray([step_t.get(int(s), np.nan) for s in st], dtype=float),
                                   "label": "t", "units": reader_class().time_units, "alt": {"step": st.astype(float)}}
        self._values = None

    def _space_shape(self):
        return [len(self.coords[d]["values"]) for d in self.dims if d != "time"]

    @property
    def shape(self):
        return tuple(([len(self.q["steps"])] if "time" in self.dims else []) + self._space_shape())

    def frame(self, i):
        """Output number i (an index into the stored steps) as an array over the spatial axes."""
        q = self.q
        if q["layout"] != "per_step":
            return self.values[i]
        step = q["steps"][i]
        raw = np.fromfile(os.path.join(config.STORE, self.ds.name, self.name, f"{int(step):05d}.bin"),
                          dtype="<f2" if q.get("dtype", "float16") == "float16" else "<f4")
        return (raw.astype(np.float32) * (q.get("scales") or [1.0] * len(q["steps"]))[i]).reshape(self._space_shape())

    @property
    def values(self):
        if self._values is None:
            q = self.q
            if q["layout"] == "per_step":
                n = len(q["steps"]) * int(np.prod(self._space_shape()))
                if n * 4 > 2e9:
                    raise MemoryError(f"{self.name} of {self.ds.name} is {n * 4 / 1e9:.1f} GB as one array: use .at(t=...) "
                                      "or .sel(t=slice(a, b))")
                self._values = np.stack([self.frame(i) for i in range(len(q["steps"]))])
            else:
                raw = np.fromfile(os.path.join(config.STORE, self.ds.name, self.name, "data.bin"), dtype="<f4")
                shape = ([len(q["steps"])] if "time" in self.dims else []) + self._space_shape()
                self._values = raw.reshape(shape).astype(np.float64)
        return self._values

    def sel(self, **kw):
        # maps: pick the output first, so only that file is read
        tkey = next((k for k in kw if k in ("t", "time", "step")), None)
        if self.q["layout"] == "per_step" and tkey and not isinstance(kw[tkey], slice):
            vals = self.coords["time"]["alt"]["step"] if tkey == "step" else self.coords["time"]["values"]
            i = int(np.nanargmin(np.abs(vals - float(kw[tkey]))))
            rest = {k: v for k, v in kw.items() if k != tkey}
            one = Labelled(self.frame(i), [d for d in self.dims if d != "time"],
                           {d: c for d, c in self.coords.items() if d != "time"}, self.label, self.units, self.quantity)
            return one.sel(**rest) if rest else one
        return Labelled(self.values, self.dims, self.coords, self.label, self.units, self.quantity).sel(**kw)

    at = sel

    def __repr__(self):
        lazy = " (maps: one output at a time with .at(t=...))" if self.q["layout"] == "per_step" else ""
        ax = ", ".join(f"{d} {len(self.coords[d]['values'])}" for d in self.dims)
        return f"<{self.ds.name}.{self.name}: {self.label}{' [' + self.units + ']' if self.units else ''} over {ax}{lazy}>"


class Dataset:
    def __init__(self, name):
        reg = registry()
        if name not in reg and path_of(name) is None:
            raise KeyError(f"no dataset '{name}' (known: {', '.join(sorted(reg))})")
        self.name = name
        self.info = reg.get(name, {"path": path_of(name), "kind": "simulation"})
        self.path, self.kind = self.info.get("path"), self.info.get("kind", "simulation")
        self._man, self._mt = None, None

    def manifest(self):
        p = os.path.join(config.STORE, self.name, "manifest.json")
        try:
            mt = os.path.getmtime(p)
        except OSError:
            return None
        if self._mt != mt:
            with open(p) as f:
                self._man, self._mt = json.load(f), mt
        return self._man

    @property
    def measurements(self):
        m = self.manifest()
        return sorted(m["quantities"]) if m else []

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def __getitem__(self, name):
        m = self.manifest()
        if m and name in m["quantities"]:
            return Stored(self, name, m["quantities"][name], m)
        raise AttributeError(f"'{name}' is not cached for {self.name}: {self.name}.cache('{name}') (or the data manager "
                             f"page) computes it. Cached: {', '.join(self.measurements) or 'nothing yet'}")

    def __dir__(self):
        return sorted(set(super().__dir__()) | set(self.measurements))

    def list(self):
        from .status import status
        return status(runs=[self.name])

    def cache(self, names, steps=None, rewrite=False, workers="auto"):
        from .cache import cache
        return cache(names, [self.name], steps=steps, rewrite=rewrite, workers=workers)

    def drop(self, name, confirm=False):
        from .cache import drop
        return drop(name, self.name, confirm=confirm)

    @property
    def data(self):
        """The raw run, as methods get it (Aperture4: a DataSph) — simulation datasets only."""
        if not self.path:
            raise ValueError(f"{self.name} is derived data: there is no run to open")
        from .runs import open_run
        return open_run(self.path)

    def __repr__(self):
        return f"<dataset {self.name} ({self.kind}): {len(self.measurements)} cached measurements · {self.path or self.info.get('note', '')}>"


def dataset(name):
    """A dataset by name: its cached measurements are attributes."""
    return Dataset(name)
