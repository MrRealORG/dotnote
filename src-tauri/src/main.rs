// DotNote — main.rs : app entry, tray, widgets, global shortcuts
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cmds_ai;
mod cmds_core;
mod db;
mod files;
mod scheduler;

use serde_json::json;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub data_dir: PathBuf,
}

const WIDGETS: [(&str, &str, f64, f64); 4] = [
    ("quicknote", "Quick Note", 340.0, 420.0),
    ("tasks", "Tasks", 330.0, 480.0),
    ("clock", "Clock", 320.0, 380.0),
    ("focus", "Focus", 320.0, 400.0),
];

// ---------- widget windows ----------
fn create_widget(app: &AppHandle, key: &str) -> Result<(), String> {
    let label = format!("widget-{}", key);
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }
    let state = app.state::<AppState>();
    let cfg = {
        let conn = state.db.lock().unwrap();
        db::get_setting(&conn, "widgets").unwrap_or(json!({}))
    };
    let wcfg = cfg.get(key).cloned().unwrap_or(json!({}));
    let w = wcfg["w"].as_f64().unwrap_or(320.0);
    let h = wcfg["h"].as_f64().unwrap_or(400.0);
    let top = wcfg["always_on_top"].as_bool().unwrap_or(true);
    let title = WIDGETS
        .iter()
        .find(|(k, _, _, _)| *k == key)
        .map(|(_, t, _, _)| *t)
        .unwrap_or("Widget");

    let url = format!("widget.html?w={}", key);
    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title(format!("DotNote — {}", title))
        .inner_size(w, h)
        .min_inner_size(220.0, 190.0)
        .resizable(true)
        .maximizable(false)
        .always_on_top(top)
        .skip_taskbar(true)
        .decorations(true)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

