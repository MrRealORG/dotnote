// DotNote — widgets-main.js : logic for the 4 desktop widgets (quick note, tasks, clock, focus)
"use strict";

const T = window.__TAURI__ || window.parent.__TAURI__;
if (!T) { document.body.innerHTML = "Widget failed to load Tauri API"; throw new Error("no tauri"); }
const winvoke = (cmd, args = {}) => T.core.invoke(cmd, args);

const key = (() => {
  const q = new URLSearchParams(location.search).get("w") || location.hash.replace("#", "");
  if (q) return q;
  try {
    const w = T.window.getCurrentWindow?.() || T.window.getCurrent?.();
    const label = w?.label || "";
    if (label.startsWith("widget-")) return label.slice(7);
  } catch {}
  return "quicknote";
})();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);

const TITLES = { quicknote: "QUICK NOTE", tasks: "TASKS", clock: "CLOCK", focus: "FOCUS" };

document.documentElement.dataset.theme = "nothing-dark";
let settings = {};
try { winvoke("settings_all").then((s) => { settings = s; document.documentElement.dataset.theme = s.theme || "nothing-dark"; }).catch(() => {}); } catch {}

const head = (extra = "") => {
  const h = document.createElement("div");
  h.className = "wg-head";
  h.innerHTML = `<span class="dot"></span><span>${TITLES[key] || "WIDGET"}</span><span class="grow"></span>${extra}
    <button id="wPin" title="Always on top">●</button>
    <button id="wClose" title="Hide (reopen from tray / settings)">×</button>`;
  return h;
};

async function wireHead(body) {
  $("#wClose").addEventListener("click", () => { try { T.window.getCurrentWindow().hide(); } catch { try { T.window.getCurrent().hide(); } catch (e) { console.warn(e); } } });
  $("#wPin").addEventListener("click", async () => {
    try {
      const w = T.window.getCurrentWindow?.() || T.window.getCurrent();
      const top = !(await w.isAlwaysOnTop());
      await w.setAlwaysOnTop(top);
      $("#wPin").style.color = top ? "var(--accent)" : "";
    } catch (e) { console.warn(e); }
  });
  try {
    const w = T.window.getCurrentWindow?.() || T.window.getCurrent();
    if (await w.isAlwaysOnTop()) $("#wPin").style.color = "var(--accent)";
  } catch {}
}

// ---------- quick note ----------
function quickNote() {
  const body = document.createElement("div");
  body.className = "wg-body wg-quick";
  const ta = document.createElement("textarea");
  ta.placeholder = "Jot anything…\n\nSaved to your notes when you press Save.";
  const foot = document.createElement("div");
  foot.className = "wg-foot";
  const mic = document.createElement("button");
  mic.className = "wg-btn"; mic.textContent = "🎙"; mic.title = "Record & transcribe into this note";
  const save = document.createElement("button");
  save.className = "wg-btn primary"; save.textContent = "Save → Note";
  foot.append(mic, save);
  body.append(ta, foot);

  let recState = null;
  const WORKLET = `class P extends AudioWorkletProcessor{process(i){const c=i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('pcm-capture',P);`;
  function encodeWav(samples, rate) {
    const buf = new ArrayBuffer(44 + samples.length * 2); const v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); ws(8, "WAVE");
    ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, "data"); v.setUint32(40, samples.length * 2, true);
    let o = 44;
    for (let i = 0; i < samples.length; i++, o += 2) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Uint8Array(buf);
  }
  mic.addEventListener("click", async () => {
    if (!recState) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext();
        await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" })));
        const chunks = [];
        const node = new AudioWorkletNode(ctx, "pcm-capture");
        node.port.onmessage = (e) => chunks.push(e.data);
        ctx.createMediaStreamSource(stream).connect(node);
        recState = { stream, ctx, node, chunks, t0: Date.now() };
        mic.classList.add("rec");
      } catch (e) { alert("Mic error: " + (e.message || e)); }
    } else {
      const { stream, ctx, node, chunks, t0 } = recState;
      try { node.disconnect(); } catch {}
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      recState = null;
      mic.classList.remove("rec");
      const rate = ctx.sampleRate;
      const len = chunks.reduce((a, c) => a + c.length, 0);
      const all = new Float32Array(len);
      let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
      // downsample to 16k
      const ratio = rate / 16000;
      const outLen = Math.floor(len / ratio);
      const ds = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) { const p = i * ratio; const ix = Math.floor(p); ds[i] = all[ix] * (1 - (p - ix)) + (all[ix + 1] || 0) * (p - ix); }
      const wav = encodeWav(ds, 16000);
      let s = ""; const CH = 0x8000;
      for (let i = 0; i < wav.length; i += CH) s += String.fromCharCode.apply(null, wav.subarray(i, i + CH));
      const b64 = btoa(s);
      mic.textContent = "…";
      try {
        const res = await winvoke("transcribe_audio", { audioB64: b64, filename: "quick.wav", provider: null });
        if (res.text) ta.value = (ta.value ? ta.value + "\n" : "") + res.text;
        else ta.value += "\n(nothing heard)";
      } catch (e) { alert(String(e.message || e)); }
      mic.textContent = "🎙";
    }
  });
  save.addEventListener("click", async () => {
    if (!ta.value.trim()) return;
    await winvoke("save_quick_note", { text: ta.value.trim() });
    ta.value = "";
    saved();
  });
  function saved() {
    save.textContent = "Saved ✓";
    setTimeout(() => (save.textContent = "Save → Note"), 1200);
  }
  $("#wg").append(head(), body);
}

