"""line_voltage: voltage (∫E∥ dl). Ported from visualizer/recorder/quantities.py (2026-10-07)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("time", "r_max"), label="voltage (∫E∥ dl)", quantity="voltage", warms=('line:voltage',), needs=('B1', 'B2', 'B3', 'E1', 'E2', 'E3'))
def line_voltage(data, steps):
    """Field-line voltage V = int E_par dl along the full north->south line, signed, with the true line
    element dl = ds |B|/|B_pol| (ai_functions.line_values "voltage", cached in claude_work/cache/fieldline/;
    the no_pair_analysis notebook's fieldline_time(q="voltage"))."""
    from lib.ai_functions import _L_GRID, line_values
    _, V, _, _ = line_values(data, "voltage", _L_GRID, steps=steps, progress=False)
    return V