pub fn toggle_widget(app: &AppHandle, key: &str) {
    let label = format!("widget-{}", key);
    if let Some(win) = app.get_webview_window(&label) {
        let visible = win.is_visible().unwrap_or(false);
        if visible {
            let _ = win.hide();
        } else {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
        return;
    }
    let app2 = app.clone();
    let key2 = key.to_string();
    let _ = app.run_on_main_thread(move || {
        if let Err(e) = create_widget(&app2, &key2) {
            eprintln!("widget create failed: {}", e);
        }
    });
}

pub fn sync_widgets(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let cfg = {
        let conn = state.db.lock().unwrap();
        db::get_setting(&conn, "widgets").unwrap_or(json!({}))
    };
    for (key, _, _, _) in WIDGETS {
        let enabled = cfg[key]["enabled"].as_bool().unwrap_or(false);
        let label = format!("widget-{}", key);
        let exists = app.get_webview_window(&label).is_some();
        if enabled && !exists {
            create_widget(app, key)?;
        } else if !enabled {
            if let Some(win) = app.get_webview_window(&label) {
                let _ = win.close();
            }
        }
    }
    Ok(())
}

// ---------- global shortcuts ----------
fn handle_action(app: &AppHandle, action: &str) {
    match action {
        "quicknote" => toggle_widget(app, "quicknote"),
        "focus" => toggle_widget(app, "focus"),
        "tasks" => toggle_widget(app, "tasks"),
        "clock" => toggle_widget(app, "clock"),
        "new-note" => {
            show_main(app);
            let _ = app.emit("tray-action", json!({ "action": "new-note" }));
        }
        "toggle-main" => {
            if let Some(w) = app.get_webview_window("main") {
                let vis = w.is_visible().unwrap_or(false);
                if vis {
                    let _ = w.hide();
                } else {
                    show_main(app);
                }
            }
        }
        _ => {}
    }
}

pub fn apply_global_shortcuts(app: &AppHandle) {
    let state = app.state::<AppState>();
    let shortcuts = {
        let conn = state.db.lock().unwrap();
        db::get_setting(&conn, "shortcuts").unwrap_or(json!({}))
    };
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let defs: [(&str, &str); 6] = [
        ("quicknote", "quicknote"),
        ("new_note", "new-note"),
        ("toggle_main", "toggle-main"),
        ("focus_widget", "focus"),
        ("tasks_widget", "tasks"),
        ("clock_widget", "clock"),
    ];
    for (setting_key, action) in defs {
        let combo = shortcuts
            .get(setting_key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if combo.is_empty() {
            continue;
        }
        let act = action.to_string();
        if let Err(e) = gs.on_shortcut(combo.as_str(), move |app: &AppHandle, _sc, event| {
            if event.state == ShortcutState::Pressed {
                handle_action(app, &act);
            }
        }) {
            eprintln!("global shortcut '{}' failed: {}", combo, e);
        }
    }
}

// ---------- tray ----------
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> Result<(), String> {
    let mk = |id: &str, label: &str| -> Result<MenuItem<tauri::Wry>, String> {
        MenuItem::with_id(app, id, label, true, None::<&str>).map_err(|e| e.to_string())
    };
    let open = mk("open", "Open DotNote")?;
    let quick = mk("quicknote", "Quick Note")?;
    let newnote = mk("newnote", "New Note")?;
    let settings = mk("settings", "Settings")?;
    let quit = mk("quit", "Quit")?;
    let menu = Menu::with_items(app, &[&open, &quick, &newnote, &settings, &quit])
        .map_err(|e| e.to_string())?;

    TrayIconBuilder::with_id("dotnote-tray")
        .icon(app.default_window_icon().cloned().ok_or("no app icon")?)
        .tooltip("DotNote")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quicknote" => toggle_widget(app, "quicknote"),
            "newnote" => {
                show_main(app);
                let _ = app.emit("tray-action", json!({ "action": "new-note" }));
            }
            "settings" => {
                show_main(app);
                let _ = app.emit("tray-action", json!({ "action": "settings" }));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            // core
            cmds_core::app_info,
            cmds_core::settings_all,
            cmds_core::settings_set,
            cmds_core::list_spaces,
            cmds_core::create_space,
            cmds_core::update_space,
            cmds_core::delete_space,
            cmds_core::list_channels,
            cmds_core::create_channel,
            cmds_core::update_channel,
            cmds_core::delete_channel,
            cmds_core::list_folders,
            cmds_core::create_folder,
            cmds_core::update_folder,
            cmds_core::delete_folder,
            cmds_core::list_notes,
            cmds_core::get_note,
            cmds_core::create_note,
            cmds_core::update_note,
            cmds_core::trash_note,
            cmds_core::restore_note,
            cmds_core::purge_note,
            cmds_core::find_backlinks,
            cmds_core::save_quick_note,
            cmds_core::list_messages,
            cmds_core::send_message,
            cmds_core::save_ai_message,
            cmds_core::delete_message,
            cmds_core::list_goals,
            cmds_core::create_goal,
            cmds_core::update_goal,
            cmds_core::delete_goal,
            cmds_core::list_tasks,
            cmds_core::create_task,
            cmds_core::update_task,
            cmds_core::delete_task,
            cmds_core::list_reminders,
            cmds_core::create_reminder,
            cmds_core::update_reminder,
            cmds_core::delete_reminder,
            cmds_core::trash_list,
            cmds_core::trash_restore,
            cmds_core::trash_purge,
            cmds_core::trash_empty,
            cmds_core::attach_to_note,
            cmds_core::list_attachments,
            cmds_core::delete_attachment,
            cmds_core::open_path,
            cmds_core::export_data,
            cmds_core::import_data,
            cmds_core::widget_toggle,
            cmds_core::widgets_state,
            // ai
            cmds_ai::ai_chat,
            cmds_ai::ai_list_provider_models,
            cmds_ai::ai_summarize,
            cmds_ai::whisper_catalog,
            cmds_ai::whisper_status,
            cmds_ai::model_download,
            cmds_ai::model_delete,
            cmds_ai::model_set_active,
            cmds_ai::whisper_cli_download,
            cmds_ai::whisper_cli_set_path,
            cmds_ai::transcribe_audio,
            cmds_ai::save_recording,
            cmds_ai::list_recordings,
            cmds_ai::update_recording,
            cmds_ai::delete_recording,
            // files
            files::import_files,
            files::docx_to_html,
            files::pdf_text
        ])
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("cannot resolve app data dir");
            for d in ["attachments", "recordings", "models", "whisper", "exports"] {
                std::fs::create_dir_all(data_dir.join(d)).ok();
            }
            let conn = db::init(&data_dir).expect("database init failed");
            db::seed_defaults(&conn).expect("database seed failed");
            app.manage(AppState {
                db: Mutex::new(conn),
                data_dir,
            });
            scheduler::start(app.handle().clone());
            if let Err(e) = build_tray(app.handle()) {
                eprintln!("tray: {}", e);
            }
            apply_global_shortcuts(app.handle());
            if let Err(e) = sync_widgets(app.handle()) {
                eprintln!("widgets: {}", e);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running dotnote");
}
