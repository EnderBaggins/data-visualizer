"""line_energy: twist energy stored on each field line, per unit ln r_max (2026-10-20)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("time", "r_max"), label="twist energy per field line (per ln r_max)", quantity="energy per ln r_max", warms=('line:current', 'line:twist'), needs=('B1', 'B2', 'B3'))
def line_energy(data, steps):
    """Twist energy B_phi^2/2 belonging to each field line's flux tube, per unit ln r_max: pi F dphi Psi with F the
    line-mean r sin(th) B_phi (line_current), dphi the twist (twist_angle) and Psi = B_p / r_max (Beloborodov 2009
    Eq. 19 in code units: E_tw = pi int F dphi dPsi). The area under it on a log r_max axis is the twist energy of those
    lines; its time derivative (minus) is the power each line loses from storage, to compare with line_power
    (the difference is energy carried across lines by the Poynting flux V I_enc). Human request 2026-10-20."""
    from lib.ai_functions import _L_GRID, line_values
    _, F, _, _ = line_values(data, "current", _L_GRID, steps=steps, progress=False)
    _, P, _, _ = line_values(data, "twist", _L_GRID, steps=steps, progress=False)
    Psi = float(data._conf["Bp"]) / _L_GRID
    return np.pi * np.asarray(F) * np.asarray(P) * Psi[None, :]
