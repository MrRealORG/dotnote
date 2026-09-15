// DotNote — cmds_core.rs : core CRUD commands
use crate::db;
use crate::AppState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

fn lock<'a>(state: &'a State<AppState>) -> std::sync::MutexGuard<'a, rusqlite::Connection> {
    state.db.lock().unwrap()
}

// ---------- app info / settings ----------
#[tauri::command]
pub fn app_info(state: State<AppState>) -> Value {
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "dataDir": state.data_dir.to_string_lossy().to_string(),
        "os": std::env::consts::OS
    })
}

#[tauri::command]
pub fn settings_all(state: State<AppState>) -> Result<Value, String> {
    let conn = lock(&state);
    let mut stmt = conn.prepare("SELECT key, value FROM settings").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<String, _>(0)?, r.get::<String, _>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut out = serde_json::Map::new();
    for row in rows {
        let (k, v) = row.map_err(|e| e.to_string())?;
        out.insert(k, serde_json::from_str(&v).unwrap_or(Value::String(v)));
    }
    Ok(Value::Object(out))
}

#[tauri::command]
pub fn settings_set(
    app: AppHandle,
    state: State<AppState>,
    key: String,
    value: Value,
) -> Result<(), String> {
    {
        let conn = lock(&state);
        db::set_setting(&conn, &key, &value)?;
    }
    if key == "widgets" {
        crate::sync_widgets(&app)?;
    }
    if key == "shortcuts" {
        crate::apply_global_shortcuts(&app);
    }
    Ok(())
}

// ---------- spaces ----------
#[tauri::command]
pub fn list_spaces(state: State<AppState>) -> Result<Value, String> {
    let conn = lock(&state);
    let mut stmt = conn
        .prepare("SELECT id, name, icon, color, ord, created_at FROM spaces ORDER BY ord, created_at")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<String, _>(0)?, "name": r.get::<String, _>(1)?,
                "icon": r.get::<String, _>(2)?, "color": r.get::<String, _>(3)?,
                "ord": r.get::<i64, _>(4)?, "createdAt": r.get::<String, _>(5)?
            }))
        })
        .map_err(|e| e.to_string())?;
    let list: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!(list))
}

#[tauri::command]
pub fn create_space(state: State<AppState>, name: String, icon: String, color: String) -> Result<Value, String> {
    let conn = lock(&state);
    let id = db::new_id();
    conn.execute(
        "INSERT INTO spaces(id, name, icon, color, ord, created_at) VALUES(?1,?2,?3,?4,
         (SELECT COALESCE(MAX(ord),-1)+1 FROM spaces), ?5)",
        params![id, name, icon, color, db::now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id, "name": name, "icon": icon, "color": color }))
}

