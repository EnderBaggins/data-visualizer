"""along: the along-line profiles at the traced line's own points, with their true arc length s (2026-11-09).

Human 2026-11-09: "make all of the along field lines data saved naturally as along s, then when I want to plot s/smax it
can just do that scaling automatically … I fear there may be some bad conversion in what is currently saved". The
older *_along quantities are 200 points uniform in s/s_max; on long lines they missed most of the footpoint E∥ peak
(claude_work/tasks/2026-11-09_along-s-check). Here nothing is resampled along the line: one value per traced point,
and the point's s (R_*) is stored with it. The viewer plots these against s, s/s_max (= s / the line's last s) or the
distance from the south footpoint, per line and per output.
"""
import datamgr as dm


@dm.family(axes=("r_max", "pt"), label="along the line (true s)", needs=('B1', 'B2', 'B3', 'E1', 'E2', 'E3', 'J1', 'J2', 'J3'), members={
    "s": dict(label="s", quantity="s along the line", units="R_*", dtype="float32",
              description="poloidal arc length of each point from the north footpoint (float32: positions)"),
    "epar": dict(label="E∥", quantity="E∥", description="E_par = E.B/|B| at the point (signed)"),
    "phi": dict(label="potential ∫E∥ dl", quantity="potential",
                description="potential gained from the north footpoint, int E_par dl along the 3D line (dl = ds |B|/|B_pol|), "
                            "Simpson on each cell segment; its last value is the line voltage"),
    "jpar_over_B": dict(label="j∥/B", quantity="j∥/B", description="j_par/B at the point"),
    "I_enc": dict(label="r sinθ B_φ (I_enc/2π)", quantity="current", description="r sin(theta) B_phi at the point"),
    "Bmag": dict(label="|B|", quantity="|B|", description="|B| at the point")})
def along(data):
    """Every closed line of the r_max axis (104), traced as datamgr.tools.fieldlines.along_points (Psi contour through
    the north footpoint, oriented north -> south, closed if both ends at r < 1.1); point k = its k-th crossing of a grid
    cell edge (590 points on an r_max 3 line, up to ~1,700 on long inflated lines), NaN past its last point. The
    fields are the grid interpolated at the points; s is float32 (positions), the others float16 like the maps."""
    from datamgr.tools.fieldlines import along_points
    return along_points(data)
