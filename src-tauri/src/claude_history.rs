//! Read-only access to Claude Code's persisted session files, for importing
//! a project's native Claude Code conversations (native_import).
//!
//! Claude Code stores one JSONL file per session under
//! `<config>/projects/<folder>/<session-id>.jsonl`. `<config>` is
//! `$CLAUDE_CONFIG_DIR`, else `~/.claude` (`%USERPROFILE%\.claude` on
//! Windows). `<folder>` is the real path of the cwd with every UTF-16 unit
//! that is not an ASCII letter or digit replaced by `-`; a name longer than
//! 200 characters is cut there and gets `-<hash>` appended (read from Claude
//! Code 2.1.296: `/`, `\`, `:`, `.` and `_` all become `-`, case is kept, so
//! `C:\Users\me\x` is `C--Users-me-x`).
//!
//! Everything here is strictly read-only and bounded: session listing caps the
//! directory scan and per-file preview reads. The claude home is injectable
//! so tests run against a fixture directory.

use serde::Serialize;
use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};

/// One resumable session (newest first).
#[derive(Serialize, Debug, PartialEq)]
pub struct ClaudeSessionEntry {
    /// The session id (`--resume <id>`), i.e. the file stem.
    pub id: String,
    /// File mtime in milliseconds since the epoch (sort key, newest first).
    pub mtime_ms: u64,
    /// Human preview: the stored AI title if present, else the first real
    /// user message. May be empty for sessions with no readable content.
    pub preview: String,
}

/// Newest sessions returned by a listing.
const MAX_SESSIONS: usize = 50;
/// Directory entries examined before giving up (degenerate dirs).
const MAX_DIR_ENTRIES: usize = 2000;
/// Bytes of a session file scanned for its preview.
const MAX_PREVIEW_SCAN: u64 = 256 * 1024;
/// Preview length (characters).
const MAX_PREVIEW_CHARS: usize = 80;
/// Longest project folder name Claude Code writes before it adds a hash.
const MAX_FOLDER_NAME: usize = 200;

/// An environment lookup (injectable so tests need not touch the process
/// environment). Empty values count as unset.
pub(crate) type Env<'a> = &'a dyn Fn(&str) -> Option<OsString>;

pub(crate) fn process_env(key: &str) -> Option<OsString> {
    std::env::var_os(key).filter(|v| !v.is_empty())
}

/// The user's home folder as the other tools find it. Node's `os.homedir()`
/// and Rust's `dirs::home_dir()` use the profile folder (`USERPROFILE`) on
/// Windows, whatever `HOME` a Git Bash or MSYS setup put there; elsewhere
/// they use `HOME`.
pub(crate) fn user_home(env: Env, windows: bool) -> PathBuf {
    let (first, second) = if windows { ("USERPROFILE", "HOME") } else { ("HOME", "USERPROFILE") };
    env(first).or_else(|| env(second)).map(PathBuf::from).unwrap_or_default()
}

