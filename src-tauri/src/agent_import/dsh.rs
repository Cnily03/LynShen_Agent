//! DeepSeek Harness (DSH, `deepseek-ai/deepseek-harness`) conversations,
//! converted into LynShen sessions (sessions.rs). DSH's files are only read.
//!
//! Where: `<home>/sessions`. The home is `$DSH_HOME`, else `~/.dsh`. DSH's
//! desktop edition moves it by saving a user-level `DSH_HOME` (Windows:
//! `HKCU\Environment`; macOS and Linux: a marked block in `~/.profile`, a
//! LaunchAgent, a systemd `environment.d` file). An app that is already
//! running does not have that value in its environment, so those places are
//! read as well, and `~/.dsh` is always looked at too.
//!
//! Layout (dsh-session-persistence-jsonl): `sessions/<project>/<session>/`
//! holds one log per format generation, `session.jsonl` (format 0) and
//! `session.v<N>.jsonl`, each `.zstd` unless DSH was set to write plain text.
//! The highest generation is the conversation. This version reads format 4,
//! the one DSH writes since 0.2.0: a header line, then one event per line.
//! DSH updates an older log when it opens the conversation, so the page
//! gives that advice for one; a newer log, or one with an event this version
//! does not know and may not skip, is reported, not guessed at.
//!
//! A compressed log is a series of Zstandard frames: the header in the
//! first, then one frame per write. A crash can leave the last frame (or,
//! in plain text, the last line) cut short; that write is left out, as DSH
//! leaves it out.
//!
//! The conversation is the events that entered it where they happened
//! (`surfaceOp: "append"`): the user's prompts (`user/message` from the
//! user; the context DSH adds itself is left out), the assistant's text and
//! tool calls (`assistant/message`; reasoning is dropped) and the tool
//! results (`tool/result`). Copies that replaced them later (a compaction's
//! summary, a shortened tool result) stand for history the copy has in full.
//! An image or a file sent with a prompt becomes a note in its text. The
//! title is the latest `session/title`. A sub-agent's log (`origin:
//! "subagent"`) is part of the conversation that ran it and is not listed;
//! a fork is a conversation of its own.

use super::sessions::{
    converted_copy, converted_imported, first_line_of, Conversation, Found, Report, SkipKind, Turn, Unreadable,
};
use super::Roots;
use crate::claude_history::Env;
use crate::native_import::{mtime_ms, same_dir, ImportRecord, NativeSession};
use ruzstd::decoding::{BlockDecodingStrategy, FrameDecoder};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::ops::Range;
use std::path::{Path, PathBuf};

pub(super) const SOURCE: &str = "dsh";
/// The session format this version reads (DSH's `SESSION_FORMAT_VERSION`).
const FORMAT: u64 = 4;
const ZSTD_MAGIC: u32 = 0xFD2F_B528;
/// Conversations a history picker lists.
const MAX_LISTED: usize = 50;

/// What DSH's desktop edition (`APP_IDENTIFIER` "dsh-tauri") writes to keep
/// `DSH_HOME` on macOS and Linux.
const PROFILE_START: &str = "# >>> deepseek-harness dsh home >>>";
const PROFILE_END: &str = "# <<< deepseek-harness dsh home <<<";
const LAUNCH_AGENT: &str = "Library/LaunchAgents/dsh-tauri.env.plist";
const ENVIRONMENT_D: &str = ".config/environment.d/dsh-tauri.conf";

/// The event types of format 4 (`KNOWN_SESSION_EVENT_TYPES`, DSH 0.2.1).
/// DSH refuses a log with any other type unless the event is marked
/// `ignorable`: a newer DSH marks what an older one may skip.
const KNOWN_EVENTS: &[&str] = &[
    "agent-preset/selected", "agent/inbox/spliced", "approval/asked", "approval/decided", "approval/policy",
    "assistant/attempt", "assistant/message", "command/done", "command/run", "compaction/end", "compaction/prune",
    "compaction/start", "compaction/summary", "deliverables/presented", "developer/message",
    "feedback/message-delete", "feedback/message-put", "feedback/record", "goal/change", "hook/invoked",
    "hook/result", "image/offload", "job/registered", "job/settled", "llm/retry", "llm/retry-started",
    "model/selection", "permission/preset", "plan/mode", "request/context", "request/header", "sandbox/mode",
    "schedule/change", "session-log-deepseek/delivery-accepted", "session/end-seed", "session/title",
    "session/title-llm-request", "step/end", "step/start", "subagent/catalog", "subagent/descriptor",
    "subagent/model-selection-policy", "system/message", "team/member", "team/message/delivered",
    "team/message/queued", "team/task", "todo/write", "tool-workflow/agent-end", "tool-workflow/agent-start",
    "tool-workflow/run-end", "tool-workflow/run-start", "tool/call", "tool/ptc-dispatch", "tool/ptc-dispatch-start",
    "tool/result", "turn/end", "turn/start", "user/message", "web/deepseek-search-llm-request",
    "working-directory/change", "workspace/changes",
];

// --- where DSH keeps its data -------------------------------------------------

/// DSH's home folders, the one in use first: `$DSH_HOME`; the values its
/// desktop edition saved (`saved`: the login shell's and the Windows
/// registry's, which the caller reads; then the files it writes on macOS and
/// Linux); then `~/.dsh`. Blank and relative values are left out (DSH would
/// resolve a relative one against a working folder this app does not know).
pub(super) fn homes(env: Env, windows: bool, home: &Path, saved: &[String]) -> Vec<PathBuf> {
    let mut values: Vec<String> = env("DSH_HOME").map(|v| v.to_string_lossy().into_owned()).into_iter().collect();
    values.extend(saved.iter().cloned());
    if !windows {
        let read = |file: &str| fs::read_to_string(home.join(file)).ok();
        values.extend(read(".profile").and_then(|text| profile_value(&text)));
        values.extend(read(LAUNCH_AGENT).and_then(|text| launch_agent_value(&text)));
        values.extend(read(ENVIRONMENT_D).and_then(|text| environment_d_value(&text)));
    }
    let mut out: Vec<PathBuf> = Vec::new();
    for value in values {
        if let Some(path) = home_value(&value, env, windows, home) {
            if !out.contains(&path) {
                out.push(path);
            }
        }
    }
    let default = home.join(".dsh");
    if !out.contains(&default) {
        out.push(default);
    }
    out
}

