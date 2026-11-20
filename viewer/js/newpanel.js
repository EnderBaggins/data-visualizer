// newpanel.js — the "new panel" form. v6.3 (human 2026-10-13: "when I first make a new panel I'd like the axes to be
// the first thing popped up … basically a panel is DEFINED by its axes"; chose a small first-time pop-up over the
// settings box): "+ 1D panel" / "+ 2D panel" ask only what defines the panel. 1D: x axis, y axis, and the first lines
// (datatypes × datasets). 2D: dataset, datatype, x / y axes. "create" makes it; "more settings…" also opens the full
// settings box; cancel makes nothing. Everything can be changed later in the settings box as before.
import { store, srcOf, fitAxis, firstRun, runNames, runLabel, settings1D, settings2D, setAxes2D, newLine, axisCatalog, axisLabel,
  kindsFor, datatypes, isSpherical, dataKindOf, startPicksOf } from "./model.js";
import { axesFor } from "./panel2d.js";
import { quantityGroups2D, qLabel } from "./settings.js";
import { groupedSelect } from "./lines.js";
import { runSelect, runTip, groupedRunTicks } from "./vars.js";
import { el, select, check, popover, closePopover } from "./ui.js";
import { canCompute, methodOf, startCompute, estimate, fmtMB, MARK } from "./cacheable.js";

/** Open the form at (clientX, clientY). create(type, settings, more) makes the panel (more = open its settings). */
export function openNewPanel(type, clientX, clientY, create) {
  const box = popover(clientX, clientY, []);
  box.style.maxHeight = "calc(100vh - 16px)"; box.style.overflowY = "auto";      // the buttons stay reachable
  (type === "1d" ? form1D : form2D)(box, create);
}

function keepOnScreen(box) {
  const r = box.getBoundingClientRect();
  if (r.bottom > innerHeight - 8) box.style.top = Math.max(8, innerHeight - r.height - 8) + "px";
  if (r.right > innerWidth - 8) box.style.left = Math.max(8, innerWidth - r.width - 8) + "px";
}
const buttons = (ok, make, label = "create") => el("div", { class: "pop-row" },
  el("button", { class: "on", disabled: !ok, onclick: () => make(false) }, label),
  el("button", { disabled: !ok, title: "create it and open its full settings box", onclick: () => make(true) }, "more settings…"),
  el("button", { onclick: closePopover }, "cancel"));

