"""drive_twist: twist angle (drive). Ported from visualizer/recorder/quantities.py (2026-10-07)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("time", "r_max"), label="twist angle (drive)", quantity="twist angle", units="rad")
def drive_twist(data, steps):
    """Twist the surface drive imposes by time t (ai_functions.analytic_twist = the dashed lines of
    twist_time; band and ramps from the run's config, full N-S factor 2)."""
    from lib.ai_functions import _L_GRID, _step_times, analytic_twist
    return analytic_twist(data, _step_times(data, steps), _L_GRID, full=True)
