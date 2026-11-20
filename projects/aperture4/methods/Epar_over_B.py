"""Epar_over_B: E∥/B. Ported from visualizer/recorder/quantities.py (2026-10-07)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("theta", "r"), label="E∥/B", quantity="E∥/B", needs=('E1', 'E2', 'E3', 'B1', 'B2', 'B3'))
def Epar_over_B(data):
    """E_par / B = (E.B) / (|B| B), exactly the notebook's Epar_B (no_pair_analysis.ipynb cell 4)."""
    B2 = data.B1**2 + data.B2**2 + data.B3**2
    return (data.E1 * data.B1 + data.E2 * data.B2 + data.E3 * data.B3) / (np.sqrt(B2 + 1e-10) * np.sqrt(B2))
