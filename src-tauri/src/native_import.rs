//! Import a conversation Claude Code or Codex saved in its own app, so it
//! continues in a LynShen session of the same engine.
//!
//! The original is never touched: an import writes a copy under a new id next
//! to the engine's own sessions, and that copy is what LynShen resumes. The
//! copy drops what only the account that wrote it can use — Claude's signed
//! thinking blocks and Codex's `encrypted_content` reasoning — because either
//! engine rejects the whole request when another account (the LynShen gateway,
//! a different login) replays them (verified: a Claude session with altered
//! thinking signatures resumes into `API Error: 400`; the cleaned copy
//! resumes with its context). Visible text, tool calls and tool results stay.
//!
//! A Codex thread also records the model provider it was written with, and
//! resuming fails when that provider is not configured here (`Model provider
//! 'recodex' not found`). The copy records the provider this Codex is
//! configured for, as a thread started now would (Codex indexes a thread with
//! no provider as `""` and then cannot resume it); a gateway session resumes
//! on the gateway whatever the thread records (the daemon asks for it).
//!
//! Codex threads are not always one file: a thread may continue over several
//! segment files (`rollout-<ts>-<id>_<segment>.jsonl`), and a fork starts in
//! another thread's file. Each file's `history_base` names the file (thread id
//! for a thread's first file, segment id for the others) whose lines below an
//! ordinal come before its own; the newest segment's chain is the thread's
//! history. The copy flattens that chain into one self-contained file with
//! its ordinals renumbered. A remote compaction's summary is encrypted like
//! reasoning; its `compacted` record is dropped, and Codex rebuilds the
//! context from the full history (verified: the same context and input size
//! as with the record stripped or kept).
//!
//! Codex Desktop can compress the rollouts of threads not touched for a week
//! (`rollout-*.jsonl.zst`, one Zstandard frame of the whole file; Codex
//! decompresses one again when the thread continues). They are read as their
//! text, and the copy is written plain. When both forms of one file exist the
//! plain one is current, as Codex reads it.
//!
//! Threads Codex writes in its paginated history mode (Codex 0.158 and later;
//! `history_mode: "paginated"`, every row with an `ordinal`) keep the user's
//! prompts as `item_completed` events of a `UserMessage` item instead of the
//! `user_message` events older rollouts have; both are read.
//!
//! `~/.lynshen/native-imports.json` records each import, so a copy is not
//! listed as a native session of its own and re-importing opens the copy.

