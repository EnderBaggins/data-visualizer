"""line_current: current (r sinθ B_φ). Ported from visualizer/recorder/quantities.py (2026-10-07)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("time", "r_max"), label="current (r sinθ B_φ)", quantity="current", warms=('line:current',), needs=('B1', 'B2', 'B3'))
def line_current(data, steps):
    """Line-averaged r sin(theta) B_phi (= I_enc/2pi) per field line (ai_functions.line_currents, the
    current_time / current_vs_rmax plotters; cached in claude_work/cache/line_current/), r_max 1.02-30."""
    from lib.ai_functions import _L_GRID, line_currents
    _, I = line_currents(data, r_max=_L_GRID, steps=steps, progress=False)
    return I
