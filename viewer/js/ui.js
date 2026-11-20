// ui.js — DOM helpers and the small pop-up editors (click-to-edit text, legend entry style).
import { DASHES } from "./render.js";

export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "value" || k === "checked" || k === "selected") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
export const select = (options, value, onchange, props = {}) =>
  el("select", { ...props, onchange: e => onchange(e.target.value) },
    options.map(o => (Array.isArray(o) ? el("option", { value: o[0], selected: String(o[0]) === String(value) }, o[1])
                                        : el("option", { value: o, selected: String(o) === String(value) }, o))));
/** A number field; a typo is marked red and ignored (v5.2: it used to set NaN, e.g. a blank map from vmin). */
export const num = (value, onchange, props = {}) =>
  el("input", { type: "text", size: 7, ...props, value: value ?? "", onchange: e => {
    const t = e.target.value.trim(), x = Number(t);
    if (t === "") { e.target.classList.remove("bad"); onchange(null); return; }
    e.target.classList.toggle("bad", !isFinite(x));
    if (isFinite(x)) onchange(x);
  } });
export const text = (value, onchange, props = {}) =>
  el("input", { type: "text", size: 14, ...props, value: value ?? "", onchange: e => onchange(e.target.value) });
/** A small on/off button (v8.4: "log", "±", "⇄", "🔒" … instead of checkbox + words; the words go in its hover box). */
export const toggle = (label, value, onchange, props = {}) =>
  el("button", { ...props, class: "tog" + (value ? " on" : "") + (props.class ? " " + props.class : ""), onclick: () => onchange(!value) }, label);
export const check = (label, value, onchange, props = {}) =>
  el("label", { class: "chk", ...props }, el("input", { type: "checkbox", checked: !!value, onchange: e => onchange(e.target.checked) }), label);

/** A link that opens the data manager on one cell (quantity × dataset) — v8.1, UI review §4.5: compute it there. */
export const dmLink = (q, run) => el("a", { href: `datamgr.html#focus=${encodeURIComponent(q)}|${encodeURIComponent(run)}`, target: "_blank",
  title: "open the data manager on this quantity and dataset" }, "open in the data manager ↗");

// ---- hover boxes (v8.4, human 2026-10-15: "hover over can show helpful things like tooltips (I don't want too many
// words)"; "anytime you have a paragraph of how a thing works … split it up into hover boxes"). Every title becomes a
// quick hover box (the browser's own appears late and plain); el._tip(box) can fill one with anything (equations). ----
let tipEl = null, tipFor = null, tipTimer = 0;
export function hideTip() { clearTimeout(tipTimer); tipEl?.remove(); tipEl = null; tipFor = null; }
if (typeof document !== "undefined") {
  document.addEventListener("mouseover", e => {
    const t = e.target.closest?.("[title], [data-tip], .hastip");
    if (!t || t === tipFor) return;
    if (t.hasAttribute("title")) { const v = t.getAttribute("title"); t.removeAttribute("title"); if (v) t.dataset.tip = v; }
    if (!t.dataset.tip && !t._tip) return;
    hideTip(); tipFor = t;
    tipTimer = setTimeout(() => {
      if (tipFor !== t || !t.isConnected) return;
      tipEl = document.createElement("div"); tipEl.className = "tipbox";
      if (t._tip) t._tip(tipEl); else tipEl.textContent = t.dataset.tip;
      document.body.append(tipEl);
      const r = t.getBoundingClientRect(), b = tipEl.getBoundingClientRect();
      let y = r.bottom + 6;
      if (y + b.height > innerHeight - 4) y = Math.max(4, r.top - b.height - 6);
      tipEl.style.left = Math.max(4, Math.min(r.left, innerWidth - b.width - 6)) + "px"; tipEl.style.top = y + "px";
      if (t._tip) setTimeout(() => {                    // typeset content (KaTeX) grows after it is placed
        if (!tipEl) return;
        const b2 = tipEl.getBoundingClientRect();
        if (b2.bottom > innerHeight - 4) tipEl.style.top = Math.max(4, r.top - b2.height - 6) + "px";
        if (b2.right > innerWidth - 4) tipEl.style.left = Math.max(4, innerWidth - b2.width - 6) + "px";
      }, 60);
    }, 300);
  });
  document.addEventListener("mouseout", e => { if (tipFor && !tipFor.contains(e.relatedTarget)) hideTip(); });
  for (const ev of ["mousedown", "keydown", "wheel"]) document.addEventListener(ev, hideTip, true);
}
/** A hover box at a point, for things drawn on a canvas (v8.19: a legend entry's dataset). The same text again leaves
 *  it where it is; no text hides it. Leaving the canvas, a click, a key or the wheel hide it too. */
