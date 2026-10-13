//! macOS: the app bundle's own name.
//!
//! The updater swaps in the new bundle at the running bundle's path
//! (tauri-plugin-updater 2.13 `install_inner`), so an install of LynShen 0.5.x
//! updated to Aogiri is still `/Applications/LynShen.app`. Finder, Launchpad,
//! Spotlight and the Dock name an app after its bundle's file name, so they
//! keep saying LynShen. Two steps fix that:
//!
//! - `take_new_name`, first thing at start, before Tauri: running from
//!   `<dir>/LynShen.app` with no `<dir>/Aogiri.app`, the bundle is renamed to
//!   `Aogiri.app` and the app starts again from there (`open -n`, which also
//!   makes LaunchServices note the new path). A rename in the same folder
//!   keeps the bundle's file, which Dock items and aliases follow; its code
//!   signature, which does not cover the bundle's own name; and its extended
//!   attributes, so the quarantine flag and Gatekeeper's approval stay as
//!   they were. Privacy permissions (microphone, screen recording) are keyed
//!   on the identifier and the signature, which do not change. The login
//!   item, which names the executable's path, is moved by `repair_login_item`
//!   in renamed.rs on the next start. A bundle that App Translocation runs
//!   from a read-only copy is left alone, as is one the user cannot rename
//!   (the app then starts as before).
//! - `ask_about_copies`, once the app is up: when another bundle with this
//!   identifier sits beside it (a fresh Aogiri.app from the dmg next to the old
//!   LynShen.app), the user is asked once whether to move the extra copy to
//!   the Trash. Nothing is removed without that answer, the Trash gives it
//!   back, and no user data is in a bundle (docs/rename-aogiri-notes.md).

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The bundle's file name up to 0.5.x, and the one the dmg installs now.
const OLD_BUNDLE: &str = "LynShen.app";
const NEW_BUNDLE: &str = "Aogiri.app";
const IDENTIFIER: &str = "com.lynshen.desktop";

/// `<dir>/<name>.app` when `exe` is `<dir>/<name>.app/Contents/MacOS/<exe>`.
fn bundle_of(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let is_bundle = macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension()?.eq_ignore_ascii_case("app");
    is_bundle.then(|| bundle.to_path_buf())
}

fn named(path: &Path, name: &str) -> bool {
    path.file_name()
        .and_then(|file| file.to_str())
        .is_some_and(|file| file.eq_ignore_ascii_case(name))
}

fn exists(path: &Path) -> bool {
    path.symlink_metadata().is_ok()
}

/// Where a running `LynShen.app` goes: `Aogiri.app` beside it, when nothing
/// has that name yet. None for any other bundle, and for one App
/// Translocation runs from a read-only copy (a quarantined app started where
/// it was downloaded).
fn new_name_for(bundle: &Path, exists: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    if !named(bundle, OLD_BUNDLE) || bundle.to_string_lossy().contains("/AppTranslocation/") {
        return None;
    }
    let target = bundle.with_file_name(NEW_BUNDLE);
    (!exists(&target)).then_some(target)
}

/// `open -n <bundle> --args <args>`: LaunchServices starts the bundle and
/// notes where it now is. `-n` because this process still runs meanwhile.
fn open_command(bundle: &Path, args: &[OsString]) -> Command {
    let mut open = Command::new("/usr/bin/open");
    open.arg("-n").arg(bundle);
    if !args.is_empty() {
        open.arg("--args").args(args);
    }
    open
}

/// First thing at start, before Tauri (and its single-instance lock): a
/// running `LynShen.app` takes the new name and starts again from it, and
/// this process ends. Otherwise, or when that fails, it returns and the app
/// starts as usual.
pub(crate) fn take_new_name() {
    let Some(bundle) = std::env::current_exe().ok().and_then(|exe| bundle_of(&exe)) else {
        return;
    };
    let Some(target) = new_name_for(&bundle, &exists) else {
        return;
    };
    if let Err(error) = std::fs::rename(&bundle, &target) {
        eprintln!("could not rename {} to {}: {error}", bundle.display(), target.display());
        return;
    }
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    match open_command(&target, &args).status() {
        Ok(status) if status.success() => std::process::exit(0),
        result => {
            eprintln!("could not start {}: {result:?}", target.display());
            // This process's own files are in the bundle: give it its name back.
            let _ = std::fs::rename(&target, &bundle);
        }
    }
}