use crate::claude_history::{self, is_session_id, preview_of, project_dirs, truncate_chars};
use ruzstd::decoding::errors::{FrameDecoderError, ReadFrameHeaderError};
use ruzstd::decoding::{BlockDecodingStrategy, FrameDecoder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, BufRead, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// A conversation listed for import (newest first).
#[derive(Serialize, Debug)]
pub struct NativeSession {
    pub id: String,
    pub title: String,
    pub mtime_ms: u64,
    /// Which app wrote it: "Claude Code", "Codex CLI", "Codex Desktop".
    pub origin: String,
    /// The LynShen copy when this conversation was imported before.
    pub imported: Option<String>,
    /// Why it cannot be imported, when it cannot (the import page's reason,
    /// such as "old_format"); only DSH lists such conversations.
    pub unreadable: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct ImportedSession {
    pub id: String,
    pub title: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct ImportRecord {
    pub source: String,
    pub from: String,
    pub to: String,
    pub at_ms: u64,
}

/// Where each engine keeps its sessions and where imports are recorded
/// (injectable so tests run against fixture directories).
pub struct Homes {
    pub claude: PathBuf,
    pub codex: PathBuf,
    pub registry: PathBuf,
}

pub(crate) fn homes() -> Homes {
    Homes {
        claude: claude_history::claude_home(),
        codex: codex_home(&claude_history::process_env, cfg!(windows)),
        // The registry Settings → 导入 keeps too (agent_import).
        registry: crate::lynshen_dir().join("native-imports.json"),
    }
}

/// `$CODEX_HOME`, else `.codex` in the home folder Codex uses (on Windows the
/// profile folder, as `dirs::home_dir()` finds it).
pub(crate) fn codex_home(env: claude_history::Env, windows: bool) -> PathBuf {
    env("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| claude_history::user_home(env, windows).join(".codex"))
}

const MAX_LISTED: usize = 50;
pub(crate) const MAX_TITLE_CHARS: usize = 80;
/// Bytes scanned for a Codex title when the thread has no name.
const MAX_TITLE_SCAN: u64 = 1024 * 1024;
/// Files in a `history_base` chain before giving up (a cycle guard; real
/// threads reach a handful).
const MAX_CHAIN: usize = 256;

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// --- ids ---------------------------------------------------------------------

fn random_bytes() -> Result<[u8; 16], String> {
    let mut b = [0u8; 16];
    getrandom::getrandom(&mut b).map_err(|e| format!("no randomness: {e}"))?;
    Ok(b)
}

fn format_uuid(b: [u8; 16]) -> String {
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

/// Claude session ids are v4 UUIDs.
fn uuid_v4() -> Result<String, String> {
    let mut b = random_bytes()?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    Ok(format_uuid(b))
}

/// Codex thread ids are v7 UUIDs (time-ordered).
fn uuid_v7(ms: u64) -> Result<String, String> {
    let mut b = random_bytes()?;
    b[..6].copy_from_slice(&ms.to_be_bytes()[2..8]);
    b[6] = (b[6] & 0x0f) | 0x70;
    b[8] = (b[8] & 0x3f) | 0x80;
    Ok(format_uuid(b))
}

/// UTC civil date/time of a unix-ms instant (no calendar crate needed).
fn utc_parts(ms: u64) -> (i64, u32, u32, u32, u32, u32) {
    let secs = (ms / 1000) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d, (rem / 3600) as u32, (rem % 3600 / 60) as u32, (rem % 60) as u32)
}

// --- the import registry -----------------------------------------------------

pub(crate) fn load_registry(path: &Path) -> Vec<ImportRecord> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub(crate) fn save_registry(path: &Path, records: &[ImportRecord]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(records).map_err(|e| e.to_string())?;
    write_atomic(path, text.as_bytes())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

// --- Claude Code -------------------------------------------------------------

/// Where Claude Code would write session `id` of `cwd`.
#[cfg(test)]
pub(crate) fn claude_copy_path(h: &Homes, cwd: &str, id: &str) -> PathBuf {
    claude_history::project_dir(&h.claude, cwd).join(format!("{id}.jsonl"))
}

/// Where Claude Code keeps session `id` of `cwd`: in a folder it keeps that
/// folder's sessions in (claude_history::project_dirs), else in whichever
/// project folder has it (a session relocated to another folder, or a folder
/// named from a path written another way).
pub(crate) fn claude_session_file(h: &Homes, cwd: &str, id: &str) -> Option<PathBuf> {
    if !is_session_id(id) {
        return None;
    }
    let file = format!("{id}.jsonl");
    project_dirs(&h.claude, cwd).into_iter().map(|dir| dir.join(&file)).find(|p| p.is_file()).or_else(|| {
        fs::read_dir(h.claude.join("projects")).ok()?.flatten().map(|e| e.path().join(&file)).find(|p| p.is_file())
    })
}

fn list_claude(h: &Homes, cwd: &str) -> Result<Vec<NativeSession>, String> {
    let registry = load_registry(&h.registry);
    let copies: HashSet<&str> = registry
        .iter()
        .filter(|r| r.source == "claude")
        .map(|r| r.to.as_str())
        .collect();
    Ok(claude_history::list_sessions(&h.claude, cwd)?
        .into_iter()
        .filter(|s| !copies.contains(s.id.as_str()))
        .map(|s| NativeSession {
            imported: existing_copy(&registry, "claude", &s.id, |to| claude_session_file(h, cwd, to).is_some()),
            title: s.preview,
            mtime_ms: s.mtime_ms,
            origin: "Claude Code".to_string(),
            unreadable: None,
            id: s.id,
        })
        .collect())
}

pub(crate) fn existing_copy(
    registry: &[ImportRecord],
    source: &str,
    from: &str,
    exists: impl Fn(&str) -> bool,
) -> Option<String> {
    registry
        .iter()
        .rev()
        .find(|r| r.source == source && r.from == from && exists(&r.to))
        .map(|r| r.to.clone())
}

/// Thinking blocks carry a signature only the writing account can replay.
fn is_thinking(block: &Value) -> bool {
    matches!(block["type"].as_str(), Some("thinking" | "redacted_thinking"))
}

/// The Claude session `from` rewritten as `to`: thinking blocks removed, an
/// entry left empty by that dropped, and the entries that pointed at a dropped
/// one re-pointed at its parent so the conversation chain stays whole.
fn clean_claude(src: &Path, dst: &Path, to: &str) -> Result<(), String> {
    // Two streaming passes (sessions reach 100 MB): find the entries left
    // empty, then write every row re-pointed past them.
    let mut dropped: HashMap<String, Option<String>> = HashMap::new();
    for row in json_lines(src)? {
        let mut row = row?;
        let Some(content) = row.pointer_mut("/message/content").and_then(Value::as_array_mut) else { continue };
        if content.iter().any(is_thinking) && content.iter().all(is_thinking) {
            if let Some(uuid) = row["uuid"].as_str() {
                dropped.insert(uuid.to_string(), row["parentUuid"].as_str().map(str::to_string));
            }
        }
    }
    let resolve = |mut u: Option<String>| {
        let mut hops = 0;
        while let Some(parent) = u.as_ref().and_then(|x| dropped.get(x)) {
            u = parent.clone();
            hops += 1;
            if hops > dropped.len() {
                break;
            }
        }
        u
    };
    let file = fs::File::create(dst).map_err(|e| format!("cannot write {}: {e}", dst.display()))?;
    let mut out = BufWriter::new(file);
    for row in json_lines(src)? {
        let mut row = row?;
        if row["uuid"].as_str().is_some_and(|u| dropped.contains_key(u)) {
            continue;
        }
        if let Some(content) = row.pointer_mut("/message/content").and_then(Value::as_array_mut) {
            content.retain(|b| !is_thinking(b));
        }
        for key in ["parentUuid", "logicalParentUuid", "leafUuid"] {
            if let Some(u) = row[key].as_str().filter(|u| dropped.contains_key(*u)) {
                row[key] = resolve(Some(u.to_string())).map_or(Value::Null, Value::String);
            }
        }
        if row.get("sessionId").is_some() {
            row["sessionId"] = json!(to);
        }
        writeln!(out, "{row}").map_err(|e| e.to_string())?;
    }
    out.flush().map_err(|e| e.to_string())
}

/// A JSONL file's rows (a `.jsonl.zst` rollout decompressed). A read error
/// fails the import (a copy cut short at it would look whole); a line that is
/// not JSON — a row being written as we read — is skipped.
pub(crate) fn json_lines(path: &Path) -> Result<impl Iterator<Item = Result<Value, String>>, String> {
    let reader = open_rollout(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let shown = path.display().to_string();
    Ok(reader.lines().filter_map(move |line| match line {
        Ok(l) => serde_json::from_str::<Value>(&l).ok().map(Ok),
        Err(e) => Some(Err(format!("cannot read {shown}: {e}"))),
    }))
}

pub(crate) fn import_claude(h: &Homes, cwd: &str, id: &str) -> Result<ImportedSession, String> {
    if !is_session_id(id) {
        return Err(format!("invalid session id: {id}"));
    }
    let src = claude_session_file(h, cwd, id).ok_or_else(|| format!("Claude Code session {id} not found for {cwd}"))?;
    // The copy goes next to the original: the folder Claude Code keeps that
    // project's sessions in, which `--resume` looks in.
    let dir = src.parent().map(Path::to_path_buf).unwrap_or_default();
    let title = preview_of(&src);
    let mut registry = load_registry(&h.registry);
    if let Some(to) = existing_copy(&registry, "claude", id, |to| dir.join(format!("{to}.jsonl")).is_file()) {
        return Ok(ImportedSession { id: to, title });
    }
    let to = uuid_v4()?;
    let dst = dir.join(format!("{to}.jsonl"));
    let tmp = dst.with_extension("jsonl.tmp");
    clean_claude(&src, &tmp, &to).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })?;
    fs::rename(&tmp, &dst).map_err(|e| e.to_string())?;
    registry.push(ImportRecord { source: "claude".into(), from: id.into(), to: to.clone(), at_ms: now_ms() });
    save_registry(&h.registry, &registry)?;
    Ok(ImportedSession { id: to, title })
}

// --- Codex -------------------------------------------------------------------

/// One rollout file of a thread, with its `session_meta` payload.
pub(crate) struct Segment {
    pub path: PathBuf,
    pub meta: Value,
    /// What a `history_base` calls this file: the thread id for a thread's
    /// first file, the `_<segment>` suffix for the others.
    file_id: String,
    /// Under `archived_sessions`: read as a fork's base, never listed.
    pub archived: bool,
}

/// A rollout compressed by Codex (`.jsonl.zst`).
pub(crate) fn is_compressed(path: &Path) -> bool {
    path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(".jsonl.zst"))
}

/// A rollout's name without `.jsonl` or `.jsonl.zst`.
fn rollout_stem(path: &Path) -> &str {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    name.strip_suffix(".jsonl.zst").or_else(|| name.strip_suffix(".jsonl")).unwrap_or(name)
}

/// A `.jsonl.zst` rollout read as its text. Codex writes one Zstandard frame
/// of the whole file; frames after it, and skippable frames, are read past
/// too, as Codex reads them. Decoded as it is read: rollouts reach 100 MB.
struct Zstd<R> {
    source: R,
    frame: Option<FrameDecoder>,
}

impl<R: BufRead> Read for Zstd<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        loop {
            if let Some(frame) = self.frame.as_mut() {
                while frame.can_collect() == 0 && !frame.is_finished() {
                    frame
                        .decode_blocks(&mut self.source, BlockDecodingStrategy::UptoBlocks(1))
                        .map_err(|e| io::Error::other(e.to_string()))?;
                }
                let n = frame.read(buf)?;
                if n > 0 {
                    return Ok(n);
                }
                // The frame is done and read out.
                self.frame = None;
            }
            if self.source.fill_buf()?.is_empty() {
                return Ok(0);
            }
            let mut frame = FrameDecoder::new();
            match frame.init(&mut self.source) {
                Ok(()) => self.frame = Some(frame),
                Err(FrameDecoderError::ReadFrameHeaderError(ReadFrameHeaderError::SkipFrame { length, .. })) => {
                    io::copy(&mut self.source.by_ref().take(u64::from(length)), &mut io::sink())?;
                }
                Err(e) => return Err(io::Error::other(e.to_string())),
            }
        }
    }
}

/// A rollout's text, decompressed when Codex compressed it.
pub(crate) fn open_rollout(path: &Path) -> io::Result<Box<dyn BufRead>> {
    let file = fs::File::open(path)?;
    Ok(if is_compressed(path) {
        Box::new(BufReader::new(Zstd { source: BufReader::new(file), frame: None }))
    } else {
        Box::new(BufReader::new(file))
    })
}

fn first_line(path: &Path) -> Option<Value> {
    let mut line = String::new();
    open_rollout(path).ok()?.read_line(&mut line).ok()?;
    serde_json::from_str(&line).ok()
}

/// Every rollout file, plain (`rollout-*.jsonl`) or compressed
/// (`rollout-*.jsonl.zst`). Of a file in both forms only the plain one counts:
/// Codex reads that one (the other is left from a compression or a
/// decompression that did not finish). Codex's staging files (`*.tmp`) are
/// not rollouts.
pub(crate) fn rollout_files(codex: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![codex.join("sessions"), codex.join("archived_sessions")];
    while let Some(dir) = stack.pop() {
        let Ok(read) = fs::read_dir(&dir) else { continue };
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
            if !name.starts_with("rollout-") {
                continue;
            }
            // `with_extension("")` of `x.jsonl.zst` is `x.jsonl`.
            if name.ends_with(".jsonl") || (name.ends_with(".jsonl.zst") && !path.with_extension("").is_file()) {
                out.push(path);
            }
        }
    }
    out
}

