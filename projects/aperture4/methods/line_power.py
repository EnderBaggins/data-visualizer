"""line_power: E·J summed over each field line's flux tube, per unit ln r_max (2026-10-20)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("time", "r_max"), label="E·J per field line (per ln r_max)", quantity="power per ln r_max", warms=('line:edotj',), needs=('B1', 'B2', 'B3', 'E1', 'E2', 'E3', 'J1', 'J2', 'J3'))
def line_power(data, steps):
    """The field's work on the particles (E.J, the EdotJ map) summed over the flux tube of each field line: which lines
    dissipate. Per unit ln r_max, so the area under it on a log r_max axis is the total power of those lines; summed
    over all lines it is the volume integral of E.J (minus the open lines beyond 0.9 r_out). Signed (> 0 = field ->
    particles). = 2 pi Psi int (E.J/|B|) dl with Psi = B_p / r_max (coarea; ai_functions line quantity "edotj").
    Equals 2 pi Psi V dF/dPsi (voltage x current on the line) when E.J = E_par j_par. Human request 2026-10-20."""
    from lib.ai_functions import _L_GRID, line_values
    _, W, _, _ = line_values(data, "edotj", _L_GRID, steps=steps, progress=False)
    Psi = float(data._conf["Bp"]) / _L_GRID
    return 2 * np.pi * np.asarray(W) * Psi[None, :]
