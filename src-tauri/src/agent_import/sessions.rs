//! Conversations of the other agents, across every folder.
//!
//! Claude Code and Codex: listed from their session files and imported with
//! native_import (a cleaned copy resumed on that engine).
//!
//! opencode, zcode, omp and DSH: converted into a LynShen session, the journal and
//! summary `lynshen` itself writes (LynShen-CLI agent-core session.rs):
//! `~/.lynshen/sessions/<fnv1a64 of the folder>/<sid>.jsonl` and `<sid>.json`.
//! What a model needs to continue comes along: the prompts, the assistant's
//! text, and each tool call with its result (a `function_call` item and a
//! `tool_output` entry). Reasoning, step markers and compactions are dropped:
//! reasoning only replays on the account that wrote it, and a compaction's
//! summary stands for history the copy has in full.
//!
//! opencode and zcode are read in opencode.rs, DSH (DeepSeek Harness) in
//! dsh.rs. omp (oh-my-pi) keeps a JSONL tree per conversation under
//! `~/.omp/agent/sessions/<folder>/`; the active branch runs from the last
//! entry back through `parentId`.
//!
//! A conversation that is there but cannot be read (a file that is not JSON,
//! a database that does not open) is not listed; the scan reports it
//! (`Report`), so the page can say how many were left out and why. A source
//! that can tell which conversation it is (DSH) names each one too.

use super::{dsh, opencode, Roots, SessionPick};
use crate::claude_history::{is_session_id, is_synthetic, row_text, truncate_chars};
use crate::native_import::{
    codex_first_prompt, codex_names, codex_thread_prompts, codex_threads, existing_copy, import_claude, import_codex,
    is_compressed, is_conversation, load_registry, mtime_ms, now_ms, rollout_files, same_dir, save_registry,
    ImportRecord, LYNSHEN_ORIGINATOR, MAX_TITLE_CHARS,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// A conversation offered for import.
#[derive(Serialize, Debug, Clone)]
pub struct Found {
    /// "claude", "codex", "opencode", "zcode", "omp" or "dsh".
    pub source: String,
    pub id: String,
    pub title: String,
    /// The folder it ran in.
    pub cwd: String,
    pub updated_at_ms: u64,
    /// Prompts the user sent.
    pub messages: usize,
    /// Imported before: importing again opens that copy.
    pub imported: bool,
}

/// Why conversations were left out, as the page names it (the English
/// `reason` goes to the log).
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkipKind {
    /// A file, folder or database cannot be opened or read.
    Unreadable,
    /// Not in a form this version knows (not JSON, no header, no id).
    Unrecognised,
    /// No working folder recorded.
    NoFolder,
    /// Compressed (.jsonl.zst).
    Compressed,
    /// Saved by an older version of the tool, which updates it when the
    /// conversation is opened there (DSH).
    OldFormat,
    /// Saved by a newer version of the tool than this one can read.
    NewerFormat,
}

impl SkipKind {
    /// The name the page knows it by (as serialized).
    pub(super) fn name(self) -> &'static str {
        match self {
            SkipKind::Unreadable => "unreadable",
            SkipKind::Unrecognised => "unrecognised",
            SkipKind::NoFolder => "no_folder",
            SkipKind::Compressed => "compressed",
            SkipKind::OldFormat => "old_format",
            SkipKind::NewerFormat => "newer_format",
        }
    }
}

/// Conversations of one tool a scan found but could not read, for one reason.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Skipped {
    pub source: String,
    /// How many; 0 when a whole store (a database) could not be read.
    pub count: usize,
    pub kind: SkipKind,
    pub reason: String,
}

/// One conversation the scan found but cannot import, and why, for the
/// page to show in its place (only DSH can name them so far).
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Unreadable {
    pub source: String,
    pub id: String,
    /// Its title there; empty when unknown.
    pub title: String,
    /// The folder it ran in; empty when none is recorded.
    pub cwd: String,
    pub updated_at_ms: u64,
    pub kind: SkipKind,
}

/// What a scan saw besides the conversations it lists: what it could not
/// read (shown on the page; `unreadable` names the conversations where the
/// source can) and, per tool, where it looked (for the log; each line starts
/// with `<source>: `).
#[derive(Default, Debug)]
pub struct Report {
    pub skipped: Vec<Skipped>,
    pub unreadable: Vec<Unreadable>,
    pub log: Vec<String>,
}

impl Report {
    pub(super) fn skip(&mut self, source: &str, kind: SkipKind, reason: impl Into<String>) {
        self.skip_n(source, 1, kind, reason);
    }

    pub(super) fn skip_n(&mut self, source: &str, count: usize, kind: SkipKind, reason: impl Into<String>) {
        let reason = reason.into();
        if count == 0 {
            return;
        }
        match self.skipped.iter_mut().find(|s| s.source == source && s.reason == reason && s.count > 0) {
            Some(s) => s.count += count,
            None => self.skipped.push(Skipped { source: source.into(), count, kind, reason }),
        }
    }

    /// A whole store (a database) could not be read.
    pub(super) fn store_failed(&mut self, source: &str, reason: impl Into<String>) {
        self.skipped.push(Skipped { source: source.into(), count: 0, kind: SkipKind::Unreadable, reason: reason.into() });
    }

    pub(super) fn note(&mut self, source: &str, text: impl AsRef<str>) {
        self.log.push(format!("{source}: {}", text.as_ref()));
    }
}

pub fn scan(roots: &Roots, report: &mut Report) -> Vec<Found> {
    let registry = load_registry(&roots.registry());
    let mut out = scan_claude(roots, &registry, report);
    out.extend(scan_codex(roots, &registry, report));
    out.extend(opencode::scan(roots, opencode::Tool::Opencode, &registry, report));
    out.extend(opencode::scan(roots, opencode::Tool::Zcode, &registry, report));
    out.extend(scan_omp(roots, &registry, report));
    out.extend(dsh::scan(roots, &registry, report));
    out.sort_by_key(|s| std::cmp::Reverse(s.updated_at_ms));
    out
}

pub struct Imported {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub engine: &'static str,
    /// An earlier copy was reused.
    pub reused: bool,
}

