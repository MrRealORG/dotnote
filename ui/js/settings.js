// DotNote — settings.js : full settings (providers, HF models, voice, themes, shortcuts, data)
"use strict";

const SETTINGS_SECTIONS = [
  { id: "appearance", label: "Appearance", ic: "◑" },
  { id: "providers", label: "AI Providers", ic: "✦" },
  { id: "models", label: "Models (whisper)", ic: "⬇" },
  { id: "voice", label: "Voice & Live", ic: "🎙" },
  { id: "shortcuts", label: "Shortcuts", ic: "⌨" },
  { id: "data", label: "Data & Backup", ic: "▣" },
  { id: "about", label: "About", ic: "●" },
];

function openSettings(section = "appearance") {
  const side = el("div", { class: "sn-side" });
  const body = el("div", { class: "sn-body" });
  const nav = el("div", { class: "settings-nav", style: "display:flex;min-height:0;flex:1;" }, side, body);
  const foot = el("div");
  foot.append(el("button", { class: "btn", onclick: closeModal }, "Done"));
  const { body: host } = openModal(nav, { title: "Settings", size: "xl", foot });
  host.style.padding = "0";
  host.style.display = "flex";
  host.style.overflow = "hidden";
  // modal .mo-body already wraps nav; make it full height
  host.classList.add("settings-host");

  const renderSide = (activeId) => {
    side.innerHTML = "";
    for (const s of SETTINGS_SECTIONS) {
      side.append(el("button", { class: `nav-item ${s.id === activeId ? "active" : ""}`, onclick: () => renderSide(s.id) },
        el("span", { style: "width:18px;text-align:center;" }, s.ic), s.label));
    }
    renderSection(body, activeId);
  };
  renderSide(section);
}

const setRow = (label, desc, control) =>
  el("div", { class: "set-row" },
    el("div", { class: "sr-label" }, el("div", { class: "l1" }, label), desc ? el("div", { class: "l2" }, desc) : null),
    control);

function sliderRow(label, desc, min, max, step, key, fmt = (v) => v) {
  const val = el("span", { class: "slider-val" }, fmt(+S.settings[key] || min));
  const sl = el("input", { type: "range", min, max, step, value: +S.settings[key] || min });
  sl.addEventListener("input", () => { val.textContent = fmt(+sl.value); });
  sl.addEventListener("change", async () => { S.settings[key] = +sl.value; await setSetting(key, +sl.value); applyAppearance(); });
  return setRow(label, desc, el("div", { class: "flex" }, sl, val));
}

function toggleRow(label, desc, key, onChange) {
  const t = el("div", { class: `toggle ${S.settings[key] ? "on" : ""}` });
  t.addEventListener("click", async () => {
    S.settings[key] = !S.settings[key];
    t.classList.toggle("on", S.settings[key]);
    await setSetting(key, S.settings[key]);
    onChange?.(S.settings[key]);
  });
  return setRow(label, desc, t);
}

function group(title, desc, ...rows) {
  return el("div", { class: "set-group" },
    el("div", { class: "sg-title" }, title),
    desc ? el("div", { class: "sg-desc" }, desc) : null,
    ...rows);
}

function renderSection(host, id) {
  host.innerHTML = "";
  if (id === "appearance") return renderAppearance(host);
  if (id === "providers") return renderProviders(host);
  if (id === "models") return renderModels(host);
  if (id === "voice") return renderVoice(host);
  if (id === "shortcuts") return renderShortcuts(host);
  if (id === "data") return renderData(host);
  if (id === "about") return renderAbout(host);
}

