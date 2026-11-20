"""line_jpar: current density j∥/B per field line (2026-10-15)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("time", "r_max"), label="current density (j∥/B)", quantity="j∥/B", warms=('line:jpar',), needs=('B1', 'B2', 'B3', 'J1', 'J2', 'J3'))
def line_jpar(data, steps):
    """Line-averaged j_par/B = (J.B)/|B|^2 per field line, r_max 1.02-30: the current that flows ON each line, the
    density counterpart of line_current (the enclosed current F = r sin(theta) B_phi). Constant along a line where
    the current follows B; for a force-free field it equals dF/dPsi with Psi = B_p / r_max, so it is zero where
    line_current is flat (a current-free cavity). Human request 2026-10-15. ai_functions.line_values("jpar"),
    cached in claude_work/cache/fieldline/."""
    from lib.ai_functions import _L_GRID, line_values
    _, J, _, _ = line_values(data, "jpar", _L_GRID, steps=steps, progress=False)
    return J
