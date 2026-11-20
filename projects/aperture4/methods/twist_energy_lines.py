"""twist_energy_lines: twist energy E_tw = π∫ I Δφ dΨ. Ported from visualizer/recorder/quantities.py (2026-10-07)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("time",), label="twist energy E_tw = π∫ I Δφ dΨ", quantity="energy (B_φ²/2)", section="volume integrals", warms=('line:current', 'line:twist', 'line:voltage'), needs=('B1', 'B2', 'B3', 'E1', 'E2', 'E3'))
def twist_energy_lines(data, steps):
    """Twist energy int B_phi^2/2 dV built line by line (Beloborodov 2009 Eq. 19 in code units): pi int I_line dphi dPsi over r_max 1.02-30. integrals.py's twist_energy uses B^2/8pi and (B^2 - B0^2); this one is B_phi only, HL units (x 1/4pi relative to B^2/8pi)."""
    from datamgr.tools.energetics import energetics
    return energetics(data, steps)["E"]