// ---------- appearance ----------
function renderAppearance(host) {
  const themeGrid = el("div", { class: "theme-grid" });
  for (const t of THEMES) {
    const card = el("div", { class: `theme-card ${S.settings.theme === t.id ? "active" : ""}` });
    const prev = el("div", { class: "tc-preview", style: `background:${t.swatches[0]};` });
    t.swatches.forEach((c, i) => prev.append(el("i", { style: `background:${c};${i === 3 ? "border-radius:50%;" : ""}` })));
    card.append(prev, el("div", { class: "tc-name", style: `background:${t.swatches[1]};color:${t.swatches[2]};` }, t.name));
    card.addEventListener("click", async () => {
      S.settings.theme = t.id;
      await setSetting("theme", t.id);
      applyTheme();
      renderAppearance(host);
    });
    themeGrid.append(card);
  }
  const accentInput = el("input", { type: "text", value: S.settings.accent || "#d71921", style: "max-width:120px;" });
  accentInput.addEventListener("change", async () => {
    S.settings.accent = accentInput.value;
    await setSetting("accent", accentInput.value);
    applyTheme();
  });
  const nameInput = el("input", { type: "text", value: S.settings.user_name || "you", style: "max-width:160px;" });
  nameInput.addEventListener("change", async () => {
    S.settings.user_name = nameInput.value.trim() || "you";
    await setSetting("user_name", S.settings.user_name);
    refreshUserName();
  });
  host.append(
    group("THEME", "Nothing-inspired mono themes. Pick one — instant, no restart.", themeGrid),
    group("CUSTOMIZE", "Make it yours — colors, sizes, density, zoom.",
      setRow("Accent color", "Buttons, highlights, mentions", accentInput),
      setRow("Your name", "Shown in chat", nameInput),
      sliderRow("Font size", "Base text size", 12, 20, 1, "font_size", (v) => `${v}px`),
      sliderRow("UI scale", "Everything up / down", 80, 130, 5, "ui_scale", (v) => `${v}%`),
      sliderRow("Density", "Text density", 85, 115, 5, "density", (v) => `${v}%`),
      sliderRow("Zoom", "App zoom (also Ctrl + / Ctrl -)", 70, 150, 10, "zoom", (v) => `${v}%`),
      toggleRow("Dot-matrix background", "The Nothing-style dot grid", "dotgrid", () => applyAppearance()),
    ),
  );
}

// ---------- providers ----------
const PROVIDERS = [
  { id: "openrouter", name: "OpenRouter", hint: "Hundreds of models incl. FREE ones (:free). openrouter.ai/keys", keyPlaceholder: "sk-or-v1-…" },
  { id: "groq", name: "Groq", hint: "Fastest free tier + whisper-large-v3-turbo transcription. console.groq.com", keyPlaceholder: "gsk_…" },
  { id: "openai", name: "OpenAI", hint: "GPT models + Whisper transcription. platform.openai.com", keyPlaceholder: "sk-…" },
  { id: "hf", name: "Hugging Face", hint: "HF Inference API — chat + whisper models. hf.co/settings/tokens", keyPlaceholder: "hf_…" },
  { id: "ollama", name: "Ollama (local)", hint: "100% offline local models via Ollama on this machine", keyPlaceholder: null },
  { id: "custom", name: "Custom (OpenAI-compatible)", hint: "Any OpenAI-compatible /v1 endpoint (LM Studio, vLLM, …)", keyPlaceholder: "optional key" },
];

