//! Finding the command-line tools the app runs itself: ffmpeg and ffprobe
//! (a video's keyframes), git, gh, node, rg and the agents' CLIs.
//!
//! An app started from Finder, the Dock or a desktop launcher gets the bare
//! PATH of the session (launchd's /usr/bin:/bin:/usr/sbin:/sbin on macOS),
//! not the terminal's: Homebrew, MacPorts, Nix, ~/.local/bin, Scoop and the
//! like are not on it. A tool is looked for on the login shell's PATH
//! (shell_env reads it once at start, with a timeout), then on this
//! process's PATH, then in the directories package managers install to on
//! this system. The programs the app starts get those directories on their
//! PATH too (shell_env::child_path), so the engine, the daemon and their
//! tools find what the app finds.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// Where a tool was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Source {
    /// The login shell's PATH (what a terminal has).
    ShellPath,
    /// This process's own PATH.
    AppPath,
    /// A package manager's directory (`install_dirs`).
    InstallDir,
}

impl Source {
    fn label(self) -> &'static str {
        match self {
            Source::ShellPath => "login-shell PATH",
            Source::AppPath => "app PATH",
            Source::InstallDir => "install dir",
        }
    }
}

/// The directories package managers put commands in on `os` ("macos",
/// "windows", or another Unix), most common first. `home` is the user's home
/// directory; `env` reads an environment variable.
pub(crate) fn install_dirs(
    os: &str,
    home: &Path,
    env: &dyn Fn(&str) -> Option<OsString>,
) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    match os {
        "windows" => {
            if let Some(local) = env("LOCALAPPDATA") {
                // winget's links to portable packages (Gyan.FFmpeg, ripgrep, gh).
                dirs.push(
                    PathBuf::from(local)
                        .join("Microsoft")
                        .join("WinGet")
                        .join("Links"),
                );
            }
            // Scoop's shims: the user's ($SCOOP, else ~/scoop), then the global ones.
            let scoop = env("SCOOP")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join("scoop"));
            dirs.push(scoop.join("shims"));
            let program_data = env("ProgramData").map(PathBuf::from);
            if let Some(global) = env("SCOOP_GLOBAL")
                .map(PathBuf::from)
                .or_else(|| program_data.as_ref().map(|d| d.join("scoop")))
            {
                dirs.push(global.join("shims"));
            }
            // Chocolatey's shims.
            if let Some(choco) = env("ChocolateyInstall")
                .map(PathBuf::from)
                .or_else(|| program_data.as_ref().map(|d| d.join("chocolatey")))
            {
                dirs.push(choco.join("bin"));
            }
            // ffmpeg unpacked by hand, where its guides put it.
            for key in ["ProgramW6432", "ProgramFiles"] {
                if let Some(root) = env(key) {
                    dirs.push(PathBuf::from(root).join("ffmpeg").join("bin"));
                }
            }
            dirs.push(PathBuf::from(r"C:\ffmpeg\bin"));
            dirs.push(home.join(".cargo").join("bin"));
        }
        "macos" => {
            // Homebrew (Apple silicon, then Intel), MacPorts.
            for dir in [
                "/opt/homebrew/bin",
                "/opt/homebrew/sbin",
                "/usr/local/bin",
                "/opt/local/bin",
                "/opt/local/sbin",
            ] {
                dirs.push(PathBuf::from(dir));
            }
            dirs.push(home.join(".local").join("bin"));
            dirs.push(home.join("bin"));
            dirs.push(home.join(".cargo").join("bin"));
            // Nix: the user's profile, the default one, nix-darwin's system.
            dirs.push(home.join(".nix-profile").join("bin"));
            dirs.push(PathBuf::from("/nix/var/nix/profiles/default/bin"));
            dirs.push(PathBuf::from("/run/current-system/sw/bin"));
        }
        _ => {
            dirs.push(home.join(".local").join("bin"));
            dirs.push(home.join("bin"));
            for dir in ["/usr/local/bin", "/usr/bin", "/bin", "/snap/bin"] {
                dirs.push(PathBuf::from(dir));
            }
            // Homebrew on Linux: the shared prefix, then the user's.
            dirs.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin"));
            dirs.push(home.join(".linuxbrew").join("bin"));
            dirs.push(home.join(".cargo").join("bin"));
            dirs.push(home.join(".nix-profile").join("bin"));
            dirs.push(PathBuf::from("/nix/var/nix/profiles/default/bin"));
            dirs.push(PathBuf::from("/run/current-system/sw/bin"));
        }
    }
    dirs
}

