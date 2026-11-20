"""number_density: number density. Ported from visualizer/recorder/quantities.py (2026-10-07)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("theta", "r"), label="number density", quantity="number density", needs=('Rho_e', 'Rho_p'))
def number_density(data):
    """e± number density as plotted in the notebook: (-Rho_e + Rho_p) r^3 sin(theta) + 1e-10
    (no_pair_analysis.ipynb cell 4 `number_density`; r^3 sin(theta) scaling and the 1e-10 offset kept)."""
    return (-data.Rho_e + data.Rho_p) * data._rv**3 * np.sin(data._thetav) + 1e-10