function renderProviders(host) {
  const wrap = el("div");
  const providers = S.settings.providers || {};
  const modelsCache = S.settings.chat_provider_models || {};

  for (const p of PROVIDERS) {
    const cfg = providers[p.id] || {};
    const card = el("div", { class: "provider-card" });
    const head = el("div", { class: "pc-head" });
    head.append(el("span", { class: "pc-name" }, p.name));
    const status = el("span", { class: "pc-badge", style: "display:none;" }, "CONNECTED");
    head.append(status);
    if (p.id !== "ollama" && p.id !== "custom") {
      const tg = el("div", { class: `toggle ${cfg.enabled !== false ? "on" : ""}` });
      tg.addEventListener("click", async () => {
        cfg.enabled = !(cfg.enabled !== false);
        tg.classList.toggle("on", cfg.enabled);
        await saveProviders();
      });
      head.append(tg);
    }
    card.append(head, el("div", { class: "small dim", style: "margin-top:4px;" }, p.hint));

    const row = el("div", { class: "pc-row" });
    if (p.id === "ollama" || p.id === "custom") {
      const url = el("input", { type: "text", placeholder: "http://127.0.0.1:11434/v1", value: cfg.url || "" });
      url.addEventListener("change", async () => { cfg.url = url.value.trim(); await saveProviders(); });
      row.append(url);
    }
    if (p.keyPlaceholder) {
      const key = el("input", { type: "password", placeholder: p.keyPlaceholder, value: cfg.key || "", autocomplete: "off" });
      key.addEventListener("change", async () => { cfg.key = key.value.trim(); await saveProviders(); refreshStatus(); });
      row.append(key);
    }
    const fetchBtn = el("button", { class: "btn sm", title: "Fetch available models" }, "⟳ Models");
    fetchBtn.addEventListener("click", async () => {
      fetchBtn.textContent = "…";
      try {
        const ids = await invoke("ai_list_provider_models", { provider: p.id });
        modelsCache[p.id] = ids;
        S.settings.chat_provider_models = modelsCache;
        await setSetting("chat_provider_models", modelsCache);
        toast(`${p.name}: ${ids.length} models fetched ✓`, "ok");
        buildModelSelect();
      } catch (e) {
        toast(String(e.message || e).replace(/^"|"$/g, ""), "err");
      }
      fetchBtn.textContent = "⟳ Models";
    });
    row.append(fetchBtn);
    card.append(row);

    const selWrap = el("div", { class: "pc-row" });
    const sel = el("select", { style: "flex:1;" });
    sel.append(el("option", { value: "" }, "— fetch or type a model id —"));
    const customInput = el("input", { type: "text", placeholder: "or type model id, e.g. llama-3.3-70b" });
    function buildModelSelect() {
      const ids = modelsCache[p.id] || [];
      sel.innerHTML = "";
      sel.append(el("option", { value: "" }, ids.length ? `— ${ids.length} models —` : "— fetch models first —"));
      for (const mid of ids) {
        const o = el("option", { value: mid }, mid + (mid.endsWith(":free") ? "  ★free" : ""));
        sel.append(o);
      }
      if (cfg.model) sel.value = cfg.model;
    }
    buildModelSelect();
    sel.addEventListener("change", async () => { cfg.model = sel.value; customInput.value = sel.value; await saveProviders(); });
    customInput.value = cfg.model || "";
    customInput.addEventListener("change", async () => { cfg.model = customInput.value.trim(); await saveProviders(); });
    selWrap.append(sel, customInput);
    card.append(selWrap);
    wrap.append(card);

    function refreshStatus() {
      const connected = p.id === "ollama" ? !!cfg.url : (p.id === "custom" ? !!cfg.url : !!cfg.key);
      status.style.display = connected ? "" : "none";
    }
    refreshStatus();
  }

  async function saveProviders() {
    S.settings.providers = providers;
    await setSetting("providers", providers);
  }

  const defSel = el("select", { style: "max-width:420px;" });
  const provSel = el("select", { style: "max-width:180px;" });
  function rebuildDefault() {
    provSel.innerHTML = "";
    for (const p of PROVIDERS) provSel.append(el("option", { value: p.id }, p.name));
    provSel.value = S.settings.default_chat_provider || "openrouter";
    defSel.innerHTML = "";
    const ids = modelsCache[provSel.value] || [];
    const current = S.settings.default_chat_model || "";
    if (current && !ids.includes(current)) defSel.append(el("option", { value: current }, current + " (saved)"));
    for (const mid of ids.slice(0, 400)) defSel.append(el("option", { value: mid }, mid + (mid.endsWith(":free") ? "  ★free" : "")));
    defSel.append(el("option", { value: "" }, "— pick from fetched list —"));
    if (current && ids.includes(current)) defSel.value = current;
  }
  provSel.addEventListener("change", async () => {
    S.settings.default_chat_provider = provSel.value;
    await setSetting("default_chat_provider", provSel.value);
    rebuildDefault();
  });
  defSel.addEventListener("change", async () => {
    if (!defSel.value) return;
    S.settings.default_chat_model = defSel.value;
    await setSetting("default_chat_model", defSel.value);
    toast(`Default model: ${defSel.value}`, "ok");
  });
  rebuildDefault();

  host.append(
    group("AI PROVIDERS", "Connect ANY provider. Keys stay on your device. Use OpenRouter for free models, Groq for fast + free whisper transcription, Ollama for 100% offline.", wrap),
    group("DEFAULT CHAT MODEL", "Used for @ai in chat, note summaries and AI actions.",
      setRow("Provider", "", provSel),
      setRow("Model", "Fetch models on the provider card above first", defSel),
      sliderRow("Temperature", "Creativity", 0, 1.5, 0.1, "temperature", (v) => v.toFixed(1)),
    ),
  );
}

