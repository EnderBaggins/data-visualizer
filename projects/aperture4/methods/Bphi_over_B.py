"""Bphi_over_B: B_φ/B. Ported from visualizer/recorder/quantities.py (2026-10-07)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("theta", "r"), label="B_φ/B", quantity="B_φ/B", needs=('B1', 'B2', 'B3'))
def Bphi_over_B(data):
    """B_phi / |B|, the same as the viewer expression "B3 / sqrt(B1^2 + B2^2 + B3^2)"; stored because as an
    expression the browser downloads B1, B2 and B3 for every frame."""
    return data.B3 / np.sqrt(data.B1**2 + data.B2**2 + data.B3**2)
