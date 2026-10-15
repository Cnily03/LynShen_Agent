//! opencode's conversations, and zcode's (Z.ai's ZCode keeps opencode's
//! tables), read-only.
//!
//! opencode (anomalyco/opencode, formerly sst/opencode) has kept them in
//! three layouts, all under `<data>/opencode`, where `<data>` is
//! `$XDG_DATA_HOME`, else `~/.local/share`, on every OS (on Windows
//! `%USERPROFILE%\.local\share`):
//! - up to 1.1: JSON files in `storage/`: `session/<project>/<ses>.json`,
//!   `message/<ses>/<msg>.json` and `part/<msg>/<prt>.json`;
//! - from 1.2 (February 2026): SQLite `opencode.db` (`$OPENCODE_DB`; builds
//!   of other channels use `opencode-<channel>.db`), tables `session`,
//!   `message` (one row per message, JSON `data`) and `part` (its text, tool
//!   calls, reasoning …). 1.2 copies the JSON files in and leaves them;
//! - the next layout (opencode's dev branch, autumn 2026): `session_v2` and
//!   `session_message` (one row per message: `type`, `seq`, JSON `data`),
//!   copied from the old tables, which stay.
//!
//! A conversation is read from the first place that has it: the databases
//! (the newer tables first), then the JSON files. Folders on Windows are
//! stored with `/` since 1.19 (`C:/Users/x`); they are listed with `\`.
//!
//! zcode: `~/.zcode/cli/db/db.sqlite` (`$ZCODE_SESSION_DB_PATH`), opencode's
//! tables plus `sequence`, `task_type` and `title_source`.

use super::sessions::{converted_imported, Conversation, Found, Report, Turn};
use super::Roots;
use crate::claude_history::truncate_chars;
use crate::native_import::{ImportRecord, MAX_TITLE_CHARS};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Debug)]
pub(super) enum Tool {
    Opencode,
    Zcode,
}

impl Tool {
    fn source(self) -> &'static str {
        match self {
            Tool::Opencode => "opencode",
            Tool::Zcode => "zcode",
        }
    }
}

/// One place conversations are kept.
#[derive(Debug, Clone, PartialEq)]
enum Store {
    Db(PathBuf),
    Json(PathBuf),
}

impl Store {
    fn path(&self) -> &Path {
        match self {
            Store::Db(p) | Store::Json(p) => p,
        }
    }

    fn exists(&self) -> bool {
        match self {
            Store::Db(p) => p.is_file(),
            Store::Json(p) => p.join("session").is_dir(),
        }
    }
}

/// Where `tool` keeps conversations, in the order they are read.
fn stores(roots: &Roots, tool: Tool) -> Vec<Store> {
    if tool == Tool::Zcode {
        return vec![Store::Db(roots.zcode_db())];
    }
    let dir = roots.data_home.join("opencode");
    let mut dbs: Vec<PathBuf> = roots.opencode_db.iter().cloned().collect();
    dbs.push(dir.join("opencode.db"));
    let mut channels: Vec<PathBuf> = fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("opencode-") && n.ends_with(".db")))
        .collect();
    channels.sort();
    dbs.extend(channels);
    let mut out: Vec<Store> = Vec::new();
    for db in dbs {
        if !out.contains(&Store::Db(db.clone())) {
            out.push(Store::Db(db));
        }
    }
    out.push(Store::Json(dir.join("storage")));
    out
}

/// Windows folders as Windows writes them: opencode stores `C:/Users/x`.
pub(super) fn native_dir(dir: &str, windows: bool) -> String {
    let bytes = dir.as_bytes();
    let drive = bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && &dir[1..3] == ":/";
    if windows && (drive || dir.starts_with("//")) {
        dir.replace('/', "\\")
    } else {
        dir.to_string()
    }
}

/// An id that can name a file (`ses_…`, `msg_…`), so a picked id cannot
/// reach outside the storage folder.
fn plain_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
}

/// A conversation as a store lists it.
#[derive(Debug, PartialEq)]
struct Listed {
    id: String,
    cwd: String,
    /// Its title there, else its first prompt.
    title: String,
    updated_ms: u64,
    prompts: usize,
}

pub(super) fn scan(roots: &Roots, tool: Tool, registry: &[ImportRecord], report: &mut Report) -> Vec<Found> {
    let source = tool.source();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut looked = Vec::new();
    for store in stores(roots, tool) {
        if !store.exists() {
            continue;
        }
        let listed = match &store {
            Store::Db(path) => match list_db(path) {
                Ok(listed) => listed,
                Err(e) => {
                    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    report.store_failed(source, format!("{name} cannot be read ({e})"));
                    looked.push(format!("{} unreadable", path.display()));
                    continue;
                }
            },
            Store::Json(dir) => list_json(dir, source, report),
        };
        looked.push(format!("{} in {}", listed.len(), store.path().display()));
        for s in listed {
            // The same conversation in an older place is a copy.
            if !seen.insert(s.id.clone()) || s.prompts == 0 {
                continue;
            }
            let cwd = native_dir(&s.cwd, cfg!(windows));
            out.push(Found {
                source: source.into(),
                imported: converted_imported(roots, registry, source, &s.id, &cwd),
                title: s.title,
                id: s.id,
                cwd,
                updated_at_ms: s.updated_ms,
                messages: s.prompts,
            });
        }
    }
    let note = if looked.is_empty() {
        let places: Vec<String> = stores(roots, tool).iter().map(|s| s.path().display().to_string()).collect();
        format!("nothing at {}", places.join(", "))
    } else {
        looked.join("; ")
    };
    report.note(source, note);
    out
}

pub(super) fn load(roots: &Roots, tool: Tool, id: &str) -> Result<Conversation, String> {
    let source = tool.source();
    let mut error = None;
    for store in stores(roots, tool) {
        if !store.exists() {
            continue;
        }
        let found = match &store {
            Store::Db(path) => load_db(path, id).map_err(|e| format!("cannot read {}: {e}", path.display())),
            Store::Json(dir) => load_json(dir, id),
        };
        match found {
            Ok(Some(mut conv)) => {
                conv.cwd = native_dir(&conv.cwd, cfg!(windows));
                return Ok(conv);
            }
            Ok(None) => {}
            Err(e) => error = error.or(Some(e)),
        }
    }
    Err(error.unwrap_or_else(|| format!("{source} conversation {id} not found")))
}

