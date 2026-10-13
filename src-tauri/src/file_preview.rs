//! The in-app preview of a file a sent message names (src/lib/preview/,
//! opened from a chip above the message, SentFiles.svelte).
//!
//! A chip may name any file on the computer, inside the project or not, so
//! this is not the editor's project-confined `read_text`. What keeps it
//! narrow: the page asks only for a path the user clicked in a message's
//! list of attached files (`canPreview` in src/lib/preview/kinds.ts). Here
//! the path is resolved through its symlinks, credential folders stay closed
//! (`is_protected`), a folder gives its facts but never its entries, a pipe
//! or a device is refused, and at most `MAX_PREVIEW_BYTES` of a file are
//! read. Bytes that look binary come back as facts only.

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};

/// The most of a file one preview reads, whatever the page asks for.
pub(crate) const MAX_PREVIEW_BYTES: u64 = 8 * 1024 * 1024;

/// How much of the file's start the binary test looks at.
const SNIFF_BYTES: usize = 8 * 1024;

/// The error for a path where nothing is (the page shows its own state).
const MISSING: &str = "missing";

const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

/// A file's facts and, for text, the start of it.
#[derive(Serialize, Debug)]
pub(crate) struct FilePreview {
    /// The file's real path, symlinks resolved.
    path: String,
    size: u64,
    mtime_ms: u64,
    is_dir: bool,
    /// Its first bytes look like a binary file: no text comes back.
    binary: bool,
    /// The first `max_bytes` as text, when asked for and not binary.
    text: Option<String>,
    /// The text stops before the end of the file.
    truncated: bool,
    /// Not valid UTF-8: some characters were replaced.
    lossy: bool,
    /// Opening it with its default app would run it (a program, an
    /// installer, a script with its execute bit): the page offers only
    /// "show in folder".
    runs: bool,
}

/// How the start of a file reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Encoding {
    Utf8,
    Utf16Le,
    Utf16Be,
    Binary,
}

/// The facts of the file at `path` and, with `max_bytes`, its first
/// `max_bytes` (at most `MAX_PREVIEW_BYTES`) as text. Errors with `missing`
/// when nothing is there.
#[tauri::command(async)]
pub(crate) fn preview_file(path: String, max_bytes: Option<u64>) -> Result<FilePreview, String> {
    let real = resolve(&path)?;
    let meta = std::fs::metadata(&real).map_err(io_error)?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut out = FilePreview {
        path: crate::ui_path(&real),
        size: if meta.is_dir() { 0 } else { meta.len() },
        mtime_ms,
        is_dir: meta.is_dir(),
        binary: false,
        text: None,
        truncated: false,
        lossy: false,
        runs: runs_when_opened(&file_name(&real), std::env::consts::OS) || executable(&meta),
    };
    if meta.is_dir() {
        return Ok(out);
    }
    if !meta.is_file() {
        return Err("not a regular file".to_string());
    }
    let want = preview_limit(max_bytes);
    let (mut head, more) = read_head(&real, want.max(SNIFF_BYTES as u64))?;
    match sniff(&head) {
        Encoding::Binary => out.binary = true,
        _ if want == 0 => {}
        encoding => {
            let cut = (want as usize) < head.len();
            head.truncate(want as usize);
            let (text, lossy) = decode(&head, encoding, cut || more);
            out.text = Some(text);
            out.truncated = cut || more;
            out.lossy = lossy;
        }
    }
    Ok(out)
}

/// Opens a file a preview shows with its default app. A file that would
/// run as a program is refused: the preview offers "show in folder" instead.
#[tauri::command(async)]
pub(crate) fn open_file_default(path: String) -> Result<(), String> {
    let real = resolve(&path)?;
    let meta = std::fs::metadata(&real).map_err(io_error)?;
    if runs_when_opened(&file_name(&real), std::env::consts::OS) || executable(&meta) {
        return Err("this file runs as a program; show it in its folder instead".to_string());
    }
    tauri_plugin_opener::open_path(crate::ui_path(&real), None::<&str>).map_err(|e| e.to_string())
}

