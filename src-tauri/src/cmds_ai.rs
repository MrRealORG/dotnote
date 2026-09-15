// DotNote — cmds_ai.rs : AI providers, HF whisper models, transcription, recordings
use crate::db;
use crate::AppState;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Value};
use std::io::Write;
use tauri::{Emitter, State};

fn lock<'a>(state: &'a State<AppState>) -> std::sync::MutexGuard<'a, rusqlite::Connection> {
    state.db.lock().unwrap()
}

fn provider_cfg(state: &State<AppState>, provider: &str) -> (String, String) {
    let conn = lock(state);
    let providers = db::get_setting(&conn, "providers").unwrap_or(json!({}));
    let p = providers.get(provider).cloned().unwrap_or(json!({}));
    let base = match provider {
        "openrouter" => "https://openrouter.ai/api/v1".to_string(),
        "groq" => "https://api.groq.com/openai/v1".to_string(),
        "openai" => "https://api.openai.com/v1".to_string(),
        "hf" => "https://router.huggingface.co/v1".to_string(),
        "ollama" => p["url"].as_str().unwrap_or("http://127.0.0.1:11434/v1").trim_end_matches('/').to_string(),
        "custom" => p["url"].as_str().unwrap_or_default().trim_end_matches('/').to_string(),
        _ => String::new(),
    };
    let key = p["key"].as_str().unwrap_or_default().to_string();
    (base, key)
}

// ---------- chat ----------
#[tauri::command]
pub async fn ai_chat(
    state: State<'_, AppState>,
    provider: String,
    model: String,
    messages: Vec<Value>,
    temperature: Option<f64>,
) -> Result<Value, String> {
    let (base, key) = provider_cfg(&state, &provider);
    if base.is_empty() {
        return Err("Unknown provider. Configure it in Settings → AI Providers.".into());
    }
    let temp = temperature.unwrap_or(0.7);
    let conn = lock(&state);
    let temp_setting = conn
        .query_row("SELECT value FROM settings WHERE key='temperature'", [], |r| r.get::<String, _>(0))
        .ok()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.7);
    drop(conn);
    let temp = if temperature.is_some() { temp } else { temp_setting };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client
        .post(format!("{}/chat/completions", base))
        .json(&json!({
            "model": model,
            "messages": messages,
            "temperature": temp
        }));
    if !key.is_empty() {
        req = req.bearer_auth(&key);
    }
    if provider == "openrouter" {
        req = req.header("HTTP-Referer", "https://dotnote.local").header("X-Title", "DotNote");
    }
    let resp = req.send().await.map_err(|e| format!("Network error: {}", e))?;
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(json!({}));
    if !status.is_success() {
        let msg = body["error"]["message"].as_str()
            .or_else(|| body["message"].as_str())
            .unwrap_or("request failed");
        return Err(format!("{} — {}", status, msg));
    }
    let text = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    if text.is_empty() {
        return Err(format!("Empty response: {}", body.to_string().chars().take(300).collect::<String>()));
    }
    Ok(json!({ "text": text, "provider": provider, "model": model }))
}