/// The app's own title, when it is one: opencode names an untitled session
/// "New session - <date>", zcode marks a placeholder with `title_source`.
fn real_title(title: &str, title_source: Option<&str>) -> String {
    let t = title.trim();
    if t.is_empty()
        || title_source == Some("default")
        || t.starts_with("New session - ")
        || t.starts_with("Child session - ")
    {
        return String::new();
    }
    truncate_chars(t, MAX_TITLE_CHARS)
}

fn first_line(text: &str) -> Option<String> {
    text.lines().map(str::trim).find(|l| !l.is_empty()).map(|l| truncate_chars(l, MAX_TITLE_CHARS))
}

/// Text the user wrote: not the app's own additions (`synthetic`) or parts
/// it left out (`ignored`).
fn written(part: &Value) -> Option<&str> {
    (part["type"].as_str() == Some("text") && part["synthetic"] != json!(true) && part["ignored"] != json!(true))
        .then(|| part["text"].as_str())
        .flatten()
        .filter(|t| !t.trim().is_empty())
}

fn text_of(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// How an attached file is mentioned in the prompt it came with.
fn file_label(part: &Value) -> String {
    let local = part["source"]["path"]
        .as_str()
        .or_else(|| part["url"].as_str().filter(|u| u.starts_with('/')))
        .or_else(|| part["url"].as_str().and_then(|u| u.strip_prefix("file://")))
        .or_else(|| part["source"]["uri"].as_str());
    let name = local.or_else(|| part["filename"].as_str()).or_else(|| part["name"].as_str()).unwrap_or("attachment");
    format!("[file: {name}]")
}

// --- databases ---------------------------------------------------------------

fn open_db(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    // The app may be writing; wait for it rather than fail.
    conn.busy_timeout(Duration::from_secs(3))?;
    Ok(conn)
}

fn tables(conn: &Connection) -> rusqlite::Result<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")?;
    let names = stmt.query_map([], |row| row.get::<_, String>(0))?;
    names.collect()
}

