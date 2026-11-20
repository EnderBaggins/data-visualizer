"""line_pairs: pairs created on each field line per R⋆/c, per unit ln r_max (2026-11-10)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("time", "r_max"), label="pairs created per line (per ln r_max, per R⋆/c)",
             quantity="pair rate per ln r_max", warms=('line:pairs',), needs=('B1', 'B2', 'B3', 'pair_produced'))
def line_pairs(data, steps):
    """pair_produced (weighted count per cell since the previous output; the code resets it after every output,
    src/systems/radiative_transfer_impl.hpp:92-93) summed over each field line's flux tube: WHERE pairs appear. Per
    unit ln r_max (the area under it on a log r_max axis is the count of those lines) and per R⋆/c (divided by the
    output interval, fld_output_interval * dt), so runs with different output cadence compare. Line label as
    line_power (coarea, Psi = B_p / r_max; ai_functions line quantity "pairs"). Human request 2026-11-10: per-line
    pair production for the viewer (chen-1: the inner edge of the pair band switches fully off, the core does not)."""
    from lib.ai_functions import _L_GRID, line_values
    _, N, _, _ = line_values(data, "pairs", _L_GRID, steps=steps, progress=False)
    c = data._conf
    Psi = float(c["Bp"]) / _L_GRID
    return np.asarray(N) * Psi[None, :] / (float(c["fld_output_interval"]) * float(c["dt"]))