pub fn import(roots: &Roots, pick: &SessionPick) -> Result<Imported, String> {
    match pick.source.as_str() {
        "claude" | "codex" => {
            let h = roots.native();
            // An import that writes a copy records it; one that finds a copy does not.
            let before = load_registry(&h.registry).len();
            let (engine, done) = if pick.source == "claude" {
                ("claude", import_claude(&h, &pick.cwd, &pick.id)?)
            } else {
                ("codex", import_codex(&h, &pick.cwd, &pick.id)?)
            };
            Ok(Imported {
                id: done.id,
                title: done.title,
                cwd: folder_key(&pick.cwd),
                engine,
                reused: load_registry(&h.registry).len() == before,
            })
        }
        "opencode" => {
            import_converted(roots, "opencode", &pick.id, opencode::load(roots, opencode::Tool::Opencode, &pick.id)?)
        }
        "zcode" => import_converted(roots, "zcode", &pick.id, opencode::load(roots, opencode::Tool::Zcode, &pick.id)?),
        "omp" => import_converted(roots, "omp", &pick.id, load_omp(roots, &pick.id)?),
        "dsh" => {
            let mut conv = dsh::load(roots, &pick.id)?;
            // Picked in a project's history: the project's own spelling of the folder.
            if !pick.cwd.is_empty() && same_dir(&pick.cwd, &conv.cwd) {
                conv.cwd = pick.cwd.clone();
            }
            import_converted(roots, dsh::SOURCE, &pick.id, conv)
        }
        other => Err(format!("unknown source: {other}")),
    }
}

fn copies_of<'a>(registry: &'a [ImportRecord], source: &str) -> HashSet<&'a str> {
    registry.iter().filter(|r| r.source == source).map(|r| r.to.as_str()).collect()
}

// --- Claude Code -------------------------------------------------------------

/// What the list shows of a Claude Code session file.
#[derive(Debug, Default, PartialEq)]
pub(super) struct ClaudeFile {
    /// The folder it belongs to: the last `relocated` row's, else the first
    /// row's `cwd` (as Claude Code decides it).
    pub cwd: Option<String>,
    /// Prompts the user typed (not tool results, slash-command echoes,
    /// sub-agent or compaction rows).
    pub prompts: usize,
    /// The name the user gave it, else Claude's title, else the first prompt.
    pub title: String,
}

pub(super) fn first_line_of(text: &str) -> String {
    truncate_chars(text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or(""), MAX_TITLE_CHARS)
}

/// Reads a Claude Code session file in one pass. Only rows that can matter
/// are parsed: files reach 100 MB and most of it is tool output. An error
/// says why the file cannot be read as a session.
pub(super) fn read_claude(path: &Path) -> Result<ClaudeFile, (SkipKind, String)> {
    let file = fs::File::open(path).map_err(|e| (SkipKind::Unreadable, format!("file cannot be opened ({e})")))?;
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    let (mut lines, mut parsed) = (0usize, 0usize);
    let (mut cwd, mut relocated) = (None::<String>, None::<String>);
    let (mut custom, mut ai, mut first) = (String::new(), String::new(), String::new());
    let mut prompts = 0;
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) => break,
            Ok(_) => {}
            Err(e) => return Err((SkipKind::Unreadable, format!("file cannot be read ({e})"))),
        }
        let text = String::from_utf8_lossy(&line);
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        lines += 1;
        // The first row that parses says whether this is a session file;
        // after it, a row is parsed only for what it may hold. A tool result
        // is never a prompt (`"type":"tool_result"` unescaped is structure,
        // never text inside a string).
        let wanted = parsed == 0
            || (text.contains("\"type\":\"user\"") && !text.contains("\"type\":\"tool_result\""))
            || (cwd.is_none() && text.contains("\"cwd\":"))
            || text.contains("\"relocatedCwd\":")
            || text.contains("-title\"");
        if !wanted {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(text) else { continue };
        if !v.is_object() {
            continue;
        }
        parsed += 1;
        if cwd.is_none() {
            cwd = v["cwd"].as_str().filter(|c| !c.is_empty()).map(str::to_string);
        }
        match v["type"].as_str() {
            Some("relocated") => {
                if let Some(c) = v["relocatedCwd"].as_str().filter(|c| !c.is_empty()) {
                    relocated = Some(c.to_string());
                }
            }
            Some("custom-title") => {
                if let Some(t) = v["customTitle"].as_str().filter(|t| !t.trim().is_empty()) {
                    custom = first_line_of(t);
                }
            }
            Some("ai-title") => {
                if let Some(t) = v["aiTitle"].as_str().filter(|t| !t.trim().is_empty()) {
                    ai = first_line_of(t);
                }
            }
            Some("user") => {
                let tool_result = v
                    .pointer("/message/content")
                    .and_then(Value::as_array)
                    .is_some_and(|c| c.iter().any(|b| b["type"].as_str() == Some("tool_result")));
                if !tool_result && !is_synthetic(&v) {
                    if let Some(t) = row_text(&v) {
                        prompts += 1;
                        if first.is_empty() {
                            first = first_line_of(&t);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    if lines > 0 && parsed == 0 {
        return Err((SkipKind::Unrecognised, "not a session file (no JSON rows)".to_string()));
    }
    let title = [custom, ai, first].into_iter().find(|t| !t.is_empty()).unwrap_or_default();
    Ok(ClaudeFile { cwd: relocated.or(cwd), prompts, title })
}

fn scan_claude(roots: &Roots, registry: &[ImportRecord], report: &mut Report) -> Vec<Found> {
    let copies = copies_of(registry, "claude");
    let projects = roots.claude.join("projects");
    let mut out = Vec::new();
    let Ok(dirs) = fs::read_dir(&projects) else {
        report.note("claude", format!("no {}", projects.display()));
        return out;
    };
    let (mut files, mut empty) = (0, 0);
    for dir in dirs.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
        let Ok(entries) = fs::read_dir(&dir) else {
            report.skip("claude", SkipKind::Unreadable, "a project folder cannot be read");
            continue;
        };
        for path in entries.flatten().map(|e| e.path()) {
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            // Sub-agent streams of older versions sit beside the sessions.
            let Some(id) = path.file_stem().and_then(|s| s.to_str()).filter(|s| is_session_id(s) && !s.starts_with("agent-"))
            else {
                continue;
            };
            if copies.contains(id) {
                continue;
            }
            files += 1;
            let info = match read_claude(&path) {
                Ok(info) => info,
                Err((kind, reason)) => {
                    report.skip("claude", kind, reason);
                    continue;
                }
            };
            if info.prompts == 0 {
                empty += 1;
                continue;
            }
            let Some(cwd) = info.cwd else {
                report.skip("claude", SkipKind::NoFolder, "no working folder recorded");
                continue;
            };
            out.push(Found {
                source: "claude".into(),
                id: id.into(),
                title: info.title,
                imported: existing_copy(registry, "claude", id, |to| dir.join(format!("{to}.jsonl")).is_file()).is_some(),
                cwd,
                updated_at_ms: mtime_ms(&path),
                messages: info.prompts,
            });
        }
    }
    report.note("claude", format!("{files} session files in {} ({empty} without prompts)", projects.display()));
    out
}

// --- Codex -------------------------------------------------------------------

fn scan_codex(roots: &Roots, registry: &[ImportRecord], report: &mut Report) -> Vec<Found> {
    let threads = codex_threads(&roots.codex);
    // Rollout files that are not part of a thread: no `session_meta` first
    // line, or a compressed one that does not decompress.
    let known: HashSet<&Path> = threads.values().flatten().map(|s| s.path.as_path()).collect();
    let files = rollout_files(&roots.codex);
    let (compressed, plain): (Vec<&PathBuf>, Vec<&PathBuf>) = files.iter().partition(|p| is_compressed(p));
    let unknown = |list: &[&PathBuf]| {
        list.iter().filter(|p| !known.contains(p.as_path()) && fs::metadata(p).is_ok_and(|m| m.len() > 0)).count()
    };
    report.skip_n("codex", unknown(&plain), SkipKind::Unrecognised, "no session header (session_meta)");
    report.skip_n("codex", unknown(&compressed), SkipKind::Compressed, "compressed (.jsonl.zst) and cannot be decompressed");
    report.note(
        "codex",
        format!(
            "{} rollout files ({} compressed), {} threads in {}",
            files.len(),
            compressed.len(),
            threads.len(),
            roots.codex.display()
        ),
    );
    if threads.is_empty() {
        return Vec::new();
    }
    let copies = copies_of(registry, "codex");
    let names = codex_names(&roots.codex);
    let mut out = Vec::new();
    for (id, segs) in &threads {
        if copies.contains(id.as_str())
            || !is_conversation(segs)
            || segs[0].meta["originator"].as_str() == Some(LYNSHEN_ORIGINATOR)
        {
            continue;
        }
        let Some(cwd) = segs[0].meta["cwd"].as_str() else {
            report.skip("codex", SkipKind::NoFolder, "no working folder recorded");
            continue;
        };
        let live: Vec<_> = segs.iter().filter(|s| !s.archived).collect();
        // A fork's own files: its prompts since the fork.
        let prompts = codex_thread_prompts(&threads, id);
        let title = names
            .get(id)
            .map(|n| truncate_chars(n, MAX_TITLE_CHARS))
            .unwrap_or_else(|| codex_first_prompt(&segs[0].path));
        if prompts == 0 && title.is_empty() {
            continue;
        }
        out.push(Found {
            source: "codex".into(),
            id: id.clone(),
            title,
            cwd: cwd.to_string(),
            updated_at_ms: live.iter().map(|s| mtime_ms(&s.path)).max().unwrap_or(0),
            messages: prompts,
            imported: existing_copy(registry, "codex", id, |to| threads.contains_key(to)).is_some(),
        });
    }
    out
}

// --- converted conversations -------------------------------------------------

/// One step of a conversation, as a LynShen session entry records it.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Turn {
    User(String),
    Assistant(String),
    Call { call_id: String, name: String, arguments: String },
    Output { call_id: String, name: String, output: String },
}

impl Turn {
    /// The entry `kind` (LynShen-CLI session.rs `entry_to_json`).
    fn kind(&self) -> Value {
        match self {
            Turn::User(text) => json!({ "type": "user", "content": text }),
            Turn::Assistant(text) => json!({
                "type": "response_item",
                "item": { "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": text }] }
            }),
            Turn::Call { call_id, name, arguments } => json!({
                "type": "response_item",
                "item": { "type": "function_call", "call_id": call_id, "name": name, "arguments": arguments }
            }),
            Turn::Output { call_id, name, output } => json!({
                "type": "tool_output", "call_id": call_id, "name": name, "output": output, "image": null
            }),
        }
    }
}

/// A conversation read from another agent, ready to write.
pub(super) struct Conversation {
    /// Its title there; empty when it had none.
    pub title: String,
    pub cwd: String,
    pub updated_s: u64,
    /// Each with the second it happened (0: unknown).
    pub turns: Vec<(u64, Turn)>,
}

/// Longest tool output kept; the model saw the rest once, and a resumed
/// session would carry it in every request.
const MAX_OUTPUT_CHARS: usize = 32_000;
/// The session name the CLI derives from the first prompt (session.rs
/// `SESSION_LABEL_MAX_CHARS`).
const LABEL_CHARS: usize = 72;

/// A tool-call id the Responses API accepts.
fn clean_call_id(raw: &str) -> String {
    let id: String = raw.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-')).take(64).collect();
    if id.is_empty() { "call".to_string() } else { id }
}

/// A function name the APIs accept (`^[A-Za-z0-9_-]{1,64}$`).
fn clean_tool_name(raw: &str) -> String {
    let name: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '_' | '-') { c } else { '_' })
        .take(64)
        .collect();
    if name.is_empty() { "tool".to_string() } else { name }
}

