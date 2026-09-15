// Tauri API mock for browser preview (no backend)
"use strict";

window.__TAURI__ = {
  core: {
    invoke: async (cmd, args = {}) => {
      console.log("[mock invoke]", cmd, args);
      // settings
      if (cmd === "settings_all") return { theme: "dark", font_size: 15, accent: "#d71921", user_name: "you", zoom: 100, ui_scale: 100, density: 100, dotgrid: true };
      if (cmd === "settings_set") return true;
      // spaces
      if (cmd === "list_spaces") return [{ id: "home", name: "HOME", icon: "N", color: "#d71921" }];
      if (cmd === "create_space") return { id: uid(), ...args };
      if (cmd === "update_space") return true;
      if (cmd === "delete_space") return true;
      // channels
      if (cmd === "list_channels") return [{ id: "general", name: "general", kind: "chat", topic: "Welcome to #general" }];
      if (cmd === "create_channel") return { id: uid(), ...args };
      if (cmd === "update_channel") return true;
      if (cmd === "delete_channel") return true;
      // folders
      if (cmd === "list_folders") return [];
      if (cmd === "create_folder") return { id: uid(), ...args };
      if (cmd === "update_folder") return true;
      if (cmd === "delete_folder") return true;
      // messages
      if (cmd === "list_messages") return [];
      if (cmd === "send_message") return { id: uid(), role: "user", content: args.content, mentions: args.mentions || "[]", createdAt: new Date().toISOString() };
      if (cmd === "delete_message") return true;
      if (cmd === "save_ai_message") return { id: uid(), role: "ai", content: args.content, createdAt: new Date().toISOString() };
      // notes
      if (cmd === "list_notes") return [];
      if (cmd === "get_note") return { id: args.id || uid(), title: "Untitled", contentJson: "[]", contentText: "", starred: 0, pinned: 0, words: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      if (cmd === "create_note") return { id: uid(), ...args };
      if (cmd === "update_note") return true;
      if (cmd === "trash_note") return true;
      if (cmd === "find_backlinks") return [];
      if (cmd === "list_attachments") return [];
      if (cmd === "delete_attachment") return true;
      if (cmd === "attach_to_note") return [];
      if (cmd === "import_files") return { created: [], errors: [] };
      if (cmd === "open_path") return true;
      if (cmd === "pdf_text") return { text: "[mock] PDF text extraction requires Tauri backend." };
      if (cmd === "docx_to_html") return { html: "<p>[mock] DOCX rendering requires Tauri backend.</p>" };
      // goals / tasks
      if (cmd === "list_goals") return [];
      if (cmd === "create_goal") return { id: uid(), progress: 0, status: "active", ...args };
      if (cmd === "delete_goal") return true;
      if (cmd === "list_tasks") return [];
      if (cmd === "create_task") return { id: uid(), done: 0, ...args };
      if (cmd === "update_task") return true;
      if (cmd === "delete_task") return true;
      // trash
      if (cmd === "trash_list") return {};
      if (cmd === "trash_restore") return true;
      if (cmd === "trash_purge") return true;
      if (cmd === "trash_empty") return true;
      // reminders
      if (cmd === "list_reminders") return [];
      if (cmd === "create_reminder") return { id: uid(), done: 0, ...args };
      if (cmd === "update_reminder") return true;
      if (cmd === "delete_reminder") return true;
      // ai
      if (cmd === "ai_summarize") return { text: "[AI mock] This is a preview. Connect to the Tauri backend for real AI responses." };
      if (cmd === "ai_chat") return { text: "[AI mock] This is a preview. Connect to the Tauri backend for real AI responses." };
      if (cmd === "ai_list_provider_models") return ["mock-model-1", "mock-model-2"];
      // voice / recordings
      if (cmd === "save_recording") return { id: uid(), ...args };
      if (cmd === "update_recording") return true;
      if (cmd === "list_recordings") return [];
      if (cmd === "delete_recording") return true;
      if (cmd === "transcribe_audio") return { text: "[mock] Transcription requires Tauri backend." };
      // whisper / models
      if (cmd === "whisper_cli_set_path") return true;
      if (cmd === "whisper_cli_download") return true;
      if (cmd === "whisper_status") return { cliPath: "" };
      if (cmd === "whisper_catalog") return [];
      if (cmd === "model_set_active") return true;
      if (cmd === "model_delete") return true;
      if (cmd === "model_download") return true;
      // widgets / misc
      if (cmd === "widget_toggle") return true;
      if (cmd === "export_data") return { saved: true };
      if (cmd === "import_data") return true;
      if (cmd === "app_info") return { dataDir: "/mock/data" };
      return null;
    },
    convertFileSrc: (p) => p,
  },
  event: {
    listen: async (ev, fn) => { console.log("[mock listen]", ev); },
    emit: async (ev, payload) => { console.log("[mock emit]", ev, payload); },
  },
  dialog: {
    open: async () => null,
    save: async () => null,
  },
  notification: {
    send: async () => {},
    requestPermission: async () => "granted",
  },
  globalShortcut: {
    register: async () => {},
    unregister: async () => {},
  },
  window: {
    getCurrent: () => ({
      setTitle: () => {},
      setMinSize: () => {},
      center: () => {},
    }),
  },
  path: {
    appDataDir: async () => "/mock/data",
    appLocalDataDir: async () => "/mock/local",
  },
};
