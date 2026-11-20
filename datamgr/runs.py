"""Opening runs and listing their outputs, through the project's reader (reader.py)."""
import os

from . import config
from .project import reader_class
from .reader import Reader


def reader_of(x):
    """A reader for a reader, or for an object your methods get (e.g. a run opened in a notebook)."""
    return x if isinstance(x, Reader) else reader_class().wrap(x)


def open_reader(run):
    """A reader for a dataset name ("baseline-19"), a run folder path, a reader, or an object methods get."""
    if not isinstance(run, str):
        return reader_of(run)
    R = reader_class()
    if os.path.isabs(run):
        return R.open(run)
    from .catalog import path_of
    p = path_of(run)
    if p is None:
        raise ValueError(f"{run} is not a simulation dataset (derived data, or unknown): there is no run to open")
    return R.open(p)


def open_run(run):
    """The run as your methods get it (the reader's native object, e.g. a DataSph), from a dataset name, a run folder
    path, or one you already have."""
    return open_reader(run).native


def run_name(data):
    return os.path.basename(os.path.normpath(reader_of(data).path))


def step_time(data, step):
    """Simulation time of output `step` (the visualizer's convention)."""
    return reader_of(data).time_of(step)


def settled_steps(data):
    """Outputs that exist and are not still being written (picks up new outputs of a running run)."""
    r = reader_of(data)
    return [int(s) for s in r.steps() if r.is_settled(s)]


def select_steps(steps, spec):
    """None -> all; "a:b:c" -> a python slice over step numbers; a list -> those steps."""
    if spec is None:
        return list(steps)
    if isinstance(spec, str):
        a, b, c = (spec.split(":") + ["", "", ""])[:3]
        rng = range(int(a or 0), int(b) if b else max(steps) + 1, int(c or 1))
        return [s for s in steps if s in rng]
    want = {int(s) for s in spec}
    return [s for s in steps if s in want]


def available_runs():
    """Run folders under DATA_ROOT (the folders the reader says are runs)."""
    try:
        names = sorted(os.listdir(config.DATA_ROOT))
    except (OSError, TypeError):
        return []
    R = reader_class()
    return [n for n in names if os.path.isdir(os.path.join(config.DATA_ROOT, n)) and R.is_run(os.path.join(config.DATA_ROOT, n))]


def n_outputs(run):
    """Number of outputs of a dataset (cheap: a directory listing), None if it has no run folder."""
    from .catalog import n_outputs as count, path_of
    return count(path_of(run))