// ---- 1D: x axis, y axis, first lines ---------------------------------------------------------------------------
function form1D(box, create) {
  // v6.4 fix (human 2026-10-13: "picked dataset and datatype it actually didn't add the line"): no dataset starts
  // ticked — one did, so clicking it to pick it unticked it and the panel came out empty. The lines to be made are
  // listed, and the button says how many.
  const d = { xaxis: "time", ykind: null, qs: [], runs: [], compute: true };   // v11.4: compute the missing lines (◌)
  const draw = () => {
    // datatypes that have this x axis (and y kind) in any dataset, grouped by section, readable names
    const groups = new Map();
    for (const run of runNames()) for (const [sec, items] of datatypes(run, d.xaxis, d.ykind)) {
      if (!groups.has(sec)) groups.set(sec, new Map());
      for (const [n, lab] of items) if (!groups.get(sec).has(n) || groups.get(sec).get(n).startsWith(MARK)) groups.get(sec).set(n, lab);   // stored somewhere: unmarked
    }
    const known = new Set([...groups.values()].flatMap(m => [...m.keys()]));
    d.qs = d.qs.filter(q => known.has(q));
    const has = (run, q) => !!fitAxis(srcOf(run, q), d.xaxis);
    const can = (run, q) => !has(run, q) && canCompute(run, q);
    const lines = d.qs.flatMap(q => d.runs.filter(r => has(r, q) || (d.compute && can(r, q))).map(r => [r, q]));
    const toCompute = d.qs.flatMap(q => d.runs.filter(r => can(r, q)).map(r => [r, q]));
    const missing = d.qs.flatMap(q => d.runs.filter(r => !has(r, q) && !can(r, q)).map(r => [r, q]));
    const labelOf = q => ([...groups.values()].map(m => m.get(q)).find(Boolean) ?? q).replace(/ — [^—]*$/, "");   // (without v11.7's " — axes")
    const tickQ = (q, on) => {
      d.qs = on ? [...d.qs, q] : d.qs.filter(x => x !== q);
      if (on && !d.ykind) d.ykind = Object.values(store.runs).map(r => r.sources[q]).find(Boolean)?.kind ?? (methodOf(q)?.yaxis || null);  // the first pick sets y
      draw();
    };
    const tickRun = (r, on) => { d.runs = on ? [...new Set([...d.runs, r])] : d.runs.filter(x => x !== r); draw(); };
    box.replaceChildren(
      el("div", { class: "pop-title" }, "new 1D plot"),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "x axis"),
        select(axisCatalog().map(a => [a, axisLabel(a)]), d.xaxis, v => { d.xaxis = v; d.ykind = null; draw(); })),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "y axis"),
        select([["", "(any: the first quantity ticked sets it)"], ...kindsFor(d.xaxis).map(k => [k.kind, k.kind + (k.units ? ` [${k.units}]` : "")])], d.ykind || "",
          v => { d.ykind = v || null; draw(); })),
      el("div", { class: "pop-row top" }, el("span", { class: "lab" }, "quantities"),
        known.size ? el("div", { class: "np-list" }, [...groups].map(([sec, m]) => [el("div", { class: "np-sec" }, sec),
          [...m].map(([n, lab]) => check(lab, d.qs.includes(n), on => tickQ(n, on), { title: n }))]))
          : el("span", { class: "warn" }, `nothing cached with x = ${d.xaxis}${d.ykind ? ` and y = ${d.ykind}` : ""}`)),
      el("div", { class: "pop-row top" }, el("span", { class: "lab" }, "datasets"),
        el("div", { class: "np-list" }, groupedRunTicks(r => d.runs.includes(r), tickRun, runNames(), d.runs,      // v8.24: by dataset group
          r => (d.qs.length && !d.qs.some(q => has(r, q)) ? "has none of the ticked quantities\n\n" : "") + runTip(r)))),
      el("div", { class: "pop-row top" }, el("span", { class: "lab" }, "lines"), el("div", { class: "np-list" },
        lines.length ? lines.map(([r, q]) => el("span", can(r, q) ? { class: "cacheable" } : {}, `${can(r, q) ? MARK : ""}${labelOf(q).replace(MARK, "")} · ${runLabel(r)}${can(r, q) ? " (computed)" : ""}`)) : null,
        toCompute.length ? check(`compute the ${toCompute.length} ◌ line${toCompute.length > 1 ? "s" : ""} not cached yet (${fmtMB(toCompute.reduce((a, [r, q]) => a + estimate(r, [q]).MB, 0))})`,
          d.compute, v => { d.compute = v; draw(); }, { title: "on the storage server, one job per dataset; the lines fill in as the outputs arrive" }) : null,
        missing.map(([r, q]) => el("span", { class: "dim" }, `(${runLabel(r)} has no ${labelOf(q)})`)),
        !lines.length ? el("span", { class: d.qs.length || d.runs.length ? "warn" : "dim" },
          !d.qs.length && !d.runs.length ? "tick quantities and datasets: one line for each pair" : !d.runs.length ? "tick a dataset too" : !d.qs.length ? "tick a quantity too" : "none of the ticked datasets has these quantities") : null)),
      el("div", { class: "pop-hint" }, "Other axes (e.g. r_max) start at their middle value; click a legend entry to change it. Without lines the plot starts empty (add them with “+ line”)."),
      buttons(true, more => {
        const s = settings1D(d.xaxis, d.runs[0] || firstRun(), d.ykind);
        for (const [r, q] of lines) s.lines.push(newLine(r, q));
        closePopover(); create("1d", s, more);
        if (d.compute) {                                // v11.4: one job per dataset for its ◌ lines
          const by = new Map();
          for (const [r, q] of toCompute) by.set(r, [...(by.get(r) || []), q]);
          for (const [r, qs] of by) startCompute(r, qs);
        }
      }, lines.length ? `create with ${lines.length} line${lines.length > 1 ? "s" : ""}` : "create empty"));
    keepOnScreen(box);
  };
  draw();
}

