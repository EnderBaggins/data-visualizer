"""speed: |v| of the demo flow (a map) and its largest value per output (one number per output)."""
import numpy as np
import datamgr as dm


@dm.register(axes=("y", "x"), label="|v|", yaxis="speed", units="m/s", needs=("vx", "vy"))
def speed(data):
    """|v| = sqrt(vx^2 + vy^2) at every grid point."""
    return np.hypot(data.vx, data.vy)


@dm.register(axes=(), label="max |v|", yaxis="speed", units="m/s", needs=("vx", "vy"))
def speed_max(data):
    """The largest |v| on the grid."""
    return np.nanmax(np.hypot(data.vx, data.vy))