/// The real path of an absolute path (or one from the home folder, `~/`),
/// through its symlinks; credential folders are refused.
fn resolve(path: &str) -> Result<PathBuf, String> {
    let home = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\"));
    let raw = match home {
        Some(rest) => crate::backend::home_dir().join(rest),
        None => PathBuf::from(path),
    };
    if path.is_empty() || !raw.is_absolute() {
        return Err("not an absolute path".to_string());
    }
    let real = raw.canonicalize().map_err(io_error)?;
    if crate::is_protected(&real) {
        return Err(format!("{} is protected", crate::ui_path(&real)));
    }
    Ok(real)
}

fn io_error(e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        MISSING.to_string()
    } else {
        e.to_string()
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// How much text the page may have: what it asked for, at most the cap.
fn preview_limit(max_bytes: Option<u64>) -> u64 {
    max_bytes.unwrap_or(0).min(MAX_PREVIEW_BYTES)
}

/// The first `limit` bytes of a file, and whether more follow.
fn read_head(path: &Path, limit: u64) -> Result<(Vec<u8>, bool), String> {
    let file = std::fs::File::open(path).map_err(io_error)?;
    let mut bytes = Vec::new();
    file.take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let more = bytes.len() as u64 > limit;
    bytes.truncate(limit as usize);
    Ok((bytes, more))
}

/// How a file reads, from its first `SNIFF_BYTES`: UTF-16 by its byte order
/// mark; binary when a NUL byte is there or more than one byte in ten is a
/// control character no text uses; else UTF-8 (maybe not valid).
fn sniff(bytes: &[u8]) -> Encoding {
    let sample = &bytes[..bytes.len().min(SNIFF_BYTES)];
    if sample.starts_with(&[0xFF, 0xFE]) {
        return Encoding::Utf16Le;
    }
    if sample.starts_with(&[0xFE, 0xFF]) {
        return Encoding::Utf16Be;
    }
    if sample.contains(&0) {
        return Encoding::Binary;
    }
    let odd = sample
        .iter()
        .filter(|&&b| (b < 0x20 && !matches!(b, b'\t' | b'\n' | b'\r' | 0x0c | 0x1b)) || b == 0x7f)
        .count();
    if odd * 10 > sample.len() {
        Encoding::Binary
    } else {
        Encoding::Utf8
    }
}

/// The text of `bytes`, and whether characters had to be replaced. `cut`:
/// the bytes stop inside the file, so a character split at their end is
/// dropped rather than shown as a replacement.
fn decode(bytes: &[u8], encoding: Encoding, cut: bool) -> (String, bool) {
    match encoding {
        Encoding::Utf16Le | Encoding::Utf16Be => {
            let body = bytes.get(2..).unwrap_or_default();
            let mut units: Vec<u16> = body
                .as_chunks::<2>()
                .0
                .iter()
                .map(|&pair| match encoding {
                    Encoding::Utf16Le => u16::from_le_bytes(pair),
                    _ => u16::from_be_bytes(pair),
                })
                .collect();
            if cut && units.last().is_some_and(|u| (0xD800..0xDC00).contains(u)) {
                units.pop();
            }
            match String::from_utf16(&units) {
                Ok(text) => (text, false),
                Err(_) => (String::from_utf16_lossy(&units), true),
            }
        }
        _ => {
            let body = bytes.strip_prefix(UTF8_BOM.as_slice()).unwrap_or(bytes);
            let body = if cut { complete_utf8(body) } else { body };
            match std::str::from_utf8(body) {
                Ok(text) => (text.to_string(), false),
                Err(_) => (String::from_utf8_lossy(body).into_owned(), true),
            }
        }
    }
}

/// `bytes` without a UTF-8 character that is cut off at their end.
fn complete_utf8(bytes: &[u8]) -> &[u8] {
    // The last character starts at most three bytes before the end.
    let from = bytes.len().saturating_sub(3);
    for i in (from..bytes.len()).rev() {
        let b = bytes[i];
        if b & 0xC0 == 0x80 {
            continue;
        }
        let need = match b {
            0xF0..=0xFF => 4,
            0xE0..=0xEF => 3,
            0xC0..=0xDF => 2,
            _ => 1,
        };
        return if bytes.len() - i < need {
            &bytes[..i]
        } else {
            bytes
        };
    }
    bytes
}

/// Whether the system's default handler would run a file of this name
/// rather than show it: programs, installers, scripts the shell runs, and
/// links that start them. `os` is `std::env::consts::OS`.
fn runs_when_opened(name: &str, os: &str) -> bool {
    let Some((_, ext)) = name.rsplit_once('.') else {
        return false;
    };
    let ext = ext.to_ascii_lowercase();
    let listed = match os {
        "windows" => {
            "exe msi msp msix appx bat cmd com scr pif cpl msc ps1 psm1 vbs vbe js jse \
                      wsf wsh hta lnk url reg inf scf jar appref-ms application gadget"
        }
        "macos" => "app command tool terminal workflow action pkg mpkg jar webloc inetloc fileloc",
        _ => "desktop appimage run sh jar",
    };
    listed.split_whitespace().any(|e| e == ext)
}

/// A regular file with an execute bit: Finder and most Linux file managers
/// run such a file when it is opened.
#[cfg(unix)]
fn executable(meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.is_file() && meta.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn executable(_meta: &std::fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lynshen-preview-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn sniff_tells_text_from_binary() {
        assert_eq!(sniff(b""), Encoding::Utf8);
        assert_eq!(sniff("{\"a\":1}\n私聊\tok\r\n".as_bytes()), Encoding::Utf8);
        assert_eq!(sniff(b"\x1b[31mred\x1b[0m\n"), Encoding::Utf8);
        assert_eq!(
            sniff(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"),
            Encoding::Binary
        );
        assert_eq!(sniff(b"PK\x03\x04\x14\x00\x06\x00"), Encoding::Binary);
        // Control characters without a NUL: one in ten is too many.
        assert_eq!(sniff(b"\x01\x02\x03\x04abcdef"), Encoding::Binary);
        assert_eq!(sniff(b"\x01abcdefghijklmnopqrstuvwxyz"), Encoding::Utf8);
        assert_eq!(sniff(b"\xFF\xFEa\x00b\x00"), Encoding::Utf16Le);
        assert_eq!(sniff(b"\xFE\xFF\x00a\x00b"), Encoding::Utf16Be);
        // Only the start counts: a NUL after it does not make a binary.
        let mut late = vec![b'a'; SNIFF_BYTES];
        late.push(0);
        assert_eq!(sniff(&late), Encoding::Utf8);
    }

    #[test]
    fn decode_reads_utf8_and_utf16() {
        assert_eq!(
            decode("私聊.jsonl".as_bytes(), Encoding::Utf8, false),
            ("私聊.jsonl".to_string(), false)
        );
        assert_eq!(
            decode(b"\xEF\xBB\xBFbom", Encoding::Utf8, false),
            ("bom".to_string(), false)
        );
        // GBK bytes are not UTF-8: replaced, and said so.
        let (text, lossy) = decode(b"ok \xC4\xE3\xBA\xC3", Encoding::Utf8, false);
        assert!(lossy && text.starts_with("ok ") && text.contains('\u{FFFD}'));
        assert_eq!(
            decode(b"\xFF\xFEh\x00i\x00", Encoding::Utf16Le, false),
            ("hi".to_string(), false)
        );
        assert_eq!(
            decode(b"\xFE\xFF\x00h\x00i", Encoding::Utf16Be, false),
            ("hi".to_string(), false)
        );
        // A cut through a surrogate pair drops its first half.
        let emoji: Vec<u8> = [0xFF, 0xFE, b'a', 0, 0x3D, 0xD8].to_vec();
        assert_eq!(
            decode(&emoji, Encoding::Utf16Le, true),
            ("a".to_string(), false)
        );
    }

    #[test]
    fn a_cut_drops_the_split_character() {
        let text = "ab私".as_bytes(); // 私 is three bytes
        assert_eq!(complete_utf8(text), text);
        assert_eq!(complete_utf8(&text[..4]), b"ab");
        assert_eq!(complete_utf8(&text[..3]), b"ab");
        assert_eq!(complete_utf8(b""), b"");
        assert_eq!(complete_utf8("😀".as_bytes()), "😀".as_bytes());
        assert_eq!(complete_utf8(&"x😀".as_bytes()[..4]), b"x");
        assert_eq!(
            decode(&text[..4], Encoding::Utf8, true),
            ("ab".to_string(), false)
        );
        // Without a cut the broken end is a replacement character.
        assert!(decode(&text[..4], Encoding::Utf8, false).1);
    }

    #[test]
    fn the_cap_holds_whatever_the_page_asks() {
        assert_eq!(preview_limit(None), 0);
        assert_eq!(preview_limit(Some(2 * 1024 * 1024)), 2 * 1024 * 1024);
        assert_eq!(preview_limit(Some(u64::MAX)), MAX_PREVIEW_BYTES);
    }

    #[test]
    fn programs_are_not_opened_from_a_preview() {
        assert!(runs_when_opened("setup.EXE", "windows"));
        assert!(runs_when_opened("run.ps1", "windows"));
        assert!(runs_when_opened("build.js", "windows"));
        assert!(!runs_when_opened("build.js", "macos"));
        assert!(runs_when_opened("Tool.app", "macos"));
        assert!(runs_when_opened("go.command", "macos"));
        assert!(runs_when_opened("game.AppImage", "linux"));
        assert!(!runs_when_opened("report.pdf", "windows"));
        assert!(!runs_when_opened("私聊_墨竹.jsonl", "macos"));
        assert!(!runs_when_opened("Makefile", "linux"));
    }

    #[test]
    fn preview_reads_the_start_of_a_text_file() {
        let dir = temp_dir("text");
        let path = dir.join("notes.md");
        std::fs::write(&path, "# 标题\n\nbody\n").unwrap();
        let p = preview_file(path.display().to_string(), Some(1024)).unwrap();
        assert_eq!(p.text.as_deref(), Some("# 标题\n\nbody\n"));
        assert!(!p.truncated && !p.binary && !p.is_dir && !p.lossy);
        assert_eq!(p.size, "# 标题\n\nbody\n".len() as u64);
        assert!(p.mtime_ms > 0);
        // Facts only.
        let p = preview_file(path.display().to_string(), None).unwrap();
        assert!(p.text.is_none() && !p.binary);
        // A small cap: the start, cut at a whole character, and said so.
        let p = preview_file(path.display().to_string(), Some(4)).unwrap();
        assert_eq!(p.text.as_deref(), Some("# "));
        assert!(p.truncated);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn preview_gives_facts_only_for_binaries_folders_and_missing_files() {
        let dir = temp_dir("binary");
        let bin = dir.join("data.bin");
        std::fs::write(&bin, b"\x7fELF\x02\x01\x01\x00\x00\x00").unwrap();
        let p = preview_file(bin.display().to_string(), Some(1024)).unwrap();
        assert!(p.binary && p.text.is_none());
        let folder = preview_file(dir.display().to_string(), Some(1024)).unwrap();
        assert!(folder.is_dir && folder.text.is_none() && folder.size == 0);
        assert_eq!(
            preview_file(dir.join("gone.txt").display().to_string(), Some(1024)).unwrap_err(),
            MISSING
        );
        assert!(preview_file("relative/notes.md".to_string(), Some(1024)).is_err());
        assert!(preview_file(String::new(), Some(1024)).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn preview_follows_symlinks_to_the_real_file() {
        let dir = temp_dir("link");
        let real = dir.join("real.txt");
        std::fs::write(&real, "real").unwrap();
        let link = dir.join("link.txt");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let p = preview_file(link.display().to_string(), Some(64)).unwrap();
        assert_eq!(p.path, real.display().to_string());
        assert_eq!(p.text.as_deref(), Some("real"));
        // A link to nothing is a missing file.
        let dangling = dir.join("dangling.txt");
        std::os::unix::fs::symlink(dir.join("nowhere"), &dangling).unwrap();
        assert_eq!(
            preview_file(dangling.display().to_string(), Some(64)).unwrap_err(),
            MISSING
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn an_executable_is_marked_and_not_opened() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("exec");
        let tool = dir.join("tool");
        std::fs::write(&tool, "#!/bin/sh\necho hi\n").unwrap();
        std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
        let p = preview_file(tool.display().to_string(), Some(64)).unwrap();
        assert!(p.runs);
        assert_eq!(p.text.as_deref(), Some("#!/bin/sh\necho hi\n"));
        assert!(open_file_default(tool.display().to_string()).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
