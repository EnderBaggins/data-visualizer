"""Axes: the named coordinates data is stored over. One catalogue, so the same name always means the same
numbers in every method and run (that is what lets the visualizer line quantities up).

    dm.Axis("r_out", [2, 3, 5, 8, 12, 20], label="r_out", units="R_*", scale="log")      # ad hoc axis
    dm.Axis("r_max", values, label="r_max", units="R_*",
            alt={"theta_foot": dm.Alt(lambda r: np.degrees(np.arcsin(r ** -0.5)), "θ_foot", "deg")})

`values` is a list / array, or a function of the run (data) -> array (e.g. read off the grid).
An alternative coordinate (Alt) is computed from the axis values: the data is stored once, over the axis,
and the viewer can show or pick it in either coordinate. Keep it one-to-one (rising or falling), so a
value typed in the alternative coordinate finds one point.

"time" is special: the outputs of the run (added by the cacher; list it in a method's axes only if the
method needs several times at once). The catalogue itself is the project's (e.g. projects/aperture4/axes.py, loaded
before the methods); the axes of a map are the reader's `grid_axes`.
"""
import hashlib

import numpy as np


class Alt:
    """An alternative coordinate of an axis: fn(axis values) -> values of the same length."""

    def __init__(self, fn, label=None, units=""):
        self.fn, self.label, self.units = fn, label, units


class Axis:
    """names (v8.25): a name for each value of a categorical axis — dm.Axis("leg", [1, 2], names=["north", "south"]);
    the viewer shows the names in picks and legends. Only display: renaming does not change the data's version."""

    def __init__(self, name, values, label=None, units="", scale="linear", alt=None, doc="", names=None):
        self.name, self.values, self.label, self.units = name, values, label or name, units
        self.scale, self.alt, self.doc = scale, dict(alt or {}), doc
        self.names = list(names) if names is not None else None
        if self.names is not None and not callable(values) and len(self.names) != len(values):
            raise ValueError(f"axis {name}: {len(self.names)} names for {len(values)} values")

    def values_for(self, data=None):
        v = self.values(data) if callable(self.values) else self.values
        return np.asarray(v, dtype=float)

    def coord(self, data=None):
        """The store's coordinate entry: {values, label, units, scale, alt, names}."""
        v = self.values_for(data)
        alt = {k: {"values": np.asarray(a.fn(v), dtype=float), "label": a.label or k, "units": a.units}
               for k, a in self.alt.items()}
        return {"values": v, "label": self.label, "units": self.units, "scale": self.scale, "alt": alt or None,
                "names": self.names}

    def key(self):
        """What the axis means (part of a method's version): name, labels, and its numbers when fixed."""
        vals = "run-dependent" if callable(self.values) else hashlib.sha1(np.asarray(self.values, dtype=float).tobytes()).hexdigest()[:12]
        return f"{self.name}|{self.label}|{self.units}|{self.scale}|{vals}|{sorted(self.alt)}"

    def __repr__(self):
        return f"Axis({self.name!r}, label={self.label!r}, units={self.units!r})"


TIME = "time"
AXES = {}


def grid_axes():
    """The axes of a map, in array order (the project reader's grid_axes; () without a project)."""
    from .project import reader_class
    return tuple(reader_class().grid_axes)


def add(axis):
    """Put an axis in the catalogue (by its name)."""
    AXES[axis.name] = axis
    return axis


def get(a):
    """An Axis from a catalogue name or an Axis; "time" stays the string "time"."""
    if isinstance(a, Axis) or a == TIME:
        return a
    if a not in AXES:
        raise KeyError(f"no axis '{a}' in the catalogue ({', '.join(sorted(AXES))}); pass a dm.Axis(...) for a new one")
    return AXES[a]
