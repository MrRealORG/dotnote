// DotNote — files.js : imports (pdf/docx/txt/md), attachment library, built-in DOCX & PDF viewers
"use strict";

const Files = (() => {
  const IC = { pdf: "📕", docx: "📘", doc: "📘", txt: "📃", md: "📃", png: "🖼", jpg: "🖼", jpeg: "🖼", webp: "🖼", gif: "🖼" };

  async function load() {
    const grid = $("#filesGrid");
    grid.innerHTML = "";
    const atts = await invoke("list_attachments", { noteId: null });
    if (!atts.length) {
      grid.append(el("div", { class: "small dim", style: "grid-column:1/-1;" }, "No files yet. Import documents above or attach to any note with 📎."));
      return;
    }
    for (const a of atts) {
      const ext = (a.name.split(".").pop() || "").toLowerCase();
      const card = el("div", { class: "file-card" });
      const prev = el("div", { class: "fc-preview" });
      if (a.kind === "image") prev.append(el("img", { src: convertFileSrc(a.path) }));
      else prev.append(el("div", { class: "fc-ic" }, IC[ext] || "📄"));
      card.append(prev);
      card.append(el("div", { class: "fc-info" },
        el("div", { class: "fc-name" }, a.name),
        el("div", { class: "fc-meta" }, `${a.kind.toUpperCase()} · ${fmtBytes(a.size)} · ${fmtDate(a.createdAt)}`),
      ));
      card.addEventListener("click", () => openViewer(a.path, a.name, a.kind));
      const del = el("button", { class: "iconbtn", title: "Delete", style: "position:absolute;margin:6px;", onclick: async (e) => {
        e.stopPropagation();
        await invoke("delete_attachment", { id: a.id });
        load();
      } }, "🗑");
      card.style.position = "relative";
      card.append(del);
      grid.append(card);
    }
  }

  async function importDocs() {
    toast("Choose files to import…");
    const res = await invoke("import_files");
    const created = res.created || [];
    const errors = res.errors || [];
    if (created.length) {
      toast(`Imported ${created.length} document${created.length > 1 ? "s" : ""} as notes ✓`, "ok");
      window.refreshNotesList?.();
    }
    for (const e of errors) toast(`${e.file}: ${e.error}`, "err");
  }

  // ---------- built-in viewers ----------
  async function openViewer(path, name, kind) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    const body = el("div", { class: "viewer-body" });
    const foot = el("div");
    if (kind !== "image" && ext !== "pdf" && ext !== "docx") {
      foot.append(el("button", { class: "btn", onclick: () => invoke("open_path", { path }) }, "Open externally"));
    }
    foot.append(el("button", { class: "btn", onclick: closeModal }, "Close"));
    openModal(body, { title: name || "Viewer", size: "xl", foot });

    if (kind === "image") {
      body.style.alignItems = "center";
      body.append(el("img", { src: convertFileSrc(path), style: "max-width:100%;max-height:80vh;margin:auto;" }));
      return;
    }
    if (ext === "pdf") {
      // WebView2 has a built-in PDF renderer
      const iframe = el("iframe", { src: convertFileSrc(path) });
      body.append(iframe);
      // fallback text extraction available via button
      const bar = el("div", { class: "flex", style: "padding:8px;border-top:1px solid var(--border);gap:8px;" });
      bar.append(el("button", { class: "btn ghost sm", onclick: async () => {
        try {
          const r = await invoke("pdf_text", { path });
          body.innerHTML = "";
          body.append(el("div", { class: "viewer-doc" }, el("pre", { style: "white-space:pre-wrap;font-family:var(--sans);font-size:13.5px;" }, r.text || "(no text layer)")));
        } catch (e) { toast(String(e.message || e), "err"); }
      } }, "Text mode (extract)"));
      bar.append(el("div", { class: "grow" }));
      bar.append(el("button", { class: "btn ghost sm", onclick: () => invoke("open_path", { path }) }, "Open in system app"));
      body.append(bar);
      return;
    }
    if (ext === "docx") {
      try {
        const r = await invoke("docx_to_html", { path });
        body.append(el("div", { class: "viewer-doc" }, (() => { const d = el("div"); d.innerHTML = r.html; return d; })()));
      } catch (e) {
        body.append(el("div", { class: "viewer-doc" }, `Could not render: ${String(e.message || e)}`));
      }
      return;
    }
    // txt / md plain
    try {
      const resp = await fetch(convertFileSrc(path));
      const text = await resp.text();
      body.append(el("div", { class: "viewer-doc" }, el("pre", { style: "white-space:pre-wrap;font-family:var(--sans);" }, text)));
    } catch (e) {
      body.append(el("div", { class: "viewer-doc" }, `Cannot read file: ${String(e.message || e)}`));
    }
  }

  async function attachToCurrentNote() {
    const note = Editor.currentNote();
    if (!note) { toast("Open a note first"); return; }
    const atts = await invoke("attach_to_note", { noteId: note.id });
    for (const a of atts) {
      if (a.kind === "image") Editor.insertImageBlock(a.path);
      else Editor.insertAttachBlock(a);
    }
    if (atts.length) { toast(`Attached ${atts.length} file(s)`, "ok"); refreshRightPanel(note); }
  }

  function init() {
    $("#btnImport").addEventListener("click", importDocs);
    const dz = $("#dropzone");
    dz.addEventListener("click", importDocs);
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("over"));
    dz.addEventListener("drop", async (e) => {
      e.preventDefault();
      dz.classList.remove("over");
      toast("Use the Import button — drag-drop opens the system picker");
      importDocs();
    });
  }

  return { init, load, openViewer, importDocs, attachToCurrentNote, open: load };
})();
