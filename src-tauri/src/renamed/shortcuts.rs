//! Windows: shortcuts left under the old name, or pointing at the old install.
//!
//! The setup.exe moves the shortcuts LynShen's own installer made in the
//! user's Desktop and Start menu (src-tauri/windows/hooks.nsh), and the MSI
//! removes its own (rename.wxs). This pass is the safety net for what they do
//! not reach: a copy the user made, one on the Public Desktop or in the
//! all-users Start menu, one whose program is gone, or any an installer
//! missed. It runs once, in the background, at the first start after the
//! rename (recorded in rename-cleanup.json).
//!
//! A shortcut is the app's when it starts the old executable, or a file that
//! is gone from a directory the old app was installed in, or this executable
//! while still named after LynShen. Others are left alone. What happens to the
//! app's:
//!
//! - in the user's Desktop (wherever it was moved: the known-folder API) and
//!   Start menu: it takes the new name and starts this executable, or goes
//!   when an Aogiri shortcut is already there. One with a name of the user's
//!   own keeps that name and only gets the new target;
//! - on the Public Desktop and in the all-users Start menu: it goes. These
//!   need administrator rights; without them it stays, and the log says so;
//! - a taskbar pin starts this executable and keeps its file, which is how
//!   Explorer finds the pin.

use super::OLD_NAME;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    /// The user's Desktop and Start menu.
    Personal,
    /// The Public Desktop and the all-users Start menu.
    Shared,
    /// The taskbar pins.
    Pins,
}

/// Where the old app was, as far as this machine tells.
#[derive(Debug, Default)]
struct OldInstall {
    exes: Vec<PathBuf>,
    dirs: Vec<PathBuf>,
}

#[derive(Debug, PartialEq)]
enum Verdict {
    NotOurs,
    /// Starts the old app, or a file gone from where it was installed.
    Old,
    /// Starts this app but still carries the old name.
    NamedOld,
}

#[derive(Debug, PartialEq)]
enum Action {
    Keep,
    Remove,
    /// Point it at this executable.
    Retarget,
    /// Point it at this executable (when it does not already) and give it
    /// this file name.
    Rename { to: PathBuf, retarget: bool },
}