/// Every thread's segments, oldest first, keyed by thread id.
pub(crate) fn codex_threads(codex: &Path) -> HashMap<String, Vec<Segment>> {
    let mut threads: HashMap<String, Vec<Segment>> = HashMap::new();
    let archive = codex.join("archived_sessions");
    for path in rollout_files(codex) {
        let Some(line) = first_line(&path) else { continue };
        if line["type"].as_str() != Some("session_meta") {
            continue;
        }
        let meta = line["payload"].clone();
        let Some(id) = meta["id"].as_str().map(str::to_string) else { continue };
        let file_id = rollout_stem(&path).rsplit_once('_').map_or(id.clone(), |(_, seg)| seg.to_string());
        let archived = path.starts_with(&archive);
        threads.entry(id).or_default().push(Segment { path, meta, file_id, archived });
    }
    for segments in threads.values_mut() {
        segments.sort_by(|a, b| {
            let ts = |s: &Segment| s.meta["timestamp"].as_str().unwrap_or("").to_string();
            ts(a).cmp(&ts(b)).then_with(|| a.path.cmp(&b.path))
        });
    }
    threads
}

pub(crate) fn same_dir(a: &str, b: &str) -> bool {
    let trim = |s: &str| s.trim_end_matches('/').to_string();
    if trim(a) == trim(b) {
        return true;
    }
    matches!((fs::canonicalize(a), fs::canonicalize(b)), (Ok(x), Ok(y)) if x == y)
}

/// `session_index.jsonl`: the names Codex gave its threads (last one wins).
pub(crate) fn codex_names(codex: &Path) -> HashMap<String, String> {
    let mut names = HashMap::new();
    let Ok(text) = fs::read_to_string(codex.join("session_index.jsonl")) else { return names };
    for v in text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
        if let (Some(id), Some(name)) = (v["id"].as_str(), v["thread_name"].as_str()) {
            if !name.trim().is_empty() {
                names.insert(id.to_string(), name.trim().to_string());
            }
        }
    }
    names
}

/// What the user typed, from the row Codex records a prompt with: a
/// `user_message` event (older rollouts), or the `item_completed` event of a
/// `UserMessage` item (paginated rollouts), whose text parts are joined. None
/// for any other row; text Codex injected (environment and instruction
/// blocks, which start with `<`) is not a prompt.
pub(crate) fn codex_prompt(row: &Value) -> Option<String> {
    if row["type"].as_str() != Some("event_msg") {
        return None;
    }
    let p = &row["payload"];
    let text = match p["type"].as_str() {
        Some("user_message") => p["message"].as_str()?.to_string(),
        Some("item_completed") if p["item"]["type"].as_str() == Some("UserMessage") => p["item"]["content"]
            .as_array()?
            .iter()
            .filter(|part| part["type"].as_str() == Some("text"))
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => return None,
    };
    let text = text.trim();
    (!text.is_empty() && !text.starts_with('<')).then(|| text.to_string())
}

/// The prompts the user sent in one rollout file, in rows below ordinal
/// `below` (a row without one counts).
fn codex_prompts(path: &Path, below: i64) -> usize {
    let Ok(reader) = open_rollout(path) else { return 0 };
    let mut n = 0;
    for line in reader.split(b'\n').map_while(Result::ok) {
        // Most rows are tool output: only a row that may be a prompt is parsed.
        let text = String::from_utf8_lossy(&line);
        if !(text.contains("\"user_message\"") || text.contains("\"UserMessage\"")) {
            continue;
        }
        let Ok(row) = serde_json::from_str::<Value>(&text) else { continue };
        if row["ordinal"].as_i64().is_none_or(|o| o < below) && codex_prompt(&row).is_some() {
            n += 1;
        }
    }
    n
}

/// The prompts of a thread's current history that its own files hold: a
/// fork's since the fork, without the turns a rollback dropped. A thread
/// whose history cannot be followed counts every prompt of its files.
pub(crate) fn codex_thread_prompts(threads: &HashMap<String, Vec<Segment>>, id: &str) -> usize {
    let own: HashSet<&Path> =
        threads.get(id).into_iter().flatten().filter(|s| !s.archived).map(|s| s.path.as_path()).collect();
    match codex_plan(threads, id) {
        Ok(plan) => plan.iter().filter(|(path, _)| own.contains(path.as_path())).map(|(path, below)| codex_prompts(path, *below)).sum(),
        Err(_) => own.iter().map(|path| codex_prompts(path, i64::MAX)).sum(),
    }
}

/// The first thing the user typed (Codex injects AGENTS.md and environment
/// blocks as user messages too; those start with `<` or a heading).
pub(crate) fn codex_first_prompt(path: &Path) -> String {
    let Ok(reader) = open_rollout(path) else { return String::new() };
    for line in reader.take(MAX_TITLE_SCAN).lines().map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        let p = &v["payload"];
        let text = match codex_prompt(&v) {
            Some(prompt) => prompt,
            None if v["type"].as_str() == Some("response_item")
                && p["type"].as_str() == Some("message")
                && p["role"].as_str() == Some("user") =>
            {
                p["content"].as_array().and_then(|c| c.iter().find_map(|b| b["text"].as_str())).unwrap_or("").to_string()
            }
            None => continue,
        };
        let t = text.trim();
        if !t.is_empty() && !t.starts_with('<') && !t.starts_with("# AGENTS.md") {
            return truncate_chars(t.lines().next().unwrap_or(""), MAX_TITLE_CHARS);
        }
    }
    String::new()
}