// ---------- models (whisper.cpp + HF) ----------
function renderModels(host) {
  const wrap = el("div");
  const statusBox = el("div", { class: "provider-card" });
  const list = el("div");

  const cliRow = el("div", { class: "pc-row" });
  const pathInput = el("input", { type: "text", placeholder: "path to whisper-cli.exe (optional)" });
  pathInput.addEventListener("change", async () => {
    await invoke("whisper_cli_set_path", { path: pathInput.value.trim() });
    refresh();
  });
  const installBtn = el("button", { class: "btn primary sm" }, "⬇ Install whisper.cpp (Windows)");
  installBtn.addEventListener("click", async () => {
    installBtn.disabled = true; installBtn.textContent = "Downloading…";
    try {
      const r = await invoke("whisper_cli_download");
      toast(`whisper.cpp installed ✓`, "ok");
    } catch (e) {
      toast(String(e.message || e).replace(/^"|"$/g, ""), "err");
    }
    installBtn.disabled = false; installBtn.textContent = "⬇ Install whisper.cpp (Windows)";
    refresh();
  });
  const browseBtn = el("button", { class: "btn sm" }, "Pick file…");
  browseBtn.addEventListener("click", async () => {
    try {
      // Tauri dialog via Rust is used elsewhere; here reuse plugin through hidden command:
      // simplest: ask user to paste path; but we can use the dialog plugin from JS? no permission. Use export trick:
      toast("Type the full path into the box (e.g. C:\\whisper\\whisper-cli.exe)");
    } catch {}
  });
  cliRow.append(pathInput, installBtn);
  statusBox.append(el("div", { class: "pc-name" }, "LOCAL SPEECH-TO-TEXT (whisper.cpp)"),
    el("div", { class: "small dim", style: "margin:4px 0 8px;" }, "100% offline & private. Install whisper.cpp once, then download any model below with one click. Or skip all this and just set a Groq/OpenAI key for cloud transcription."),
    cliRow);
  wrap.append(statusBox);
  wrap.append(el("div", { class: "side-section", style: "padding-left:0;" }, "WHISPER MODELS — HUGGING FACE (ONE CLICK)"));
  wrap.append(list);

  async function refresh() {
    const st = await invoke("whisper_status");
    const catalog = await invoke("whisper_catalog");
    pathInput.value = st.cliPath || "";
    list.innerHTML = "";
    for (const m of catalog) {
      const row = el("div", { class: `model-row ${m.active ? "active" : ""}` });
      const info = el("div", { class: "md-info" });
      info.append(el("div", { class: "md-name" }, m.name + (m.active ? "  ● ACTIVE" : m.installed ? "  ✓ INSTALLED" : "")),
        el("div", { class: "md-desc" }, m.desc), el("div", { class: "md-size" }, `~${m.sizeMb} MB · ${m.file}`));
      row.append(info);
      if (m.installed) {
        row.append(el("button", { class: "btn primary sm", disabled: m.active, onclick: async () => { await invoke("model_set_active", { name: m.file }); refresh(); toast(`${m.name} activated`, "ok"); } }, m.active ? "Active" : "Use"));
        row.append(el("button", { class: "btn sm danger", onclick: () => confirmBox(`Delete ${m.file}?`, async () => { await invoke("model_delete", { name: m.file }); refresh(); }, "Delete") }, "🗑"));
      } else {
        const dl = el("button", { class: "btn primary sm" }, `⬇ Download`);
        dl.addEventListener("click", async () => {
          dl.disabled = true; dl.textContent = "0%";
          const bar = el("div", { class: "md-bar" }, el("i"));
          row.append(bar);
          try {
            await invoke("model_download", { url: m.url, name: m.file });
            toast(`${m.name} downloaded ✓`, "ok");
          } catch (e) {
            toast(String(e.message || e).replace(/^"|"$/g, ""), "err");
          }
          refresh();
        });
        row.append(dl);
      }
      list.append(row);
    }
  }
  host.append(group("MODELS", "Browse & one-click download whisper models from Hugging Face. Switch active model any time — downloads are resumable files kept locally.", wrap));
  refresh();
}

