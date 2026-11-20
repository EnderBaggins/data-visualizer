// mathtext.js — a small LaTeX subset for text drawn on the canvas (v5.11, human 2026-10-05: "how can I use latex").
// Text between $...$ is math: Greek letters and common symbols (\phi, \parallel, \partial, \int, \propto, ...),
// subscripts / superscripts (_x, _{...}, ^{...}), \mathrm / \rm / \text (upright), \mathbf (bold), \frac{a}{b}
// (inline a/b), \left / \right (dropped), spacing (\, \; \! \quad). Latin and lowercase Greek letters are italic, as in
// LaTeX. Outside $...$ the text is plain; \$ is a literal dollar. Like matplotlib's mathtext, not full LaTeX.

const SYM = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ",
  varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  parallel: "∥", perp: "⊥", partial: "∂", nabla: "∇", int: "∫", iint: "∬", oint: "∮", sum: "∑", prod: "∏", infty: "∞",
  times: "×", cdot: "·", pm: "±", mp: "∓", div: "÷", approx: "≈", sim: "∼", simeq: "≃", propto: "∝", equiv: "≡",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", neq: "≠", ne: "≠", ll: "≪", gg: "≫", to: "→", rightarrow: "→", leftarrow: "←",
  Rightarrow: "⇒", leftrightarrow: "↔", star: "⋆", ast: "∗", odot: "⊙", oplus: "⊕", otimes: "⊗", circ: "∘", bullet: "•",
  degree: "°", prime: "′", ell: "ℓ", hbar: "ℏ", langle: "⟨", rangle: "⟩", sqrt: "√", dots: "…", ldots: "…", cdots: "⋯",
  in: "∈", cap: "∩", cup: "∪", wedge: "∧", vee: "∨", vert: "|", Vert: "‖", mid: "|", lbrace: "{", rbrace: "}",
  log: "log", ln: "ln", exp: "exp", sin: "sin", cos: "cos", tan: "tan", max: "max", min: "min",
};
const UPRIGHT_CMDS = new Set(["log", "ln", "exp", "sin", "cos", "tan", "max", "min"]);
const SPACE = { ",": " ", ";": " ", ":": " ", "!": "", " ": " ", quad: "  ", qquad: "    " };
const FONT_CMDS = { mathrm: "rm", text: "rm", textrm: "rm", mathit: "it", mathbf: "bf", textbf: "bf", boldsymbol: "bf", operatorname: "rm" };
const FONT_DECLS = { rm: "rm", bf: "bf", it: "it" };          // {\rm max}: applies to the rest of the braces

export const hasMath = s => typeof s === "string" && /(^|[^\\])\$/.test(s);

/** Parse math into nodes: {t: "s", s, it, bf} | {t: "sub" | "sup", body} | {t: "frac", num, den}. */
function parseMath(src) {
  let i = 0;
  const group = (font) => {                      // until "}" or end
    const out = [];
    while (i < src.length && src[i] !== "}") {
      const n = atom(font);
      if (n) out.push(...n);
    }
    if (src[i] === "}") i++;
    return out;
  };
  const arg = (font) => {                        // one argument: {group} or a single atom
    while (src[i] === " ") i++;
    if (src[i] === "{") { i++; return group(font); }
    return atom(font) || [];
  };
  const atom = (font) => {
    const c = src[i];
    if (c === undefined) return null;
    if (c === "{") { i++; return group(font); }
    if (c === "_" || c === "^") { i++; return [{ t: c === "_" ? "sub" : "sup", body: arg(font) }]; }
    if (c === " ") { i++; return []; }               // spaces are ignored in math, as in LaTeX
    if (c === "\\") {
      i++;
      const m = /^[A-Za-z]+/.exec(src.slice(i));
      if (!m) { const e = src[i++]; return SPACE[e] !== undefined ? [{ t: "s", s: SPACE[e], it: false }] : [{ t: "s", s: e, it: false }]; }
      const name = m[0]; i += name.length;
      if (FONT_CMDS[name]) return arg(FONT_CMDS[name]);
      if (FONT_DECLS[name]) {                           // declaration: applies until the closing brace
        const out = [];
        while (i < src.length && src[i] !== "}") { const n = atom(FONT_DECLS[name]); if (n) out.push(...n); }
        return out;
      }
      if (name === "frac" || name === "dfrac" || name === "tfrac") { const num = arg(font), den = arg(font); return [{ t: "frac", num, den }]; }
      if (name === "left" || name === "right" || name === "big" || name === "Big" || name === "bigl" || name === "bigr") return [];
      if (name === "mathcal" || name === "mathbb" || name === "mathsf" || name === "mathtt" || name === "hat" || name === "bar" || name === "tilde" || name === "vec" || name === "dot") return arg(font);
      if (SPACE[name] !== undefined) return [{ t: "s", s: SPACE[name], it: false }];
      if (SYM[name] !== undefined) {
        const s = SYM[name], greekLower = /^[α-ωϵϑϕϖϱς]$/.test(s);
        return [{ t: "s", s, it: font === "it" || (!font && greekLower && !UPRIGHT_CMDS.has(name)), bf: font === "bf" }];
      }
      return [{ t: "s", s: "\\" + name, it: false }];   // unknown command: shown as typed
    }
    i++;
    const letter = /[A-Za-z]/.test(c);
    return [{ t: "s", s: c === "-" ? "−" : c, it: letter && font !== "rm" && font !== "bf", bf: font === "bf" }];
  };
  return group(null);
}

