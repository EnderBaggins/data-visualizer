"""dm.save: make a method permanent — its code goes to datamgr/methods/<name>.py, where every notebook, the
cacher and the data manager page find it.

A saved method must stand on its own: it may use imports (numpy, your library, datamgr.tools) but not
variables or helper functions that exist only in your notebook. save() checks this and lists any such names
instead of writing a file that would break.
"""
import ast
import builtins
import datetime
import importlib
import os
import types

from . import config
from .registry import Method, load_saved, method

_HEADER_IMPORTS = {"np": "import numpy as np", "dm": "import datamgr as dm"}


def _bound_and_used(tree):
    """Names the code reads, and names it binds itself (args, assignments, imports, defs, loop targets)."""
    used, bound = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            (used if isinstance(node.ctx, ast.Load) else bound).add(node.id)
        elif isinstance(node, ast.arg):
            bound.add(node.arg)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for a in node.names:
                bound.add((a.asname or a.name).split(".")[0])
        elif isinstance(node, ast.ExceptHandler) and node.name:
            bound.add(node.name)
    return used, bound


def _import_line(name, obj):
    """An import statement that recreates notebook global `name`, or None if it cannot be imported."""
    if isinstance(obj, types.ModuleType):
        mod = obj.__name__
        return f"import {mod}" if mod == name else f"import {mod} as {name}"
    modname = getattr(obj, "__module__", None)
    qual = getattr(obj, "__name__", None)
    if modname and qual and modname not in ("__main__", "builtins") and not modname.startswith("datamgr.methods"):
        try:
            if getattr(importlib.import_module(modname), qual, None) is obj:
                return f"from {modname} import {qual}" + ("" if qual == name else f" as {name}")
        except Exception:
            return None
    return None


def needed_imports(m):
    """(import lines, names that only exist in the notebook) for the method's code."""
    tree = ast.parse(m.source)
    used, bound = _bound_and_used(tree)
    free = sorted(n for n in used - bound if not hasattr(builtins, n))
    g = getattr(m.fn, "__globals__", {})
    lines, missing = [], []
    for n in free:
        if n in _HEADER_IMPORTS and n in g and getattr(g[n], "__name__", "") in ("numpy", "datamgr"):
            continue
        if n not in g:
            missing.append(n)
            continue
        line = _import_line(n, g[n])
        (lines.append(line) if line else missing.append(n))
    return lines, missing


def save(fn, overwrite=True):
    """Write the method's code to datamgr/methods/<name>.py (and load it from there). Returns the path."""
    m = method(fn)
    if not m.source:
        raise ValueError(f"{m.name}: its source code is not available (define it with def in a cell or a file)")
    lines, missing = needed_imports(m)
    if missing:
        raise ValueError(f"{m.name} uses names that exist only in this notebook: {', '.join(missing)}. Define them "
                         "inside the function (or import them inside it), so the saved method works anywhere.")
    path = os.path.join(config.METHODS_DIR, f"{m.name}.py")
    body = (f'"""{m.name}: {m.label}. Saved with dm.save on {datetime.date.today().isoformat()}."""\n'
            + "\n".join(["import numpy as np", "import datamgr as dm", *sorted(set(lines))]) + "\n\n\n" + m.source.rstrip() + "\n")
    if os.path.exists(path) and not overwrite:
        with open(path, encoding="utf-8") as f:
            if f.read() != body:
                raise FileExistsError(f"{path} exists with other code (overwrite=True replaces it)")
    os.makedirs(config.METHODS_DIR, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(body)
    os.replace(tmp, path)
    load_saved()                                        # re-import: the saved file is now the method
    from .registry import METHODS
    saved = METHODS.get(m.name)
    if saved is None or saved.path != path:
        raise RuntimeError(f"{path} was written but did not load; see dm.LOAD_ERRORS")
    if saved.fingerprint != m.fingerprint:
        print(f"note: {m.name}'s saved code differs from the notebook's (version {saved.fingerprint})")
    print(f"saved {m.name} -> {path}")
    return path
