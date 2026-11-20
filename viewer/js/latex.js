// latex.js — formulas of the expression grammar as LaTeX, typeset with KaTeX (v8.2, human 2026-10-15: the Functions
// tab lists every analytic function, "might as well store these equations in good latex form").
// The grammar is data.js's: numbers, {parameters} (or bare names in expressions), pi, e, + - * / ^ (or **), and the
// functions of FUNCS. The LaTeX is built from the parsed formula, so it always says what is computed; a function's
// own LaTeX (written in the Functions tab) can replace it for display only.

const GREEK = new Set(("alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi rho " +
  "sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega").split(" "));
/** Names this project uses often, as symbols (anything else: the rule in symbol()). */
const KNOWN = { time: "t" };   // v15.0: the rest come from plugins (registerSymbols; aperture4: r_max, Bp, θ_foot …)
/** v14.9 (plugins.js): a plugin adds names it writes as symbols ({name: "LaTeX"}); a core name is not replaced. */
export function registerSymbols(map) {
  if (!map || typeof map !== "object") throw new Error("not an object of name: LaTeX");
  for (const [k, v] of Object.entries(map)) if (!(k in KNOWN) && typeof v === "string") KNOWN[k] = v;
}
const word = w => (GREEK.has(w) ? "\\" + w : w.length === 1 ? w : `\\mathrm{${w.replace(/_/g, "\\_")}}`);
/** A name as a symbol: known ones (r_max → r_max with max as subscript), Greek names (theta → θ), a_b → a with
 *  subscript b, one letter as it is, longer words upright. */
export function symbol(name) {
  if (KNOWN[name]) return KNOWN[name];
  const i = name.indexOf("_");
  if (i > 0 && i < name.length - 1) {
    const sub = name.slice(i + 1);
    return `${word(name.slice(0, i))}_{${sub.length === 1 || GREEK.has(sub) ? word(sub) : `\\rm ${sub.replace(/_/g, "\\_")}`}}`;
  }
  return word(name);
}

// ---- parse (same precedence as data.js compile(): unary minus below ^, ^ right-associative) ------------------------
function tokens(s) {
  // (v8.25: dotted names, gap.voltage, and comparisons, as data.js reads them)
  const re = /\s*(?:\{\s*([A-Za-z_]\w*)\s*\}|(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)|(\*\*|>=|<=|==|!=|[-+*/^(),<>]))/y;
  const out = [];
  while (re.lastIndex < s.length) {
    if (/^\s*$/.test(s.slice(re.lastIndex))) break;
    const m = re.exec(s);
    if (!m) throw new Error(`can't read "${s.slice(re.lastIndex).trim()}"`);
    out.push(m[1] ? { t: "par", v: m[1] } : m[2] ? { t: "num", v: m[2] } : m[3] ? { t: "id", v: m[3] } : { t: "op", v: m[4] === "**" ? "^" : m[4] });
  }
  return out;
}
export function parseFormula(src) {
  const tk = tokens(String(src)); let p = 0;
  const peek = () => tk[p], eat = v => { if (!tk[p] || tk[p].v !== v) throw new Error(`expected "${v}"`); p++; };
  const cmp = () => { let a = expr(); while (peek() && CMP_TEX[peek().v]) { const o = tk[p++].v; a = { k: "cmp", o, a, b: expr() }; } return a; };
  const expr = () => { let a = term(); while (peek() && (peek().v === "+" || peek().v === "-")) { const o = tk[p++].v; a = { k: o, a, b: term() }; } return a; };
  const term = () => { let a = unary(); while (peek() && (peek().v === "*" || peek().v === "/")) { const o = tk[p++].v; a = { k: o, a, b: unary() }; } return a; };
  const unary = () => { if (peek() && peek().v === "-") { p++; return { k: "neg", a: unary() }; } if (peek() && peek().v === "+") { p++; return unary(); } return power(); };
  const power = () => { const a = atom(); if (peek() && peek().v === "^") { p++; return { k: "^", a, b: unary() }; } return a; };
  const atom = () => {
    const t = tk[p++];
    if (!t) throw new Error("unexpected end");
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "par") return { k: "var", v: t.v };
    if (t.v === "(") { const a = cmp(); eat(")"); return a; }
    if (t.t === "id") {
      if (peek() && peek().v === "(") {
        p++; const args = [];
        if (peek() && peek().v !== ")") { args.push(cmp()); while (peek() && peek().v === ",") { p++; args.push(cmp()); } }
        eat(")");
        return t.v === "pow" && args.length === 2 ? { k: "^", a: args[0], b: args[1] } : { k: "call", f: t.v, args };
      }
      return t.v === "pi" ? { k: "const", v: "\\pi" } : t.v === "e" ? { k: "const", v: "e" } : { k: "var", v: t.v };
    }
    throw new Error(`unexpected "${t.v}"`);
  };
  const out = cmp();
  if (p < tk.length) throw new Error(`unexpected "${tk[p].v}"`);
  return out;
}
const CMP_TEX = { ">": ">", "<": "<", ">=": "\\ge", "<=": "\\le", "==": "=", "!=": "\\ne" };

