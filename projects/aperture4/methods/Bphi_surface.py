"""Bphi_surface: B_φ on surface. Ported from visualizer/recorder/quantities.py (2026-10-07)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("surface_theta",), label="B_φ on surface", quantity="B_φ", needs=('B3',))
def Bphi_surface(data):
    """B_phi at the grid point nearest r = R_* (r index 0, r = 1.002), northern hemisphere, vs footpoint
    colatitude (what surface_points samples; notebook cell 40). Read straight from the dump."""
    import os
    import h5py
    theta = np.arctan2(np.asarray(data.x1)[:, 0], np.asarray(data.x2)[:, 0])
    with h5py.File(os.path.join(data._path, f"fld.{data._current_fld_step:05d}.h5"), "r") as f:
        return f["B3"][:, 0][theta < np.pi / 2]