const AT = { contains: () => false, text: null };
export function tipAt(x, y, text) {
  if (!text) { if (tipFor === AT) hideTip(); return; }
  if (tipFor === AT && AT.text === text) return;
  hideTip(); tipFor = AT; AT.text = text;
  tipTimer = setTimeout(() => {
    if (tipFor !== AT) return;
    tipEl = document.createElement("div"); tipEl.className = "tipbox"; tipEl.textContent = text;
    document.body.append(tipEl);
    const b = tipEl.getBoundingClientRect();
    tipEl.style.left = Math.max(4, Math.min(x + 12, innerWidth - b.width - 6)) + "px";
    tipEl.style.top = (y + 18 + b.height > innerHeight - 4 ? Math.max(4, y - b.height - 8) : y + 18) + "px";
  }, 300);
}

// ---- boxes (v14.5, architecture review §5.2, RULES P5 / DECISIONS D12) ------------------------------------
// Human 2026-11-13: tool cards and settings boxes "are the same design concept so should follow the same rules". Every
// pop-up box goes through popover() and so behaves one way:
//   - a CARD (a box with a title, .pop-title): its title bar has × and drags the box; the box stays on screen while its
//     content changes;
//   - a QUICK MENU (no title: ⋯ menus, choices): no title bar;
//   - both close when you click outside every box, and Esc closes the top box;
//   - popover(…, {over: true}) opens a box OVER the current one (a colour picker over its card), which stays open;
//     a click inside a lower box closes the boxes above it.
// Exempt (RULES P5): blocking questions (askName / askForm / askConfirm) stay centred; hover boxes and toasts.
let stack = [], away = null;                              // open boxes, bottom first
/** Close the top box (a stacked picker first, then its card). */
export function closePopover() {
  closeSubmenu();
  stack.pop()?.remove();
  if (!stack.length && away) { document.removeEventListener("mousedown", away); away = null; }   // v5.2: no leftover listener
}
/** Close every box. */
export function closeAllPopovers() { closeSubmenu(); while (stack.length) closePopover(); }
/** The top box, or null. */
export const topPopover = () => stack[stack.length - 1] ?? null;
// Esc closes the top box (submenu, picker, card) before anything else hears it (the settings box, selections, placing)
if (typeof document !== "undefined") document.addEventListener("keydown", e => {   // (not in the node tests)
  if (e.key !== "Escape" || !(sub || stack.length) || document.querySelector(".modal-back")) return;   // v14.7: a blocking question answers its own Esc
  e.stopPropagation(); e.preventDefault();
  if (sub) closeSubmenu(); else closePopover();
}, true);
/** Keep a box inside the window (it may have grown or shrunk). */
function keepOnScreen(box) {
  const r = box.getBoundingClientRect();
  box.style.left = Math.max(4, Math.min(parseFloat(box.style.left) || r.left, innerWidth - r.width - 8)) + "px";
  box.style.top = Math.max(4, Math.min(parseFloat(box.style.top) || r.top, innerHeight - r.height - 8)) + "px";
}
/** A card's title bar: × and dragging (a box without a title is a quick menu). */
function dress(box) {
  foldHints(box);
  const t = box.querySelector(":scope > .pop-title");
  box.classList.toggle("card", !!t);
  if (!t) return;
  if (!t.querySelector(":scope > .pop-x")) t.append(el("button", { class: "pop-x", title: "close (Esc)", onclick: e => { e.stopPropagation(); closeBox(box); } }, "×"));
  t.onpointerdown = e => {
    if (e.button !== 0 || e.target.closest("button, input, select, textarea, a")) return;
    e.preventDefault();
    const r = box.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = ev => { box.style.left = ev.clientX - dx + "px"; box.style.top = ev.clientY - dy + "px"; keepOnScreen(box); };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
}
/** Close one box and every box above it. */
function closeBox(box) { const i = stack.indexOf(box); if (i >= 0) while (stack.length > i) closePopover(); }
// v8.21 (human 2026-11-04: "when I click colorbar and then try to set linking as own … the popup for selecting own vs
// not own makes my original settings dissapear"): a small menu over a pop-up (the sharing tag's) that leaves the pop-up
// open. It closes on a choice, a click anywhere else, or with the pop-up.
let sub = null, subAway = null;
export function closeSubmenu() {
  if (sub) { sub.remove(); sub = null; }
  if (subAway) { document.removeEventListener("mousedown", subAway, true); subAway = null; }
}
export function submenu(clientX, clientY, content) {
  closeSubmenu();
  const box = el("div", { class: "popover submenu" }, content);
  document.body.append(box);
  const r = box.getBoundingClientRect();
  box.style.left = Math.max(4, Math.min(clientX, innerWidth - r.width - 8)) + "px";
  box.style.top = Math.max(4, Math.min(clientY + 8, innerHeight - r.height - 8)) + "px";
  sub = box;
  setTimeout(() => {
    if (sub !== box) return;
    subAway = e => { if (!box.contains(e.target)) closeSubmenu(); };
    document.addEventListener("mousedown", subAway, true);
  });
  return box;
}
/** v8.4 (human 2026-10-15: "anytime you have a paragraph of how a thing works … split it up into hover boxes"): a
 *  pop-up's help paragraphs (.pop-hint) go into the hover box of its title, which gets an ⓘ. */
function foldHints(box) {
  const hints = [...box.querySelectorAll(".pop-hint")];
  if (!hints.length) return;
  const text = hints.map(h => h.textContent.trim()).filter(Boolean).join("\n");
  hints.forEach(h => h.remove());
  const t = box.querySelector(".pop-title") || box.insertBefore(el("div", { class: "pop-title" }), box.firstChild);
  t.dataset.tip = text; t.classList.add("hashelp");
}
/** Open a box at the click (see "boxes" above). {over: true}: over the current box (a picker over its card). */
export function popover(clientX, clientY, content, { over = false } = {}) {
  if (over && stack.length) closeSubmenu(); else closeAllPopovers();
  const box = el("div", { class: "popover" + (over ? " over" : "") }, content);
  // v7.1 fix: editors refill the box with replaceChildren(…, cond ? x : null, …), which wrote "null" as text; skip
  // empty parts like el() does. v14.5: a refilled card keeps its title bar and stays on screen.
  box.replaceChildren = (...kids) => { Element.prototype.replaceChildren.call(box, ...kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false)); dress(box); keepOnScreen(box); };
  dress(box);
  document.body.append(box);
  const r = box.getBoundingClientRect();
  box.style.left = Math.min(clientX, innerWidth - r.width - 8) + "px";
  box.style.top = Math.min(clientY + 8, innerHeight - r.height - 8) + "px";
  keepOnScreen(box);
  box.style.zIndex = String(35 + stack.length);           // a box opened over another sits on top of it
  stack.push(box);
  setTimeout(() => {
    if (!stack.includes(box) || away) return;             // already closed, or the listener is on
    // a click outside every box closes them all; a click inside a lower box closes the boxes above it
    away = e => {
      if (sub?.contains(e.target)) return;
      if (e.target.closest?.(".modal-back")) return;      // v14.7: answering a blocking question (rename, delete) keeps the cards under it
      let i = -1;
      for (let k = stack.length - 1; k >= 0; k--) if (stack[k].contains(e.target)) { i = k; break; }
      if (i < 0) closeAllPopovers(); else while (stack.length > i + 1) closePopover();
    };
    document.addEventListener("mousedown", away);
  });
  const first = box.querySelector("input");
  if (first) { first.focus(); first.select?.(); }
  return box;
}