fn clip(text: String) -> String {
    match text.char_indices().nth(MAX_OUTPUT_CHARS) {
        Some((cut, _)) => format!("{}\n[truncated on import]", &text[..cut]),
        None => text,
    }
}

/// Makes the turns a valid request history: ids cleaned and unique, every
/// call followed by its output (a call without one, or an output without its
/// call, is dropped — the API rejects either), empty text gone and an
/// assistant's consecutive texts joined.
pub(super) fn tidy(turns: Vec<(u64, Turn)>) -> Vec<(u64, Turn)> {
    let mut out: Vec<(u64, Turn)> = Vec::with_capacity(turns.len());
    let mut used: HashSet<String> = HashSet::new();
    // A call's id as written there → the id it gets here, until answered.
    let mut open: HashMap<String, String> = HashMap::new();
    let mut answered: HashSet<String> = HashSet::new();
    for (at, turn) in turns {
        match turn {
            Turn::User(text) => {
                let text = text.trim();
                if !text.is_empty() {
                    out.push((at, Turn::User(text.to_string())));
                }
            }
            Turn::Assistant(text) => {
                let text = text.trim();
                if text.is_empty() {
                    continue;
                }
                if let Some((_, Turn::Assistant(prev))) = out.last_mut() {
                    prev.push_str("\n\n");
                    prev.push_str(text);
                } else {
                    out.push((at, Turn::Assistant(text.to_string())));
                }
            }
            Turn::Call { call_id, name, arguments } => {
                let base = clean_call_id(&call_id);
                let mut id = base.clone();
                let mut n = 2;
                while !used.insert(id.clone()) {
                    id = format!("{base}_{n}");
                    n += 1;
                }
                open.insert(call_id, id.clone());
                out.push((at, Turn::Call { call_id: id, name: clean_tool_name(&name), arguments }));
            }
            Turn::Output { call_id, name, output } => {
                let Some(id) = open.remove(&call_id) else { continue };
                answered.insert(id.clone());
                out.push((at, Turn::Output { call_id: id, name: clean_tool_name(&name), output: clip(output) }));
            }
        }
    }
    out.retain(|(_, t)| !matches!(t, Turn::Call { call_id, .. } if !answered.contains(call_id)));
    out
}