// ---- print ---------------------------------------------------------------------------------------------------------
const ADD = 1, MUL = 2, FRAC = 2.5, POW = 4, ATOM = 5;
function num(v) {
  const m = /^([\d.]+)[eE]([+-]?\d+)$/.exec(v);
  if (!m) return v;
  const e = String(Number(m[2]));
  return Number(m[1]) === 1 ? `10^{${e}}` : `${m[1]}\\times 10^{${e}}`;
}
const FN = { sin: "\\sin", cos: "\\cos", tan: "\\tan", asin: "\\arcsin", acos: "\\arccos", atan: "\\arctan", log: "\\ln", ln: "\\ln",
  log10: "\\log_{10}", sign: "\\operatorname{sign}", min: "\\min", max: "\\max", atan2: "\\operatorname{atan2}", deg: "\\operatorname{deg}" };
const paren = s => `\\left(${s}\\right)`;
let SYM = symbol;                          // how a name is written (editLatex swaps in a reversible one)
/** [latex, precedence] of a parsed node. */
function tex(n) {
  switch (n.k) {
    case "num": return [num(n.v), /\\times/.test(num(n.v)) ? MUL : ATOM];
    case "var": return [SYM(n.v), ATOM];
    case "cmp": return [`${tex(n.a)[0]} ${CMP_TEX[n.o]} ${tex(n.b)[0]}`, 0];
    case "const": return [n.v, ATOM];
    case "neg": { const [a, pa] = tex(n.a); return [`-${pa <= ADD ? paren(a) : a}`, MUL]; }
    case "+": case "-": {
      const [a] = tex(n.a), [b, pb] = tex(n.b);
      return [`${a} ${n.k} ${n.k === "-" && pb <= ADD || b.startsWith("-") ? paren(b) : b}`, ADD];
    }
    case "*": {
      const [a, pa] = tex(n.a), [b, pb] = tex(n.b);
      const A = pa < MUL ? paren(a) : a, B = pb < MUL || b.startsWith("-") ? paren(b) : b;
      return [`${A}${/^[\d.]/.test(B) ? " \\cdot " : "\\,"}${B}`, MUL];
    }
    case "/": return [`\\frac{${tex(n.a)[0]}}{${tex(n.b)[0]}}`, FRAC];
    case "^": {
      const [a, pa] = tex(n.a), [b] = tex(n.b);
      const bare = pa === ATOM && (n.a.k !== "call" || n.a.f === "abs");      // |x|^2 needs no brackets; sin(x)^2 does
      return [`${bare ? a : paren(a)}^{${b}}`, POW];
    }
    case "call": {
      const args = n.args.map(x => tex(x)[0]);
      if (n.f === "sqrt") return [`\\sqrt{${args[0]}}`, ATOM];
      if (n.f === "abs") return [`\\left|${args[0]}\\right|`, ATOM];
      if (n.f === "exp") return [`e^{${args[0]}}`, POW];
      const f = FN[n.f] || `\\operatorname{${n.f}}`;
      // one plain symbol: \sin\theta, \ln r (no brackets)
      if (args.length === 1 && FN[n.f] && ["var", "const"].includes(n.args[0].k) && !["min", "max", "sign", "deg"].includes(n.f)) return [`${f} ${args[0]}`, ATOM];
      return [`${f}${paren(args.join(",\\, "))}`, ATOM];
    }
  }
  throw new Error("unknown node " + n.k);
}
// ---- the math editor (v8.9, human 2026-10-15: "have the equation itself be an editable thing like desmos") ----------
/** A name written so it reads back as the same name: as symbol(), except names that are not one symbol there
 *  (a symbol with a slash, e.g. a plugin's s_norm = s/s_max) are written upright. */