/// The provider Codex uses by default: `model_provider` of the selected
/// `profile` if it sets one, else the top-level one, else Codex's default.
fn codex_default_provider(codex: &Path) -> String {
    let text = fs::read_to_string(codex.join("config.toml")).unwrap_or_default();
    // (table, key) → string value, for the simple `key = "v"` / `key = 'v'` lines.
    let mut table = String::new();
    let mut values: HashMap<(String, String), String> = HashMap::new();
    for line in text.lines().map(str::trim) {
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            table = name.trim().to_string();
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let value = value.trim();
        let quoted = ['"', '\''].into_iter().find_map(|q| value.strip_prefix(q)?.split_once(q).map(|(v, _)| v));
        if let Some(v) = quoted.filter(|v| !v.is_empty()) {
            values.insert((table.clone(), key.trim().to_string()), v.to_string());
        }
    }
    let top = |key: &str| values.get(&(String::new(), key.to_string())).cloned();
    top("profile")
        .and_then(|p| values.get(&(format!("profiles.{p}"), "model_provider".to_string())).cloned())
        .or_else(|| top("model_provider"))
        .unwrap_or_else(|| "openai".to_string())
}

/// A conversation someone had, not a sub-agent a conversation spawned (those
/// resume only through their parent).
pub(crate) fn is_conversation(segments: &[Segment]) -> bool {
    let meta = &segments[0].meta;
    !segments.iter().all(|s| s.archived)
        && meta["thread_source"].as_str() != Some("subagent")
        && meta["source"].get("subagent").is_none()
}

/// Threads LynShen's own Codex sessions wrote: already LynShen sessions.
pub(crate) const LYNSHEN_ORIGINATOR: &str = "lynshen-daemon";

fn codex_origin(meta: &Value) -> String {
    match meta["originator"].as_str().unwrap_or("") {
        o if o.contains("Desktop") => "Codex Desktop".to_string(),
        o if o.contains("vscode") => "Codex IDE".to_string(),
        o if o.is_empty() || o.starts_with("codex") => "Codex CLI".to_string(),
        other => other.to_string(),
    }
}

fn list_codex(h: &Homes, cwd: &str) -> Result<Vec<NativeSession>, String> {
    let registry = load_registry(&h.registry);
    let copies: HashSet<&str> = registry
        .iter()
        .filter(|r| r.source == "codex")
        .map(|r| r.to.as_str())
        .collect();
    let threads = codex_threads(&h.codex);
    let names = codex_names(&h.codex);
    let mut out: Vec<(u64, &String, &Vec<Segment>)> = threads
        .iter()
        .filter(|(id, segs)| {
            !copies.contains(id.as_str())
                && is_conversation(segs)
                && segs[0].meta["originator"].as_str() != Some(LYNSHEN_ORIGINATOR)
                && segs[0].meta["cwd"].as_str().is_some_and(|c| same_dir(c, cwd))
        })
        .map(|(id, segs)| (segs.iter().map(|s| mtime_ms(&s.path)).max().unwrap_or(0), id, segs))
        .collect();
    out.sort_by_key(|(m, _, _)| std::cmp::Reverse(*m));
    out.truncate(MAX_LISTED);
    Ok(out
        .into_iter()
        .map(|(mtime_ms, id, segs)| NativeSession {
            id: id.clone(),
            title: names
                .get(id)
                .map(|n| truncate_chars(n, MAX_TITLE_CHARS))
                .unwrap_or_else(|| codex_first_prompt(&segs[0].path)),
            mtime_ms,
            origin: codex_origin(&segs[0].meta),
            imported: existing_copy(&registry, "codex", id, |to| threads.contains_key(to)),
            unreadable: None,
        })
        .collect())
}

/// The files making up a thread's current history, oldest first, each with
/// the ordinal its lines must stay below: the newest segment, then the file
/// its `history_base` names (cut at that base's end), and so on back.
pub(crate) fn codex_plan(threads: &HashMap<String, Vec<Segment>>, id: &str) -> Result<Vec<(PathBuf, i64)>, String> {
    let files: HashMap<&str, &Segment> =
        threads.values().flatten().map(|s| (s.file_id.as_str(), s)).collect();
    let head = threads
        .get(id)
        .and_then(|segs| segs.last())
        .ok_or_else(|| format!("Codex thread {id} not found"))?;
    let mut plan = vec![(head.path.clone(), i64::MAX)];
    let mut file = head;
    while let Some(base) = file.meta["history_base"].as_object() {
        let base_id = base.get("thread_id").and_then(Value::as_str).unwrap_or("");
        let end = base.get("end_ordinal_exclusive").and_then(Value::as_i64).unwrap_or(i64::MAX);
        file = files.get(base_id).ok_or_else(|| {
            format!("this conversation continues {base_id}, which Codex no longer has; it cannot be imported whole")
        })?;
        plan.push((file.path.clone(), end));
        if plan.len() > MAX_CHAIN {
            return Err("Codex history chain too long".into());
        }
    }
    plan.reverse();
    Ok(plan)
}

/// A remote compaction: its summary is the encrypted `compaction` item.
fn is_remote_compaction(v: &Value) -> bool {
    v["type"].as_str() == Some("compacted")
        && v["payload"]["replacement_history"]
            .as_array()
            .is_some_and(|h| h.iter().any(|i| i["type"].as_str() == Some("compaction")))
}

fn strip_encrypted(v: &mut Value) {
    match v {
        Value::Object(map) => {
            map.remove("encrypted_content");
            map.values_mut().for_each(strip_encrypted);
        }
        Value::Array(items) => items.iter_mut().for_each(strip_encrypted),
        _ => {}
    }
}

/// Writes the thread `id` as one self-contained rollout for thread `to`.
fn clean_codex(
    threads: &HashMap<String, Vec<Segment>>,
    id: &str,
    to: &str,
    provider: &str,
    dst: &Path,
    now: u64,
) -> Result<(), String> {
    let plan = codex_plan(threads, id)?;
    let segments = &threads[id];
    let (y, mo, d, hh, mi, ss) = utc_parts(now);
    let mut meta = segments[segments.len() - 1].meta.clone();
    for key in ["history_base", "forked_from_id", "forked_from_ordinal_exclusive", "parent_thread_id"] {
        if let Some(map) = meta.as_object_mut() {
            map.remove(key);
        }
    }
    meta["id"] = json!(to);
    meta["session_id"] = json!(to);
    meta["model_provider"] = json!(provider);
    meta["timestamp"] = json!(format!("{y:04}-{mo:02}-{d:02}T{hh:02}:{mi:02}:{ss:02}.000Z"));
    let stamp = meta["timestamp"].clone();
    let file = fs::File::create(dst).map_err(|e| format!("cannot write {}: {e}", dst.display()))?;
    let mut out = BufWriter::new(file);
    writeln!(out, "{}", json!({ "timestamp": stamp, "ordinal": 0, "type": "session_meta", "payload": meta }))
        .map_err(|e| e.to_string())?;
    let mut ordinal = 1i64;
    for (path, below) in plan {
        for v in json_lines(&path)? {
            let mut v = v?;
            if v["type"].as_str() == Some("session_meta") || is_remote_compaction(&v) {
                continue;
            }
            if v["ordinal"].as_i64().is_some_and(|o| o >= below) {
                continue;
            }
            strip_encrypted(&mut v);
            if v.get("ordinal").is_some() {
                v["ordinal"] = json!(ordinal);
                ordinal += 1;
            }
            writeln!(out, "{v}").map_err(|e| e.to_string())?;
        }
    }
    out.flush().map_err(|e| e.to_string())
}