pub(super) fn first_prompt(turns: &[(u64, Turn)]) -> String {
    turns
        .iter()
        .find_map(|(_, t)| match t {
            Turn::User(text) => text.lines().map(str::trim).find(|l| !l.is_empty()),
            _ => None,
        })
        .map(|l| truncate_chars(l, MAX_TITLE_CHARS))
        .unwrap_or_default()
}

/// The folder as the desktop and the daemon name it: its real path while it
/// exists (projects are added canonicalized), else as recorded.
pub(super) fn folder_key(cwd: &str) -> String {
    let trimmed = if cwd.len() > 1 { cwd.trim_end_matches(['/', '\\']) } else { cwd };
    match fs::canonicalize(trimmed) {
        Ok(real) => {
            let real = real.to_string_lossy().into_owned();
            // Windows canonicalizes to `\\?\C:\...`; sessions are keyed by `C:\...`.
            match real.strip_prefix(r"\\?\") {
                Some(plain) if !plain.starts_with("UNC\\") => plain.to_string(),
                _ => real,
            }
        }
        Err(_) => trimmed.to_string(),
    }
}

/// `sessions/<fnv1a64 of the folder>` (session.rs `hash_path`).
pub(super) fn lynshen_session_dir(lynshen: &Path, cwd: &str) -> PathBuf {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in cwd.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    lynshen.join("sessions").join(format!("{hash:016x}"))
}

/// session.rs `single_line_with_limit`: what the CLI shows as a name.
fn label_of(text: &str) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = compact.chars();
    let prefix: String = chars.by_ref().take(LABEL_CHARS).collect();
    if chars.next().is_some() { format!("{prefix}...") } else { prefix }
}

fn write_file(path: &Path, text: &str) -> Result<(), String> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("session");
    let tmp = path.with_file_name(format!(".{name}.import.tmp"));
    fs::write(&tmp, text).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

/// Writes the turns as a new LynShen session in `dir`, the way a first save
/// writes one (entries, then the state); returns its id. The summary goes
/// last: a listing never sees a session without its journal.
pub(super) fn write_session(dir: &Path, title: &str, updated_s: u64, turns: &[(u64, Turn)]) -> Result<String, String> {
    fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    // `s{secs:x}{nanos:08x}` like the CLI's; bumped past any taken one.
    let mut nanos = now.subsec_nanos();
    let sid = loop {
        let sid = format!("s{:x}{nanos:08x}", now.as_secs());
        if !dir.join(format!("{sid}.json")).exists() && !dir.join(format!("{sid}.jsonl")).exists() {
            break sid;
        }
        nanos = nanos.wrapping_add(1);
    };
    let created = turns.iter().map(|(at, _)| *at).find(|at| *at > 0).unwrap_or(updated_s);
    let updated = updated_s.max(created);
    let mut journal = String::new();
    for (i, (at, turn)) in turns.iter().enumerate() {
        let id = i as u64 + 1;
        let entry = json!({
            "id": id,
            "parent_id": (id > 1).then(|| id - 1),
            "created_at": if *at > 0 { *at } else { created },
            "kind": turn.kind(),
        });
        journal.push_str(&json!({ "type": "entry", "entry": entry }).to_string());
        journal.push('\n');
    }
    let leaf = turns.len() as u64;
    let state = json!({
        "version": 1,
        "id": sid,
        "created_at": created,
        "updated_at": updated,
        "leaf_id": leaf,
        "next_id": leaf + 1,
        "branch_heads": { "root": leaf },
        "resume_summary": null,
        "resume_status": null,
        "resume_summary_updated_at": null,
        "goal": null,
    });
    journal.push_str(&json!({ "type": "state", "state": state }).to_string());
    journal.push('\n');
    let summary = json!({
        "version": 3,
        "id": sid,
        "created_at": created,
        "updated_at": updated,
        "leaf_id": leaf,
        "next_id": leaf + 1,
        "branch_heads": { "root": leaf },
        "entries_count": turns.len(),
        // The daemon lists a session by this; its title there reads better
        // than the first prompt the CLI would derive.
        "label": label_of(title),
        "resume_summary": null,
        "resume_status": null,
        "resume_summary_updated_at": null,
        "goal": null,
        "journal": format!("{sid}.jsonl"),
    });
    write_file(&dir.join(format!("{sid}.jsonl")), &journal)?;
    let text = serde_json::to_string_pretty(&summary).map_err(|e| e.to_string())? + "\n";
    write_file(&dir.join(format!("{sid}.json")), &text)?;
    Ok(sid)
}

fn import_converted(roots: &Roots, source: &str, id: &str, conv: Conversation) -> Result<Imported, String> {
    let cwd = folder_key(&conv.cwd);
    let dir = lynshen_session_dir(&roots.lynshen, &cwd);
    let mut registry = load_registry(&roots.registry());
    let title = if conv.title.is_empty() { first_prompt(&conv.turns) } else { conv.title };
    if let Some(to) = existing_copy(&registry, source, id, |to| dir.join(format!("{to}.json")).exists()) {
        return Ok(Imported { id: to, title, cwd, engine: "lynshen", reused: true });
    }
    let turns = tidy(conv.turns);
    if !turns.iter().any(|(_, t)| matches!(t, Turn::User(_))) {
        return Err("this conversation has no messages to import".to_string());
    }
    let sid = write_session(&dir, &title, conv.updated_s, &turns)?;
    registry.push(ImportRecord { source: source.into(), from: id.into(), to: sid.clone(), at_ms: now_ms() });
    save_registry(&roots.registry(), &registry)?;
    Ok(Imported { id: sid, title, cwd, engine: "lynshen", reused: false })
}

/// The LynShen copy an earlier import made of a converted conversation,
/// while it is still there.
pub(super) fn converted_copy(roots: &Roots, registry: &[ImportRecord], source: &str, id: &str, cwd: &str) -> Option<String> {
    let dir = lynshen_session_dir(&roots.lynshen, &folder_key(cwd));
    existing_copy(registry, source, id, |to| dir.join(format!("{to}.json")).exists())
}

pub(super) fn converted_imported(roots: &Roots, registry: &[ImportRecord], source: &str, id: &str, cwd: &str) -> bool {
    converted_copy(roots, registry, source, id, cwd).is_some()
}

// --- omp ---------------------------------------------------------------------

struct OmpFile {
    id: String,
    cwd: String,
    title: String,
    entries: Vec<Value>,
}

/// Session files in every folder omp may keep sessions in (`<dir>/<folder>/*.jsonl`;
/// a sub-agent's files sit a level deeper, in its parent's own folder).
fn omp_files(roots: &Roots) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for root in roots.omp_session_dirs() {
        let Ok(dirs) = fs::read_dir(&root) else { continue };
        for dir in dirs.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
            let Ok(files) = fs::read_dir(&dir) else { continue };
            out.extend(
                files
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("jsonl")),
            );
        }
    }
    out
}