#[tauri::command]
pub fn update_space(state: State<AppState>, id: String, name: String, icon: String, color: String) -> Result<(), String> {
    let conn = lock(&state);
    conn.execute(
        "UPDATE spaces SET name=?1, icon=?2, color=?3 WHERE id=?4",
        params![name, icon, color, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_space(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = lock(&state);
    let now = db::now_iso();
    for sql in [
        "UPDATE notes SET deleted_at=?1 WHERE space_id=?2",
        "UPDATE channels SET deleted_at=?1 WHERE space_id=?2",
        "UPDATE folders SET deleted_at=?1 WHERE space_id=?2",
        "DELETE FROM messages WHERE channel_id IN (SELECT id FROM channels WHERE space_id=?2)",
        "DELETE FROM spaces WHERE id=?2",
    ] {
        conn.execute(sql, params![now, id]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- channels ----------
#[tauri::command]
pub fn list_channels(state: State<AppState>, space_id: String) -> Result<Value, String> {
    let conn = lock(&state);
    let mut stmt = conn
        .prepare("SELECT id, space_id, name, kind, topic, ord, created_at FROM channels WHERE space_id=?1 AND deleted_at IS NULL ORDER BY kind, ord, created_at")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![space_id], |r| {
            Ok(json!({
                "id": r.get::<String, _>(0)?, "spaceId": r.get::<String, _>(1)?,
                "name": r.get::<String, _>(2)?, "kind": r.get::<String, _>(3)?,
                "topic": r.get::<String, _>(4)?, "ord": r.get::<i64, _>(5)?,
                "createdAt": r.get::<String, _>(6)?
            }))
        })
        .map_err(|e| e.to_string())?;
    let list: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!(list))
}

#[tauri::command]
pub fn create_channel(state: State<AppState>, space_id: String, name: String, kind: String, topic: String) -> Result<Value, String> {
    let conn = lock(&state);
    let id = db::new_id();
    conn.execute(
        "INSERT INTO channels(id, space_id, name, kind, topic, ord, created_at) VALUES(?1,?2,?3,?4,?5,
         (SELECT COALESCE(MAX(ord),-1)+1 FROM channels WHERE space_id=?2 AND kind=?4), ?6)",
        params![id, space_id, name, kind, topic, db::now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id, "spaceId": space_id, "name": name, "kind": kind, "topic": topic }))
}

#[tauri::command]
pub fn update_channel(state: State<AppState>, id: String, name: String, topic: String) -> Result<(), String> {
    let conn = lock(&state);
    conn.execute("UPDATE channels SET name=?1, topic=?2 WHERE id=?3", params![name, topic, id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_channel(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = lock(&state);
    let now = db::now_iso();
    conn.execute("UPDATE channels SET deleted_at=?1 WHERE id=?2", params![now, id])
        .map_err(|e| e.to_string())?;
    conn.execute("UPDATE notes SET deleted_at=?1 WHERE channel_id=?2", params![now, id])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE messages SET deleted_at=?1 WHERE channel_id=?2",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- folders ----------
#[tauri::command]
pub fn list_folders(state: State<AppState>, space_id: String) -> Result<Value, String> {
    let conn = lock(&state);
    let mut stmt = conn
        .prepare("SELECT id, space_id, parent_id, name, icon, ord, created_at FROM folders WHERE space_id=?1 AND deleted_at IS NULL ORDER BY ord, created_at")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![space_id], |r| {
            Ok(json!({
                "id": r.get::<String, _>(0)?, "spaceId": r.get::<String, _>(1)?,
                "parentId": r.get::<Option<String>, _>(2)?, "name": r.get::<String, _>(3)?,
                "icon": r.get::<String, _>(4)?, "ord": r.get::<i64, _>(5)?,
                "createdAt": r.get::<String, _>(6)?
            }))
        })
        .map_err(|e| e.to_string())?;
    let list: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!(list))
}

#[tauri::command]
pub fn create_folder(state: State<AppState>, space_id: String, parent_id: Option<String>, name: String, icon: String) -> Result<Value, String> {
    let conn = lock(&state);
    let id = db::new_id();
    conn.execute(
        "INSERT INTO folders(id, space_id, parent_id, name, icon, ord, created_at) VALUES(?1,?2,?3,?4,?5,0,?6)",
        params![id, space_id, parent_id, name, icon, db::now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id, "spaceId": space_id, "parentId": parent_id, "name": name, "icon": icon }))
}

#[tauri::command]
pub fn update_folder(state: State<AppState>, id: String, name: String, icon: String) -> Result<(), String> {
    let conn = lock(&state);
    conn.execute("UPDATE folders SET name=?1, icon=?2 WHERE id=?3", params![name, icon, id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_folder(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = lock(&state);
    let now = db::now_iso();
    conn.execute("UPDATE folders SET deleted_at=?1 WHERE id=?2", params![now, id])
        .map_err(|e| e.to_string())?;
    conn.execute("UPDATE notes SET deleted_at=?1 WHERE folder_id=?2", params![now, id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- notes ----------
#[tauri::command]
pub fn list_notes(state: State<AppState>, scope: String, id: Option<String>, query: Option<String>) -> Result<Value, String> {
    let conn = lock(&state);
    let (sql, args): (String, Vec<String>) = match scope.as_str() {
        "space" => (
            "SELECT * FROM notes WHERE space_id=?1 AND deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC".into(),
            vec![id.unwrap_or_default()],
        ),
        "folder" => (
            "SELECT * FROM notes WHERE folder_id=?1 AND deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC".into(),
            vec![id.unwrap_or_default()],
        ),
        "channel" => (
            "SELECT * FROM notes WHERE channel_id=?1 AND deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC".into(),
            vec![id.unwrap_or_default()],
        ),
        "starred" => (
            "SELECT * FROM notes WHERE starred=1 AND deleted_at IS NULL ORDER BY updated_at DESC".into(),
            vec![],
        ),
        "recent" => (
            "SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 30".into(),
            vec![],
        ),
        "search" => {
            let q = format!("%{}%", query.unwrap_or_default());
            (
                "SELECT * FROM notes WHERE deleted_at IS NULL AND (title LIKE ?1 OR content_text LIKE ?1) ORDER BY updated_at DESC LIMIT 60".into(),
                vec![q],
            )
        }
        _ => (
            "SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 60".into(),
            vec![],
        ),
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params_ref: Vec<&dyn rusqlite::ToSql> =
        args.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let rows = stmt
        .query_map(params_ref.as_slice(), db::row_note)
        .map_err(|e| e.to_string())?;
    let list: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!(list))
}

#[tauri::command]
pub fn get_note(state: State<AppState>, id: String) -> Result<Value, String> {
    let conn = lock(&state);
    conn.query_row("SELECT * FROM notes WHERE id=?1", params![id], db::row_note)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(
    state: State<AppState>,
    space_id: Option<String>,
    folder_id: Option<String>,
    channel_id: Option<String>,
    title: String,
    content_json: String,
    content_text: String,
    tags: Option<String>,
) -> Result<Value, String> {
    let conn = lock(&state);
    let id = db::new_id();
    let words: i64 = content_text.split_whitespace().count() as i64;
    conn.execute(
        "INSERT INTO notes(id, space_id, folder_id, channel_id, title, content_json, content_text, tags, words, created_at, updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
        params![
            id, space_id, folder_id, channel_id,
            if title.trim().is_empty() { "Untitled" } else { title.as_str() },
            content_json, content_text, tags.unwrap_or_else(|| "[]".into()), words, db::now_iso()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id }))
}

#[tauri::command]
pub fn update_note(
    state: State<AppState>,
    id: String,
    title: Option<String>,
    content_json: Option<String>,
    content_text: Option<String>,
    tags: Option<String>,
    pinned: Option<i64>,
    starred: Option<i64>,
    folder_id: Option<String>,
    space_id: Option<String>,
    channel_id: Option<String>,
) -> Result<(), String> {
    let conn = lock(&state);
    let words = content_text
        .as_ref()
        .map(|t| t.split_whitespace().count() as i64);
    if let Some(t) = content_text.as_ref() {
        conn.execute(
            "UPDATE notes SET content_text=?1, words=?2, updated_at=?3 WHERE id=?4",
            params![t, words, db::now_iso(), id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(cj) = content_json {
        conn.execute("UPDATE notes SET content_json=?1, updated_at=?2 WHERE id=?3", params![cj, db::now_iso(), id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(t) = title {
        conn.execute("UPDATE notes SET title=?1, updated_at=?2 WHERE id=?3", params![t, db::now_iso(), id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(t) = tags {
        conn.execute("UPDATE notes SET tags=?1 WHERE id=?2", params![t, id]).map_err(|e| e.to_string())?;
    }
    if let Some(p) = pinned {
        conn.execute("UPDATE notes SET pinned=?1 WHERE id=?2", params![p, id]).map_err(|e| e.to_string())?;
    }
    if let Some(s) = starred {
        conn.execute("UPDATE notes SET starred=?1 WHERE id=?2", params![s, id]).map_err(|e| e.to_string())?;
    }
    if let Some(f) = folder_id {
        conn.execute("UPDATE notes SET folder_id=?1 WHERE id=?2", params![f, id]).map_err(|e| e.to_string())?;
    }
    if let Some(s) = space_id {
        conn.execute("UPDATE notes SET space_id=?1 WHERE id=?2", params![s, id]).map_err(|e| e.to_string())?;
    }
    if let Some(c) = channel_id {
        conn.execute("UPDATE notes SET channel_id=?1 WHERE id=?2", params![c, id]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn trash_note(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = lock(&state);
    db::soft_delete(&conn, "notes", &id)
}

#[tauri::command]
pub fn restore_note(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = lock(&state);
    db::restore(&conn, "notes", &id)
}

#[tauri::command]
pub fn purge_note(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = lock(&state);
    conn.execute("DELETE FROM notes WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    conn.execute("UPDATE attachments SET deleted_at=?1 WHERE note_id=?2", params![db::now_iso(), id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn find_backlinks(state: State<AppState>, title: String) -> Result<Value, String> {
    let conn = lock(&state);
    let pat = format!("%[[{}]]%", title);
    let mut stmt = conn
        .prepare("SELECT id, title, updated_at FROM notes WHERE deleted_at IS NULL AND content_text LIKE ?1 LIMIT 30")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![pat], |r| {
            Ok(json!({ "id": r.get::<String,_>(0)?, "title": r.get::<String,_>(1)?, "updatedAt": r.get::<String,_>(2)? }))
        })
        .map_err(|e| e.to_string())?;
    let list: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!(list))
}

#[tauri::command]
pub fn save_quick_note(state: State<AppState>, text: String) -> Result<Value, String> {
    let conn = lock(&state);
    let sid: Option<String> = conn.query_row("SELECT id FROM spaces ORDER BY ord LIMIT 1", [], |r| r.get(0)).ok();
    let id = db::new_id();
    let first_line = text.lines().next().unwrap_or("Quick note").trim().to_string();
    let title = if first_line.is_empty() { "Quick note".to_string() } else { first_line.chars().take(60).collect() };
    let blocks = json!([{ "id": db::new_id(), "type": "p", "html": text.replace('\n', "<br>") }]).to_string();
    let words: i64 = text.split_whitespace().count() as i64;
    conn.execute(
        "INSERT INTO notes(id, space_id, title, content_json, content_text, words, created_at, updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",
        params![id, sid, title, blocks, text, words, db::now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id, "title": title }))
}

// ---------- messages (channel chat) ----------
#[tauri::command]
pub fn list_messages(state: State<AppState>, channel_id: String) -> Result<Value, String> {
    let conn = lock(&state);
    let mut stmt = conn
        .prepare("SELECT id, channel_id, role, content, mentions, created_at FROM messages WHERE channel_id=?1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 300")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![channel_id], |r| {
            Ok(json!({
                "id": r.get::<String,_>(0)?, "channelId": r.get::<String,_>(1)?,
                "role": r.get::<String,_>(2)?, "content": r.get::<String,_>(3)?,
                "mentions": r.get::<String,_>(4)?, "createdAt": r.get::<String,_>(5)?
            }))
        })
        .map_err(|e| e.to_string())?;
    let list: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!(list))
}

#[tauri::command]
pub fn send_message(state: State<AppState>, channel_id: String, content: String, mentions: String) -> Result<Value, String> {
    let conn = lock(&state);
    let id = db::new_id();
    conn.execute(
        "INSERT INTO messages(id, channel_id, role, content, mentions, created_at) VALUES(?1,?2,'user',?3,?4,?5)",
        params![id, channel_id, content, mentions, db::now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id, "channelId": channel_id, "role": "user", "content": content, "mentions": mentions, "createdAt": db::now_iso() }))
}

#[tauri::command]
pub fn save_ai_message(state: State<AppState>, channel_id: String, content: String) -> Result<Value, String> {
    let conn = lock(&state);
    let id = db::new_id();
    conn.execute(
        "INSERT INTO messages(id, channel_id, role, content, mentions, created_at) VALUES(?1,?2,'ai',?3,'[]',?4)",
        params![id, channel_id, content, db::now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id, "role": "ai", "content": content, "createdAt": db::now_iso() }))
}

#[tauri::command]
pub fn delete_message(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = lock(&state);
    db::soft_delete(&conn, "messages", &id)
}

// ---------- goals & tasks ----------
#[tauri::command]
pub fn list_goals(state: State<AppState>) -> Result<Value, String> {
    let conn = lock(&state);
    let mut stmt = conn
        .prepare("SELECT id, space_id, title, description, color, target_date, progress, status, created_at, updated_at FROM goals WHERE deleted_at IS NULL ORDER BY status, created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], db::row_goal).map_err(|e| e.to_string())?;
    let list: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!(list))
}

#[tauri::command]
pub fn create_goal(state: State<AppState>, title: String, description: String, color: String, target_date: Option<String>) -> Result<Value, String> {
    let conn = lock(&state);
    let id = db::new_id();
    conn.execute(
        "INSERT INTO goals(id, title, description, color, target_date, progress, status, created_at, updated_at)
         VALUES(?1,?2,?3,?4,?5,0,'active',?6,?6)",
        params![id, title, description, color, target_date, db::now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id }))
}

#[tauri::command]
pub fn update_goal(state: State<AppState>, id: String, title: Option<String>, description: Option<String>, color: Option<String>, target_date: Option<String>, progress: Option<i64>, status: Option<String>) -> Result<(), String> {
    let conn = lock(&state);
    if let Some(v) = title { conn.execute("UPDATE goals SET title=?1, updated_at=?2 WHERE id=?3", params![v, db::now_iso(), id]).map_err(|e| e.to_string())?; }
    if let Some(v) = description { conn.execute("UPDATE goals SET description=?1, updated_at=?2 WHERE id=?3", params![v, db::now_iso(), id]).map_err(|e| e.to_string())?; }
    if let Some(v) = color { conn.execute("UPDATE goals SET color=?1 WHERE id=?2", params![v, id]).map_err(|e| e.to_string())?; }
    if let Some(v) = target_date { conn.execute("UPDATE goals SET target_date=?1 WHERE id=?2", params![v, id]).map_err(|e| e.to_string())?; }
    if let Some(v) = progress {
        conn.execute("UPDATE goals SET progress=?1, updated_at=?2 WHERE id=?3", params![v, db::now_iso(), id]).map_err(|e| e.to_string())?;
        if v >= 100 { conn.execute("UPDATE goals SET status='done', updated_at=?1 WHERE id=?2", params![db::now_iso(), id]).map_err(|e| e.to_string())?; }
    }
    if let Some(v) = status { conn.execute("UPDATE goals SET status=?1, updated_at=?2 WHERE id=?3", params![v, db::now_iso(), id]).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn delete_goal(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = lock(&state);
    db::soft_delete(&conn, "goals", &id)
}

#[tauri::command]
pub fn list_tasks(state: State<AppState>, goal_id: Option<String>, scope: Option<String>) -> Result<Value, String> {
    let conn = lock(&state);
    let (sql, arg): (String, Option<String>) = match scope.as_deref() {
        Some("today") => (
            "SELECT * FROM tasks WHERE deleted_at IS NULL AND done=0 AND (due_at IS NOT NULL AND date(due_at)<=date('now')) ORDER BY due_at".into(),
            None,
        ),
        Some("open") => (
            "SELECT * FROM tasks WHERE deleted_at IS NULL AND done=0 ORDER BY due_at IS NULL, due_at, created_at DESC".into(),
            None,
        ),
        _ => match &goal_id {
            Some(g) => ("SELECT * FROM tasks WHERE goal_id=?1 AND deleted_at IS NULL ORDER BY done, created_at DESC".into(), Some(g.clone())),
            None => ("SELECT * FROM tasks WHERE goal_id IS NULL AND deleted_at IS NULL ORDER BY done, created_at DESC".into(), None),
        },
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            match &arg {
                Some(a) => params![a] as Vec<&dyn rusqlite::ToSql>,
                None => params![] as Vec<&dyn rusqlite::ToSql>,
            }
            .as_slice(),
            db::row_task,
        )
        .map_err(|e| e.to_string())?;
    let list: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!(list))
}

#[tauri::command]
pub fn create_task(state: State<AppState>, goal_id: Option<String>, title: String, priority: String, due_at: Option<String>) -> Result<Value, String> {
    let conn = lock(&state);
    let id = db::new_id();
    conn.execute(
        "INSERT INTO tasks(id, goal_id, title, priority, due_at, created_at, updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6)",
        params![id, goal_id, title, priority, due_at, db::now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id }))
}

#[tauri::command]
pub fn update_task(state: State<AppState>, id: String, title: Option<String>, done: Option<i64>, priority: Option<String>, due_at: Option<String>) -> Result<(), String> {
    let conn = lock(&state);
    if let Some(v) = title { conn.execute("UPDATE tasks SET title=?1, updated_at=?2 WHERE id=?3", params![v, db::now_iso(), id]).map_err(|e| e.to_string())?; }
    if let Some(v) = done {
        conn.execute("UPDATE tasks SET done=?1, updated_at=?2 WHERE id=?3", params![v, db::now_iso(), id]).map_err(|e| e.to_string())?;
        // bump goal progress automatically from its tasks
        let goal: Option<String> = conn
            .query_row("SELECT goal_id FROM tasks WHERE id=?1", params![id], |r| r.get(0))
            .ok()
            .flatten();
        if let Some(gid) = goal {
            conn.execute(
                "UPDATE goals SET progress = COALESCE((SELECT CAST(100.0*SUM(done)/COUNT(*) AS INTEGER) FROM tasks WHERE goal_id=?1 AND deleted_at IS NULL), progress), updated_at=?2 WHERE id=?1",
                params![gid, db::now_iso()],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    if let Some(v) = priority { conn.execute("UPDATE tasks SET priority=?1 WHERE id=?2", params![v, id]).map_err(|e| e.to_string())?; }
    if let Some(v) = due_at { conn.execute("UPDATE tasks SET due_at=?1 WHERE id=?2", params![v, id]).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn delete_task(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = lock(&state);
    db::soft_delete(&conn, "tasks", &id)
}

// ---------- reminders ----------
#[tauri::command]
pub fn list_reminders(state: State<AppState>) -> Result<Value, String> {
    let conn = lock(&state);
    let mut stmt = conn
        .prepare("SELECT id, entity_type, entity_id, title, fire_at, repeat, done, created_at FROM reminders WHERE deleted_at IS NULL ORDER BY done, fire_at LIMIT 200")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], db::row_reminder).map_err(|e| e.to_string())?;
    let list: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!(list))
}

#[tauri::command]
pub fn create_reminder(state: State<AppState>, entity_type: String, entity_id: Option<String>, title: String, fire_at: String, repeat: String) -> Result<Value, String> {
    let conn = lock(&state);
    let id = db::new_id();
    conn.execute(
        "INSERT INTO reminders(id, entity_type, entity_id, title, fire_at, repeat, done, created_at) VALUES(?1,?2,?3,?4,?5,?6,0,?7)",
        params![id, entity_type, entity_id, title, fire_at, repeat, db::now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id }))
}

#[tauri::command]
pub fn update_reminder(state: State<AppState>, id: String, fire_at: Option<String>, done: Option<i64>, title: Option<String>) -> Result<(), String> {
    let conn = lock(&state);
    if let Some(v) = fire_at { conn.execute("UPDATE reminders SET fire_at=?1 WHERE id=?2", params![v, id]).map_err(|e| e.to_string())?; }
    if let Some(v) = done { conn.execute("UPDATE reminders SET done=?1 WHERE id=?2", params![v, id]).map_err(|e| e.to_string())?; }
    if let Some(v) = title { conn.execute("UPDATE reminders SET title=?1 WHERE id=?2", params![v, id]).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn delete_reminder(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = lock(&state);
    db::soft_delete(&conn, "reminders", &id)
}

// ---------- trash ----------
#[tauri::command]
pub fn trash_list(state: State<AppState>) -> Result<Value, String> {
    let conn = lock(&state);
    let mut out = serde_json::Map::new();
    for (table, label) in [("notes", "notes"), ("goals", "goals"), ("tasks", "tasks"), ("channels", "channels"), ("folders", "folders")] {
        let sql = format!(
            "SELECT id, name AS title, deleted_at FROM {} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100",
            if table == "notes" { "notes" } else if table == "channels" { "channels" } else if table == "folders" { "folders" } else { table }
        );
        // notes table uses column `title`, goals/tasks use `title`, channels/folders use `name`
        let sql = sql.replace("name AS title", if table == "channels" || table == "folders" { "name AS title" } else { "title AS title" });
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({ "id": r.get::<String,_>(0)?, "title": r.get::<String,_>(1)?, "deletedAt": r.get::<Option<String>,_>(2)?, "kind": label }))
            })
            .map_err(|e| e.to_string())?;
        let list: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
        out.insert(label.to_string(), json!(list));
    }
    Ok(Value::Object(out))
}

#[tauri::command]
pub fn trash_restore(state: State<AppState>, kind: String, id: String) -> Result<(), String> {
    let conn = lock(&state);
    let table = match kind.as_str() {
        "notes" => "notes", "goals" => "goals", "tasks" => "tasks", "channels" => "channels", "folders" => "folders", _ => return Err("unknown kind".into()),
    };
    db::restore(&conn, table, &id)
}

#[tauri::command]
pub fn trash_purge(state: State<AppState>, kind: String, id: String) -> Result<(), String> {
    let conn = lock(&state);
    let sql = match kind.as_str() {
        "notes" => "DELETE FROM notes WHERE id=?1",
        "goals" => "DELETE FROM goals WHERE id=?1",
        "tasks" => "DELETE FROM tasks WHERE id=?1",
        "channels" => "DELETE FROM channels WHERE id=?1",
        "folders" => "DELETE FROM folders WHERE id=?1",
        _ => return Err("unknown kind".into()),
    };
    conn.execute(sql, params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn trash_empty(state: State<AppState>) -> Result<(), String> {
    let conn = lock(&state);
    for sql in [
        "DELETE FROM notes WHERE deleted_at IS NOT NULL",
        "DELETE FROM goals WHERE deleted_at IS NOT NULL",
        "DELETE FROM tasks WHERE deleted_at IS NOT NULL",
        "DELETE FROM channels WHERE deleted_at IS NOT NULL",
        "DELETE FROM folders WHERE deleted_at IS NOT NULL",
    ] {
        conn.execute(sql, []).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- attachments ----------
#[tauri::command]
pub fn attach_to_note(app: AppHandle, state: State<AppState>, note_id: String) -> Result<Value, String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};
    let picked = app
        .dialog()
        .file()
        .add_filter("Images & Docs", &["png", "jpg", "jpeg", "webp", "gif", "pdf", "docx", "txt", "md", "csv", "json"])
        .blocking_pick_files();
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    if let Some(list) = picked {
        for fp in list {
            match fp {
                FilePath::Path(p) => files.push(p),
                FilePath::Url(u) => {
                    if let Some(p) = u.to_file_path().ok() { files.push(p); }
                }
                _ => {}
            }
        }
    }
    if files.is_empty() { return Ok(json!([])); }
    let dir = state.data_dir.join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = lock(&state);
    let mut out: Vec<Value> = Vec::new();
    for p in files {
        let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "file".into());
        let ext = p.extension().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        let kind = if ["png", "jpg", "jpeg", "webp", "gif"].contains(&ext.as_str()) { "image" } else { "doc" };
        let id = db::new_id();
        let stored = dir.join(format!("{}_{}", id, name));
        std::fs::copy(&p, &stored).map_err(|e| e.to_string())?;
        let size = std::fs::metadata(&stored).map(|m| m.len() as i64).unwrap_or(0);
        conn.execute(
            "INSERT INTO attachments(id, note_id, name, path, kind, size, created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![id, note_id, name, stored.to_string_lossy(), kind, size, db::now_iso()],
        )
        .map_err(|e| e.to_string())?;
        out.push(json!({ "id": id, "noteId": note_id, "name": name, "path": stored.to_string_lossy(), "kind": kind, "size": size }));
    }
    Ok(json!(out))
}

#[tauri::command]
pub fn list_attachments(state: State<AppState>, note_id: Option<String>) -> Result<Value, String> {
    let conn = lock(&state);
    let mut stmt = conn
        .prepare("SELECT id, note_id, name, path, kind, size, created_at FROM attachments WHERE deleted_at IS NULL ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<String,_>(0)?, "noteId": r.get::<Option<String>,_>(1)?,
                "name": r.get::<String,_>(2)?, "path": r.get::<String,_>(3)?,
                "kind": r.get::<String,_>(4)?, "size": r.get::<i64,_>(5)?,
                "createdAt": r.get::<String,_>(6)?
            }))
        })
        .map_err(|e| e.to_string())?;
    let all: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    match note_id {
        Some(nid) => Ok(json!(all.into_iter().filter(|a| a["noteId"] == json!(nid)).collect::<Vec<_>>())),
        None => Ok(json!(all)),
    }
}

#[tauri::command]
pub fn delete_attachment(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = lock(&state);
    let path: Option<String> = conn.query_row("SELECT path FROM attachments WHERE id=?1", params![id], |r| r.get(0)).ok();
    db::soft_delete(&conn, "attachments", &id)?;
    if let Some(p) = path {
        std::fs::remove_file(&p).ok();
    }
    Ok(())
}

#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

// ---------- export / import ----------
#[tauri::command]
pub fn export_data(app: AppHandle, state: State<AppState>) -> Result<Value, String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};
    let conn = lock(&state);
    let mut dump = serde_json::Map::new();
    for table in ["settings", "spaces", "channels", "folders", "notes", "messages", "goals", "tasks", "reminders", "attachments", "recordings"] {
        let mut stmt = conn.prepare(&format!("SELECT * FROM {}", table)).map_err(|e| e.to_string())?;
        let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let rows = stmt.query_map([], |r| {
            let mut obj = serde_json::Map::new();
            for c in &cols {
                let v: Value = match r.get_ref(c.as_str()) {
                    Ok(rusqlite::types::ValueRef::Null) => Value::Null,
                    Ok(rusqlite::types::ValueRef::Integer(i)) => json!(i),
                    Ok(rusqlite::types::ValueRef::Real(f)) => json!(f),
                    Ok(rusqlite::types::ValueRef::Text(t)) => json!(String::from_utf8_lossy(t).to_string()),
                    Ok(rusqlite::types::ValueRef::Blob(b)) => json!(String::from_utf8_lossy(b).to_string()),
                    Err(_) => Value::Null,
                };
                obj.insert(c.clone(), v);
            }
            Ok(Value::Object(obj))
        }).map_err(|e| e.to_string())?;
        let list: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
        dump.insert(table.to_string(), json!(list));
    }
    let target = app.dialog().file().set_file_name("dotnote-backup.json").blocking_save_file();
    let path = match target {
        Some(FilePath::Path(p)) => p,
        Some(FilePath::Url(u)) => u.to_file_path().unwrap_or_default(),
        _ => return Ok(json!({ "saved": false })),
    };
    std::fs::write(&path, serde_json::to_vec_pretty(&Value::Object(dump)).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(json!({ "saved": true, "path": path.to_string_lossy() }))
}

#[tauri::command]
pub fn import_data(app: AppHandle, state: State<AppState>) -> Result<Value, String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};
    let picked = app.dialog().file().add_filter("DotNote backup", &["json"]).blocking_pick_file();
    let path = match picked {
        Some(FilePath::Path(p)) => p,
        Some(FilePath::Url(u)) => u.to_file_path().unwrap_or_default(),
        _ => return Ok(json!({ "imported": false })),
    };
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let data: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let conn = lock(&state);
    for table in ["settings", "spaces", "channels", "folders", "notes", "messages", "goals", "tasks", "reminders", "attachments", "recordings"] {
        if let Some(rows) = data[table].as_array() {
            conn.execute(&format!("DELETE FROM {}", table), []).map_err(|e| e.to_string())?;
            for row in rows {
                if let Some(obj) = row.as_object() {
                    let cols: Vec<String> = obj.keys().cloned().collect();
                    if cols.is_empty() { continue; }
                    let sql = format!(
                        "INSERT OR REPLACE INTO {} ({}) VALUES({})",
                        table,
                        cols.join(", "),
                        cols.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect::<Vec<_>>().join(", ")
                    );
                    let mut params_vec: Vec<rusqlite::types::Value> = Vec::new();
                    for c in &cols {
                        let pv = match obj.get(c).unwrap_or(&Value::Null) {
                            Value::Null => rusqlite::types::Value::Null,
                            Value::Bool(b) => rusqlite::types::Value::Integer(if *b { 1 } else { 0 }),
                            Value::Number(n) => {
                                if let Some(i) = n.as_i64() { rusqlite::types::Value::Integer(i) }
                                else { rusqlite::types::Value::Real(n.as_f64().unwrap_or(0.0)) }
                            }
                            Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                            _ => rusqlite::types::Value::Null,
                        };
                        params_vec.push(pv);
                    }
                    conn.execute(&sql, rusqlite::params_from_iter(params_vec.iter())).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(json!({ "imported": true }))
}

// ---------- widgets (window management) ----------
#[tauri::command]
pub fn widget_toggle(app: AppHandle, key: String) -> Result<(), String> {
    crate::toggle_widget(&app, &key)
}

#[tauri::command]
pub fn widgets_state(app: AppHandle, state: State<AppState>) -> Result<Value, String> {
    let cfg = {
        let conn = lock(&state);
        db::get_setting(&conn, "widgets").unwrap_or(json!({}))
    };
    let mut out = cfg.clone();
    if let Some(map) = out.as_object_mut() {
        for (k, v) in map.iter_mut() {
            let open = app.get_webview_window(&format!("widget-{}", k)).is_some();
            if let Some(obj) = v.as_object_mut() {
                obj.insert("open".into(), json!(open));
            }
        }
    }
    Ok(out)
}

