"""Profiles along individual field lines, at one output, at each traced line's own points (true arc length s).

Lines are traced as Psi contours through their footpoint (Useful_functions.compute_vertices, the same as
draw_field_line), oriented north -> south footpoint. along_points gives s, E_par, the potential phi(s) = int E_par dl,
j_par/B, r sin(theta) B_phi and |B| at the tracer's points, nothing resampled.
(2026-11-10: along_profiles, the older 200 points uniform in s/s_max behind epar_along, phi_along, I_along, B_along and
jpar_over_B_along, was removed with those methods; human: "yeah all that removed". Its last version is in
claude_work/archive/2026-11-10_datamgr-old-along/.)
"""
import numpy as np

from ..axes import AXES


def along_points(data, rmax=None, n_points=None, extra=None):
    """The along-line profiles at the traced line's OWN points, with their true arc length (2026-11-09; human: "make all
    of the along field lines data saved naturally as along s … I fear there may be some bad conversion").

    {s, epar, phi, jpar_over_B, I_enc, Bmag}: arrays (len(rmax), n_points) at data's loaded output. extra= a dict
    {name: array on the (theta, r) grid} sampled at the same points and returned under its own name too, so a second
    family can carry an extra quantity along the same lines without a second trace (2026-11-21: pairs_along). Point k of line j
    is the line's k-th vertex from the north footpoint (the tracer's crossings of the grid's cell edges: Psi contour
    through the footpoint, compute_vertices, oriented north -> south, closed if both ends at r < 1.1). s = poloidal arc length from the north footpoint (R_*), so s/s_max = s / s[last] and the
    distance from the south footpoint = s[last] - s. Nothing is resampled along the line: E_par, j_par/B, r sin(theta)
    B_phi and |B| are the grid interpolated (bilinear) at the points themselves; phi is a Simpson integral on each cell
    segment (vertex, midpoint, vertex) of E_par |B|/|B_pol| ds (dl = ds |B|/|B_pol|), at the points. NaN past a line's last point and for
    lines that are not closed. A closed line with more points than n_points raises (enlarge the pt axis), never cut.
    Why: the 200 points uniform in s/s_max missed most of the footpoint E_par peak on long lines (south foot of chen-1
    r_max 8 at t = 50-80: 17 % of it; claude_work/tasks/2026-11-09_along-s-check)."""
    from scipy.interpolate import RegularGridInterpolator
    from Useful_functions import compute_vertices, r_max_to_th_foot
    from lib.ai_functions import _view_at

    rmax = tuple(AXES["r_max"].values_for() if rmax is None else rmax)
    n = int(n_points or len(AXES["pt"].values_for()))
    v = _view_at(data)                                  # exact mesh; B, E, J read once and shared with data (2026-11-12)
    th_grid, r_grid = v._theta, v._r
    extra = dict(extra or {})
    names = ("s", "epar", "phi", "jpar_over_B", "I_enc", "Bmag") + tuple(extra)
    out = {k: np.full((len(rmax), n), np.nan) for k in names}
    B1, B2, B3, E1, E2, E3, J1, J2, J3 = v.B1, v.B2, v.B3, v.E1, v.E2, v.E3, v.J1, v.J2, v.J3
    Bmag = np.sqrt(B1**2 + B2**2 + B3**2) + 1e-30
    Bpol = np.hypot(B1, B2) + 1e-30
    fields = {"epar": (E1 * B1 + E2 * B2 + E3 * B3) / Bmag,
              "jpar_over_B": (J1 * B1 + J2 * B2 + J3 * B3) / Bmag**2,
              "I_enc": v._rv * np.sin(v._thetav) * B3,
              "Bmag": Bmag}
    fields.update({k: np.asarray(f, dtype=float) for k, f in extra.items()})
    interp = {k: RegularGridInterpolator((th_grid, r_grid), f, bounds_error=False, fill_value=np.nan)
              for k, f in fields.items()}
    g_interp = RegularGridInterpolator((th_grid, r_grid), fields["epar"] * Bmag / Bpol, bounds_error=False, fill_value=np.nan)
    on_grid = lambda t_, r_: np.column_stack((np.clip(t_, th_grid[0], th_grid[-1]), np.clip(r_, r_grid[0], r_grid[-1])))
    for j, vt in enumerate(compute_vertices(v, r_max_to_th_foot(np.array(rmax)))):
        if vt is None or len(vt) < 3:
            continue
        x, z = vt[:, 0], vt[:, 1]
        r, th = np.hypot(x, z), np.arctan2(x, z)
        if th[0] > th[-1]:                              # orient north -> south
            r, th = r[::-1], th[::-1]
        if r[0] > 1.1 or r[-1] > 1.1:                   # not a closed line
            continue
        m = len(r)
        if m > n:
            raise ValueError(f"line r_max = {rmax[j]:.3f} has {m} points, more than the pt axis' {n}: enlarge the axis")
        xo, zo = r * np.sin(th), r * np.cos(th)
        seg = np.hypot(np.diff(xo), np.diff(zo))
        out["s"][j, :m] = np.concatenate(([0.0], np.cumsum(seg)))
        pts = on_grid(th, r)                            # footpoints sit just below the first grid point: clamped
        for k, f in interp.items():
            out[k][j, :m] = f(pts)
        xm, zm = 0.5 * (xo[1:] + xo[:-1]), 0.5 * (zo[1:] + zo[:-1])
        gv, gm = g_interp(pts), g_interp(on_grid(np.arctan2(xm, zm), np.hypot(xm, zm)))
        out["phi"][j, :m] = np.concatenate(([0.0], np.cumsum((gv[:-1] + 4 * gm + gv[1:]) / 6 * seg)))
    return out


def pairs_along_points(data):
    """Pairs made per unit arc length s along each closed line, at the tracer's own points: {s, pair_rate}.

    pair_rate = dN/dPsi per unit s x Psi_line / (fld_output_interval * dt), where dN/dPsi per unit s is lib.ai_functions'
    existing pair field, _count_per_cell(d, "pair_produced") -- the one line_pairs uses through the "pairs" line
    quantity (define_line_quantity("pairs", reduce="integral_ds")). Its denominator r sin(theta) |B_pol| x cell area is
    |grad Psi| dA per radian, so integrating it along a line gives the pairs that line makes per unit Psi; x Psi_line
    (Psi = Bp / r_max, the line's label) that is pairs per ln r_max, the same convention as line_pairs. pair_produced is
    the count since the PREVIOUS output (2 x weight per pair, radiative_transfer_impl.hpp, reset at every output), hence
    the divide by the output interval. Not a density of pairs: pairs BORN on the line. Same tracer and points as
    along_points (along.s).

    Checked against line_pairs (coarea, a separate path) on rcs-pairs-1-ec025 t = 100, 2026-11-21: int(pair_rate ds)
    / line_pairs = 0.98-1.10 on r_max 4.9-24, 1.41 on the innermost 3.3 line where few cells carry the count."""
    from lib.ai_functions import _count_per_cell, _view_at

    rmax = np.asarray(AXES["r_max"].values_for(), dtype=float)
    v = _view_at(data)                                  # exact mesh; B, pair_produced read once and shared
    c = v._conf
    dt_out = float(c["fld_output_interval"]) * float(c["dt"])
    rate = _count_per_cell(v, "pair_produced") / dt_out
    out = along_points(data, rmax=rmax, extra={"pair_rate": rate})
    out["pair_rate"] = out["pair_rate"] * (float(c["Bp"]) / rmax)[:, None]   # x Psi_line, the line's label
    return {k: out[k] for k in ("s", "pair_rate")}
