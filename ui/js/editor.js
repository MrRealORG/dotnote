// DotNote — editor.js : Notion-style block editor (right-click menu, slash menu, colors, wiki-links)
"use strict";

const Editor = (() => {
  let note = null; // current note object
  let blocks = [];
  let slashTarget = null;
  let selToolbar = null;

  const EDITOR_CSS = `
    .block[data-indent="1"] { margin-left: 22px; }
    .block[data-indent="2"] { margin-left: 44px; }
    .block[data-indent="3"] { margin-left: 66px; }
    .block[data-type="li"] > .content { padding-left: 4px; }
    .block .marker { flex: none; width: 20px; text-align: center; color: var(--muted); margin-top: 3px; font-size: 14px; user-select: none; }
    .block[data-type="num"] .marker { font-family: var(--mono); font-size: 12.5px; }
    .selbar {
      position: fixed; z-index: 920; display: flex; gap: 2px; padding: 4px;
      background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow);
    }
    .selbar button { width: 28px; height: 28px; border: none; background: none; color: var(--text); border-radius: 6px; font-size: 13px; }
    .selbar button:hover { background: var(--hover); }
    .selbar .sw { width: 18px; height: 18px; border-radius: 5px; border: 1px solid var(--border); margin: 5px 1px; cursor: pointer; }
    .wikilink { pointer-events: auto; }
  `;
  document.head.append(el("style", {}, EDITOR_CSS));

  // ---------- serialization ----------
  function cleanHtml(html) {
    // wiki chips → [[title]]
    html = html.replace(/<span class="wikilink[^"]*"[^>]*data-wiki="([^"]*)"[^>]*>[\s\S]*?<\/span>/g, (_, t) => `[[${t.replace(/&amp;/g, "&")}]]`);
    html = html.replace(/ contenteditable="[^"]*"/g, "");
    return html;
  }
  function serialize() {
    return $$("#editor .block").map((b) => {
      const type = b.dataset.type;
      const content = b.querySelector(".content");
      const obj = { id: b.dataset.id, type, html: cleanHtml(content?.innerHTML || "") };
      if (b.dataset.size) obj.size = b.dataset.size;
      if (b.dataset.indent && b.dataset.indent !== "0") obj.indent = +b.dataset.indent;
      if (type === "todo") obj.done = b.classList.contains("done");
      return obj;
    });
  }
  const saveNow = async () => {
    if (!note) return;
    const bj = JSON.stringify(serialize());
    const text = blocksToText(JSON.parse(bj));
    $("#edSaved").textContent = "SAVING…";
    await invoke("update_note", { id: note.id, contentJson: bj, contentText: text });
    $("#edSaved").textContent = "SAVED ✓";
    note.contentJson = bj; note.contentText = text;
    S.notesCache.set(note.id, note);
    window.refreshNoteMeta?.(note);
  };
  const queueSave = debounce(saveNow, 750);

  // ---------- rendering ----------
  function renderBlock(b) {
    const wrap = el("div", { class: "block", "data-id": b.id, "data-type": b.type });
    if (b.size) wrap.dataset.size = b.size;
    if (b.indent) wrap.dataset.indent = String(b.indent);
    if (b.type === "todo" && b.done) wrap.classList.add("done");

    const handle = el("button", { class: "handle", title: "Click for block menu · right-click for full menu" }, "⠿");
    handle.addEventListener("click", (e) => { e.stopPropagation(); openBlockMenu(wrap, e.clientX, e.clientY); });
    wrap.addEventListener("contextmenu", (e) => {
      if (window.getSelection()?.toString() && wrap.contains(window.getSelection().anchorNode)) { /* allow sel toolbar */ }
      e.preventDefault();
      openBlockMenu(wrap, e.clientX, e.clientY);
    });

    if (b.type === "todo") wrap.append(el("div", { class: "checkbox" }));
    if (b.type === "li") wrap.append(el("div", { class: "marker" }, "•"));
    if (b.type === "num") wrap.append(el("div", { class: "marker" }, ""));

    const content = el("div", { class: "content", contenteditable: "true", "data-ph": placeholderFor(b.type) });
    if (b.type === "img") {
      content.contentEditable = "false";
      content.innerHTML = b.html || "";
    } else if (b.type === "attach") {
      content.contentEditable = "false";
      content.innerHTML = b.html || "";
    } else if (b.type === "divider") {
      content.contentEditable = "false";
      content.innerHTML = "";
    } else {
      content.innerHTML = b.html || "";
      if (b.html) renderWiki(content);
    }
    wireContent(content, wrap);
    wrap.append(handle, content);
    return wrap;
  }

  const placeholderFor = (t) =>
    ({ p: "Type '/' for blocks…", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", li: "List item", num: "Numbered", todo: "To-do", quote: "Quote", code: "Code", callout: "Callout…" }[t] || "");

  function renderWiki(content) {
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const txt = child.textContent;
          if (!txt.includes("[[")) continue;
          const frag = document.createDocumentFragment();
          const re = /\[\[([^\]]+)\]\]/g;
          let last = 0; let m;
          while ((m = re.exec(txt))) {
            if (m.index > last) frag.append(document.createTextNode(txt.slice(last, m.index)));
            const chip = el("span", { class: "wikilink", "data-wiki": m[1] }, m[1]);
            chip.contentEditable = "false";
            frag.append(chip);
            last = m.index + m[0].length;
          }
          if (last < txt.length) frag.append(document.createTextNode(txt.slice(last)));
          child.replaceWith(frag);
        } else if (child.nodeType === 1 && !child.classList.contains("wikilink")) {
          walk(child);
        }
      }
    };
    walk(content);
  }

  // renumber ordered lists after each change
  function renumber() {
    let n = 0;
    for (const b of $$("#editor .block")) {
      if (b.dataset.type === "num") { n += 1; b.querySelector(".marker").textContent = `${n}.`; }
      else n = 0;
    }
  }

  function render() {
    const ed = $("#editor");
    ed.innerHTML = "";
    for (const b of blocks) ed.append(renderBlock(b));
    if (!blocks.length) addBlock("p", "", true);
    renumber();
  }

  // ---------- content events ----------
  function wireContent(content, wrap) {
    content.addEventListener("input", () => {
      markdownShortcut(content, wrap);
      if (slashTarget === wrap) updateSlashFilter(content);
      renumber();
      queueSave();
      updateFooter();
    });
    content.addEventListener("keydown", (e) => onKey(e, content, wrap));
    content.addEventListener("blur", () => { renderWiki(content); });
    content.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      document.execCommand("insertText", false, text);
    });
    wrap.querySelector(".checkbox")?.addEventListener("click", () => {
      wrap.classList.toggle("done");
      queueSave();
    });
  }

  function focusBlock(wrap, atEnd = true) {
    const c = wrap?.querySelector(".content");
    if (!c || c.contentEditable === "false") return;
    c.focus();
    const range = document.createRange();
    range.selectNodeContents(c);
    range.collapse(!atEnd);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function addBlock(type = "p", html = "", focus = false, afterEl = null) {
    const b = { id: uid(), type, html };
    const node = renderBlock(b);
    if (afterEl) afterEl.after(node); else $("#editor").append(node);
    renumber();
    if (focus) focusBlock(node);
    queueSave();
    return node;
  }

  function onKey(e, content, wrap) {
    // slash menu open
    if (slashTarget) {
      if (e.key === "Escape") { closeSlash(); return; }
      if (e.key === "Enter") { e.preventDefault(); slashPickCurrent(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); slashNav(e.key === "ArrowDown" ? 1 : -1); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      const type = wrap.dataset.type;
      if (["code", "quote", "callout"].includes(type)) {
        // Enter inside code makes newline unless empty-ish → exit
        if (type === "code" && !e.ctrlKey) return; // allow newline in code
      }
      e.preventDefault();
      const listTypes = ["li", "num", "todo"];
      const isEmpty = content.textContent.trim() === "";
      if (listTypes.includes(type) && isEmpty) {
        wrap.dataset.type = "p";
        wrap.querySelector(".marker")?.remove();
        wrap.querySelector(".checkbox")?.remove();
        wrap.classList.remove("done");
        focusBlock(wrap);
        queueSave();
        return;
      }
      // split at caret
      const sel = window.getSelection();
      let tailHtml = "";
      if (sel && sel.rangeCount && wrap.contains(sel.anchorNode)) {
        const r = sel.getRangeAt(0);
        const tail = r.cloneRange();
        tail.setEndAfter(content.lastChild || content);
        const frag = tail.extractContents();
        const tmp = el("div"); tmp.append(frag);
        tailHtml = tmp.innerHTML;
      }
      content.normalize();
      const newType = listTypes.includes(type) ? type : "p";
      if (type === "todo") { /* new todo unchecked */ }
      const node = addBlock(newType, tailHtml, true, wrap);
      if (type === "todo") { node.classList.remove("done"); }
      queueSave();
      return;
    }
    if (e.key === "Backspace") {
      const sel = window.getSelection();
      const atStart = sel && sel.rangeCount && (() => {
        const r = sel.getRangeAt(0).cloneRange();
        r.selectNodeContents(content);
        r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
        return r.toString() === "";
      })();
      if (atStart && content.textContent === "" && $$("#editor .block").length > 1) {
        e.preventDefault();
        const prev = wrap.previousElementSibling;
        wrap.remove();
        renumber();
        focusBlock(prev);
        queueSave();
      } else if (atStart && $$("#editor .block").length > 1) {
        const prev = wrap.previousElementSibling;
        if (prev && prev.querySelector(".content")?.contentEditable !== "false") {
          e.preventDefault();
          const pc = prev.querySelector(".content");
          pc.innerHTML += cleanHtml(content.innerHTML);
          wrap.remove();
          renumber();
          focusBlock(prev);
          queueSave();
        }
      }
      return;
    }
    if (e.key === "ArrowUp") {
      const sel = window.getSelection();
      if (sel?.isCollapsed) {
        const prev = wrap.previousElementSibling;
        const atFirstLine = (() => { const r = sel.getRangeAt(0).cloneRange(); r.selectNodeContents(content); r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset); return !r.toString().includes("\n"); })();
        if (prev) { e.preventDefault(); focusBlock(prev, true); }
        else if (atFirstLine) e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      const next = wrap.nextElementSibling;
      const sel = window.getSelection();
      if (next && sel?.isCollapsed) {
        const c2 = next.querySelector(".content");
        if (c2 && c2.contentEditable !== "false") { e.preventDefault(); focusBlock(next, false); }
      }
      return;
    }
    if (e.key === "Tab" && ["li", "num", "todo"].includes(wrap.dataset.type)) {
      e.preventDefault();
      const cur = +(wrap.dataset.indent || 0);
      const ni = e.shiftKey ? Math.max(0, cur - 1) : Math.min(4, cur + 1);
      wrap.dataset.indent = String(ni);
      queueSave();
      return;
    }
    if (e.key === "/" && content.textContent.trim() === "") {
      // let "/" appear then open menu
      setTimeout(() => openSlash(wrap), 10);
    }
  }

  // markdown shortcuts: "# ", "## ", "- ", "1. ", "> ", "[] ", "[x] ", "---"
  function markdownShortcut(content, wrap) {
    const txt = content.textContent;
    const map = {
      "# ": "h1", "## ": "h2", "### ": "h3", "- ": "li", "* ": "li",
      "> ": "quote", "[] ": "todo", "[ ] ": "todo", "[x] ": "todo",
    };
    for (const [k, t] of Object.entries(map)) {
      if (txt === k) {
        content.innerHTML = "";
        setBlockType(wrap, t);
        if (t === "todo" && k === "[x] ") wrap.classList.add("done");
        queueSave();
        return;
      }
    }
    if (txt === "1. ") { content.innerHTML = ""; setBlockType(wrap, "num"); queueSave(); return; }
    if (txt === "---" || txt === "***") {
      setBlockType(wrap, "divider");
      addBlock("p", "", true, wrap);
      queueSave();
    }
  }

  function setBlockType(wrap, type) {
    wrap.dataset.type = type;
    const content = wrap.querySelector(".content");
    // clean marker/checkbox
    wrap.querySelector(".marker")?.remove();
    wrap.querySelector(".checkbox")?.remove();
    if (type === "todo") {
      const cb = el("div", { class: "checkbox" });
      wrap.prepend(cb);
      cb.addEventListener("click", () => { wrap.classList.toggle("done"); queueSave(); });
    } else if (type === "li") {
      wrap.prepend(el("div", { class: "marker" }, "•"));
    } else if (type === "num") {
      wrap.prepend(el("div", { class: "marker" }, ""));
    } else if (type === "divider") {
      content.contentEditable = "false";
    } else if (["img", "attach"].includes(type)) {
      content.contentEditable = "false";
    } else {
      content.contentEditable = "true";
    }
    if (type !== "divider" && ["p", "h1", "h2", "h3", "li", "num", "todo", "quote", "callout", "code"].includes(type)) {
      content.contentEditable = "true";
    }
    content.dataset.ph = placeholderFor(type);
    renumber();
    focusBlock(wrap);
  }

  // ---------- slash menu ----------
  const SLASH_ITEMS = [
    { t: "Text", ic: "¶", type: "p" }, { t: "Heading 1", ic: "H1", type: "h1" },
    { t: "Heading 2", ic: "H2", type: "h2" }, { t: "Heading 3", ic: "H3", type: "h3" },
    { t: "Bullet list", ic: "•", type: "li" }, { t: "Numbered list", ic: "1.", type: "num" },
    { t: "To-do", ic: "☑", type: "todo" }, { t: "Quote", ic: "❝", type: "quote" },
    { t: "Code", ic: "</>", type: "code" }, { t: "Callout", ic: "◈", type: "callout" },
    { t: "Divider", ic: "―", type: "divider" },
    { t: "Image", ic: "🖼", action: "img" }, { t: "Document", ic: "📄", action: "attach" },
  ];
  let slashItems = [];
  let slashSel = 0;

  function openSlash(wrap) {
    slashTarget = wrap;
    slashSel = 0;
    showSlashMenu(wrap, SLASH_ITEMS);
  }
  function showSlashMenu(wrap, items) {
    slashItems = items;
    closeSlashMenuOnly();
    const r = wrap.getBoundingClientRect();
    const menu = el("div", { class: "floatmenu", id: "slashMenu" });
    items.forEach((it, i) => {
      menu.append(el("button", {
        class: `fm-item ${i === slashSel ? "sel" : ""}`,
        onclick: () => applySlash(it),
      }, el("span", { class: "ic" }, it.ic), it.t));
    });
    if (!items.length) menu.append(el("div", { class: "fm-label" }, "No blocks match"));
    menu.style.left = `${r.left}px`;
    menu.style.top = `${Math.min(r.bottom + 6, window.innerHeight - 340)}px`;
    document.body.append(menu);
  }
  function updateSlashFilter(content) {
    const q = content.textContent.replace(/^\//, "").toLowerCase();
    showSlashMenu(slashTarget, SLASH_ITEMS.filter((it) => it.t.toLowerCase().includes(q)));
    slashSel = 0;
  }
  function slashNav(d) {
    slashSel = (slashSel + d + slashItems.length) % Math.max(slashItems.length, 1);
    $$("#slashMenu .fm-item").forEach((n, i) => n.classList.toggle("sel", i === slashSel));
    $$("#slashMenu .fm-item")[slashSel]?.scrollIntoView({ block: "nearest" });
  }
  function slashPickCurrent() {
    const it = slashItems[slashSel];
    if (it) applySlash(it);
  }
  function applySlash(it) {
    const wrap = slashTarget;
    const content = wrap?.querySelector(".content");
    closeSlash();
    if (!wrap || !content) return;
    content.innerHTML = content.innerHTML.replace(/^\//, "").replace(/^\//, "");
    if (it.action === "img") { setBlockType(wrap, "img"); window.addImageToEditor(wrap); queueSave(); return; }
    if (it.action === "attach") { setBlockType(wrap, "attach"); window.addDocToEditor(wrap); queueSave(); return; }
    setBlockType(wrap, it.type);
    queueSave();
  }
  function closeSlashMenuOnly() { $("#slashMenu")?.remove(); }
  function closeSlash() { slashTarget = null; closeSlashMenuOnly(); }

  // ---------- right-click block menu ----------
  function openBlockMenu(wrap, x, y) {
    $("#ctxMenu")?.remove();
    const menu = el("div", { class: "floatmenu", id: "ctxMenu" });
    const label = (t) => el("div", { class: "fm-label" }, t);
    const item = (ic, t, fn, kbd) => el("button", { class: "fm-item", onclick: () => { menu.remove(); fn(); } }, el("span", { class: "ic" }, ic), t, kbd ? el("kbd", {}, kbd) : "");

    menu.append(label("TURN INTO"));
    const types = [["¶", "Text", "p"], ["H1", "Heading 1", "h1"], ["H2", "Heading 2", "h2"], ["H3", "Heading 3", "h3"], ["•", "Bullet", "li"], ["1.", "Numbered", "num"], ["☑", "To-do", "todo"], ["❝", "Quote", "quote"], ["</>", "Code", "code"], ["◈", "Callout", "callout"]];
    const row = el("div", { class: "fm-row" });
    for (const [ic, t, ty] of types) {
      row.append(el("button", { class: "swatch bg-default", title: t, style: `color:var(--text);font-family:var(--mono);font-size:9px;display:flex;align-items:center;justify-content:center;`, onclick: () => { menu.remove(); setBlockType(wrap, ty); queueSave(); } }, ic));
    }
    menu.append(row);

    menu.append(label("TEXT COLOR"));
    const crow = el("div", { class: "fm-row" });
    const colors = { red: "#ff6b6b", orange: "#ffa94d", yellow: "#ffd43b", green: "#51cf66", blue: "#4dabf7", purple: "#b197fc" };
    for (const [name, hex] of Object.entries(colors)) {
      crow.append(el("div", { class: `swatch bg-${name}`, title: name, onclick: () => { menu.remove(); applyBlockColor(wrap, hex); } }));
    }
    crow.append(el("div", { class: "swatch bg-default", title: "Clear", onclick: () => { menu.remove(); applyBlockColor(wrap, ""); } }));
    menu.append(crow);

    menu.append(label("SIZE"));
    const srow = el("div", { class: "fm-row" });
    for (const [t, sz] of [["S", "s"], ["M", ""], ["L", "l"]]) {
      srow.append(el("button", { class: "swatch bg-default", style: "color:var(--text);font-family:var(--mono);font-size:11px;display:flex;align-items:center;justify-content:center;", onclick: () => { menu.remove(); if (sz) wrap.dataset.size = sz; else delete wrap.dataset.size; queueSave(); } }, t));
    }
    menu.append(srow);

    menu.append(el("div", { class: "fm-sep" }));
    menu.append(item("⧉", "Duplicate", () => {
      const c = wrap.querySelector(".content").innerHTML;
      const node = addBlock(wrap.dataset.type, c, false, wrap);
      if (wrap.classList.contains("done")) node.classList.add("done");
      queueSave();
    }));
    menu.append(item("⧉", "Copy text", () => {
      navigator.clipboard?.writeText(wrap.querySelector(".content").innerText).catch(() => {});
      toast("Block copied", "ok");
    }));
    menu.append(item("↑", "Move up", () => {
      const prev = wrap.previousElementSibling;
      if (prev) { wrap.before(prev); renumber(); queueSave(); }
    }));
    menu.append(item("↓", "Move down", () => {
      const next = wrap.nextElementSibling;
      if (next) { wrap.after(next); renumber(); queueSave(); }
    }));
    menu.append(el("div", { class: "fm-sep" }));
    menu.append(item("🗑", "Delete block", () => {
      if ($$("#editor .block").length > 1) { wrap.remove(); } else { wrap.querySelector(".content").innerHTML = ""; wrap.dataset.type = "p"; }
      renumber();
      queueSave();
      updateFooter();
    }, "Del"));

    document.body.append(menu);
    const mw = menu.offsetWidth; const mh = menu.offsetHeight;
    menu.style.left = `${Math.min(x, window.innerWidth - mw - 10)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - mh - 10)}px`;
    setTimeout(() => {
      const closer = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("mousedown", closer); } };
      document.addEventListener("mousedown", closer);
    });
  }

  function applyBlockColor(wrap, hex) {
    const content = wrap.querySelector(".content");
    content.focus();
    document.execCommand("styleWithCSS", false, true);
    if (hex) document.execCommand("foreColor", false, hex);
    else {
      // clear colors
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) document.execCommand("removeFormat", false, null);
      else {
        content.querySelectorAll("font,span[style]").forEach((n) => {
          if (n.style?.color) n.style.color = "";
        });
      }
    }
    queueSave();
  }

  // ---------- selection toolbar ----------
  function initSelToolbar() {
    document.addEventListener("selectionchange", debounce(() => {
      const sel = window.getSelection();
      selToolbar?.remove();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const node = sel.anchorNode;
      const inEditor = node && $("#editor").contains(node);
      const inChat = node && $("#chatInput")?.contains(node);
      if (!inEditor || inChat) return;
      if (sel.toString().trim().length < 1) return;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (!r.width && !r.height) return;
      const bar = el("div", { class: "selbar", id: "selBar" });
      const b = (t, fn, title) => el("button", { title, onmousedown: (e) => e.preventDefault(), onclick: fn }, t);
      bar.append(
        b("<b>B</b>", () => document.execCommand("bold"), "Bold (Ctrl+B)"),
        b("<i>I</i>", () => document.execCommand("italic"), "Italic (Ctrl+I)"),
        b("<u>U</u>", () => document.execCommand("underline"), "Underline"),
        b("<s>S</s>", () => document.execCommand("strikeThrough"), "Strikethrough"),
        b("‹›", () => document.execCommand("insertHTML", false, `<code>${escHtml(sel.toString())}</code>`), "Code"),
      );
      for (const hex of ["#ff6b6b", "#ffa94d", "#51cf66", "#4dabf7"]) {
        bar.append(el("div", { class: "sw", style: `background:${hex}`, onmousedown: (e) => e.preventDefault(), onclick: () => { document.execCommand("styleWithCSS", false, true); document.execCommand("foreColor", false, hex); } }));
      }
      bar.append(b(" wiki ", () => {
        const t = sel.toString().trim();
        if (t) document.execCommand("insertHTML", false, `<span class="wikilink" data-wiki="${escHtml(t)}">${escHtml(t)}</span>`);
        queueSave();
      }, "Make [[wiki-link]]"));
      bar.style.left = `${Math.max(8, r.left + r.width / 2 - 120)}px`;
      bar.style.top = `${Math.max(8, r.top - 42)}px`;
      document.body.append(bar);
      selToolbar = bar;
      setTimeout(() => {
        const closer = (e) => { if (!bar.contains(e.target)) { bar.remove(); if (selToolbar === bar) selToolbar = null; document.removeEventListener("mousedown", closer); } };
        document.addEventListener("mousedown", closer);
      });
    }, 250));
  }

  // ---------- wiki link clicks ----------
  function initWikiClicks() {
    document.addEventListener("click", (e) => {
      const chip = e.target.closest(".wikilink");
      if (!chip) return;
      const title = chip.dataset.wiki;
      window.openNoteByTitle?.(title);
    });
  }

  function updateFooter() {
    const text = $$("#editor .content").map((c) => c.innerText).join(" ");
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    $("#edWords").textContent = `${words} WORDS`;
  }

  // ---------- public ----------
  function open(n) {
    note = n;
    S.noteId = n.id;
    $("#noteTitle").value = n.title === "Untitled" ? "" : n.title;
    $("#btnStar").textContent = n.starred ? "★" : "☆";
    $("#btnPin").style.color = n.pinned ? "var(--accent)" : "";
    try { blocks = JSON.parse(n.contentJson || "[]"); } catch { blocks = []; }
    render();
    updateFooter();
    $("#edSaved").textContent = "SAVED";
    window.refreshRightPanel?.(n);
    focusFirst();
  }
  function focusFirst() {
    const first = $("#editor .block .content[contenteditable='true']");
    if (first && first.innerText.trim() === "") focusBlock(first.closest(".block"));
  }
  function currentNote() { return note; }

  function insertImageBlock(path) {
    const html = `<img src="${convertFileSrc(path)}" alt="">`;
    const last = $$("#editor .block").pop();
    addBlock("img", html, false, last);
    queueSave();
  }
  function insertAttachBlock(att) {
    const ic = att.kind === "image" ? "🖼" : "📄";
    const html = `<span class="att" data-path="${escHtml(att.path)}" data-kind="${att.kind}" data-name="${escHtml(att.name)}">${ic} <b>${escHtml(att.name)}</b> <span class="dim">${fmtBytes(att.size)}</span></span>`;
    const last = $$("#editor .block").pop();
    addBlock("attach", html, false, last);
    queueSave();
  }

  function init() {
    initSelToolbar();
    initWikiClicks();
    // editor area clicks
    $("#editor").addEventListener("click", (e) => {
      const img = e.target.closest('[data-type="img"] img');
      const att = e.target.closest(".att");
      if (img) { window.openViewer?.(img.src, "image", "image"); return; }
      if (att) { window.openViewer?.(att.dataset.path, att.dataset.name, att.dataset.kind); return; }
      if (e.target.id === "editor" || e.target.classList.contains("editor-page")) {
        const blocks2 = $$("#editor .block");
        const last = blocks2[blocks2.length - 1];
        if (last && last.querySelector(".content")?.textContent.trim() === "") focusBlock(last);
        else addBlock("p", "", true);
      }
    });
    // keyboard shortcuts inside editor
    document.addEventListener("keydown", (e) => {
      if (!$("#view-notes").classList.contains("active")) return;
      const sel = window.getSelection();
      const inEditor = sel?.anchorNode && $("#editor").contains(sel.anchorNode);
      if (!inEditor) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (e.key === "b") { e.preventDefault(); document.execCommand("bold"); }
        if (e.key === "i") { e.preventDefault(); document.execCommand("italic"); }
        if (e.key === "u") { e.preventDefault(); document.execCommand("underline"); }
      }
      if (e.key === "Delete") {
        const wrap = sel?.anchorNode?.parentElement?.closest?.(".block");
        if (wrap) { /* handled in ctx menu only */ }
      }
    });
    // title
    $("#noteTitle").addEventListener("input", debounce(async () => {
      if (!note) return;
      const t = $("#noteTitle").value.trim() || "Untitled";
      note.title = t;
      await invoke("update_note", { id: note.id, title: t });
      S.notesCache.set(note.id, note);
      window.refreshNotesList?.();
    }, 600));
  }

  return { init, open, currentNote, addBlock, serialize, queueSave, insertImageBlock, insertAttachBlock, saveNow, updateFooter };
})();