/** Edit one text (title / axis label / colourbar label) — applied live while typing. null = automatic. */
export function editText(clientX, clientY, { what, value, auto, onSet, extra = null }) {
  const inp = el("input", { type: "text", size: 32, value: value ?? auto, title: `automatic: ${auto}
changes apply as you type · {name} = a variable · $…$ = LaTeX` });
  inp.addEventListener("input", () => onSet(inp.value === auto || inp.value === "" ? null : inp.value));
  inp.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === "Escape") closePopover(); });
  popover(clientX, clientY, [
    el("div", { class: "pop-title" }, what),
    inp,
    extra ? el("div", { class: "pop-row" }, extra) : null,
    el("div", { class: "pop-row" },
      el("button", { onclick: () => { inp.value = auto; onSet(null); }, title: auto }, "↺ automatic"),
      el("button", { onclick: closePopover }, "done")),
  ]);
}

// ---- colours: presets + colours already used on the desktop + the full picker (human 2026-10-01) ------
export const PRESETS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
  "#bcbd22", "#17becf", "#000000", "#ffffff", "#39ff14"];
/** Swatch rows + <input type=color>. Returns {el, input}; onPick(colour) on every change. */
export function colorPicker(value, onPick, used = []) {
  const input = el("input", { type: "color", value: value || "#000000", oninput: e => onPick(e.target.value) });
  const sw = c => el("button", { class: "swatch", style: `background:${c}`, title: c, onclick: () => { input.value = c; onPick(c); } });
  const extra = [...new Set(used.map(c => c.toLowerCase()))].filter(c => !PRESETS.includes(c)).slice(0, 12);
  return el("div", { class: "picker" },
    el("div", { class: "pop-row swatches" }, PRESETS.map(sw), input),
    extra.length ? el("div", { class: "pop-row swatches" }, el("span", { class: "dim" }, "in use:"), extra.map(sw)) : null);
}