// ---------- tasks ----------
async function tasksWidget() {
  const body = document.createElement("div");
  body.className = "wg-body";
  const list = document.createElement("div");
  const add = document.createElement("div");
  add.className = "wg-add";
  const inp = document.createElement("input");
  inp.placeholder = "+ Add task…";
  const when = document.createElement("button");
  when.className = "wg-btn"; when.textContent = "Today"; when.title = "Due today";
  when.style.flex = "none";
  let dueToday = true;
  when.addEventListener("click", () => { dueToday = !dueToday; when.textContent = dueToday ? "Today" : "Someday"; });
  inp.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && inp.value.trim()) {
      const due = dueToday ? new Date(Date.now() + 864e5).toISOString() : null;
      await winvoke("create_task", { goalId: null, title: inp.value.trim(), priority: "normal", dueAt: due });
      inp.value = "";
      render();
    }
  });
  add.append(inp, when);
  body.append(list, add);

  async function render() {
    const tasks = await winvoke("list_tasks", { goalId: null, scope: "open" });
    list.innerHTML = "";
    if (!tasks.length) list.innerHTML = `<div class="wg-note-empty">All clear ✓</div>`;
    for (const t of tasks.slice(0, 14)) {
      const row = document.createElement("div");
      row.className = `task-row ${t.done ? "done" : ""}`;
      const ck = document.createElement("div");
      ck.className = "ck";
      ck.addEventListener("click", async () => {
        await winvoke("update_task", { id: t.id, done: t.done ? 0 : 1, title: null, priority: null, dueAt: null });
        render();
      });
      const tt = document.createElement("div");
      tt.className = "t"; tt.textContent = t.title;
      row.append(ck, tt);
      if (t.dueAt) {
        const d = document.createElement("div");
        d.className = "wg-btn"; d.style.cssText = "border:none;font-size:10px;color:var(--muted);";
        const dt = new Date(t.dueAt);
        d.textContent = dt.toDateString() === new Date().toDateString() ? "TODAY" : dt.toLocaleDateString([], { month: "short", day: "numeric" });
        row.append(d);
      }
      const del = document.createElement("button");
      del.className = "wg-btn"; del.style.border = "none"; del.textContent = "×";
      del.addEventListener("click", async () => { await winvoke("delete_task", { id: t.id }); render(); });
      row.append(del);
      list.append(row);
    }
  }
  $("#wg").append(head(), body);
  await render();
  setInterval(render, 60000);
}

// ---------- clock ----------
async function clockWidget() {
  const body = document.createElement("div");
  body.className = "wg-body wg-clock";
  const time = document.createElement("div");
  time.className = "time";
  const date = document.createElement("div");
  date.className = "date";
  const rems = document.createElement("div");
  rems.style.cssText = "width:100%;display:flex;flex-direction:column;gap:6px;margin-top:10px;";
  body.append(time, date, rems);
  $("#wg").append(head(), body);
  async function render() {
    const now = new Date();
    time.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    date.textContent = now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }).toUpperCase();
    try {
      const remsList = await winvoke("list_reminders");
      const open = remsList.filter((r) => !r.done).slice(0, 4);
      rems.innerHTML = open.length ? "" : `<div class="wg-note-empty">No upcoming reminders</div>`;
      for (const r of open) {
        const row = document.createElement("div");
        row.className = "rem-row";
        const due = new Date(r.fireAt);
        row.innerHTML = `<span class="when">${due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span class="t"></span>`;
        row.querySelector(".t").textContent = r.title;
        rems.append(row);
      }
    } catch {}
  }
  await render();
  setInterval(render, 5000);
}

// ---------- focus ----------
async function focusWidget() {
  const body = document.createElement("div");
  body.className = "wg-body wg-focus";
  const phase = document.createElement("div");
  phase.className = "phase"; phase.textContent = "FOCUS";
  const timer = document.createElement("div");
  timer.className = "timer";
  const row = document.createElement("div");
  row.className = "row";
  const start = document.createElement("button");
  start.className = "wg-btn primary"; start.textContent = "▶ Start";
  const reset = document.createElement("button");
  reset.className = "wg-btn"; reset.textContent = "Reset";
  row.append(start, reset);
  const note = document.createElement("div");
  note.className = "wg-note-empty";
  body.append(phase, timer, row, note);
  $("#wg").append(head(), body);

  let left = (+settings.focus_minutes || 25) * 60;
  let isBreak = false;
  let run = null;
  function paint() {
    timer.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
    timer.classList.toggle("break", isBreak);
    phase.textContent = isBreak ? "BREAK" : "FOCUS";
    start.textContent = run ? "❚❚ Pause" : "▶ Start";
  }
  start.addEventListener("click", () => {
    if (run) { clearInterval(run); run = null; paint(); return; }
    run = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(run); run = null;
        isBreak = !isBreak;
        left = (isBreak ? +settings.focus_break_minutes || 5 : +settings.focus_minutes || 25) * 60;
        try { T.core.invoke("plugin:notification|notify", { title: "DotNote", body: isBreak ? "Break time 🍵" : "Back to focus 🍅" }); } catch {}
      }
      paint();
    }, 1000);
  });
  reset.addEventListener("click", () => { clearInterval(run); run = null; isBreak = false; left = (+settings.focus_minutes || 25) * 60; paint(); });
  paint();
}

// ---------- boot ----------
(async () => {
  const wg = $("#wg");
  wg.innerHTML = "";
  if (key === "quicknote") quickNote();
  else if (key === "tasks") await tasksWidget();
  else if (key === "clock") await clockWidget();
  else if (key === "focus") await focusWidget();
  else { wg.innerHTML = `<div class="wg-note-empty">Unknown widget: ${key}</div>`; }
  wireHead();
})();
