//! 主窗口由这里创建（配置里的窗口是 `create: false`），因为它有两处取决于用户的选择，
//! 而这些选择存在 webview 的 localStorage 里，窗口出现之前读不到。前端把它们抄一份到
//! ~/.lynshen/desktop-window.json（`set_window_frost`、`set_window_theme`），下次启动时
//! 在创建窗口之前读：
//!
//! - 窗口磨砂（设置 → 通用），默认关闭。打开时：macOS 的 NSVisualEffectView，或
//!   Windows 11 的 Mica，铺在透明窗口后面。关闭时不铺任何原生效果，Windows 上窗口是
//!   不透明的：透明窗口加 Acrylic 在拖动和缩放时跟不上鼠标，所以也不再退回 Acrylic，
//!   Windows 10 上没有这个设置。macOS 的窗口始终透明（tauri.macos.conf.json，页面自己
//!   画圆角），那里只有磨砂层是按设置铺的，改了立即生效；Windows 的窗口透明与否在
//!   创建时就定了，改了要到下次启动才生效。
//! - 主题：窗口和 webview 的底色用主题的画布色（app.css 的 `--bg`），页面画出来之前
//!   不会闪一帧白底。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::utils::config::Color;
use tauri::{Manager, Theme, WebviewWindow, WebviewWindowBuilder};

/// The main window's label (the config's default).
const LABEL: &str = "main";

/// `--bg` of the dark and the light theme (src/lib/app.css).
/// src/lib/themeTokens.test.ts fails when the two files disagree.
const CANVAS_DARK: Color = Color(0x1a, 0x1a, 0x1a, 0xff);
const CANVAS_LIGHT: Color = Color(0xf6, 0xf5, 0xf2, 0xff);

/// The theme setting (Settings → 通用 → 主题), as the frontend names it.
#[derive(Serialize, Deserialize, Default, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ThemeChoice {
    #[default]
    System,
    Light,
    Dark,
}

impl ThemeChoice {
    /// The appearance to give the window; `None` follows the system.
    fn native(self) -> Option<Theme> {
        match self {
            ThemeChoice::System => None,
            ThemeChoice::Light => Some(Theme::Light),
            ThemeChoice::Dark => Some(Theme::Dark),
        }
    }
}

/// desktop-window.json: what the window needs to know before the page runs.
#[derive(Serialize, Default, Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WindowPrefs {
    /// 窗口磨砂. Off unless the user turned it on.
    pub frost: bool,
    pub theme: ThemeChoice,
}

impl WindowPrefs {
    /// A missing or unreadable file, or a field that is not what it should
    /// be, counts as the default: no frost, the system's theme.
    fn read(path: &Path) -> Self {
        let saved = crate::read_json(path);
        Self {
            frost: saved.get("frost").and_then(|v| v.as_bool()).unwrap_or(false),
            theme: saved
                .get("theme")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default(),
        }
    }

    fn write(&self, path: &Path) -> Result<(), String> {
        let value = serde_json::to_value(self).map_err(|e| e.to_string())?;
        crate::write_json(path, &value)
    }
}

fn prefs_path() -> PathBuf {
    crate::lynshen_dir().join("desktop-window.json")
}

/// Changes one field of the saved prefs; writes only what changed.
fn update_prefs(path: &Path, change: impl FnOnce(&mut WindowPrefs)) {
    let before = WindowPrefs::read(path);
    let mut after = before;
    change(&mut after);
    if after != before || !path.exists() {
        let _ = after.write(path);
    }
}

/// The colour the window and the webview show before the page paints.
fn canvas(dark: bool) -> Color {
    if dark {
        CANVAS_DARK
    } else {
        CANVAS_LIGHT
    }
}

/// The first Windows build with Mica (Windows 11).
#[cfg(target_os = "windows")]
const MICA_MIN_BUILD: u32 = 22000;

