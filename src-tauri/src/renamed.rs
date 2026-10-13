//! What an installation from before the rename left under the old name.
//!
//! Up to 0.5.x the product was called LynShen. Things on the user's machine
//! that are named after the product or its executable, and that an update does
//! not move:
//!
//! - The login item ("start at login"). tauri-plugin-autostart names it after
//!   the product and stores the executable's path in it: the Run value
//!   `LynShen` on Windows, `~/Library/LaunchAgents/LynShen.plist` on macOS,
//!   `~/.config/autostart/LynShen.desktop` on Linux. The plugin now looks for
//!   `Aogiri`, so the setting would read as off while the old item still runs,
//!   or points at an executable that is gone.
//! - On Linux, the `lynshen://` handler the deep-link plugin writes at start,
//!   `<data dir>/applications/<executable name>-handler.desktop`.
//! - On Windows, shortcuts named LynShen or starting LynShen.exe that the
//!   installers did not move (`shortcuts.rs`).
//! - On macOS, the bundle itself: the updater keeps its path, so an updated
//!   install is still `LynShen.app` (`bundle.rs`).
//!
//! `adopt` runs at start-up and moves them over. The Windows setup.exe moves
//! the login item and its own shortcuts itself (src-tauri/windows/hooks.nsh);
//! this covers the MSI, macOS, Linux, and anything an installer did not see.
//! What runs once is recorded in `<app config dir>/rename-cleanup.json`.
//! See docs/rename-aogiri-notes.md.

use std::io;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

#[cfg(target_os = "macos")]
pub(crate) mod bundle;
#[cfg(windows)]
mod shortcuts;

/// The product's name up to 0.5.x.
const OLD_NAME: &str = "LynShen";

pub(crate) fn adopt(app: &AppHandle) {
    match take_old_login_item() {
        // It was on: register this executable under the current name.
        Ok(true) => {
            if let Err(error) = app.autolaunch().enable() {
                eprintln!("could not register the login item under the new name: {error}");
            }
        }
        Ok(false) => repair_login_item(app),
        Err(error) => eprintln!("could not move the {OLD_NAME} login item: {error}"),
    }
    #[cfg(target_os = "linux")]
    remove_old_link_handler(app);
    #[cfg(windows)]
    shortcuts::tidy_once(app);
    #[cfg(target_os = "macos")]
    bundle::ask_about_copies(app);
}

/// What `adopt` has done once and must not do again.
#[cfg(any(windows, target_os = "macos", test))]
#[derive(serde::Serialize, serde::Deserialize, Default, Debug, PartialEq)]
pub(crate) struct Record {
    /// Windows: the shortcuts have been looked through (shortcuts.rs).
    #[serde(default)]
    pub shortcuts: bool,
    /// macOS: the old bundles the user has been asked about (bundle.rs).
    #[serde(default)]
    pub asked: Vec<String>,
}

#[cfg(any(windows, target_os = "macos", test))]
impl Record {
    pub fn path(app: &AppHandle) -> Option<PathBuf> {
        app.path()
            .app_config_dir()
            .ok()
            .map(|dir| dir.join("rename-cleanup.json"))
    }

    /// The record at `path`; a missing or unreadable one is empty.
    pub fn read(path: &Path) -> Record {
        serde_json::from_value(crate::read_json(path)).unwrap_or_default()
    }

    pub fn write(&self, path: &Path) -> Result<(), String> {
        let value = serde_json::to_value(self).map_err(|error| error.to_string())?;
        crate::write_json(path, &value)
    }
}

/// A login item under the current name whose program is gone (the app moved:
/// its bundle took the new name, or it was installed elsewhere) is registered
/// again for the running executable. Not in development builds, which run
/// from the build directory.
fn repair_login_item(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let Some(program) = login_item_program(&app.package_info().name) else {
        return;
    };
    if program.exists() {
        return;
    }
    if let Err(error) = app.autolaunch().enable() {
        eprintln!(
            "could not point the login item at this executable (it starts {}): {error}",
            program.display()
        );
    }
}

/// The program the login item registered under `name` starts; None when
/// there is none.
#[cfg(windows)]
fn login_item_program(name: &str) -> Option<PathBuf> {
    use winreg::enums::HKEY_CURRENT_USER;
    let command: String = winreg::RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
        .ok()?
        .get_value(name)
        .ok()?;
    command_program(&command)
}

