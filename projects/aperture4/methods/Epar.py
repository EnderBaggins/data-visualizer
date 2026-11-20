"""Epar: E∥ = (E.B)/|B| as a 2D map. Added 2026-10-30 (human: "give me E// as an option then")."""
import numpy as np
import datamgr as dm

@dm.register(axes=("theta", "r"), label="E∥", quantity="E∥", needs=('E1', 'E2', 'E3', 'B1', 'B2', 'B3'))
def Epar(data):
    """E_par = (E.B) / |B|: Epar_over_B without the second 1/|B|. Same quantity as epar_along (that one is along the lines)."""
    B2 = data.B1**2 + data.B2**2 + data.B3**2
    return (data.E1 * data.B1 + data.E2 * data.B2 + data.E3 * data.B3) / np.sqrt(B2 + 1e-10)
