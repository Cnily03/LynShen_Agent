//! 开机自动启动（设置 → 通用 → 启动）。登录项本身由 tauri-plugin-autostart 管理：
//! macOS 写 ~/Library/LaunchAgents 下的 LaunchAgent，Windows 写注册表 Run 键，
//! Linux 写 ~/.config/autostart 下的 .desktop 文件。登录项带固定参数 `--autostart`
//! 启动应用；启动方式（显示窗口 / 静默留在托盘）存在 ~/.lynshen/desktop-autostart.json。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{plugin::TauriPlugin, AppHandle, Runtime};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/// 登录项启动应用时带的参数。
pub(crate) const ARG: &str = "--autostart";

/// 设置页读写的状态：登录项是否已注册，以及是否静默启动。
#[derive(Serialize, Deserialize, Default, Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Autostart {
    pub enabled: bool,
    pub silent: bool,
}

/// desktop-autostart.json 的内容。
#[derive(Deserialize, Default)]
struct Saved {
    #[serde(default)]
    silent: bool,
}

fn prefs_path() -> PathBuf {
    crate::lynshen_dir().join("desktop-autostart.json")
}

/// 文件不存在或无法解析时按「显示窗口」处理。
fn read_silent(path: &Path) -> bool {
    serde_json::from_value::<Saved>(crate::read_json(path))
        .map(|saved| saved.silent)
        .unwrap_or(false)
}

fn write_silent(path: &Path, silent: bool) -> Result<(), String> {
    crate::write_json(path, &serde_json::json!({ "silent": silent }))
}

/// 进程参数里有 `--autostart`：这次是登录项启动的。
fn launched_at_login<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|arg| arg.as_ref() == ARG)
}

/// 登录项启动，且启动方式是静默：主窗口不显示，应用只在托盘里。
pub(crate) fn silent_launch() -> bool {
    launched_at_login(std::env::args()) && read_silent(&prefs_path())
}

/// 第二个实例的参数来自登录项：已在运行的实例不需要弹出窗口。
pub(crate) fn from_login_item(argv: &[String]) -> bool {
    launched_at_login(argv)
}

/// 自启插件：macOS 用 LaunchAgent（AppleScript 登录项不传参数）。
pub(crate) fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![ARG]))
}

#[tauri::command]
pub(crate) async fn autostart_get(app: AppHandle) -> Result<Autostart, String> {
    let enabled = app.autolaunch().is_enabled().map_err(|e| e.to_string())?;
    Ok(Autostart {
        enabled,
        silent: read_silent(&prefs_path()),
    })
}

/// 注册或移除登录项，再保存启动方式；返回系统里的实际状态。
#[tauri::command]
pub(crate) async fn autostart_set(
    app: AppHandle,
    enabled: bool,
    silent: bool,
) -> Result<Autostart, String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|e| e.to_string())?;
    write_silent(&prefs_path(), silent)?;
    let enabled = manager.is_enabled().map_err(|e| e.to_string())?;
    Ok(Autostart { enabled, silent })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_item_argument_is_detected() {
        assert!(launched_at_login([
            "/Applications/LynShen.app/Contents/MacOS/LynShen",
            "--autostart"
        ]));
        assert!(!launched_at_login(["LynShen"]));
        assert!(!launched_at_login([
            "LynShen",
            "lynshen://open",
            "--autostart=1"
        ]));
        assert!(from_login_item(&["LynShen".into(), ARG.into()]));
        assert!(!from_login_item(&[
            "LynShen".into(),
            "lynshen://auth".into()
        ]));
    }

    #[test]
    fn silent_choice_round_trips_and_defaults_to_window() {
        let dir = std::env::temp_dir().join(format!("lynshen-autostart-{}", std::process::id()));
        let path = dir.join("desktop-autostart.json");
        let _ = std::fs::remove_dir_all(&dir);
        // Missing file: show the window.
        assert!(!read_silent(&path));
        write_silent(&path, true).unwrap();
        assert!(read_silent(&path));
        write_silent(&path, false).unwrap();
        assert!(!read_silent(&path));
        // Unreadable or odd content: show the window.
        std::fs::write(&path, "not json").unwrap();
        assert!(!read_silent(&path));
        std::fs::write(&path, r#"{"silent":"yes"}"#).unwrap();
        assert!(!read_silent(&path));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn state_serializes_for_the_frontend() {
        let json = serde_json::to_value(Autostart {
            enabled: true,
            silent: false,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "enabled": true, "silent": false })
        );
    }
}