/// `DSH_HOME` where this app's environment may not have it yet: the login
/// shell's (captured when the app started) and, on Windows, the user's
/// registry value, which DSH's desktop edition sets when it moves the folder.
pub(super) fn saved_homes() -> Vec<String> {
    let shell = crate::shell_env::snapshot_vars().and_then(|vars| vars.get("DSH_HOME").cloned());
    shell.into_iter().chain(registry_home()).collect()
}

#[cfg(windows)]
fn registry_home() -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey("Environment").ok()?.get_value("DSH_HOME").ok()
}

#[cfg(not(windows))]
fn registry_home() -> Option<String> {
    None
}

/// A `DSH_HOME` value as a path: trimmed, `%VAR%` expanded on Windows (a
/// registry value may hold them), `~` for the home folder. None when blank
/// or relative.
fn home_value(value: &str, env: Env, windows: bool, home: &Path) -> Option<PathBuf> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let value = if windows { expand_percent(value, env) } else { value.to_string() };
    let path = super::expand_home(&value, home);
    path.is_absolute().then_some(path)
}

/// `%NAME%` replaced by that variable; unknown names stay as written.
fn expand_percent(value: &str, env: Env) -> String {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('%').filter(|end| *end > 0) else { break };
        match env(&after[..end]) {
            Some(found) => {
                out.push_str(&rest[..start]);
                out.push_str(&found.to_string_lossy());
            }
            None => out.push_str(&rest[..start + end + 2]),
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

/// `DSH_HOME` in the block the desktop edition adds to `~/.profile`.
fn profile_value(text: &str) -> Option<String> {
    let mut inside = false;
    for line in text.lines().map(str::trim) {
        if line == PROFILE_START {
            inside = true;
        } else if line == PROFILE_END {
            inside = false;
        } else if let Some(raw) = line.strip_prefix("export DSH_HOME=").filter(|_| inside) {
            let value = unquote_sh(raw.trim());
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

/// A double-quoted shell word, as the desktop edition writes the value.
fn unquote_sh(raw: &str) -> String {
    let inner = raw.strip_prefix('"').and_then(|r| r.strip_suffix('"')).unwrap_or(raw);
    let mut out = String::with_capacity(inner.len());
    let mut escaped = false;
    for c in inner.chars() {
        if escaped || c != '\\' {
            out.push(c);
            escaped = false;
        } else {
            escaped = true;
        }
    }
    out
}

/// `DSH_HOME` in the LaunchAgent the desktop edition installs on macOS
/// (`launchctl setenv DSH_HOME <value>`).
fn launch_agent_value(text: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    let at = lines.iter().position(|line| *line == "<string>DSH_HOME</string>")?;
    let raw = lines.get(at + 1)?.strip_prefix("<string>")?.strip_suffix("</string>")?;
    let value = raw.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&amp;", "&");
    (!value.is_empty()).then_some(value)
}

/// `DSH_HOME` in the systemd `environment.d` file it writes on Linux.
fn environment_d_value(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .filter_map(|line| line.strip_prefix("DSH_HOME="))
        .map(|raw| raw.trim().trim_matches('"').replace("$$", "$"))
        .find(|value| !value.is_empty())
}

// --- logs ---------------------------------------------------------------------

/// One conversation's newest log.
struct Log {
    path: PathBuf,
    version: u64,
    compressed: bool,
}

/// Why a log cannot be imported: the kind the page names, and the detail for
/// the app's log.
type Failure = (SkipKind, String);

/// `session.jsonl` (format 0) or `session.v<N>.jsonl`, plain or `.zstd`:
/// the format, and whether it is compressed. Other names (DSH's temporary
/// files, `v0`, leading zeros) are not logs.
fn generation(name: &str) -> Option<(u64, bool)> {
    let (name, compressed) = match name.strip_suffix(".zstd") {
        Some(plain) => (plain, true),
        None => (name, false),
    };
    let middle = name.strip_prefix("session")?.strip_suffix(".jsonl")?;
    if middle.is_empty() {
        return Some((0, compressed));
    }
    let digits = middle.strip_prefix(".v")?;
    if digits.starts_with('0') || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((digits.parse().ok()?, compressed))
}

/// The newest log in a conversation's folder; None when it holds none.
fn newest_log(dir: &Path) -> Option<Log> {
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let (version, compressed) = generation(name.to_str()?)?;
            Some(Log { path: entry.path(), version, compressed })
        })
        .max_by_key(|log| (log.version, mtime_ms(&log.path)))
}

/// Every conversation folder under the homes' `sessions` folders
/// (`<project>/<conversation>`).
fn session_dirs(roots: &Roots) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for root in roots.dsh.iter().map(|home| home.join("sessions")) {
        let Ok(projects) = fs::read_dir(&root) else { continue };
        for project in projects.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
            let Ok(sessions) = fs::read_dir(&project) else { continue };
            out.extend(sessions.flatten().map(|e| e.path()).filter(|p| p.is_dir()));
        }
    }
    out
}

/// DSH's `encodeSegment`: the folder name of a conversation id (`~XXXX` for
/// each UTF-16 unit outside `[A-Za-z0-9._-]`).
fn encode_segment(id: &str) -> String {
    match id {
        "." => "~002E".to_string(),
        ".." => "~002E~002E".to_string(),
        _ => id
            .encode_utf16()
            .map(|unit| match char::from_u32(u32::from(unit)) {
                Some(c) if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') => c.to_string(),
                _ => format!("~{unit:04X}"),
            })
            .collect(),
    }
}

/// The log of conversation `id` (its folder is named after the id).
fn find(roots: &Roots, id: &str) -> Option<Log> {
    if id.is_empty() {
        return None;
    }
    let name = encode_segment(id);
    roots
        .dsh
        .iter()
        .filter_map(|home| fs::read_dir(home.join("sessions")).ok())
        .flat_map(|projects| projects.flatten())
        .map(|project| project.path().join(&name))
        .filter(|dir| dir.is_dir())
        .find_map(|dir| newest_log(&dir))
}

fn trim_cr(line: &[u8]) -> &[u8] {
    line.strip_suffix(b"\r").unwrap_or(line)
}

/// Calls `each` with every complete line of a log in order, the header
/// first, until it returns false. A last write cut short is left out.
fn lines(log: &Log, each: &mut dyn FnMut(&[u8]) -> bool) -> Result<(), Failure> {
    if log.compressed {
        zstd_lines(&log.path, each)
    } else {
        plain_lines(&log.path, each)
    }
}

fn plain_lines(path: &Path, each: &mut dyn FnMut(&[u8]) -> bool) -> Result<(), Failure> {
    let file = fs::File::open(path).map_err(|e| (SkipKind::Unreadable, format!("file cannot be opened ({e})")))?;
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    loop {
        line.clear();
        let read = reader
            .read_until(b'\n', &mut line)
            .map_err(|e| (SkipKind::Unreadable, format!("file cannot be read ({e})")))?;
        // The end, or a last line without its newline: a write cut short.
        if read == 0 || line.last() != Some(&b'\n') {
            return Ok(());
        }
        line.pop();
        if !each(trim_cr(&line)) {
            return Ok(());
        }
    }
}

fn zstd_lines(path: &Path, each: &mut dyn FnMut(&[u8]) -> bool) -> Result<(), Failure> {
    let bytes = fs::read(path).map_err(|e| (SkipKind::Unreadable, format!("file cannot be read ({e})")))?;
    let damaged = |e: String| (SkipKind::Unrecognised, format!("damaged log ({e})"));
    let mut decoder = FrameDecoder::new();
    let mut pending: Vec<u8> = Vec::new();
    let mut at = 0;
    while let Some(frame) = next_frame(&bytes, at).map_err(damaged)? {
        at = frame.end;
        let text = decode_frame(&mut decoder, &bytes[frame]).map_err(damaged)?;
        pending.extend_from_slice(&text);
        let mut start = 0;
        while let Some(end) = pending[start..].iter().position(|&b| b == b'\n') {
            if !each(trim_cr(&pending[start..start + end])) {
                return Ok(());
            }
            start += end + 1;
        }
        pending.drain(..start);
    }
    Ok(())
}

/// The next complete frame of a series of Zstandard frames, found from its
/// structure as DSH finds it (`scanZstdFrames`). None at the end, or where a
/// last frame was cut short; an error where the structure is not Zstandard.
fn next_frame(bytes: &[u8], start: usize) -> Result<Option<Range<usize>>, String> {
    let len = bytes.len();
    let mut at = start;
    if len - at < 4 {
        return Ok(None);
    }
    let magic = u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    if magic != ZSTD_MAGIC {
        return Err(format!("no Zstandard frame at byte {at}"));
    }
    at += 4;
    if at == len {
        return Ok(None);
    }
    let descriptor = bytes[at];
    at += 1;
    if (descriptor & 0x18) != 0 {
        return Err(format!("reserved frame header bit at byte {}", at - 1));
    }
    let single = (descriptor & 0x20) != 0;
    let size_flag = descriptor >> 6;
    let dictionary: usize = [0, 1, 2, 4][usize::from(descriptor & 0x03)];
    let content_size: usize = if size_flag == 0 { usize::from(single) } else { 1 << size_flag };
    let header = usize::from(!single) + dictionary + content_size;
    if len - at < header {
        return Ok(None);
    }
    at += header;
    loop {
        if len - at < 3 {
            return Ok(None);
        }
        let block = u32::from(bytes[at]) | (u32::from(bytes[at + 1]) << 8) | (u32::from(bytes[at + 2]) << 16);
        at += 3;
        let kind = (block >> 1) & 0x03;
        if kind == 3 {
            return Err(format!("reserved block type at byte {}", at - 3));
        }
        let payload = if kind == 1 { 1 } else { (block >> 3) as usize };
        if len - at < payload {
            return Ok(None);
        }
        at += payload;
        if (block & 1) != 0 {
            break;
        }
    }
    if (descriptor & 0x04) != 0 {
        if len - at < 4 {
            return Ok(None);
        }
        at += 4;
    }
    Ok(Some(start..at))
}

fn decode_frame(decoder: &mut FrameDecoder, mut frame: &[u8]) -> Result<Vec<u8>, String> {
    decoder.reset(&mut frame).map_err(|e| e.to_string())?;
    decoder.decode_blocks(&mut frame, BlockDecodingStrategy::All).map_err(|e| e.to_string())?;
    decoder.collect().ok_or_else(|| "frame not finished".to_string())
}

// --- reading a log --------------------------------------------------------------

/// What a log's first line says.
struct Header {
    id: String,
    cwd: Option<String>,
    version: u64,
    /// A sub-agent's log, part of the conversation that ran it.
    subagent: bool,
}

fn read_header(log: &Log) -> Result<Header, Failure> {
    let mut first: Option<Vec<u8>> = None;
    lines(log, &mut |line: &[u8]| {
        first = Some(line.to_vec());
        false
    })?;
    let unknown = |why: &str| (SkipKind::Unrecognised, format!("not a DSH session log ({why})"));
    let first = first.ok_or_else(|| unknown("empty"))?;
    let v: Value = serde_json::from_slice(&first).map_err(|_| unknown("the first line is not JSON"))?;
    let (Some("session"), Some(version), Some(id)) = (v["type"].as_str(), v["version"].as_u64(), v["id"].as_str()) else {
        return Err(unknown("no session header"));
    };
    if version != log.version {
        return Err(unknown(&format!("the header says format {version}, the file name {}", log.version)));
    }
    Ok(Header {
        id: id.to_string(),
        cwd: v["cwd"].as_str().filter(|c| !c.is_empty()).map(str::to_string),
        version,
        subagent: v["origin"].as_str() == Some("subagent"),
    })
}

/// What the events of a format 4 log hold.
#[derive(Default)]
struct Body {
    /// The latest title DSH (or the user) gave it.
    title: String,
    /// The first line of the user's first prompt.
    first: String,
    prompts: usize,
    /// The latest event's time (ms).
    updated_ms: u64,
    /// When read in full: the conversation.
    turns: Vec<(u64, Turn)>,
}

impl Body {
    fn title(&self) -> String {
        if self.title.is_empty() { self.first.clone() } else { self.title.clone() }
    }
}

/// A row's type and time, read from its start (DSH writes every row as
/// `{"type":…,"seq":…,"time":…,"data":…}`) without parsing the rest.
fn head(line: &[u8]) -> Option<(&str, u64)> {
    let rest = line.strip_prefix(b"{\"type\":\"")?;
    let end = rest.iter().position(|&b| b == b'"' || b == b'\\')?;
    let kind = std::str::from_utf8(&rest[..end]).ok()?;
    let rest = rest[end..].strip_prefix(b"\",\"seq\":")?;
    let rest = &rest[rest.iter().take_while(|b| b.is_ascii_digit()).count()..];
    let rest = rest.strip_prefix(b",\"time\":")?;
    let digits = rest.iter().take_while(|b| b.is_ascii_digit()).count();
    let time = std::str::from_utf8(&rest[..digits]).ok()?.parse().ok()?;
    Some((kind, time))
}

/// The text of message blocks; an image or a file is named, not carried.
fn content_text(content: &Value) -> String {
    let parts: Vec<String> = content
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|block| match block["type"].as_str() {
            Some("text") => block["text"].as_str().map(str::to_string),
            Some("image") => Some("[图片]".to_string()),
            Some("file") => Some(format!("[文件：{}]", block["attachment"]["name"].as_str().unwrap_or(""))),
            _ => None,
        })
        .collect();
    parts.join("\n")
}

