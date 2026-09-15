// DotNote — app.js : layout, sidebar, routing, shortcuts, right panel, boot
"use strict";

// ---------- helpers shared with other modules ----------
window.createQuickNote = async (title, text) => {
  const blocks = JSON.stringify([{ id: uid(), type: "p", html: escHtml(text).replace(/\n/g, "<br>") }]);
  const r = await invoke("create_note", {
    spaceId: S.spaceId, folderId: null, channelId: null,
    title: title || "Untitled", contentJson: blocks, contentText: text || "", tags: null,
  });
  window.refreshNotesList?.();
  return r;
};

window.openNoteById = async (id) => {
  const n = await invoke("get_note", { id });
  gotoView("notes");
  selectNote(n);
};

window.openNoteByTitle = async (title) => {
  const notes = await invoke("list_notes", { scope: "search", id: null, query: title });
  const hit = notes.find((n) => n.title.toLowerCase() === title.toLowerCase());
  if (hit) return openNoteById(hit.id);
  // create it
  const r = await invoke("create_note", { spaceId: S.spaceId, folderId: null, channelId: null, title, contentJson: "[]", contentText: "", tags: null });
  toast(`Created note "${title}"`, "ok");
  await window.refreshNotesList?.();
  return openNoteById(r.id);
};

window.newNote = async () => {
  const space = S.spaces.find((s) => s.id === S.spaceId) || S.spaces[0];
  const r = await invoke("create_note", {
    spaceId: space?.id || null, folderId: S.current.type === "folder" ? S.current.id : null,
    channelId: S.current.type === "channel" && S.channels.find((c) => c.id === S.current.id)?.kind === "notes" ? S.current.id : null,
    title: "Untitled", contentJson: "[]", contentText: "", tags: null,
  });
  gotoView("notes");
  await refreshNotesList();
  const n = await invoke("get_note", { id: r.id });
  selectNote(n);
  $("#noteTitle").focus();
  $("#noteTitle").select();
};

// ---------- view routing ----------
const VIEWS = ["notes", "chat", "voice", "goals", "files", "trash"];
window.gotoView = (v) => {
  S.starredOnly = v === "starred";
  if (v === "starred") v = "notes"; // starred shows inside notes view
  S.view = v;
  for (const id of VIEWS) $("#view-" + id)?.classList.toggle("active", id === v);
  $$(".rail .rail-btn").forEach((b) => b.classList.remove("on"));
  const map = { voice: "#railVoice", goals: "#railGoals", files: "#railFiles", trash: "#railTrash" };
  if (map[v]) $(map[v])?.classList.add("on");
  if (v === "voice") Voice.open();
  if (v === "goals") Goals.load();
  if (v === "files") Files.load();
  if (v === "trash") Trash.open();
  window.refreshReminders?.();
};

window.gotoVoice = () => gotoView("voice");

// ---------- spaces & sidebar ----------
async function loadSpaces() {
  S.spaces = await invoke("list_spaces");
  if (!S.spaces.find((s) => s.id === S.spaceId)) S.spaceId = S.spaces[0]?.id || null;
  renderRail();
  await loadSidebar();
}

function renderRail() {
  const list = $("#spaceList");
  list.innerHTML = "";
  for (const s of S.spaces) {
    const d = el("div", { class: `space-dot ${s.id === S.spaceId ? "active" : ""}`, title: s.name, style: `color:${s.color};` }, (s.icon || s.name[0] || "?"));
    d.addEventListener("click", async () => { S.spaceId = s.id; renderRail(); await loadSidebar(); });
    d.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      spaceMenu(s, e.clientX, e.clientY);
    });
    list.append(d);
  }
}

function floatMenu(x, y, build) {
  $("#ctxMenu")?.remove();
  const menu = el("div", { class: "floatmenu", id: "ctxMenu" });
  build((ic, label, fn) => {
    const b = el("button", { class: "fm-item", onclick: () => { menu.remove(); fn(); } }, el("span", { class: "ic" }, ic), label);
    menu.append(b);
    return b;
  }, menu);
  document.body.append(menu);
  menu.style.left = `${Math.min(x, window.innerWidth - 230)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - menu.offsetHeight - 10)}px`;
  setTimeout(() => {
    const closer = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("mousedown", closer); } };
    document.addEventListener("mousedown", closer);
  });
}

