// DotNote — files.rs : import documents (docx/pdf/txt/md) + built-in docx viewer
use crate::db;
use crate::AppState;
use serde_json::{json, Value};
use std::io::Read;
use tauri::State;

fn lock<'a>(state: &'a State<AppState>) -> std::sync::MutexGuard<'a, rusqlite::Connection> {
    state.db.lock().unwrap()
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Extract text/HTML from a .docx (zip of XML). Returns simple sanitized HTML.
pub fn docx_to_html_impl(path: &std::path::Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Cannot open file: {}", e))?;
    let mut archive = zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|e| format!("Not a valid .docx: {}", e))?;
    let mut doc_xml = String::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.name() == "word/document.xml" {
            entry.read_to_string(&mut doc_xml).map_err(|e| e.to_string())?;
            break;
        }
    }
    if doc_xml.is_empty() {
        return Err("word/document.xml not found — is this a real .docx?".into());
    }

    let mut reader = quick_xml::Reader::from_str(&doc_xml);
    let mut buf = Vec::new();
    let mut html = String::new();
    let mut in_p = false;
    let mut bold = 0i32;
    let mut italic = 0i32;
    let mut list_num = 0i32;
    loop {
        buf.clear();
        match reader.read_event_into(&mut buf) {
            Ok(quick_xml::events::Event::Start(e)) => match e.name().as_ref() {
                b"w:p" => {
                    in_p = true;
                    html.push_str("<p>");
                }
                b"w:tbl" => html.push_str("<p>[table] "),
                b"w:b" => bold += 1,
                b"w:i" => italic += 1,
                b"w:hyperlink" => {}
                _ => {}
            },
            Ok(quick_xml::events::Event::End(e)) => match e.name().as_ref() {
                b"w:p" => {
                    in_p = false;
                    html.push_str("</p>");
                }
                b"w:b" => bold -= 1,
                b"w:i" => italic -= 1,
                _ => {}
            },
            Ok(quick_xml::events::Event::Empty(e)) => match e.name().as_ref() {
                b"w:b" => bold += 1,
                b"w:i" => italic += 1,
                b"w:br" => {
                    if in_p {
                        html.push_str("<br>");
                    }
                }
                b"w:tab" => {
                    if in_p {
                        html.push_str("&nbsp;&nbsp;&nbsp;");
                    }
                }
                _ => {}
            },
            Ok(quick_xml::events::Event::Text(t)) => {
                if in_p {
                    let s = t.unescape().unwrap_or_default();
                    let s = esc(&s);
                    if bold > 0 {
                        html.push_str("<b>");
                    }
                    if italic > 0 {
                        html.push_str("<i>");
                    }
                    html.push_str(&s);
                    if italic > 0 {
                        html.push_str("</i>");
                    }
                    if bold > 0 {
                        html.push_str("</b>");
                    }
                }
            }
            Ok(quick_xml::events::Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {}
        }
    }
    if html.trim().is_empty() {
        return Err("The document appears to be empty.".into());
    }
    Ok(html)
}

fn pdf_text_impl(path: &std::path::Path) -> Result<String, String> {
    let owned = path.to_path_buf();
    let res = std::panic::catch_unwind(move || pdf_extract::extract_text(&owned));
    match res {
        Ok(Ok(t)) if !t.trim().is_empty() => Ok(t),
        Ok(Ok(_)) => Err("PDF text is empty (scanned image PDF? copy text manually or use AI later).".into()),
        Ok(Err(e)) => Err(format!("PDF parse error: {}", e)),
        Err(_) => Err("PDF parser crashed on this file.".into()),
    }
}