/// `$CLAUDE_CONFIG_DIR`, else `~/.claude`.
pub(crate) fn claude_home_in(env: Env, windows: bool) -> PathBuf {
    env("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| user_home(env, windows).join(".claude"))
}

/// Claude Code's config folder on this machine.
pub fn claude_home() -> PathBuf {
    claude_home_in(&process_env, cfg!(windows))
}

/// A path without the `\\?\` prefix Windows' `canonicalize` adds (Node's
/// realpath, which Claude Code uses, has none).
pub(crate) fn strip_verbatim(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
}

/// `cwd` resolved the way Claude Code resolves it: a symlinked path (macOS
/// `/tmp` → `/private/tmp`) becomes the real one.
fn real_cwd(cwd: &str) -> String {
    Path::new(cwd)
        .canonicalize()
        .map(|path| strip_verbatim(&path.to_string_lossy()))
        .unwrap_or_else(|_| cwd.to_string())
}

/// Java's `String.hashCode` over UTF-16 units, the hash Claude Code appends
/// to a long folder name (as `Math.abs(h).toString(36)`).
fn java_hash(text: &str) -> i32 {
    text.encode_utf16().fold(0i32, |h, unit| h.wrapping_mul(31).wrapping_add(i32::from(unit)))
}

fn base36(mut n: u64) -> String {
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    loop {
        out.push(digits[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// The project folder name Claude Code gives a path (see the module docs).
pub(crate) fn folder_name(path: &str) -> String {
    let mut name = String::with_capacity(path.len());
    for c in path.chars() {
        if c.is_ascii_alphanumeric() {
            name.push(c);
        } else {
            // A JS regex without the `u` flag sees a surrogate pair as two units.
            name.extend(std::iter::repeat_n('-', c.len_utf16()));
        }
    }
    if name.len() <= MAX_FOLDER_NAME {
        return name;
    }
    let hash = i64::from(java_hash(path)).unsigned_abs();
    format!("{}-{}", &name[..MAX_FOLDER_NAME], base36(hash))
}

/// Claude Code's cwd → project-directory-name munging (see module docs).
fn munge_cwd(cwd: &str) -> String {
    folder_name(&real_cwd(cwd))
}

/// The folder Claude Code names after `cwd` (it may not exist).
#[cfg(test)]
pub(crate) fn project_dir(home: &Path, cwd: &str) -> PathBuf {
    home.join("projects").join(munge_cwd(cwd))
}

/// The folders Claude Code may keep `cwd`'s sessions in, found the way Claude
/// Code looks for them: the one named after the path; else, where paths
/// ignore case (Windows, macOS), one whose name differs only in case; and for
/// a long path every folder with the same cut name (another build may have
/// hashed it differently).
pub(crate) fn project_dirs(home: &Path, cwd: &str) -> Vec<PathBuf> {
    let projects = home.join("projects");
    let name = munge_cwd(cwd);
    let exact = projects.join(&name);
    let mut out = Vec::new();
    if exact.is_dir() {
        out.push(exact.clone());
    }
    let long = name.len() > MAX_FOLDER_NAME;
    let folds = cfg!(any(windows, target_os = "macos"));
    if !long && (!out.is_empty() || !folds) {
        return out;
    }
    let norm = |s: &str| if folds { s.to_ascii_lowercase() } else { s.to_string() };
    let wanted = norm(&name);
    let prefix = format!("{}-", &wanted[..wanted.len().min(MAX_FOLDER_NAME)]);
    let Ok(entries) = fs::read_dir(&projects) else { return out };
    for entry in entries.flatten().take(MAX_DIR_ENTRIES) {
        let path = entry.path();
        if path == exact || !path.is_dir() {
            continue;
        }
        let other = norm(&entry.file_name().to_string_lossy());
        if if long { other.starts_with(&prefix) } else { other == wanted } {
            out.push(path);
        }
    }
    out
}

/// Session ids are UUID-ish (alphanumeric + dashes) — same shape the spawn
/// allowlist accepts. Rejecting anything else also blocks path traversal.
pub(crate) fn is_session_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.starts_with('-')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub(crate) fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    }
}

/// Rows Claude injects that are not conversation content: subagent streams,
/// meta caveats and the post-compaction continuation summary.
pub(crate) fn is_synthetic(v: &serde_json::Value) -> bool {
    v["isSidechain"].as_bool() == Some(true)
        || v["isMeta"].as_bool() == Some(true)
        || v["isCompactSummary"].as_bool() == Some(true)
        || v["isVisibleInTranscriptOnly"].as_bool() == Some(true)
}

/// Extracts the user/assistant text of a session-file row, or None.
/// String contents starting with `<` are slash-command echoes
/// (`<command-name>…`, `<local-command-stdout>…`) — never conversation text.
pub(crate) fn row_text(v: &serde_json::Value) -> Option<String> {
    let content = &v["message"]["content"];
    if let Some(s) = content.as_str() {
        let t = s.trim();
        return (!t.is_empty() && !t.starts_with('<')).then(|| t.to_string());
    }
    let blocks = content.as_array()?;
    let text = blocks
        .iter()
        .filter(|b| b["type"].as_str() == Some("text"))
        .filter_map(|b| b["text"].as_str())
        .filter(|t| !t.trim().is_empty() && !t.trim_start().starts_with('<'))
        .collect::<Vec<_>>()
        .join("\n");
    (!text.is_empty()).then_some(text)
}

/// Best-effort preview: the name the user gave it (`custom-title`, the last
/// one), else the `ai-title` row, else the first real user message. Reads at
/// most `MAX_PREVIEW_SCAN` bytes.
pub(crate) fn preview_of(path: &Path) -> String {
    let Ok(file) = fs::File::open(path) else {
        return String::new();
    };
    let mut reader = BufReader::new(file).take(MAX_PREVIEW_SCAN);
    let mut first_user = String::new();
    let mut ai_title = String::new();
    let mut custom_title = String::new();
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        match v["type"].as_str() {
            Some("custom-title") => {
                if let Some(t) = v["customTitle"].as_str().map(str::trim).filter(|t| !t.is_empty()) {
                    custom_title = truncate_chars(t, MAX_PREVIEW_CHARS);
                }
            }
            Some("ai-title") if ai_title.is_empty() => {
                if let Some(t) = v["aiTitle"].as_str().map(str::trim).filter(|t| !t.is_empty()) {
                    ai_title = truncate_chars(t, MAX_PREVIEW_CHARS);
                }
            }
            Some("user") if first_user.is_empty() && !is_synthetic(&v) => {
                if let Some(t) = row_text(&v) {
                    first_user = truncate_chars(t.lines().next().unwrap_or(""), MAX_PREVIEW_CHARS);
                }
            }
            _ => {}
        }
    }
    [custom_title, ai_title, first_user].into_iter().find(|t| !t.is_empty()).unwrap_or_default()
}

/// Lists the resumable sessions persisted for `cwd`, newest first. A missing
/// project directory is not an error — it just means "no history yet".
pub fn list_sessions(home: &Path, cwd: &str) -> Result<Vec<ClaudeSessionEntry>, String> {
    let mut files: Vec<(String, u64, PathBuf)> = Vec::new();
    let dirs = project_dirs(home, cwd);
    let entries = dirs.iter().filter_map(|dir| fs::read_dir(dir).ok()).flat_map(|read| read.flatten().take(MAX_DIR_ENTRIES));
    for entry in entries {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if !is_session_id(stem) {
            continue;
        }
        let mtime_ms = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        files.push((stem.to_string(), mtime_ms, path));
    }
    files.sort_by_key(|f| std::cmp::Reverse(f.1));
    files.truncate(MAX_SESSIONS);
    Ok(files
        .into_iter()
        .map(|(id, mtime_ms, path)| ClaudeSessionEntry {
            id,
            mtime_ms,
            preview: preview_of(&path),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a fake ~/.claude fixture; unique per test to allow parallelism.
    fn fixture(name: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!(
            "lynshen-claude-history-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(home.join("projects")).unwrap();
        home
    }

    fn write_session(home: &Path, cwd: &str, id: &str, lines: &[&str]) -> PathBuf {
        let dir = project_dir(home, cwd);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{id}.jsonl"));
        fs::write(&path, lines.join("\n")).unwrap();
        path
    }

    #[test]
    fn folder_names_match_claude_code() {
        // Expected values from Claude Code 2.1.296's own function (see
        // folder_name), run under node.
        assert_eq!(folder_name(r"C:\Users\demo\proj"), "C--Users-demo-proj");
        assert_eq!(folder_name("/Users/demo/a.b_c"), "-Users-demo-a-b-c");
        assert_eq!(folder_name("/tmp/\u{1F600}x"), "-tmp---x", "a surrogate pair is two dashes");
        let deep = format!(r"C:\Users\demo\{}proj", r"deep\".repeat(45));
        let name = folder_name(&deep);
        assert_eq!(name.len(), 207);
        assert!(name.starts_with("C--Users-demo-deep-deep-"));
        assert!(name.ends_with("-d-pkfbl9"), "{name}");
        assert!(folder_name(&format!("/x/{}", "y".repeat(250))).ends_with("yyy-ldyyx2"));
    }

    #[test]
    fn verbatim_prefixes_are_dropped() {
        assert_eq!(strip_verbatim(r"\\?\C:\Users\demo"), r"C:\Users\demo");
        assert_eq!(strip_verbatim(r"\\?\UNC\server\share\x"), r"\\server\share\x");
        assert_eq!(strip_verbatim("/Users/demo"), "/Users/demo");
    }

    #[test]
    fn homes_follow_the_platform_and_claude_config_dir() {
        let vars = |pairs: &'static [(&'static str, &'static str)]| {
            move |key: &str| pairs.iter().find(|(k, _)| *k == key).map(|(_, v)| OsString::from(v))
        };
        let both = vars(&[("HOME", "/msys/home/demo"), ("USERPROFILE", r"C:\Users\demo")]);
        assert_eq!(user_home(&both, true), PathBuf::from(r"C:\Users\demo"), "Windows: the profile, not a Git Bash HOME");
        assert_eq!(user_home(&both, false), PathBuf::from("/msys/home/demo"));
        let only_profile = vars(&[("USERPROFILE", r"C:\Users\demo")]);
        assert_eq!(user_home(&only_profile, false), PathBuf::from(r"C:\Users\demo"));
        assert_eq!(claude_home_in(&both, true), PathBuf::from(r"C:\Users\demo").join(".claude"));
        let custom = vars(&[("USERPROFILE", r"C:\Users\demo"), ("CLAUDE_CONFIG_DIR", r"D:\claude-work")]);
        assert_eq!(claude_home_in(&custom, true), PathBuf::from(r"D:\claude-work"));
    }

    #[test]
    fn an_existing_folder_is_named_from_its_real_path() {
        let dir = fixture("real");
        let name = munge_cwd(&dir.to_string_lossy());
        let real = dir.canonicalize().unwrap();
        assert_eq!(name, folder_name(&strip_verbatim(&real.to_string_lossy())));
        // Windows: `C--Users-…`, as Claude Code writes it, not `----C--…`
        // from the `\\?\` prefix `canonicalize` adds.
        if cfg!(windows) {
            assert!(name.as_bytes()[0].is_ascii_alphabetic() && &name[1..3] == "--", "{name}");
        }
    }

    #[test]
    fn long_paths_are_found_by_their_cut_name() {
        let home = fixture("long");
        let cwd = format!("/never/{}", "long-folder-name/".repeat(14));
        let name = munge_cwd(&cwd);
        assert!(name.len() > MAX_FOLDER_NAME);
        // Written by a build that hashed the path another way.
        let other = home.join("projects").join(format!("{}-zzzz", &name[..MAX_FOLDER_NAME]));
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("dddddddd-4444-4444-8444-444444444444.jsonl"), "{}").unwrap();
        fs::create_dir_all(home.join("projects").join("-never-else")).unwrap();
        assert_eq!(project_dirs(&home, &cwd), vec![other]);
        assert_eq!(list_sessions(&home, &cwd).unwrap().len(), 1);
    }

    #[test]
    fn munges_cwd_like_claude_does() {
        // Verified live: '/', '.' and '_' all become '-', case is preserved.
        assert_eq!(
            munge_cwd("/Users/apple/dev/LynShen-Desktop"),
            "-Users-apple-dev-LynShen-Desktop"
        );
        assert_eq!(munge_cwd("/tmp/a.b_c"), "-tmp-a-b-c");
        // Non-ASCII collapses to '-' too (one dash per character).
        assert_eq!(munge_cwd("/中文/路径 x"), "-------x");
    }

    #[cfg(unix)]
    #[test]
    fn munges_the_real_path_behind_a_symlink() {
        let home = fixture("symlink");
        let real = home.join("real-dir");
        fs::create_dir_all(&real).unwrap();
        let link = home.join("link-dir");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert_eq!(
            munge_cwd(&link.to_string_lossy()),
            munge_cwd(&real.canonicalize().unwrap().to_string_lossy())
        );
    }

    #[test]
    fn lists_sessions_newest_first_with_previews() {
        let home = fixture("list");
        let cwd = "/proj/demo";
        write_session(
            &home,
            cwd,
            "aaaaaaaa-1111-4111-8111-111111111111",
            &[
                r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"fix the login bug"}]}}"#,
            ],
        );
        let newer = write_session(
            &home,
            cwd,
            "bbbbbbbb-2222-4222-8222-222222222222",
            &[
                r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"first message"}]}}"#,
                r#"{"type":"ai-title","aiTitle":"Add dark mode","sessionId":"b"}"#,
            ],
        );
        // Non-session files are ignored.
        fs::write(project_dir(&home, cwd).join("notes.txt"), "x").unwrap();
        fs::write(project_dir(&home, cwd).join("weird name.jsonl"), "x").unwrap();
        // Make the second file strictly newer.
        let newer_time = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
        let f = fs::File::options().append(true).open(&newer).unwrap();
        f.set_modified(newer_time).unwrap();

        let sessions = list_sessions(&home, cwd).unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].id, "bbbbbbbb-2222-4222-8222-222222222222");
        assert_eq!(sessions[0].preview, "Add dark mode"); // ai-title wins
        assert_eq!(sessions[1].id, "aaaaaaaa-1111-4111-8111-111111111111");
        assert_eq!(sessions[1].preview, "fix the login bug");
        assert!(sessions[0].mtime_ms >= sessions[1].mtime_ms);
    }

    #[test]
    fn missing_project_dir_means_no_history() {
        let home = fixture("empty");
        assert_eq!(list_sessions(&home, "/never/seen").unwrap(), Vec::new());
    }

    #[test]
    fn preview_skips_command_echoes_and_synthetic_rows() {
        let home = fixture("preview");
        let cwd = "/proj/p";
        write_session(
            &home,
            cwd,
            "cccccccc-3333-4333-8333-333333333333",
            &[
                r#"{"type":"queue-operation","operation":"enqueue"}"#,
                r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"<local-command-caveat>x</local-command-caveat>"}}"#,
                r#"{"type":"user","message":{"role":"user","content":"<command-name>/model</command-name>"}}"#,
                r#"{"type":"user","isSidechain":true,"message":{"role":"user","content":[{"type":"text","text":"subagent inner"}]}}"#,
                r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"real question"}]}}"#,
            ],
        );
        let sessions = list_sessions(&home, cwd).unwrap();
        assert_eq!(sessions[0].preview, "real question");
    }

}