function spaceMenu(s, x, y) {
  floatMenu(x, y, (item) => {
    item("✎", "Rename space", () => {
      const name = prompt("Space name", s.name);
      if (name?.trim()) invoke("update_space", { id: s.id, name: name.trim(), icon: s.icon, color: s.color }).then(loadSpaces);
    });
    item("🎨", "Change color", () => {
      const color = prompt("Color hex (e.g. #d71921)", s.color);
      if (color?.trim()) invoke("update_space", { id: s.id, name: s.name, icon: s.icon, color: color.trim() }).then(loadSpaces);
    });
    item("🗑", "Delete space", () => confirmBox(`Delete space "${s.name}" and everything in it?`, async () => {
      await invoke("delete_space", { id: s.id });
      S.spaceId = null;
      loadSpaces();
    }));
  });
}

async function loadSidebar() {
  const space = S.spaces.find((s) => s.id === S.spaceId);
  $("#spaceNameText").textContent = (space?.name || "HOME").toUpperCase();
  if (space) $("#spaceName").querySelector(".dot").style.background = space.color;
  S.channels = S.spaceId ? await invoke("list_channels", { spaceId: S.spaceId }) : [];
  S.folders = S.spaceId ? await invoke("list_folders", { spaceId: S.spaceId }) : [];
  renderSidebarNav();
  // keep current selection sensible
  const cur = S.channels.find((c) => c.id === S.current.id) || S.folders.find((f) => f.id === S.current.id);
  if (cur) selectCurrent(S.current.type, cur.id);
  else if (S.channels.length) selectCurrent(S.channels[0].kind === "notes" ? "channel" : "channel", S.channels[0].id);
}

function renderSidebarNav() {
  const nav = $("#sideNav");
  nav.innerHTML = "";
  const section = (label, onPlus) => {
    const sec = el("div", { class: "side-section" }, label);
    if (onPlus) sec.append(el("button", { class: "plus", title: "Add", onclick: onPlus }, "＋"));
    nav.append(sec);
  };
  const navBtn = (ic, label, active, fn, opts = {}) => {
    const b = el("button", { class: `nav-item ${active ? "active" : ""}` },
      el("span", { class: "hash" }, ic), el("span", { class: "label" }, label));
    if (opts.tag) b.append(el("span", { class: "kind-tag" }, opts.tag));
    b.addEventListener("click", fn);
    b.addEventListener("contextmenu", opts.onCtx || null);
    nav.append(b);
    return b;
  };

  section("VOICE");
  navBtn("◉", "live-transcript", S.current.type === "special" && S.current.id === "voice", () => gotoView("voice"));

  section("TEXT CHANNELS", () => newChannel("chat"));
  for (const c of S.channels.filter((c) => c.kind === "chat")) {
    navBtn("#", c.name, S.current.type === "channel" && S.current.id === c.id, () => selectCurrent("channel", c.id), {
      tag: "", onCtx: (e) => { e.preventDefault(); channelMenu(c, e.clientX, e.clientY); },
    });
  }

  section("NOTES", () => newChannel("notes"));
  for (const c of S.channels.filter((c) => c.kind === "notes")) {
    navBtn("▤", c.name, S.current.type === "channel" && S.current.id === c.id, () => selectCurrent("channel", c.id), {
      onCtx: (e) => { e.preventDefault(); channelMenu(c, e.clientX, e.clientY); },
    });
  }
  for (const f of S.folders.filter((f) => !f.parentId)) {
    navBtn("▣", f.name, S.current.type === "folder" && S.current.id === f.id, () => selectCurrent("folder", f.id), {
      onCtx: (e) => { e.preventDefault(); folderMenu(f, e.clientX, e.clientY); },
    });
  }
  navBtn("★", "Starred", false, () => gotoView("starred"));
  navBtn("◎", "Goals & Focus", false, () => gotoView("goals"));
  navBtn("▣", "Files & Imports", false, () => gotoView("files"));
  navBtn("⌫", "Trash", false, () => gotoView("trash"));
}

