"""dm.check: is my computation working? A few outputs only (no caching), a small plot, the numbers, and
what caching every output would cost.

    dm.check(Epar_over_B, baseline19)                  # 3 outputs spread over the run
    dm.check("twist_angle", "pairs-1", steps=[20, 40])
"""
import time

import numpy as np

from . import axes as A
from . import config
from .registry import Family, method
from .runs import open_reader, reader_of, run_name, settled_steps, step_time


def expected_shape(m, data):
    return tuple(len(a.values_for(data)) for a in m.space)


def layout_for(m, data):
    """How the cacher stores it: one file per output (big per-output data, float16 like the maps) or one array."""
    n = int(np.prod(expected_shape(m, data))) if m.space else 1
    if not m.time_in_axes and n >= config.PER_STEP_MIN_VALUES:
        return "per_step", (m.dtype or "float16")
    return "whole", "float32"


def compute(m, data, steps):
    """[(step, array, seconds)] for the given outputs (restores the step the run object had loaded). data: a reader,
    or the object methods get."""
    out = []
    reader = reader_of(data)
    data = reader.native
    previous = reader.current_step()
    try:
        fam = isinstance(m, Family)                     # v8.25: a family gives {member: array}
        if m.time_in_axes:
            t0 = time.time()
            r = m.fn(data, list(steps))
            dt = (time.time() - t0) / max(1, len(steps))
            parts = m.split(r) if fam else {m.name: np.asarray(r, dtype=float)}
            for k, a in parts.items():
                if a.ndim == 0 or a.shape[0] != len(steps):
                    raise ValueError(f"{m.name}{'.' + k if fam else ''} returned shape {a.shape}; with time in its axes the "
                                     f"first axis must be the {len(steps)} steps asked for")
            out = [(s, {k: a[i] for k, a in parts.items()} if fam else parts[m.name][i], dt) for i, s in enumerate(steps)]
        else:
            for s in steps:
                reader.load(s)
                t0 = time.time()
                r = m.fn(data)
                out.append((s, m.split(r) if fam else np.asarray(r, dtype=float), time.time() - t0))
    finally:
        if previous is not None and not m.time_in_axes:
            try:
                reader.load(previous)
            except OSError:
                pass
    return out


def check(fn, data, steps=None, plot=True, n=3):
    """Run method `fn` (a registered function or a name) on a few outputs of `data` (a run name, a path, or an opened
    run). A family (or one of its members) is computed once and each member is checked (v8.25)."""
    m, reader = method(fn), open_reader(data)
    data = reader.native
    m = getattr(m, "family", None) or m
    run, avail = run_name(data), settled_steps(data)
    if steps is None:
        steps = sorted({avail[int(round(i))] for i in np.linspace(0, len(avail) - 1, n)}) if avail else []
    steps = [int(s) for s in steps]
    results = compute(m, reader, steps)
    if isinstance(m, Family):
        print(f"{m.name}: a family of {len(m.members)} ({', '.join(m.members)}), computed together; the times below "
              f"are the whole family's")
        out = {k: _report(p, data, run, avail, [(s, a[k], dt) for s, a, dt in results], plot) for k, p in m.members.items()}
        return {"ok": all(r["ok"] for r in out.values()), "members": out}
    return _report(m, data, run, avail, results, plot)


