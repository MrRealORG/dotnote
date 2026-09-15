// Tauri API mock for browser preview (no backend)
"use strict";

window.__TAURI__ = {
  core: {
    invoke: async (cmd, args = {}) => {
      console.log("[mock invoke]", cmd, args);
      // settings
      if (cmd === "settings_all") return { theme: "dark", fontSize: 14, accentColor: "#888" };
      if (cmd === "settings_set") return true;
      // spaces
      if (cmd === "list_spaces") return [{ id: "home", name: "HOME", icon: "N", color: "#d71921" }];
      if (cmd === "create_space") return { id: uid(), ...args };
      if (cmd === "update_space") return true;
      if (cmd === "delete_space") return true;
      // channels
      if (cmd === "list_channels") return [{ id: "general", name: "general", kind: "chat", topic: "General channel" }];
      if (cmd === "create_channel") return { id: uid(), ...args };
      if (cmd === "update_channel") return true;
      if (cmd === "delete_channel") return true;
      // folders
      if (cmd === "list_folders") return [];
      if (cmd === "create_folder") return { id: uid(), ...args };
      if (cmd === "update_folder") return true;
      if (cmd === "delete_folder") return true;
      // notes
      if (cmd === "list_notes") return [];
      if (cmd === "get_note") return { id: args.id || uid(), title: "Untitled", contentJson: "[]", contentText: "", starred: 0, pinned: 0, words: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      if (cmd === "create_note") return { id: uid(), ...args };
      if (cmd === "update_note") return true;
      if (cmd === "trash_note") return true;
      if (cmd === "find_backlinks") return [];
      if (cmd === "list_attachments") return [];
      // goals / tasks
      if (cmd === "goals_list") return [];
      if (cmd === "create_task") return { id: uid(), ...args };
      // files
      if (cmd === "files_list") return [];
      // trash
      if (cmd === "trash_list") return [];
      // reminders
      if (cmd === "list_reminders") return [];
      if (cmd === "create_reminder") return { id: uid(), ...args };
      if (cmd === "update_reminder") return true;
      if (cmd === "delete_reminder") return true;
      // ai
      if (cmd === "ai_summarize") return { text: "[AI mock response] This is a preview. Connect to the Tauri backend for real AI." };
      // voice
      if (cmd === "voice_start") return true;
      if (cmd === "voice_stop") return true;
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
