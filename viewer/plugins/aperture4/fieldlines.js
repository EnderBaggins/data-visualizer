// fieldlines.js (aperture4 plugin, v15.0) — field lines on r–θ maps: contours of Ψ through r_max footpoints. The core
// draws contours at values; this adds the footpoint level mode (a dipole footpoint at r = R_*: θ = asin(√(1/r_max)),
// Ψ read there, at r index 0) and the "field lines" tool (moved from the core's contour tool, settings.js / panel2d.js).
import * as R from "../../js/render.js";
import { newTool, srcOf } from "../../js/model.js";
import { contourRows } from "../../js/settings.js";

export const newFieldLines = (extra = {}) => newTool("contour", { q: "Psi", levelMode: "rmax", levels: "2,4,6,8", ...extra });

export function registerFieldLines(api) {
  api.registerContourLevels({ key: "rmax", label: "at r_max footpoints", title: "at r_max footpoints: field lines through these r_max (Ψ at each line's north foot)",
    levels: ({ levels, frame, dims: [d0, d1], coords: [c0, c1], geometry: g }) => {
      if (!g || d0 !== g.theta || d1 !== g.r) return levels;      // not a θ × r map: the numbers as levels
      const nx = c1.length;
      return levels.filter(rm => rm >= 1).map(rm => { const it = R.nearestIndex(c0, Math.asin(Math.sqrt(1 / rm))); return it < 0 ? NaN : frame[it * nx]; });
    } });
  api.registerTool({ key: "field", label: "field lines", folder: "draw", where: "map",
    help: "field lines through r_max footpoints (contours of Ψ)",
    is: t => t.type === "contour" && t.levelMode === "rmax", make: () => newFieldLines(),
    summary: (ctx, t) => (t.q === "Psi" ? `field lines at r_max ${t.levels}` : `contours of ${srcOf(ctx.get("run"), t.q)?.label ?? t.q} at r_max footpoints`),
    rows: contourRows, style: true, colour: t => (t.listColors ? "list" : "single"),
    problem: ctx => (srcOf(ctx.get("run"), "Psi") ? null : "this dataset has no Ψ (the flux function) to draw field lines from") });
}
