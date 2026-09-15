// DotNote — db.rs : SQLite schema + data helpers
use rusqlite::{params, Connection, Row};
use serde_json::{json, Value};
use std::path::Path;

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

pub fn init(data_dir: &Path) -> Result<Connection, String> {
    let db_path = data_dir.join("dotnote.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL").ok();
    conn.pragma_update(None, "synchronous", "NORMAL").ok();
    conn.pragma_update(None, "foreign_keys", "ON").ok();
    create_schema(&conn)?;
    Ok(conn)
}

fn create_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS spaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT NOT NULL DEFAULT '',
            color TEXT NOT NULL DEFAULT '#d71921',
            ord INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            space_id TEXT NOT NULL,
            parent_id TEXT,
            name TEXT NOT NULL,
            icon TEXT NOT NULL DEFAULT '',
            ord INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS channels (
            id TEXT PRIMARY KEY,
            space_id TEXT NOT NULL,
            name TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'chat',
            topic TEXT NOT NULL DEFAULT '',
            ord INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            space_id TEXT,
            folder_id TEXT,
            channel_id TEXT,
            title TEXT NOT NULL DEFAULT 'Untitled',
            content_json TEXT NOT NULL DEFAULT '[]',
            content_text TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '[]',
            pinned INTEGER NOT NULL DEFAULT 0,
            starred INTEGER NOT NULL DEFAULT 0,
            words INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            content TEXT NOT NULL DEFAULT '',
            mentions TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS goals (
            id TEXT PRIMARY KEY,
            space_id TEXT,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            color TEXT NOT NULL DEFAULT '#d71921',
            target_date TEXT,
            progress INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            goal_id TEXT,
            title TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            done INTEGER NOT NULL DEFAULT 0,
            priority TEXT NOT NULL DEFAULT 'normal',
            due_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL DEFAULT 'custom',
            entity_id TEXT,
            title TEXT NOT NULL,
            fire_at TEXT NOT NULL,
            repeat TEXT NOT NULL DEFAULT 'none',
            done INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            note_id TEXT,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'doc',
            size INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS recordings (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            path TEXT NOT NULL,
            duration_sec INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT 'mic',
            transcript TEXT NOT NULL DEFAULT '',
            summary TEXT NOT NULL DEFAULT '',
            size INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS focus_sessions (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL DEFAULT '',
            minutes INTEGER NOT NULL DEFAULT 25,
            started_at TEXT NOT NULL,
            ended_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_messages_chan ON messages(channel_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_reminders_fire ON reminders(done, fire_at);
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<Value> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |r| r.get::<String, _>(0),
    )
    .ok()
    .and_then(|s| serde_json::from_str(&s).ok())
}

pub fn set_setting(conn: &Connection, key: &str, value: &Value) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn default_settings() -> Vec<(&'static str, Value)> {
    vec![
        ("theme", json!("nothing-dark")),
        ("accent", json!("#d71921")),
        ("font_size", json!(15)),
        ("ui_scale", json!(100)),
        ("density", json!(100)),
        ("dotgrid", json!(true)),
        ("zoom", json!(100)),
        (
            "providers",
            json!({
                "openrouter": { "key": "", "enabled": true },
                "groq": { "key": "", "enabled": true },
                "openai": { "key": "", "enabled": true },
                "hf": { "key": "", "enabled": true },
                "ollama": { "url": "http://127.0.0.1:11434/v1", "enabled": true },
                "custom": { "url": "", "key": "", "enabled": true }
            }),
        ),
        ("default_chat_provider", json!("openrouter")),
        ("default_chat_model", json!("meta-llama/llama-3.3-70b-instruct:free")),
        ("temperature", json!(0.7)),
        ("transcribe_provider", json!("auto")),
        ("transcribe_model_groq", json!("whisper-large-v3-turbo")),
        ("transcribe_model_openai", json!("whisper-1")),
        ("transcribe_model_custom", json!("whisper-1")),
        ("transcribe_model_hf", json!("openai/whisper-large-v3")),
        ("live_segment_sec", json!(8)),
        ("live_overlap_sec", json!(1.5)),
        ("voice_retention_days", json!(30)),
        ("live_auto_summarize", json!(true)),
        ("active_whisper_model", json!("")),
        ("whisper_cli_path", json!("")),
        (
            "widgets",
            json!({
                "quicknote": { "enabled": true, "always_on_top": true, "w": 320, "h": 400 },
                "tasks": { "enabled": false, "always_on_top": true, "w": 320, "h": 460 },
                "clock": { "enabled": false, "always_on_top": true, "w": 300, "h": 360 },
                "focus": { "enabled": false, "always_on_top": true, "w": 300, "h": 380 }
            }),
        ),
        (
            "shortcuts",
            json!({
                "quicknote": "alt+space",
                "new_note": "alt+n",
                "toggle_main": "alt+m",
                "focus_widget": "alt+f",
                "tasks_widget": "alt+g",
                "clock_widget": "alt+c"
            }),
        ),
        ("focus_minutes", json!(25)),
        ("focus_break_minutes", json!(5)),
        ("user_name", json!("you")),
        ("chat_provider_models", json!({})),
    ]
}

pub fn seed_defaults(conn: &Connection) -> Result<(), String> {
    for (k, v) in default_settings() {
        if get_setting(conn, k).is_none() {
            set_setting(conn, k, &v)?;
        }
    }
    // first-run: create a Home space + starter channels
    let has_space: i64 = conn.query_row("SELECT COUNT(*) FROM spaces", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if has_space == 0 {
        let sid = new_id();
        conn.execute(
            "INSERT INTO spaces(id, name, icon, color, ord, created_at) VALUES(?1,?2,?3,?4,0,?5)",
            params![sid, "Home", "\u{25CF}", "#d71921", now_iso()],
        )
        .map_err(|e| e.to_string())?;
        for (name, kind, ord) in [("general", "chat", 0), ("ideas", "chat", 1), ("daily-notes", "notes", 2)] {
            conn.execute(
                "INSERT INTO channels(id, space_id, name, kind, ord, created_at) VALUES(?1,?2,?3,?4,?5,?6)",
                params![new_id(), sid, name, kind, ord, now_iso()],
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute(
            "INSERT INTO folders(id, space_id, name, ord, created_at) VALUES(?1,?2,?3,0,?4)",
            params![new_id(), sid, "Personal", now_iso()],
        )
        .map_err(|e| e.to_string())?;
        // welcome note
        let nid = new_id();
        let blocks = json!([
            {"id": new_id(), "type":"h1", "html":"Welcome to DotNote \u{25CF}"},
            {"id": new_id(), "type":"p", "html":"A quiet, <b>mono</b> place for your notes, channels, voice &amp; AI."},
            {"id": new_id(), "type":"callout", "html":"Press <b>Ctrl+K</b> for the command palette. Press <b>Ctrl+,</b> for Settings."},
            {"id": new_id(), "type":"h2", "html":"Quick start"},
            {"id": new_id(), "type":"todo", "html":"Type <b>/</b> in a new line for the block menu"},
            {"id": new_id(), "type":"todo", "html":"Right-click any block for color, size &amp; more"},
            {"id": new_id(), "type":"todo", "html":"Add your AI keys in <b>Settings \u{2192} AI Providers</b>"},
            {"id": new_id(), "type":"todo", "html":"Download a whisper model in <b>Settings \u{2192} Models</b>"},
            {"id": new_id(), "type":"quote", "html":"Stay minimal. Stay focused."}
        ])
        .to_string();
        conn.execute(
            "INSERT INTO notes(id, space_id, title, content_json, content_text, words, created_at, updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",
            params![nid, sid, "Welcome", blocks,
                "Welcome to DotNote. A quiet mono place for your notes channels voice and AI. Quick start...", 18, now_iso()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---- row -> json helpers -------------------------------------------------
pub fn row_note(r: &Row) -> Result<Value, rusqlite::Error> {
    Ok(json!({
        "id": r.get::<String, _>("id")?,
        "spaceId": r.get::<Option<String>, _>("space_id")?,
        "folderId": r.get::<Option<String>, _>("folder_id")?,
        "channelId": r.get::<Option<String>, _>("channel_id")?,
        "title": r.get::<String, _>("title")?,
        "contentJson": r.get::<String, _>("content_json")?,
        "contentText": r.get::<String, _>("content_text")?,
        "tags": r.get::<String, _>("tags")?,
        "pinned": r.get::<i64, _>("pinned")?,
        "starred": r.get::<i64, _>("starred")?,
        "words": r.get::<i64, _>("words")?,
        "createdAt": r.get::<String, _>("created_at")?,
        "updatedAt": r.get::<String, _>("updated_at")?,
        "deletedAt": r.get::<Option<String>, _>("deleted_at")?
    }))
}

pub fn row_task(r: &Row) -> Result<Value, rusqlite::Error> {
    Ok(json!({
        "id": r.get::<String, _>("id")?,
        "goalId": r.get::<Option<String>, _>("goal_id")?,
        "title": r.get::<String, _>("title")?,
        "notes": r.get::<String, _>("notes")?,
        "done": r.get::<i64, _>("done")?,
        "priority": r.get::<String, _>("priority")?,
        "dueAt": r.get::<Option<String>, _>("due_at")?,
        "createdAt": r.get::<String, _>("created_at")?,
        "updatedAt": r.get::<String, _>("updated_at")?
    }))
}

pub fn row_reminder(r: &Row) -> Result<Value, rusqlite::Error> {
    Ok(json!({
        "id": r.get::<String, _>("id")?,
        "entityType": r.get::<String, _>("entity_type")?,
        "entityId": r.get::<Option<String>, _>("entity_id")?,
        "title": r.get::<String, _>("title")?,
        "fireAt": r.get::<String, _>("fire_at")?,
        "repeat": r.get::<String, _>("repeat")?,
        "done": r.get::<i64, _>("done")?,
        "createdAt": r.get::<String, _>("created_at")?
    }))
}

pub fn row_goal(r: &Row) -> Result<Value, rusqlite::Error> {
    Ok(json!({
        "id": r.get::<String, _>("id")?,
        "spaceId": r.get::<Option<String>, _>("space_id")?,
        "title": r.get::<String, _>("title")?,
        "description": r.get::<String, _>("description")?,
        "color": r.get::<String, _>("color")?,
        "targetDate": r.get::<Option<String>, _>("target_date")?,
        "progress": r.get::<i64, _>("progress")?,
        "status": r.get::<String, _>("status")?,
        "createdAt": r.get::<String, _>("created_at")?,
        "updatedAt": r.get::<String, _>("updated_at")?
    }))
}

pub fn soft_delete(conn: &Connection, table: &str, id: &str) -> Result<(), String> {
    // table names come only from our own code — whitelisted below by caller
    conn.execute(
        &format!("UPDATE {} SET deleted_at = ?1 WHERE id = ?2", table),
        params![now_iso(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn restore(conn: &Connection, table: &str, id: &str) -> Result<(), String> {
    conn.execute(
        &format!("UPDATE {} SET deleted_at = NULL WHERE id = ?1", table),
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
