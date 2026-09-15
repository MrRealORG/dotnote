// DotNote — voice.js : recorder, live transcript (mic / meeting audio), recordings (kept 30 days)
"use strict";

const Voice = (() => {
  // ---------- shared audio helpers ----------
  const WORKLET_CODE = `
    class PcmCapture extends AudioWorkletProcessor {
      process(inputs) {
        const ch = inputs[0][0];
        if (ch) this.port.postMessage(ch.slice(0));
        return true;
      }
    }
    registerProcessor('pcm-capture', PcmCapture);
  `;

  function encodeWav(samples, sampleRate) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); ws(8, "WAVE");
    ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, "data"); v.setUint32(40, samples.length * 2, true);
    let o = 44;
    for (let i = 0; i < samples.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buf);
  }

  function downsample(f32, fromRate, toRate = 16000) {
    if (fromRate === toRate) return f32;
    const ratio = fromRate / toRate;
    const len = Math.floor(f32.length / ratio);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      out[i] = f32[idx] * (1 - frac) + (f32[idx + 1] || 0) * frac;
    }
    return out;
  }

  const b64 = (u8) => { let s = ""; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); };

  function b64ToUrl(b64str) {
    const bin = atob(b64str);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([u8], { type: "audio/wav" }));
  }

  // ---------- state ----------
  let mode = null; // 'rec' | 'live' | 'live-system' | null
  let audioCtx = null;
  let stream = null;
  let node = null;
  let pcm = [];       // full recording buffers (Float32Array chunks)
  let totalLen = 0;
  let srcRate = 48000;
  let startedAt = 0;
  let timerInt = null;
  let liveCommitted = "";
  let liveBusy = false;
  let waveInt = null;
  let segTimer = null;
  let lastLevel = 0;

  function isActive() { return mode !== null; }

  async function startAudio(sourceType) {
    if (sourceType === "system") {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("No audio in the shared screen — tick 'Share audio' when sharing a tab/screen, or use mic mode.");
      }
      stream.getVideoTracks().forEach((t) => t.stop()); // audio only
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    }
    audioCtx = new AudioContext();
    srcRate = audioCtx.sampleRate;
    await audioCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET_CODE], { type: "application/javascript" })));
    const src = audioCtx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(audioCtx, "pcm-capture");
    node.port.onmessage = (e) => {
      const chunk = e.data;
      if (mode === null) return;
      pcm.push(chunk);
      totalLen += chunk.length;
      // level meter
      let sum = 0;
      for (let i = 0; i < chunk.length; i += 16) sum += chunk[i] * chunk[i];
      lastLevel = Math.min(1, Math.sqrt(sum / (chunk.length / 16)) * 6);
    };
    src.connect(node);
    node.connect(audioCtx.destination); // needed in some webviews to keep pumping; barely audible
    // actually route to a zero gain to avoid echo
    const zero = audioCtx.createGain();
    zero.gain.value = 0;
    node.disconnect();
    node.connect(zero);
    zero.connect(audioCtx.destination);
  }

  function stopAudio() {
    try { node?.disconnect(); } catch {}
    try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { audioCtx?.close(); } catch {}
    node = null; stream = null; audioCtx = null;
  }

  // ---------- UI ----------
  function setStatus(t) { $("#voiceStatus").textContent = `● ${t}`; }
  function startTimer() {
    startedAt = Date.now();
    $("#voiceTimer").textContent = "00:00";
    timerInt = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      $("#voiceTimer").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    }, 500);
  }
  function stopTimer() { clearInterval(timerInt); timerInt = null; }
  function startWave() {
    waveInt = setInterval(() => {
      const wave = $("#voiceWave");
      const bar = document.createElement("i");
      bar.style.height = `${6 + lastLevel * 36}px`;
      wave.append(bar);
      while (wave.children.length > 40) wave.firstChild.remove();
    }, 90);
  }
  function stopWave() { clearInterval(waveInt); waveInt = null; }

  function micBtnState() {
    const b = $("#btnMic");
    b.classList.toggle("rec", mode === "rec");
    b.classList.toggle("live", mode?.startsWith("live"));
    b.innerHTML = mode ? '<span class="ring"></span>■' : '<span class="ring"></span>🎙';
  }

  // ---------- recording (save to library) ----------
  async function startRec() {
    try {
      pcm = []; totalLen = 0;
      mode = "rec";
      await startAudio("mic");
      setStatus("RECORDING — MIC");
      startTimer(); startWave(); micBtnState();
    } catch (err) {
      mode = null; micBtnState();
      toast(`Mic error: ${err.message || err}`, "err");
    }
  }

  async function finishRec() {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    stopTimer(); stopWave();
    stopAudio();
    setStatus("SAVING…");
    const wav = encodeWav(downsample(mergePcm(pcm, totalLen), srcRate), 16000);
    const title = `Recording ${new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    try {
      const saved = await invoke("save_recording", { audioB64: b64(wav), durationSec: secs, source: "mic", title });
      toast("Recording saved — kept 30 days", "ok");
      await loadRecordings();
      // auto transcribe
      setStatus("TRANSCRIBING…");
      try {
        const res = await invoke("transcribe_audio", { audioB64: b64(wav), filename: "rec.wav", provider: null });
        if (res.text) {
          await invoke("update_recording", { id: saved.id, transcript: res.text, summary: null, title: null });
          if (S.settings.live_auto_summarize !== false && res.text.length > 80) {
            try {
              const sum = await invoke("ai_summarize", { text: res.text, instruction: null });
              await invoke("update_recording", { id: saved.id, transcript: null, summary: sum.text, title: null });
            } catch {}
          }
        }
      } catch (e) {
        toast(`Transcription: ${String(e.message || e).replace(/^"|"$/g, "")}`, "err");
      }
      await loadRecordings();
      setStatus("READY");
    } catch (err) {
      toast(`Save failed: ${err.message || err}`, "err");
      setStatus("READY");
    }
  }

  function mergePcm(chunks, len) {
    const out = new Float32Array(len);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  // ---------- live transcript ----------
  async function startLive(sourceType) {
    try {
      pcm = []; totalLen = 0;
      liveCommitted = "";
      mode = sourceType === "system" ? "live-system" : "live";
      await startAudio(sourceType);
      setStatus(sourceType === "system" ? "LIVE — MEETING AUDIO" : "LIVE — MIC");
      $("#transcriptPane").innerHTML = '<span class="t-live muted">Listening… speak or play the meeting.</span>';
      startTimer(); startWave(); micBtnState();
      const segSec = Math.max(3, +S.settings.live_segment_sec || 8);
      segTimer = setInterval(() => pushLiveSegment(), segSec * 1000);
    } catch (err) {
      mode = null; micBtnState();
      toast(`${err.message || err}`, "err");
    }
  }

  async function pushLiveSegment() {
    if (liveBusy || mode === null || mode === "rec") return;
    liveBusy = true;
    try {
      const overlapSec = Math.min(2, +S.settings.live_overlap_sec || 1.5);
      const segSamples = Math.floor(srcRate * (+S.settings.live_segment_sec || 8));
      const overlapSamples = Math.floor(srcRate * overlapSec);
      const have = totalLen;
      const from = Math.max(0, have - segSamples - overlapSamples);
      // slice from accumulated pcm
      const slice = new Float32Array(have - from);
      let o = 0;
      let remaining = from;
      for (const c of pcm) {
        if (remaining >= c.length) { remaining -= c.length; continue; }
        const take = Math.min(c.length - remaining, slice.length - o);
        slice.set(c.subarray(remaining, remaining + take), o);
        o += take;
        remaining = 0;
        if (o >= slice.length) break;
      }
      const wav = encodeWav(downsample(slice, srcRate), 16000);
      const res = await invoke("transcribe_audio", { audioB64: b64(wav), filename: "seg.wav", provider: null });
      if (res.text && res.text.trim()) {
        liveCommitted = dedupeAppend(liveCommitted, res.text.trim());
        const pane = $("#transcriptPane");
        pane.textContent = liveCommitted;
        pane.scrollTop = pane.scrollHeight;
      }
      // trim old pcm to keep memory bounded (keep last 120s)
      const maxKeep = srcRate * 130;
      if (totalLen > maxKeep) {
        const drop = totalLen - maxKeep;
        let dropped = 0; let i = 0;
        while (i < pcm.length && dropped < drop) { dropped += pcm[i].length; i++; }
        pcm = pcm.slice(i);
        totalLen -= dropped;
      }
    } catch (err) {
      const pane = $("#transcriptPane");
      const errLine = el("div", { class: "small", style: "color:var(--danger);" }, `⚠ ${String(err.message || err).replace(/^"|"$/g, "")}`);
      pane.append(errLine);
      pane.scrollTop = pane.scrollHeight;
    } finally {
      liveBusy = false;
    }
  }

  function dedupeAppend(committed, fresh) {
    if (!committed) return fresh;
    const cw = committed.split(/\s+/);
    const fw = fresh.split(/\s+/);
    const max = Math.min(cw.length, fw.length, 15);
    for (let n = max; n > 1; n--) {
      const tail = cw.slice(-n).join(" ").toLowerCase();
      const head = fw.slice(0, n).join(" ").toLowerCase();
      if (tail === head) return committed + " " + fw.slice(n).join(" ");
    }
    return committed + " " + fresh;
  }

  async function stopLive() {
    clearInterval(segTimer); segTimer = null;
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    stopTimer(); stopWave();
    stopAudio();
    const text = liveCommitted;
    const src = mode === "live-system" ? "system" : "mic";
    mode = null;
    micBtnState();
    setStatus("SAVING…");
    try {
      // save the audio we captured (full buffer may be huge; save it anyway)
      const wav = encodeWav(downsample(mergePcm(pcm, totalLen), srcRate), 16000);
      const title = `Live transcript ${new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
      const saved = await invoke("save_recording", { audioB64: b64(wav), durationSec: secs, source: src, title });
      if (text) {
        await invoke("update_recording", { id: saved.id, transcript: text, summary: null, title: null });
        if (S.settings.live_auto_summarize !== false && text.length > 80) {
          setStatus("SUMMARIZING…");
          try {
            const sum = await invoke("ai_summarize", { text, instruction: null });
            await invoke("update_recording", { id: saved.id, transcript: null, summary: sum.text, title: null });
          } catch {}
        }
      }
      await loadRecordings();
      toast("Live session saved", "ok");
    } catch (e) {
      toast(`Save: ${String(e.message || e)}`, "err");
    }
    setStatus("READY");
  }

  // ---------- recordings list ----------
  async function loadRecordings() {
    const list = $("#recList");
    list.innerHTML = "";
    const recs = await invoke("list_recordings");
    if (!recs.length) {
      list.append(el("div", { class: "wg-note-empty" }, "No recordings yet"));
    }
    for (const r of recs) {
      const card = el("div", { class: "rec-card" });
      const row1 = el("div", { class: "rc-row1" },
        el("div", { class: "rc-title", contenteditable: "false" }, r.title),
      );
      row1.append(el("button", { class: "iconbtn", title: "Make note", onclick: () => recToNote(r) }, "📝"));
      row1.append(el("button", { class: "iconbtn", title: "Delete", onclick: async () => { await invoke("delete_recording", { id: r.id }); loadRecordings(); } }, "🗑"));
      card.append(row1);
      const meta = el("div", { class: "rc-meta" },
        el("span", {}, `${Math.floor(r.durationSec / 60)}:${String(r.durationSec % 60).padStart(2, "0")}`),
        el("span", {}, r.source === "system" ? "MEETING" : "MIC"),
        el("span", {}, fmtBytes(r.size)),
        el("span", {}, fmtDate(r.createdAt)),
      );
      card.append(meta);
      try { card.append(el("audio", { controls: "", src: convertFileSrc(r.path) })); } catch {}
      if (r.transcript) card.append(el("div", { class: "rc-transcript" }, r.transcript.slice(0, 220) + (r.transcript.length > 220 ? "…" : "")));
      if (r.summary) card.append(el("div", { class: "rc-transcript", style: "color:var(--text);border-top:1px solid var(--border);padding-top:6px;" }, `✦ ${r.summary.slice(0, 220)}`));
      const acts = el("div", { class: "flex mt8" });
      if (!r.transcript) acts.append(el("button", { class: "btn sm", onclick: () => transcribeRec(r, card) }, "✦ Transcribe"));
      else if (!r.summary) acts.append(el("button", { class: "btn sm", onclick: () => summarizeRec(r) }, "✦ Summarize"));
      if (r.transcript) acts.append(el("button", { class: "btn ghost sm", onclick: () => recToNote(r) }, "→ Note"));
      if (acts.children.length) card.append(acts);
      list.append(card);
    }
  }

  async function transcribeRec(r, card) {
    toast("Transcribing…");
    try {
      // read local file via fetch on asset protocol
      const resp = await fetch(convertFileSrc(r.path));
      const buf = new Uint8Array(await resp.arrayBuffer());
      const res = await invoke("transcribe_audio", { audioB64: b64(buf), filename: "rec.wav", provider: null });
      await invoke("update_recording", { id: r.id, transcript: res.text, summary: null, title: null });
      loadRecordings();
    } catch (e) {
      toast(String(e.message || e).replace(/^"|"$/g, ""), "err");
    }
  }

  async function summarizeRec(r) {
    try {
      const sum = await invoke("ai_summarize", { text: r.transcript, instruction: null });
      await invoke("update_recording", { id: r.id, transcript: null, summary: sum.text, title: null });
      loadRecordings();
    } catch (e) {
      toast(String(e.message || e).replace(/^"|"$/g, ""), "err");
    }
  }

  async function recToNote(r) {
    const body = [r.transcript, r.summary ? `\n\nAI Summary:\n${r.summary}` : ""].join("");
    await window.createQuickNote(r.title, body || "(empty)");
    toast("Note created from recording", "ok");
  }

  // ---------- init ----------
  function init() {
    $("#btnMic").addEventListener("click", async () => {
      if (mode === null) startRec();
      else if (mode === "rec") finishRec();
      else stopLive();
    });
    $("#btnLive").addEventListener("click", () => (mode === null ? startLive("mic") : toast("Stop the current session first")));
    $("#btnLiveSystem").addEventListener("click", () => (mode === null ? startLive("system") : toast("Stop the current session first")));
    $("#btnRecRefresh").addEventListener("click", loadRecordings);
    // wire sidebar mic buttons
    for (const id of ["btnMicQuick", "railVoice"]) {
      $(`#${id}`)?.addEventListener("click", () => window.gotoVoice?.());
    }
    window.addEventListener("beforeunload", () => { if (mode) stopAudio(); });
  }

  return { init, loadRecordings, isActive, open: () => { loadRecordings(); setStatus("READY"); } };
})();