pub(crate) fn import_codex(h: &Homes, cwd: &str, id: &str) -> Result<ImportedSession, String> {
    if !is_session_id(id) {
        return Err(format!("invalid thread id: {id}"));
    }
    let threads = codex_threads(&h.codex);
    let segments = threads.get(id).ok_or_else(|| format!("Codex thread {id} not found"))?;
    if !is_conversation(segments) {
        return Err(format!("Codex thread {id} is a sub-agent; import the conversation that started it"));
    }
    if !segments[0].meta["cwd"].as_str().is_some_and(|c| same_dir(c, cwd)) {
        return Err(format!("Codex thread {id} belongs to another directory"));
    }
    let title = codex_names(&h.codex)
        .get(id)
        .map(|n| truncate_chars(n, MAX_TITLE_CHARS))
        .unwrap_or_else(|| codex_first_prompt(&segments[0].path));
    let mut registry = load_registry(&h.registry);
    if let Some(to) = existing_copy(&registry, "codex", id, |to| threads.contains_key(to)) {
        return Ok(ImportedSession { id: to, title });
    }
    let now = now_ms();
    let to = uuid_v7(now)?;
    let (y, mo, d, hh, mi, ss) = utc_parts(now);
    let dir = h.codex.join("sessions").join(format!("{y:04}")).join(format!("{mo:02}")).join(format!("{d:02}"));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dst = dir.join(format!("rollout-{y:04}-{mo:02}-{d:02}T{hh:02}-{mi:02}-{ss:02}-{to}.jsonl"));
    // Not `rollout-*.jsonl` while it is written, so a listing never sees half a file.
    let tmp = dir.join(format!(".import-{to}.tmp"));
    clean_codex(&threads, id, &to, &codex_default_provider(&h.codex), &tmp, now).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })?;
    fs::rename(&tmp, &dst).map_err(|e| e.to_string())?;
    registry.push(ImportRecord { source: "codex".into(), from: id.into(), to: to.clone(), at_ms: now });
    save_registry(&h.registry, &registry)?;
    Ok(ImportedSession { id: to, title })
}

// --- commands ----------------------------------------------------------------

/// Conversations Claude Code (`source` = "claude"), Codex ("codex"),
/// OpenCode ("opencode") or DeepSeek Harness ("dsh") saved for `cwd`,
/// newest first.
#[tauri::command(async)]
pub fn native_sessions(source: String, cwd: String) -> Result<Vec<NativeSession>, String> {
    match source.as_str() {
        "claude" => list_claude(&homes(), &cwd),
        "codex" => list_codex(&homes(), &cwd),
        "opencode" => Ok(crate::agent_import::opencode_sessions(&cwd)),
        "dsh" => Ok(crate::agent_import::dsh_sessions(&cwd)),
        other => Err(format!("unknown source: {other}")),
    }
}

/// The source an OpenCode conversation continued in OpenCode is recorded
/// under: `from` its id there, `to` the daemon session of the copy.
pub(crate) const OPENCODE_COPY: &str = "opencode-acp";

/// Ids recorded for an OpenCode copy: an OpenCode session id (`ses_…`) and a
/// daemon session id (a UUID).
fn copy_ids_ok(from: &str, to: &str) -> bool {
    let plain = |s: &str, extra: char| {
        !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == extra)
    };
    plain(from, '_') && plain(to, '-')
}

/// Records that OpenCode conversation `from` continues in daemon session
/// `to` (a copy OpenCode made with `session/fork`), so the import lists show
/// it as imported and opening it again opens the copy.
#[tauri::command(async)]
pub fn record_opencode_copy(from: String, to: String) -> Result<(), String> {
    if !copy_ids_ok(&from, &to) {
        return Err("invalid session id".to_string());
    }
    let _one = IMPORTING.lock().unwrap_or_else(|e| e.into_inner());
    let path = homes().registry;
    let mut registry = load_registry(&path);
    registry.retain(|r| !(r.source == OPENCODE_COPY && r.from == from));
    registry.push(ImportRecord { source: OPENCODE_COPY.into(), from, to, at_ms: now_ms() });
    save_registry(&path, &registry)
}

