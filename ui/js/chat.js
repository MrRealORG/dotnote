// DotNote — chat.js : channel chat with @ai / @Note mentions and slash commands
"use strict";

const Chat = (() => {
  let channel = null;
  let mentionCandidates = [];
  let pendingMentions = [];

  function open(ch) {
    channel = ch;
    pendingMentions = [];
    $("#chatName").textContent = ch.name;
    $("#chatTopic").textContent = ch.topic || "";
    $("#chatInput").value = "";
    load();
  }

  async function load() {
    const wrap = $("#chatScroll");
    wrap.innerHTML = "";
    const msgs = await invoke("list_messages", { channelId: channel.id });
    if (!msgs.length) {
      wrap.append(el("div", { class: "empty-state", style: "min-height:200px;" },
        el("div", { class: "es-big" }, "#"),
        el("div", { class: "es-title" }, `welcome to #${channel.name}`),
        el("div", { class: "small dim" }, `This is the start of #${channel.name}. Type @ai to ask AI, / for commands.`),
      ));
    }
    for (const m of msgs) wrap.append(renderMsg(m));
    wrap.scrollTop = wrap.scrollHeight;
  }

  function renderMentions(text, mentions) {
    let html = escHtml(text);
    for (const m of mentions || []) {
      if (m.type === "ai") html = html.replace(/@ai\b/g, `<span class="mention">@ai</span>`);
      if (m.type === "note" && m.title) {
        const re = new RegExp(`@${m.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
        html = html.replace(re, `<span class="mention" data-note="${m.id || ""}" data-title="${escHtml(m.title)}">@${escHtml(m.title)}</span>`);
      }
    }
    return html;
  }

  function renderMsg(m) {
    const row = el("div", { class: `msg ${m.role === "ai" ? "ai" : ""}` });
    row.append(el("div", { class: "m-avatar" }, m.role === "ai" ? "✦" : (m.role === "user" ? (S.settings.user_name || "Y")[0].toUpperCase() : "#")));
    const body = el("div", { class: "m-body" });
    let mentions = [];
    try { mentions = JSON.parse(m.mentions || "[]"); } catch {}
    body.append(el("div", { class: "m-head" },
      el("span", { class: "m-author" }, m.role === "ai" ? "DotNote AI" : (S.settings.user_name || "you")),
      el("span", { class: "m-time" }, fmtDate(m.createdAt)),
    ));
    const text = el("div", { class: "m-text" });
    text.innerHTML = renderMentions(m.content, mentions);
    text.addEventListener("click", (e) => {
      const chip = e.target.closest(".mention");
      if (chip?.dataset.note) window.openNoteById?.(chip.dataset.note);
    });
    body.append(text);
    const acts = el("div", { class: "m-actions" });
    acts.append(el("button", { class: "iconbtn", title: "Copy", onclick: () => { navigator.clipboard?.writeText(m.content); toast("Copied", "ok"); } }, "⧉"));
    if (m.role === "user") {
      acts.append(el("button", { class: "iconbtn", title: "Delete", onclick: async () => { await invoke("delete_message", { id: m.id }); row.remove(); } }, "🗑"));
    }
    body.append(acts);
    row.append(body);
    return row;
  }

  function renderTyping() {
    const t = el("div", { class: "msg ai", id: "typingRow" },
      el("div", { class: "m-avatar" }, "✦"),
      el("div", { class: "m-body" }, el("div", { class: "typing" }, el("i"), el("i"), el("i"))),
    );
    $("#chatScroll").append(t);
    $("#chatScroll").scrollTop = $("#chatScroll").scrollHeight;
  }

  // ---------- mention autocomplete ----------
  function detectMention() {
    const input = $("#chatInput");
    const pos = input.selectionStart;
    const before = input.value.slice(0, pos);
    const m = before.match(/@([\w\- ]*)$/);
    if (!m) { hideMentionMenu(); return null; }
    return { query: m[1].toLowerCase(), startPos: pos - m[1].length - 1, endPos: pos };
  }

  async function showMentionMenu() {
    const d = detectMention();
    if (!d) return;
    hideMentionMenu();
    const menu = el("div", { class: "floatmenu", id: "mentionMenu", style: "min-width:240px;" });
    // @ai
    if ("ai".includes(d.query)) {
      menu.append(el("button", { class: "fm-item", onclick: () => pickMention({ type: "ai", label: "ai" }) },
        el("span", { class: "ic" }, "✦"), "ai — ask the AI", el("kbd", {}, "AI")));
    }
    // notes
    const notes = await invoke("list_notes", { scope: "search", id: null, query: d.query || " " });
    mentionCandidates = [];
    for (const n of notes.slice(0, 6)) {
      if (!n.title.toLowerCase().includes(d.query) && d.query) continue;
      menu.append(el("button", { class: "fm-item", onclick: () => pickMention({ type: "note", id: n.id, label: n.title }) },
        el("span", { class: "ic" }, "📄"), n.title, el("kbd", {}, "note")));
    }
    const r = $("#chatInput").getBoundingClientRect();
    menu.style.left = `${r.left + 12}px`;
    menu.style.top = `${r.top - menu.offsetHeight - 8 < 10 ? r.top + 40 : r.top - 8 - Math.min(menu.offsetHeight, 260)}px`;
    document.body.append(menu);
    setTimeout(() => {
      const closer = (e) => { if (!menu.contains(e.target)) { hideMentionMenu(); document.removeEventListener("mousedown", closer); } };
      document.addEventListener("mousedown", closer);
    });
  }
  function hideMentionMenu() { $("#mentionMenu")?.remove(); }

  function pickMention(mention) {
    const input = $("#chatInput");
    const d = detectMention();
    if (d) {
      input.value = input.value.slice(0, d.startPos) + `@${mention.label} ` + input.value.slice(d.endPos);
      pendingMentions.push(mention);
    }
    hideMentionMenu();
    input.focus();
  }

  // ---------- slash commands ----------
  function parseWhen(s) {
    s = s.trim().toLowerCase();
    const now = new Date();
    let m;
    if ((m = s.match(/^in\s+(\d+)\s*(m|min|minutes?)$/))) { now.setMinutes(now.getMinutes() + +m[1]); return now; }
    if ((m = s.match(/^in\s+(\d+)\s*(h|hours?|hrs?)$/))) { now.setHours(now.getHours() + +m[1]); return now; }
    if ((m = s.match(/^in\s+(\d+)\s*(d|days?)$/))) { now.setDate(now.getDate() + +m[1]); return now; }
    if (s.startsWith("tomorrow")) {
      const t = s.replace("tomorrow", "").replace("at", "").trim();
      const d = new Date(now); d.setDate(d.getDate() + 1);
      if (t) { const [h, mm] = t.split(":"); d.setHours(+h || 9, +mm || 0, 0, 0); } else d.setHours(9, 0, 0, 0);
      return d;
    }
    if (s.startsWith("at ")) {
      const t = s.slice(3).trim();
      const d = new Date(now);
      const [h, mm] = t.split(":");
      d.setHours(+h, +mm || 0, 0, 0);
      if (d <= now) d.setDate(d.getDate() + 1);
      return d;
    }
    return null;
  }

  async function handleSlash(text) {
    if (!text.startsWith("/")) return false;
    const sp = text.indexOf(" ");
    const cmd = (sp === -1 ? text : text.slice(0, sp)).toLowerCase();
    const rest = sp === -1 ? "" : text.slice(sp + 1).trim();
    if (cmd === "/todo") {
      if (!rest) { toast("Usage: /todo Buy milk tomorrow 9am"); return true; }
      // optional "at ..." suffix → due date
      await invoke("create_task", { goalId: null, title: rest, priority: "normal", dueAt: null });
      toast(`☑ Task created — ${rest}`, "ok");
      return true;
    }
    if (cmd === "/remind") {
      if (!rest) { toast("Usage: /remind in 30m Stand up"); return true; }
      const words = rest.split(" ");
      let when = null; let cut = 0;
      for (let n = 2; n <= 4; n++) {
        const cand = words.slice(0, n).join(" ");
        const d = parseWhen(cand);
        if (d) { when = d; cut = n; break; }
      }
      const title = words.slice(cut).join(" ") || "Reminder";
      const fireAt = when ? when.toISOString() : new Date(Date.now() + 3600e3).toISOString();
      await invoke("create_reminder", { entityType: "custom", entityId: null, title, fireAt, repeat: "none" });
      toast(`🔔 Reminder set — ${title}`, "ok");
      window.refreshReminders?.();
      return true;
    }
    if (cmd === "/ask") {
      if (!rest) { toast("Usage: /ask What is rust?"); return true; }
      await sendToAI([{ type: "ai" }], rest);
      return true;
    }
    return false;
  }

  // ---------- send ----------
  async function send() {
    const input = $("#chatInput");
    const text = input.value.trim();
    if (!text || !channel) return;
    if (await handleSlash(text)) { input.value = ""; pendingMentions = []; return; }
    input.value = ""; input.style.height = "auto";
    const mentions = pendingMentions.slice();
    pendingMentions = [];
    hideMentionMenu();
    const msg = await invoke("send_message", { channelId: channel.id, content: text, mentions: JSON.stringify(mentions) });
    $("#chatScroll .empty-state")?.remove();
    $("#chatScroll").append(renderMsg(msg));
    $("#chatScroll").scrollTop = $("#chatScroll").scrollHeight;
    if (mentions.some((m) => m.type === "ai")) {
      await sendToAI(mentions, text);
    }
  }

  async function sendToAI(mentions, userText) {
    renderTyping();
    try {
      // gather context: last messages
      const history = await invoke("list_messages", { channelId: channel.id });
      const msgs = [];
      // mentioned notes as context
      for (const mn of mentions.filter((m) => m.type === "note" && m.id)) {
        try {
          const n = await invoke("get_note", { id: mn.id });
          msgs.push({ role: "system", content: `Context — note "${n.title}":\n${(n.contentText || "").slice(0, 4000)}` });
        } catch {}
      }
      for (const h of history.slice(-12)) {
        if (h.id === undefined) continue;
        msgs.push({ role: h.role === "ai" ? "assistant" : "user", content: h.content });
      }
      if (!msgs.some((m) => m.role === "user" && m.content === userText)) {
        msgs.push({ role: "user", content: userText });
      }
      const provider = S.settings.default_chat_provider || "openrouter";
      const model = S.settings.default_chat_model || "";
      if (!model) { throw new Error("No AI model configured — open Settings → AI Providers."); }
      const res = await invoke("ai_chat", { provider, model, messages: msgs, temperature: null });
      $("#typingRow")?.remove();
      const saved = await invoke("save_ai_message", { channelId: channel.id, content: res.text });
      saved.role = "ai";
      $("#chatScroll").append(renderMsg(saved));
      $("#chatScroll").scrollTop = $("#chatScroll").scrollHeight;
    } catch (err) {
      $("#typingRow")?.remove();
      toast(String(err).replace(/^"|"$/g, ""), "err");
    }
  }

  function init() {
    const input = $("#chatInput");
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
      if (input.value.includes("@")) showMentionMenu(); else hideMentionMenu();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $("#btnChatSend").addEventListener("click", send);
    $("#btnChatMic").addEventListener("click", () => window.gotoVoice?.());
    $("#btnChatNewNote").addEventListener("click", async () => {
      const msgs = await invoke("list_messages", { channelId: channel.id });
      const text = msgs.map((m) => `${m.role === "ai" ? "AI" : S.settings.user_name || "you"}: ${m.content}`).join("\n");
      await window.createQuickNote(`# ${channel.name} — chat export`, text);
      toast("Saved as note", "ok");
    });
  }

  return { init, open, sendToAI };
})();
