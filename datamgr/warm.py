"""Warming: the cacher's shared per-output pass also fills the caches that time-axis methods read (2026-11-12).

Why (claude_work/tasks/2026-11-12_cache-speed, rcs-pairs-1-ec025, 37 quantities, 401 outputs, 1708 s): every time-axis method
walked through all the dumps again on its own, and the dumps sit on a network mount that gives ~39 MB/s however many
processes read. Human 2026-11-12: "yes do all those fixes".

A method declares what it reads, in its decorator (not part of its version):

    @dm.register(axes=("time", "r_max"), ..., warms=("line:current", "line:twist"))

The names are the project's: its warm module (project.json "modules") registers a handler for each name or prefix:

    dm.register_warm("line:", compute=my_compute, cache=MyCache)     # a prefix (ends with ":") or a whole name

    compute(spec, data)  -> the cache entry of `spec` for the output `data` holds (runs in a cacher worker or the cacher)
    cache(spec, data)    -> an object with .missing(steps), .add(step, entry), .save() (the main process; one per run)

For every output the pass reads, the missing entries are computed with the same functions the method's own pass would
use, so the numbers, the stored data and the methods' versions are unchanged; the method then finds everything cached
and only assembles it. (Aperture4's: projects/aperture4/warm.py.)
"""

_HANDLERS = {}                              # name or "prefix:" -> (compute, cache class)


def register_warm(name, compute, cache):
    """Handle warm spec `name` (a whole name, or a prefix ending with ":")."""
    _HANDLERS[name] = (compute, cache)


def _handler(spec):
    if spec in _HANDLERS:
        return _HANDLERS[spec]
    for k, h in _HANDLERS.items():
        if k.endswith(":") and spec.startswith(k):
            return h
    raise ValueError(f"unknown warm spec {spec!r} (registered: {', '.join(sorted(_HANDLERS)) or 'none'})")


def specs_of(methods):
    """The warm specs the given methods declare, in a stable order."""
    return list(dict.fromkeys(w for m in methods for w in getattr(m, "warms", ())))


def compute(spec, data):
    """The cache entry of `spec` for the output `data` has loaded (runs in a cacher worker or in the cacher)."""
    return _handler(spec)[0](spec, data)


def Cache(spec, data):
    """One warm spec of one run: which outputs its cache has, the new entries, and writing them (main process)."""
    return _handler(spec)[1](spec, data)