export const editSymbol = name => (/\//.test(KNOWN[name] || "") ? `\\mathrm{${name.replace(/_/g, "\\_")}}` : symbol(name));
/** LaTeX of formula `src` for the math editor, and the map symbol key → name to read it back (latexToFormula). */
export function editLatex(src) {
  const names = new Map();
  for (const n of formulaNames(src)) names.set(symbolKey(editSymbol(n)), n);
  SYM = editSymbol;
  try { return { tex: src.trim() ? tex(parseFormula(src))[0] : "", names }; }
  finally { SYM = symbol; }
}
/** The key of one written symbol ("r_{\\max}" → "r_max", "B_p" → "B_p", "\\theta_{\\rm foot}" → "theta_foot"). */
export function symbolKey(t) {
  const P = latexParser(t), n = P.primary();
  return n?.k === "var" ? n.v : null;
}
/** The formula (the viewer's text) a LaTeX equation says: what the math editor gives back. names: symbol key → name
 *  (from editLatex); braces: parameters as {name} (functions) or bare (expressions). Throws with a short message. */
export function latexToFormula(t, names = new Map(), braces = true) {
  const P = latexParser(t, names);
  const tree = P.expr();
  if (!P.done()) throw new Error(`can't read "${P.rest()}"`);
  return formulaText(tree, braces);
}
const LFUNC = { sin: "sin", cos: "cos", tan: "tan", arcsin: "asin", arccos: "acos", arctan: "atan", ln: "log", log: "log10", exp: "exp",
  min: "min", max: "max" };
const WORDFN = new Set(["sqrt", "abs", "log", "log10", "ln", "exp", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sign", "min", "max", "deg"]);
const SPACES = new Set([",", ";", ":", "!", " ", "quad", "qquad", "space", "thinspace", "medspace", "thickspace", "enspace", "nobreak", "displaystyle", "textstyle"]);
const OPENERS = { "(": ")", "[": "]", "lbrack": "rbrack", "lparen": "rparen", "{": "}", "lbrace": "rbrace" };
function latexParser(t, names = new Map()) {
  // tokens: commands, numbers, single letters, other characters; spacing commands dropped
  const tk = [];
  for (let i = 0; i < t.length;) {
    const c = t[i];
    if (/\s/.test(c) || c === "~") { i++; continue; }
    if (c === "\\") {
      const m = /^\\([A-Za-z]+)/.exec(t.slice(i));
      const v = m ? m[1] : t[i + 1]; i += m ? m[0].length : 2;
      if (!SPACES.has(v)) tk.push({ t: "cmd", v });
      continue;
    }
    const n = /^(\d+\.?\d*|\.\d+)/.exec(t.slice(i));
    if (n) { tk.push({ t: "num", v: n[1] }); i += n[0].length; continue; }
    tk.push({ t: /[A-Za-z]/.test(c) ? "let" : "op", v: c === "·" || c === "×" ? "*" : c === "−" ? "-" : c }); i++;
  }
  let p = 0;
  const peek = () => tk[p], is = (k, v) => tk[p] && tk[p].t === k && (v === undefined || tk[p].v === v);
  const isOp = v => is("op", v), isCmd = v => is("cmd", v);
  const fail = m => { throw new Error(m); };
  const eatOp = v => { if (!isOp(v)) fail(`expected "${v}"`); p++; };
  /** The raw text of a {…} group (for \mathrm{…}, subscripts). */
  const rawGroup = () => {
    if (!isOp("{")) { const x = tk[p++]; return x ? (x.t === "cmd" ? x.v : x.v) : ""; }
    p++; let depth = 1, s = "";
    while (p < tk.length) {
      const x = tk[p++];
      if (x.t === "op" && x.v === "{") depth++;
      else if (x.t === "op" && x.v === "}" && !--depth) break;
      s += x.t === "cmd" ? (x.v === "_" ? "_" : x.v === "rm" || x.v === "mathrm" || x.v === "text" || x.v === "mathit" ? "" : x.v) : x.v;
    }
    return s.replace(/[{}\s]/g, "");
  };
  const group = () => { if (isOp("{")) { p++; const e = expr(); eatOp("}"); return e; } return primary(); };
  /** A symbol: base (letter, Greek, upright word) with an optional subscript → its name. */
  const sym = base => {
    let key = base;
    if (isOp("_")) { p++; const sub = rawGroup(); if (sub) key += "_" + sub; }
    return { k: "var", v: names.get(key) ?? key };
  };
  // a bracketed part: ( … ), [ … ], \left( … \right), | … | (abs)
  const bracket = () => {
    let left = false;
    if (isCmd("left") || isCmd("mleft") || /^[bB]igg?l$/.test(peek()?.v || "")) { p++; left = true; }
    const o = tk[p++], ov = o?.v;
    const abs = ov === "|" || ov === "vert" || ov === "lvert" || ov === "|";
    const close = abs ? null : OPENERS[ov];
    if (!abs && !close) fail(`can't read "${ov}"`);
    const inner = abs ? expr(true) : expr();
    if (isCmd("right") || isCmd("mright") || /^[bB]igg?r$/.test(peek()?.v || "")) p++;
    const c = tk[p++];
    if (!c || (abs ? !["|", "vert", "rvert"].includes(c.v) : c.v !== close && c.v !== close)) fail(abs ? "an open |" : `expected "${close}"`);
    return abs ? { k: "call", f: "abs", args: [inner] } : inner;
  };
  const startsBracket = () => isOp("(") || isOp("[") || isCmd("left") || isCmd("mleft") || isCmd("lparen") || isCmd("lbrack") || isCmd("vert") || isCmd("lvert");
  const args = () => {                                  // (a, b) after a function name
    if (!(isOp("(") || isCmd("left") || isCmd("mleft") || isCmd("lparen"))) return [power()];
    if (isCmd("left") || isCmd("mleft")) p++;
    p++;
    const out = [expr()];
    while (isOp(",")) { p++; out.push(expr()); }
    if (isCmd("right") || isCmd("mright")) p++;
    if (!(isOp(")") || isCmd("rparen"))) fail('expected ")"');
    p++;
    return out;
  };
  const call = f => {
    let pw = null;
    if (isOp("^") && f !== "exp") { p++; pw = group(); }              // \sin^2 x
    const a = args(), c = { k: "call", f, args: a };
    return pw ? { k: "^", a: c, b: pw } : c;
  };
  function primary() {
    const x = peek();
    if (!x) fail("unexpected end");
    if (x.t === "num") { p++; return { k: "num", v: x.v }; }
    if (x.t === "let") { p++; return x.v === "e" && !isOp("_") ? { k: "const", v: "e" } : sym(x.v); }
    if (x.t === "op") {
      if (x.v === "{") { p++; const e = expr(); eatOp("}"); return e; }
      if (x.v === "(" || x.v === "[" || x.v === "|") return bracket();
      fail(`unexpected "${x.v}"`);
    }
    const v = x.v;
    if (["left", "mleft", "lparen", "lbrack", "vert", "lvert"].includes(v) || /^[bB]igg?l$/.test(v)) return bracket();
    p++;
    if (v === "frac" || v === "dfrac" || v === "tfrac") { const a = group(), b = group(); return { k: "/", a, b }; }
    if (v === "sqrt") {
      let nth = null;
      if (isOp("[")) { p++; nth = expr(); eatOp("]"); }
      const a = group();
      return nth ? { k: "^", a, b: { k: "/", a: { k: "num", v: "1" }, b: nth } } : { k: "call", f: "sqrt", args: [a] };
    }
    if (v === "pi") return { k: "const", v: "pi" };
    if (v === "exponentialE") return { k: "const", v: "e" };
    if (v === "placeholder") { rawGroup(); fail("fill in the empty box"); }
    if (GREEK.has(v)) return sym(v);
    if (v === "ast") return sym("ast");
    if (["mathrm", "operatorname", "text", "mathit", "textrm", "mathsf", "mathbf"].includes(v)) {
      const w = rawGroup();
      if (WORDFN.has(w) && (startsBracket() || isOp("^"))) return call(w === "ln" ? "log" : w);
      return sym(w);
    }
    if (v === "log" && isOp("_")) { p++; const b = rawGroup(); if (b !== "10") fail("only log₁₀ and ln"); return call("log10"); }
    if (LFUNC[v]) return call(LFUNC[v]);
    if (v === "exp") return call("exp");
    fail(`\\${v} is not understood here`);
  }
  function power() {
    let a = primary();
    while (isOp("^")) { p++; const b = group(); a = { k: "^", a, b }; }
    return a;
  }
  function unary() {
    if (isOp("-")) { p++; return { k: "neg", a: unary() }; }
    if (isOp("+")) { p++; return unary(); }
    return power();
  }
  const startsFactor = inAbs => {
    const x = peek();
    if (!x) return false;
    if (x.t === "num" || x.t === "let") return true;
    if (x.t === "op") return x.v === "(" || x.v === "[" || x.v === "{" || (x.v === "|" && !inAbs);
    return !["cdot", "times", "right", "mright", "rparen", "rbrack", "rvert", "div"].includes(x.v) && !/^[bB]igg?r$/.test(x.v) && !(inAbs && (x.v === "vert"));
  };
  function term(inAbs) {
    let a = unary();
    for (;;) {
      if (isOp("*") || isCmd("cdot") || isCmd("times")) { p++; a = { k: "*", a, b: unary() }; }
      else if (isOp("/") || isCmd("div")) { p++; a = { k: "/", a, b: unary() }; }
      else if (startsFactor(inAbs)) a = { k: "*", a, b: power() };          // implicit: 2x, I r^2
      else return a;
    }
  }
  function expr(inAbs = false) {
    let a = term(inAbs);
    while (isOp("+") || isOp("-")) { const o = tk[p++].v; a = { k: o, a, b: term(inAbs) }; }
    return a;
  }
  return { expr, primary, done: () => p >= tk.length, rest: () => tk.slice(p).map(x => (x.t === "cmd" ? "\\" + x.v : x.v)).join("") };
}
/** A parsed formula back to the viewer's text, brackets only where needed. */
export function formulaText(n, braces = true) {
  const P = { "+": 1, "-": 1, "*": 2, "/": 2, neg: 2.5, "^": 4 };
  const pr = x => P[x.k] ?? 5;
  const t = x => {
    switch (x.k) {
      case "num": return x.v;
      case "var": return braces ? `{${x.v}}` : x.v;
      case "const": return x.v;
      case "neg": return "-" + (pr(x.a) <= 1 ? `(${t(x.a)})` : t(x.a));
      case "+": case "-": { const b = t(x.b); return `${t(x.a)} ${x.k} ${(x.k === "-" && pr(x.b) <= 1) || b.startsWith("-") ? `(${b})` : b}`; }
      case "*": case "/": {
        const A = pr(x.a) < 2 ? `(${t(x.a)})` : t(x.a), b = t(x.b);
        const B = pr(x.b) < 2 || (x.k === "/" && pr(x.b) === 2) || b.startsWith("-") ? `(${b})` : b;
        return `${A} ${x.k} ${B}`;
      }
      case "^": { const A = pr(x.a) < 5 ? `(${t(x.a)})` : t(x.a), b = t(x.b); return `${A}^${pr(x.b) < 5 || b.startsWith("-") ? `(${b})` : b}`; }
      case "call": return `${x.f}(${x.args.map(t).join(", ")})`;
    }
    throw new Error("unknown node " + x.k);
  };
  return t(n);
}

/** The names a formula uses ({parameters} and bare names), in order of first use; [] if it can't be read. */
export function formulaNames(src) {
  let tree; try { tree = parseFormula(src); } catch { return []; }
  const out = [], walk = n => { if (!n) return; if (n.k === "var" && !out.includes(n.v)) out.push(n.v); walk(n.a); walk(n.b); (n.args || []).forEach(walk); };
  walk(tree);
  return out;
}
/** "name = formula" as LaTeX (throws if the formula can't be read). */
export function formulaToLatex(formula, name = null) {
  const body = tex(parseFormula(formula))[0];
  return name ? `${symbol(name)} = ${body}` : body;
}

// ---- typesetting (KaTeX from vendor/katex, loaded the first time it is needed) ---------------------------------------
let katexP = null;
export function loadKatex(base = "vendor/katex/") {
  return (katexP ??= new Promise((res, rej) => {
    if (window.katex) return res(window.katex);
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = base + "katex.min.css"; document.head.append(l);
    const s = document.createElement("script"); s.src = base + "katex.min.js";
    s.onload = () => (window.katex ? res(window.katex) : rej(new Error("KaTeX did not start")));
    s.onerror = () => { katexP = null; rej(new Error("KaTeX did not load")); };
    document.head.append(s);
  }));
}
/** Typeset `src` into element `node` (display style); without KaTeX the LaTeX source is shown. Returns an error or null. */
export async function renderMath(node, src, display = true) {
  try {
    const k = await loadKatex();
    node.classList.remove("texsrc");
    k.render(src, node, { displayMode: display, throwOnError: true, strict: false });
    return null;
  } catch (e) {
    node.textContent = src; node.classList.add("texsrc");
    return e.message;
  }
}
