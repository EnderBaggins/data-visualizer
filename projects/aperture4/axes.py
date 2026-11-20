"""The Aperture4 axis catalogue (the same numbers the visualizer store already uses) and where quantities over them
are listed. Loaded before the methods (project.json "modules"). An axis's name, label, units, scale, numbers and
alternative names are part of the version of every method over it: change one and their data shows out of date.
"""
import numpy as np

from datamgr.axes import Alt, Axis, add
from datamgr.registry import add_section

from .reader import grid_coords


def _theta_foot_deg(r_max):
    return np.degrees(np.arcsin(np.sqrt(1.0 / np.asarray(r_max, dtype=float))))


def _surface_theta(data):
    _, theta = grid_coords(data)
    return theta[theta < np.pi / 2]                     # northern hemisphere


def _r_out(data):
    c = data._conf
    return [2.0, 3.0, 5.0, 8.0, 12.0, 20.0, float(np.exp(c["lower"][0] + c["size"][0]))]   # last = whole grid


# ---- the catalogue (the same numbers the visualizer store already uses) -----------------------------------
add(Axis("theta", lambda d: grid_coords(d)[1], label="θ", units="rad", doc="grid colatitude"))
add(Axis("r", lambda d: grid_coords(d)[0], label="r", units="R_*", scale="log", doc="grid radius"))
add(Axis("r_max", np.geomspace(1.02, 30.0, 104), label="r_max", units="R_*", scale="log",
         alt={"theta_foot": Alt(_theta_foot_deg, "θ_foot", "deg")},
         doc="field lines by apex radius (ai_functions._L_GRID)"))
add(Axis("r_max_line", (1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0), label="r_max (line)", units="R_*",
         alt={"theta_foot": Alt(_theta_foot_deg, "θ_foot", "deg")},
         doc="RETIRED 2026-10-13: the 8 lines the along-line profiles used before; they now use r_max (all 104 "
             "lines). Kept so data stored over it still reads."))
add(Axis("s_norm", np.linspace(0.0, 1.0, 200), label="s/s_max (N→S)",
         doc="arc length along a field line, north footpoint 0, south footpoint 1"))
# v8.28 (human 2026-11-09: "make all of the along field lines data saved naturally as along s … I fear there may be some
# bad conversion"): the traced line's own points, no resampling. Point k = the line's k-th crossing of a grid cell edge
# from the north footpoint; where it is along the line is the family member `s` (R_*). 2,048 slots: the most any closed
# line had is 1,716 (claude_work/tasks/2026-11-09_along-s-check); a longer line is an error, never cut.
add(Axis("pt", np.arange(2048), label="point along the line (N→S)",
         doc="the traced field line's own points (its crossings of the grid's cell edges), north footpoint first; the "
             "arc length s of each is stored with it (family member s); NaN past the line's last point"))
add(Axis("surface_theta", _surface_theta, label="θ (surface)", units="rad",
         alt={"theta_foot": Alt(np.degrees, "θ_foot", "deg"),
              "r_max": Alt(lambda th: 1.0 / np.sin(th) ** 2, "r_max", "R_*")},
         doc="grid colatitudes of the northern hemisphere at the surface (r index 0)"))
add(Axis("r_out", _r_out, label="r_out", units="R_*", scale="log",
         doc="outer radius of a volume integral (last value = the whole grid)"))

# ---- where a quantity is listed by default (its group), from its axes: the first axis of this list that it has ----
for _axis, _section in (("s_norm", "along one field line"), ("pt", "along one field line"),
                        ("r_max_line", "along one field line"), ("r_max", "along field lines"),
                        ("surface_theta", "along the surface"), ("r_out", "volume integrals")):
    add_section(_axis, _section)
