//! The lynshen CLI a release build ships (a Tauri sidecar next to the app's
//! executable). The app runs its own copy, never another `lynshen` on PATH, so
//! the engine and the daemon always match the app's version.
//!
//! The copy lives at `~/.lynshen/bin/lynshen`: the daemon outlives the app, so
//! it must not run from inside an app bundle that an update replaces or a user
//! moves. A CLI found there knows it belongs to the app (`lynshen update` leaves
//! it to the app's updates). Development builds ship no sidecar and keep
//! resolving `lynshen` as before (see backend::resolve_backend_bin).

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

fn exe_name() -> &'static str {
    if cfg!(windows) {
        "lynshen.exe"
    } else {
        "lynshen"
    }
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Where the app keeps its copy.
pub fn managed_path() -> Option<PathBuf> {
    Some(home()?.join(".lynshen").join("bin").join(exe_name()))
}

/// The sidecar inside this build, when it has one. A debug build has none:
/// a `lynshen` left in target/debug by an older build is not the app's own.
/// It is named `lynshen-cli`: a `lynshen` would be the same file as the app's
/// own `LynShen` executable on case-insensitive file systems (macOS, Windows).
fn bundled() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let path = dir.join(if cfg!(windows) { "lynshen-cli.exe" } else { "lynshen-cli" });
    path.is_file().then_some(path)
}

/// The installed copy, installed or refreshed on first use in a run.
static INSTALLED: Mutex<Option<PathBuf>> = Mutex::new(None);

/// The lynshen this app runs: its own copy, or None in a build without one.
/// Falls back to the sidecar itself when the copy cannot be written.
pub fn path() -> Option<PathBuf> {
    let bundled = bundled()?;
    let mut installed = INSTALLED.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(path) = installed.as_ref() {
        return Some(path.clone());
    }
    let path = match managed_path().map(|dest| install(&bundled, &dest).map(|()| dest)) {
        Some(Ok(dest)) => dest,
        Some(Err(error)) => {
            eprintln!("could not install the app's lynshen: {error}");
            bundled
        }
        None => bundled,
    };
    *installed = Some(path.clone());
    Some(path)
}

/// Copies `bundled` to `dest` unless it is already there, through a
/// temporary file so a running daemon keeps its program until it restarts.
fn install(bundled: &Path, dest: &Path) -> Result<(), String> {
    if same_contents(bundled, dest) {
        return Ok(());
    }
    let dir = dest.parent().ok_or("no parent directory")?;
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let partial = dir.join(format!(".{}.new", exe_name()));
    fs::copy(bundled, &partial).map_err(|e| format!("{}: {e}", partial.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&partial, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    replace(&partial, dest).inspect_err(|_| {
        let _ = fs::remove_file(&partial);
    })
}

/// Windows keeps a running executable locked but lets it be renamed, so the
/// old copy (the daemon's program) moves aside first. A copy moved aside by
/// an earlier update may still run (a daemon that never got idle): it keeps
/// its name and this one takes a fresh one; the ones no longer running go.
fn replace(new: &Path, dest: &Path) -> Result<(), String> {
    if cfg!(windows) && dest.exists() {
        let dir = dest.parent().ok_or("no parent directory")?;
        let stem = dest.file_stem().and_then(|s| s.to_str()).unwrap_or("lynshen");
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with(&format!("{stem}.old")) && name.ends_with(".exe") {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let old = dir.join(format!("{stem}.old-{stamp}.exe"));
        fs::rename(dest, &old).map_err(|e| format!("{}: {e}", dest.display()))?;
    }
    fs::rename(new, dest).map_err(|e| format!("{}: {e}", dest.display()))
}

fn same_contents(a: &Path, b: &Path) -> bool {
    let (Ok(ma), Ok(mb)) = (fs::metadata(a), fs::metadata(b)) else {
        return false;
    };
    if ma.len() != mb.len() {
        return false;
    }
    let read = |path: &Path| -> Option<Vec<u8>> {
        let mut bytes = Vec::with_capacity(ma.len() as usize);
        fs::File::open(path).ok()?.read_to_end(&mut bytes).ok()?;
        Some(bytes)
    };
    matches!((read(a), read(b)), (Some(x), Some(y)) if x == y)
}

/// The version of the lynshen this build ships (src-tauri/lynshen-cli.version),
/// None in a build without one. A daemon of another version is replaced once
/// it is idle (see daemon.ts).
#[tauri::command]
pub fn app_cli_version() -> Option<String> {
    bundled()?;
    Some(include_str!("../lynshen-cli.version").trim().to_string())
}

/// Ends the daemon listening on the app's daemon port right away: for
/// daemons too old to restart themselves once idle (`restart_when_idle`). The
/// app starts its own on the next connection. Off the main thread: on
/// Windows it waits for PowerShell, which takes seconds to start.
#[tauri::command(async)]
pub fn replace_daemon() -> Result<(), String> {
    let port = crate::DAEMON_ADDR.rsplit(':').next().unwrap_or("7788");
    // A login service would only start the old one again.
    if daemon_service_installed() {
        return Err("the lynshen daemon runs as a login service (lynshen daemon install); reinstall it with this version".to_string());
    }
    #[cfg(unix)]
    let status = std::process::Command::new("sh")
        .args([
            "-c",
            &format!("kill -TERM $(lsof -nP -t -iTCP:{port} -sTCP:LISTEN) 2>/dev/null"),
        ])
        .status();
    #[cfg(windows)]
    let status = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!(
                    "Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | \
                     ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force }}"
                ),
            ])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .status()
    };
    status.map(|_| ()).map_err(|e| e.to_string())
}