fn columns(conn: &Connection, table: &str) -> HashSet<String> {
    let Ok(mut stmt) = conn.prepare(&format!("PRAGMA table_info({table})")) else { return HashSet::new() };
    stmt.query_map([], |row| row.get::<_, String>(1))
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

/// Which layouts a database holds: the sessions table of the next layout
/// (`session_v2`, or `session` in a database that has only that one), and
/// whether it has the 1.2 layout.
struct Layout {
    v2: Option<&'static str>,
    v1: bool,
}

fn layout(conn: &Connection) -> rusqlite::Result<Layout> {
    let t = tables(conn)?;
    let has = |name: &str| t.contains(name);
    let v1 = has("session") && has("message") && has("part");
    let v2 = if has("session_v2") && has("session_message") {
        Some("session_v2")
    } else if has("session") && has("session_message") && !has("message") {
        Some("session")
    } else {
        None
    };
    Ok(Layout { v2, v1 })
}

fn list_db(path: &Path) -> Result<Vec<Listed>, String> {
    let conn = open_db(path).map_err(|e| e.to_string())?;
    let layout = layout(&conn).map_err(|e| e.to_string())?;
    if layout.v2.is_none() && !layout.v1 {
        return Err("no conversation tables".to_string());
    }
    let mut out = Vec::new();
    if let Some(table) = layout.v2 {
        out.extend(list_v2(&conn, table).map_err(|e| e.to_string())?);
    }
    if layout.v1 {
        out.extend(list_v1(&conn).map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn load_db(path: &Path, id: &str) -> Result<Option<Conversation>, String> {
    let conn = open_db(path).map_err(|e| e.to_string())?;
    let layout = layout(&conn).map_err(|e| e.to_string())?;
    if let Some(table) = layout.v2 {
        if let Some(conv) = load_v2(&conn, table, id).map_err(|e| e.to_string())? {
            return Ok(Some(conv));
        }
    }
    if layout.v1 {
        return load_v1(&conn, id).map_err(|e| e.to_string());
    }
    Ok(None)
}

// --- the 1.2 tables: session, message, part ----------------------------------

/// `column` where it holds JSON, else NULL: `json_extract` fails the whole
/// query on one malformed row.
fn valid_json(column: &str) -> String {
    format!("(CASE WHEN json_valid({column}) THEN {column} END)")
}

fn list_v1(conn: &Connection) -> rusqlite::Result<Vec<Listed>> {
    let cols = columns(conn, "session");
    // Sub-agent sessions resume only through their parent.
    let mut filter = "s.parent_id IS NULL".to_string();
    if cols.contains("task_type") {
        filter.push_str(" AND s.task_type = 'interactive'");
    }
    let title_source = if cols.contains("title_source") { "s.title_source" } else { "NULL" };
    let (m_data, p_data) = (valid_json("m.data"), valid_json("p.data"));
    let sql = format!(
        "SELECT s.id, s.directory, s.title, {title_source}, s.time_updated,
           (SELECT COUNT(*) FROM message m
             WHERE m.session_id = s.id AND json_extract({m_data}, '$.role') = 'user'
               AND NOT EXISTS (SELECT 1 FROM part p WHERE p.message_id = m.id
                               AND json_extract({p_data}, '$.type') = 'compaction'))
         FROM session s WHERE {filter}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        let title: Option<String> = row.get(2)?;
        let title_source: Option<String> = row.get(3)?;
        Ok(Listed {
            id: row.get(0)?,
            cwd: row.get(1)?,
            title: real_title(title.as_deref().unwrap_or(""), title_source.as_deref()),
            updated_ms: row.get::<_, i64>(4)?.max(0) as u64,
            prompts: row.get::<_, i64>(5)?.max(0) as usize,
        })
    })?;
    let mut out: Vec<Listed> = rows.collect::<rusqlite::Result<_>>()?;
    for s in out.iter_mut().filter(|s| s.title.is_empty() && s.prompts > 0) {
        s.title = v1_first_prompt(conn, &s.id);
    }
    Ok(out)
}

/// The first thing the user wrote in a session (a title for an untitled one).
fn v1_first_prompt(conn: &Connection, id: &str) -> String {
    let sql = format!(
        "SELECT p.data FROM part p JOIN message m ON m.id = p.message_id
         WHERE m.session_id = ?1 AND json_extract({}, '$.role') = 'user' AND json_extract({}, '$.type') = 'text'
         ORDER BY m.time_created, m.id, p.id LIMIT 20",
        valid_json("m.data"),
        valid_json("p.data")
    );
    let Ok(mut stmt) = conn.prepare(&sql) else { return String::new() };
    let Ok(rows) = stmt.query_map(params![id], |row| row.get::<_, String>(0)) else { return String::new() };
    let title = rows
        .flatten()
        .filter_map(|data| serde_json::from_str::<Value>(&data).ok())
        .find_map(|part| written(&part).and_then(first_line));
    title.unwrap_or_default()
}

fn load_v1(conn: &Connection, id: &str) -> rusqlite::Result<Option<Conversation>> {
    let title_source = if columns(conn, "session").contains("title_source") { "title_source" } else { "NULL" };
    let head: Option<(String, Option<String>, Option<String>, i64)> = conn
        .query_row(
            &format!("SELECT directory, title, {title_source}, time_updated FROM session WHERE id = ?1"),
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((cwd, title, title_source, updated_ms)) = head else { return Ok(None) };
    // zcode numbers messages and parts; opencode's ids sort by time.
    let order = if columns(conn, "message").contains("sequence") { "sequence, time_created, id" } else { "time_created, id" };
    let mut messages = Vec::new();
    {
        let mut stmt = conn.prepare(&format!("SELECT id, data FROM message WHERE session_id = ?1 ORDER BY {order}"))?;
        let rows = stmt.query_map(params![id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        for row in rows {
            let (mid, data) = row?;
            messages.push((mid, serde_json::from_str::<Value>(&data).unwrap_or(Value::Null)));
        }
    }
    let mut parts: HashMap<String, Vec<Value>> = HashMap::new();
    {
        let part_order = if columns(conn, "part").contains("sequence") { "message_id, sequence, id" } else { "message_id, id" };
        let mut stmt = conn.prepare(&format!("SELECT message_id, data FROM part WHERE session_id = ?1 ORDER BY {part_order}"))?;
        let rows = stmt.query_map(params![id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        for row in rows {
            let (mid, data) = row?;
            if let Ok(v) = serde_json::from_str::<Value>(&data) {
                parts.entry(mid).or_default().push(v);
            }
        }
    }
    Ok(Some(Conversation {
        title: real_title(title.as_deref().unwrap_or(""), title_source.as_deref()),
        cwd,
        updated_s: updated_ms.max(0) as u64 / 1000,
        turns: convert_db(&messages, &parts),
    }))
}

/// A tool part's call and its result.
fn db_tool(part: &Value, at: u64) -> [(u64, Turn); 2] {
    let call_id = part["callID"].as_str().unwrap_or("").to_string();
    let name = part["tool"].as_str().unwrap_or("tool").to_string();
    let state = &part["state"];
    let arguments = match &state["input"] {
        Value::Null => "{}".to_string(),
        input => input.to_string(),
    };
    let output = match state["status"].as_str() {
        Some("completed") => text_of(&state["output"]),
        Some("error") => format!("Error: {}", text_of(&state["error"])),
        _ => "[the tool did not finish]".to_string(),
    };
    [(at, Turn::Call { call_id: call_id.clone(), name: name.clone(), arguments }), (at, Turn::Output { call_id, name, output })]
}

/// Messages (in order) and their parts as turns (the 1.2 tables and the JSON
/// files hold the same objects).
pub(super) fn convert_db(messages: &[(String, Value)], parts: &HashMap<String, Vec<Value>>) -> Vec<(u64, Turn)> {
    let none = Vec::new();
    let mut turns = Vec::new();
    for (id, data) in messages {
        let parts = parts.get(id).unwrap_or(&none);
        // A compaction: its marker, and the summary standing for the history
        // before it (opencode: an assistant message with `summary: true`;
        // zcode: a user message carrying a compaction part).
        if parts.iter().any(|p| p["type"].as_str() == Some("compaction")) || data["summary"] == json!(true) {
            continue;
        }
        let at = data["time"]["created"].as_u64().unwrap_or(0) / 1000;
        match data["role"].as_str() {
            Some("user") => {
                let mut text = Vec::new();
                for p in parts {
                    if let Some(t) = written(p) {
                        text.push(t.to_string());
                    } else if p["type"].as_str() == Some("file") {
                        text.push(file_label(p));
                    }
                }
                turns.push((at, Turn::User(text.join("\n\n"))));
            }
            Some("assistant") => {
                for p in parts {
                    match p["type"].as_str() {
                        Some("text") => {
                            if let Some(t) = written(p) {
                                turns.push((at, Turn::Assistant(t.to_string())));
                            }
                        }
                        Some("tool") => turns.extend(db_tool(p, at)),
                        // reasoning, step-start/-finish, patch, snapshot, timeline …
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    turns
}

// --- the next tables: session_v2, session_message ----------------------------

fn list_v2(conn: &Connection, table: &str) -> rusqlite::Result<Vec<Listed>> {
    let sql = format!(
        "SELECT s.id, s.directory, s.title, s.time_updated,
           (SELECT COUNT(*) FROM session_message m WHERE m.session_id = s.id AND m.type = 'user')
         FROM {table} s WHERE s.parent_id IS NULL"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        let title: Option<String> = row.get(2)?;
        Ok(Listed {
            id: row.get(0)?,
            cwd: row.get(1)?,
            title: real_title(title.as_deref().unwrap_or(""), None),
            updated_ms: row.get::<_, i64>(3)?.max(0) as u64,
            prompts: row.get::<_, i64>(4)?.max(0) as usize,
        })
    })?;
    let mut out: Vec<Listed> = rows.collect::<rusqlite::Result<_>>()?;
    let order = v2_order(conn);
    for s in out.iter_mut().filter(|s| s.title.is_empty() && s.prompts > 0) {
        let sql = format!("SELECT data FROM session_message WHERE session_id = ?1 AND type = 'user' ORDER BY {order} LIMIT 20");
        let Ok(mut stmt) = conn.prepare(&sql) else { continue };
        let Ok(rows) = stmt.query_map(params![s.id], |row| row.get::<_, String>(0)) else { continue };
        s.title = rows
            .flatten()
            .filter_map(|data| serde_json::from_str::<Value>(&data).ok())
            .find_map(|m| m["text"].as_str().and_then(first_line))
            .unwrap_or_default();
    }
    Ok(out)
}

fn v2_order(conn: &Connection) -> &'static str {
    if columns(conn, "session_message").contains("seq") { "seq, time_created, id" } else { "time_created, id" }
}

fn load_v2(conn: &Connection, table: &str, id: &str) -> rusqlite::Result<Option<Conversation>> {
    let head: Option<(String, Option<String>, i64)> = conn
        .query_row(
            &format!("SELECT directory, title, time_updated FROM {table} WHERE id = ?1"),
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((cwd, title, updated_ms)) = head else { return Ok(None) };
    let mut stmt = conn.prepare(&format!(
        "SELECT type, data, time_created FROM session_message WHERE session_id = ?1 ORDER BY {}",
        v2_order(conn)
    ))?;
    let rows = stmt.query_map(params![id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?))
    })?;
    let mut messages = Vec::new();
    for row in rows {
        let (kind, data, created) = row?;
        messages.push((kind, serde_json::from_str::<Value>(&data).unwrap_or(Value::Null), created.max(0) as u64));
    }
    Ok(Some(Conversation {
        title: real_title(title.as_deref().unwrap_or(""), None),
        cwd,
        updated_s: updated_ms.max(0) as u64 / 1000,
        turns: convert_v2(&messages),
    }))
}

/// Text and files of a tool result's `content`.
fn v2_content(content: &Value) -> String {
    content
        .as_array()
        .into_iter()
        .flatten()
        .map(|c| match c["type"].as_str() {
            Some("text") => c["text"].as_str().unwrap_or("").to_string(),
            _ => file_label(&json!({"name": c["name"], "source": {"uri": c["uri"]}})),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// An assistant's tool call (`{type: "tool", id, name, state}`) and its result.
fn v2_tool(tool: &Value, at: u64) -> [(u64, Turn); 2] {
    let call_id = tool["id"].as_str().unwrap_or("").to_string();
    let name = tool["name"].as_str().unwrap_or("tool").to_string();
    let state = &tool["state"];
    let arguments = match &state["input"] {
        Value::Object(_) => state["input"].to_string(),
        // A call still streaming has its arguments as unfinished text.
        _ => "{}".to_string(),
    };
    let output = match state["status"].as_str() {
        Some("completed") => v2_content(&state["content"]),
        Some("error") => {
            let message = state["error"]["message"].as_str().map(str::to_string).unwrap_or_else(|| text_of(&state["error"]));
            let content = v2_content(&state["content"]);
            if content.is_empty() { format!("Error: {message}") } else { format!("Error: {message}\n{content}") }
        }
        _ => "[the tool did not finish]".to_string(),
    };
    [(at, Turn::Call { call_id: call_id.clone(), name: name.clone(), arguments }), (at, Turn::Output { call_id, name, output })]
}

/// `session_message` rows (type, data, time created) in order, as turns.
/// Compactions, synthetic and system notes, shell runs and switches of
/// agent, model or folder carry no turns: the copy has the full history.
pub(super) fn convert_v2(messages: &[(String, Value, u64)]) -> Vec<(u64, Turn)> {
    let mut turns = Vec::new();
    for (kind, data, created) in messages {
        let at = data["time"]["created"].as_u64().unwrap_or(*created) / 1000;
        match kind.as_str() {
            "user" => {
                let mut text: Vec<String> = data["text"].as_str().filter(|t| !t.trim().is_empty()).map(str::to_string).into_iter().collect();
                text.extend(data["files"].as_array().into_iter().flatten().map(file_label));
                turns.push((at, Turn::User(text.join("\n\n"))));
            }
            "assistant" => {
                for c in data["content"].as_array().into_iter().flatten() {
                    match c["type"].as_str() {
                        Some("text") => turns.push((at, Turn::Assistant(c["text"].as_str().unwrap_or("").to_string()))),
                        Some("tool") => turns.extend(v2_tool(c, at)),
                        // reasoning
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    turns
}

// --- the JSON files of opencode 1.1 and earlier ------------------------------

fn read_json_file(path: &Path) -> Result<Value, &'static str> {
    let text = fs::read_to_string(path).map_err(|_| "cannot be read")?;
    serde_json::from_str::<Value>(&text).ok().filter(Value::is_object).ok_or("is not valid JSON")
}

/// The JSON objects in `dir`, each with its id (the file name), sorted by
/// `key` and then id. Files that do not parse are left out.
fn json_objects(dir: &Path, key: impl Fn(&Value) -> u64) -> Vec<(String, Value)> {
    let mut out: Vec<(String, Value)> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("json"))
        .filter_map(|p| {
            let id = p.file_stem()?.to_str()?.to_string();
            Some((id, read_json_file(&p).ok()?))
        })
        .collect();
    out.sort_by(|a, b| key(&a.1).cmp(&key(&b.1)).then_with(|| a.0.cmp(&b.0)));
    out
}

fn json_messages(storage: &Path, session: &str) -> Vec<(String, Value)> {
    json_objects(&storage.join("message").join(session), |m| m["time"]["created"].as_u64().unwrap_or(0))
}

fn json_parts(storage: &Path, message: &str) -> Vec<Value> {
    json_objects(&storage.join("part").join(message), |_| 0).into_iter().map(|(_, v)| v).collect()
}

/// Session files: `storage/session/<project>/<ses>.json`.
fn json_session_files(storage: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for project in fs::read_dir(storage.join("session")).into_iter().flatten().flatten() {
        let Ok(files) = fs::read_dir(project.path()) else { continue };
        out.extend(files.flatten().map(|e| e.path()).filter(|p| p.extension().and_then(|e| e.to_str()) == Some("json")));
    }
    out
}

fn list_json(storage: &Path, source: &str, report: &mut Report) -> Vec<Listed> {
    let mut out = Vec::new();
    for path in json_session_files(storage) {
        let info = match read_json_file(&path) {
            Ok(info) => info,
            Err(why) => {
                report.skip(source, format!("session file {why}"));
                continue;
            }
        };
        let (Some(id), Some(cwd)) = (info["id"].as_str().filter(|i| plain_id(i)), info["directory"].as_str()) else {
            report.skip(source, "session file without an id or folder");
            continue;
        };
        if info["parentID"].as_str().is_some_and(|p| !p.is_empty()) {
            continue;
        }
        // Prompts, without reading every message's parts: a compaction's
        // prompt is the parent of its summary (`summary: true`).
        let messages = json_messages(storage, id);
        let compactions: HashSet<&str> = messages
            .iter()
            .filter(|(_, m)| m["role"].as_str() == Some("assistant") && m["summary"] == json!(true))
            .filter_map(|(_, m)| m["parentID"].as_str())
            .collect();
        let prompts: Vec<&str> = messages
            .iter()
            .filter(|(mid, m)| m["role"].as_str() == Some("user") && plain_id(mid) && !compactions.contains(mid.as_str()))
            .map(|(mid, _)| mid.as_str())
            .collect();
        let first = prompts
            .iter()
            .take(5)
            .find_map(|mid| json_parts(storage, mid).iter().find_map(|p| written(p).and_then(first_line)));
        let title = real_title(info["title"].as_str().unwrap_or(""), None);
        out.push(Listed {
            id: id.to_string(),
            cwd: cwd.to_string(),
            title: if title.is_empty() { first.unwrap_or_default() } else { title },
            updated_ms: info["time"]["updated"].as_u64().unwrap_or(0),
            prompts: prompts.len(),
        });
    }
    out
}

fn load_json(storage: &Path, id: &str) -> Result<Option<Conversation>, String> {
    if !plain_id(id) {
        return Err(format!("invalid conversation id: {id}"));
    }
    let file = format!("{id}.json");
    let Some(path) = json_session_files(storage).into_iter().find(|p| p.file_name().and_then(|n| n.to_str()) == Some(&file))
    else {
        return Ok(None);
    };
    let info = read_json_file(&path).map_err(|why| format!("{} {why}", path.display()))?;
    let messages = json_messages(storage, id);
    let parts: HashMap<String, Vec<Value>> =
        messages.iter().filter(|(mid, _)| plain_id(mid)).map(|(mid, _)| (mid.clone(), json_parts(storage, mid))).collect();
    Ok(Some(Conversation {
        title: real_title(info["title"].as_str().unwrap_or(""), None),
        cwd: info["directory"].as_str().unwrap_or("").to_string(),
        updated_s: info["time"]["updated"].as_u64().unwrap_or(0) / 1000,
        turns: convert_db(&messages, &parts),
    }))
}

#[cfg(test)]
mod tests {
    use super::super::sessions::{import, lynshen_session_dir, tidy, Skipped};
    use super::super::testutil::{self, scan_all};
    use super::super::SessionPick;
    use super::*;

    fn turns(conv: Conversation) -> Vec<Turn> {
        tidy(conv.turns).into_iter().map(|(_, t)| t).collect()
    }

    fn opencode_db(path: &Path, zcode: bool) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let conn = Connection::open(path).unwrap();
        let extra = if zcode { ", task_type text not null default 'interactive', title_source text" } else { "" };
        let seq = if zcode { ", sequence integer" } else { "" };
        conn.execute_batch(&format!(
            "CREATE TABLE session (id text primary key, project_id text, parent_id text, directory text not null,
               title text not null, time_created integer not null, time_updated integer not null{extra});
             CREATE TABLE message (id text primary key, session_id text not null, time_created integer not null,
               time_updated integer not null, data text not null{seq});
             CREATE TABLE part (id text primary key, message_id text not null, session_id text not null,
               time_created integer not null, time_updated integer not null, data text not null{seq});"
        ))
        .unwrap();
        let session = |id: &str, parent: Option<&str>, title: &str| {
            conn.execute(
                "INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated) VALUES (?1, 'p', ?2, '/proj/oc', ?3, 1000, 1790000000000)",
                params![id, parent, title],
            )
            .unwrap();
        };
        session("ses_main", None, "New session - 2026-08-18T10:34:46.692Z");
        session("ses_child", Some("ses_main"), "child");
        let message = |id: &str, session: &str, at: i64, data: Value| {
            conn.execute(
                "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?1, ?2, ?3, ?3, ?4)",
                params![id, session, at, data.to_string()],
            )
            .unwrap();
        };
        let part = |id: &str, msg: &str, data: Value| {
            conn.execute(
                "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?1, ?2, 'ses_main', 0, 0, ?3)",
                params![id, msg, data.to_string()],
            )
            .unwrap();
        };
        message("msg_1", "ses_main", 1_790_000_000_000, json!({"role": "user", "time": {"created": 1_790_000_000_000u64}}));
        part("prt_1", "msg_1", json!({"type": "text", "text": "fix the bug"}));
        part("prt_2", "msg_1", json!({"type": "text", "text": "Called the Read tool", "synthetic": true}));
        part("prt_3", "msg_1", json!({"type": "file", "filename": "a.png", "url": "data:image/png;base64,xx"}));
        message("msg_2", "ses_main", 1_790_000_001_000, json!({"role": "assistant", "time": {"created": 1_790_000_001_000u64}}));
        part("prt_4", "msg_2", json!({"type": "step-start"}));
        part("prt_5", "msg_2", json!({"type": "reasoning", "text": "hmm"}));
        part("prt_6", "msg_2", json!({"type": "tool", "callID": "call-1", "tool": "bash", "state": {"status": "completed", "input": {"command": "ls"}, "output": "a.txt"}}));
        part("prt_7", "msg_2", json!({"type": "tool", "callID": "call-2", "tool": "read", "state": {"status": "error", "input": {"filePath": "x"}, "error": "no such file"}}));
        part("prt_8", "msg_2", json!({"type": "step-finish"}));
        message("msg_3", "ses_main", 1_790_000_002_000, json!({"role": "assistant", "time": {"created": 1_790_000_002_000u64}}));
        part("prt_9", "msg_3", json!({"type": "text", "text": "Done."}));
        // A compaction: the trigger and its summary are left out.
        message("msg_4", "ses_main", 1_790_000_003_000, json!({"role": "user", "time": {"created": 1_790_000_003_000u64}}));
        part("prt_10", "msg_4", json!({"type": "compaction", "auto": true}));
        message("msg_5", "ses_main", 1_790_000_004_000, json!({"role": "assistant", "summary": true, "time": {"created": 1_790_000_004_000u64}}));
        part("prt_11", "msg_5", json!({"type": "text", "text": "Summary of everything"}));
        message("msg_6", "ses_main", 1_790_000_005_000, json!({"role": "user", "time": {"created": 1_790_000_005_000u64}}));
        part("prt_12", "msg_6", json!({"type": "text", "text": "thanks"}));
        message("msg_c", "ses_child", 1_790_000_000_000, json!({"role": "user"}));
    }

    #[test]
    fn opencode_converts_and_reimport_reuses() {
        let roots = testutil::roots("opencode");
        opencode_db(&roots.data_home.join("opencode").join("opencode.db"), false);
        let (found, report) = scan_all(&roots);
        assert!(report.skipped.is_empty(), "{report:?}");
        assert_eq!(found.len(), 1, "the sub-agent session is not offered");
        let s = &found[0];
        assert_eq!((s.source.as_str(), s.id.as_str(), s.messages), ("opencode", "ses_main", 2));
        assert_eq!(s.title, "fix the bug", "the placeholder title gives way to the first prompt");
        assert!(!s.imported);

        let pick = SessionPick { source: "opencode".into(), id: "ses_main".into(), cwd: String::new() };
        let done = import(&roots, &pick).unwrap();
        assert!(!done.reused && done.engine == "lynshen" && done.cwd == "/proj/oc");
        let dir = lynshen_session_dir(&roots.lynshen, "/proj/oc");
        let lines: Vec<Value> = fs::read_to_string(dir.join(format!("{}.jsonl", done.id)))
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        let kinds: Vec<Value> = lines.iter().filter(|l| l["type"] == "entry").map(|l| l["entry"]["kind"].clone()).collect();
        assert_eq!(
            kinds,
            vec![
                json!({"type": "user", "content": "fix the bug\n\n[file: a.png]"}),
                json!({"type": "response_item", "item": {"type": "function_call", "call_id": "call-1", "name": "bash", "arguments": "{\"command\":\"ls\"}"}}),
                json!({"type": "tool_output", "call_id": "call-1", "name": "bash", "output": "a.txt", "image": null}),
                json!({"type": "response_item", "item": {"type": "function_call", "call_id": "call-2", "name": "read", "arguments": "{\"filePath\":\"x\"}"}}),
                json!({"type": "tool_output", "call_id": "call-2", "name": "read", "output": "Error: no such file", "image": null}),
                json!({"type": "response_item", "item": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Done."}]}}),
                json!({"type": "user", "content": "thanks"}),
            ]
        );
        // Entries chain one after another; the state closes the journal.
        let entries: Vec<&Value> = lines.iter().filter(|l| l["type"] == "entry").map(|l| &l["entry"]).collect();
        assert_eq!(entries[0]["parent_id"], Value::Null);
        assert!(entries.windows(2).all(|w| w[1]["parent_id"] == w[0]["id"]));
        assert_eq!(entries[0]["created_at"], 1_790_000_000u64);
        let state = &lines.last().unwrap()["state"];
        assert_eq!(lines.last().unwrap()["type"], "state");
        assert_eq!((state["leaf_id"].as_u64(), state["next_id"].as_u64()), (Some(7), Some(8)));
        assert_eq!(state["branch_heads"], json!({"root": 7}));
        let summary: Value = serde_json::from_str(&fs::read_to_string(dir.join(format!("{}.json", done.id))).unwrap()).unwrap();
        assert_eq!(summary["version"], 3);
        assert_eq!(summary["entries_count"], 7);
        assert_eq!(summary["label"], "fix the bug");
        assert_eq!(summary["journal"], format!("{}.jsonl", done.id));
        assert_eq!(summary["updated_at"], 1_790_000_000u64);
        assert!(done.id.starts_with('s') && done.id.len() > 9);

        let again = import(&roots, &pick).unwrap();
        assert!(again.reused);
        assert_eq!(again.id, done.id);
        assert!(scan_all(&roots).0[0].imported);
        assert!(import(&roots, &SessionPick { source: "opencode".into(), id: "nope".into(), cwd: String::new() }).is_err());
    }

    #[test]
    fn zcode_keeps_interactive_sessions_in_sequence() {
        let roots = testutil::roots("zcode");
        let path = roots.zcode_db();
        opencode_db(&path, true);
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "UPDATE session SET title = 'Named', title_source = 'generated' WHERE id = 'ses_main';
             INSERT INTO session (id, parent_id, directory, title, time_created, time_updated, task_type)
               VALUES ('sess_sub', NULL, '/proj/oc', 'sub', 0, 0, 'subagent_child');
             UPDATE message SET sequence = CAST(substr(id, 5) AS integer);
             UPDATE message SET sequence = 0 WHERE id = 'msg_6';",
        )
        .unwrap();
        drop(conn);
        let (found, _) = scan_all(&roots);
        assert_eq!(found.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["ses_main"]);
        assert_eq!(found[0].title, "Named");
        let conv = load(&roots, Tool::Zcode, "ses_main").unwrap();
        assert_eq!(conv.turns.first().map(|(_, t)| t.clone()), Some(Turn::User("thanks".into())), "zcode's sequence wins over time");
    }


    /// opencode 1.1's JSON files for one conversation in `dir`: a prompt, a
    /// tool round with its reasoning, a reply and another prompt.
    fn json_storage(storage: &Path, id: &str, dir: &str, title: &str) {
        let session = json!({"id": id, "slug": "brave-fox", "projectID": "4b0ea68d", "directory": dir, "title": title,
            "version": "1.1.65", "time": {"created": 1_780_000_000_000u64, "updated": 1_780_000_009_000u64}});
        testutil::write(&storage.join(format!("session/4b0ea68d/{id}.json")), &session.to_string());
        let message = |mid: &str, role: &str, at: u64| {
            let m = json!({"id": mid, "sessionID": id, "role": role, "time": {"created": at}});
            testutil::write(&storage.join(format!("message/{id}/{mid}.json")), &m.to_string());
        };
        let part = |mid: &str, pid: &str, mut p: Value| {
            p.as_object_mut().unwrap().extend([("id".to_string(), json!(pid)), ("messageID".to_string(), json!(mid)), ("sessionID".to_string(), json!(id))]);
            testutil::write(&storage.join(format!("part/{mid}/{pid}.json")), &p.to_string());
        };
        message("msg_a1", "user", 1_780_000_000_000);
        part("msg_a1", "prt_a1", json!({"type": "text", "text": "port it"}));
        message("msg_a2", "assistant", 1_780_000_001_000);
        part("msg_a2", "prt_a2", json!({"type": "reasoning", "text": "hm"}));
        part("msg_a2", "prt_a3", json!({"type": "tool", "callID": "toolu_1", "tool": "read",
            "state": {"status": "completed", "input": {"filePath": "a.rs"}, "output": "fn main() {}"}}));
        part("msg_a2", "prt_a4", json!({"type": "text", "text": "Read it."}));
        message("msg_a3", "user", 1_780_000_002_000);
        part("msg_a3", "prt_a5", json!({"type": "text", "text": "now test it"}));
        // A compaction: its prompt, and the summary that answers it.
        message("msg_a4", "user", 1_780_000_003_000);
        part("msg_a4", "prt_a6", json!({"type": "compaction", "auto": true}));
        let summary = json!({"id": "msg_a5", "sessionID": id, "role": "assistant", "summary": true, "parentID": "msg_a4", "time": {"created": 1_780_000_004_000u64}});
        testutil::write(&storage.join(format!("message/{id}/msg_a5.json")), &summary.to_string());
        part("msg_a5", "prt_a7", json!({"type": "text", "text": "Summary of all"}));
    }

    #[test]
    fn opencode_json_files_of_1_1_are_listed_and_converted() {
        let roots = testutil::roots("opencode-json");
        let storage = roots.data_home.join("opencode").join("storage");
        // Written on Windows: the folder as Windows writes it.
        json_storage(&storage, "ses_json", r"C:\Users\demo\oc", "Port the parser");
        testutil::write(&storage.join("session/4b0ea68d/ses_broken.json"), "{not json");
        let child = json!({"id": "ses_child", "projectID": "4b0ea68d", "directory": "/x", "parentID": "ses_json", "title": "t", "time": {"updated": 1}});
        testutil::write(&storage.join("session/4b0ea68d/ses_child.json"), &child.to_string());
        let (found, report) = scan_all(&roots);
        assert_eq!(found.len(), 1, "{found:?}");
        let s = &found[0];
        assert_eq!((s.id.as_str(), s.title.as_str(), s.cwd.as_str(), s.messages), ("ses_json", "Port the parser", r"C:\Users\demo\oc", 2));
        assert_eq!(s.updated_at_ms, 1_780_000_009_000);
        assert_eq!(report.skipped, vec![Skipped { source: "opencode".into(), count: 1, reason: "session file is not valid JSON".into() }]);
        assert_eq!(
            turns(load(&roots, Tool::Opencode, "ses_json").unwrap()),
            vec![
                Turn::User("port it".into()),
                Turn::Call { call_id: "toolu_1".into(), name: "read".into(), arguments: "{\"filePath\":\"a.rs\"}".into() },
                Turn::Output { call_id: "toolu_1".into(), name: "read".into(), output: "fn main() {}".into() },
                Turn::Assistant("Read it.".into()),
                Turn::User("now test it".into()),
            ]
        );
        let done = import(&roots, &SessionPick { source: "opencode".into(), id: "ses_json".into(), cwd: String::new() }).unwrap();
        assert!(lynshen_session_dir(&roots.lynshen, &done.cwd).join(format!("{}.json", done.id)).is_file());
        assert!(load(&roots, Tool::Opencode, "../../etc").is_err());
    }

    #[test]
    fn the_database_copy_wins_over_the_json_files() {
        let roots = testutil::roots("opencode-both");
        let data = roots.data_home.join("opencode");
        opencode_db(&data.join("opencode.db"), false);
        json_storage(&data.join("storage"), "ses_main", "/proj/oc", "Old JSON title");
        json_storage(&data.join("storage"), "ses_only_json", "/proj/old", "From before 1.2");
        let (found, report) = scan_all(&roots);
        let mut got: Vec<(&str, &str)> = found.iter().map(|f| (f.id.as_str(), f.title.as_str())).collect();
        got.sort();
        assert_eq!(got, [("ses_main", "fix the bug"), ("ses_only_json", "From before 1.2")]);
        assert!(report.log.iter().any(|l| l.starts_with("opencode: 1 in ") && l.contains("; 2 in ")), "{:?}", report.log);
        assert_eq!(turns(load(&roots, Tool::Opencode, "ses_main").unwrap()).len(), 7, "read from the database");
    }

    /// The next layout: `session_v2` and `session_message`, with the old
    /// tables the sessions were copied from.
    fn next_db(path: &Path) {
        opencode_db(path, false);
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE session_v2 (id text primary key, project_id text not null, workspace_id text, parent_id text,
               slug text not null, directory text not null, path text, title text, version text not null,
               time_created integer not null, time_updated integer not null);
             CREATE TABLE session_message (id text primary key, session_id text not null, type text not null,
               seq integer not null, time_created integer not null, time_updated integer not null, data text not null);
             INSERT INTO session_v2 (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
               VALUES ('ses_main', 'p', NULL, 's', 'C:/Users/demo/oc2', NULL, '2', 1, 1790000009000),
                      ('ses_sub', 'p', 'ses_main', 's', 'C:/Users/demo/oc2', 'sub', '2', 1, 1);",
        )
        .unwrap();
        let rows = [
            ("user", json!({"text": "build it", "files": [{"name": "spec.md", "mime": "text/markdown", "data": "eA==", "source": {"type": "inline"}}], "time": {"created": 1_790_000_000_000u64}})),
            ("assistant", json!({"agent": "build", "model": {"id": "m", "providerID": "p"}, "time": {"created": 1_790_000_001_000u64}, "content": [
                {"type": "reasoning", "text": "plan"},
                {"type": "text", "text": "Building."},
                {"type": "tool", "id": "call_9", "name": "shell", "time": {"created": 1}, "state": {"status": "completed", "input": {"command": "make"}, "content": [{"type": "text", "text": "ok"}]}},
                {"type": "tool", "id": "call_10", "name": "read", "time": {"created": 1}, "state": {"status": "error", "input": {"path": "x"}, "error": {"type": "tool.execution", "message": "boom"}}},
                {"type": "tool", "id": "call_11", "name": "write", "time": {"created": 1}, "state": {"status": "streaming", "input": "{\"pa"}}]})),
            ("compaction", json!({"status": "completed", "reason": "auto", "summary": "all of it", "recent": "", "time": {"created": 1_790_000_002_000u64}})),
            ("synthetic", json!({"text": "note", "time": {"created": 1_790_000_003_000u64}})),
            ("user", json!({"text": "again", "time": {"created": 1_790_000_004_000u64}})),
            ("idle", json!({"outcome": "succeeded", "time": {"created": 1_790_000_005_000u64}})),
        ];
        for (seq, (kind, data)) in rows.iter().enumerate() {
            conn.execute(
                "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?1, 'ses_main', ?2, ?3, 0, 0, ?4)",
                params![format!("msg_{seq}"), kind, seq as i64, data.to_string()],
            )
            .unwrap();
        }
    }

    #[test]
    fn the_next_tables_are_read_first() {
        let roots = testutil::roots("opencode-next");
        next_db(&roots.data_home.join("opencode").join("opencode.db"));
        let (found, report) = scan_all(&roots);
        assert!(report.skipped.is_empty(), "{report:?}");
        assert_eq!(found.len(), 1, "the old copy and the sub-agent are not offered: {found:?}");
        let s = &found[0];
        let cwd = if cfg!(windows) { r"C:\Users\demo\oc2" } else { "C:/Users/demo/oc2" };
        assert_eq!((s.id.as_str(), s.title.as_str(), s.cwd.as_str(), s.messages), ("ses_main", "build it", cwd, 2));
        let conv = load(&roots, Tool::Opencode, "ses_main").unwrap();
        assert_eq!(conv.cwd, cwd);
        assert_eq!(
            turns(conv),
            vec![
                Turn::User("build it\n\n[file: spec.md]".into()),
                Turn::Assistant("Building.".into()),
                Turn::Call { call_id: "call_9".into(), name: "shell".into(), arguments: "{\"command\":\"make\"}".into() },
                Turn::Output { call_id: "call_9".into(), name: "shell".into(), output: "ok".into() },
                Turn::Call { call_id: "call_10".into(), name: "read".into(), arguments: "{\"path\":\"x\"}".into() },
                Turn::Output { call_id: "call_10".into(), name: "read".into(), output: "Error: boom".into() },
                Turn::Call { call_id: "call_11".into(), name: "write".into(), arguments: "{}".into() },
                Turn::Output { call_id: "call_11".into(), name: "write".into(), output: "[the tool did not finish]".into() },
                Turn::User("again".into()),
            ]
        );
    }

    #[test]
    fn other_databases_and_unreadable_ones() {
        let base = testutil::fake_home("opencode-dbs");
        let home = base.join("home");
        let h = home.clone();
        let env = move |k: &str| match k {
            "HOME" => Some(h.clone().into_os_string()),
            "OPENCODE_DB" => Some("work.db".into()),
            _ => None,
        };
        let roots = Roots::from_env(&env, false, base.join(".lynshen"));
        let data = home.join(".local/share/opencode");
        opencode_db(&data.join("work.db"), false);
        let conn = Connection::open(data.join("opencode-dev.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE session (id text primary key, parent_id text, directory text not null, title text not null, time_updated integer not null);
             CREATE TABLE message (id text primary key, session_id text not null, time_created integer not null, data text not null);
             CREATE TABLE part (id text primary key, message_id text not null, session_id text not null, data text not null);
             INSERT INTO session VALUES ('ses_dev', NULL, '/proj/dev', 'Dev build', 5);
             INSERT INTO message VALUES ('msg_d', 'ses_dev', 5, '{\"role\":\"user\"}');
             INSERT INTO part VALUES ('prt_d', 'msg_d', 'ses_dev', '{\"type\":\"text\",\"text\":\"hi\"}');
             INSERT INTO message VALUES ('msg_x', 'ses_dev', 6, 'cut short {');",
        )
        .unwrap();
        drop(conn);
        testutil::write(&data.join("opencode.db"), "this is not a database, it is text that goes on for a while");
        let (found, report) = scan_all(&roots);
        let mut ids: Vec<&str> = found.iter().map(|f| f.id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, ["ses_dev", "ses_main"]);
        assert_eq!(report.skipped.len(), 1, "{report:?}");
        assert_eq!((report.skipped[0].source.as_str(), report.skipped[0].count), ("opencode", 0));
        assert!(report.skipped[0].reason.starts_with("opencode.db cannot be read"), "{:?}", report.skipped[0]);
        assert_eq!(turns(load(&roots, Tool::Opencode, "ses_dev").unwrap()), vec![Turn::User("hi".into())]);
    }

    #[test]
    fn windows_folders_get_backslashes() {
        assert_eq!(native_dir("C:/Users/demo/x", true), r"C:\Users\demo\x");
        assert_eq!(native_dir("//server/share/x", true), r"\\server\share\x");
        assert_eq!(native_dir(r"C:\Users\demo", true), r"C:\Users\demo");
        assert_eq!(native_dir("/home/demo", true), "/home/demo");
        assert_eq!(native_dir("C:/Users/demo", false), "C:/Users/demo");
    }
}
