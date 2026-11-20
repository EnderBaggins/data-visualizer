"""twist_energy: twist energy. Ported from visualizer/recorder/quantities.py (2026-10-07)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("time", "r_out"), label="twist energy", quantity="energy", warms=('twist_energy',), needs=('B1', 'B2', 'B3'))
def twist_energy(data, steps):
    """Volume integral of (B^2 - B0^2)/2 (the code's rationalized units; 4pi rescale 2026-11-20) over R_* < r < r_out (integrals.integrate_quantities, the
    energy_series plotter's "twist_energy"; cached in claude_work/scratch/_shared/energy_cache/).
    r_out = 2, 3, 5, 8, 12, 20 and the whole grid (largest value)."""
    from integrals import integrate_quantities
    cache_dir = "/data/personal/Nicholas_Rackers/claude_work/scratch/_shared/energy_cache"
    allsteps, cols = list(data.fld_steps), []
    for rm in (2.0, 3.0, 5.0, 8.0, 12.0, 20.0, None):
        _, vals = integrate_quantities(data, "twist_energy", rmax=rm, cache_dir=cache_dir, progress=False)
        y = np.asarray(vals["twist_energy"], dtype=float)
        cols.append([y[allsteps.index(s)] for s in steps])
    return np.array(cols).T