/// Paths compare without case, `\\?\` and a trailing backslash, as Windows
/// compares them.
fn normalize(path: &Path) -> String {
    let text = path.to_string_lossy();
    let text = text.strip_prefix(r"\\?\").unwrap_or(&text);
    text.trim_end_matches(['\\', '/']).to_lowercase()
}

fn same_path(a: &Path, b: &Path) -> bool {
    normalize(a) == normalize(b)
}

fn inside(path: &Path, dir: &Path) -> bool {
    let (path, dir) = (normalize(path), normalize(dir));
    !dir.is_empty()
        && path.len() > dir.len()
        && path.starts_with(&dir)
        && matches!(path.as_bytes()[dir.len()], b'\\' | b'/')
}

fn named_old(name: &str) -> bool {
    name.to_lowercase().contains(&OLD_NAME.to_lowercase())
}

/// `name` with the old product name replaced by `new_name`, whatever its case.
fn rename_in(name: &str, new_name: &str) -> String {
    let lower = name.to_lowercase();
    let old = OLD_NAME.to_lowercase();
    match lower.find(&old) {
        // ASCII names: byte positions in `lower` are those in `name`.
        Some(at) if lower.len() == name.len() => {
            format!("{}{new_name}{}", &name[..at], &name[at + old.len()..])
        }
        _ => new_name.to_string(),
    }
}

impl OldInstall {
    /// From what the installers recorded (`recorded`: the LynShen install
    /// directory hooks.nsh found, and LynShen's own record if it is still
    /// there), plus the places it was installed by default (`defaults`), and
    /// `<dir>\LynShen` beside this `<dir>\Aogiri` (a chosen directory the
    /// setup.exe renamed). A directory this app now runs from is not old;
    /// only the old executable in it is.
    fn new(exe: &Path, recorded: Vec<PathBuf>, defaults: Vec<PathBuf>) -> OldInstall {
        let here = exe.parent().map(Path::to_path_buf).unwrap_or_default();
        let mut old = OldInstall::default();
        let beside = here.parent().map(|parent| parent.join(OLD_NAME));
        for dir in recorded.into_iter().chain(defaults).chain(beside) {
            if dir.as_os_str().is_empty() || old.dirs.iter().any(|known| same_path(known, &dir)) {
                continue;
            }
            old.exes.push(dir.join(format!("{OLD_NAME}.exe")));
            if !same_path(&dir, &here) {
                old.dirs.push(dir);
            }
        }
        // A chosen directory reused as it was: the old executable was beside this one.
        let reused = here.join(format!("{OLD_NAME}.exe"));
        if !old.exes.iter().any(|known| same_path(known, &reused)) {
            old.exes.push(reused);
        }
        old
    }

    fn judge(&self, name: &str, target: &Path, exe: &Path, exists: &dyn Fn(&Path) -> bool) -> Verdict {
        if self.exes.iter().any(|old| same_path(old, target)) {
            return Verdict::Old;
        }
        if self.dirs.iter().any(|dir| inside(target, dir)) && !exists(target) {
            return Verdict::Old;
        }
        if same_path(target, exe) && named_old(name) {
            return Verdict::NamedOld;
        }
        Verdict::NotOurs
    }
}

/// What to do with the shortcut `link` (target `target`) in a folder of
/// `kind`. `taken`: whether a file name is in use in that folder; `has_new`:
/// whether another shortcut there already starts this executable.
fn action(
    kind: Kind,
    verdict: &Verdict,
    link: &Path,
    new_name: &str,
    taken: &dyn Fn(&Path) -> bool,
    has_new: bool,
) -> Action {
    if *verdict == Verdict::NotOurs {
        return Action::Keep;
    }
    let retarget = *verdict == Verdict::Old;
    let name = link.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
    match kind {
        Kind::Pins if retarget => Action::Retarget,
        Kind::Pins => Action::Keep,
        Kind::Shared if named_old(&name) => Action::Remove,
        Kind::Shared => Action::Retarget,
        Kind::Personal if !named_old(&name) => Action::Retarget,
        Kind::Personal if has_new => Action::Remove,
        Kind::Personal => {
            let to = link.with_file_name(format!("{}.lnk", rename_in(&name, new_name)));
            if taken(&to) {
                Action::Remove
            } else {
                Action::Rename { to, retarget }
            }
        }
    }
}

pub(super) fn tidy_once(app: &tauri::AppHandle) {
    use super::Record;

    let Some(record_path) = Record::path(app) else {
        return;
    };
    if Record::read(&record_path).shortcuts {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let new_name = app.package_info().name.clone();
    std::thread::spawn(move || {
        let Some(places) = shell::places() else {
            return;
        };
        let old = OldInstall::new(&exe, shell::recorded_dirs(), shell::default_dirs());
        for (dir, kind) in places {
            shell::tidy(&dir, kind, &old, &exe, &new_name);
        }
        let mut record = Record::read(&record_path);
        record.shortcuts = true;
        if let Err(error) = record.write(&record_path) {
            eprintln!("could not record the shortcut pass: {error}");
        }
    });
}

/// The shell's side: known folders, shortcut files, the registry.
mod shell {
    use super::{action, Action, Kind, OldInstall, Verdict, OLD_NAME};
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::{Path, PathBuf};
    use windows::core::{Interface, GUID, HSTRING, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile,
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ, STGM_READWRITE,
    };
    use windows::Win32::UI::Shell::{
        FOLDERID_CommonPrograms, FOLDERID_Desktop, FOLDERID_Programs, FOLDERID_PublicDesktop,
        FOLDERID_RoamingAppData, IShellLinkW, SHGetKnownFolderPath, ShellLink, KF_FLAG_DEFAULT,
    };

    const PUBLISHER_KEY: &str = r"Software\LynShen Innovations INC.";

    fn known_folder(id: &GUID) -> Option<PathBuf> {
        unsafe {
            let path = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
            let result = path.to_string().ok().map(PathBuf::from);
            CoTaskMemFree(Some(path.0 as *const _));
            result
        }
    }

    /// The folders to look through, with the LynShen folder the MSI made in
    /// the Start menu. None when not even the Desktop can be found.
    pub(super) fn places() -> Option<Vec<(PathBuf, Kind)>> {
        let desktop = known_folder(&FOLDERID_Desktop)?;
        let mut places = vec![(desktop, Kind::Personal)];
        for (id, kind) in [
            (FOLDERID_Programs, Kind::Personal),
            (FOLDERID_PublicDesktop, Kind::Shared),
            (FOLDERID_CommonPrograms, Kind::Shared),
        ] {
            if let Some(dir) = known_folder(&id) {
                if id != FOLDERID_PublicDesktop {
                    places.push((dir.join(OLD_NAME), kind));
                }
                places.push((dir, kind));
            }
        }
        if let Some(roaming) = known_folder(&FOLDERID_RoamingAppData) {
            let pins = roaming.join(r"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar");
            places.push((pins, Kind::Pins));
        }
        Some(places)
    }

    /// The LynShen install directory hooks.nsh found (`LegacyInstallDir` under
    /// this product's key), and LynShen's own record when it is still there.
    pub(super) fn recorded_dirs() -> Vec<PathBuf> {
        use winreg::enums::HKEY_CURRENT_USER;
        let publisher = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey(PUBLISHER_KEY);
        let Ok(publisher) = publisher else {
            return Vec::new();
        };
        let read = |key: &str, value: &str| -> Option<PathBuf> {
            let text: String = publisher.open_subkey(key).ok()?.get_value(value).ok()?;
            (!text.trim().is_empty()).then(|| PathBuf::from(text.trim()))
        };
        [read("Aogiri", "LegacyInstallDir"), read(OLD_NAME, "")]
            .into_iter()
            .flatten()
            .collect()
    }

    /// Where LynShen installed by default: per user (setup.exe), per machine (MSI).
    pub(super) fn default_dirs() -> Vec<PathBuf> {
        ["LOCALAPPDATA", "ProgramFiles"]
            .into_iter()
            .filter_map(std::env::var_os)
            .map(|base| PathBuf::from(base).join(OLD_NAME))
            .collect()
    }

    /// COM for this thread, for as long as the value lives.
    struct Com;

    impl Com {
        fn init() -> Option<Com> {
            unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok().then_some(Com)
        }
    }

    impl Drop for Com {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    fn open(link: &Path, mode: windows::Win32::System::Com::STGM) -> windows::core::Result<(IShellLinkW, IPersistFile)> {
        unsafe {
            let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            let file: IPersistFile = shell_link.cast()?;
            file.Load(&HSTRING::from(link), mode)?;
            Ok((shell_link, file))
        }
    }

    /// The program a shortcut starts; None for one to something else (a
    /// folder of the shell, a store app).
    fn target(link: &Path) -> Option<PathBuf> {
        let (shell_link, _file) = open(link, STGM_READ).ok()?;
        let mut buffer = vec![0u16; 32768];
        unsafe { shell_link.GetPath(&mut buffer, std::ptr::null_mut(), 0) }.ok()?;
        let length = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
        (length > 0).then(|| PathBuf::from(OsString::from_wide(&buffer[..length])))
    }

    fn retarget(link: &Path, exe: &Path) -> windows::core::Result<()> {
        let (shell_link, file) = open(link, STGM_READWRITE)?;
        unsafe {
            shell_link.SetPath(&HSTRING::from(exe))?;
            if let Some(dir) = exe.parent() {
                shell_link.SetWorkingDirectory(&HSTRING::from(dir))?;
            }
            // An icon taken from the old executable would be gone with it.
            let mut icon = vec![0u16; 1024];
            let mut index = 0;
            if shell_link.GetIconLocation(&mut icon, &mut index).is_ok() {
                let length = icon.iter().position(|&unit| unit == 0).unwrap_or(0);
                let path = PathBuf::from(OsString::from_wide(&icon[..length]));
                if length > 0 && !path.exists() {
                    shell_link.SetIconLocation(&HSTRING::from(exe), 0)?;
                }
            }
            file.Save(PCWSTR::null(), true)
        }
    }

    pub(super) fn tidy(dir: &Path, kind: Kind, old: &OldInstall, exe: &Path, new_name: &str) {
        let Some(_com) = Com::init() else {
            return;
        };
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let links: Vec<(PathBuf, PathBuf)> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("lnk")))
            .filter_map(|path| target(&path).map(|target| (path, target)))
            .collect();
        for (link, target) in &links {
            let name = link.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
            let verdict = old.judge(&name, target, exe, &|path: &Path| path.exists());
            if verdict == Verdict::NotOurs {
                continue;
            }
            let has_new = links
                .iter()
                .any(|(other, other_target)| other != link && super::same_path(other_target, exe));
            let done = match action(kind, &verdict, link, new_name, &|path: &Path| path.exists(), has_new) {
                Action::Keep => Ok(()),
                Action::Remove => std::fs::remove_file(link).map_err(|error| error.to_string()),
                Action::Retarget => retarget(link, exe).map_err(|error| error.to_string()),
                Action::Rename { to, retarget: point } => (if point { retarget(link, exe).map_err(|error| error.to_string()) } else { Ok(()) })
                    .and_then(|()| std::fs::rename(link, &to).map_err(|error| error.to_string())),
            };
            match done {
                Ok(()) => eprintln!("{} ({verdict:?}, was '{}'): done", link.display(), target.display()),
                Err(error) => eprintln!("{} ({verdict:?}, '{}'): left as it is: {error}", link.display(), target.display()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(path: &str) -> PathBuf {
        PathBuf::from(path)
    }

    const EXE: &str = r"C:\Users\me\AppData\Local\Aogiri\Aogiri.exe";

    fn old() -> OldInstall {
        OldInstall::new(
            &p(EXE),
            vec![p(r"C:\Users\me\AppData\Local\LynShen")],
            vec![p(r"C:\Users\me\AppData\Local\LynShen"), p(r"C:\Program Files\LynShen")],
        )
    }

    #[test]
    fn the_old_install_is_where_it_was_recorded_or_by_default() {
        let old = old();
        assert_eq!(
            old.dirs,
            vec![
                p(r"C:\Users\me\AppData\Local\LynShen"),
                p(r"C:\Program Files\LynShen"),
            ]
        );
        assert!(old.exes.contains(&p(r"C:\Program Files\LynShen\LynShen.exe")));
        // In place: the directory is this app's now, only the old executable in it counts.
        let reused = OldInstall::new(&p(r"D:\tools\agent\Aogiri.exe"), vec![p(r"D:\tools\agent")], vec![]);
        assert!(reused.dirs.iter().all(|dir| !same_path(dir, &p(r"D:\tools\agent"))));
        assert!(reused.exes.contains(&p(r"D:\tools\agent\LynShen.exe")));
        // A chosen "<dir>\LynShen" became "<dir>\Aogiri".
        let chosen = OldInstall::new(&p(r"D:\Apps\Aogiri\Aogiri.exe"), vec![], vec![]);
        assert!(chosen.dirs.contains(&p(r"D:\Apps\LynShen")));
    }

    #[test]
    fn a_shortcut_is_the_apps_by_its_target() {
        let old = old();
        let gone = |_: &Path| false;
        let there = |_: &Path| true;
        let exe = p(EXE);
        // The old executable, there or not, whatever the shortcut is called.
        assert_eq!(old.judge("LynShen", &p(r"C:\Users\me\AppData\Local\LynShen\LynShen.exe"), &exe, &there), Verdict::Old);
        assert_eq!(old.judge("我的助手", &p(r"c:\users\ME\appdata\local\lynshen\LYNSHEN.EXE"), &exe, &gone), Verdict::Old);
        assert_eq!(old.judge("LynShen", &p(r"C:\Program Files\LynShen\LynShen.exe"), &exe, &gone), Verdict::Old);
        // Something gone from the old directory; but not a file that is still there.
        assert_eq!(old.judge("LynShen 卸载", &p(r"C:\Program Files\LynShen\uninstall.exe"), &exe, &gone), Verdict::Old);
        assert_eq!(old.judge("notes", &p(r"C:\Program Files\LynShen\notes.txt"), &exe, &there), Verdict::NotOurs);
        // This executable under the old name.
        assert_eq!(old.judge("LynShen", &exe, &exe, &there), Verdict::NamedOld);
        assert_eq!(old.judge("Aogiri", &exe, &exe, &there), Verdict::NotOurs);
        // Not the app's: the name alone does not make it so.
        assert_eq!(old.judge("LynShen notes", &p(r"C:\RenameTest\LynShen notes.txt"), &exe, &gone), Verdict::NotOurs);
        assert_eq!(old.judge("LynShen", &p(r"C:\Other\LynShen.exe"), &exe, &gone), Verdict::NotOurs);
        assert_eq!(old.judge("x", &p(r"C:\Program Files\LynShenX\x.exe"), &exe, &gone), Verdict::NotOurs);
    }

    #[test]
    fn what_happens_to_the_apps_shortcuts() {
        let free = |_: &Path| false;
        let link = p(r"C:\Users\me\Desktop\LynShen.lnk");
        let act = |kind, verdict, link: &Path, has_new| action(kind, &verdict, link, "Aogiri", &free, has_new);
        assert_eq!(
            act(Kind::Personal, Verdict::Old, &link, false),
            Action::Rename { to: p(r"C:\Users\me\Desktop\Aogiri.lnk"), retarget: true }
        );
        assert_eq!(act(Kind::Personal, Verdict::Old, &link, true), Action::Remove);
        assert_eq!(
            act(Kind::Personal, Verdict::NamedOld, &link, false),
            Action::Rename { to: p(r"C:\Users\me\Desktop\Aogiri.lnk"), retarget: false }
        );
        let copy = p(r"C:\Users\me\Desktop\LynShen - 快捷方式.lnk");
        assert_eq!(act(Kind::Personal, Verdict::Old, &copy, true), Action::Remove);
        let own = p(r"C:\Users\me\Desktop\我的助手.lnk");
        assert_eq!(act(Kind::Personal, Verdict::Old, &own, true), Action::Retarget);
        assert_eq!(act(Kind::Shared, Verdict::Old, &p(r"C:\Users\Public\Desktop\LynShen.lnk"), false), Action::Remove);
        let pin = p(r"C:\Users\me\AppData\Roaming\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\LynShen.lnk");
        assert_eq!(act(Kind::Pins, Verdict::Old, &pin, false), Action::Retarget);
        assert_eq!(act(Kind::Pins, Verdict::NamedOld, &pin, false), Action::Keep);
        assert_eq!(act(Kind::Personal, Verdict::NotOurs, &link, false), Action::Keep);
        // The new name is taken by something else: the old one goes.
        let taken = |_: &Path| true;
        assert_eq!(action(Kind::Personal, &Verdict::Old, &link, "Aogiri", &taken, false), Action::Remove);
    }

    #[test]
    fn names_keep_what_the_user_added() {
        assert_eq!(rename_in("LynShen", "Aogiri"), "Aogiri");
        assert_eq!(rename_in("lynshen - Shortcut", "Aogiri"), "Aogiri - Shortcut");
        assert_eq!(rename_in("LynShen - 快捷方式", "Aogiri"), "Aogiri - 快捷方式");
        assert!(named_old("LYNSHEN"));
        assert!(!named_old("Aogiri"));
    }
}
