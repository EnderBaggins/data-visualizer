"""datamgr — the data manager: compute data for the visualizer from simulation runs with saved, reusable methods.

The framework is general; a project folder (projects/<name>/, see config.py) holds what is specific to your data: the
reader for your files (reader.py), the axis catalogue, the methods, the building blocks they share (tools/), groups.

In a notebook (or any Python where the runs are):

    import datamgr as dm

    @dm.register(axes=("theta", "r"), label="E∥/B", yaxis="E∥/B")   # its name, its y-axis group, over which axes
    def Epar_over_B(data):                                   # data = the run at one output (like fld_val)
        return data.Epar / data.B

    dm.check(Epar_over_B, "baseline-19")       # a few outputs: small plot, numbers, cost of caching it all
    dm.save(Epar_over_B)                       # -> datamgr/methods/Epar_over_B.py (usable by name everywhere)
    dm.cache("Epar_over_B", runs=["baseline-19", "pairs-1"])   # every output -> the visualizer store
    dm.status()                                # what is stored, how big, up to date?

    dm.methods()                               # saved methods;  dm.AXES = the axis catalogue

    ds = dm.dataset("no-pair-1")               # a dataset: its stored quantities are attributes
    ds.twist_angle.sel(r_max=3)                # labelled arrays: .sel(axis=value), .at(t=...), .values

Words (the same on the page, in the viewer and here): a *dataset* is a simulation (or derived data); a *quantity*
is what is stored and plotted; a *y-axis group* is what shares a y axis (yaxis=, older code: quantity=); a *group*
is how quantities are listed.

From a terminal:  python -m datamgr status | check NAME DATASET | cache NAME --datasets A B | list
(the project: DATAMGR_PROJECT, or the one folder under projects/ next to this package)
The data manager page (visualizer header -> "data") shows the same and starts cache jobs.
See README.md.
"""
from . import config  # noqa: F401  (the project's paths; adds its import_paths to sys.path)
from .reader import Reader
from .axes import AXES, Alt, Axis
from .adopt import adopt
from .axes import add as add_axis
from .cache import cache, drop
from .check import check
from .data import Labelled, dataset
from .catalog import registry as datasets
from .groups import rename_group, set_group, set_label, set_yaxis, set_yunits
from .catalog import set_card, set_about, set_follow
from .manage import follow, health, push_label, refresh_conf, retire, sync_labels
from .registry import LOAD_ERRORS, METHODS, Family, Method, add_section, family, load_saved, method, register
from .runs import available_runs, open_reader, open_run, settled_steps
from .warm import register_warm
from .project import load as _load_project, reader_class
from .save import save
from .status import status


def methods():
    """The registered methods: name -> (label, axes)."""
    return {n: f"{m.label}  {m.axis_names}" for n, m in sorted(METHODS.items())}


def show(name, run=None):
    """Where to look at a cached quantity."""
    m = method(name)
    print(f"{m.label}: open the visualizer {config.VIEWER_URL} and pick '{m.label}' "
          f"({m.section}){' for ' + run if run else ''}.")


_load_project()                 # the reader, the axis catalogue, sections, warm specs: before the methods
load_saved()

__all__ = ["register", "family", "Family", "check", "save", "cache", "drop", "status", "adopt", "methods", "show", "Axis", "Alt", "AXES", "add_axis",
           "dataset", "datasets", "Labelled", "set_group", "rename_group", "set_label", "set_yaxis", "set_yunits",
           "set_card", "set_about", "set_follow", "follow", "health", "push_label", "refresh_conf", "retire", "sync_labels",
           "open_run", "available_runs", "settled_steps", "method", "METHODS", "Method", "LOAD_ERRORS", "load_saved",
           "Reader", "reader_class", "open_reader", "add_section", "register_warm"]