/// Reads the events after the header, one line at a time.
struct Reader {
    /// The whole conversation, not only what a listing shows.
    full: bool,
    body: Body,
    /// Tool call id → tool name (a result names only the call).
    names: HashMap<String, String>,
    line: usize,
    /// The first line that is not an event. DSH keeps what comes before it
    /// and drops the rest, unless a turn ends after it: then the log is
    /// damaged.
    damaged: Option<usize>,
}

impl Reader {
    fn row(&mut self, line: &[u8]) -> Result<(), Failure> {
        self.line += 1;
        let typed = head(line).map(|(kind, time)| (kind.to_string(), time)).or_else(|| {
            let v: Value = serde_json::from_slice(line).ok()?;
            Some((v["type"].as_str()?.to_string(), v["time"].as_u64().unwrap_or(0)))
        });
        let Some((kind, time)) = typed else {
            if self.damaged.is_none() {
                self.damaged = Some(self.line);
            }
            return Ok(());
        };
        if let Some(at) = self.damaged {
            if kind == "turn/end" {
                return Err((SkipKind::Unrecognised, format!("damaged log (line {} is not an event)", at + 1)));
            }
            return Ok(());
        }
        self.body.updated_ms = self.body.updated_ms.max(time);
        if !KNOWN_EVENTS.contains(&kind.as_str()) {
            let ignorable = serde_json::from_slice::<Value>(line).is_ok_and(|v| v["ignorable"].as_bool() == Some(true));
            if ignorable {
                return Ok(());
            }
            return Err((SkipKind::NewerFormat, format!("event {kind} from a newer DSH")));
        }
        let wanted = match kind.as_str() {
            "session/title" | "user/message" => true,
            "assistant/message" | "tool/result" => self.full,
            _ => false,
        };
        if !wanted {
            return Ok(());
        }
        match serde_json::from_slice::<Value>(line) {
            Ok(v) => self.event(&kind, time / 1000, &v),
            Err(_) => self.damaged = Some(self.line),
        }
        Ok(())
    }