#[tauri::command]
pub async fn ai_list_provider_models(state: State<'_, AppState>, provider: String) -> Result<Value, String> {
    let (base, key) = provider_cfg(&state, &provider);
    if base.is_empty() {
        return Err("Unknown provider".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(format!("{}/models", base));
    if !key.is_empty() {
        req = req.bearer_auth(&key);
    }
    let resp = req.send().await.map_err(|e| format!("Network error: {}", e))?;
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(json!({}));
    if !status.is_success() {
        return Err(format!("{} — could not list models (check API key)", status));
    }
    let mut ids: Vec<String> = body["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    Ok(json!(ids))
}

#[tauri::command]
pub async fn ai_summarize(state: State<'_, AppState>, text: String, instruction: Option<String>) -> Result<Value, String> {
    let (provider, model) = {
        let conn = lock(&state);
        let p = db::get_setting(&conn, "default_chat_provider").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_else(|| "openrouter".into());
        let m = db::get_setting(&conn, "default_chat_model").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
        (p, m)
    };
    if model.is_empty() {
        return Err("No default chat model set. Open Settings → AI Providers.".into());
    }
    let instr = instruction.unwrap_or_else(|| "Summarize the following content into clear bullet points. Keep it concise.".to_string());
    let messages = vec![
        json!({"role": "system", "content": "You are a concise, helpful assistant inside a notes app called DotNote. Use plain text with short bullet points."}),
        json!({"role": "user", "content": format!("{}\n\n---\n\n{}", instr, text)}),
    ];
    ai_chat(state, provider, model, messages, None).await
}

// ---------- whisper.cpp local models (Hugging Face) ----------
fn models_dir(state: &State<AppState>) -> std::path::PathBuf {
    state.data_dir.join("models")
}

pub fn whisper_catalog_value(state: &State<AppState>) -> Value {
    let conn = lock(state);
    let active = db::get_setting(&conn, "active_whisper_model").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
    let dir = state.data_dir.join("models");
    let entries = [
        ("ggml-tiny.bin", 75, "Tiny — fastest, lowest quality"),
        ("ggml-tiny.en.bin", 75, "Tiny English-only"),
        ("ggml-base.bin", 142, "Base — good balance for quick notes"),
        ("ggml-base.en.bin", 142, "Base English-only"),
        ("ggml-small.bin", 466, "Small — solid accuracy"),
        ("ggml-small.en.bin", 466, "Small English-only"),
        ("ggml-medium.bin", 1500, "Medium — high accuracy"),
        ("ggml-medium.en.bin", 1500, "Medium English-only"),
        ("ggml-large-v3-turbo.bin", 1620, "Large v3 Turbo — near best, fast"),
        ("ggml-large-v3.bin", 3100, "Large v3 — best accuracy"),
        ("ggml-distil-large-v3.bin", 1510, "Distil Large v3 — fast + accurate"),
    ];
    let list: Vec<Value> = entries
        .iter()
        .map(|(file, mb, desc)| {
            let path = dir.join(file);
            let installed = path.exists();
            json!({
                "name": file.trim_start_matches("ggml-").trim_end_matches(".bin"),
                "file": file,
                "sizeMb": mb,
                "desc": desc,
                "url": format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}", file),
                "installed": installed,
                "diskBytes": if installed { std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) } else { 0 },
                "active": file == active
            })
        })
        .collect();
    json!(list)
}

#[tauri::command]
pub fn whisper_catalog(state: State<AppState>) -> Result<Value, String> {
    Ok(whisper_catalog_value(&state))
}

#[tauri::command]
pub fn whisper_status(state: State<AppState>) -> Result<Value, String> {
    let conn = lock(&state);
    let cli = db::get_setting(&conn, "whisper_cli_path").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
    let active = db::get_setting(&conn, "active_whisper_model").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
    let model_path = if active.is_empty() { String::new() } else { state.data_dir.join("models").join(&active).to_string_lossy().to_string() };
    Ok(json!({
        "platform": std::env::consts::OS,
        "cliPath": cli,
        "cliFound": !cli.is_empty() && std::path::Path::new(&cli).exists(),
        "activeModel": active,
        "modelPath": model_path,
        "modelFound": !model_path.is_empty() && std::path::Path::new(&model_path).exists(),
        "modelsDir": state.data_dir.join("models").to_string_lossy()
    }))
}

#[tauri::command]
pub async fn model_download(app: tauri::AppHandle, state: State<'_, AppState>, url: String, name: String) -> Result<Value, String> {
    let dir = state.data_dir.join("models");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let safe_name = name.replace(['/', '\\', ':', '*'], "_");
    let final_path = dir.join(&safe_name);
    let part_path = dir.join(format!("{}.part", safe_name));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 60))
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| format!("Download failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }
    let total = resp
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    let mut file = tokio::fs::File::create(&part_path).await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed().as_millis() >= 400 {
            last_emit = std::time::Instant::now();
            let _ = app.emit("dl-progress", json!({
                "name": safe_name, "downloaded": downloaded, "total": total,
                "pct": if total > 0 { (downloaded as f64 / total as f64 * 100.0) as i64 } else { 0 },
                "done": false
            }));
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    tokio::fs::rename(&part_path, &final_path).await.map_err(|e| e.to_string())?;
    let _ = app.emit("dl-progress", json!({ "name": safe_name, "downloaded": downloaded, "total": total, "pct": 100, "done": true }));
    Ok(json!({ "path": final_path.to_string_lossy(), "bytes": downloaded }))
}

#[tauri::command]
pub fn model_delete(state: State<AppState>, name: String) -> Result<(), String> {
    let path = state.data_dir.join("models").join(&name);
    std::fs::remove_file(&path).ok();
    let conn = lock(&state);
    let active = db::get_setting(&conn, "active_whisper_model").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
    if active == name {
        db::set_setting(&conn, "active_whisper_model", &json!(""))?;
    }
    Ok(())
}

#[tauri::command]
pub fn model_set_active(state: State<AppState>, name: String) -> Result<(), String> {
    let path = state.data_dir.join("models").join(&name);
    if !path.exists() {
        return Err(format!("Model file not found: {}", name));
    }
    let conn = lock(&state);
    db::set_setting(&conn, "active_whisper_model", &json!(name))
}

#[tauri::command]
pub async fn whisper_cli_download(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let dir = state.data_dir.join("whisper");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let url = "https://github.com/ggerganov/whisper.cpp/releases/latest/download/whisper-bin-x64.zip";
    let zip_path = dir.join("whisper-bin-x64.zip");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1200))
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| format!("Download failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Could not download whisper.cpp build (HTTP {}). You can set the path manually in Settings → Models.", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&zip_path, &bytes).map_err(|e| e.to_string())?;
    let _ = app.emit("dl-progress", json!({ "name": "whisper.cpp (cli)", "pct": 60, "done": false, "downloaded": bytes.len() as u64, "total": bytes.len() as u64 }));

    // extract
    let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|e| format!("Bad zip: {}", e))?;
    let mut cli_found: Option<std::path::PathBuf> = None;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let fname = entry.name().to_string();
        let base = std::path::Path::new(&fname).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let lower = base.to_lowercase();
        if lower.ends_with(".exe") || lower == "whisper-cli" || lower == "main" {
            let out_path = dir.join(&base);
            let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(0o755)).ok();
            }
            if lower.contains("whisper-cli") || lower == "main.exe" || lower == "whisper-cli.exe" || cli_found.is_none() {
                cli_found = Some(out_path);
            }
        }
    }
    std::fs::remove_file(&zip_path).ok();
    let cli = cli_found.ok_or("No whisper-cli found inside the zip — set the path manually in Settings")?;
    {
        let conn = lock(&state);
        db::set_setting(&conn, "whisper_cli_path", &json!(cli.to_string_lossy()))?;
    }
    let _ = app.emit("dl-progress", json!({ "name": "whisper.cpp (cli)", "pct": 100, "done": true, "downloaded": 0, "total": 0 }));
    Ok(json!({ "path": cli.to_string_lossy() }))
}