/// Import files via native dialog. Creates notes. Returns created notes.
#[tauri::command]
pub fn import_files(app: tauri::AppHandle, state: State<AppState>) -> Result<Value, String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};
    let picked = app
        .dialog()
        .file()
        .add_filter("Documents", &["pdf", "docx", "txt", "md", "markdown"])
        .blocking_pick_files();
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    if let Some(list) = picked {
        for fp in list {
            match fp {
                FilePath::Path(p) => files.push(p),
                FilePath::Url(u) => { if let Ok(p) = u.to_file_path() { files.push(p); } }
                _ => {}
            }
        }
    }
    if files.is_empty() {
        return Ok(json!([]));
    }
    let conn = lock(&state);
    let space_id: Option<String> = conn
        .query_row("SELECT id FROM spaces ORDER BY ord LIMIT 1", [], |r| r.get(0))
        .ok();
    drop(conn);
    let mut created: Vec<Value> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();
    for p in files {
        let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "document".into());
        let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| name.clone());
        let ext = p.extension().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        let result: Result<(String, String), String> = match ext.as_str() {
            "docx" => docx_to_html_impl(&p).map(|html| (html, html_to_text(&html))),
            "pdf" => pdf_text_impl(&p).map(|t| (md_to_html(&t), t)),
            "txt" => std::fs::read_to_string(&p).map(|t| (md_to_html(&t), t)).map_err(|e| e.to_string()),
            "md" | "markdown" => std::fs::read_to_string(&p).map(|t| (md_to_html(&t), t)).map_err(|e| e.to_string()),
            _ => Err(format!("Unsupported type: .{}", ext)),
        };
        match result {
            Ok((html, text)) => {
                let id = db::new_id();
                let blocks = text_to_blocks(&html);
                let words: i64 = text.split_whitespace().count() as i64;
                let conn = lock(&state);
                let r = conn.execute(
                    "INSERT INTO notes(id, space_id, title, content_json, content_text, words, created_at, updated_at)
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",
                    params![id, space_id, stem, blocks, text, words, db::now_iso()],
                );
                drop(conn);
                match r {
                    Ok(_) => created.push(json!({ "id": id, "title": stem, "words": words })),
                    Err(e) => errors.push(json!({ "file": name, "error": e.to_string() })),
                }
            }
            Err(e) => errors.push(json!({ "file": name, "error": e })),
        }
    }
    Ok(json!({ "created": created, "errors": errors }))
}

fn html_to_text(html: &str) -> String {
    let s = regex::Regex::new(r"<[^>]+>").unwrap().replace_all(html, "");
    s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ")
}

fn md_to_text_basic(s: &str) -> String {
    s.to_string()
}

fn md_to_html(text: &str) -> String {
    let mut html = String::new();
    for line in md_to_text_basic(text).lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let esc = esc(t);
        if let Some(rest) = t.strip_prefix("# ") {
            html.push_str(&format!("<h1>{}</h1>", esc(rest)));
        } else if let Some(rest) = t.strip_prefix("## ") {
            html.push_str(&format!("<h2>{}</h2>", esc(rest)));
        } else if let Some(rest) = t.strip_prefix("### ") {
            html.push_str(&format!("<h3>{}</h3>", esc(rest)));
        } else if t.starts_with("- ") || t.starts_with("* ") {
            html.push_str(&format!("<li>{}</li>", esc(&t[2..])));
        } else if t.starts_with("> ") {
            html.push_str(&format!("<blockquote>{}</blockquote>", esc(&t[2..])));
        } else {
            html.push_str(&format!("<p>{}</p>", esc(t)));
        }
    }
    html
}

fn text_to_blocks(html: &str) -> String {
    // split generated html into per-paragraph blocks for the editor
    let mut blocks: Vec<Value> = Vec::new();
    for part in html.split("</p>") {
        let p = part.trim();
        let p = p.strip_prefix("<p>").unwrap_or(p);
        if p.trim().is_empty() {
            continue;
        }
        let (ptype, content) = if let Some(h) = p.strip_prefix("<h1>") {
            ("h1", h.trim_end_matches("</h1>"))
        } else if let Some(h) = p.strip_prefix("<h2>") {
            ("h2", h.trim_end_matches("</h2>"))
        } else if let Some(h) = p.strip_prefix("<h3>") {
            ("h3", h.trim_end_matches("</h3>"))
        } else if let Some(q) = p.strip_prefix("<blockquote>") {
            ("quote", q.trim_end_matches("</blockquote>"))
        } else if let Some(l) = p.strip_prefix("<li>") {
            ("li", l.trim_end_matches("</li>"))
        } else {
            ("p", p)
        };
        blocks.push(json!({ "id": db::new_id(), "type": ptype, "html": content }));
    }
    serde_json::to_string(&blocks).unwrap_or_else(|_| "[]".into())
}

/// Built-in DOCX viewer command: returns HTML for the viewer modal.
#[tauri::command]
pub fn docx_to_html(state: State<AppState>, path: String) -> Result<Value, String> {
    let html = docx_to_html_impl(std::path::Path::new(&path))?;
    Ok(json!({ "html": html }))
}

/// Extract PDF text (used as PDF viewer fallback + search).
#[tauri::command]
pub fn pdf_text(state: State<AppState>, path: String) -> Result<Value, String> {
    let text = pdf_text_impl(std::path::Path::new(&path))?;
    Ok(json!({ "text": text }))
}