/// What to ask, given the running bundle and the bundles found beside it.
#[derive(Debug, PartialEq)]
enum Question {
    /// Running as Aogiri.app; `old` is a LynShen.app of this app.
    TrashOld { old: PathBuf },
    /// Running as LynShen.app, which could not take the new name because
    /// `other` (Aogiri.app, this app too) has it. `keep_this`: this copy is
    /// the newer one, or as new; otherwise `other` is newer.
    TwoCopies { this: PathBuf, other: PathBuf, keep_this: bool },
}

impl Question {
    /// The LynShen.app it is about: asked about once.
    fn old_bundle(&self) -> &Path {
        match self {
            Question::TrashOld { old } => old,
            Question::TwoCopies { this, .. } => this,
        }
    }
}

/// `a` is a newer version than `b`. A version that does not parse is not newer.
fn newer(a: Option<&str>, b: Option<&str>) -> bool {
    let parse = |version: &str| -> Option<Vec<u64>> {
        version.trim().split('.').map(|part| part.parse().ok()).collect()
    };
    match (a.and_then(parse), b.and_then(parse)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

fn question(
    running: &Path,
    dirs: &[PathBuf],
    asked: &[String],
    ours: &dyn Fn(&Path) -> bool,
    version: &dyn Fn(&Path) -> Option<String>,
) -> Option<Question> {
    let was_asked = |bundle: &Path| asked.iter().any(|item| Path::new(item) == bundle);
    if named(running, NEW_BUNDLE) {
        dirs.iter()
            .map(|dir| dir.join(OLD_BUNDLE))
            .find(|old| old != running && ours(old) && !was_asked(old))
            .map(|old| Question::TrashOld { old })
    } else if named(running, OLD_BUNDLE) {
        let other = running.with_file_name(NEW_BUNDLE);
        if !ours(&other) || was_asked(running) {
            return None;
        }
        let keep_this = !newer(version(&other).as_deref(), version(running).as_deref());
        Some(Question::TwoCopies { this: running.to_path_buf(), other, keep_this })
    } else {
        None
    }
}

/// The text and the confirming button of the question.
fn wording(question: &Question, version: &dyn Fn(&Path) -> Option<String>) -> (String, &'static str) {
    let version = |bundle: &Path| version(bundle).unwrap_or_else(|| "未知".into());
    let kept = "聊天记录、设置和登录不在应用里，不受影响；需要时可以从废纸篓放回。";
    match question {
        Question::TrashOld { old } => (
            format!(
                "LynShen 已改名为 Aogiri。旧的 {}（版本 {}）还在。\n\n要把它移到废纸篓吗？{kept}",
                old.display(),
                version(old)
            ),
            "移到废纸篓",
        ),
        Question::TwoCopies { this, other, keep_this: true } => (
            format!(
                "这台 Mac 上有两份 Aogiri：正在运行的 {}（版本 {}），和 {}（版本 {}）。\n\n要把 {} 移到废纸篓，并把正在运行的这份改名为 {NEW_BUNDLE} 吗？{kept}",
                this.display(),
                version(this),
                other.display(),
                version(other),
                other.display()
            ),
            "移到废纸篓并改名",
        ),
        Question::TwoCopies { this, other, keep_this: false } => (
            format!(
                "这台 Mac 上有两份 Aogiri：正在运行的 {}（版本 {}）比 {}（版本 {}）旧。\n\n要把正在运行的这份移到废纸篓，改用 {} 吗？{kept}",
                this.display(),
                version(this),
                other.display(),
                version(other),
                other.display()
            ),
            "移到废纸篓",
        ),
    }
}

fn info(bundle: &Path, key: &str) -> Option<String> {
    let plist = plist::Value::from_file(bundle.join("Contents").join("Info.plist")).ok()?;
    plist.as_dictionary()?.get(key)?.as_string().map(str::to_owned)
}

fn ours(bundle: &Path) -> bool {
    info(bundle, "CFBundleIdentifier").as_deref() == Some(IDENTIFIER)
}

fn version(bundle: &Path) -> Option<String> {
    info(bundle, "CFBundleShortVersionString")
}

/// Once the app is up: another copy of it beside this one is the user's
/// to remove, after one question.
pub(crate) fn ask_about_copies(app: &tauri::AppHandle) {
    use super::Record;
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    // A silent start at login brings up no questions; the next start asks.
    if crate::autostart::silent_launch() {
        return;
    }
    let Some(running) = std::env::current_exe().ok().and_then(|exe| bundle_of(&exe)) else {
        return;
    };
    let Some(record_path) = Record::path(app) else {
        return;
    };
    let mut dirs: Vec<PathBuf> = Vec::new();
    let home_apps = std::env::var_os("HOME").map(|home| Path::new(&home).join("Applications"));
    for dir in [running.parent().map(Path::to_path_buf), Some("/Applications".into()), home_apps]
        .into_iter()
        .flatten()
    {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    let mut record = Record::read(&record_path);
    let Some(question) = question(&running, &dirs, &record.asked, &ours, &version) else {
        return;
    };
    // Once: recorded before it shows, so quitting without an answer counts.
    // Not recorded, not asked: it would come at every start.
    record.asked.push(question.old_bundle().to_string_lossy().into_owned());
    if let Err(error) = record.write(&record_path) {
        eprintln!("could not record the question about {}: {error}", question.old_bundle().display());
        return;
    }
    let (message, confirm) = wording(&question, &version);
    let handle = app.clone();
    app.dialog()
        .message(message)
        .title("Aogiri")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(confirm.into(), "保留".into()))
        .show(move |confirmed| {
            if !confirmed {
                return;
            }
            if let Err(error) = answer(&handle, question) {
                handle
                    .dialog()
                    .message(format!("没能完成：{error}"))
                    .title("Aogiri")
                    .kind(MessageDialogKind::Warning)
                    .show(|_| {});
            }
        });
}

fn answer(app: &tauri::AppHandle, question: Question) -> Result<(), String> {
    match question {
        Question::TrashOld { old } => trash(&old),
        Question::TwoCopies { this, other, keep_this: true } => {
            trash(&other)?;
            std::fs::rename(&this, &other).map_err(|error| error.to_string())?;
            restart_from(app, &other)
        }
        Question::TwoCopies { other, this, keep_this: false } => {
            trash(&this)?;
            restart_from(app, &other)
        }
    }
}

/// Moves a bundle to the Trash, where the user can put it back.
fn trash(bundle: &Path) -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSURL};
    let url = NSURL::from_directory_path(bundle).ok_or_else(|| format!("{}: not a path", bundle.display()))?;
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|error| format!("{}: {}", bundle.display(), error.localizedDescription()))
}

