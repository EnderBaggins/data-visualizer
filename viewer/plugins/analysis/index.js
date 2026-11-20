// analysis — the viewer's general analysis add-ons (DECISIONS D17, D22): tools that work WITH the core plotting
// (human: "I would think of it like a python library visualizer is matplotlib and these other tools are a different things
// that WORKS with it"; the period and steps tools "while general may not be done super nicely so dont want them locked in
// as core stuff"). Loaded when viewer/plugins/index.json lists it; list it before plugins that read its tools (aperture4's
// foot gaps read named steps tools).
//   curvetools.js  the fit and the averaged curve (their maths: the core's fit.js, stats.js)
//   period.js      the period tool and the plots made from it ("cyc" lines; its method: the core's cycles.js)
//   steps.js       the steps tool (its card, its named output "steps"), steps from another plot (stepsof.js computes)
// plugin.json says what the core should name when this plugin is off (saved tools and lines are kept as they are).
import { registerCurveTools } from "./curvetools.js";
import { registerPeriod } from "./period.js";
import { registerSteps } from "./steps.js";

export default function (api) {
  registerCurveTools(api);                                 // fit, averaged curve
  registerPeriod(api);                                     // period (+ its plots' line kind)
  registerSteps(api);                                      // steps, steps from another plot (+ the "steps" output kind)
}