    fn event(&mut self, kind: &str, at: u64, v: &Value) {
        let data = &v["data"];
        // Where it happened, not a copy that replaced earlier events.
        let appended = v["surfaceOp"].as_str() == Some("append");
        match kind {
            "session/title" => {
                let title = first_line_of(data["title"].as_str().unwrap_or(""));
                if !title.is_empty() {
                    self.body.title = title;
                }
            }
            // Only what the user sent: DSH adds context as user messages too.
            "user/message" if appended && data["source"]["kind"].as_str() == Some("user") => {
                let text = content_text(&data["content"]);
                if text.trim().is_empty() {
                    return;
                }
                self.body.prompts += 1;
                if self.body.first.is_empty() {
                    self.body.first = first_line_of(&text);
                }
                if self.full {
                    self.body.turns.push((at, Turn::User(text)));
                }
            }
            "assistant/message" if appended => {
                for block in data["message"]["content"].as_array().into_iter().flatten() {
                    match block["type"].as_str() {
                        Some("text") => {
                            self.body.turns.push((at, Turn::Assistant(block["text"].as_str().unwrap_or("").to_string())))
                        }
                        Some("tool-call") => {
                            let call_id = block["id"].as_str().unwrap_or("").to_string();
                            let name = block["name"].as_str().unwrap_or("tool").to_string();
                            let arguments = match &block["arguments"] {
                                Value::String(s) => s.clone(),
                                Value::Null => "{}".to_string(),
                                other => other.to_string(),
                            };
                            self.names.insert(call_id.clone(), name.clone());
                            self.body.turns.push((at, Turn::Call { call_id, name, arguments }));
                        }
                        // reasoning
                        _ => {}
                    }
                }
            }
            "tool/result" if appended => {
                let message = &data["message"];
                let call_id = message["toolCallId"]
                    .as_str()
                    .or_else(|| message["source"]["callId"].as_str())
                    .unwrap_or("")
                    .to_string();
                let text = content_text(&message["content"]);
                let output = if message["isError"].as_bool() == Some(true) { format!("Error: {text}") } else { text };
                let name = self.names.get(&call_id).cloned().unwrap_or_else(|| "tool".to_string());
                self.body.turns.push((at, Turn::Output { call_id, name, output }));
            }
            _ => {}
        }
    }
}

