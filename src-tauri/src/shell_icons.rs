//! Windows: the app's shortcuts show its icon again after an update that
//! changed it (ticket #38: the desktop shortcut kept the old logo after 0.10.0).
//!
//! Explorer caches an icon by the path of the file it comes from and its
//! index, not by what is in the file. An update replaces the executable in
//! place, so the desktop shortcut, the taskbar pins and any copy go on showing
//! the icon Explorer cached from the old executable, until the shell is told
//! that icons changed (`SHCNE_ASSOCCHANGED`) and drops its cached icons.
//!
//! The setup.exe tells it as it installs (src-tauri/windows/hooks.nsh). The
//! MSI cannot without a custom-action DLL of its own, so after an MSI install
//! the app does it, at the first start of each version (the updater starts the
//! app again right after the MSI). On the way it mends taskbar pins whose icon
//! file is gone: a pin made from the MSI's Start-menu shortcut takes its icon
//! from a copy the MSI keeps under its product code, and the next MSI removes
//! that copy. The version done last is in `<app config dir>/shell-icons.txt`.
//! See docs/updater.md.

/// Whether the shell still has to be told for `version`, given the version
/// recorded the last time.
fn due(recorded: Option<&str>, version: &str) -> bool {
    recorded.map(str::trim) != Some(version)
}

#[cfg(windows)]
pub(crate) fn refresh_after_msi_install(app: &tauri::AppHandle) {
    use tauri::utils::{config::BundleType, platform::bundle_type};
    use tauri::Manager;

    if bundle_type() != Some(BundleType::Msi) {
        return;
    }
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let record = dir.join("shell-icons.txt");
    let version = app.package_info().version.to_string();
    if !due(std::fs::read_to_string(&record).ok().as_deref(), &version) {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    std::thread::spawn(move || {
        shell::refresh(&exe);
        let written =
            std::fs::create_dir_all(&dir).and_then(|()| std::fs::write(&record, &version));
        if let Err(error) = written {
            eprintln!("could not record the icon refresh: {error}");
        }
    });
}

#[cfg(windows)]
mod shell {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::{Path, PathBuf};
    use windows::core::{Interface, HSTRING, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READWRITE,
    };
    use windows::Win32::UI::Shell::{
        IShellLinkW, SHChangeNotify, ShellLink, SHCNE_ASSOCCHANGED, SHCNE_UPDATEITEM, SHCNF_IDLIST,
        SHCNF_PATHW,
    };

    pub(super) fn refresh(exe: &Path) {
        for pin in mend_pins(exe) {
            eprintln!(
                "{}: its icon file was gone, it takes the icon from {}",
                pin.display(),
                exe.display()
            );
            updated(&pin);
        }
        updated(exe);
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    }

    fn updated(path: &Path) {
        let path = HSTRING::from(path);
        unsafe {
            SHChangeNotify(
                SHCNE_UPDATEITEM,
                SHCNF_PATHW,
                Some(path.as_ptr().cast()),
                None,
            )
        };
    }

    /// COM for this thread, for as long as the value lives.
    struct Com;

    impl Com {
        fn init() -> Option<Com> {
            unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
                .is_ok()
                .then_some(Com)
        }
    }

    impl Drop for Com {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    fn same_path(a: &Path, b: &Path) -> bool {
        let normal = |path: &Path| {
            let text = path.to_string_lossy();
            text.strip_prefix(r"\\?\").unwrap_or(&text).to_lowercase()
        };
        normal(a) == normal(b)
    }

    fn from_wide(buffer: &[u16]) -> PathBuf {
        let length = buffer
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(buffer.len());
        PathBuf::from(OsString::from_wide(&buffer[..length]))
    }

    /// The taskbar pins that start `exe` but whose icon file is gone, now
    /// taking their icon from `exe`.
    fn mend_pins(exe: &Path) -> Vec<PathBuf> {
        let Some(_com) = Com::init() else {
            return Vec::new();
        };
        let Some(roaming) = std::env::var_os("APPDATA") else {
            return Vec::new();
        };
        let pins = PathBuf::from(roaming)
            .join(r"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar");
        let Ok(entries) = std::fs::read_dir(pins) else {
            return Vec::new();
        };
        let mut mended = Vec::new();
        for link in entries.flatten().map(|entry| entry.path()) {
            if !link
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("lnk"))
            {
                continue;
            }
            match mend(&link, exe) {
                Ok(true) => mended.push(link),
                Ok(false) => {}
                Err(error) => eprintln!("{}: left as it is: {error}", link.display()),
            }
        }
        mended
    }

    /// Points the icon of the shortcut `link` at `exe` when it starts `exe`
    /// and its icon file is gone. Whether it did.
    fn mend(link: &Path, exe: &Path) -> windows::core::Result<bool> {
        unsafe {
            let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            let file: IPersistFile = shell_link.cast()?;
            file.Load(&HSTRING::from(link), STGM_READWRITE)?;
            let mut target = vec![0u16; 32768];
            shell_link.GetPath(&mut target, std::ptr::null_mut(), 0)?;
            if !same_path(&from_wide(&target), exe) {
                return Ok(false);
            }
            let mut icon = vec![0u16; 32768];
            let mut index = 0;
            shell_link.GetIconLocation(&mut icon, &mut index)?;
            let icon = from_wide(&icon);
            if icon.as_os_str().is_empty() || icon.exists() {
                return Ok(false);
            }
            shell_link.SetIconLocation(&HSTRING::from(exe), 0)?;
            file.Save(PCWSTR::null(), true)?;
            Ok(true)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::due;

    #[test]
    fn the_shell_is_told_once_for_each_version() {
        assert!(due(None, "0.10.1"));
        assert!(due(Some("0.10.0"), "0.10.1"));
        assert!(!due(Some("0.10.1"), "0.10.1"));
        assert!(!due(Some("0.10.1\r\n"), "0.10.1"));
    }
}
