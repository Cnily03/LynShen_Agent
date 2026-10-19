//! What the page last started the local daemon with: the lynshen backend's
//! binary and environment (Settings → 后端). The app reads it at launch to
//! start the daemon before any window shows. A silent launch at login keeps
//! the window hidden, and the daemon, which holds the connection to
//! app.lynshen.org (远程访问), used to wait for the page (ticket #43).
//!
//! The environment can hold API keys, so the record is sealed with the
//! app's secret key (secrets.rs) in `~/.lynshen/desktop-daemon-launch.json`.

use crate::secrets::SecretStore;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Default, Debug, Clone, PartialEq, Eq)]
pub(crate) struct DaemonLaunch {
    pub bin_override: Option<String>,
    pub env: Vec<(String, String)>,
}

pub(crate) fn path() -> PathBuf {
    crate::lynshen_dir().join("desktop-daemon-launch.json")
}

/// The record, if there is one this app can open and its values still pass
/// the checks `daemon_endpoint` makes.
pub(crate) fn load(path: &Path, store: &SecretStore) -> Option<DaemonLaunch> {
    let file = crate::read_json(path);
    let plain = store.decrypt(file.get("sealed")?.as_str()?).ok()?;
    let launch: DaemonLaunch = serde_json::from_str(&plain).ok()?;
    if let Some(bin) = launch.bin_override.as_deref() {
        crate::backend::validate_bin_override(bin).ok()?;
    }
    let env: serde_json::Map<String, serde_json::Value> = launch
        .env
        .iter()
        .map(|(key, value)| (key.clone(), serde_json::Value::String(value.clone())))
        .collect();
    crate::backend::validate_env(&serde_json::Value::Object(env)).ok()?;
    Some(launch)
}

/// Records `launch` unless the file already holds it.
pub(crate) fn remember(
    path: &Path,
    store: &SecretStore,
    launch: &DaemonLaunch,
) -> Result<(), String> {
    if load(path, store).as_ref() == Some(launch) {
        return Ok(());
    }
    let plain = serde_json::to_string(launch).map_err(|e| e.to_string())?;
    crate::write_json(
        path,
        &serde_json::json!({ "sealed": store.encrypt(&plain)? }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "aogiri-daemon-launch-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn keeps_what_the_page_used_sealed() {
        let dir = dir("roundtrip");
        let store = SecretStore::in_dir(&dir);
        let file = dir.join("launch.json");
        assert_eq!(load(&file, &store), None);
        let launch = DaemonLaunch {
            bin_override: None,
            env: vec![(
                "ANTHROPIC_API_KEY".to_string(),
                "sk-secret-value".to_string(),
            )],
        };
        remember(&file, &store, &launch).unwrap();
        assert_eq!(load(&file, &store), Some(launch.clone()));
        // The key is not in the file as written.
        assert!(!std::fs::read_to_string(&file)
            .unwrap()
            .contains("sk-secret-value"));
        // Unchanged: not written again.
        let before = std::fs::metadata(&file).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        remember(&file, &store, &launch).unwrap();
        assert_eq!(
            std::fs::metadata(&file).unwrap().modified().unwrap(),
            before
        );
        // Changed: written.
        let defaults = DaemonLaunch::default();
        remember(&file, &store, &defaults).unwrap();
        assert_eq!(load(&file, &store), Some(defaults));
    }

    #[test]
    fn ignores_a_record_it_cannot_open_or_trust() {
        let dir = dir("refused");
        let store = SecretStore::in_dir(&dir);
        let file = dir.join("launch.json");
        // Plain JSON instead of a sealed record.
        std::fs::write(&file, r#"{"sealed":"{\"bin_override\":null,\"env\":[]}"}"#).unwrap();
        assert_eq!(load(&file, &store), None);
        // Sealed under another key.
        let other = SecretStore::in_dir(dir.join("other"));
        std::fs::create_dir_all(dir.join("other")).unwrap();
        remember(&file, &other, &DaemonLaunch::default()).unwrap();
        assert_eq!(load(&file, &store), None);
        // Sealed with values daemon_endpoint would refuse.
        let bad = DaemonLaunch {
            bin_override: None,
            env: vec![("LD_PRELOAD".to_string(), "/tmp/x.so".to_string())],
        };
        let plain = serde_json::to_string(&bad).unwrap();
        crate::write_json(
            &file,
            &serde_json::json!({ "sealed": store.encrypt(&plain).unwrap() }),
        )
        .unwrap();
        assert_eq!(load(&file, &store), None);
    }
}
