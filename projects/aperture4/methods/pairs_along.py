"""pairs_along: where pairs are made along each field line, at the tracer's own points and their true s (2026-11-21).

Human 2026-11-21: "in my visualizer I want to basically see pair production along s". `along` has no pair quantity and
its needs= are per family, so pair_produced gets a family of its own (a run whose dumps lack it loses only this family,
not `along`). Same tracer and points as `along.s`, so the viewer's s, s/s_max and s-from-the-south-foot axes work with
no viewer change. The normalisation and its cross-check are datamgr.tools.fieldlines.pairs_along_points.
"""
import datamgr as dm

@dm.family(axes=("r_max", "pt"), label="pairs",
           needs=('B1', 'B2', 'B3', 'pair_produced'), members={
               "s": dict(label="s", quantity="s along the line", units="R_*", dtype="float32",
                         description="poloidal arc length from the north footpoint (the same points as along.s)"),
               "pair_rate": dict(label="rate", quantity="pair rate",
                                 description="pairs made per unit s of the line's flux tube and per R_*/c: "
                                             "pair_produced / |grad Psi| dA / Psi_line / output interval"),
           })
def pairs_along(data):
    """Every closed line of the r_max axis, traced as in `along`, with the pairs made per unit s at its points."""
    from datamgr.tools.fieldlines import pairs_along_points
    return pairs_along_points(data)