/// The install directories on this system for `name`: on Windows first the
/// standard places of the installers the app runs (Node.js, Git: they
/// update the registry's PATH, not this running app's), then `install_dirs`.
pub(crate) fn dirs_for(name: &str) -> Vec<PathBuf> {
    let env = |key: &str| std::env::var_os(key);
    let mut dirs = if cfg!(windows) {
        crate::windows_install_dirs(name, &env)
    } else {
        Vec::new()
    };
    dirs.extend(install_dirs(
        std::env::consts::OS,
        &crate::backend::home_dir(),
        &env,
    ));
    dirs
}

/// `name` on the first of `paths` (PATH lists, in order) that has it, else
/// in the first of `dirs`; with where it was found.
pub(crate) fn locate(
    name: &str,
    paths: &[(Source, OsString)],
    dirs: &[PathBuf],
) -> Option<(PathBuf, Source)> {
    for (source, path) in paths {
        if let Some(found) = crate::which_in(name, path.clone()) {
            return Some((found, *source));
        }
    }
    dirs.iter().find_map(|dir| {
        crate::which_in(name, dir.clone().into_os_string()).map(|found| (found, Source::InstallDir))
    })
}

/// `name` on the login shell's PATH, this process's PATH, or in the install
/// directories (`crate::which`).
pub(crate) fn find(name: &str) -> Option<(PathBuf, Source)> {
    let mut paths = Vec::new();
    if let Some(snap) = crate::shell_env::snapshot_path() {
        paths.push((Source::ShellPath, OsString::from(snap)));
    }
    if let Some(path) = std::env::var_os("PATH") {
        paths.push((Source::AppPath, path));
    }
    locate(name, &paths, &dirs_for(name))
}

/// Tools found so far, and the misses already logged.
#[derive(Default)]
pub(crate) struct Found {
    paths: HashMap<String, PathBuf>,
    missed: HashSet<String>,
}

fn found() -> &'static Mutex<Found> {
    static FOUND: OnceLock<Mutex<Found>> = OnceLock::new();
    FOUND.get_or_init(Default::default)
}

/// How often a miss may read the login shell's environment again.
const RECAPTURE_EVERY: Duration = Duration::from_secs(60);

/// A tool the app runs itself (`find`), kept while its file is there. A miss
/// is never kept, so a tool installed while the app runs is found on the
/// next try; with `refresh` (a lookup the user asked for, as attaching a
/// video, not a poll), a miss reads the login shell's PATH again first (at
/// most once a minute: a directory added to the shell's profile since the
/// app started). The app's log names the path found, or where it looked.
pub(crate) fn tool(name: &str, refresh: bool) -> Option<PathBuf> {
    kept_or_found(
        found(),
        name,
        || {
            find(name).or_else(|| {
                if refresh && crate::shell_env::recapture_if_older(RECAPTURE_EVERY) {
                    find(name)
                } else {
                    None
                }
            })
        },
        &|| {
            let shell = if crate::shell_env::snapshot_path().is_some() {
                "read"
            } else {
                "not read"
            };
            let dirs: Vec<String> = dirs_for(name)
                .iter()
                .map(|d| d.display().to_string())
                .collect();
            format!(
                "login-shell PATH {shell}; app PATH {}; install dirs {}",
                std::env::var("PATH").unwrap_or_default(),
                dirs.join(", ")
            )
        },
        &crate::desktop_log,
    )
}