#[cfg(target_os = "macos")]
fn login_item_program(name: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let agent = Path::new(&home)
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{name}.plist"));
    launch_agent_program(&std::fs::read_to_string(agent).ok()?)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn login_item_program(name: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let entry = Path::new(&home)
        .join(".config")
        .join("autostart")
        .join(format!("{name}.desktop"));
    let text = std::fs::read_to_string(entry).ok()?;
    let exec = text.lines().find_map(|line| line.strip_prefix("Exec="))?;
    command_program(exec)
}

/// The program a command line starts: quoted, or up to the first space
/// (Windows: up to ".exe", since the plugin does not quote the path).
#[cfg(any(windows, all(unix, not(target_os = "macos")), test))]
fn command_program(command: &str) -> Option<PathBuf> {
    let command = command.trim();
    let program = if let Some(rest) = command.strip_prefix('"') {
        &rest[..rest.find('"')?]
    } else if let Some(end) = command.to_ascii_lowercase().find(".exe") {
        &command[..end + 4]
    } else {
        command.split_whitespace().next()?
    };
    (!program.is_empty()).then(|| PathBuf::from(program))
}

/// The first of `ProgramArguments` in a LaunchAgent as auto-launch writes it.
#[cfg(any(target_os = "macos", test))]
fn launch_agent_program(plist: &str) -> Option<PathBuf> {
    let after = &plist[plist.find("<key>ProgramArguments</key>")?..];
    let start = after.find("<string>")? + "<string>".len();
    let end = start + after[start..].find("</string>")?;
    let program = after[start..end]
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&");
    Some(PathBuf::from(program))
}

/// Removes the login item registered under the old name. True when there was
/// one and it was on.
#[cfg(windows)]
fn take_old_login_item() -> io::Result<bool> {
    take_run_value(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
        OLD_NAME,
    )
}

#[cfg(target_os = "macos")]
fn take_old_login_item() -> io::Result<bool> {
    let Some(home) = std::env::var_os("HOME") else {
        return Ok(false);
    };
    let agents = Path::new(&home).join("Library").join("LaunchAgents");
    take_login_file(&agents.join(format!("{OLD_NAME}.plist")))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn take_old_login_item() -> io::Result<bool> {
    let Some(home) = std::env::var_os("HOME") else {
        return Ok(false);
    };
    let autostart = Path::new(&home).join(".config").join("autostart");
    take_login_file(&autostart.join(format!("{OLD_NAME}.desktop")))
}

/// The login item as a file (a LaunchAgent, an autostart entry): removes it
/// when it is this app's, which shows by the argument the app registers. A
/// file of that name written by something else stays.
#[cfg(unix)]
fn take_login_file(path: &std::path::Path) -> io::Result<bool> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    if !text.contains(crate::autostart::ARG) {
        return Ok(false);
    }
    std::fs::remove_file(path)?;
    Ok(true)
}

/// The login item as a value of a Run key, with Task Manager's switch beside
/// it (12 bytes; the first is odd when the user turned the item off there).
/// Removes both. An item that was off stays off: the setting showed it so.
#[cfg(windows)]
fn take_run_value(run: &str, approved: &str, name: &str) -> io::Result<bool> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::RegKey;

    let missing = |error: &io::Error| error.kind() == io::ErrorKind::NotFound;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = match hkcu.open_subkey_with_flags(run, KEY_READ | KEY_SET_VALUE) {
        Ok(key) => key,
        Err(error) if missing(&error) => return Ok(false),
        Err(error) => return Err(error),
    };
    let command: String = match run_key.get_value(name) {
        Ok(command) => command,
        Err(error) if missing(&error) => return Ok(false),
        Err(error) => return Err(error),
    };
    // Not this app's: it registers itself with its argument.
    if !command.contains(crate::autostart::ARG) {
        return Ok(false);
    }
    let mut on = true;
    if let Ok(key) = hkcu.open_subkey_with_flags(approved, KEY_READ | KEY_SET_VALUE) {
        if let Ok(state) = key.get_raw_value(name) {
            on = !matches!(state.bytes.first(), Some(first) if first & 1 == 1);
            let _ = key.delete_value(name);
        }
    }
    run_key.delete_value(name)?;
    Ok(on)
}