/// Starts the app from `bundle` once this process has ended, and ends it: a
/// second instance would otherwise hand over to this one and quit.
fn restart_from(app: &tauri::AppHandle, bundle: &Path) -> Result<(), String> {
    let wait = "while kill -0 \"$1\" 2>/dev/null; do sleep 0.2; done; exec /usr/bin/open -n \"$2\"";
    Command::new("/bin/sh")
        .args(["-c", wait, "sh"])
        .arg(std::process::id().to_string())
        .arg(bundle)
        .spawn()
        .map_err(|error| error.to_string())?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(path: &str) -> PathBuf {
        PathBuf::from(path)
    }

    #[test]
    fn the_bundle_is_found_from_its_executable() {
        assert_eq!(bundle_of(&p("/Applications/LynShen.app/Contents/MacOS/Aogiri")), Some(p("/Applications/LynShen.app")));
        assert_eq!(bundle_of(&p("/Users/me/Applications/Aogiri.app/Contents/MacOS/Aogiri")), Some(p("/Users/me/Applications/Aogiri.app")));
        // `tauri dev`: a bare executable.
        assert_eq!(bundle_of(&p("/Users/me/src/desktop/src-tauri/target/debug/Aogiri")), None);
        assert_eq!(bundle_of(&p("/Applications/LynShen.app/Contents/Resources/x")), None);
    }

    #[test]
    fn only_a_lynshen_bundle_takes_the_new_name_and_only_when_it_is_free() {
        let free = |_: &Path| false;
        let taken = |_: &Path| true;
        assert_eq!(new_name_for(&p("/Applications/LynShen.app"), &free), Some(p("/Applications/Aogiri.app")));
        assert_eq!(new_name_for(&p("/Users/me/Applications/lynshen.app"), &free), Some(p("/Users/me/Applications/Aogiri.app")));
        assert_eq!(new_name_for(&p("/Applications/LynShen.app"), &taken), None);
        assert_eq!(new_name_for(&p("/Applications/Aogiri.app"), &free), None);
        assert_eq!(new_name_for(&p("/Applications/LynShen 2.app"), &free), None);
        assert_eq!(
            new_name_for(&p("/private/var/folders/x/T/AppTranslocation/1234/d/LynShen.app"), &free),
            None
        );
    }

    #[test]
    fn it_starts_again_through_launchservices_with_its_arguments() {
        let open = open_command(&p("/Applications/Aogiri.app"), &["--autostart".into()]);
        assert_eq!(open.get_program(), "/usr/bin/open");
        let args: Vec<_> = open.get_args().collect();
        assert_eq!(args, ["-n", "/Applications/Aogiri.app", "--args", "--autostart"]);
        let open = open_command(&p("/Applications/Aogiri.app"), &[]);
        assert_eq!(open.get_args().collect::<Vec<_>>(), ["-n", "/Applications/Aogiri.app"]);
    }

    #[test]
    fn versions_compare_by_number() {
        assert!(newer(Some("0.7.0"), Some("0.6.0")));
        assert!(newer(Some("0.10.0"), Some("0.9.9")));
        assert!(!newer(Some("0.6.0"), Some("0.6.0")));
        assert!(!newer(Some("0.6.0"), Some("0.7.0")));
        assert!(!newer(None, Some("0.7.0")));
        assert!(!newer(Some("0.7.0-beta"), Some("0.6.0")));
    }

    #[test]
    fn the_question_depends_on_which_copy_runs() {
        let dirs = [p("/Applications"), p("/Users/me/Applications")];
        let all_ours = |_: &Path| true;
        let none_ours = |_: &Path| false;
        let version = |bundle: &Path| {
            Some(if bundle.ends_with("LynShen.app") { "0.6.0" } else { "0.7.0" }.to_string())
        };
        // Aogiri.app runs, an old LynShen.app is beside it.
        assert_eq!(
            question(&p("/Applications/Aogiri.app"), &dirs, &[], &all_ours, &version),
            Some(Question::TrashOld { old: p("/Applications/LynShen.app") })
        );
        // Asked before: not again; the one in ~/Applications is a different bundle.
        assert_eq!(
            question(&p("/Applications/Aogiri.app"), &dirs, &["/Applications/LynShen.app".into()], &all_ours, &version),
            Some(Question::TrashOld { old: p("/Users/me/Applications/LynShen.app") })
        );
        // Not this app (another identifier, or not there at all).
        assert_eq!(question(&p("/Applications/Aogiri.app"), &dirs, &[], &none_ours, &version), None);
        // The updated LynShen.app runs and Aogiri.app (newer) is beside it.
        assert_eq!(
            question(&p("/Applications/LynShen.app"), &dirs, &[], &all_ours, &version),
            Some(Question::TwoCopies {
                this: p("/Applications/LynShen.app"),
                other: p("/Applications/Aogiri.app"),
                keep_this: false
            })
        );
        let same = |_: &Path| Some("0.7.0".to_string());
        assert_eq!(
            question(&p("/Applications/LynShen.app"), &dirs, &[], &all_ours, &same),
            Some(Question::TwoCopies {
                this: p("/Applications/LynShen.app"),
                other: p("/Applications/Aogiri.app"),
                keep_this: true
            })
        );
        assert_eq!(
            question(&p("/Applications/LynShen.app"), &dirs, &["/Applications/LynShen.app".into()], &all_ours, &same),
            None
        );
        // Any other bundle name: nothing to ask.
        assert_eq!(question(&p("/Applications/Other.app"), &dirs, &[], &all_ours, &same), None);
    }

    #[test]
    fn the_question_names_both_copies_and_what_stays() {
        let version = |_: &Path| Some("0.7.0".to_string());
        let (text, button) = wording(&Question::TrashOld { old: p("/Applications/LynShen.app") }, &version);
        assert!(text.contains("/Applications/LynShen.app") && text.contains("废纸篓") && text.contains("不受影响"));
        assert_eq!(button, "移到废纸篓");
        let (text, button) = wording(
            &Question::TwoCopies { this: p("/Applications/LynShen.app"), other: p("/Applications/Aogiri.app"), keep_this: true },
            &version,
        );
        assert!(text.contains("改名为 Aogiri.app"));
        assert_eq!(button, "移到废纸篓并改名");
    }
}