/// A session file: an optional fixed-width `title` slot, the `session`
/// header, then the entries. `Ok(None)`: a sub-agent's or a fork's session,
/// which is part of the conversation it came from.
fn read_omp(path: &Path) -> Result<Option<OmpFile>, (SkipKind, String)> {
    let text = fs::read_to_string(path).map_err(|e| (SkipKind::Unreadable, format!("file cannot be read ({e})")))?;
    let mut slot_title = String::new();
    let mut header: Option<Value> = None;
    let mut entries = Vec::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        match (&header, v["type"].as_str()) {
            (None, Some("title")) => slot_title = v["title"].as_str().unwrap_or("").to_string(),
            (None, Some("session")) => header = Some(v),
            (Some(_), _) => entries.push(v),
            _ => {}
        }
    }
    let header = header.ok_or((SkipKind::Unrecognised, "no session header".to_string()))?;
    if header["parentSession"].as_str().is_some_and(|p| !p.is_empty()) {
        return Ok(None);
    }
    let title = Some(slot_title.trim())
        .filter(|t| !t.is_empty())
        .or_else(|| header["title"].as_str().map(str::trim))
        .map(|t| truncate_chars(t, MAX_TITLE_CHARS))
        .unwrap_or_default();
    let (Some(id), Some(cwd)) = (header["id"].as_str(), header["cwd"].as_str()) else {
        return Err((SkipKind::Unrecognised, "session header without an id or folder".to_string()));
    };
    Ok(Some(OmpFile { id: id.to_string(), cwd: cwd.to_string(), title, entries }))
}

/// The active branch: from the last entry back to the root (omp rebuilds
/// its leaf from the last physical entry).
fn omp_branch(entries: &[Value]) -> Vec<&Value> {
    let by_id: HashMap<&str, &Value> = entries.iter().filter_map(|e| Some((e["id"].as_str()?, e))).collect();
    let mut path = Vec::new();
    let mut seen = HashSet::new();
    let mut current = entries.iter().rev().find_map(|e| e["id"].as_str());
    while let Some(id) = current {
        if !seen.insert(id) {
            break;
        }
        let Some(entry) = by_id.get(id) else { break };
        path.push(*entry);
        current = entry["parentId"].as_str();
    }
    path.reverse();
    path
}