/** Text -> runs [{s, scale, shift, it, bf}] (shift in units of the base size, positive = up). */
export function richRuns(text, baseBold = false) {
  const runs = [];
  const emit = (nodes, scale, shift) => {
    for (const n of nodes) {
      if (n.t === "s") runs.push({ s: n.s, scale, shift, it: n.it, bf: n.bf || baseBold });
      else if (n.t === "sub") emit(n.body, scale * 0.7, shift - 0.22 * scale);
      else if (n.t === "sup") emit(n.body, scale * 0.7, shift + 0.38 * scale);
      else if (n.t === "frac") {
        const wrap = b => (b.length > 1 && b.some(x => x.t === "s" && /[+−-]/.test(x.s)));
        const part = b => { if (wrap(b)) { runs.push({ s: "(", scale, shift }); emit(b, scale, shift); runs.push({ s: ")", scale, shift }); } else emit(b, scale, shift); };
        part(n.num); runs.push({ s: "/", scale, shift }); part(n.den);
      }
    }
  };
  // split into plain and $math$ segments (\$ = literal dollar)
  let buf = "", inMath = false;
  const flush = () => {
    if (!buf) return;
    if (inMath) emit(parseMath(buf), 1, 0); else runs.push({ s: buf.replace(/\\\$/g, "$"), scale: 1, shift: 0, it: false, bf: baseBold });
    buf = "";
  };
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (ch === "\\" && text[k + 1] === "$") { buf += inMath ? "$" : "\\$"; k++; continue; }
    if (ch === "$") { flush(); inMath = !inMath; continue; }
    buf += ch;
  }
  flush();
  // merge neighbours with the same look (fewer fillText calls)
  const out = [];
  for (const r of runs) {
    const p = out.at(-1);
    if (p && p.scale === r.scale && p.shift === r.shift && !!p.it === !!r.it && !!p.bf === !!r.bf) p.s += r.s; else out.push({ ...r });
  }
  return out;
}

const fontOf = (r, size, family) => `${r.it ? "italic " : ""}${r.bf ? "bold " : ""}${size * r.scale}px ${family}`;
export function measureRich(ctx, text, size, family, bold = false) {
  ctx.save();
  let w = 0;
  for (const r of richRuns(text, bold)) { ctx.font = fontOf(r, size, family); w += ctx.measureText(r.s).width; }
  ctx.restore();
  return w;
}
/** Draw at (x, y) honouring ctx.textAlign (left / center / right) and ctx.textBaseline for the base line. */
export function drawRich(ctx, text, x, y, size, family, bold = false, stroke = false) {
  const runs = richRuns(text, bold), align = ctx.textAlign;
  const w = measureRich(ctx, text, size, family, bold);
  let cx = align === "center" ? x - w / 2 : align === "right" || align === "end" ? x - w : x;
  ctx.save();
  ctx.textAlign = "left";
  for (const r of runs) {
    ctx.font = fontOf(r, size, family);
    if (stroke) ctx.strokeText(r.s, cx, y - r.shift * size); else ctx.fillText(r.s, cx, y - r.shift * size);
    cx += ctx.measureText(r.s).width;
  }
  ctx.restore();
}
