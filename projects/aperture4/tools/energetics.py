"""Untwisting energetics from the field-line quantities (Beloborodov 2009 Eqs. 19-21 in code units).

A thin flux tube between Psi and Psi + dPsi carries current dI_enc (I_enc = 2 pi r sin(th) B_phi) across its
voltage V (= int E_par dl footpoint to footpoint), so it dissipates V dI_enc:
    E_tw  = int B_phi^2/2 dV = pi int I_line dphi dPsi       (I_line = r sin(th) B_phi, constant along a line)
    P_ohm = -int V dI_enc = -2 pi int V (dI_line/dPsi) dPsi   (predicted dE_tw/dt from the voltage alone)
    tau   = E_tw / (-P_ohm)
Lines: ai_functions._L_GRID (r_max 1.02-30), Psi = Bp / r_max; NaN lines (open / off-grid) dropped.
Computed over all settled outputs (so the time derivative is the same however the steps are asked for) and
memoised; the line voltage starts at the first cell row (a footpoint sheath inside the first cell is not in V).
(Ported from visualizer/recorder/quantities.py _energetics, 2026-10-07.)
"""
import numpy as np

_MEMO = {}


def energetics(data, steps):
    """{E, P, dEdt, tau}: arrays over `steps` (each a subset of the run's settled outputs)."""
    from lib.ai_functions import _L_GRID, line_values
    from ..runs import settled_steps

    allsteps = sorted(set(settled_steps(data)) | {int(s) for s in steps})
    key = (data._path, tuple(allsteps))
    if key not in _MEMO:
        Bp = float(data._conf["Bp"])
        t, I, _, _ = line_values(data, "current", _L_GRID, steps=allsteps, progress=False)
        _, dphi, _, _ = line_values(data, "twist", _L_GRID, steps=allsteps, progress=False)
        _, V, _, _ = line_values(data, "voltage", _L_GRID, steps=allsteps, progress=False)
        psi = Bp / _L_GRID
        order = np.argsort(psi)
        psi, I, dphi, V = psi[order], I[:, order], dphi[:, order], V[:, order]
        E, P = np.full(len(allsteps), np.nan), np.full(len(allsteps), np.nan)
        trap = getattr(np, "trapezoid", None) or np.trapz
        for k in range(len(allsteps)):
            ok = np.isfinite(I[k]) & np.isfinite(dphi[k]) & np.isfinite(V[k])
            if ok.sum() < 5:
                continue
            p, i_, d_, v_ = psi[ok], I[k, ok], dphi[k, ok], V[k, ok]
            E[k] = np.pi * trap(i_ * d_, p)
            P[k] = -2.0 * np.pi * trap(v_ * np.gradient(i_, p), p)
        dEdt = np.gradient(E, t) if len(allsteps) > 1 else np.full(len(allsteps), np.nan)
        with np.errstate(divide="ignore", invalid="ignore"):
            tau = E / (-P)
        _MEMO.clear()
        _MEMO[key] = {"steps": allsteps, "E": E, "P": P, "dEdt": dEdt, "tau": tau}
    r = _MEMO[key]
    idx = [r["steps"].index(int(s)) for s in steps]
    return {k: r[k][idx] for k in ("E", "P", "dEdt", "tau")}
