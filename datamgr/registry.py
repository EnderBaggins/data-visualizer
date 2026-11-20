"""@dm.register: a method = a function that computes data for the visualizer, plus what its numbers are.

    @dm.register(axes=("theta", "r"), label="E∥/B", quantity="E∥/B")
    def Epar_over_B(data):                  # one output loaded (the object your fld_val lambdas get)
        return data.Epar / data.B           # -> array shaped like the axes; NaN = no data

    @dm.register(axes=("time", "r_max"), label="d(twist)/dt", quantity="twist rate", units="rad/(R_*/c)")
    def twist_rate(data, steps):            # time listed in axes: you get the steps, return time first
        ...

    @dm.family(axes=(LEG, GAP_DEF, "r_max"), label="gap", members={      # v8.25: one computation, several members
        "length": dict(label="length", yaxis="length along B", units="R_*"),
        "mask": dict(label="mask", yaxis="gap mask", axes=(GAP_DEF, "r_max", "s_norm"))})
    def gap(data):
        return {"length": ..., "mask": ...}      # stored as gap.length, gap.mask (one version, one cache item)

label     the name in the viewer's menus ("twist angle (drive)")
yaxis     the y-axis group: quantities in one group share a y axis and can be drawn together ("twist angle"
          for both the measured and the drive twist). Defaults to the label. (Older methods say quantity=,
          which means the same; the page can move a quantity to another group without touching the code.)
units     units of the quantity (empty: the y-axis group's units, set on the page)
axes      catalogue names (dm.AXES) or dm.Axis(...) objects; "time" only if the method needs several
          times at once (otherwise the cacher walks through time: only new outputs, resumable)
section   where the viewer lists it (default from the axes: maps, along field lines, ...)
name      default: the function's name (the name it is stored under)
warms     the caches a time-axis method reads, which the cacher fills in its shared per-output pass so that the
          method does not walk through the dumps again: names the project registers (datamgr/warm.py; Aperture4:
          "line:<q>", "twist_energy" in projects/aperture4/warm.py). Not part of the version.
needs     the dump fields it reads ("B1", "E2", "pair_produced", …): a run whose dumps lack one cannot have it, and the
          viewer does not offer it there (v11.4, 2026-11-12). Not part of the version.

The version is a fingerprint of the computation: the function's body (without its decorator and docstring) and
its axes. Change what it computes and its cached data is out of date; change its label, quantity, units or group
and nothing needs recomputing. Groups live in groups.json (editable on the data manager page).
"""
import ast
import hashlib
import importlib.util
import inspect
import os
import textwrap

import numpy as np

from . import axes as A
from . import config

METHODS = {}
LOAD_ERRORS = {}

# where a quantity is listed by default (its group / section), from its axes: the first (axis, section) of this list
# whose axis it has; a map (the reader's grid axes) is "maps", anything else "other". Filled by the project
# (add_section in its axes module).
SECTIONS = []
# raw dump fields: name -> label shown (the reader's field_labels, filled when the project loads)
FIELD_LABELS = {}


def add_section(axis, section):
    """Quantities over `axis` are listed under `section` (unless an earlier entry matches another of their axes)."""
    SECTIONS.append((axis.name if isinstance(axis, A.Axis) else axis, section))


