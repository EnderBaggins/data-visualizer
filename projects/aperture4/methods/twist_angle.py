"""twist_angle: twist angle (measured). Ported from visualizer/recorder/quantities.py (2026-10-07)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("time", "r_max"), label="twist angle (measured)", quantity="twist angle", units="rad", warms=('line:twist',), needs=('B1', 'B2', 'B3'))
def twist_angle(data, steps):
    """Field-line twist angle, full north->south line, signed (ai_functions.twist_angles = the solid
    lines of twist_time; coarea method, cached in claude_work/cache/twist_angle/)."""
    from lib.ai_functions import _L_GRID, twist_angles
    _, dphi = twist_angles(data, r_max=_L_GRID, steps=steps, progress=False)
    return dphi
