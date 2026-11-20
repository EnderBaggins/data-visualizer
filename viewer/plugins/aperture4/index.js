// aperture4 — the viewer's plugin for Aperture4 magnetar runs (v15.0, DECISIONS D17–D19): the physics that is not
// general plotting. Loaded when viewer/plugins/index.json lists it.
//   gapseries.js  foot gaps over time (from a named steps tool's steps at the field line's feet)
//   across.js     "across lines": a curve over time from a quantity with one value per field line (slope at a line, ∫ …)
//   fieldlines.js field lines on r–θ maps (contours of Ψ through r_max footpoints)
//   names.js      symbols, axis names, default quantities, the example desktop
//   alongline.js  along-line data (a quantity at a field line's own points; D20): its axes, 1D curves, maps
//                 (alongmap.js), data transport (alongdata.js), the "line length" reading, "▦ linked slices", the
//                 old-profile migration. plugin.json says what the core should name when this plugin is off.
import { registerGaps } from "./gapseries.js";
import { registerAcross } from "./across.js";
import { registerFieldLines } from "./fieldlines.js";
import { registerNames } from "./names.js";
import { registerAlongLine } from "./alongline.js";

export default function (api) {
  registerGaps(api);
  registerAcross(api);
  registerFieldLines(api);
  registerNames(api);
  registerAlongLine(api);
}