/// Reads the events of a format 4 log: in `full`, the conversation; else
/// only what a listing shows (title, prompts, time).
fn read_body(log: &Log, full: bool) -> Result<Body, Failure> {
    let mut reader = Reader { full, body: Body::default(), names: HashMap::new(), line: 0, damaged: None };
    let mut failure = None;
    let mut header = true;
    lines(log, &mut |line: &[u8]| {
        if header {
            header = false;
            return true;
        }
        match reader.row(line) {
            Ok(()) => true,
            Err(e) => {
                failure = Some(e);
                false
            }
        }
    })?;
    match failure {
        Some(e) => Err(e),
        None => Ok(reader.body),
    }
}

/// A `session/title` row's title, in any format so far.
fn title_row(line: &[u8]) -> Option<String> {
    let needle = b"\"session/title\"";
    if !line.windows(needle.len()).any(|w| w == needle) {
        return None;
    }
    let v: Value = serde_json::from_slice(line).ok()?;
    if v["type"].as_str() != Some("session/title") {
        return None;
    }
    Some(first_line_of(v["data"]["title"].as_str()?)).filter(|t| !t.is_empty())
}

/// The latest title of a log this version does not read in full; empty when
/// it has none or cannot be read.
fn loose_title(log: &Log) -> String {
    let mut title = String::new();
    let _ = lines(log, &mut |line: &[u8]| {
        if let Some(found) = title_row(line) {
            title = found;
        }
        true
    });
    title
}

/// A conversation folder, as the import page shows it.
enum Entry {
    Ready { id: String, cwd: String, body: Body, path: PathBuf },
    Blocked { id: String, cwd: String, title: String, updated_ms: u64, kind: SkipKind, reason: String },
    /// Not a conversation of its own (a sub-agent's) or no prompt yet.
    Hidden,
}

fn blocked(log: &Log, id: String, cwd: Option<String>, title: String, (kind, reason): Failure) -> Entry {
    Entry::Blocked { id, cwd: cwd.unwrap_or_default(), title, updated_ms: mtime_ms(&log.path), kind, reason }
}

/// The conversation in a folder; None when the folder holds no log.
fn look(dir: &Path) -> Option<Entry> {
    let log = newest_log(dir)?;
    let header = match read_header(&log) {
        Ok(header) => header,
        Err(failure) => {
            let id = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            return Some(blocked(&log, id, None, String::new(), failure));
        }
    };
    if header.subagent {
        return Some(Entry::Hidden);
    }
    if header.version != FORMAT {
        let failure = if header.version < FORMAT {
            (SkipKind::OldFormat, format!("format {} from an older DSH, which opening it in DSH updates", header.version))
        } else {
            (SkipKind::NewerFormat, format!("format {} from a newer DSH", header.version))
        };
        return Some(blocked(&log, header.id, header.cwd, loose_title(&log), failure));
    }
    let body = match read_body(&log, false) {
        Ok(body) => body,
        Err(failure) => return Some(blocked(&log, header.id, header.cwd, loose_title(&log), failure)),
    };
    if body.prompts == 0 {
        return Some(Entry::Hidden);
    }
    match header.cwd {
        Some(cwd) => Some(Entry::Ready { id: header.id, cwd, body, path: log.path }),
        None => {
            let failure = (SkipKind::NoFolder, "no working folder recorded".to_string());
            Some(blocked(&log, header.id, None, body.title(), failure))
        }
    }
}

pub(super) fn scan(roots: &Roots, registry: &[ImportRecord], report: &mut Report) -> Vec<Found> {
    let dirs = session_dirs(roots);
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let (mut hidden, mut unreadable) = (0, 0);
    for dir in &dirs {
        match look(dir) {
            None => {}
            Some(Entry::Hidden) => hidden += 1,
            Some(Entry::Ready { id, cwd, body, path }) => {
                // The same conversation in an older home is a copy.
                if !seen.insert(id.clone()) {
                    continue;
                }
                out.push(Found {
                    source: SOURCE.into(),
                    imported: converted_imported(roots, registry, SOURCE, &id, &cwd),
                    title: body.title(),
                    updated_at_ms: if body.updated_ms > 0 { body.updated_ms } else { mtime_ms(&path) },
                    messages: body.prompts,
                    id,
                    cwd,
                });
            }
            Some(Entry::Blocked { id, cwd, title, updated_ms, kind, reason }) => {
                if !seen.insert(id.clone()) {
                    continue;
                }
                unreadable += 1;
                report.skip(SOURCE, kind, reason);
                report.unreadable.push(Unreadable { source: SOURCE.into(), id, title, cwd, updated_at_ms: updated_ms, kind });
            }
        }
    }
    let places: Vec<String> = roots.dsh.iter().map(|home| home.join("sessions").display().to_string()).collect();
    report.note(
        SOURCE,
        if dirs.is_empty() {
            format!("nothing at {}", places.join(", "))
        } else {
            format!(
                "{} conversation folders in {}: {} listed, {unreadable} unreadable, {hidden} sub-agents or empty",
                dirs.len(),
                places.join(", "),
                out.len()
            )
        },
    );
    out
}

