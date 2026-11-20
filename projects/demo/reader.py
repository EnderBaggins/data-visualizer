"""A minimal reader (the demo project): a run folder with one NumPy file per output, out.NNNNN.npz (2D arrays over
(y, x)), and run.json {"dt": time per output, "x": [...], "y": [...], any other settings}. Methods get the reader
itself as `data`; the loaded output's arrays are its attributes (data.vx, data.rho). make_demo_run.py writes one.
"""
import json
import os
import re

import numpy as np

from datamgr.reader import Reader

OUT = re.compile(r"^out\.(\d+)\.npz$")


def _outputs(path):
    try:
        return sorted(int(m.group(1)) for m in map(OUT.match, os.listdir(path)) if m)
    except (OSError, TypeError):
        return None


class NpzReader(Reader):
    name = "demo (npz)"
    runs_word = "demo runs (out.*.npz)"
    not_a_run = "is not a demo run folder (no out.*.npz)"
    grid_axes = ("y", "x")
    time_units = "s"
    raw_description = "out.*.npz array {key}"

    @classmethod
    def is_run(cls, path):
        return bool(_outputs(path))

    @classmethod
    def n_outputs(cls, path):
        o = _outputs(path)
        return None if o is None else len(o)

    @classmethod
    def field_names(cls, path):
        o = _outputs(path)
        if not o:
            return None
        with np.load(os.path.join(path, f"out.{o[0]:05d}.npz")) as f:
            return sorted(f.files)

    @classmethod
    def map_fields(cls, path):
        o = _outputs(path)
        if not o:
            return []
        with np.load(os.path.join(path, f"out.{o[0]:05d}.npz")) as f:
            return sorted(k for k in f.files if f[k].ndim == 2)

    @classmethod
    def open(cls, path):
        return cls(path)

    def __init__(self, path):
        self.path = os.path.abspath(path)
        with open(os.path.join(self.path, "run.json"), encoding="utf-8") as f:
            self.meta = json.load(f)
        self._step, self._arrays = None, {}

    def __getattr__(self, key):                      # the loaded output's arrays: data.vx, data.rho
        arrays = self.__dict__.get("_arrays", {})
        if key in arrays:
            return arrays[key]
        raise AttributeError(key)

    def steps(self):
        return _outputs(self.path) or []

    def time_of(self, step):
        return float(step) * float(self.meta["dt"])

    def load(self, step):
        p = os.path.join(self.path, f"out.{int(step):05d}.npz")
        with np.load(p) as f:                        # (a missing file raises OSError / FileNotFoundError)
            self._arrays = {k: f[k] for k in f.files}
        self._step = int(step)
        return self

    def current_step(self):
        return self._step

    def fields(self):
        return self.field_names(self.path) or []

    def grid(self):
        return {"coords": {"y": {"values": np.asarray(self.meta["y"], dtype=float), "label": "y", "units": "m"},
                           "x": {"values": np.asarray(self.meta["x"], dtype=float), "label": "x", "units": "m"}}}

    def metadata(self):
        conf = {k: v for k, v in self.meta.items() if k not in ("x", "y")}
        return {"conf": conf, "conf_all": conf}