window.onModelProgress = (p) => {
  if (!p) return;
  // update visible bars
  $$(".model-row").forEach((row) => {
    const name = row.querySelector(".md-name")?.textContent || "";
    if (name.startsWith(p.name.replace("ggml-", "").replace(".bin", "").replace(".en", "")) || p.name.includes("whisper.cpp")) {
      let bar = row.querySelector(".md-bar i");
      if (!bar) { const b = el("div", { class: "md-bar" }, el("i")); row.append(b); bar = b.querySelector("i"); }
      bar.style.width = `${p.pct || 0}%`;
    }
  });
  const dlBtns = $$(".model-row .btn.primary");
  // ignore - refresh on completion
};

// ---------- voice ----------
function renderVoice(host) {
  host.append(
    group("LIVE TRANSCRIPT", "OpenWhisper-style live transcription. Mic mode always works; Meeting mode captures tab/system audio via screen-share (Windows WebView2).",
      sliderRow("Segment length", "How often audio is transcribed", 3, 30, 1, "live_segment_sec", (v) => `${v}s`),
      sliderRow("Overlap", "Overlap between segments for continuity", 0, 3, 0.5, "live_overlap_sec", (v) => `${v}s`),
      toggleRow("Auto-summarize", "AI summary after each recording / live session", "live_auto_summarize"),
    ),
    group("STORAGE", "Voice stays on your device.",
      sliderRow("Keep recordings for", "Auto-delete after this many days", 1, 90, 1, "voice_retention_days", (v) => `${v} days`),
      setRow("Where", "Recordings folder", (() => {
        const b = el("button", { class: "btn sm" }, "Open folder");
        b.addEventListener("click", async () => {
          const info = await invoke("app_info");
          invoke("open_path", { path: `${info.dataDir}\\recordings` }).catch(() => invoke("open_path", { path: `${info.dataDir}/recordings` }));
        });
        return b;
      })()),
    ),
  );
}