/// Conversation `id`, read in full for import.
pub(super) fn load(roots: &Roots, id: &str) -> Result<Conversation, String> {
    let log = find(roots, id).ok_or_else(|| format!("DSH conversation {id} not found"))?;
    let header = read_header(&log).map_err(|(_, why)| why)?;
    if header.id != id {
        return Err(format!("DSH conversation {id} not found"));
    }
    if header.version < FORMAT {
        return Err(format!("format {} from an older DSH: open the conversation in DSH once, then import it", header.version));
    }
    if header.version > FORMAT {
        return Err(format!("format {} from a newer DSH, which this version cannot read", header.version));
    }
    let body = read_body(&log, true).map_err(|(_, why)| why)?;
    let cwd = header.cwd.ok_or_else(|| "no working folder recorded".to_string())?;
    let updated_ms = if body.updated_ms > 0 { body.updated_ms } else { mtime_ms(&log.path) };
    Ok(Conversation { title: body.title, cwd, updated_s: updated_ms / 1000, turns: body.turns })
}

/// The conversations of `cwd`, newest first, for a history picker. The ones
/// that cannot be imported are listed too, with why (`unreadable`).
pub(super) fn picker(roots: &Roots, registry: &[ImportRecord], cwd: &str) -> Vec<NativeSession> {
    let mut out: Vec<NativeSession> = Vec::new();
    let mut seen = HashSet::new();
    for dir in session_dirs(roots) {
        // Headers first: only this folder's conversations are read in full.
        let Some(log) = newest_log(&dir) else { continue };
        let Ok(header) = read_header(&log) else { continue };
        if header.subagent || !header.cwd.as_deref().is_some_and(|c| same_dir(c, cwd)) || !seen.insert(header.id) {
            continue;
        }
        match look(&dir) {
            Some(Entry::Ready { id, cwd: folder, body, path }) => out.push(NativeSession {
                imported: converted_copy(roots, registry, SOURCE, &id, &folder),
                title: body.title(),
                mtime_ms: if body.updated_ms > 0 { body.updated_ms } else { mtime_ms(&path) },
                origin: "DSH".to_string(),
                unreadable: None,
                id,
            }),
            Some(Entry::Blocked { id, title, updated_ms, kind, .. }) => out.push(NativeSession {
                id,
                title,
                mtime_ms: updated_ms,
                origin: "DSH".to_string(),
                imported: None,
                unreadable: Some(kind.name().to_string()),
            }),
            Some(Entry::Hidden) | None => {}
        }
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.mtime_ms));
    out.truncate(MAX_LISTED);
    out
}

#[cfg(test)]
mod tests {
    use super::super::testutil::{self, scan_all};
    use super::super::{sessions, SessionPick};
    use super::*;
    use std::ffi::OsString;

