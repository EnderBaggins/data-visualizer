"""The demo's axes: the grid (y, x) from each run's run.json."""
from datamgr.axes import Axis, add

add(Axis("y", lambda d: d.grid()["coords"]["y"]["values"], label="y", units="m"))
add(Axis("x", lambda d: d.grid()["coords"]["x"]["values"], label="x", units="m"))
