"""line_photons: photons emitted on each field line per R⋆/c, per unit ln r_max (2026-11-10)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("time", "r_max"), label="photons emitted per line (per ln r_max, per R⋆/c)",
             quantity="photon rate per ln r_max", warms=('line:photons',), needs=('B1', 'B2', 'B3', 'photon_produced'))
def line_photons(data, steps):
    """photon_produced (weighted count per cell since the previous output, reset after every output,
    src/systems/radiative_transfer_impl.hpp:92-93) summed over each field line's flux tube: WHERE photons are emitted,
    i.e. where particles are energetic enough to radiate (threshold scheme: gamma > gamma_thr; RCS runs: scattered
    photons above the tracking cut, so not comparable between the two schemes). Per unit ln r_max and per R⋆/c, as
    line_pairs. Human request 2026-11-10."""
    from lib.ai_functions import _L_GRID, line_values
    _, N, _, _ = line_values(data, "photons", _L_GRID, steps=steps, progress=False)
    c = data._conf
    Psi = float(c["Bp"]) / _L_GRID
    return np.asarray(N) * Psi[None, :] / (float(c["fld_output_interval"]) * float(c["dt"]))