/// Text of a message's content (a string, or text and image blocks).
fn omp_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|b| match b["type"].as_str() {
                Some("text") => b["text"].as_str().map(str::to_string),
                Some("image") => Some("[image]".to_string()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

pub(super) fn convert_omp(entries: &[Value]) -> Vec<(u64, Turn)> {
    let mut turns = Vec::new();
    for entry in omp_branch(entries) {
        // compaction, branch_summary, model_change, custom … carry no turns.
        if entry["type"].as_str() != Some("message") {
            continue;
        }
        let m = &entry["message"];
        let at = m["timestamp"].as_u64().unwrap_or(0) / 1000;
        match m["role"].as_str() {
            Some("user") if m["synthetic"] != json!(true) => turns.push((at, Turn::User(omp_text(&m["content"])))),
            Some("assistant") => {
                for block in m["content"].as_array().into_iter().flatten() {
                    match block["type"].as_str() {
                        Some("text") => {
                            turns.push((at, Turn::Assistant(block["text"].as_str().unwrap_or("").to_string())))
                        }
                        Some("toolCall") => turns.push((
                            at,
                            Turn::Call {
                                call_id: block["id"].as_str().unwrap_or("").to_string(),
                                name: block["name"].as_str().unwrap_or("tool").to_string(),
                                arguments: match &block["arguments"] {
                                    Value::Null => "{}".to_string(),
                                    Value::String(s) => s.clone(),
                                    args => args.to_string(),
                                },
                            },
                        )),
                        // thinking, redactedThinking
                        _ => {}
                    }
                }
            }
            Some("toolResult") => {
                let text = omp_text(&m["content"]);
                turns.push((
                    at,
                    Turn::Output {
                        call_id: m["toolCallId"].as_str().unwrap_or("").to_string(),
                        name: m["toolName"].as_str().unwrap_or("tool").to_string(),
                        output: if m["isError"] == json!(true) { format!("Error: {text}") } else { text },
                    },
                ))
            }
            // developer, bashExecution, fileMention …
            _ => {}
        }
    }
    turns
}

fn scan_omp(roots: &Roots, registry: &[ImportRecord], report: &mut Report) -> Vec<Found> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let files = omp_files(roots);
    for path in &files {
        let file = match read_omp(path) {
            Ok(Some(file)) => file,
            Ok(None) => continue,
            Err((kind, reason)) => {
                report.skip("omp", kind, reason);
                continue;
            }
        };
        let turns = convert_omp(&file.entries);
        let prompts = turns.iter().filter(|(_, t)| matches!(t, Turn::User(s) if !s.trim().is_empty())).count();
        if prompts == 0 || !seen.insert(file.id.clone()) {
            continue;
        }
        out.push(Found {
            source: "omp".into(),
            title: if file.title.is_empty() { first_prompt(&turns) } else { file.title },
            imported: converted_imported(roots, registry, "omp", &file.id, &file.cwd),
            id: file.id,
            cwd: file.cwd,
            updated_at_ms: mtime_ms(path),
            messages: prompts,
        });
    }
    if !files.is_empty() {
        let dirs: Vec<String> = roots.omp_session_dirs().iter().filter(|d| d.is_dir()).map(|d| d.display().to_string()).collect();
        report.note("omp", format!("{} session files in {}", files.len(), dirs.join(", ")));
    }
    out
}

fn load_omp(roots: &Roots, id: &str) -> Result<Conversation, String> {
    for path in omp_files(roots) {
        let Ok(Some(file)) = read_omp(&path) else { continue };
        if file.id != id {
            continue;
        }
        return Ok(Conversation {
            title: file.title,
            cwd: file.cwd,
            updated_s: mtime_ms(&path) / 1000,
            turns: convert_omp(&file.entries),
        });
    }
    Err(format!("omp conversation {id} not found"))
}

#[cfg(test)]
mod tests {
    use super::super::testutil::{self, scan_all};
    use super::*;
    use crate::native_import::claude_copy_path;


    fn lines(rows: &[Value]) -> String {
        rows.iter().map(|r| r.to_string() + "\n").collect()
    }

    fn call(id: &str) -> Turn {
        Turn::Call { call_id: id.into(), name: "bash".into(), arguments: "{}".into() }
    }
    fn output(id: &str) -> Turn {
        Turn::Output { call_id: id.into(), name: "bash".into(), output: "ok".into() }
    }

    #[test]
    fn tidy_pairs_calls_and_cleans_ids() {
        let turns = vec![
            (1, Turn::User("  hi ".into())),
            (1, Turn::Assistant("one".into())),
            (1, Turn::Assistant("two".into())),
            (2, call("call:1/x")),
            (2, output("call:1/x")),
            (3, call("lost")),
            (3, output("never-called")),
            (4, call("dup")),
            (4, output("dup")),
            (4, call("dup")),
            (4, output("dup")),
            (5, Turn::Assistant("   ".into())),
        ];
        let got = tidy(turns);
        assert_eq!(
            got.iter().map(|(_, t)| t.clone()).collect::<Vec<_>>(),
            vec![
                Turn::User("hi".into()),
                Turn::Assistant("one\n\ntwo".into()),
                call("call1x"),
                output("call1x"),
                call("dup"),
                output("dup"),
                call("dup_2"),
                output("dup_2"),
            ]
        );
        let long = tidy(vec![(0, call("a")), (0, Turn::Output { call_id: "a".into(), name: "mcp.x y".into(), output: "x".repeat(MAX_OUTPUT_CHARS + 5) })]);
        match &long[1].1 {
            Turn::Output { name, output, .. } => {
                assert_eq!(name, "mcp_x_y");
                assert!(output.ends_with("[truncated on import]"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn omp_follows_the_active_branch() {
        let roots = testutil::roots("omp");
        let cwd = roots.home.join("work");
        fs::create_dir_all(&cwd).unwrap();
        let cwd = cwd.to_string_lossy().to_string();
        let rows = [
            json!({"type": "title", "v": 1, "title": "Port the parser", "updatedAt": "x", "pad": "   "}),
            json!({"type": "session", "version": 3, "id": "019c625b-b900-7000-8000-000000000001", "cwd": cwd}),
            json!({"type": "model_change", "id": "m0", "parentId": null, "model": "anthropic/x"}),
            json!({"type": "message", "id": "a1", "parentId": "m0", "message": {"role": "user", "content": "port it", "timestamp": 1_790_000_000_000u64}}),
            json!({"type": "message", "id": "a2", "parentId": "a1", "message": {"role": "assistant", "content": [
                {"type": "thinking", "thinking": "hm", "thinkingSignature": "sig"},
                {"type": "text", "text": "Reading."},
                {"type": "toolCall", "id": "toolu_01", "name": "read", "arguments": {"path": "a.rs"}}]}}),
            json!({"type": "message", "id": "a3", "parentId": "a2", "message": {"role": "toolResult", "toolCallId": "toolu_01", "toolName": "read", "content": [{"type": "text", "text": "fn main() {}"}], "isError": false}}),
            json!({"type": "message", "id": "b1", "parentId": "a3", "message": {"role": "user", "content": [{"type": "text", "text": "abandoned"}]}}),
            json!({"type": "compaction", "id": "a4", "parentId": "a3", "summary": "x", "firstKeptEntryId": "a1"}),
            json!({"type": "message", "id": "a5", "parentId": "a4", "message": {"role": "user", "content": [{"type": "text", "text": "now test it"}, {"type": "image", "data": "..", "mimeType": "image/png"}]}}),
        ];
        let text: Vec<String> = rows.iter().map(|r| r.to_string()).collect();
        testutil::write(&roots.omp_agent().join("sessions/-work/2026_019c.jsonl"), &(text.join("\n") + "\n"));
        // A sub-agent's file is not a conversation of its own.
        testutil::write(
            &roots.omp_agent().join("sessions/-work/2026_sub.jsonl"),
            &format!("{}\n", json!({"type": "session", "id": "sub", "cwd": cwd, "parentSession": "019c625b"})),
        );
        let (found, report) = scan_all(&roots);
        assert!(report.skipped.is_empty(), "{report:?}");
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].title.as_str(), found[0].messages), ("Port the parser", 2));
        let conv = load_omp(&roots, "019c625b-b900-7000-8000-000000000001").unwrap();
        let turns: Vec<Turn> = tidy(conv.turns).into_iter().map(|(_, t)| t).collect();
        assert_eq!(
            turns,
            vec![
                Turn::User("port it".into()),
                Turn::Assistant("Reading.".into()),
                Turn::Call { call_id: "toolu_01".into(), name: "read".into(), arguments: "{\"path\":\"a.rs\"}".into() },
                Turn::Output { call_id: "toolu_01".into(), name: "read".into(), output: "fn main() {}".into() },
                Turn::User("now test it\n[image]".into()),
            ]
        );
        let pick = SessionPick { source: "omp".into(), id: found[0].id.clone(), cwd: String::new() };
        let done = import(&roots, &pick).unwrap();
        assert_eq!(done.cwd, folder_key(&cwd));
        assert!(lynshen_session_dir(&roots.lynshen, &done.cwd).join(format!("{}.json", done.id)).exists());
    }

    #[test]
    fn claude_sessions_are_found_by_the_folder_in_their_rows() {
        let roots = testutil::roots("claude-scan");
        let cwd = "/proj/claude demo";
        let id = "aaaaaaaa-1111-4111-8111-111111111111";
        let path = claude_copy_path(&roots.native(), cwd, id);
        let rows = [
            json!({"type": "queue-operation", "content": "x"}),
            json!({"type": "user", "cwd": cwd, "uuid": "u1", "message": {"role": "user", "content": "hello there"}}),
            json!({"type": "assistant", "cwd": cwd, "uuid": "a1", "message": {"content": [{"type": "tool_use", "id": "t", "name": "Bash", "input": {}}]}}),
            json!({"type": "user", "cwd": cwd, "uuid": "u2", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t", "content": "ok"}]}}),
            json!({"type": "user", "cwd": cwd, "isMeta": true, "message": {"role": "user", "content": "<local-command-caveat>"}}),
            json!({"type": "user", "cwd": cwd, "uuid": "u3", "message": {"role": "user", "content": [{"type": "text", "text": "and again"}]}}),
        ];
        let text: Vec<String> = rows.iter().map(|r| r.to_string()).collect();
        testutil::write(&path, &text.join("\n"));
        let (found, _) = scan_all(&roots);
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].cwd.as_str(), found[0].messages, found[0].title.as_str()), (cwd, 2, "hello there"));
        let done = import(&roots, &SessionPick { source: "claude".into(), id: id.into(), cwd: cwd.into() }).unwrap();
        assert!(!done.reused && done.engine == "claude");
        let (found, _) = scan_all(&roots);
        assert_eq!(found.len(), 1, "the copy is not offered");
        assert!(found[0].imported);
        assert!(import(&roots, &SessionPick { source: "claude".into(), id: id.into(), cwd: cwd.into() }).unwrap().reused);
    }

    /// A Claude Code 2.x session as it is written: a queued prompt, a file
    /// history snapshot, prompts and tool rounds, a sub-agent's sidechain
    /// rows, a compaction (its boundary and summary), slash-command echoes,
    /// and the titles appended at the end.
    fn claude_rows(cwd: &str, id: &str) -> Vec<Value> {
        vec![
            json!({"type": "queue-operation", "operation": "enqueue", "timestamp": "2026-10-01T10:00:00.000Z", "sessionId": id, "content": "hello"}),
            json!({"type": "file-history-snapshot", "messageId": "m0", "snapshot": {"trackedFileBackups": {}}, "isSnapshotUpdate": false}),
            json!({"parentUuid": null, "isSidechain": false, "userType": "external", "cwd": cwd, "sessionId": id, "version": "2.1.296", "gitBranch": "main", "type": "user", "message": {"role": "user", "content": "hello there"}, "uuid": "u1", "timestamp": "2026-10-01T10:00:01.000Z"}),
            json!({"parentUuid": "u1", "isSidechain": false, "cwd": cwd, "sessionId": id, "type": "assistant", "message": {"role": "assistant", "content": [{"type": "thinking", "thinking": "hm", "signature": "sig"}, {"type": "tool_use", "id": "toolu_1", "name": "Bash", "input": {"command": "ls"}}]}, "uuid": "a1"}),
            json!({"parentUuid": "a1", "isSidechain": false, "cwd": cwd, "sessionId": id, "type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_1", "content": "a.txt"}]}, "uuid": "u2", "toolUseResult": {"stdout": "a.txt"}}),
            json!({"parentUuid": "u2", "isSidechain": true, "cwd": cwd, "sessionId": id, "type": "user", "message": {"role": "user", "content": "sub-agent task"}, "uuid": "s1"}),
            json!({"parentUuid": null, "logicalParentUuid": "u2", "cwd": cwd, "sessionId": id, "type": "system", "subtype": "compact_boundary", "content": "Conversation compacted", "compactMetadata": {"trigger": "auto"}, "uuid": "c1"}),
            json!({"parentUuid": "c1", "cwd": cwd, "sessionId": id, "type": "user", "isCompactSummary": true, "isVisibleInTranscriptOnly": true, "message": {"role": "user", "content": "This session is being continued from a previous conversation"}, "uuid": "u3"}),
            json!({"parentUuid": "u3", "cwd": cwd, "sessionId": id, "type": "user", "isMeta": true, "message": {"role": "user", "content": "<local-command-caveat>Caveat</local-command-caveat>"}, "uuid": "u4"}),
            json!({"parentUuid": "u4", "cwd": cwd, "sessionId": id, "type": "user", "message": {"role": "user", "content": "<command-name>/model</command-name>"}, "uuid": "u5"}),
            json!({"parentUuid": "u5", "cwd": cwd, "sessionId": id, "type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "and again"}, {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "xx"}}]}, "uuid": "u6"}),
            json!({"type": "summary", "summary": "Listing files", "leafUuid": "u6"}),
            json!({"type": "last-prompt", "lastPrompt": "and again", "sessionId": id}),
            json!({"type": "ai-title", "aiTitle": "List the files", "sessionId": id}),
        ]
    }

    #[test]
    fn claude_files_are_read_in_one_pass() {
        let roots = testutil::roots("claude-read");
        let path = roots.home.join("s.jsonl");
        testutil::write(&path, &lines(&claude_rows("/proj/a", "x")));
        let got = read_claude(&path).unwrap();
        assert_eq!(got, ClaudeFile { cwd: Some("/proj/a".into()), prompts: 2, title: "List the files".into() });
        // The name the user gave it wins, and a relocated session belongs to
        // its new folder.
        let mut rows = claude_rows("/proj/a", "x");
        rows.push(json!({"type": "custom-title", "customTitle": "My name\nsecond line", "sessionId": "x"}));
        rows.push(json!({"type": "relocated", "relocatedCwd": "/proj/b", "sessionId": "x"}));
        testutil::write(&path, &lines(&rows));
        let got = read_claude(&path).unwrap();
        assert_eq!((got.cwd.as_deref(), got.title.as_str()), (Some("/proj/b"), "My name"));
        // A line cut short by a crash is skipped; the rest still counts.
        testutil::write(&path, &(lines(&claude_rows("/proj/a", "x")) + "{\"type\":\"user\",\"mess"));
        assert_eq!(read_claude(&path).unwrap().prompts, 2);
        // Not a session file.
        testutil::write(&path, "garbage\nmore garbage\n");
        let (kind, reason) = read_claude(&path).unwrap_err();
        assert!(kind == SkipKind::Unrecognised && reason.contains("not a session file"), "{kind:?} {reason}");
        let (kind, reason) = read_claude(&roots.home.join("missing.jsonl")).unwrap_err();
        assert!(kind == SkipKind::Unreadable && reason.starts_with("file "), "{kind:?} {reason}");
    }

    #[test]
    fn claude_sessions_on_windows_and_unreadable_files_are_reported() {
        // A Windows home: USERPROFILE, a Git Bash HOME elsewhere, sessions
        // under `%USERPROFILE%\.claude\projects\C--Users-demo-proj`.
        let base = testutil::fake_home("claude-win");
        let profile = base.join("Users").join("demo");
        let (p, h) = (profile.clone(), base.join("msys-home"));
        let env = move |k: &str| match k {
            "USERPROFILE" => Some(p.clone().into_os_string()),
            "HOME" => Some(h.clone().into_os_string()),
            _ => None,
        };
        let roots = Roots::from_env(&env, true, base.join(".lynshen"));
        let cwd = r"C:\Users\demo\proj";
        let id = "aaaaaaaa-1111-4111-8111-111111111111";
        let dir = profile.join(".claude").join("projects").join("C--Users-demo-proj");
        testutil::write(&dir.join(format!("{id}.jsonl")), &lines(&claude_rows(cwd, id)));
        testutil::write(&dir.join("bbbbbbbb-2222-4222-8222-222222222222.jsonl"), "not json\n");
        testutil::write(&dir.join("cccccccc-3333-4333-8333-333333333333.jsonl"), "");
        testutil::write(&dir.join("dddddddd-4444-4444-8444-444444444444.jsonl"), &lines(&[json!({"type": "user", "message": {"role": "user", "content": "no folder"}})]));
        testutil::write(&dir.join("agent-1234abcd.jsonl"), &lines(&claude_rows(cwd, id)));
        let (found, report) = scan_all(&roots);
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].id.as_str(), found[0].cwd.as_str(), found[0].messages), (id, cwd, 2));
        let mut skipped: Vec<(&str, usize, &str)> =
            report.skipped.iter().map(|s| (s.source.as_str(), s.count, s.reason.as_str())).collect();
        skipped.sort();
        assert_eq!(skipped, [("claude", 1, "no working folder recorded"), ("claude", 1, "not a session file (no JSON rows)")]);
        assert!(report.log.iter().any(|l| l.starts_with("claude: 4 session files")), "{:?}", report.log);
        let done = import(&roots, &SessionPick { source: "claude".into(), id: id.into(), cwd: cwd.into() }).unwrap();
        assert!(dir.join(format!("{}.jsonl", done.id)).is_file());
        assert!(scan_all(&roots).0[0].imported);
    }

    #[test]
    fn claude_config_dir_is_where_sessions_are_looked_for() {
        let base = testutil::fake_home("claude-config-dir");
        let (home, alt) = (base.join("home"), base.join("claude-alt"));
        let (h, a) = (home.clone(), alt.clone());
        let env = move |k: &str| match k {
            "HOME" => Some(h.clone().into_os_string()),
            "CLAUDE_CONFIG_DIR" => Some(a.clone().into_os_string()),
            _ => None,
        };
        let roots = Roots::from_env(&env, false, base.join(".lynshen"));
        let id = "eeeeeeee-5555-4555-8555-555555555555";
        testutil::write(&alt.join("projects/-proj-x").join(format!("{id}.jsonl")), &lines(&claude_rows("/proj/x", id)));
        testutil::write(&home.join(".claude/projects/-proj-y/ffffffff-6666-4666-8666-666666666666.jsonl"), &lines(&claude_rows("/proj/y", "y")));
        let (found, _) = scan_all(&roots);
        assert_eq!(found.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(), [id]);
    }

    #[test]
    fn codex_files_without_a_header_are_reported() {
        let roots = testutil::roots("codex-bad");
        let day = roots.codex.join("sessions/2026/10/01");
        let meta = json!({"timestamp": "2026-10-01T10:00:00Z", "type": "session_meta", "payload": {"id": "0199a000-0000-7000-8000-000000000001", "cwd": "/proj/cx", "originator": "codex_cli_rs", "timestamp": "2026-10-01T10:00:00Z"}});
        let prompt = json!({"timestamp": "2026-10-01T10:00:01Z", "type": "event_msg", "payload": {"type": "user_message", "message": "fix it"}});
        testutil::write(&day.join("rollout-2026-10-01T10-00-00-0199a000-0000-7000-8000-000000000001.jsonl"), &lines(&[meta, prompt]));
        testutil::write(&day.join("rollout-2026-10-01T11-00-00-0199a000-0000-7000-8000-000000000002.jsonl"), "{\"type\":\"response_item\"}\n");
        testutil::write(&day.join("rollout-2026-10-01T12-00-00-0199a000-0000-7000-8000-000000000003.jsonl"), "");
        testutil::write(&day.join("rollout-2026-10-01T13-00-00-0199a000-0000-7000-8000-000000000004.jsonl.zst"), "zz");
        let (found, report) = scan_all(&roots);
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].title.as_str(), found[0].messages), ("fix it", 1));
        let skipped: Vec<(usize, &str)> = report.skipped.iter().map(|s| (s.count, s.reason.as_str())).collect();
        assert_eq!(skipped, [(1, "no session header (session_meta)"), (1, "compressed (.jsonl.zst) and cannot be decompressed")]);
    }

    /// Ticket #35: Codex Desktop's threads listed with 0 prompts (paginated
    /// rollouts have no `user_message` events), and its compressed ones not
    /// at all.
    #[test]
    fn codex_paginated_and_compressed_rollouts_are_listed_with_their_prompts() {
        let roots = testutil::roots("codex-paged");
        testutil::copy_tree(&testutil::codex_fixtures(), &roots.codex);
        let (found, report) = scan_all(&roots);
        let mut codex: Vec<(&str, usize, &str)> = found
            .iter()
            .filter(|f| f.source == "codex")
            .map(|f| (f.title.as_str(), f.messages, f.cwd.as_str()))
            .collect();
        codex.sort();
        let cwd = testutil::CODEX_FIXTURE_CWD;
        assert_eq!(
            codex,
            [
                ("修复安装包进程终止与启动", 3, cwd),
                ("修复游戏目录识别崩溃", 1, cwd),
                ("检查前台游戏调度时间片", 2, cwd),
                ("添加关闭预启动开关", 2, cwd),
                ("评估项目能否用于优化工具", 2, cwd),
            ]
        );
        assert!(report.skipped.iter().all(|s| s.source != "codex"), "{:?}", report.skipped);
        assert!(report.log.iter().any(|l| l.starts_with("codex: 6 rollout files (3 compressed), 5 threads")), "{:?}", report.log);
        // Imported, it is listed as imported, and its copy is not offered.
        let id = found.iter().find(|f| f.title == "修复安装包进程终止与启动").unwrap().id.clone();
        let done = import(&roots, &SessionPick { source: "codex".into(), id: id.clone(), cwd: cwd.into() }).unwrap();
        assert_eq!((done.engine, done.title.as_str()), ("codex", "修复安装包进程终止与启动"));
        let again = scan_all(&roots).0;
        assert!(again.iter().find(|f| f.id == id).unwrap().imported);
        assert!(again.iter().all(|f| f.id != done.id));
    }

    #[test]
    fn omp_sessions_in_every_folder_and_bad_files() {
        let base = testutil::fake_home("omp-dirs");
        let home = base.join("home");
        let (h, d) = (home.clone(), base.join("pi-sessions"));
        let env = move |k: &str| match k {
            "HOME" => Some(h.clone().into_os_string()),
            "PI_CODING_AGENT_SESSION_DIR" => Some(d.clone().into_os_string()),
            _ => None,
        };
        let roots = Roots::from_env(&env, false, base.join(".lynshen"));
        let session = |id: &str| {
            lines(&[
                json!({"type": "session", "version": 3, "id": id, "cwd": "/proj/omp"}),
                json!({"type": "message", "id": "a1", "parentId": null, "message": {"role": "user", "content": "go"}}),
            ])
        };
        testutil::write(&base.join("pi-sessions/-proj-omp/2026_one.jsonl"), &session("one"));
        testutil::write(&home.join(".omp/agent/sessions/-proj-omp/2026_two.jsonl"), &session("two"));
        testutil::write(&home.join(".omp/agent/sessions/-proj-omp/2026_bad.jsonl"), "{\"type\":\"message\"}\n");
        let (found, report) = scan_all(&roots);
        let mut ids: Vec<&str> = found.iter().map(|f| f.id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, ["one", "two"]);
        assert_eq!(
            report.skipped,
            vec![Skipped { source: "omp".into(), count: 1, kind: SkipKind::Unrecognised, reason: "no session header".into() }]
        );
    }

    #[test]
    fn session_dir_hash_matches_the_cli() {
        // A folder `lynshen` saved sessions for (seen under ~/.lynshen/sessions).
        assert_eq!(
            lynshen_session_dir(Path::new("/x"), "/Users/chad/Documents/LynShen"),
            Path::new("/x/sessions/8e1e5d030dc21b14")
        );
        assert_eq!(label_of("  a\n b  "), "a b");
        assert_eq!(label_of(&"x".repeat(80)), format!("{}...", "x".repeat(72)));
    }
}