class Method:
    def __init__(self, fn, axes, label, quantity=None, units="", section=None, name=None, dtype=None,
                 description=None, fingerprint=None, warms=(), needs=()):
        self.fn, self.name = fn, name or fn.__name__
        self.warms = tuple(warms or ())
        self.needs = tuple(needs or ())
        if isinstance(axes, (str, A.Axis)):
            axes = (axes,)
        self.axes = tuple(A.get(a) for a in axes)
        names = [a if a == A.TIME else a.name for a in self.axes]
        if A.TIME in names[1:]:
            raise ValueError(f"{self.name}: 'time' must be the first axis")
        self.time_in_axes = bool(names) and names[0] == A.TIME
        self.space = tuple(a for a in self.axes if a != A.TIME)          # the axes of one output
        self.label, self.quantity, self.units = label, quantity or label, units
        sn = [a.name for a in self.space]
        self.section = section or ("maps" if sn and tuple(sn) == A.grid_axes() else
                                   next((s for ax, s in SECTIONS if ax in sn), "other"))
        self.dtype = dtype
        self.description = description or inspect.getdoc(fn) or ""
        self.source = _source(fn)
        self.fingerprint = fingerprint or _fingerprint(self)
        self.path = None                     # the saved file, when it comes from datamgr/methods/

    @property
    def axis_names(self):
        return tuple(a if a == A.TIME else a.name for a in self.axes)

    @property
    def display_label(self):
        """The name shown in the viewer and on the page: an edited one (groups.json "labels") or the code's label."""
        from .groups import label_of
        return label_of(self.name, self.label)

    @property
    def is_raw(self):
        return self.fingerprint == "raw:1"

    @property
    def yaxis(self):
        """The y-axis group it is drawn in: groups.json "yaxis" if set on the page, else the code's quantity=."""
        from .groups import yaxis_of
        return yaxis_of(self.name, self.quantity)

    @property
    def units_shown(self):
        """Its units, or its y-axis group's units (groups.json "yunits") when the code gives none."""
        from .groups import yunits_of
        return self.units or yunits_of(self.yaxis, "")

    @property
    def group(self):
        """The group it is listed under: groups.json if set there, else the default from its axes."""
        from .groups import group_of
        return group_of(self.name, self.section)

    def meta(self):
        """What the store records about the quantity (the viewer shows label / section / kind; a family member also
        its family, which the viewer's menus group by)."""
        d = {"label": self.display_label, "units": self.units_shown, "version": self.fingerprint, "section": self.group,
             "kind": self.yaxis, "recipe": f"datamgr:{self.name}", "description": self.description}
        fam = getattr(self, "family", None)
        if fam is not None:
            d.update(family=fam.name, family_label=fam.label, member=self.member)
        return d

    def __call__(self, *a, **kw):
        return self.fn(*a, **kw)

    def __repr__(self):
        return f"<method {self.name}: {self.label} over {self.axis_names}>"


def register(axes, label, quantity=None, units="", section=None, name=None, dtype=None, description=None, yaxis=None,
             warms=(), needs=()):
    """Decorator: register a method (in this session; dm.save makes it permanent). Returns the function.
    yaxis= and quantity= are the same thing (the y-axis group); yaxis= is the name used on the page.
    warms=: the caches a time-axis method reads (datamgr/warm.py), filled in the cacher's shared pass.
    needs=: the dump fields it reads (a run without one of them cannot have it)."""
    def deco(fn):
        m = Method(fn, axes, label, yaxis or quantity, units, section, name, dtype, description, warms=warms, needs=needs)
        METHODS[m.name] = m
        fn.dm = m
        return fn
    return deco


# ---- quantity families (v8.25, human 2026-11-09: "improve quantity management … kinda like a dictionary or class
# system. for instance there is a ton of stuff in this gap most of it is cheap to compute from precached things") ---
class Family(Method):
    """One computation, several named members. The function returns a dict {member: array}; each member is stored as
    its own quantity `family.member` (same files as a method), all with the family's version, computed in one pass and
    cached as one item. Members take the family's axes unless they give their own (time stays first if the family
    has it). The viewer lists a family's members together ("gap ▸ length / voltage / …")."""

    def __init__(self, fn, axes, label, members, section=None, name=None, dtype=None, description=None, needs=()):
        super().__init__(fn, axes, label, label, "", section, name, dtype, description, fingerprint="family", needs=needs)
        if not members:
            raise ValueError(f"{self.name}: a family needs members")
        self.members = {}
        for k, spec in members.items():
            spec = dict(spec)
            ax = spec.pop("axes", None)
            if ax is None:
                ax = self.axes
            else:
                ax = (ax,) if isinstance(ax, (str, A.Axis)) else tuple(ax)
                if self.time_in_axes and (not ax or ax[0] != A.TIME):
                    ax = (A.TIME,) + ax
            m = Method(fn, ax, f"{label} · {spec.pop('label', k)}", spec.pop("yaxis", None) or spec.pop("quantity", None),
                       spec.pop("units", ""), spec.pop("section", None) or section or self.section, f"{self.name}.{k}", spec.pop("dtype", dtype),
                       spec.pop("description", None) or self.description, fingerprint="family", needs=needs)
            if spec:
                raise ValueError(f"{self.name}.{k}: unknown member settings {', '.join(spec)}")
            if m.time_in_axes != self.time_in_axes:
                raise ValueError(f"{self.name}.{k}: time must be in every member's axes or in none")
            m.family, m.member, m.source = self, k, self.source
            self.members[k] = m
        self.fingerprint = _family_fingerprint(self)
        for m in self.members.values():
            m.fingerprint = self.fingerprint

    def split(self, result):
        """The function's dict -> {member: float array}; a missing or extra member is an error."""
        if not isinstance(result, dict):
            raise TypeError(f"{self.name}: a family returns a dict of its members, got {type(result).__name__}")
        miss, extra = set(self.members) - set(result), set(result) - set(self.members)
        if miss or extra:
            raise ValueError(f"{self.name}: returned " + "; ".join(x for x in (f"no {', '.join(sorted(miss))}" if miss else "",
                                                                          f"unknown {', '.join(sorted(extra))}" if extra else "") if x))
        return {k: np.asarray(v, dtype=float) for k, v in result.items()}

    def __repr__(self):
        return f"<family {self.name}: {', '.join(self.members)}>"