    /// The fake DSH home tests/fixtures/dsh/make-fixtures.mjs writes: DSH's
    /// own snapshot logs in the layout and encoding DSH 0.2 writes.
    fn fixtures() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join("dsh").join("home").join(".dsh")
    }

    fn copy_tree(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for entry in fs::read_dir(from).unwrap().flatten() {
            let target = to.join(entry.file_name());
            if entry.path().is_dir() {
                copy_tree(&entry.path(), &target);
            } else {
                fs::copy(entry.path(), &target).unwrap();
            }
        }
    }

    /// A fake home whose `~/.dsh` is the fixture home.
    fn roots(name: &str) -> Roots {
        let roots = testutil::roots(name);
        copy_tree(&fixtures(), &roots.home.join(".dsh"));
        roots
    }

    fn id(n: &str) -> String {
        format!("session-0d5a{n}-1b2c-4d3e-8f40-5a6b7c8d9e0f")
    }

    fn turns(roots: &Roots, n: &str) -> Vec<Turn> {
        let conv = load(roots, &id(n)).unwrap();
        sessions::tidy(conv.turns).into_iter().map(|(_, t)| t).collect()
    }

    const CHAT: &str = "只回复 MESSAGES_WEB_READY，不调用";

    #[test]
    fn dsh_conversations_are_listed_and_the_others_explained() {
        let roots = roots("dsh-scan");
        let (found, report) = scan_all(&roots);
        let mut listed: Vec<(String, String, usize, String)> = found
            .iter()
            .filter(|f| f.source == "dsh")
            .map(|f| (f.id.clone(), f.title.clone(), f.messages, f.cwd.clone()))
            .collect();
        listed.sort();
        let row = |n: &str, title: &str, prompts: usize, cwd: &str| (id(n), title.to_string(), prompts, cwd.to_string());
        assert_eq!(
            listed,
            vec![
                row("0001", "Read the attached file with", 1, "/Users/demo/upload"),
                row("0002", "Remember the project requirements: imple", 2, "/Users/demo/compact"),
                row("0003", "Use the ask_user_question tool to", 2, r"C:\Users\demo\steer"),
                row("0004", "Reply PARENT_READY.", 1, "/Users/demo/fork"),
                row("0007", CHAT, 1, "/Users/demo/chat"),
                // A fork: its own conversation, with the history it inherited.
                row("0008", "分叉：再回复一次", 2, "/Users/demo/chat"),
            ],
            "the sub-agent's log (0005) and the one without a prompt (0013) are not conversations"
        );
        let upload = found.iter().find(|f| f.id == id("0001")).unwrap();
        assert_eq!(upload.updated_at_ms, 1_787_887_050_413, "the last event's time");
        assert!(!upload.imported);

        let mut unreadable: Vec<(String, SkipKind, String, String)> =
            report.unreadable.iter().map(|u| (u.id.clone(), u.kind, u.title.clone(), u.cwd.clone())).collect();
        unreadable.sort_by(|a, b| a.0.cmp(&b.0));
        let row = |n: &str, kind: SkipKind, title: &str, cwd: &str| (id(n), kind, title.to_string(), cwd.to_string());
        assert_eq!(
            unreadable,
            vec![
                row("0006", SkipKind::OldFormat, CHAT, "/Users/demo/chat"),
                row("0009", SkipKind::NewerFormat, CHAT, "/Users/demo/future"),
                row("0010", SkipKind::NewerFormat, CHAT, "/Users/demo/unknown"),
                row("0011", SkipKind::NoFolder, CHAT, ""),
                // The header is read; the frame after it is damaged.
                row("0012", SkipKind::Unrecognised, "", "/Users/demo/broken"),
            ]
        );
        assert!(report.unreadable.iter().all(|u| u.source == "dsh" && u.updated_at_ms > 0));
        let skipped: Vec<(SkipKind, usize, &str)> =
            report.skipped.iter().filter(|s| s.source == "dsh").map(|s| (s.kind, s.count, s.reason.as_str())).collect();
        assert_eq!(skipped.iter().map(|s| s.1).sum::<usize>(), 5, "{skipped:?}");
        assert!(skipped.contains(&(SkipKind::OldFormat, 1, "format 3 from an older DSH, which opening it in DSH updates")));
        assert!(skipped.contains(&(SkipKind::NewerFormat, 1, "event review/verdict from a newer DSH")));
        assert!(skipped.iter().any(|s| s.0 == SkipKind::Unrecognised && s.2.starts_with("damaged log (reserved block type")));
        assert!(report.log.iter().any(|l| l.starts_with("dsh: 13 conversation folders in ")), "{:?}", report.log);
    }

    #[test]
    fn a_dsh_conversation_converts_with_its_attachments_named() {
        let roots = roots("dsh-upload");
        let got = turns(&roots, "0001");
        assert_eq!(got.len(), 4, "{got:?}");
        assert_eq!(
            got[0],
            Turn::User(
                "[文件：poem.txt]\n[图片]\nRead the attached file with the read tool, reply with exactly the single word it contains, and stop."
                    .into()
            )
        );
        match (&got[1], &got[2]) {
            (Turn::Call { call_id, name, arguments }, Turn::Output { call_id: answered, name: tool, output }) => {
                assert_eq!((call_id.as_str(), name.as_str()), ("call_00_ET_x83IHPfS8ouwILXe8u729956", "read"));
                assert!(arguments.contains("poem.txt"), "{arguments}");
                assert_eq!((answered, tool.as_str()), (call_id, "read"));
                assert!(output.contains("1: UPLOAD_ROUND_OK"), "{output}");
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(got[3], Turn::Assistant("UPLOAD_ROUND_OK".into()));
    }

    #[test]
    fn compactions_and_context_dsh_added_are_left_out() {
        let roots = roots("dsh-compact");
        let got = turns(&roots, "0002");
        let users: Vec<&str> = got.iter().filter_map(|t| if let Turn::User(s) = t { Some(s.as_str()) } else { None }).collect();
        assert_eq!(users.len(), 2, "{got:?}");
        assert!(users[0].starts_with("Remember the project requirements:"));
        assert_eq!(users[1], "Continue using the project requirements. Reply exactly MINIMAL_COMPACT_OK and stop.");
        assert_eq!(got.last(), Some(&Turn::Assistant("MINIMAL_COMPACT_OK".into())));
        let all = format!("{got:?}");
        assert!(!all.contains("checkpoint condensing"), "the compaction's summary is not history");
        assert!(!all.contains("Current runtime context"), "context DSH adds is not a prompt");
    }

    #[test]
    fn a_last_write_cut_short_is_left_out() {
        let roots = roots("dsh-torn");
        // Compressed: half a frame at the end.
        let got = turns(&roots, "0003");
        assert_eq!(got.len(), 5, "{got:?}");
        assert!(matches!(&got[1], Turn::Call { name, .. } if name == "ask_user_question"));
        assert!(matches!(&got[2], Turn::Output { output, .. } if output.contains("\"selected\":[\"Yes\"]")));
        assert_eq!(got[3], Turn::User("Interjection: include the word BANANA in your final reply.".into()));
        assert!(!format!("{got:?}").contains("LOST_IN_THE_CRASH"));
        // Plain text: a last line without its newline.
        assert_eq!(turns(&roots, "0002").len(), 4);
    }

    #[test]
    fn a_fork_brings_what_it_inherited() {
        let roots = roots("dsh-fork");
        assert_eq!(
            turns(&roots, "0008"),
            vec![
                Turn::User("只回复 MESSAGES_WEB_READY，不调用工具。".into()),
                Turn::Assistant("MESSAGES_WEB_READY".into()),
                Turn::User("换个说法再回复一次。".into()),
                Turn::Assistant("MESSAGES_WEB_READY（第二次）".into()),
            ]
        );
    }

    #[test]
    fn dsh_conversations_import_once_and_the_others_say_why() {
        let roots = roots("dsh-import");
        let pick = |n: &str| SessionPick { source: "dsh".into(), id: id(n), cwd: String::new() };
        let done = sessions::import(&roots, &pick("0001")).unwrap();
        assert_eq!((done.engine, done.reused, done.title.as_str()), ("lynshen", false, "Read the attached file with"));
        assert_eq!(done.cwd, sessions::folder_key("/Users/demo/upload"));
        let dir = sessions::lynshen_session_dir(&roots.lynshen, &done.cwd);
        assert!(dir.join(format!("{}.json", done.id)).is_file());
        assert!(dir.join(format!("{}.jsonl", done.id)).is_file());
        let (found, _) = scan_all(&roots);
        assert!(found.iter().find(|f| f.id == id("0001")).unwrap().imported);
        let again = sessions::import(&roots, &pick("0001")).unwrap();
        assert!(again.reused && again.id == done.id);
        let old = sessions::import(&roots, &pick("0006")).unwrap_err();
        assert!(old.contains("open the conversation in DSH once"), "{old}");
        let newer = sessions::import(&roots, &pick("0010")).unwrap_err();
        assert!(newer.contains("newer DSH"), "{newer}");
        assert!(sessions::import(&roots, &pick("../0001")).is_err());
        // DSH's own files are untouched.
        let original = fixtures().join("sessions").join("--Users-demo-upload--").join(id("0001")).join("session.v4.jsonl.zstd");
        let copied = roots.home.join(".dsh").join("sessions").join("--Users-demo-upload--").join(id("0001")).join("session.v4.jsonl.zstd");
        assert_eq!(fs::read(original).unwrap(), fs::read(copied).unwrap());
    }

    #[test]
    fn the_history_picker_lists_a_folders_conversations() {
        let roots = roots("dsh-picker");
        let listed = picker(&roots, &[], "/Users/demo/chat");
        let mut got: Vec<(String, Option<String>, String)> =
            listed.iter().map(|s| (s.id.clone(), s.unreadable.clone(), s.origin.clone())).collect();
        got.sort();
        assert_eq!(
            got,
            vec![
                (id("0006"), Some("old_format".to_string()), "DSH".to_string()),
                (id("0007"), None, "DSH".to_string()),
                (id("0008"), None, "DSH".to_string()),
            ]
        );
        assert!(picker(&roots, &[], "/Users/demo/elsewhere").is_empty());
    }

    #[test]
    fn dsh_home_follows_dsh_home_and_what_the_desktop_edition_saved() {
        let base = testutil::fake_home("dsh-homes");
        let home = base.join("home");
        let moved = base.join("moved").join("DSH Home");
        let none = |_: &str| None::<OsString>;
        assert_eq!(homes(&none, false, &home, &[]), vec![home.join(".dsh")]);
        // $DSH_HOME, `~` expanded; blank and relative values are no home.
        let tilde = |k: &str| (k == "DSH_HOME").then(|| OsString::from("~/dsh-data"));
        assert_eq!(homes(&tilde, false, &home, &[]), vec![home.join("dsh-data"), home.join(".dsh")]);
        let blank = |k: &str| (k == "DSH_HOME").then(|| OsString::from("  "));
        assert_eq!(homes(&blank, false, &home, &["relative/dsh".to_string()]), vec![home.join(".dsh")]);
        // The login shell's or the registry's value (`saved`), `%VAR%` on Windows.
        let local = base.join("local");
        let (l, h) = (local.clone(), home.clone());
        let windows_env = move |k: &str| match k {
            "LOCALAPPDATA" => Some(l.clone().into_os_string()),
            "USERPROFILE" => Some(h.clone().into_os_string()),
            _ => None,
        };
        let saved = format!("%LOCALAPPDATA%{}DSH", std::path::MAIN_SEPARATOR);
        assert_eq!(homes(&windows_env, true, &home, &[saved, "%NOPE%".to_string()]), vec![local.join("DSH"), home.join(".dsh")]);
        // The block the desktop edition adds to ~/.profile (quoted as it writes it).
        let quoted = moved.display().to_string().replace('\\', "\\\\").replace('"', "\\\"");
        testutil::write(
            &home.join(".profile"),
            &format!("export PATH=\"$HOME/bin:$PATH\"\n{PROFILE_START}\nexport DSH_HOME=\"{quoted}\"\n{PROFILE_END}\n"),
        );
        assert_eq!(homes(&none, false, &home, &[]), vec![moved.clone(), home.join(".dsh")]);
        // Its macOS LaunchAgent and Linux environment.d file.
        let mac = base.join("mac");
        testutil::write(
            &mac.join(LAUNCH_AGENT),
            &format!(
                "<plist version=\"1.0\">\n<dict>\n  <key>ProgramArguments</key>\n  <array>\n    <string>/bin/launchctl</string>\n    <string>setenv</string>\n    <string>DSH_HOME</string>\n    <string>{}</string>\n  </array>\n</dict>\n</plist>\n",
                moved.display().to_string().replace('&', "&amp;")
            ),
        );
        assert_eq!(homes(&none, false, &mac, &[]), vec![moved.clone(), mac.join(".dsh")]);
        let linux = base.join("linux");
        testutil::write(&linux.join(ENVIRONMENT_D), &format!("# dsh\nDSH_HOME=\"{}\"\n", moved.display()));
        assert_eq!(homes(&none, false, &linux, &[]), vec![moved.clone(), linux.join(".dsh")]);
        // Windows keeps it in the registry only.
        assert_eq!(homes(&none, true, &linux, &[]), vec![linux.join(".dsh")]);
    }

    #[test]
    fn log_and_folder_names_follow_dsh() {
        assert_eq!(generation("session.jsonl"), Some((0, false)));
        assert_eq!(generation("session.jsonl.zstd"), Some((0, true)));
        assert_eq!(generation("session.v4.jsonl.zstd"), Some((4, true)));
        assert_eq!(generation("session.v12.jsonl"), Some((12, false)));
        for other in ["session.v0.jsonl", "session.v04.jsonl", "session.v.jsonl", "session.V4.jsonl", "session.v4.jsonl.tmp", "session.lock"] {
            assert_eq!(generation(other), None, "{other}");
        }
        assert_eq!(encode_segment("session-1f2e_a.b"), "session-1f2e_a.b");
        assert_eq!(encode_segment("a/b~c"), "a~002Fb~007Ec");
        assert_eq!(encode_segment(".."), "~002E~002E");
        assert_eq!(head(br#"{"type":"user/message","seq":12,"time":1790000000123,"data":{}}"#), Some(("user/message", 1_790_000_000_123)));
        assert_eq!(head(br#"{"seq":1,"type":"x"}"#), None);
    }
}
