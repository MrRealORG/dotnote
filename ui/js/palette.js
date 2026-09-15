// DotNote — palette.js : command palette (Ctrl+K) — Obsidian-style search + actions
"use strict";

const Palette = (() => {
  let items = [];
  let sel = 0;
  let overlay = null;

  async function buildActions(q) {
    const acts = [];
    const add = (title, sub, ic, fn, kbd) => acts.push({ title, sub, ic, fn, kbd });
    add("New note", "Create in current space", "＋", () => window.newNote?.(), "Ctrl N");
    add("New chat channel", "Discord-style channel", "#", () => window.newChannel?.("chat"));
    add("New notes channel", "Notes inside a channel", "#", () => window.newChannel?.("notes"));
    add("New folder", "Organize notes", "▣", () => window.newFolder?.());
    add("New goal", "Track progress + reminders", "◎", () => { window.gotoView?.("goals"); $("#btnNewGoal").click(); });
    add("Voice room", "Record & live transcript", "🎙", () => window.gotoVoice?.());
    add("Toggle live transcript (mic)", "OpenWhisper-style", "◉", () => $("#btnLive").click());
    add("Import documents", "PDF / DOCX / TXT / MD", "⬆", () => Files.importDocs());
    add("Settings", "Providers · models · themes · shortcuts", "⚙", () => window.openSettings?.(), "Ctrl ,");
    add("Toggle theme", "Dark ⇄ Light", "◑", () => themeQuickToggle());
    add("Toggle Quick Note widget", "Floating desktop widget", "▢", () => invoke("widget_toggle", { key: "quicknote" }));
    add("Toggle Tasks widget", "Desktop widget", "▢", () => invoke("widget_toggle", { key: "tasks" }));
    add("Toggle Clock widget", "Desktop widget", "▢", () => invoke("widget_toggle", { key: "clock" }));
    add("Toggle Focus widget", "Pomodoro desktop widget", "▢", () => invoke("widget_toggle", { key: "focus" }));
    add("Trash", "Restore deleted items", "⌫", () => window.gotoView?.("trash"));
    add("Starred notes", "", "★", () => window.gotoView?.("starred"));
    add("Export backup (JSON)", "All your data", "⬇", () => invoke("export_data"));
    if (q.trim()) {
      const notes = await invoke("list_notes", { scope: "search", id: null, query: q });
      for (const n of notes.slice(0, 8)) {
        add(n.title, (n.contentText || "").slice(0, 60) || "note", "📄", () => window.openNoteById?.(n.id));
      }
      const tasks = await invoke("list_tasks", { goalId: null, scope: null });
      for (const t of tasks.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())).slice(0, 4)) {
        add(t.title, "task", "☑", () => window.gotoView?.("goals"));
      }
    }
    return acts;
  }

  async function show() {
    overlay = el("div", { class: "palette-overlay", id: "paletteOv" });
    const pal = el("div", { class: "palette" });
    const input = el("input", { type: "text", placeholder: "Search notes, tasks, commands…" });
    const results = el("div", { class: "pl-results" });
    pal.append(input, results);
    overlay.append(pal);
    document.body.append(overlay);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) hide(); });
    input.focus();

    let seq = 0;
    const refresh = async () => {
      const my = ++seq;
      const q = input.value;
      items = await buildActions(q);
      if (my !== seq) return;
      sel = 0;
      render(results);
    };
    input.addEventListener("input", debounce(refresh, 120));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hide();
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); render(results); }
      if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); render(results); }
      if (e.key === "Enter") { e.preventDefault(); items[sel]?.fn(); hide(); }
    });
    await refresh();
  }

  function render(results) {
    results.innerHTML = "";
    items.forEach((it, i) => {
      const row = el("div", { class: `pl-item ${i === sel ? "sel" : ""}` },
        el("div", { class: "pl-ic" }, it.ic),
        el("div", { class: "pl-main" },
          el("div", { class: "pl-title" }, it.title),
          it.sub ? el("div", { class: "pl-sub" }, it.sub) : null),
        it.kbd ? el("kbd", {}, it.kbd) : null,
      );
      row.addEventListener("click", () => { it.fn(); hide(); });
      results.append(row);
    });
  }

  function hide() { overlay?.remove(); overlay = null; }

  function init() {
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (overlay) hide(); else show();
      }
    });
  }

  return { init, show, hide };
})();
