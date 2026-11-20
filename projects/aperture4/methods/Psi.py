"""Psi: Ψ (flux function). Ported from visualizer/recorder/quantities.py (2026-10-07)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("theta", "r"), label="Ψ (flux function)", quantity="Ψ", needs=('B1',))
def Psi(data):
    """Flux function Psi = cumsum_theta(B_r r^2 sin(theta) dtheta) from the north pole, the same array
    draw_field_line contours (DataSph `flux`). Field line with apex r_max: Psi = Psi(theta_foot, r=1)."""
    return data.flux