/// Whether this system has a native frost to offer: vibrancy on macOS, Mica
/// on Windows 11. Not Windows 10 (only Acrylic, which lags) and not Linux.
#[cfg(target_os = "macos")]
pub(crate) fn frost_supported() -> bool {
    true
}
#[cfg(target_os = "windows")]
pub(crate) fn frost_supported() -> bool {
    windows_version::OsVersion::current().build >= MICA_MIN_BUILD
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn frost_supported() -> bool {
    false
}

/// The native frost behind the main window now: `vibrancy` (macOS) or `mica`
/// (Windows 11); `None` without one.
static EFFECT: Mutex<Option<&'static str>> = Mutex::new(None);
/// The page shows what is behind the window wherever it does not paint: the
/// window then takes no background colour of its own.
static SEE_THROUGH: AtomicBool = AtomicBool::new(false);

fn effect() -> Option<&'static str> {
    *EFFECT.lock().unwrap_or_else(|e| e.into_inner())
}

/// Lays the native frost behind the window, or takes it away. On the main
/// thread (AppKit). Windows only lays it: its window is created for it.
#[cfg(target_os = "macos")]
fn set_effect(win: &WebviewWindow, on: bool) {
    use window_vibrancy::{
        apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
    };
    let mut effect = EFFECT.lock().unwrap_or_else(|e| e.into_inner());
    if on == effect.is_some() {
        return;
    }
    if on {
        // The material follows the window's light / dark appearance, which
        // follows the app's theme (theme.svelte.ts).
        let applied = apply_vibrancy(
            win,
            NSVisualEffectMaterial::Sidebar,
            Some(NSVisualEffectState::Active),
            None,
        );
        if applied.is_ok() {
            *effect = Some("vibrancy");
        }
    } else if clear_vibrancy(win).is_ok() {
        *effect = None;
    }
}
#[cfg(target_os = "windows")]
fn set_effect(win: &WebviewWindow, on: bool) {
    // None: Mica follows the window's light / dark appearance.
    if on && window_vibrancy::apply_mica(win, None).is_ok() {
        *EFFECT.lock().unwrap_or_else(|e| e.into_inner()) = Some("mica");
    }
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn set_effect(_win: &WebviewWindow, _on: bool) {}

/// What the frontend needs to know about the frost.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WindowFrost {
    /// This system has one to offer (the setting shows only then).
    supported: bool,
    /// The one behind the window now.
    effect: Option<&'static str>,
}

/// Creates the main window from its config entry and shows it, unless
/// `hidden` (a silent launch at login: the window stays in the tray).
pub(crate) fn create(app: &tauri::App, hidden: bool) -> tauri::Result<WebviewWindow> {
    let prefs = WindowPrefs::read(&prefs_path());
    let frost = prefs.frost && frost_supported();
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == LABEL)
        .cloned()
        .ok_or(tauri::Error::WindowNotFound)?;
    // Hidden until it has its background (below): the window-state plugin
    // moves and sizes it meanwhile, and no longer shows it (window_state_flags).
    config.visible = false;
    config.theme = prefs.theme.native();
    // Windows: see-through only with Mica behind it.
    #[cfg(target_os = "windows")]
    {
        config.transparent = frost;
    }
    let see_through = config.transparent;
    SEE_THROUGH.store(see_through, Ordering::Relaxed);
    let win = WebviewWindowBuilder::from_config(app.handle(), &config)?.build()?;
    if frost {
        set_effect(&win, true);
    }
    if !see_through {
        // The theme the window got: the saved choice, or the system's.
        let dark = !matches!(win.theme(), Ok(Theme::Light));
        let _ = win.set_background_color(Some(canvas(dark)));
    }
    if !hidden {
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(win)
}

