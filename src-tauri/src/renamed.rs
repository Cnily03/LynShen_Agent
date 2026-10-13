//! What an installation from before the rename left under the old name.
//!
//! Up to 0.5.x the product was called LynShen. Two things on the user's
//! machine are named after the product or its executable, and an update does
//! not move them:
//!
//! - The login item ("start at login"). tauri-plugin-autostart names it after
//!   the product and stores the executable's path in it: the Run value
//!   `LynShen` on Windows, `~/Library/LaunchAgents/LynShen.plist` on macOS,
//!   `~/.config/autostart/LynShen.desktop` on Linux. The plugin now looks for
//!   `Aogiri`, so the setting would read as off while the old item still runs,
//!   or points at an executable that is gone.
//! - On Linux, the `lynshen://` handler the deep-link plugin writes at start,
//!   `<data dir>/applications/<executable name>-handler.desktop`.
//!
//! `adopt` runs at start-up and moves them over. The Windows setup.exe moves
//! the login item itself (src-tauri/windows/hooks.nsh); this covers the MSI,
//! macOS, Linux, and an item an installer did not see.
//! See docs/rename-aogiri-notes.md.

use std::io;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

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
        Ok(false) => {}
        Err(error) => eprintln!("could not move the {OLD_NAME} login item: {error}"),
    }
    #[cfg(target_os = "linux")]
    remove_old_link_handler(app);
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
    let agents = std::path::Path::new(&home)
        .join("Library")
        .join("LaunchAgents");
    take_login_file(&agents.join(format!("{OLD_NAME}.plist")))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn take_old_login_item() -> io::Result<bool> {
    let Some(home) = std::env::var_os("HOME") else {
        return Ok(false);
    };
    let autostart = std::path::Path::new(&home)
        .join(".config")
        .join("autostart");
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
    use tauri::Manager;
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
    #[cfg(unix)]
    use super::*;

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