function channelMenu(c, x, y) {
  floatMenu(x, y, (item) => {
    item("✎", "Rename channel", () => {
      const name = prompt("Channel name", c.name);
      if (name?.trim()) invoke("update_channel", { id: c.id, name: name.trim().replace(/\s+/g, "-").toLowerCase(), topic: c.topic }).then(loadSidebar);
    });
    item("🗑", "Delete channel", () => confirmBox(`Delete #${c.name}? It goes to trash.`, async () => {
      await invoke("delete_channel", { id: c.id });
      if (S.current.id === c.id) { S.current = { type: "special", id: null }; }
      loadSidebar();
    }));
  });
}
function folderMenu(f, x, y) {
  floatMenu(x, y, (item) => {
    item("✎", "Rename folder", () => {
      const name = prompt("Folder name", f.name);
      if (name?.trim()) invoke("update_folder", { id: f.id, name: name.trim(), icon: f.icon }).then(loadSidebar);
    });
    item("🗑", "Delete folder", () => confirmBox(`Delete folder "${f.name}"? Notes inside go to trash too.`, async () => {
      await invoke("delete_folder", { id: f.id });
      loadSidebar();
    }));
  });
}

window.newChannel = async (kind) => {
  const name = prompt(kind === "chat" ? "New chat channel name" : "New notes channel name", kind === "chat" ? "new-channel" : "project-notes");
  if (!name?.trim()) return;
  const c = await invoke("create_channel", { spaceId: S.spaceId, name: name.trim().replace(/\s+/g, "-").toLowerCase(), kind, topic: "" });
  await loadSidebar();
  selectCurrent("channel", c.id);
};

window.newFolder = async () => {
  const name = prompt("Folder name", "New folder");
  if (!name?.trim()) return;
  await invoke("create_folder", { spaceId: S.spaceId, parentId: null, name: name.trim(), icon: "" });
  await loadSidebar();
};

async function selectCurrent(type, id) {
  S.current = { type, id };
  renderSidebarNav();
  if (type === "channel") {
    const c = S.channels.find((c) => c.id === id);
    if (c?.kind === "chat") {
      gotoView("chat");
      Chat.open(c);
      return;
    }
    gotoView("notes");
    await refreshNotesList();
  } else if (type === "folder") {
    gotoView("notes");
    await refreshNotesList();
  }
}

// ---------- notes list & editor ----------
window.refreshNotesList = refreshNotesList;
async function refreshNotesList() {
  const box = $("#noteList");
  box.innerHTML = "";
  const q = $("#noteSearch").value.trim();
  let scope = "all"; let id = null;
  if (q) { scope = "search"; }
  else if (S.starredOnly) { scope = "starred"; }
  else if (S.current.type === "channel") { scope = "channel"; id = S.current.id; }
  else if (S.current.type === "folder") { scope = "folder"; id = S.current.id; }
  const notes = q ? await invoke("list_notes", { scope, id, query: q })
    : await invoke("list_notes", { scope, id, query: null });
  S.notesList = notes;
  if (!notes.length) {
    box.append(el("div", { class: "empty-state", style: "padding:30px 10px;" },
      el("div", { class: "es-title" }, q ? "no matches" : "no notes yet"),
      el("button", { class: "btn primary sm", onclick: () => window.newNote() }, "+ New note")));
  }
  for (const n of notes) {
    const card = el("div", { class: `note-card ${S.noteId === n.id ? "active" : ""}` });
    card.append(el("div", { class: "nc-title" },
      n.pinned ? el("span", { class: "pin" }, "★") : null,
      el("span", {}, n.title)));
    card.append(el("div", { class: "nc-prev" }, (n.contentText || "Empty note").slice(0, 70)));
    card.append(el("div", { class: "nc-meta" }, el("span", {}, fmtDate(n.updatedAt)), el("span", {}, `${n.words || 0} words`)));
    card.addEventListener("click", () => { gotoView("notes"); selectNote(n); });
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      floatMenu(e.clientX, e.clientY, (item) => {
        item("🗑", "Move to trash", () => confirmBox(`Move "${n.title}" to trash?`, async () => {
          await invoke("trash_note", { id: n.id });
          if (S.noteId === n.id) S.noteId = null;
          refreshNotesList();
        }));
        item(n.starred ? "☆" : "★", n.starred ? "Unstar" : "Star", async () => {
          await invoke("update_note", { id: n.id, starred: n.starred ? 0 : 1, title: null, contentJson: null, contentText: null });
          refreshNotesList();
        });
        item(n.pinned ? "📌 Unpin" : "📌 Pin", "", async () => {
          await invoke("update_note", { id: n.id, pinned: n.pinned ? 0 : 1, title: null, contentJson: null, contentText: null });
          refreshNotesList();
        });
      });
    });
    box.append(card);
  }
}

