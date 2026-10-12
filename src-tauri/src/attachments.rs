//! Files pasted into the composer (Composer.svelte `onPaste`), and the files
//! a sent message names (its chips, MessageList / SentFiles).
//!
//! A web view never sees the paths of files copied in Explorer, Finder or a
//! Linux file manager, at best their bytes. The paths come from the system
//! clipboard here: CF_HDROP on Windows, file URLs (`public.file-url`) on the
//! macOS pasteboard, `text/uri-list` on X11 and Wayland. arboard, which the
//! clipboard plugin already brings, reads all three. Files copied in an app
//! that offers only their bytes are written to disk under their own names
//! (`save_temp_file`), the way pasted images are (`save_temp_image`).

use std::path::{Path, PathBuf};

/// The paths of the files on the system clipboard, in order; empty when it
/// holds none (text, an image, nothing) or cannot be read.
#[tauri::command]
pub async fn clipboard_file_paths() -> Vec<String> {
    clean_paths(read_file_list())
}

#[cfg(desktop)]
fn read_file_list() -> Vec<PathBuf> {
    let Ok(mut clipboard) = arboard::Clipboard::new() else {
        return Vec::new();
    };
    clipboard.get().file_list().unwrap_or_default()
}

#[cfg(not(desktop))]
fn read_file_list() -> Vec<PathBuf> {
    Vec::new()
}

/// The clipboard's paths as the composer attaches them. A `text/uri-list`
/// ends its lines with CRLF and may name the host (`file://localhost/…`),
/// which arboard leaves in; blank and repeated entries go.
fn clean_paths(paths: Vec<PathBuf>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for path in paths {
        let text = path.to_string_lossy();
        let text = text.trim_end_matches(['\r', '\n', '\0']);
        let text = match text.strip_prefix("localhost/") {
            Some(rest) => format!("/{rest}"),
            None => text.to_string(),
        };
        if !text.trim().is_empty() && !out.contains(&text) {
            out.push(text);
        }
    }
    out
}

/// Writes the bytes of a pasted file to `~/.lynshen/uploads/desktop`, in a
/// folder of its own so it keeps its name, and returns its path. The bytes
/// are the request body and the name the `x-file-name` header,
/// percent-encoded (`saveTempFile` in protocol.ts).
#[tauri::command]
pub fn save_temp_file(request: tauri::ipc::Request) -> Result<String, String> {
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_default();
    let dir = crate::lynshen_dir().join("uploads").join("desktop");
    let path = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => write_upload(&dir, &name, bytes)?,
        // Where the web view cannot send raw bytes they come as numbers.
        tauri::ipc::InvokeBody::Json(value) => {
            let bytes: Vec<u8> =
                serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
            write_upload(&dir, &name, &bytes)?
        }
    };
    Ok(path.display().to_string())
}

fn write_upload(dir: &Path, name: &str, data: &[u8]) -> Result<PathBuf, String> {
    // The clock alone can repeat for files pasted together (macOS counts
    // microseconds).
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let folder = dir.join(format!("paste-{stamp}-{seq}"));
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(safe_file_name(name));
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path)
}

/// A file name that is safe on every system: the last part of what the page
/// sent, without characters Windows refuses, control characters, or the
/// trailing dots and spaces Windows drops; at most 200 bytes.
fn safe_file_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        .collect();
    let mut cleaned = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    if cleaned.len() > 200 {
        let mut end = 200;
        while !cleaned.is_char_boundary(end) {
            end -= 1;
        }
        cleaned.truncate(end);
    }
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "pasted-file".to_string()
    } else {
        cleaned
    }
}

/// Decodes `%XX` escapes (encodeURIComponent) as UTF-8; anything malformed
/// is kept as it is.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(hi * 16 + lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Whether a file or folder is at `path` (a sent file's chip says when it is
/// gone instead of failing to open it).
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    !path.is_empty() && Path::new(&path).exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_paths_drops_uri_list_leftovers() {
        let paths = vec![
            PathBuf::from("/home/me/a b.txt\r"),
            PathBuf::from("localhost/home/me/私聊_墨竹.jsonl"),
            PathBuf::from(""),
            PathBuf::from("/home/me/a b.txt"),
            PathBuf::from("C:\\Users\\me\\report.pdf"),
        ];
        assert_eq!(
            clean_paths(paths),
            vec![
                "/home/me/a b.txt",
                "/home/me/私聊_墨竹.jsonl",
                "C:\\Users\\me\\report.pdf"
            ]
        );
    }

    #[test]
    fn safe_file_name_keeps_names_and_drops_what_breaks_them() {
        assert_eq!(safe_file_name("私聊_墨竹.jsonl"), "私聊_墨竹.jsonl");
        assert_eq!(safe_file_name("report final.pdf"), "report final.pdf");
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name("C:\\Users\\me\\a.txt"), "a.txt");
        assert_eq!(safe_file_name("what?<now>.md"), "whatnow.md");
        assert_eq!(safe_file_name("name. . "), "name");
        assert_eq!(safe_file_name("tab\there.txt"), "tabhere.txt");
        assert_eq!(safe_file_name(""), "pasted-file");
        assert_eq!(safe_file_name(".."), "pasted-file");
        assert_eq!(safe_file_name("dir/"), "pasted-file");
        let long = "长".repeat(100) + ".txt";
        let cut = safe_file_name(&long);
        assert!(cut.len() <= 200 && cut.starts_with('长'));
    }

    #[test]
    fn percent_decode_reads_encode_uri_component() {
        // encodeURIComponent('私聊_墨竹 (1).jsonl')
        assert_eq!(
            percent_decode("%E7%A7%81%E8%81%8A_%E5%A2%A8%E7%AB%B9%20(1).jsonl"),
            "私聊_墨竹 (1).jsonl"
        );
        assert_eq!(percent_decode("plain.txt"), "plain.txt");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("a%zzb"), "a%zzb");
        assert_eq!(percent_decode("%4"), "%4");
        assert_eq!(percent_decode("%+F"), "%+F");
        assert_eq!(percent_decode("%41"), "A");
    }

    #[test]
    fn write_upload_keeps_the_name_in_a_folder_of_its_own() {
        let dir = std::env::temp_dir().join(format!("lynshen-upload-test-{}", std::process::id()));
        let first = write_upload(&dir, "a b.txt", b"one").unwrap();
        let second = write_upload(&dir, "a b.txt", b"two").unwrap();
        assert_ne!(first, second);
        assert_eq!(first.file_name().unwrap(), "a b.txt");
        assert_eq!(std::fs::read(&first).unwrap(), b"one");
        assert_eq!(std::fs::read(&second).unwrap(), b"two");
        assert!(path_exists(first.display().to_string()));
        assert!(!path_exists(dir.join("missing").display().to_string()));
        assert!(!path_exists(String::new()));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
