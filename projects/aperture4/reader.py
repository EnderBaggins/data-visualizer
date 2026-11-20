"""The Aperture4 reader: a run folder with fld.NNNNN.h5 outputs, grid.h5 and config.toml, read with the plotting
library's DataSph (Aperture_plotting/datalib_logsph.py). Methods get the DataSph itself as `data`, as before the
framework was split (2026-11-20): `data.B1`, `data._conf`, `data.flux`, `data._path` … all work as they did.
"""
import os
import time

import numpy as np

from datamgr.reader import Reader

FRESH_SECONDS = 60          # a dump written less than this many seconds ago may still be being written: not cached yet
CONF_KEYS = ["Bp", "dt", "fld_output_interval", "N", "size", "lower", "downsample",
             "twist_omega", "twist_time", "twist_rmax_1", "twist_rmax_2", "atm_time"]      # shown on dataset cards


def _fld(path):
    try:
        return sorted(f for f in os.listdir(path) if f.startswith("fld.") and f.endswith(".h5"))
    except (OSError, TypeError):
        return None


def grid_coords(data):
    """Exact cell positions from the grid (axis 0 = theta, axis 1 = r)."""
    x1 = np.asarray(data.x1, dtype=np.float64)       # r sin(theta)
    x2 = np.asarray(data.x2, dtype=np.float64)       # r cos(theta)
    return np.hypot(x1[0, :], x2[0, :]), np.arctan2(x1[:, 0], x2[:, 0])


def conf_all(data):
    """Every config.toml entry that is a number, a flag, a word or a list of numbers (UI review §4.9: config
    variables could reach only the 9 recorded numbers)."""
    out = {}
    for k, v in (getattr(data, "_conf", None) or {}).items():
        if isinstance(v, (bool, int, float, str)) and not (isinstance(v, float) and not np.isfinite(v)):
            out[k] = v
        elif isinstance(v, (list, tuple)) and v and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v):
            out[k] = [float(x) if isinstance(x, float) else x for x in v]
    return out


class Aperture4Reader(Reader):
    name = "Aperture4"
    runs_word = "Aperture4 runs (fld.*.h5)"
    not_a_run = "is not an Aperture4 run folder (no fld.*.h5 / config.toml)"
    grid_axes = ("theta", "r")
    time_units = "R_*/c"
    raw_description = "fld.*.h5 dataset {key}"
    field_labels = {"B1": "B_r", "B2": "B_θ", "B3": "B_φ", "E1": "E_r", "E2": "E_θ", "E3": "E_φ",
                    "J1": "J_r", "J2": "J_θ", "J3": "J_φ", "Rho_e": "ρ_e", "Rho_p": "ρ_p",
                    "Rho_total": "ρ", "num_e": "n_e", "num_p": "n_p"}

    # ---- folders -------------------------------------------------------------------------------------------------
    @classmethod
    def is_run(cls, path):
        """An Aperture4 run folder: has fld.*.h5 outputs or a config.toml."""
        if not path or not os.path.isdir(path):
            return False
        if os.path.exists(os.path.join(path, "config.toml")) or os.path.exists(os.path.join(path, "fld.00000.h5")):
            return True
        return bool(_fld(path))

    @classmethod
    def n_outputs(cls, path):
        f = _fld(path)
        return None if f is None else len(f)

    @classmethod
    def field_names(cls, path):
        """Every dataset name in the run's first dump."""
        try:
            import h5py
        except ImportError:                                 # (no h5py here: fields unknown, nothing offered)
            return None
        files = _fld(path)
        if not files:
            return None
        try:
            with h5py.File(os.path.join(path, files[0]), "r") as f:
                return sorted(k for k, v in f.items() if isinstance(v, h5py.Dataset))
        except OSError:                                     # being written: next time
            return None

    @classmethod
    def map_fields(cls, path):
        """The 2D datasets in the dumps: raw fields that can be copied into the store (not computed)."""
        import h5py
        files = _fld(path)
        if not files:
            return []
        with h5py.File(os.path.join(path, files[0]), "r") as f:
            return sorted(k for k, v in f.items() if isinstance(v, h5py.Dataset) and v.ndim == 2)

    @classmethod
    def open(cls, path):
        from datalib_logsph import DataSph
        return cls(DataSph(path))

    @classmethod
    def wrap(cls, native):
        if isinstance(native, Reader):
            return native
        if not hasattr(native, "load_fld"):
            raise TypeError(f"the Aperture4 reader reads a DataSph, not a {type(native).__name__}")
        return cls(native)

    # ---- one run -------------------------------------------------------------------------------------------------
    def __init__(self, data):
        self.data = data

    @property
    def native(self):
        return self.data

    @property
    def path(self):
        return self.data._path

    def steps(self):
        d = self.data
        if hasattr(d, "gather_fld_steps"):
            try:
                d.gather_fld_steps()
            except Exception:                          # older DataSph: keep its list
                pass
        return list(d.fld_steps)

    def is_settled(self, step):
        p = os.path.join(self.data._path, f"fld.{int(step):05d}.h5")
        try:
            return time.time() - os.path.getmtime(p) > FRESH_SECONDS
        except OSError:
            return False

    def time_of(self, step):
        c = self.data._conf
        return float(step) * c["dt"] * c["fld_output_interval"]

    def load(self, step):
        d = self.data
        if step not in d.fld_steps:                    # (a running run: listed after this object was made)
            d.gather_fld_steps()
        d.load_fld(step)
        if d._current_fld_step != step:                # load_fld only prints when the output is missing
            raise OSError(f"output {step} is not in {d._path}")
        return d

    def current_step(self):
        return getattr(self.data, "_current_fld_step", None)

    def fields(self):
        return list(getattr(self.data, "_original_fld_keys", []) or [])

    def grid(self):
        r, theta = grid_coords(self.data)
        return {"coords": {"r": {"values": r, "label": "r", "units": "R_*", "scale": "log"},
                           "theta": {"values": theta, "label": "θ", "units": "rad"}},
                "geometry": {"spherical": {"r": "r", "theta": "theta"}}}

    def metadata(self):
        c = self.data._conf
        return {"conf": {k: c[k] for k in CONF_KEYS if k in c}, "conf_all": conf_all(self.data)}
