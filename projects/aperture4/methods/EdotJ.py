"""EdotJ: E·J, the work the field does on the particles (2026-10-20)."""
import numpy as np
import datamgr as dm

@dm.register(axes=("theta", "r"), label="E·J (field work on particles)", quantity="E·J", needs=('E1', 'E2', 'E3', 'J1', 'J2', 'J3'))
def EdotJ(data):
    """E.J = E1 J1 + E2 J2 + E3 J3 from the dumped total E and the dumped (filtered) J, code units. With the code's
    Maxwell equations (dE/dt = curl B - J) the field energy density is (E^2 + B^2)/2 and Poynting's theorem reads
    -d/dt (E^2 + B^2)/2 = div(E x B) + E.J, so E.J > 0 is field energy given to the particles (dissipation, ohmic
    heating / acceleration) and E.J < 0 is particle energy returned to the field. Human request 2026-10-20 ("store
    EdotJ … connected to the poynting"). The dumped J is the one the next solver step uses (one step offset)."""
    return data.E1 * data.J1 + data.E2 * data.J2 + data.E3 * data.J3
