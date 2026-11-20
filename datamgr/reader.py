"""The reader: everything the data manager knows about your simulation's files. One subclass per kind of output, in
your project folder (reader.py), named in project.json ("reader": "reader.py:MyReader").

The framework never opens a file itself: it asks the reader which folders are runs, which outputs exist, when an
output is complete, its time, the grid, and the run's settings; it hands the reader's `native` object to your
methods (the `data` they get) after load(step).

    class MyReader(dm.Reader):
        name = "my code"
        grid_axes = ("y", "x")                         # a map's axes, in array order
        time_units = "1/ω_p"

        @classmethod
        def is_run(cls, path): return os.path.exists(os.path.join(path, "out.0000.npz"))
        @classmethod
        def open(cls, path): return cls(path)
        def steps(self): ...                           # [0, 1, 2, ...]
        def time_of(self, step): ...
        def load(self, step): ...; return self         # methods then read data.<field>
        def grid(self): return {"coords": {"y": {...}, "x": {...}}}

What each call must do is in its docstring below; the defaults work for a run folder with one file per output.
"""
import os


class Reader:
    """Base class (and the "no project" reader: it opens nothing)."""

    name = "no reader"                       # shown on the page
    runs_word = "runs"                       # the page's scan: "no <runs_word> there"
    not_a_run = "is not a run folder"        # add-dataset's refusal: "<path> <not_a_run>"
    grid_axes = ()                           # the axes of a map, in array order (their coordinates: grid())
    time_units = ""                          # units of the time axis (data.py's labelled arrays)
    field_labels = {}                        # raw field name -> label shown ({"B1": "B_r"})
    raw_description = "dataset {key}"        # the description stored with a copied raw field

    # ---- folders (no run opened) -------------------------------------------------------------------------------
    @classmethod
    def is_run(cls, path):
        """Whether folder `path` is a run this reader can open."""
        return False

    @classmethod
    def n_outputs(cls, path):
        """How many outputs the run folder has (cheap: a listing), None if it has no folder."""
        return None

    @classmethod
    def field_names(cls, path):
        """Every field name in the run's outputs (the first output is enough), None if there is no output yet. The
        viewer offers a method only where its `needs=` are all here; the framework remembers the answer per folder."""
        return None

    @classmethod
    def map_fields(cls, path):
        """The fields that can be copied into the store as they are (raw maps over grid_axes)."""
        return []

    @classmethod
    def open(cls, path):
        """A reader for the run in folder `path`."""
        raise RuntimeError("no data manager project is set up (DATAMGR_PROJECT, or projects/<name>/project.json): "
                           "there is no reader to open runs with")

    @classmethod
    def wrap(cls, native):
        """A reader for an object your methods get (e.g. one opened in a notebook). Default: `native` is a reader."""
        if isinstance(native, Reader):
            return native
        raise TypeError(f"{cls.__name__} cannot read a {type(native).__name__}")

    @classmethod
    def raw(cls, native, key):
        """Field `key` of the loaded output, as it is in the dump (copied by `cache` with no method)."""
        return getattr(native, key)

    # ---- one run -----------------------------------------------------------------------------------------------
    path = None                              # the run folder (absolute)

    @property
    def native(self):
        """What methods get as `data` (load(step) puts that output in it). Default: the reader itself."""
        return self

    def steps(self):
        """The outputs that exist now, ascending (listed again on every call: a running run grows)."""
        raise NotImplementedError

    def is_settled(self, step):
        """Whether output `step` is completely written (a running simulation may still be writing the newest)."""
        return True

    def time_of(self, step):
        """Simulation time of output `step`."""
        raise NotImplementedError

    def load(self, step):
        """Load output `step` into `native` and return `native`. Raise OSError if it cannot be read."""
        raise NotImplementedError

    def current_step(self):
        """The output `native` holds now (None: none)."""
        return None

    def fields(self):
        """Field names in this run's outputs ([]: unknown, nothing is skipped for lack of a field)."""
        return []

    def grid(self):
        """The grid: {"coords": {name: {"values", "label", "units", "scale"}}, "geometry": {...}}; coords in the store's
        order, one per grid axis. geometry (optional, see FORMAT.md): {"spherical": {"r": <axis>, "theta": <axis>}}
        lets the viewer draw (θ, r) maps in the meridional plane."""
        return {"coords": {}, "geometry": {}}

    def metadata(self):
        """{"conf": a few settings shown on dataset cards, "conf_all": every setting that is a number, flag, word or
        list of numbers (the viewer's config variables)}."""
        return {"conf": {}, "conf_all": {}}