function selectNote(n) {
  S.noteId = n.id;
  S.notesCache.set(n.id, n);
  Editor.open(n);
  $$(".note-card").forEach((c, i) => c.classList.toggle("active", S.notesList[i]?.id === n.id));
}

async function loadStarred() {
  await refreshNotesList();
}

// templates menu
function newNoteMenu(x, y) {
  floatMenu(x, y, (item) => {
    item("📄", "Blank note", () => window.newNote());
    item("📅", "Daily note (today)", async () => {
      const d = new Date();
      const title = d.toLocaleDateString("en-CA"); // yyyy-mm-dd
      await invoke("create_note", { spaceId: S.spaceId, folderId: null, channelId: null, title: `${title} — Daily`, contentJson: "[]", contentText: "", tags: null });
      refreshNotesList();
      toast("Daily note created", "ok");
    });
    item("🤝", "Meeting notes", async () => {
      const blocks = JSON.stringify([
        { id: uid(), type: "h1", html: "Meeting — " + new Date().toLocaleDateString() },
        { id: uid(), type: "p", html: "<b>Attendees:</b> " },
        { id: uid(), type: "h2", html: "Agenda" },
        { id: uid(), type: "todo", html: "" },
        { id: uid(), type: "h2", html: "Notes" },
        { id: uid(), type: "p", html: "" },
        { id: uid(), type: "h2", html: "Action items" },
        { id: uid(), type: "todo", html: "" },
      ]);
      await invoke("create_note", { spaceId: S.spaceId, folderId: null, channelId: null, title: "Meeting — " + new Date().toLocaleDateString(), contentJson: blocks, contentText: "meeting notes", tags: null });
      refreshNotesList();
    });
    item("✦", "AI: draft from topic", async () => {
      const topic = prompt("What should the AI write about?");
      if (!topic) return;
      toast("AI is drafting…");
      try {
        const res = await invoke("ai_summarize", { text: topic, instruction: "Write a well structured short note (markdown-ish plain text with headings and bullets) about this topic:" });
        const blocks = JSON.stringify([{ id: uid(), type: "p", html: escHtml(res.text).replace(/\n/g, "<br>") }]);
        await invoke("create_note", { spaceId: S.spaceId, folderId: null, channelId: null, title: topic.slice(0, 60), contentJson: blocks, contentText: res.text, tags: null });
        refreshNotesList();
        toast("AI note ready ✓", "ok");
      } catch (e) { toast(String(e.message || e).replace(/^"|"$/g, ""), "err"); }
    });
  });
}

// ---------- right panel ----------
window.refreshRightPanel = async (n) => {
  refreshReminders();
  refreshBacklinks(n);
  refreshAttachments(n);
};

async function refreshBacklinks(n) {
  const box = $("#rpBacklinks");
  box.innerHTML = "";
  const links = await invoke("find_backlinks", { title: n.title });
  if (!links.length) { box.append(el("div", { class: "small dim" }, "None yet.")); return; }
  for (const l of links) {
    box.append(el("div", { class: "backlink", onclick: () => openNoteById(l.id) }, "↩ " + l.title));
  }
}

