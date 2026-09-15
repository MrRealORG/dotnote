// DotNote — themes.js : theme engine + appearance application
"use strict";

const THEMES = [
  { id: "nothing-dark", name: "NOTHING DARK", swatches: ["#0a0a0a", "#101010", "#f2f2f2", "#d71921"] },
  { id: "nothing-light", name: "NOTHING LIGHT", swatches: ["#ebebeb", "#f7f7f7", "#111111", "#d71921"] },
  { id: "paper", name: "PAPER", swatches: ["#f6f3ec", "#fbf9f4", "#26231c", "#c0392b"] },
  { id: "midnight", name: "MIDNIGHT", swatches: ["#070b14", "#0c1220", "#e8eefc", "#5b8cff"] },
  { id: "forest", name: "FOREST", swatches: ["#0b120e", "#101a14", "#e9f3ea", "#52d789"] },
  { id: "crimson", name: "CRIMSON", swatches: ["#0d0708", "#150b0d", "#f7ecee", "#d71921"] },
];

function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme || "nothing-dark";
  document.documentElement.style.setProperty("--accent", S.settings.accent || "#d71921");
}

function applyAppearance() {
  document.body.classList.toggle("dotgrid", S.settings.dotgrid !== false);
  const root = document.documentElement.style;
  root.setProperty("--fs", `${S.settings.font_size || 15}px`);
  root.setProperty("--scale", (S.settings.ui_scale || 100) / 100);
  root.setProperty("--density", (S.settings.density || 100) / 100);
  root.zoom = `${(S.settings.zoom || 100) / 100}`;
  const name = (S.settings.user_name || "you");
  const un = $("#userName"); if (un) un.textContent = name;
  const av = $(".usercard .avatar"); if (av) av.textContent = name[0]?.toUpperCase() || "Y";
}

function themeQuickToggle() {
  const cur = S.settings.theme || "nothing-dark";
  const next = cur === "nothing-dark" ? "nothing-light" : "nothing-dark";
  setSetting("theme", next).then(applyTheme);
}

async function refreshUserName() {
  const name = (S.settings.user_name || "you");
  const un = $("#userName"); if (un) un.textContent = name;
  const av = $(".usercard .avatar"); if (av) av.textContent = name[0]?.toUpperCase() || "Y";
}