/// `tool` with its lookup (`look`), what it searched (`searched`, for the
/// log of a miss) and the log (`log`) passed in.
pub(crate) fn kept_or_found(
    kept: &Mutex<Found>,
    name: &str,
    look: impl FnOnce() -> Option<(PathBuf, Source)>,
    searched: &dyn Fn() -> String,
    log: &dyn Fn(&str),
) -> Option<PathBuf> {
    {
        let mut kept = kept.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(path) = kept.paths.get(name).cloned() {
            if path.is_file() {
                return Some(path);
            }
            // Uninstalled or moved: look again.
            kept.paths.remove(name);
        }
    }
    let got = look();
    let mut kept = kept.lock().unwrap_or_else(|e| e.into_inner());
    match got {
        Some((path, source)) => {
            log(&format!(
                "tools: {name} at {} ({})",
                path.display(),
                source.label()
            ));
            kept.missed.remove(name);
            kept.paths.insert(name.to_string(), path.clone());
            Some(path)
        }
        None => {
            // Once until it is found: a poll (gh) does not fill the log.
            if kept.missed.insert(name.to_string()) {
                log(&format!("tools: {name} not found ({})", searched()));
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh directory under the system temp dir for one test.
    fn scratch(test: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lynshen-tool-path-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A stand-in executable `name` in `dir` (with .exe on Windows, which
    /// resolves a bare name through PATHEXT); its path.
    fn fake_tool(dir: &Path, name: &str) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let file = dir.join(if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.to_string()
        });
        std::fs::write(&file, b"").unwrap();
        file
    }

    fn joined(dirs: &[&Path]) -> OsString {
        std::env::join_paths(dirs).unwrap()
    }

    fn no_env(_: &str) -> Option<OsString> {
        None
    }

    #[test]
    fn macos_dirs_include_homebrew_macports_and_the_users_bin() {
        let home = PathBuf::from("/Users/me");
        let dirs = install_dirs("macos", &home, &no_env);
        for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
            assert!(
                dirs.contains(&PathBuf::from(dir)),
                "{dir} missing: {dirs:?}"
            );
        }
        assert!(dirs.contains(&home.join(".local").join("bin")));
        assert!(dirs.contains(&home.join(".nix-profile").join("bin")));
        // Apple silicon's Homebrew before Intel's.
        let at = |d: &str| dirs.iter().position(|x| x == Path::new(d)).unwrap();
        assert!(at("/opt/homebrew/bin") < at("/usr/local/bin"));
    }

    #[test]
    fn linux_dirs_include_snap_linuxbrew_and_the_users_bin() {
        let home = PathBuf::from("/home/me");
        let dirs = install_dirs("linux", &home, &no_env);
        for dir in [
            "/usr/local/bin",
            "/snap/bin",
            "/home/linuxbrew/.linuxbrew/bin",
        ] {
            assert!(
                dirs.contains(&PathBuf::from(dir)),
                "{dir} missing: {dirs:?}"
            );
        }
        assert!(dirs.contains(&home.join(".local").join("bin")));
        assert!(dirs.contains(&home.join(".linuxbrew").join("bin")));
    }

    #[test]
    fn windows_dirs_follow_winget_scoop_and_chocolatey() {
        let home = PathBuf::from("home");
        let env = |key: &str| match key {
            "LOCALAPPDATA" => Some(OsString::from("local")),
            "ProgramData" => Some(OsString::from("data")),
            "ProgramFiles" => Some(OsString::from("pf")),
            _ => None,
        };
        let dirs = install_dirs("windows", &home, &env);
        let want = [
            PathBuf::from("local")
                .join("Microsoft")
                .join("WinGet")
                .join("Links"),
            home.join("scoop").join("shims"),
            PathBuf::from("data").join("scoop").join("shims"),
            PathBuf::from("data").join("chocolatey").join("bin"),
            PathBuf::from("pf").join("ffmpeg").join("bin"),
        ];
        for dir in &want {
            assert!(dirs.contains(dir), "{dir:?} missing: {dirs:?}");
        }
        // $SCOOP and $ChocolateyInstall move them.
        let moved = |key: &str| match key {
            "SCOOP" => Some(OsString::from("myscoop")),
            "ChocolateyInstall" => Some(OsString::from("mychoco")),
            _ => None,
        };
        let dirs = install_dirs("windows", &home, &moved);
        assert!(dirs.contains(&PathBuf::from("myscoop").join("shims")));
        assert!(dirs.contains(&PathBuf::from("mychoco").join("bin")));
    }

    /// The directory a tool was found in, and how: Windows resolves a bare
    /// name through PATHEXT, whose case need not be the file's.
    fn dir_of(got: Option<(PathBuf, Source)>) -> Option<(PathBuf, Source)> {
        got.map(|(path, source)| (path.parent().unwrap().to_path_buf(), source))
    }

    #[test]
    fn the_login_shell_path_comes_first_then_the_apps_then_install_dirs() {
        let root = scratch("order");
        let shell = root.join("shell-bin");
        let app = root.join("app-bin");
        let brew = root.join("brew-bin");
        fake_tool(&brew, "fake-ffprobe");
        let paths = [
            (Source::ShellPath, joined(&[shell.as_path()])),
            (Source::AppPath, joined(&[app.as_path()])),
        ];
        // Only in an install dir (a GUI launch: neither PATH has Homebrew).
        let got = locate("fake-ffprobe", &paths, &[root.join("none"), brew.clone()]);
        assert_eq!(dir_of(got), Some((brew.clone(), Source::InstallDir)));
        // On the app's PATH: that one, before the install dir.
        fake_tool(&app, "fake-ffprobe");
        let got = locate("fake-ffprobe", &paths, std::slice::from_ref(&brew));
        assert_eq!(dir_of(got), Some((app, Source::AppPath)));
        // On the login shell's PATH: that one, before both.
        fake_tool(&shell, "fake-ffprobe");
        let got = locate("fake-ffprobe", &paths, std::slice::from_ref(&brew));
        assert_eq!(dir_of(got), Some((shell, Source::ShellPath)));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_tool_on_no_path_and_in_no_dir_is_not_found() {
        let root = scratch("missing");
        let paths = [(Source::AppPath, joined(&[root.join("bin").as_path()]))];
        assert_eq!(locate("fake-ffprobe", &paths, &[root.join("brew")]), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_found_tool_is_kept_and_logged_with_its_path() {
        let root = scratch("kept");
        let tool = fake_tool(&root, "fake-ffmpeg");
        let kept = Mutex::new(Found::default());
        let logged = std::cell::RefCell::new(Vec::<String>::new());
        let log = |line: &str| logged.borrow_mut().push(line.to_string());
        let mut looks = 0;
        for _ in 0..3 {
            let got = kept_or_found(
                &kept,
                "fake-ffmpeg",
                || {
                    looks += 1;
                    Some((tool.clone(), Source::InstallDir))
                },
                &String::new,
                &log,
            );
            assert_eq!(got.as_deref(), Some(tool.as_path()));
        }
        assert_eq!(looks, 1, "looked up again although kept");
        assert_eq!(logged.borrow().len(), 1);
        let line = logged.borrow()[0].clone();
        assert!(
            line.contains(&tool.display().to_string()) && line.contains("install dir"),
            "{line}"
        );
        // Gone (uninstalled): looked up again.
        std::fs::remove_file(&tool).unwrap();
        let got = kept_or_found(
            &kept,
            "fake-ffmpeg",
            || None,
            &|| "searched".to_string(),
            &log,
        );
        assert_eq!(got, None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_miss_is_not_kept_so_installing_the_tool_needs_no_restart() {
        let root = scratch("retry");
        let kept = Mutex::new(Found::default());
        let logged = std::cell::RefCell::new(Vec::<String>::new());
        let log = |line: &str| logged.borrow_mut().push(line.to_string());
        let dir = root.join("brew-bin");
        let look = || locate("fake-ffprobe", &[], std::slice::from_ref(&dir));
        let searched = || format!("install dirs {}", dir.display());
        assert_eq!(
            kept_or_found(&kept, "fake-ffprobe", look, &searched, &log),
            None
        );
        // A retry before installing logs nothing new.
        assert_eq!(
            kept_or_found(&kept, "fake-ffprobe", look, &searched, &log),
            None
        );
        assert_eq!(logged.borrow().len(), 1);
        let line = logged.borrow()[0].clone();
        assert!(
            line.contains("not found") && line.contains("brew-bin"),
            "{line}"
        );
        // Installed meanwhile (`brew install ffmpeg`): the next try finds it.
        fake_tool(&dir, "fake-ffprobe");
        let got = kept_or_found(&kept, "fake-ffprobe", look, &searched, &log);
        assert_eq!(got.as_deref().and_then(Path::parent), Some(dir.as_path()));
        let line = logged.borrow()[1].clone();
        assert!(line.contains(&dir.display().to_string()), "{line}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
