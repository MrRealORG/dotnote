// DotNote — trash.js : soft-deleted items, restore / purge / empty
"use strict";

const Trash = (() => {
  async function open() {
    const wrap = $("#trashWrap");
    wrap.innerHTML = "";
    const data = await invoke("trash_list");
    let total = 0;
    for (const [kind, items] of Object.entries(data)) {
      if (!items.length) continue;
      total += items.length;
      const group = el("div", { class: "trash-group" },
        el("div", { class: "side-section", style: "padding-left:0;" }, kind.toUpperCase()));
      for (const it of items) {
        group.append(el("div", { class: "trash-row" },
          el("span", { class: "t-kind" }, kind),
          el("span", { class: "t-name" }, it.title || "(untitled)"),
          el("span", { class: "t-date" }, it.deletedAt ? fmtDate(it.deletedAt) : ""),
          el("button", { class: "btn sm", onclick: async () => { await invoke("trash_restore", { kind, id: it.id }); open(); toast("Restored", "ok"); } }, "↩ Restore"),
          el("button", { class: "btn sm danger", onclick: async () => { await invoke("trash_purge", { kind, id: it.id }); open(); } }, "✕ Delete forever"),
        ));
      }
      wrap.append(group);
    }
    if (!total) {
      wrap.append(el("div", { class: "empty-state", style: "min-height:220px;" },
        el("div", { class: "es-big" }, "⌫"),
        el("div", { class: "es-title" }, "Trash is empty"),
        el("div", { class: "small dim" }, "Deleted notes, goals, tasks, channels and folders wait here. Auto-purged after 30 days.")));
    }
  }

  function init() {
    $("#btnEmptyTrash").addEventListener("click", () => {
      confirmBox("Permanently delete everything in the trash?", async () => {
        await invoke("trash_empty");
        open();
        toast("Trash emptied", "ok");
      }, "Empty trash");
    });
  }

  return { init, open };
})();
