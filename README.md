# DotNote ●

**A super minimal, mono (Nothing-inspired), local-first notes app for Windows — with Discord-style channels, a Notion-style editor, Obsidian-style search, OpenWhisper-style voice, 4 desktop widgets, and AI from any provider.**

Rust + Tauri v2 · SQLite local storage · CPU-only · no telemetry.

---

## ✨ Everything inside

| Area | What you get |
|---|---|
| **Editor** | Notion-style blocks: headings, lists, to-dos, quotes, code, callouts, dividers, images, attachments. `/` slash menu, **right-click block menu** (turn into, text colors, sizes, duplicate, move, delete), selection toolbar (B/I/U/S/code/colors), `[[wiki-links]]` with backlinks, markdown shortcuts |
| **Organization** | Spaces (Discord-server-like rail) → **Text channels** (chat), **Notes channels**, **Folders**. Starred, pinned, search, tags |
| **Chat channels** | Discord-style UX with a completely original mono UI. `@ai` mentions summon AI, `@NoteName` pulls a note into context. Slash commands: `/todo`, `/remind`, `/ask` |
| **Goals** | Goal cards + tasks (auto progress %), priorities, due dates, **reminders on goals AND tasks AND notes** |
| **Voice** | One-tap recording, **live transcript (mic)**, **live transcript — meeting audio (screen-share, beta)**, auto AI summaries. **Recordings kept 30 days locally** (configurable 1–90) |
| **AI providers** | **OpenRouter** (free `:free` models), **Groq** (fast + whisper), **OpenAI**, **Hugging Face**, **Ollama (local)**, **custom OpenAI-compatible**. One-click *Fetch models*, pick default model, temperature slider |
| **Local models** | Settings → Models: whisper.cpp catalog from **Hugging Face** — one-click download with progress, **switch active model anytime**, delete, offline transcription (tiny → large-v3) |
| **Files** | Import **PDF / DOCX / TXT / MD** into notes · built-in **PDF viewer** · built-in **DOCX viewer** · attach images & docs to any note · file library |
| **Trash** | Everything soft-deleted with restore / delete-forever / empty, 30-day auto purge |
| **4 widgets** | **Quick Note** (voice input too), **Tasks**, **Clock + reminders**, **Focus (pomodoro)** — resizable, always-on-top toggle, global shortcuts |
| **Shortcuts** | Global: `Alt+Space` quick note · `Alt+N` new note · `Alt+M` show/hide · `Alt+F`/`Alt+G`/`Alt+C` widgets — all editable in Settings. In-app: `Ctrl+K` palette, `Ctrl+,` settings, `Ctrl+N`, `Ctrl +/-/0` zoom |
| **Themes** | 6 mono themes + custom accent, font-size / UI-scale / density / zoom sliders, dot-matrix grid toggle |
| **Data** | 100% local SQLite + JSON export/import backup |

## 🔧 Build the Windows .exe

### Easiest — GitHub Actions (recommended)
1. Create a GitHub repo and upload this folder (keep `.github/`).
2. Repo → **Actions** → "Build DotNote (Windows .exe)" → **Run workflow**.
3. When green, download artifacts: **DotNote-setup-exe** (installer) and **DotNote-portable-exe** (standalone .exe — Windows 10/11 has WebView2 built-in).

### Local (on Windows)
```
rustup default stable
npx @tauri-apps/cli@latest build
```
Outputs in `src-tauri/target/release/bundle/nsis/`.

## 🚀 Quick start
1. Launch → a `Home` space with `#general`, `#ideas`, `daily-notes` and a Welcome note is created.
2. `Ctrl+,` → **AI Providers** → paste an **OpenRouter** key (free models) or **Groq** key (free whisper transcription) → *Fetch models* → pick one.
3. Optional: **Models** → *Install whisper.cpp* + download a model for 100% offline transcription.
4. `Ctrl+K` opens the command palette — everything is one keystroke away.

## 📁 Where is my data?
`%APPDATA%/com.dotnote.app/` — `dotnote.db` (SQLite), `recordings/` (voice, auto-deleted after 30 days), `models/` (ggml), `attachments/`.

## 🔒 Privacy
Everything is local. AI/cloud transcription only happens when you configure a provider key — otherwise the app stays fully functional without AI.