// ---- 2D: dataset, datatype, x / y axes -------------------------------------------------------------------------
function form2D(box, create) {
  const run0 = firstRun(), def = run => (srcOf(run, "Bphi_over_B") ? "Bphi_over_B" : quantityGroups2D(run)[0]?.[1][0]?.[0] ?? null);
  // v11.2.2 (human 2026-11-11: a spacetime map, then another dataset: "it defaulted to meridional now I cant change
  // back"): `want` is the quantity chosen here, with its axes. A dataset without it shows the default meanwhile (and
  // says so); a dataset that has it brings it back.
  const d = { run: run0, q: def(run0), xdim: null, ydim: null, meridional: true, want: null };
  const draw = () => {
    const have = q => !!srcOf(d.run, q) || canCompute(d.run, q);                // v11.4: or ◌, computed from the plot
    if (d.want && d.q !== d.want.q && have(d.want.q)) Object.assign(d, { q: d.want.q, xdim: d.want.xdim, ydim: d.want.ydim });
    if (!have(d.q)) { d.q = def(d.run); d.xdim = d.ydim = null; }
    const src = srcOf(d.run, d.q), [xd, yd] = src ? axesFor({ xdim: d.xdim, ydim: d.ydim }, src) : [null, null];
    const kind = dataKindOf(src), own = kind?.mapAxisOptions ? kind : null, sph = src && !kind && isSpherical(src, xd, yd);   // v15.1: a data kind's map
    const keep = () => { if (d.want?.q === d.q) Object.assign(d.want, { xdim: d.xdim, ydim: d.ydim }); };
    const setAxis = (which, v) => {
      if (which === "x") { d.xdim = v; d.ydim = yd === v ? xd : yd; } else { d.ydim = v; d.xdim = xd === v ? yd : xd; }
      // a data kind's map: its axes come in pairs (along-line: time, r_max and a position along the line); an impossible
      // pair moves the other axis (as ⚙)
      if (own && !own.mapPairOk(d.xdim, d.ydim)) { const o = own.mapOtherFor(v); if (which === "x") d.ydim = o; else d.xdim = o; }
      keep(); draw();
    };
    const axOpts = own ? own.mapAxisOptions : src?.dims, later = !src && canCompute(d.run, d.q), e = later ? estimate(d.run, [d.q]) : null;
    box.replaceChildren(
      el("div", { class: "pop-title" }, "new map"),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "dataset"), runSelect(d.run, v => { d.run = v; draw(); }, { q: d.q })),
      el("div", { class: "pop-row" }, el("span", { class: "lab" }, "quantity"),
        src || quantityGroups2D(d.run).length ? groupedSelect(quantityGroups2D(d.run), d.q, v => { d.q = v; d.xdim = d.ydim = null; d.want = { q: v, xdim: null, ydim: null }; draw(); })
          : el("span", { class: "warn" }, `${runLabel(d.run)} has no 2D quantities cached`)),
      later ? el("div", { class: "dim", style: "max-width:320px;font-size:11px;margin:2px 0 4px" },
        `${MARK}not cached for ${runLabel(d.run)} yet: the plot offers to compute it (${e.outputs} outputs · ${fmtMB(e.MB)}); its axes can be set once it is there.`) : null,
      d.want && d.q !== d.want.q ? el("div", { class: "warn", style: "max-width:320px;font-size:11px;margin:2px 0 4px" },   // (not .pop-hint: those go into the title's ⓘ)
        `${runLabel(d.run)} has no ${qLabel(d.want.q)}: showing ${src?.label ?? "another quantity"} meanwhile. Choose a dataset that has it and it comes back.`) : null,
      src ? el("div", { class: "pop-row" }, el("span", { class: "lab" }, "axes"),
        "x", select(axOpts, xd, v => setAxis("x", v)), "y", select(axOpts, yd, v => setAxis("y", v))) : null,
      sph ? el("div", { class: "pop-row" }, el("span", { class: "lab" }, ""), check("meridional plane (r, θ drawn as the real shape)", d.meridional, v => { d.meridional = v; draw(); })) : null,
      kind?.mapHint ? el("div", { class: "pop-hint" }, kind.mapHint(xd, yd))
        : src && src.dims.length > 2 ? el("div", { class: "pop-hint" }, `The other axes (${src.dims.filter(x => x !== xd && x !== yd).join(", ")}) follow the time slider or start at their middle value.`) : null,
      buttons(!!src || later, more => {
        const s = settings2D(d.run, d.q);
        if (src) setAxes2D(s, src, xd, yd);
        const picks = src || later ? startPicksOf(src, d.q) : null;           // as a quantity change in ⚙ (v15.1: a data kind's first picks)
        if (picks) s.picks = picks;
        if (sph) s.meridional = d.meridional;
        closePopover(); create("2d", s, more);
      }));
    keepOnScreen(box);
  };
  draw();
}
