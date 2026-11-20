"""Loading the project: its reader class and its modules (axis catalogue, sections, warm specs), before the methods.

The project folder is imported as the package `datamgr_project` (so its files can import each other:
`from .reader import grid_coords`); its tools/ folder is `datamgr.tools` (methods: `from datamgr.tools.x import f`).
A module that fails to load is noted in registry.LOAD_ERRORS ("project:<file>") and the rest still loads.
"""
import importlib
import os
import sys
import types

from . import config
from .reader import Reader

PKG = "datamgr_project"
_READER = []


def _package():
    if PKG not in sys.modules and config.PROJECT_DIR:
        pkg = types.ModuleType(PKG)
        pkg.__path__ = [config.PROJECT_DIR]
        pkg.__file__ = os.path.join(config.PROJECT_DIR, "__init__.py")
        sys.modules[PKG] = pkg
    return sys.modules.get(PKG)


def _module(filename):
    _package()
    return importlib.import_module(f"{PKG}.{os.path.splitext(filename)[0].replace('/', '.')}")


def reader_class():
    """The project's reader class (the base Reader, which opens nothing, when there is no project)."""
    if not _READER:
        cls = Reader
        if config.READER and config.PROJECT_DIR:
            fname, _, cname = config.READER.partition(":")
            cls = getattr(_module(fname), cname)
            if not (isinstance(cls, type) and issubclass(cls, Reader)):
                raise TypeError(f"{config.READER}: not a datamgr.Reader subclass")
        _READER.append(cls)
    return _READER[0]


def load():
    """Import the reader and the project's modules; fill the raw-field labels from the reader."""
    from .registry import FIELD_LABELS, LOAD_ERRORS
    if not config.PROJECT_DIR:
        return
    for f in ([config.READER.partition(":")[0]] if config.READER else []) + config.MODULES:
        try:
            if f == (config.READER or "").partition(":")[0]:
                FIELD_LABELS.update(reader_class().field_labels)
            else:
                _module(f)
            LOAD_ERRORS.pop(f"project:{f}", None)
        except Exception as e:                       # the framework still starts (status, the page)
            LOAD_ERRORS[f"project:{f}"] = f"{type(e).__name__}: {e}"
