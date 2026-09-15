// DotNote — scheduler.rs : background threads (reminders, retention cleanup)
use crate::db;
use serde_json::json;
use std::str::FromStr;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// Delete recordings older than the retention setting (default 30 days) + purge old trash.
pub fn cleanup_recordings(conn: &rusqlite::Connection) {
    let retention: i64 = db::get_setting(conn, "voice_retention_days")
        .and_then(|v| v.as_i64())
        .unwrap_or(30);
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(retention)).to_rfc3339();
    let mut stmt = match conn.prepare("SELECT id, path FROM recordings WHERE created_at < ?1") {
        Ok(s) => s,
        Err(_) => return,
    };
    let rows: Vec<(String, String)> = stmt
        .query_map([&cutoff], |r| Ok((r.get::<String, _>(0)?, r.get::<String, _>(1)?)))
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();
    for (id, path) in rows {
        conn.execute("DELETE FROM recordings WHERE id=?1", [&id]).ok();
        std::fs::remove_file(&path).ok();
    }
    // purge trash older than 30 days
    let trash_cutoff = (chrono::Utc::now() - chrono::Duration::days(30)).to_rfc3339();
    for table in ["notes", "goals", "tasks", "channels", "folders"] {
        conn.execute(
            &format!("DELETE FROM {} WHERE deleted_at IS NOT NULL AND deleted_at < ?1", table),
            [&trash_cutoff],
        )
        .ok();
    }
}

fn next_repeat_time(fire_at: &str, repeat: &str) -> Option<String> {
    let dt = chrono::DateTime::parse_from_rfc3339(fire_at).ok()?;
    let next = match repeat {
        "daily" => dt + chrono::Duration::days(1),
        "weekly" => dt + chrono::Duration::weeks(1),
        "hourly" => dt + chrono::Duration::hours(1),
        _ => return None,
    };
    Some(next.to_rfc3339())
}

/// Every 15s: fire due reminders (notification + event), reschedule repeats.
pub fn start(app: AppHandle) {
    // reminder thread
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(15));
        let state = match app.try_state::<crate::AppState>() {
            Some(s) => s,
            None => continue,
        };
        let conn = match state.db.try_lock() {
            Ok(c) => c,
            Err(_) => continue,
        };
        let now = chrono::Utc::now();
        let now_iso = now.to_rfc3339();
        let due: Vec<(String, String, String, String)> = {
            let mut stmt = match conn.prepare(
                "SELECT id, title, fire_at, repeat FROM reminders WHERE done=0 AND deleted_at IS NULL AND fire_at <= ?1",
            ) {
                Ok(s) => s,
                Err(_) => continue,
            };
            stmt.query_map([&now_iso], |r| {
                Ok((r.get::<String, _>(0)?, r.get::<String, _>(1)?, r.get::<String, _>(2)?, r.get::<String, _>(3)?))
            })
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
        };
        for (id, title, fire_at, repeat) in due {
            let _ = app.emit("reminder-fire", json!({ "id": id, "title": title, "fireAt": fire_at }));
            app.notification()
                .builder()
                .title("DotNote reminder")
                .body(&title)
                .show()
                .ok();
            match next_repeat_time(&fire_at, &repeat) {
                Some(next) => {
                    conn.execute("UPDATE reminders SET fire_at=?1 WHERE id=?2", rusqlite::params![next, id]).ok();
                }
                None => {
                    conn.execute("UPDATE reminders SET done=1 WHERE id=?1", [&id]).ok();
                }
            }
        }
        cleanup_recordings(&conn);
        drop(conn);
    });
}

/// Parse flexible reminder input: "in 30m", "in 2h", "tomorrow 9:00", "2026-01-05 14:30", "at 18:00"
pub fn parse_natural_time(input: &str) -> Option<String> {
    let input = input.trim().to_lowercase();
    let now = chrono::Utc::now();
    let re_min = regex::Regex::new(r"^in\s+(\d+)\s*(m|min|mins|minutes?)$").ok()?;
    let re_hour = regex::Regex::new(r"^in\s+(\d+)\s*(h|hr|hours?)$").ok()?;
    let re_days = regex::Regex::new(r"^in\s+(\d+)\s*(d|days?)$").ok()?;
    if let Some(c) = re_min.captures(&input) {
        let n: i64 = c.get(1)?.as_str().parse().ok()?;
        return Some((now + chrono::Duration::minutes(n)).to_rfc3339());
    }
    if let Some(c) = re_hour.captures(&input) {
        let n: i64 = c.get(1)?.as_str().parse().ok()?;
        return Some((now + chrono::Duration::hours(n)).to_rfc3339());
    }
    if let Some(c) = re_days.captures(&input) {
        let n: i64 = c.get(1)?.as_str().parse().ok()?;
        return Some((now + chrono::Duration::days(n)).to_rfc3339());
    }
    if let Some(rest) = input.strip_prefix("tomorrow") {
        let hms = parse_hhmm(rest.trim().trim_start_matches("at "));
        let mut d = (now + chrono::Duration::days(1)).date_naive();
        if let Some(t) = hms {
            return Some(d.and_hms_opt(t.0, t.1, 0)?.and_local_timezone(chrono::Utc).single()?.to_rfc3339());
        }
        d = d.succ_opt()?;
        return None;
    }
    if let Some(rest) = input.strip_prefix("at ") {
        if let Some((h, m)) = parse_hhmm(rest) {
            let today = now.date_naive();
            let target = today.and_hms_opt(h, m, 0)?.and_local_timezone(chrono::Utc).single()?;
            if target > now {
                return Some(target.to_rfc3339());
            }
            let tomorrow = (now + chrono::Duration::days(1)).date_naive();
            return Some(tomorrow.and_hms_opt(h, m, 0)?.and_local_timezone(chrono::Utc).single()?.to_rfc3339());
        }
    }
    // absolute: "2026-01-05 14:30"
    if let Ok(dt) = chrono::NaiveDateTime::from_str(&format!("{} 00:00", &input)) {
        return Some(dt.and_local_timezone(chrono::Utc).single()?.to_rfc3339());
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(&input, "%Y-%m-%d %H:%M") {
        return Some(dt.and_local_timezone(chrono::Utc).single()?.to_rfc3339());
    }
    None
}

fn parse_hhmm(s: &str) -> Option<(u32, u32)> {
    let s = s.trim();
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 2 {
        // "9am" / "6pm"
        let lower = s.to_string();
        if let Some(h) = lower.strip_suffix("am") {
            let n: u32 = h.trim().parse().ok()?;
            return Some((n % 12, 0));
        }
        if let Some(h) = lower.strip_suffix("pm") {
            let n: u32 = h.trim().parse().ok()?;
            return Some((if n == 12 { 12 } else { n + 12 }, 0));
        }
        return None;
    }
    let h: u32 = parts[0].trim().parse().ok()?;
    let m: u32 = parts[1].trim().parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some((h, m))
}