/** A colour swatch button that opens the picker (tool colours in the settings box). */
export function colorButton(value, onPick, used = []) {
  const b = el("button", { class: "swatch big", style: `background:${value}`, title: "colour" });
  // v14.5: the picker opens over its card, which stays open (it used to close the card)
  b.onclick = e => popover(e.clientX, e.clientY, [el("div", { class: "pop-title" }, "colour"), colorPicker(value, c => { b.style.background = c; onPick(c); }, used)], { over: !!b.closest(".popover") });
  return b;
}

// ---- in-page dialogs (window.prompt/confirm don't work in every embedded browser) ---------------------------
function modal(content) {
  closeSubmenu();                                          // v14.7: the cards stay open under the question (a table card while you name a column)
  const back = el("div", { class: "modal-back" });
  back.append(el("div", { class: "modal small" }, content));
  document.body.append(back);
  return back;
}
/** Ask for a name; resolves to the text, or null when cancelled. */
export function askName(title, value = "") {
  return new Promise(res => {
    const inp = el("input", { type: "text", size: 36, value });
    const done = v => { back.remove(); res(v); };
    inp.addEventListener("keydown", e => { if (e.key === "Enter") done(inp.value.trim() || null); if (e.key === "Escape") done(null); });
    const back = modal([el("b", {}, title), inp,
      el("div", { class: "dim" }, "letters, digits, - _ . and spaces"),
      el("div", { class: "modal-foot" }, el("button", { onclick: () => done(null) }, "cancel"), el("button", { class: "on", onclick: () => done(inp.value.trim() || null) }, "save"))]);
    inp.focus(); inp.select();
  });
}
/** A small form: `body` nodes; resolves true (ok / Enter in a text field) or false (cancel / Esc). */
export function askForm(title, body, ok = "ok") {
  return new Promise(res => {
    const done = v => { back.remove(); res(v); };
    const back = modal([el("b", {}, title), ...body,
      el("div", { class: "modal-foot" }, el("button", { onclick: () => done(false) }, "cancel"), el("button", { class: "on", onclick: () => done(true) }, ok))]);
    back.addEventListener("keydown", e => { if (e.key === "Escape") done(false); if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type === "text") done(true); });
    back.querySelector("input[type=text], select")?.focus();
  });
}
export function askConfirm(message, yes = "yes") {
  return new Promise(res => {
    const done = v => { back.remove(); res(v); };
    const back = modal([el("div", {}, message), el("div", { class: "modal-foot" }, el("button", { onclick: () => done(false) }, "cancel"), el("button", { class: "on", onclick: () => done(true) }, yes))]);
  });
}

/** A list dialog (saved desktops / panel setups). items: [{name, info, actions: [[label, fn]]}] */
export function dialog(title, items, footer = []) {
  closeAllPopovers();
  const back = el("div", { class: "modal-back", onmousedown: e => { if (e.target === back) back.remove(); } });
  const box = el("div", { class: "modal" },
    el("div", { class: "modal-head" }, el("b", {}, title), el("button", { onclick: () => back.remove() }, "×")),
    items.length ? el("div", { class: "modal-list" }, items.map(it =>
      el("div", { class: "modal-item" }, el("span", { class: "mi-name" }, it.name), el("span", { class: "mi-info" }, it.info || ""),
        it.actions.map(([label, fn]) => el("button", { onclick: () => { fn(); back.remove(); } }, label)))))
      : el("div", { class: "dim" }, "nothing saved yet"),
    el("div", { class: "modal-foot" }, footer.map(([label, fn]) => el("button", { onclick: () => { fn(); back.remove(); } }, label))));
  back.append(box);
  document.body.append(back);
  return back;
}

/** Zoom factor of one wheel event (v8, human 2026-10-14): proportional to how far the wheel moved (a mouse notch ≈
 *  25 %, a trackpad's small steps zoom smoothly instead of racing); sideways swipes do nothing, except with Shift
 *  (a mouse wheel with Shift scrolls sideways in Chromium). 1 = no zoom. */
export function wheelFactor(e, shift = false) {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  let d = e.deltaY * unit;
  if (shift && Math.abs(e.deltaX) > Math.abs(e.deltaY)) d = e.deltaX * unit;
  else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return 1;
  if (!d) return 1;
  return Math.exp(Math.max(-0.7, Math.min(0.7, d * 0.0022)));
}
