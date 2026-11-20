// names.js (aperture4 plugin, v15.0) — the Aperture4 runs' names and defaults: LaTeX symbols, short axis names in the
// quantity menus, default quantities, and the example desktop (moved from latex.js KNOWN, model.js AX_NICE /
// defaultDesktop, lines.js and vars.js).
import { S, store, srcOf, settings1D, settings2D, newPanel, newLine, linkPanels, groupOf } from "../../js/model.js";
import { newFieldLines } from "./fieldlines.js";

export function exampleDesktop(runs) {
  const out = [];
  if (!runs.some(r => srcOf(r, "Bphi_over_B") || srcOf(r, "twist_angle"))) return out;   // not Aperture4 data: the core's example
  const r0 = runs.includes("baseline-19") ? "baseline-19" : runs[0];
  const r1 = runs.includes("baseline-18") && r0 !== "baseline-18" ? "baseline-18" : runs.find(r => r !== r0);
  S.vars.A = { name: "A", type: "dataset", value: r0 };
  if (r1) S.vars.B = { name: "B", type: "dataset", value: r1 };
  S.vars.rmax = { name: "rmax", type: "number", value: 3 };
  const run = "$A", other = r1 ? "$B" : null;
  const has = (q, r = run) => !!srcOf(r, q);
  // maps: B_φ/B with field lines, E∥/B linked to it, number density
  if (has("Bphi_over_B")) {
    const s = settings2D(run, "Bphi_over_B"); s.view = { x0: 0, x1: 12, y0: -8, y1: 8 }; s.aspect = 1.2;
    if (has("Psi")) s.tools.push(newFieldLines());
    const a = newPanel("2d", s, { name: "B_φ/B" }); out.push(a);
    if (has("Epar_over_B")) {
      const b = newPanel("2d", JSON.parse(JSON.stringify(s)), { name: "E∥/B (linked)" });
      linkPanels(a, b); b.settings.q = "Epar_over_B"; groupOf(a).row = true; out.push(b);
    }
  }
  if (has("number_density")) {
    const s = settings2D(run, "number_density"); s.view = { x0: 0, x1: 12, y0: -8, y1: 8 }; s.aspect = 1.2; s.norm = "log"; s.decades = 5;
    out.push(newPanel("2d", s, { name: "number density" }));
  }
  const line = (r, q, picks, extra = {}) => newLine(r, q, { picks, ...extra });
  // along field lines: twist (measured solid, drive dashed in the same colour), like twist_time
  if (has("twist_angle")) {
    const s = settings1D("time", run, srcOf(run, "twist_angle").kind); s.abs = true;
    s.lines.push(line(run, "twist_angle", { r_max: "$rmax" }, { color: "#1f77b4" }));
    if (has("drive_twist")) s.lines.push(line(run, "drive_twist", { r_max: "$rmax" }, { color: "#1f77b4", dash: "dashed" }));
    if (other && has("twist_angle", other)) s.lines.push(line(other, "twist_angle", { r_max: "$rmax" }, { color: "#ff7f0e" }));
    out.push(newPanel("1d", s, { name: "twist angle" }));
  }
  if (has("line_current")) {
    const s = settings1D("time", run, srcOf(run, "line_current").kind); s.abs = true;
    for (const r of [run, other].filter(Boolean)) if (has("line_current", r)) s.lines.push(line(r, "line_current", { r_max: "$rmax" }));
    out.push(newPanel("1d", s, { name: "current" }));
  }
  if (has("twist_energy")) {
    const s = settings1D("time", run, srcOf(run, "twist_energy").kind);
    for (const r of [run, other].filter(Boolean)) if (has("twist_energy", r)) s.lines.push(line(r, "twist_energy", { r_out: 5 }));
    out.push(newPanel("1d", s, { name: "twist energy (r < 5)" }));
  }
  if (has("Bphi_surface")) {
    const s = settings1D("theta_foot", run, srcOf(run, "Bphi_surface").kind);
    for (const r of [run, other].filter(Boolean)) if (has("Bphi_surface", r)) s.lines.push(line(r, "Bphi_surface", {}));
    out.push(newPanel("1d", s, { name: "B_φ on the surface" }));
  }
  return out;
}

export function registerNames(api) {
  api.registerSymbols({ r_max: "r_{\\max}", Bp: "B_p", B_p: "B_p", theta_foot: "\\theta_{\\rm foot}", s_norm: "s/s_{\\max}",
    r_out: "r_{\\rm out}", line_current: "I", Rstar: "R_\\ast", R_star: "R_\\ast" });
  api.registerAxisNames({ r_max: "r_max", pt: "s", surface_theta: "θ_foot", r_out: "r_out", r_max_line: "r_max", s_norm: "s/s_max" },
    ["r_max", "r_max·s", "r_max·s/s_max", "θ_foot", "r_out"]);
  api.registerDefaults({ scaleRef: ["drive_twist"], configVars: ["twist_rmax_1", "twist_rmax_2"], timeUnits: "R_*/c" });   // (time units: for stores written before v15.3)
  api.registerExampleDesktop(runs => exampleDesktop(runs));
}