#[tauri::command]
pub fn whisper_cli_set_path(state: State<AppState>, path: String) -> Result<(), String> {
    let conn = lock(&state);
    db::set_setting(&conn, "whisper_cli_path", &json!(path))
}

// ---------- transcription ----------
async fn transcribe_cloud(state: &State<'_, AppState>, wav: Vec<u8>, provider: &str) -> Result<String, String> {
    let (base, key, model) = match provider {
        "groq" => ("https://api.groq.com/openai/v1".to_string(), provider_cfg(state, "groq").1, {
            let conn = lock(state);
            db::get_setting(&conn, "transcribe_model_groq").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_else(|| "whisper-large-v3-turbo".into())
        }),
        "openai" => ("https://api.openai.com/v1".to_string(), provider_cfg(state, "openai").1, {
            let conn = lock(state);
            db::get_setting(&conn, "transcribe_model_openai").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_else(|| "whisper-1".into())
        }),
        "custom" => (provider_cfg(state, "custom").0, provider_cfg(state, "custom").1, {
            let conn = lock(state);
            db::get_setting(&conn, "transcribe_model_custom").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_else(|| "whisper-1".into())
        }),
        "hf" => ("https://router.huggingface.co/hf-inference".to_string(), provider_cfg(state, "hf").1, {
            let conn = lock(state);
            db::get_setting(&conn, "transcribe_model_hf").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_else(|| "openai/whisper-large-v3".into())
        }),
        _ => return Err("Unsupported cloud provider".into()),
    };
    if key.is_empty() {
        return Err(format!("No API key set for {}. Add it in Settings → AI Providers.", provider));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = if provider == "hf" {
        client
            .post(format!("{}/models/{}", base, model))
            .bearer_auth(&key)
            .header("Content-Type", "audio/wav")
            .body(wav)
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?
    } else {
        let part = reqwest::multipart::Part::bytes(wav)
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| e.to_string())?;
        let form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("model", model)
            .text("response_format", "json");
        client
            .post(format!("{}/audio/transcriptions", base))
            .bearer_auth(&key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?
    };
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(json!({}));
    if !status.is_success() {
        let msg = body["error"]["message"].as_str()
            .or_else(|| body["error"].as_str())
            .or_else(|| body["message"].as_str())
            .unwrap_or("transcription failed");
        return Err(format!("{} — {}", status, msg));
    }
    let text = body["text"].as_str().unwrap_or_default().trim().to_string();
    if text.is_empty() && !body.is_null() && body["error"].is_null() {
        return Ok(String::new());
    }
    Ok(text)
}

async fn transcribe_local(state: &State<'_, AppState>, wav_path: &std::path::Path) -> Result<String, String> {
    let (cli, model) = {
        let conn = lock(state);
        let cli = db::get_setting(&conn, "whisper_cli_path").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
        let active = db::get_setting(&conn, "active_whisper_model").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
        (cli, active)
    };
    if cli.is_empty() || !std::path::Path::new(&cli).exists() {
        return Err("whisper.cpp is not installed. Get it in Settings → Models → 'Install whisper.cpp'.".into());
    }
    if model.is_empty() {
        return Err("No whisper model selected. Download & activate one in Settings → Models.".into());
    }
    let model_path = state.data_dir.join("models").join(&model);
    if !model_path.exists() {
        return Err("Model file missing — re-download it in Settings → Models.".into());
    }
    let out_base = wav_path.with_extension("out");
    let output = tokio::process::Command::new(&cli)
        .args([
            "-m", model_path.to_string_lossy().as_ref(),
            "-f", wav_path.to_string_lossy().as_ref(),
            "-nt",
            "-of", out_base.to_string_lossy().as_ref(),
            "-otxt",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run whisper.cpp: {}", e))?;
    let txt_path = out_base.with_extension("txt");
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).chars().take(400).collect::<String>();
        return Err(format!("whisper.cpp error: {}", err));
    }
    let text = std::fs::read_to_string(&txt_path).unwrap_or_default();
    std::fs::remove_file(&txt_path).ok();
    Ok(text.trim().to_string())
}

#[tauri::command]
pub async fn transcribe_audio(
    state: State<'_, AppState>,
    audio_b64: String,
    filename: String,
    provider: Option<String>,
) -> Result<Value, String> {
    let bytes = B64.decode(audio_b64.as_bytes()).map_err(|e| format!("bad audio data: {}", e))?;
    let chosen = {
        let conn = lock(&state);
        provider.clone().unwrap_or_else(|| {
            db::get_setting(&conn, "transcribe_provider").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_else(|| "auto".into())
        })
    };

    let mut resolved = chosen.clone();
    if chosen == "auto" {
        let conn = lock(&state);
        let cli = db::get_setting(&conn, "whisper_cli_path").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
        let active = db::get_setting(&conn, "active_whisper_model").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
        drop(conn);
        if !cli.is_empty() && std::path::Path::new(&cli).exists() && !active.is_empty() {
            resolved = "local".into();
        } else if !provider_cfg(&state, "groq").1.is_empty() {
            resolved = "groq".into();
        } else if !provider_cfg(&state, "openai").1.is_empty() {
            resolved = "openai".into();
        } else {
            return Err("No transcription available yet. Install a local model (Settings → Models) or add a Groq/OpenAI key (Settings → AI Providers).".into());
        }
    }

    let text = if resolved == "local" {
        // local whisper.cpp needs a real wav file
        let tmp = state.data_dir.join("recordings").join(format!("tmp_{}.wav", db::new_id()));
        std::fs::create_dir_all(tmp.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        let res = transcribe_local(&state, &tmp).await;
        std::fs::remove_file(&tmp).ok();
        res?
    } else {
        transcribe_cloud(&state, bytes, &resolved).await?
    };

    Ok(json!({ "text": text, "provider": resolved }))
}

// ---------- recordings (30-day local voice storage) ----------
#[tauri::command]
pub fn save_recording(state: State<AppState>, audio_b64: String, duration_sec: i64, source: String, title: String) -> Result<Value, String> {
    let bytes = B64.decode(audio_b64.as_bytes()).map_err(|e| format!("bad audio data: {}", e))?;
    let dir = state.data_dir.join("recordings");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let id = db::new_id();
    let safe_title: String = title.chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' }).collect();
    let fname = format!("{}_{}.wav", chrono::Utc::now().format("%Y%m%d-%H%M%S"), safe_title.trim().replace(' ', "_"));
    let path = dir.join(&fname);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    let conn = lock(&state);
    conn.execute(
        "INSERT INTO recordings(id, title, path, duration_sec, source, transcript, summary, size, created_at)
         VALUES(?1,?2,?3,?4,?5,'','',?6,?7)",
        params![id, if title.trim().is_empty() { "Recording" } else { title.as_str() }, path.to_string_lossy(), duration_sec, source, bytes.len() as i64, db::now_iso()],
    )
    .map_err(|e| e.to_string())?;
    crate::scheduler::cleanup_recordings(&conn);
    Ok(json!({ "id": id, "path": path.to_string_lossy(), "size": bytes.len() }))
}

#[tauri::command]
pub fn list_recordings(state: State<AppState>) -> Result<Value, String> {
    let conn = lock(&state);
    crate::scheduler::cleanup_recordings(&conn);
    let mut stmt = conn
        .prepare("SELECT id, title, path, duration_sec, source, transcript, summary, size, created_at FROM recordings WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 300")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<String,_>(0)?, "title": r.get::<String,_>(1)?,
                "path": r.get::<String,_>(2)?, "durationSec": r.get::<i64,_>(3)?,
                "source": r.get::<String,_>(4)?, "transcript": r.get::<String,_>(5)?,
                "summary": r.get::<String,_>(6)?, "size": r.get::<i64,_>(7)?,
                "createdAt": r.get::<String,_>(8)?
            }))
        })
        .map_err(|e| e.to_string())?;
    let list: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(json!(list))
}

#[tauri::command]
pub fn update_recording(state: State<AppState>, id: String, transcript: Option<String>, summary: Option<String>, title: Option<String>) -> Result<(), String> {
    let conn = lock(&state);
    if let Some(v) = transcript { conn.execute("UPDATE recordings SET transcript=?1 WHERE id=?2", params![v, id]).map_err(|e| e.to_string())?; }
    if let Some(v) = summary { conn.execute("UPDATE recordings SET summary=?1 WHERE id=?2", params![v, id]).map_err(|e| e.to_string())?; }
    if let Some(v) = title { conn.execute("UPDATE recordings SET title=?1 WHERE id=?2", params![v, id]).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn delete_recording(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = lock(&state);
    let path: Option<String> = conn.query_row("SELECT path FROM recordings WHERE id=?1", params![id], |r| r.get(0)).ok();
    conn.execute("DELETE FROM recordings WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    if let Some(p) = path { std::fs::remove_file(&p).ok(); }
    Ok(())
}