def _report(m, data, run, avail, results, plot):
    """Shape, NaN and timing checks of one stored quantity's results, printed; the cost of caching every output."""
    want = expected_shape(m, data)
    problems, rows = [], []
    for s, a, dt in results:
        finite = np.isfinite(a)
        if a.shape != want:
            problems.append(f"step {s}: shape {a.shape}, the axes {tuple(x.name for x in m.space)} say {want}")
        if not finite.any():
            problems.append(f"step {s}: no finite values")
        rows.append({"step": s, "t": step_time(data, s), "shape": a.shape, "seconds": dt,
                     "min": float(np.nanmin(a)) if finite.any() else np.nan,
                     "max": float(np.nanmax(a)) if finite.any() else np.nan,
                     "nan %": 100.0 * (1 - finite.mean()) if a.size else 100.0})
    per = float(np.mean([r["seconds"] for r in rows])) if rows else 0.0
    layout, dtype = layout_for(m, data)
    nbytes = len(avail) * int(np.prod(want) if want else 1) * (2 if dtype == "float16" else 4)
    est = {"outputs": len(avail), "seconds": per * len(avail), "MB": nbytes / 1e6, "layout": layout, "dtype": dtype}

    print(f"{m.name}: {m.label}  [{m.quantity}{', ' + m.units if m.units else ''}]  axes {m.axis_names}  ({run})")
    for r in rows:
        print(f"  step {r['step']:>5} (t = {r['t']:.4g}): shape {r['shape']}, min {r['min']:.4g}, max {r['max']:.4g}, "
              f"NaN {r['nan %']:.1f} %, {r['seconds']:.2f} s")
    print(f"  caching all {est['outputs']} outputs: ≈ {est['MB']:.1f} MB ({layout}, {dtype}), ≈ {est['seconds'] / 60:.1f} min "
          f"(from the time of these {len(rows)})")
    print("  ✔ looks consistent" if not problems else "  ⚠ " + "\n  ⚠ ".join(problems))
    if plot and results:
        _plot(m, data, results)
    return {"ok": not problems, "problems": problems, "steps": rows, "estimate": est,
            "values": {s: a for s, a, _ in results}}


def _plot(m, data, results):
    import matplotlib.pyplot as plt
    k = len(results) if m.space else 1                          # no spatial axes: one plot of all outputs
    fig, axs = plt.subplots(1, k, figsize=(4.2 * k, 3.4), squeeze=False)
    names = [a.name for a in m.space]
    grid = reader_of(data).grid() if names and tuple(names) == A.grid_axes() else None
    for ax, (s, a, _) in zip(axs[0], results[:k]):
        ax.set_title(f"{m.label} · t = {step_time(data, s):.4g}", fontsize=9)
        if grid is not None:                                    # a map: meridional plane if the grid is (θ, r)
            fin = a[np.isfinite(a)]
            signed = fin.size and fin.min() < 0 < fin.max()
            lim = np.nanpercentile(np.abs(fin), 99) if fin.size else 1
            kw = dict(shading="auto", cmap="RdBu_r" if signed else "viridis", vmin=-lim if signed else None, vmax=lim if signed else None)
            c = {n: np.asarray(grid["coords"][n]["values"], dtype=float) for n in names}
            sph = (grid.get("geometry") or {}).get("spherical")
            if sph and {sph["r"], sph["theta"]} == set(names):
                mesh = np.meshgrid(*(c[n] for n in names), indexing="ij")
                r, th = (mesh[names.index(sph["r"])], mesh[names.index(sph["theta"])])
                x1, x2 = r * np.sin(th), r * np.cos(th)
                im = ax.pcolormesh(x1, x2, a, **kw)
                ax.set_aspect("equal"); ax.set_xlim(0, min(12, np.nanmax(x1))); ax.set_ylim(-min(9, np.nanmax(x2)), min(9, np.nanmax(x2)))
            else:                                               # any other grid: first axis up, second across
                im = ax.pcolormesh(c[names[1]], c[names[0]], a, **kw)
                ax.set_xlabel(grid["coords"][names[1]].get("label", names[1])); ax.set_ylabel(grid["coords"][names[0]].get("label", names[0]))
            fig.colorbar(im, ax=ax, shrink=0.8)
        elif len(m.space) == 0:                                 # one number per output
            ax.plot([step_time(data, r[0]) for r in results], [float(r[1]) for r in results], "o-")
            ax.set_xlabel("t")
        elif len(m.space) == 1:
            x = m.space[0].values_for(data)
            ax.plot(x, a)
            ax.set_xlabel(m.space[0].label)
            if m.space[0].scale == "log":
                ax.set_xscale("log")
        else:                                                   # 2+ axes: lines over the last, one per first-axis value
            x = m.space[-1].values_for(data)
            first = m.space[0].values_for(data)
            b = a.reshape(len(first), -1, len(x))[:, 0, :]
            if len(first) <= 12:
                for v, row in zip(first, b):
                    ax.plot(x, row, label=f"{m.space[0].label} = {v:.3g}")
                ax.legend(fontsize=6)
            else:
                ax.imshow(b, aspect="auto", origin="lower")
            ax.set_xlabel(m.space[-1].label)
    fig.tight_layout()
    plt.show()
    return fig