/// Records the 窗口磨砂 choice for the next start and reports what the window
/// has. macOS lays or removes the frost at once.
#[tauri::command]
pub(crate) fn set_window_frost(app: tauri::AppHandle, on: bool) -> WindowFrost {
    update_prefs(&prefs_path(), |prefs| prefs.frost = on);
    #[cfg(target_os = "macos")]
    if let Some(win) = app.get_webview_window(LABEL) {
        // AppKit wants the main thread; a command may run on another.
        let (done, wait) = std::sync::mpsc::channel();
        let target = win.clone();
        let queued = win.run_on_main_thread(move || {
            set_effect(&target, on);
            let _ = done.send(());
        });
        if queued.is_ok() {
            let _ = wait.recv_timeout(std::time::Duration::from_secs(2));
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = &app;
    WindowFrost {
        supported: frost_supported(),
        effect: effect(),
    }
}

/// Records the theme choice for the next start and gives the window the
/// theme's canvas colour now (`dark`: the theme the page resolved to).
#[tauri::command]
pub(crate) fn set_window_theme(app: tauri::AppHandle, theme: ThemeChoice, dark: bool) {
    update_prefs(&prefs_path(), |prefs| prefs.theme = theme);
    if SEE_THROUGH.load(Ordering::Relaxed) {
        return;
    }
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.set_background_color(Some(canvas(dark)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lynshen-window-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("desktop-window.json")
    }

    #[test]
    fn frost_is_off_and_the_theme_is_the_systems_without_a_file() {
        let prefs = WindowPrefs::read(&temp("missing"));
        assert_eq!(
            prefs,
            WindowPrefs {
                frost: false,
                theme: ThemeChoice::System
            }
        );
        assert_eq!(prefs.theme.native(), None);
    }

    #[test]
    fn choices_round_trip() {
        let path = temp("round-trip");
        update_prefs(&path, |prefs| prefs.frost = true);
        update_prefs(&path, |prefs| prefs.theme = ThemeChoice::Light);
        let prefs = WindowPrefs::read(&path);
        assert!(prefs.frost);
        assert_eq!(prefs.theme, ThemeChoice::Light);
        assert_eq!(prefs.theme.native(), Some(Theme::Light));
        // As the frontend names them.
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"theme\": \"light\""), "{text}");
        update_prefs(&path, |prefs| prefs.frost = false);
        assert_eq!(
            WindowPrefs::read(&path),
            WindowPrefs {
                frost: false,
                theme: ThemeChoice::Light
            }
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn odd_content_counts_as_the_default_field_by_field() {
        let path = temp("odd");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(WindowPrefs::read(&path), WindowPrefs::default());
        // A frost that is not a boolean is off; the theme beside it stays.
        std::fs::write(&path, r#"{"frost":"yes","theme":"dark"}"#).unwrap();
        assert_eq!(
            WindowPrefs::read(&path),
            WindowPrefs {
                frost: false,
                theme: ThemeChoice::Dark
            }
        );
        std::fs::write(&path, r#"{"frost":true,"theme":"sepia"}"#).unwrap();
        assert_eq!(
            WindowPrefs::read(&path),
            WindowPrefs {
                frost: true,
                theme: ThemeChoice::System
            }
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn the_first_record_is_written_even_when_it_is_the_default() {
        // The file then says the frontend has reported at least once.
        let path = temp("first");
        update_prefs(&path, |prefs| prefs.frost = false);
        assert!(path.exists());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn the_canvas_is_each_themes_background() {
        assert_eq!(canvas(true), Color(0x1a, 0x1a, 0x1a, 0xff));
        assert_eq!(canvas(false), Color(0xf6, 0xf5, 0xf2, 0xff));
    }

    #[test]
    fn theme_names_are_the_frontends() {
        for (name, choice) in [
            ("system", ThemeChoice::System),
            ("light", ThemeChoice::Light),
            ("dark", ThemeChoice::Dark),
        ] {
            let parsed: ThemeChoice = serde_json::from_value(serde_json::json!(name)).unwrap();
            assert_eq!(parsed, choice);
        }
        assert!(serde_json::from_value::<ThemeChoice>(serde_json::json!("Light")).is_err());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[test]
    fn linux_offers_no_frost() {
        assert!(!frost_supported());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_offers_vibrancy() {
        assert!(frost_supported());
    }
}