/// Copies one of them for LynShen (see module docs); returns the copy's id,
/// which the engine resumes. An earlier copy is reused. A DSH conversation
/// becomes a LynShen session (agent_import).
/// Imports run one at a time: each reads, extends and rewrites the registry.
pub(crate) static IMPORTING: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tauri::command(async)]
pub fn import_native_session(source: String, cwd: String, id: String) -> Result<ImportedSession, String> {
    let _one = IMPORTING.lock().unwrap_or_else(|e| e.into_inner());
    match source.as_str() {
        "claude" => import_claude(&homes(), &cwd, &id),
        "codex" => import_codex(&homes(), &cwd, &id),
        "dsh" => crate::agent_import::import_dsh(&cwd, &id),
        other => Err(format!("unknown source: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Homes {
        let root = std::env::temp_dir().join(format!("lynshen-native-import-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        Homes { claude: root.join("claude"), codex: root.join("codex"), registry: root.join("imports.json") }
    }

    fn write_lines(path: &Path, rows: &[Value]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let text: Vec<String> = rows.iter().map(|r| r.to_string()).collect();
        fs::write(path, text.join("\n") + "\n").unwrap();
    }

    fn read_lines(path: &Path) -> Vec<Value> {
        fs::read_to_string(path).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    #[test]
    fn opencode_copy_ids_are_checked() {
        assert!(copy_ids_ok("ses_3c2a91f0aBcD", "aaaaaaaa-1111-4111-8111-111111111111"));
        assert!(!copy_ids_ok("../x", "d-1"));
        assert!(!copy_ids_ok("ses_1", "a_b"));
        assert!(!copy_ids_ok("", "d-1"));
    }

    #[test]
    fn uuids_have_their_version_and_variant() {
        let v4 = uuid_v4().unwrap();
        assert!(is_session_id(&v4) && v4.len() == 36 && &v4[14..15] == "4");
        let v7 = uuid_v7(1_790_000_000_000).unwrap();
        assert_eq!(&v7[14..15], "7");
        assert!(matches!(&v7[19..20], "8" | "9" | "a" | "b"));
        assert!(v7.starts_with(&format!("{:012x}", 1_790_000_000_000u64)[..8]));
    }

    #[test]
    fn utc_parts_match_known_instants() {
        assert_eq!(utc_parts(0), (1970, 1, 1, 0, 0, 0));
        // 2026-09-30T16:34:08Z
        assert_eq!(utc_parts(1_790_786_048_000), (2026, 9, 30, 16, 34, 8));
    }

    const OLD: &str = "aaaaaaaa-1111-4111-8111-111111111111";

    fn claude_session(h: &Homes, cwd: &str) {
        write_lines(
            &claude_copy_path(h, cwd, OLD),
            &[
                json!({"type": "user", "uuid": "u1", "parentUuid": null, "sessionId": OLD, "message": {"role": "user", "content": "hi"}}),
                json!({"type": "assistant", "uuid": "a1", "parentUuid": "u1", "sessionId": OLD, "message": {"content": [{"type": "thinking", "thinking": "hm", "signature": "sig"}]}}),
                json!({"type": "assistant", "uuid": "a2", "parentUuid": "a1", "sessionId": OLD, "message": {"content": [{"type": "thinking", "thinking": "more", "signature": "sig2"}, {"type": "text", "text": "hello"}]}}),
                json!({"type": "user", "uuid": "u2", "parentUuid": "a2", "sessionId": OLD, "message": {"role": "user", "content": "next"}}),
            ],
        );
    }

    #[test]
    fn claude_copy_drops_thinking_and_keeps_the_chain() {
        let h = fixture("claude");
        let cwd = "/proj/demo";
        claude_session(&h, cwd);
        let got = import_claude(&h, cwd, OLD).unwrap();
        assert_ne!(got.id, OLD);
        assert_eq!(got.title, "hi");
        let rows = read_lines(&claude_copy_path(&h, cwd, &got.id));
        assert_eq!(rows.len(), 3, "the thinking-only entry is gone");
        assert!(!fs::read_to_string(claude_copy_path(&h, cwd, &got.id)).unwrap().contains("signature"));
        assert_eq!(rows[1]["uuid"], "a2");
        assert_eq!(rows[1]["parentUuid"], "u1", "re-pointed past the dropped entry");
        assert_eq!(rows[1]["message"]["content"], json!([{"type": "text", "text": "hello"}]));
        assert!(rows.iter().all(|r| r["sessionId"] == got.id));
        // The original is untouched.
        assert!(fs::read_to_string(claude_copy_path(&h, cwd, OLD)).unwrap().contains("sig2"));
    }

    #[test]
    fn claude_import_is_listed_once_and_reused() {
        let h = fixture("claude-reuse");
        let cwd = "/proj/demo";
        claude_session(&h, cwd);
        let first = import_claude(&h, cwd, OLD).unwrap();
        let again = import_claude(&h, cwd, OLD).unwrap();
        assert_eq!(first.id, again.id);
        let listed = list_claude(&h, cwd).unwrap();
        assert_eq!(listed.len(), 1, "the copy is not offered for import");
        assert_eq!(listed[0].id, OLD);
        assert_eq!(listed[0].imported.as_deref(), Some(first.id.as_str()));
        // A deleted copy is imported afresh.
        fs::remove_file(claude_copy_path(&h, cwd, &first.id)).unwrap();
        assert_ne!(import_claude(&h, cwd, OLD).unwrap().id, first.id);
    }

    #[test]
    fn claude_sessions_of_windows_folders_and_moved_files_are_found() {
        let h = fixture("claude-win");
        // Claude Code on Windows names `C:\Users\demo\proj` `C--Users-demo-proj`.
        let cwd = r"C:\Users\demo\proj";
        let dir = h.claude.join("projects").join("C--Users-demo-proj");
        let row = json!({"type": "user", "uuid": "u1", "sessionId": OLD, "cwd": cwd, "message": {"role": "user", "content": "hi"}});
        write_lines(&dir.join(format!("{OLD}.jsonl")), std::slice::from_ref(&row));
        assert_eq!(list_claude(&h, cwd).unwrap().len(), 1);
        let got = import_claude(&h, cwd, OLD).unwrap();
        assert!(dir.join(format!("{}.jsonl", got.id)).is_file(), "the copy sits next to the original");
        // A file in a folder named some other way is still found by its id.
        let other = "bbbbbbbb-2222-4222-8222-222222222222";
        let elsewhere = h.claude.join("projects").join("-somewhere-else");
        write_lines(&elsewhere.join(format!("{other}.jsonl")), &[row]);
        let moved = import_claude(&h, cwd, other).unwrap();
        assert!(elsewhere.join(format!("{}.jsonl", moved.id)).is_file());
        assert!(claude_session_file(&h, cwd, "../x").is_none());
    }

    #[test]
    fn codex_home_follows_codex_home_and_the_profile() {
        let env = |key: &str| match key {
            "HOME" => Some(std::ffi::OsString::from("/msys/home/demo")),
            "USERPROFILE" => Some(std::ffi::OsString::from(r"C:\Users\demo")),
            _ => None,
        };
        assert_eq!(codex_home(&env, true), PathBuf::from(r"C:\Users\demo").join(".codex"));
        assert_eq!(codex_home(&env, false), PathBuf::from("/msys/home/demo/.codex"));
        let set = |key: &str| (key == "CODEX_HOME").then(|| std::ffi::OsString::from("/srv/codex"));
        assert_eq!(codex_home(&set, true), PathBuf::from("/srv/codex"));
    }

    #[test]
    fn rejects_bad_ids_and_sources() {
        let h = fixture("bad");
        assert!(import_claude(&h, "/p", "../../etc/passwd").is_err());
        assert!(import_codex(&h, "/p", "../x").is_err());
        assert!(native_sessions("other".into(), "/p".into()).is_err());
    }

    fn meta_line(id: &str, ordinal: i64, ts: &str, extra: Value) -> Value {
        let mut payload = json!({"id": id, "session_id": id, "cwd": "/proj/cx", "originator": "codex-tui", "timestamp": ts, "history_mode": "paginated"});
        payload.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        json!({"timestamp": ts, "ordinal": ordinal, "type": "session_meta", "payload": payload})
    }

    fn item(ordinal: i64, text: &str) -> Value {
        json!({"ordinal": ordinal, "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}})
    }

    const BASE: &str = "01a0e5e4-4f8a-76a3-afa7-70b833e671db";
    const CX: &str = "01a0e6de-54ae-7d41-9929-83329f855028";
    const CX_SEG1: &str = "01a0e7b6-b0b4-7420-8987-a7e4826c1f15";
    const CX_SEG2: &str = "01a0e7ce-f039-7ec3-a9eb-04b4e5108a6f";
    const BASE_SEG: &str = "01a0e5f0-0000-7000-8000-000000000000";

    /// CX forks BASE's first file below ordinal 4, then is rolled back twice
    /// (each segment names the file it continues); BASE itself is rolled back
    /// after the fork, which must not leak into CX.
    fn codex_fixture(h: &Homes) {
        let day = h.codex.join("sessions/2026/09/28");
        write_lines(
            &day.join(format!("rollout-2026-09-28T10-00-00-{BASE}.jsonl")),
            &[
                meta_line(BASE, 0, "2026-09-28T02:00:00Z", json!({})),
                item(1, "base one"),
                item(2, "base two"),
                json!({"ordinal": 3, "type": "response_item", "payload": {"type": "reasoning", "summary": [], "encrypted_content": "zzz"}}),
                item(4, "base after fork point"),
            ],
        );
        write_lines(
            &day.join(format!("rollout-2026-09-28T13-00-00-{BASE}_{BASE_SEG}.jsonl")),
            &[meta_line(BASE, 2, "2026-09-28T05:00:00Z", json!({"history_base": {"thread_id": BASE, "end_ordinal_exclusive": 2}})), item(3, "base rolled back later")],
        );
        write_lines(
            &day.join(format!("rollout-2026-09-28T11-00-00-{CX}.jsonl")),
            &[
                meta_line(CX, 4, "2026-09-28T03:00:00Z", json!({"history_base": {"thread_id": BASE, "end_ordinal_exclusive": 4}, "forked_from_id": BASE})),
                item(5, "fork a"),
                item(6, "fork b (rolled back)"),
                json!({"ordinal": 7, "type": "compacted", "payload": {"message": "", "replacement_history": [{"type": "compaction", "encrypted_content": "sum"}]}}),
            ],
        );
        write_lines(
            &day.join(format!("rollout-2026-09-28T12-00-00-{CX}_{CX_SEG1}.jsonl")),
            &[meta_line(CX, 6, "2026-09-28T04:00:00Z", json!({"history_base": {"thread_id": CX, "end_ordinal_exclusive": 6}})), item(7, "fork c"), item(8, "fork d (rolled back)")],
        );
        write_lines(
            &day.join(format!("rollout-2026-09-28T12-30-00-{CX}_{CX_SEG2}.jsonl")),
            &[meta_line(CX, 8, "2026-09-28T04:30:00Z", json!({"history_base": {"thread_id": CX_SEG1, "end_ordinal_exclusive": 8}})), item(9, "fork e")],
        );
        fs::write(h.codex.join("session_index.jsonl"), format!("{{\"id\":\"{CX}\",\"thread_name\":\"Named\"}}\n")).unwrap();
    }

    #[test]
    fn codex_copy_flattens_base_and_segments() {
        let h = fixture("codex");
        codex_fixture(&h);
        let got = import_codex(&h, "/proj/cx/", CX).unwrap();
        assert_eq!(got.title, "Named");
        let threads = codex_threads(&h.codex);
        let segs = threads.get(&got.id).expect("the copy is a thread of its own");
        assert_eq!(segs.len(), 1);
        let rows = read_lines(&segs[0].path);
        assert_eq!(rows[0]["type"], "session_meta");
        assert_eq!(rows[0]["payload"]["id"], got.id);
        assert!(rows[0]["payload"].get("history_base").is_none());
        assert_eq!(rows[0]["payload"]["model_provider"], "openai", "this Codex's provider, not the writer's");
        let texts: Vec<&str> = rows[1..]
            .iter()
            .filter_map(|r| r["payload"]["content"][0]["text"].as_str())
            .collect();
        assert_eq!(texts, ["base one", "base two", "fork a", "fork c", "fork e"]);
        assert!(rows.iter().all(|r| r["type"] != "compacted"), "the encrypted compaction is dropped");
        let ordinals: Vec<i64> = rows.iter().map(|r| r["ordinal"].as_i64().unwrap()).collect();
        assert_eq!(ordinals, (0..rows.len() as i64).collect::<Vec<_>>());
        assert!(!fs::read_to_string(&segs[0].path).unwrap().contains("encrypted_content"));
        // Listed once, marked imported; the copy itself is not offered.
        let listed = list_codex(&h, "/proj/cx").unwrap();
        let ids: Vec<&str> = listed.iter().map(|s| s.id.as_str()).collect();
        assert!(ids.contains(&CX) && ids.contains(&BASE) && !ids.contains(&got.id.as_str()));
        assert_eq!(listed.iter().find(|s| s.id == CX).unwrap().imported.as_deref(), Some(got.id.as_str()));
        assert_eq!(import_codex(&h, "/proj/cx", CX).unwrap().id, got.id);
    }

    #[test]
    fn codex_subagents_and_archived_threads_are_not_offered() {
        let h = fixture("codex-sub");
        codex_fixture(&h);
        let sub = "01a0b4a1-7eb1-74a1-941a-5720df5a7c9e";
        write_lines(
            &h.codex.join(format!("sessions/2026/09/28/rollout-2026-09-28T13-00-00-{sub}.jsonl")),
            &[meta_line(sub, 0, "2026-09-28T05:00:00Z", json!({"thread_source": "subagent", "source": {"subagent": {}}})), item(1, "x")],
        );
        // The base now lives only in the archive: still readable as a base.
        let day = h.codex.join("sessions/2026/09/28");
        let archived = h.codex.join("archived_sessions");
        fs::create_dir_all(&archived).unwrap();
        let name = format!("rollout-2026-09-28T10-00-00-{BASE}.jsonl");
        fs::rename(day.join(&name), archived.join(&name)).unwrap();
        let seg = format!("rollout-2026-09-28T13-00-00-{BASE}_{BASE_SEG}.jsonl");
        fs::rename(day.join(&seg), archived.join(&seg)).unwrap();
        let ids: Vec<String> = list_codex(&h, "/proj/cx").unwrap().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, [CX]);
        assert!(import_codex(&h, "/proj/cx", sub).is_err());
        assert!(import_codex(&h, "/proj/cx", CX).is_ok());
        // A base that is gone entirely is an error, not a silently shorter copy.
        fs::remove_file(archived.join(&name)).unwrap();
        fs::remove_file(&h.registry).unwrap();
        assert!(import_codex(&h, "/proj/cx", CX).unwrap_err().contains("no longer has"));
    }

    #[test]
    fn default_provider_is_read_from_the_top_of_config() {
        let h = fixture("provider");
        fs::create_dir_all(&h.codex).unwrap();
        assert_eq!(codex_default_provider(&h.codex), "openai");
        fs::write(
            h.codex.join("config.toml"),
            "model = \"x\"\nmodel_provider = \"custom\" # mine\n[model_providers.custom]\nmodel_provider = \"no\"\n",
        )
        .unwrap();
        assert_eq!(codex_default_provider(&h.codex), "custom");
        fs::write(h.codex.join("config.toml"), "[profiles.a]\nmodel_provider = \"no\"\n").unwrap();
        assert_eq!(codex_default_provider(&h.codex), "openai");
        fs::write(
            h.codex.join("config.toml"),
            "model_provider = 'custom'\nprofile = \"work\"\n[profiles.work]\nmodel_provider = \"recodex\"\n",
        )
        .unwrap();
        assert_eq!(codex_default_provider(&h.codex), "recodex", "the selected profile wins");
    }

    fn zst(text: &str) -> Vec<u8> {
        ruzstd::encoding::compress_to_vec(text.as_bytes(), ruzstd::encoding::CompressionLevel::Fastest)
    }

    fn text_of(path: &Path) -> String {
        let mut text = String::new();
        open_rollout(path).unwrap().read_to_string(&mut text).unwrap();
        text
    }

    #[test]
    fn compressed_rollouts_read_as_their_text_across_frames() {
        let h = fixture("zstd-frames");
        let path = h.codex.join("sessions/2026/10/01/rollout-2026-10-01T00-00-00-x.jsonl.zst");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let (one, two) = ("{\"a\":\"一\"}\n", "{\"b\":2}\n");
        fs::write(&path, zst(one)).unwrap();
        assert_eq!(text_of(&path), one);
        // Codex reads past further frames and skippable ones; so does this.
        let mut bytes = zst(one);
        bytes.extend_from_slice(&0x184D_2A50u32.to_le_bytes());
        bytes.extend_from_slice(&3u32.to_le_bytes());
        bytes.extend_from_slice(b"xyz");
        bytes.extend(zst(two));
        fs::write(&path, &bytes).unwrap();
        assert_eq!(text_of(&path), format!("{one}{two}"));
        // Not Zstandard, or cut short: an error, never a shorter text.
        for bad in [&b"zz"[..], &b"not zstd at all"[..], &bytes[..bytes.len() - 3]] {
            fs::write(&path, bad).unwrap();
            assert!(open_rollout(&path).unwrap().read_to_string(&mut String::new()).is_err());
        }
        fs::write(&path, b"zz").unwrap();
        assert!(first_line(&path).is_none());
    }

    const WIN: &str = r"D:\我要干大活\三角帧不掉洲";
    const PAGED: &str = "019a3b10-6c2e-7d11-9a40-1d3c5e7f0a01";
    const PACKED: &str = "019a1f22-3b4c-7e55-8f66-2a4b6c8d0e02";
    const LEGACY: &str = "019963aa-1b2c-7d3e-8f40-3c5e7a9b1d03";
    const FORKED: &str = "019a2c33-4d5e-7f60-9a71-4e6f8a0b2c04";
    const BOTH: &str = "019a3b55-6f70-7182-9c93-6a8192a3b406";

    /// A Codex home with the rollouts tests/fixtures/codex/make-fixtures.mjs
    /// writes: Codex Desktop's paginated threads, plain and compressed.
    fn codex_fixtures(name: &str) -> Homes {
        let h = fixture(name);
        let from = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/codex/home/.codex");
        fn copy(from: &Path, to: &Path) {
            fs::create_dir_all(to).unwrap();
            for entry in fs::read_dir(from).unwrap().flatten() {
                if entry.path().is_dir() {
                    copy(&entry.path(), &to.join(entry.file_name()));
                } else {
                    fs::copy(entry.path(), to.join(entry.file_name())).unwrap();
                }
            }
        }
        copy(&from, &h.codex);
        h
    }

    fn prompts_of(rows: &[Value]) -> Vec<String> {
        rows.iter().filter_map(codex_prompt).collect()
    }

    fn ordinals_run_on(rows: &[Value]) {
        let ordinals: Vec<i64> = rows.iter().filter_map(|r| r["ordinal"].as_i64()).collect();
        assert_eq!(ordinals, (0..ordinals.len() as i64).collect::<Vec<_>>());
    }

    #[test]
    fn codex_paginated_and_compressed_threads_are_listed() {
        let h = codex_fixtures("codex-paged");
        let files = rollout_files(&h.codex);
        assert_eq!(files.len(), 6, "a file in both forms counts once, the staging file not at all: {files:?}");
        assert!(files.iter().all(|f| !f.to_string_lossy().ends_with(".tmp")));
        let threads = codex_threads(&h.codex);
        assert_eq!(threads.len(), 5);
        assert!(!is_compressed(&threads[BOTH][0].path), "of a file in both forms the plain one is read");
        assert_eq!(threads[FORKED].len(), 2, "the compressed first file and the plain one that continues it");
        let prompts = |id: &str| codex_thread_prompts(&threads, id);
        // FORKED: its first turn, then the one after the rollback (the turn
        // rolled back is still in its compressed first file).
        assert_eq!([prompts(PAGED), prompts(PACKED), prompts(LEGACY), prompts(BOTH), prompts(FORKED)], [2, 3, 2, 1, 2]);
        let listed = list_codex(&h, WIN).unwrap();
        let title = |id: &str| listed.iter().find(|s| s.id == id).map(|s| s.title.as_str()).unwrap_or("(not listed)");
        // The name Codex gave it (the last one), else the first prompt, past
        // the AGENTS.md and environment blocks Codex injects.
        assert_eq!(title(PAGED), "添加关闭预启动开关");
        assert_eq!(title(PACKED), "修复安装包进程终止与启动");
        assert_eq!(title(LEGACY), "检查前台游戏调度时间片");
        assert_eq!(title(FORKED), "评估项目能否用于优化工具");
        assert_eq!(title(BOTH), "修复游戏目录识别崩溃");
        assert_eq!(listed.iter().find(|s| s.id == PAGED).unwrap().origin, "Codex Desktop");
    }

    #[test]
    fn codex_compressed_and_paginated_threads_import_whole() {
        let h = codex_fixtures("codex-paged-import");
        // Compressed: the copy is the whole thread, written plain.
        let original = codex_threads(&h.codex)[PACKED][0].path.clone();
        let got = import_codex(&h, WIN, PACKED).unwrap();
        let copy = codex_threads(&h.codex)[&got.id][0].path.clone();
        assert!(!is_compressed(&copy));
        let rows = read_lines(&copy);
        assert_eq!(rows.len(), text_of(&original).lines().count());
        assert_eq!(prompts_of(&rows), ["修复安装包进程终止与启动", "安装失败时给出提示", "再跑一遍测试"]);
        assert_eq!((rows[0]["payload"]["id"].as_str(), rows[0]["payload"]["history_mode"].as_str()), (Some(got.id.as_str()), Some("paginated")));
        ordinals_run_on(&rows);
        assert!(!fs::read_to_string(&copy).unwrap().contains("encrypted_content"));
        assert!(original.is_file(), "the original is left as it was");
        // Rolled back after its first file was compressed: that file up to
        // the point the plain one continues it, then the plain one.
        let got = import_codex(&h, WIN, FORKED).unwrap();
        let rows = read_lines(&codex_threads(&h.codex)[&got.id][0].path);
        assert_eq!(prompts_of(&rows), ["评估项目能否用于优化工具", "改成先评估再优化"]);
        ordinals_run_on(&rows);
        // Plain paginated and compressed legacy threads.
        let got = import_codex(&h, WIN, PAGED).unwrap();
        assert_eq!(got.title, "添加关闭预启动开关");
        assert_eq!(prompts_of(&read_lines(&codex_threads(&h.codex)[&got.id][0].path)), ["添加关闭预启动开关", "启动时也读取这个开关"]);
        let got = import_codex(&h, WIN, LEGACY).unwrap();
        assert_eq!(prompts_of(&read_lines(&codex_threads(&h.codex)[&got.id][0].path)), ["检查前台游戏调度时间片", "把结果写成表格"]);
    }

    #[test]
    fn codex_prompts_are_what_the_user_typed() {
        let row = |payload: Value| json!({"type": "event_msg", "payload": payload});
        let item = |content: Value| row(json!({"type": "item_completed", "item": {"type": "UserMessage", "id": "u", "content": content}}));
        assert_eq!(codex_prompt(&row(json!({"type": "user_message", "message": " fix it "}))).as_deref(), Some("fix it"));
        assert_eq!(
            codex_prompt(&item(json!([{"type": "text", "text": "看这张图"}, {"type": "local_image", "path": "a.png"}, {"type": "text", "text": "然后改"}]))).as_deref(),
            Some("看这张图\n然后改")
        );
        // Injected blocks, agent messages, other rows and empty ones are not prompts.
        assert!(codex_prompt(&row(json!({"type": "user_message", "message": "<environment_context></environment_context>"}))).is_none());
        assert!(codex_prompt(&item(json!([{"type": "local_image", "path": "a.png"}]))).is_none());
        assert!(codex_prompt(&row(json!({"type": "item_completed", "item": {"type": "AgentMessage", "content": [{"type": "Text", "text": "hi"}]}}))).is_none());
        assert!(codex_prompt(&json!({"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hi"}]}})).is_none());
    }

    #[test]
    fn codex_threads_of_other_directories_are_refused() {
        let h = fixture("codex-dir");
        codex_fixture(&h);
        assert!(list_codex(&h, "/elsewhere").unwrap().is_empty());
        assert!(import_codex(&h, "/elsewhere", CX).is_err());
    }
}