/// Whether the user installed the daemon as a login service
/// (`lynshen daemon install`); the app then leaves the running daemon alone.
fn daemon_service_installed() -> bool {
    let Some(home) = home() else {
        return false;
    };
    home.join("Library/LaunchAgents/cn.lynshen.daemon.plist").exists()
        || home.join(".config/systemd/user/lynshen-daemon.service").exists()
}

/// Makes `lynshen` a terminal command running the app's copy: a link in
/// `~/.local/bin` (macOS, Linux) or `~/.lynshen/bin` on the user's PATH
/// (Windows). Returns where the command is.
#[tauri::command]
pub fn install_cli_command() -> Result<String, String> {
    let target = path().ok_or("this build has no bundled lynshen")?;
    #[cfg(unix)]
    {
        let dir = home().ok_or("no home directory")?.join(".local").join("bin");
        fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let link = dir.join("lynshen");
        match fs::symlink_metadata(&link) {
            Ok(meta) if meta.file_type().is_symlink() => {
                if fs::read_link(&link).ok().as_deref() == Some(target.as_path()) {
                    return Ok(link.display().to_string());
                }
                fs::remove_file(&link).map_err(|e| e.to_string())?;
            }
            // A real file someone put there: theirs, not ours to replace.
            Ok(_) => return Err(format!("{} already exists", link.display())),
            Err(_) => {}
        }
        std::os::unix::fs::symlink(&target, &link).map_err(|e| e.to_string())?;
        Ok(link.display().to_string())
    }
    #[cfg(windows)]
    {
        let dir = target.parent().ok_or("no parent directory")?.display().to_string();
        // The user PATH from the registry (not this process's merged one),
        // with the directory appended once.
        let script = format!(
            "$d='{dir}'; $p=[Environment]::GetEnvironmentVariable('Path','User'); \
             if (-not (($p -split ';') -contains $d)) {{ \
             [Environment]::SetEnvironmentVariable('Path', (($p.TrimEnd(';') + ';' + $d).TrimStart(';')), 'User') }}"
        );
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("could not add {dir} to PATH ({status})"));
        }
        Ok(target.display().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lynshen-app-cli-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_copy_is_written_once_and_refreshed_when_the_app_changes() {
        let dir = temp("install");
        let bundled = dir.join("sidecar");
        let dest = dir.join("bin").join(exe_name());
        fs::write(&bundled, b"v1").unwrap();
        install(&bundled, &dest).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"v1");
        let first = fs::metadata(&dest).unwrap().modified().unwrap();
        install(&bundled, &dest).unwrap();
        assert_eq!(fs::metadata(&dest).unwrap().modified().unwrap(), first);
        fs::write(&bundled, b"v2").unwrap();
        install(&bundled, &dest).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"v2");
        assert!(!dir.join("bin").join(format!(".{}.new", exe_name())).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn contents_are_compared_byte_for_byte() {
        let dir = temp("same");
        let (a, b) = (dir.join("a"), dir.join("b"));
        fs::write(&a, b"abc").unwrap();
        fs::write(&b, b"abd").unwrap();
        assert!(!same_contents(&a, &b));
        fs::write(&b, b"abc").unwrap();
        assert!(same_contents(&a, &b));
        assert!(!same_contents(&a, &dir.join("missing")));
        let _ = fs::remove_dir_all(&dir);
    }
}
