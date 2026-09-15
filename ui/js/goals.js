// DotNote — goals.js : goals, tasks, focus timer
"use strict";

const Goals = (() => {
  let goals = [];
  let focusInt = null;
  let focusLeft = 25 * 60;
  let focusRunning = false;
  let focusIsBreak = false;

  async function load() {
    goals = await invoke("list_goals");
    render();
    loadTodayTasks();
  }

  async function loadTodayTasks() {
    const tasks = await invoke("list_tasks", { goalId: null, scope: "open" });
    const today = tasks.filter((t) => t.dueAt && new Date(t.dueAt).toDateString() === new Date().toDateString());
    const box = $("#todayTasks");
    if (!box) return;
    box.innerHTML = "";
    box.append(el("div", { class: "rp-title", style: "margin-bottom:6px;" }, "TODAY'S TASKS"));
    if (!today.length) box.append(el("div", { class: "small dim" }, "Nothing due today."));
    for (const t of today) box.append(taskRow(t, load));
  }

  function taskRow(t, refresh) {
    const row = el("div", { class: `task-row ${t.done ? "done" : ""}` });
    const ck = el("div", { class: "ck" });
    ck.addEventListener("click", async () => {
      await invoke("update_task", { id: t.id, done: t.done ? 0 : 1, title: null, priority: null, dueAt: null });
      refresh();
    });
    row.append(ck);
    const title = el("div", { class: "t-title" }, t.title);
    title.addEventListener("dblclick", () => editTask(t, refresh));
    row.append(title);
    if (t.priority === "high") row.append(el("span", { class: "t-pri high" }, "HIGH"));
    if (t.dueAt) row.append(el("span", { class: "t-due" }, fmtDate(t.dueAt)));
    row.append(el("button", { class: "iconbtn", style: "width:24px;height:24px;font-size:11px;", title: "Delete", onclick: async () => { await invoke("delete_task", { id: t.id }); refresh(); } }, "×"));
    return row;
  }

  function editTask(t, refresh) {
    const body = el("div");
    const fTitle = el("input", { type: "text", value: t.title });
    const fDue = el("input", { type: "datetime-local", value: t.dueAt ? new Date(t.dueAt).toISOString().slice(0, 16) : "" });
    const fPri = el("select", {},
      el("option", { value: "low" }, "Low"),
      el("option", { value: "normal" }, "Normal"),
      el("option", { value: "high" }, "High"),
    );
    fPri.value = t.priority || "normal";
    const foot = el("div");
    foot.append(
      el("button", { class: "btn", onclick: closeModal }, "Cancel"),
      el("button", { class: "btn primary", onclick: async () => {
        await invoke("update_task", { id: t.id, title: fTitle.value, priority: fPri.value, done: null, dueAt: fDue.value ? new Date(fDue.value).toISOString() : null });
        // optional reminder on task
        closeModal(); refresh();
      } }, "Save"),
    );
    body.append(
      el("div", { class: "field" }, el("label", {}, "TASK"), fTitle),
      el("div", { class: "field" }, el("label", {}, "DUE"), fDue),
      el("div", { class: "field" }, el("label", {}, "PRIORITY"), fPri),
    );
    openModal(body, { title: "Edit task", foot });
  }

  function render() {
    const grid = $("#goalsGrid");
    grid.innerHTML = "";
    if (!goals.length) {
      grid.append(el("div", { class: "empty-state", style: "grid-column:1/-1;padding:40px;" },
        el("div", { class: "es-big" }, "◎"),
        el("div", { class: "es-title" }, "No goals yet"),
        el("div", { class: "small dim" }, "Create a goal, add tasks, set reminders and watch progress build.")));
      return;
    }
    for (const g of goals) grid.append(goalCard(g));
  }

  function goalCard(g) {
    const card = el("div", { class: "goal-card" });
    card.style.setProperty("--gcolor", g.color || "var(--accent)");
    const head = el("div", { class: "g-head" });
    head.append(el("div", { class: "g-title" }, g.title));
    head.append(el("button", { class: "iconbtn", title: "Set reminder on this goal", onclick: () => window.openReminderDialog?.("goal", g.id, g.title) }, "🔔"));
    head.append(el("button", { class: "iconbtn", title: "Delete", onclick: async () => { await invoke("delete_goal", { id: g.id }); load(); } }, "🗑"));
    card.append(head);
    if (g.description) card.append(el("div", { class: "g-desc" }, g.description));
    const meta = el("div", { class: "g-meta" });
    meta.append(el("span", {}, `STATUS: ${g.status.toUpperCase()}`));
    if (g.targetDate) meta.append(el("span", {}, `TARGET: ${g.targetDate}`));
    card.append(meta);
    card.append(el("div", { class: "progressbar" }, el("i", { style: `width:${g.progress || 0}%` })));
    const pct = el("div", { class: "mono dim small", style: "margin-top:4px;" }, `${g.progress || 0}% COMPLETE`);
    card.append(pct);

    // tasks
    const listBox = el("div", { class: "mt8", "data-goal": g.id });
    card.append(listBox);
    fillTasks(listBox, g);
    const addRow = el("div", { class: "add-task-row" });
    const inp = el("input", { type: "text", placeholder: "+ Add task, Enter to save" });
    inp.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && inp.value.trim()) {
        await invoke("create_task", { goalId: g.id, title: inp.value.trim(), priority: "normal", dueAt: null });
        inp.value = "";
        fillTasks(listBox, g);
      }
    });
    addRow.append(inp);
    card.append(addRow);
    return card;
  }

  async function fillTasks(box, g) {
    box.innerHTML = "";
    const tasks = await invoke("list_tasks", { goalId: g.id, scope: null });
    for (const t of tasks) {
      const row = taskRow(t, async () => { fillTasks(box, g); load(); });
      row.querySelector(".ck")?.addEventListener("click", async () => {
        await invoke("update_task", { id: t.id, done: t.done ? 0 : 1, title: null, priority: null, dueAt: null });
        fillTasks(box, g); load();
      });
      box.append(row);
    }
    if (!tasks.length) box.append(el("div", { class: "small dim", style: "padding:4px;" }, "No tasks yet."));
  }

  function newGoalDialog() {
    const body = el("div");
    const fTitle = el("input", { type: "text", placeholder: "Run a 10k", value: "" });
    const fDesc = el("textarea", { placeholder: "Why does it matter?" });
    const fDate = el("input", { type: "date" });
    const fColor = el("select", {},
      el("option", { value: "#d71921" }, "Red"),
      el("option", { value: "#4dabf7" }, "Blue"),
      el("option", { value: "#51cf66" }, "Green"),
      el("option", { value: "#ffa94d" }, "Orange"),
      el("option", { value: "#b197fc" }, "Purple"),
    );
    const foot = el("div");
    foot.append(
      el("button", { class: "btn", onclick: closeModal }, "Cancel"),
      el("button", { class: "btn primary", onclick: async () => {
        if (!fTitle.value.trim()) return;
        await invoke("create_goal", { title: fTitle.value.trim(), description: fDesc.value.trim(), color: fColor.value, targetDate: fDate.value || null });
        closeModal(); load();
      } }, "Create goal"),
    );
    body.append(
      el("div", { class: "field" }, el("label", {}, "GOAL"), fTitle),
      el("div", { class: "field" }, el("label", {}, "DESCRIPTION"), fDesc),
      el("div", { class: "flex" },
        el("div", { class: "field grow" }, el("label", {}, "TARGET DATE"), fDate),
        el("div", { class: "field grow" }, el("label", {}, "COLOR"), fColor),
      ),
    );
    openModal(body, { title: "New goal", foot });
  }

  // ---------- focus timer ----------
  function renderFocus() {
    const m = Math.floor(focusLeft / 60); const s = focusLeft % 60;
    const t = $("#focusTimer");
    if (t) {
      t.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      t.classList.toggle("break", focusIsBreak);
    }
    const btn = $("#btnFocusToggle");
    if (btn) btn.textContent = focusRunning ? "❚❚ Pause" : "▶ Start";
  }

  function focusToggle() {
    if (focusRunning) {
      clearInterval(focusInt); focusRunning = false;
    } else {
      focusRunning = true;
      focusInt = setInterval(async () => {
        focusLeft -= 1;
        if (focusLeft <= 0) {
          clearInterval(focusInt); focusRunning = false;
          if (!focusIsBreak) {
            focusIsBreak = true;
            focusLeft = (+S.settings.focus_break_minutes || 5) * 60;
            toast("🍅 Focus session done — take a break", "ok");
            try {
              await invoke("create_reminder", { entityType: "custom", entityId: null, title: "Focus session completed 🍅", fireAt: new Date().toISOString(), repeat: "none" });
            } catch {}
          } else {
            focusIsBreak = false;
            focusLeft = (+S.settings.focus_minutes || 25) * 60;
            toast("Break over — back to focus", "ok");
          }
        }
        renderFocus();
      }, 1000);
    }
    renderFocus();
  }

  function focusReset() {
    clearInterval(focusInt); focusRunning = false; focusIsBreak = false;
    focusLeft = (+S.settings.focus_minutes || 25) * 60;
    renderFocus();
  }

  function init() {
    $("#btnNewGoal").addEventListener("click", newGoalDialog);
    $("#btnFocusToggle").addEventListener("click", focusToggle);
    $("#btnFocusReset").addEventListener("click", focusReset);
    $("#btnOpenFocusWidget").addEventListener("click", async () => {
      await invoke("widget_toggle", { key: "focus" });
    });
    renderFocus();
  }

  return { init, load, open: load };
})();