async function refreshAttachments(n) {
  const box = $("#rpAttachments");
  box.innerHTML = "";
  const atts = (await invoke("list_attachments", { noteId: null })).filter((a) => a.noteId === n.id);
  if (!atts.length) { box.append(el("div", { class: "small dim" }, "No attachments.")); return; }
  for (const a of atts) {
    box.append(el("div", { class: "backlink", onclick: () => Files.openViewer(a.path, a.name, a.kind) },
      `${a.kind === "image" ? "🖼" : "📄"} ${a.name} `));
  }
}

window.refreshReminders = async () => {
  const box = $("#rpReminders");
  if (!box) return;
  const rems = await invoke("list_reminders");
  const open = rems.filter((r) => !r.done).slice(0, 8);
  box.innerHTML = "";
  if (!open.length) { box.append(el("div", { class: "small dim" }, "No reminders yet.")); return; }
  for (const r of open) {
    const due = new Date(r.fireAt);
    const overdue = due < new Date();
    box.append(el("div", { class: "reminder-row" },
      el("span", { class: "r-when", style: overdue ? "color:var(--danger);" : "" },
        due.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })),
      el("span", { class: "grow", style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" }, r.title),
      el("button", { class: "iconbtn", style: "width:22px;height:22px;font-size:11px;", title: "Done", onclick: async () => { await invoke("update_reminder", { id: r.id, done: 1, fireAt: null, title: null }); refreshReminders(); } }, "✓"),
      el("button", { class: "iconbtn", style: "width:22px;height:22px;font-size:11px;", title: "Delete", onclick: async () => { await invoke("delete_reminder", { id: r.id }); refreshReminders(); } }, "×"),
    ));
  }
};

window.openReminderDialog = (entityType, entityId, title) => {
  const body = el("div");
  const fTitle = el("input", { type: "text", value: title || "", placeholder: "Remind me to…" });
  const fWhen = el("input", { type: "text", placeholder: "in 30m · tomorrow 9:00 · at 18:00 · 2026-01-05 14:30" });
  const fRepeat = el("select", {},
    el("option", { value: "none" }, "Once"),
    el("option", { value: "hourly" }, "Hourly"),
    el("option", { value: "daily" }, "Daily"),
    el("option", { value: "weekly" }, "Weekly"));
  const foot = el("div");
  foot.append(
    el("button", { class: "btn", onclick: closeModal }, "Cancel"),
    el("button", { class: "btn primary", onclick: async () => {
      const t = fTitle.value.trim();
      if (!t || !fWhen.value.trim()) { toast("Need a title and a time"); return; }
      const when = parseWhenFlexible(fWhen.value.trim());
      await invoke("create_reminder", { entityType: entityType || "custom", entityId: entityId || null, title: t, fireAt: when.toISOString(), repeat: fRepeat.value });
      closeModal();
      refreshReminders();
      toast(`🔔 Reminder set — ${t}`, "ok");
    } }, "Set reminder"),
  );
  body.append(
    el("div", { class: "field" }, el("label", {}, "REMINDER"), fTitle),
    el("div", { class: "field" }, el("label", {}, "WHEN"), fWhen,
      el("div", { class: "hint" }, "Natural language works: “in 30m”, “tomorrow 9:00”, “at 18:00”")),
    el("div", { class: "field" }, el("label", {}, "REPEAT"), fRepeat),
  );
  openModal(body, { title: "New reminder", foot });
};