// ---------- shortcuts ----------
function renderShortcuts(host) {
  const sc = S.settings.shortcuts || {};
  const defs = [
    ["quicknote", "Toggle Quick Note widget", "alt+space"],
    ["new_note", "New note (global)", "alt+n"],
    ["toggle_main", "Show / hide DotNote", "alt+m"],
    ["focus_widget", "Toggle Focus widget", "alt+f"],
    ["tasks_widget", "Toggle Tasks widget", "alt+g"],
    ["clock_widget", "Toggle Clock widget", "alt+c"],
  ];
  const rows = defs.map(([k, label, dflt]) => {
    const inp = el("input", { type: "text", value: sc[k] || dflt, style: "max-width:180px;font-family:var(--mono);" });
    inp.addEventListener("change", async () => {
      sc[k] = inp.value.trim().toLowerCase();
      S.settings.shortcuts = sc;
      await setSetting("shortcuts", sc);
      toast(`Shortcut saved — ${sc[k] || "(none)"}`, "ok");
    });
    return setRow(label, "Global — works even when DotNote is in the background", inp);
  });
  host.append(
    group("GLOBAL SHORTCUTS", "Format: modifier+key, e.g. alt+q, ctrl+shift+n, f9. Clear the field to disable.", ...rows),
    group("IN-APP", null,
      setRow("Command palette", "Search + everything", el("kbd", {}, "Ctrl K")),
      setRow("Settings", "", el("kbd", {}, "Ctrl ,")),
      setRow("New note", "", el("kbd", {}, "Ctrl N")),
      setRow("Zoom in / out / reset", "", el("span", {}, el("kbd", {}, "Ctrl +"), " ", el("kbd", {}, "Ctrl -"), " ", el("kbd", {}, "Ctrl 0"))),
    ),
  );
}

// ---------- data ----------
function renderData(host) {
  const exportBtn = el("button", { class: "btn primary" }, "⬇ Export backup (JSON)");
  exportBtn.addEventListener("click", async () => {
    try {
      const r = await invoke("export_data");
      if (r.saved) toast(`Backup saved ✓`, "ok");
    } catch (e) { toast(String(e.message || e), "err"); }
  });
  const importBtn = el("button", { class: "btn" }, "⬆ Restore from backup");
  importBtn.addEventListener("click", () => {
    confirmBox("Restore a backup? Current data will be replaced.", async () => {
      try {
        await invoke("import_data");
        toast("Backup restored — restarting data…", "ok");
        S.settings = await invoke("settings_all");
        applyTheme(); applyAppearance();
        await window.bootApp?.();
        closeModal();
      } catch (e) { toast(String(e.message || e), "err"); }
    }, "Restore");
  });
  host.append(
    group("BACKUP", "Everything (notes, channels, chat, goals, reminders, settings) in one JSON file.",
      setRow("Export", "", exportBtn),
      setRow("Import / restore", "Replaces current data", importBtn),
    ),
    group("STORAGE", null,
      setRow("Notes & data", "Stored locally in SQLite", el("span", { class: "small dim" }, "AppData/Roaming/com.dotnote.app")),
      setRow("Recordings", "Voice files (auto-deleted per retention)", el("span", { class: "small dim" }, "…/recordings")),
      setRow("Models", "Whisper ggml models", el("span", { class: "small dim" }, "…/models")),
    ),
  );
}

// ---------- about ----------
function renderAbout(host) {
  host.append(
    group("DOTNOTE", null,
      setRow("Version", "", el("span", { class: "mono small" }, "1.0.0")),
      setRow("Local-first", "Your notes never leave this machine unless you use cloud AI", el("span", {}, "●")),
      setRow("Data folder", "", (() => {
        const b = el("button", { class: "btn sm" }, "Open");
        b.addEventListener("click", async () => {
          const info = await invoke("app_info");
          invoke("open_path", { path: info.dataDir });
        });
        return b;
      })()),
    ),
    group("WHAT'S INSIDE", null,
      setRow("Editor", "Notion-style blocks, right-click menus, colors, wiki-links", el("span", {}, "")),
      setRow("Channels", "Discord-style spaces & channels with @ai and @notes", el("span", {}, "")),
      setRow("Voice", "Recordings kept 30 days · live transcripts · meeting audio", el("span", {}, "")),
      setRow("AI", "OpenRouter / Groq / OpenAI / HF / Ollama / custom", el("span", {}, "")),
      setRow("Widgets", "Quick Note · Tasks · Clock · Focus", el("span", {}, "")),
    ),
  );
}
