// DotNote — core.js : bridge to Rust backend, shared state & helpers
"use strict";

const T = window.__TAURI__;
const invoke = (cmd, args = {}) => T.core.invoke(cmd, args);
const convertFileSrc = (p) => T.core.convertFileSrc(p);
const listen = (ev, fn) => T.event.listen(ev, fn);

// ---------- global state ----------
const S = {
  settings: {},
  spaces: [],
  spaceId: null,
  channels: [],
  folders: [],
  current: { type: "channel", id: null }, // channel | folder | special
  noteId: null,
  notesCache: new Map(),
  notesList: [],
  saveTimer: null,
  view: "chat",
};

// ---------- dom ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}
const escHtml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- toasts ----------
function toast(msg, kind = "") {
  const t = el("div", { class: `toast ${kind}` }, msg);
  $("#toasts").append(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 3200);
  setTimeout(() => t.remove(), 3600);
}

// ---------- modals ----------
function openModal(inner, { title = "", size = "", foot = null, onOpen } = {}) {
  closeModal();
  const ov = el("div", { class: "overlay", id: "modalOv" });
  const mo = el("div", { class: `modal ${size}` });
  if (title) mo.append(el("div", { class: "mo-head" }, el("div", { class: "mo-title" }, title), el("button", { class: "iconbtn", onclick: closeModal }, "×")));
  const body = el("div", { class: "mo-body" });
  if (typeof inner === "string") body.innerHTML = inner; else body.append(inner);
  mo.append(body);
  if (foot) {
    const f = el("div", { class: "mo-foot" });
    if (typeof foot === "string") f.innerHTML = foot; else f.append(foot);
    mo.append(f);
  }
  ov.append(mo);
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) closeModal(); });
  document.body.append(ov);
  if (onOpen) onOpen(body, mo);
  return { ov, body, mo };
}
function closeModal() { $("#modalOv")?.remove(); }

function confirmBox(text, onYes, yesLabel = "Delete") {
  const foot = el("div");
  foot.append(
    el("button", { class: "btn", onclick: closeModal }, "Cancel"),
    el("button", { class: "btn primary danger", onclick: () => { closeModal(); onYes(); } }, yesLabel),
  );
  openModal(el("div", { class: "small" }, text), { title: "Are you sure?", foot });
}

// ---------- settings helpers ----------
function setSetting(key, value) {
  S.settings[key] = value;
  return invoke("settings_set", { key, value });
}

// ---------- time helpers ----------
function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}
function fmtDate(iso) {
  try {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return fmtTime(iso);
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return ""; }
}
function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- block <-> plain text ----------
function blocksToText(blocks) {
  const div = el("div");
  div.innerHTML = blocks.map((b) => b.html || "").join("<br>");
  return div.innerText || "";
}

// ---------- global event wiring (Rust → JS) ----------
async function initGlobalListeners() {
  await listen("reminder-fire", (e) => {
    const { title } = e.payload;
    toast(`🔔 Reminder — ${title}`);
    if (S.view !== "chat") refreshReminders?.();
  });
  await listen("tray-action", (e) => {
    const a = e.payload?.action;
    if (a === "new-note") window.newNote?.();
    if (a === "settings") window.openSettings?.();
  });
  await listen("dl-progress", (e) => window.onModelProgress?.(e.payload));
}

// ---------- boot ----------
window.addEventListener("DOMContentLoaded", async () => {
  try {
    S.settings = await invoke("settings_all");
    await initGlobalListeners();
    window.applyTheme?.();
    window.applyAppearance?.();
    await window.bootApp?.();
  } catch (err) {
    document.body.innerHTML = `<div style="padding:40px;font-family:monospace;color:#fff;background:#0a0a0a;">DotNote failed to start: ${escHtml(String(err))}</div>`;
  }
});