def family(axes, label, members, section=None, name=None, dtype=None, description=None, needs=()):
    """Decorator: register a quantity family (members: {name: dict(label=, yaxis= | quantity=, units=, axes=, dtype=,
    section=)}). Returns the function. needs=: the dump fields it reads (every member's)."""
    def deco(fn):
        f = Family(fn, axes, label, members, section, name, dtype, description, needs)
        METHODS[f.name] = f
        for m in f.members.values():
            METHODS[m.name] = m
        fn.dm = f
        return fn
    return deco


def raw_field(key):
    """A dump dataset (B1, E2, num_e, stress_e00, ...) copied as it is: not a computation. Version "raw:1"."""
    from .project import reader_class
    R = reader_class()
    lab = FIELD_LABELS.get(key, key)
    return Method(lambda data: R.raw(data, key), A.grid_axes(), lab, lab, section="raw fields", name=key,
                  description=R.raw_description.format(key=key), fingerprint="raw:1", needs=(key,))


def method(m, raw_ok=False):
    """A Method from a name, a registered function, or a Method. raw_ok: any other name is taken as a dump field
    (the cacher then checks the run's dumps have it)."""
    if isinstance(m, Method):
        return m
    if callable(m) and hasattr(m, "dm"):
        return m.dm
    if isinstance(m, str):
        if m in METHODS:
            return METHODS[m]
        if m in FIELD_LABELS or raw_ok:
            return raw_field(m)
        raise KeyError(f"no method '{m}' (saved methods: {', '.join(sorted(METHODS)) or 'none'})")
    raise TypeError("pass a method name or a function decorated with @dm.register")


def _source(fn):
    try:
        return textwrap.dedent(inspect.getsource(fn))
    except (OSError, TypeError):
        return None


def _computation(src):
    """The function as code, without decorators, docstring, comments or layout (ast round trip)."""
    try:
        fn = next(n for n in ast.parse(src).body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)))
    except (SyntaxError, StopIteration):
        return src
    fn.decorator_list = []
    if fn.body and isinstance(fn.body[0], ast.Expr) and isinstance(getattr(fn.body[0], "value", None), ast.Constant) \
            and isinstance(fn.body[0].value.value, str):
        fn.body = fn.body[1:] or [ast.Pass()]
    return ast.unparse(fn)


def _fingerprint(m):
    code = _computation(m.source) if m.source else m.name
    axes = ";".join(a if a == A.TIME else a.key() for a in m.axes)
    return "dm:" + hashlib.sha1(f"{code}\n{axes}\n{m.dtype}".encode()).hexdigest()[:10]


def _family_fingerprint(f):
    """A family's version: its code, and every member's axes and dtype (labels and units don't count)."""
    code = _computation(f.source) if f.source else f.name
    ax = lambda axes: ";".join(a if a == A.TIME else a.key() for a in axes)
    parts = [ax(f.axes)] + [f"{k}:{ax(m.axes)}:{m.dtype}" for k, m in sorted(f.members.items())]
    return "dm:" + hashlib.sha1(f"{code}\n{'|'.join(parts)}".encode()).hexdigest()[:10]


def load_saved(directory=None):
    """Import every saved method file (the project's methods/*.py). A broken file is skipped and noted in LOAD_ERRORS."""
    d = directory or config.METHODS_DIR
    if not os.path.isdir(d):
        return
    for f in sorted(os.listdir(d)):
        if not f.endswith(".py") or f.startswith("_"):
            continue
        path = os.path.join(d, f)
        try:
            spec = importlib.util.spec_from_file_location(f"datamgr.methods.{f[:-3]}", path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            LOAD_ERRORS.pop(f, None)
        except Exception as e:                        # one broken method must not stop the others
            LOAD_ERRORS[f] = f"{type(e).__name__}: {e}"
            continue
        for obj in vars(mod).values():
            if callable(obj) and isinstance(getattr(obj, "dm", None), Method):
                obj.dm.path = path
                for m in getattr(obj.dm, "members", {}).values():
                    m.path = path