/// The deep-link plugin names its handler file after the executable, so the
/// renamed executable writes a new one beside the old. The old one goes; the
/// plugin registers the new one right after (`register_all` in lib.rs).
#[cfg(target_os = "linux")]
fn remove_old_link_handler(app: &AppHandle) {
    let Ok(data) = app.path().data_dir() else {
        return;
    };
    let _ = take_link_handler(
        &data
            .join("applications")
            .join(format!("{OLD_NAME}-handler.desktop")),
    );
}

/// Removes the old handler file when it is the plugin's (it handles this
/// app's scheme). True when it was removed.
#[cfg(any(target_os = "linux", all(test, unix)))]
fn take_link_handler(path: &std::path::Path) -> bool {
    match std::fs::read_to_string(path) {
        Ok(text) if text.contains("x-scheme-handler/lynshen") => std::fs::remove_file(path).is_ok(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_program_a_login_item_starts() {
        // Windows: auto-launch does not quote the path; the setup.exe does.
        assert_eq!(
            command_program(r"C:\Users\me\AppData\Local\Aogiri\Aogiri.exe --autostart"),
            Some(PathBuf::from(r"C:\Users\me\AppData\Local\Aogiri\Aogiri.exe"))
        );
        assert_eq!(
            command_program(r#""C:\My Apps\Aogiri\Aogiri.exe" --autostart"#),
            Some(PathBuf::from(r"C:\My Apps\Aogiri\Aogiri.exe"))
        );
        // Linux autostart entry.
        assert_eq!(command_program("/usr/bin/Aogiri --autostart"), Some(PathBuf::from("/usr/bin/Aogiri")));
        assert_eq!(command_program("  "), None);
        // macOS LaunchAgent as auto-launch 0.5 writes it.
        let agent = "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>Label</key><string>Aogiri</string>\
                     <key>ProgramArguments</key><array><string>/Applications/LynShen.app/Contents/MacOS/Aogiri</string>\
                     <string>--autostart</string></array><key>RunAtLoad</key><true/></dict></plist>";
        assert_eq!(
            launch_agent_program(agent),
            Some(PathBuf::from("/Applications/LynShen.app/Contents/MacOS/Aogiri"))
        );
        assert_eq!(
            launch_agent_program("<key>ProgramArguments</key><array><string>/Apps/R&amp;D.app/x</string>"),
            Some(PathBuf::from("/Apps/R&D.app/x"))
        );
        assert_eq!(launch_agent_program("<plist></plist>"), None);
    }

    #[test]
    fn the_record_reads_back_and_starts_empty() {
        let dir = std::env::temp_dir().join(format!("lynshen-renamed-record-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("rename-cleanup.json");
        assert_eq!(Record::read(&path), Record::default());
        let record = Record { shortcuts: true, asked: vec!["/Applications/LynShen.app".into()] };
        record.write(&path).unwrap();
        assert_eq!(Record::read(&path), record);
        // A record from a later version with more in it still reads.
        std::fs::write(&path, r#"{"shortcuts":true,"later":1}"#).unwrap();
        assert!(Record::read(&path).shortcuts);
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(Record::read(&path), Record::default());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    fn temp(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lynshen-renamed-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(unix)]
    #[test]
    fn the_old_login_file_is_taken_when_it_is_ours() {
        let dir = temp("login");
        // What tauri-plugin-autostart 2.6.0 wrote on macOS and on Linux.
        let agent = dir.join("LynShen.plist");
        std::fs::write(
            &agent,
            "<plist version=\"1.0\"><dict><key>Label</key><string>LynShen</string><key>ProgramArguments</key>\
             <array><string>/Applications/LynShen.app/Contents/MacOS/LynShen</string><string>--autostart</string></array>\
             <key>RunAtLoad</key><true/></dict></plist>",
        )
        .unwrap();
        assert!(take_login_file(&agent).unwrap());
        assert!(!agent.exists());
        let entry = dir.join("LynShen.desktop");
        std::fs::write(
            &entry,
            "[Desktop Entry]\nType=Application\nName=LynShen\nExec=/usr/bin/LynShen --autostart\n",
        )
        .unwrap();
        assert!(take_login_file(&entry).unwrap());
        assert!(!entry.exists());
        // Nothing there: nothing to move.
        assert!(!take_login_file(&entry).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_file_of_that_name_from_something_else_stays() {
        let dir = temp("foreign");
        let entry = dir.join("LynShen.desktop");
        std::fs::write(
            &entry,
            "[Desktop Entry]\nType=Application\nExec=/opt/other/LynShen\n",
        )
        .unwrap();
        assert!(!take_login_file(&entry).unwrap());
        assert!(entry.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn the_old_link_handler_goes_and_other_files_stay() {
        let dir = temp("handler");
        let handler = dir.join("LynShen-handler.desktop");
        std::fs::write(
            &handler,
            "[Desktop Entry]\nType=Application\nName=LynShen\nExec=\"/usr/bin/LynShen\" %u\nTerminal=false\nMimeType=x-scheme-handler/lynshen\nNoDisplay=true\n",
        )
        .unwrap();
        assert!(take_link_handler(&handler));
        assert!(!handler.exists());
        std::fs::write(
            &handler,
            "[Desktop Entry]\nMimeType=x-scheme-handler/other\n",
        )
        .unwrap();
        assert!(!take_link_handler(&handler));
        assert!(handler.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    mod run_key {
        use super::super::take_run_value;
        use winreg::enums::{RegType, HKEY_CURRENT_USER};
        use winreg::{RegKey, RegValue};

        /// A scratch key with a `Run` and an `Approved` key under it, as the
        /// real ones look after the app turned "start at login" on.
        fn scratch(name: &str, command: &str, state: Option<[u8; 12]>) -> (String, String, String) {
            let base = format!(r"Software\LynShenRenamedTest-{}-{name}", std::process::id());
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let _ = hkcu.delete_subkey_all(&base);
            let (run, approved) = (format!(r"{base}\Run"), format!(r"{base}\Approved"));
            hkcu.create_subkey(&run)
                .unwrap()
                .0
                .set_value("LynShen", &command)
                .unwrap();
            let (key, _) = hkcu.create_subkey(&approved).unwrap();
            if let Some(bytes) = state {
                key.set_raw_value(
                    "LynShen",
                    &RegValue {
                        vtype: RegType::REG_BINARY,
                        bytes: bytes.to_vec(),
                    },
                )
                .unwrap();
            }
            (base, run, approved)
        }

        fn values(key: &str) -> usize {
            RegKey::predef(HKEY_CURRENT_USER)
                .open_subkey(key)
                .unwrap()
                .enum_values()
                .count()
        }

        const COMMAND: &str = r"C:\Users\me\AppData\Local\LynShen\LynShen.exe --autostart";
        const ON: [u8; 12] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        const OFF: [u8; 12] = [3, 0, 0, 0, 0x10, 0x32, 0x54, 0x76, 0x98, 0xba, 0xdc, 0x01];

        #[test]
        fn an_item_that_was_on_is_taken() {
            for (name, state) in [("on", Some(ON)), ("unset", None)] {
                let (base, run, approved) = scratch(name, COMMAND, state);
                assert!(take_run_value(&run, &approved, "LynShen").unwrap());
                assert_eq!((values(&run), values(&approved)), (0, 0));
                // Gone now: nothing to move the next time.
                assert!(!take_run_value(&run, &approved, "LynShen").unwrap());
                RegKey::predef(HKEY_CURRENT_USER)
                    .delete_subkey_all(&base)
                    .unwrap();
            }
        }

        #[test]
        fn an_item_switched_off_in_task_manager_is_removed_and_stays_off() {
            let (base, run, approved) = scratch("off", COMMAND, Some(OFF));
            assert!(!take_run_value(&run, &approved, "LynShen").unwrap());
            assert_eq!((values(&run), values(&approved)), (0, 0));
            RegKey::predef(HKEY_CURRENT_USER)
                .delete_subkey_all(&base)
                .unwrap();
        }

        #[test]
        fn a_value_of_that_name_from_something_else_stays() {
            let (base, run, approved) = scratch("foreign", r"C:\Other\LynShen.exe", Some(ON));
            assert!(!take_run_value(&run, &approved, "LynShen").unwrap());
            assert_eq!((values(&run), values(&approved)), (1, 1));
            RegKey::predef(HKEY_CURRENT_USER)
                .delete_subkey_all(&base)
                .unwrap();
        }
    }
}