function parseWhenFlexible(s) {
  s = s.toLowerCase();
  const now = new Date();
  let m;
  if ((m = s.match(/^in\s+(\d+)\s*(m|min|mins|minutes?)$/))) { now.setMinutes(now.getMinutes() + +m[1]); return now; }
  if ((m = s.match(/^in\s+(\d+)\s*(h|hr|hours?)$/))) { now.setHours(now.getHours() + +m[1]); return now; }
  if ((m = s.match(/^in\s+(\d+)\s*(d|days?)$/))) { now.setDate(now.getDate() + +m[1]); return now; }
  if (s.startsWith("tomorrow")) {
    const t = s.replace("tomorrow", "").replace(/^at\s*/, "").trim();
    const d = new Date(now); d.setDate(d.getDate() + 1);
    if (t) { const [h, mm] = t.split(":"); d.setHours(+h || 9, +mm || 0, 0, 0); } else d.setHours(9, 0, 0, 0);
    return d;
  }
  if (s.startsWith("at ")) {
    const t = s.slice(3).trim();
    const d = new Date(now);
    const [h, mm] = t.split(":");
    d.setHours(+h || 9, +mm || 0, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  }
  const d = new Date(s);
  if (!isNaN(d)) return d;
  return new Date(Date.now() + 3600e3);
}

// ---------- AI actions (right panel) ----------
async function runAiAction(kind) {
  const note = Editor.currentNote();
  if (!note) { toast("Open a note first"); return; }
  const text = note.contentText || "";
  if (!text.trim()) { toast("Note is empty"); return; }
  const box = $("#aiResult");
  box.hidden = false;
  box.textContent = "✦ Thinking…";
  const instructions = {
    summarize: null,
    keypoints: "Extract the key points as a short bullet list from this note:",
    continue: "Continue writing this note naturally, matching its tone, for about 150 words:",
    grammar: "Fix grammar and spelling, return the corrected text only:",
    todo: "Extract actionable tasks as a checklist from this note:",
    translate: "Translate this note to English (if already English, translate to Spanish). Return only the translation:",
  };
  try {
    const res = await invoke("ai_summarize", { text, instruction: instructions[kind] || null });
    box.textContent = res.text;
    if (kind === "todo") {
      box.append(el("div", { class: "flex mt8" },
        el("button", { class: "btn sm primary", onclick: async () => {
          for (const line of res.text.split("\n").filter((l) => l.trim())) {
            const t = line.replace(/^[-*\d.\s\[\]x✓☑]+/, "").trim();
            if (t) await invoke("create_task", { goalId: null, title: t, priority: "normal", dueAt: null });
          }
          toast("Tasks extracted ✓", "ok");
        } }, "→ Create tasks")));
    }
    if (kind === "continue") {
      box.append(el("div", { class: "flex mt8" },
        el("button", { class: "btn sm primary", onclick: () => {
          document.execCommand("insertHTML", false, "<br>" + escHtml(res.text).replace(/\n/g, "<br>"));
          Editor.queueSave();
        } }, "→ Append to note")));
    }
  } catch (e) {
    box.textContent = `⚠ ${String(e.message || e).replace(/^"|"$/g, "")}`;
    box.style.color = "var(--danger)";
    setTimeout(() => { box.style.color = ""; }, 3000);
  }
}

// ---------- appearance / shortcuts wiring ----------
function initTopButtons() {
  $("#btnSettingsQuick").addEventListener("click", () => openSettings());
  $("#railSettings").addEventListener("click", () => openSettings());
  $("#btnThemeQuick").addEventListener("click", themeQuickToggle);
  $("#btnPalette").addEventListener("click", () => Palette.show());
  $("#logoHome").addEventListener("click", () => Palette.show());
  $("#railVoice").addEventListener("click", () => gotoView("voice"));
  $("#railGoals").addEventListener("click", () => gotoView("goals"));
  $("#railFiles").addEventListener("click", () => gotoView("files"));
  $("#railTrash").addEventListener("click", () => gotoView("trash"));
  $("#btnMicQuick").addEventListener("click", () => gotoView("voice"));
  $("#btnAddSpace").addEventListener("click", async () => {
    const name = prompt("New space name", "Space");
    if (!name?.trim()) return;
    const colors = ["#d71921", "#4dabf7", "#51cf66", "#ffa94d", "#b197fc"];
    const s = await invoke("create_space", { name: name.trim(), icon: name.trim()[0].toUpperCase(), color: colors[Math.floor(Math.random() * colors.length)] });
    S.spaceId = s.id;
    await loadSpaces();
  });
  $("#spaceName").addEventListener("click", () => {
    const s = S.spaces.find((x) => x.id === S.spaceId);
    if (s) spaceMenu(s, 80, 120);
  });
  // notes
  $("#btnNewNote").addEventListener("click", () => window.newNote());
  $("#btnNewNoteMenu").addEventListener("click", (e) => newNoteMenu(e.clientX, e.clientY));
  $("#noteSearch").addEventListener("input", debounce(refreshNotesList, 200));
  $("#btnStar").addEventListener("click", async () => {
    const n = Editor.currentNote(); if (!n) return;
    const v = n.starred ? 0 : 1;
    await invoke("update_note", { id: n.id, starred: v, title: null, contentJson: null, contentText: null });
    n.starred = v;
    $("#btnStar").textContent = v ? "★" : "☆";
  });
  $("#btnPin").addEventListener("click", async () => {
    const n = Editor.currentNote(); if (!n) return;
    const v = n.pinned ? 0 : 1;
    await invoke("update_note", { id: n.id, pinned: v, title: null, contentJson: null, contentText: null });
    n.pinned = v;
    $("#btnPin").style.color = v ? "var(--accent)" : "";
    refreshNotesList();
  });
  $("#btnAttach").addEventListener("click", () => Files.attachToCurrentNote());
  $("#btnAttachRp").addEventListener("click", () => Files.attachToCurrentNote());
  $("#btnTrashNote").addEventListener("click", () => {
    const n = Editor.currentNote(); if (!n) return;
    confirmBox(`Move "${n.title}" to trash?`, async () => {
      await invoke("trash_note", { id: n.id });
      S.noteId = null;
      $("#editor").innerHTML = "";
      refreshNotesList();
      toast("Moved to trash", "ok");
    });
  });
  $("#btnRemind").addEventListener("click", () => {
    const n = Editor.currentNote(); if (!n) return;
    openReminderDialog("note", n.id, n.title);
  });
  $("#btnAskAI").addEventListener("click", () => {
    const rp = $("#rightPanel");
    rp.hidden = !rp.hidden;
  });
  $("#rpClose").addEventListener("click", () => { $("#rightPanel").hidden = true; });
  $("#btnAddReminder").addEventListener("click", () => openReminderDialog("custom", null, ""));
  $$("#aiActions .btn").forEach((b) => b.addEventListener("click", () => runAiAction(b.dataset.ai)));
}

// ---------- app shortcuts ----------
function initAppShortcuts() {
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const tag = document.activeElement?.tagName;
    const typing = ["INPUT", "TEXTAREA"].includes(tag) || document.activeElement?.isContentEditable;
    if (mod && e.key === ",") { e.preventDefault(); openSettings(); }
    if (mod && e.key.toLowerCase() === "n" && !e.shiftKey) { e.preventDefault(); window.newNote(); }
    if (mod && e.key === "=") { e.preventDefault(); setZoom((+S.settings.zoom || 100) + 10); }
    if (mod && e.key === "-") { e.preventDefault(); setZoom((+S.settings.zoom || 100) - 10); }
    if (mod && e.key === "0") { e.preventDefault(); setZoom(100); }
    if (e.key === "Escape") { closeModal(); $("#paletteOv")?.remove(); }
  });
  function setZoom(z) {
    z = Math.max(70, Math.min(150, z));
    S.settings.zoom = z;
    setSetting("zoom", z).then(applyAppearance);
  }
}

// ---------- boot ----------
window.bootApp = async () => {
  Editor.init();
  Chat.init();
  Voice.init();
  Goals.init();
  Files.init();
  Trash.init();
  Palette.init();
  initTopButtons();
  initAppShortcuts();
  await loadSpaces();
  // default view: first chat channel if any, else notes
  const firstChat = S.channels.find((c) => c.kind === "chat");
  if (firstChat) selectCurrent("channel", firstChat.id);
  else gotoView("notes");
  window.refreshReminders?.();
  Editor.initDone = true;
};
