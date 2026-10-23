//! Signed updates from LynShen/Monoize, with configured fallback endpoints.

use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const CHECK_TIMEOUT: Duration = Duration::from_secs(10);
/// How long one source of `features.json` may take to connect, then to answer.
const FEATURES_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, PartialEq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Github,
    LynShen,
}

/// The update found by the last check, for `update_install`.
#[derive(Default)]
pub struct Pending {
    found: Mutex<Option<(Update, Source, String)>>,
    downloaded: Mutex<Option<(Update, Vec<u8>)>>,
}

#[derive(Serialize)]
pub struct Found {
    version: String,
    notes: Option<String>,
    source: Source,
}

/// Download progress, in the shape of the updater plugin's JS events.
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

/// The LynShen server's mirror of the desktop manifest, on the API the user's
/// config names (regional domains differ).
fn lynshen_manifest() -> String {
    let config = crate::read_json(&crate::lynshen_dir().join("config.json"));
    let base = config["desktop_update_url"]
        .as_str()
        .filter(|url| !url.trim().is_empty())
        .map(|url| url.trim().trim_end_matches('/').to_owned())
        .unwrap_or_else(api_base);
    format!("{base}/v1/public/releases/desktop/latest.json")
}

/// The LynShen API this app talks to without a login (`lynshen_api_url` in
/// config.json; regional domains differ).
pub fn api_base() -> String {
    let api = crate::read_json(&crate::lynshen_dir().join("config.json"))["lynshen_api_url"]
        .as_str()
        .map(str::to_string)
        .filter(|api| !api.trim().is_empty())
        .unwrap_or_else(|| crate::monoize_auth::BASES[0].to_string());
    api.trim().trim_end_matches('/').to_string()
}

fn manifests(app: &AppHandle) -> Vec<(String, Source)> {
    let mut sources = vec![(lynshen_manifest(), Source::LynShen)];
    if let Some(urls) = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config["endpoints"].as_array())
    {
        for url in urls.iter().filter_map(|url| url.as_str()) {
            if !sources.iter().any(|(existing, _)| existing == url) {
                let source = if url.starts_with("https://github.com/") {
                    Source::Github
                } else {
                    Source::LynShen
                };
                sources.push((url.to_owned(), source));
            }
        }
    }
    sources
}

async fn check_at(app: &AppHandle, manifest: &str) -> Result<Option<Update>, String> {
    let url = manifest.parse().map_err(|e| format!("{manifest}: {e}"))?;
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())
}

/// A healthy primary is authoritative; an unavailable primary falls back.
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    pending: State<'_, Pending>,
) -> Result<Option<Found>, String> {
    *pending.found.lock().unwrap_or_else(|e| e.into_inner()) = None;
    let mut errors = Vec::new();
    let mut found = None;
    for (manifest, source) in manifests(&app) {
        match check_at(&app, &manifest).await {
            Ok(update) => {
                found = update.map(|update| (update, source, manifest));
                errors.clear();
                break;
            }
            Err(error) => errors.push(format!("{manifest}: {error}")),
        }
    }
    if !errors.is_empty() {
        return Err(errors.join("; "));
    }
    let result = found.as_ref().map(|(update, source, _)| Found {
        version: update.version.clone(),
        notes: update.body.clone(),
        source: *source,
    });
    *pending.found.lock().unwrap_or_else(|e| e.into_inner()) = found;
    Ok(result)
}

async fn download(update: &Update, on_event: &Channel<DownloadEvent>) -> Result<Vec<u8>, String> {
    let mut started = false;
    update
        .download(
            |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = on_event.send(DownloadEvent::Started { content_length });
                }
                let _ = on_event.send(DownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(DownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| e.to_string())
}

/// The lowest version the LynShen server still accepts ("" when it names
/// none or cannot be reached: an unreachable server never locks the app).
#[tauri::command]
pub async fn update_policy() -> String {
    let manifest = lynshen_manifest();
    let url = manifest.replace("/latest.json", "/policy");
    tauri::async_runtime::spawn_blocking(move || {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout_read(Duration::from_secs(5))
            .build()
            .get(&url)
            .call()
            .ok()
            .and_then(|response| response.into_json::<serde_json::Value>().ok())
            .and_then(|policy| policy["min_version"].as_str().map(str::to_string))
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}

/// The LynShen update feeds (`…/latest.json`), in the order update checks try
/// them; GitHub's is left out. The product owner's `features.json` sits next
/// to each (the frontend derives its URL like `/policy` above).
#[tauri::command]
pub async fn update_feeds(app: AppHandle) -> Vec<String> {
    manifests(&app)
        .into_iter()
        .filter(|(_, source)| *source == Source::LynShen)
        .map(|(manifest, _)| manifest)
        .collect()
}

/// A URL `feature_flags` may read: http(s), a `features.json`.
fn features_url(url: &str) -> bool {
    (url.starts_with("https://") || url.starts_with("http://")) && url.ends_with("/features.json")
}

/// The product owner's switches for Beta features (`{"team_v2": true}`): the
/// first of `urls` that answers with a JSON object, each within
/// FEATURES_TIMEOUT. None when none does (missing file, offline): the app
/// keeps what it knew.
#[tauri::command]
pub async fn feature_flags(urls: Vec<String>) -> Option<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(FEATURES_TIMEOUT)
            .timeout_read(FEATURES_TIMEOUT)
            .build();
        urls.iter().filter(|url| features_url(url)).find_map(|url| {
            agent
                .get(url)
                .call()
                .ok()?
                .into_json::<serde_json::Value>()
                .ok()
                .filter(serde_json::Value::is_object)
        })
    })
    .await
    .ok()
    .flatten()
}

/// Retry failed downloads from a different source at the exact same version.
/// Installation errors must not launch another installer.
#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    pending: State<'_, Pending>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let (update, _source, manifest) = pending
        .found
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .ok_or("no update to install")?;
    let mut errors = Vec::new();
    match download(&update, &on_event).await {
        Ok(bytes) => {
            *pending.downloaded.lock().unwrap_or_else(|e| e.into_inner()) = Some((update, bytes));
            return Ok(());
        }
        Err(error) => errors.push(error),
    }
    for (fallback, _) in manifests(&app) {
        if fallback == manifest {
            continue;
        }
        match check_at(&app, &fallback).await {
            Ok(Some(other)) if other.version == update.version => {
                match download(&other, &on_event).await {
                    Ok(bytes) => {
                        *pending.downloaded.lock().unwrap_or_else(|e| e.into_inner()) =
                            Some((other, bytes));
                        return Ok(());
                    }
                    Err(error) => errors.push(error),
                }
            }
            Err(error) => errors.push(error),
            _ => {}
        }
    }
    Err(errors.join("; "))
}

/// Windows installation exits the running process. Only apply after the user
/// requests a restart and the frontend has flushed its unsaved workspace state.
/// The window's size and position go to disk here too: that exit skips the
/// window-state plugin's own save (window_state.rs, ticket #58).
#[tauri::command]
pub async fn update_apply(app: AppHandle, pending: State<'_, Pending>) -> Result<(), String> {
    let downloaded = pending.downloaded.lock().unwrap_or_else(|e| e.into_inner());
    let (update, bytes) = downloaded.as_ref().ok_or("no downloaded update to apply")?;
    crate::window_state::save_and_wait(&app, "update");
    update.install(bytes).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_matches_the_plugin_events() {
        let started = serde_json::to_value(DownloadEvent::Started {
            content_length: Some(9),
        })
        .unwrap();
        assert_eq!(
            started,
            serde_json::json!({ "event": "Started", "data": { "contentLength": 9 } })
        );
        let chunk = serde_json::to_value(DownloadEvent::Progress { chunk_length: 3 }).unwrap();
        assert_eq!(
            chunk,
            serde_json::json!({ "event": "Progress", "data": { "chunkLength": 3 } })
        );
        assert_eq!(
            serde_json::to_value(DownloadEvent::Finished).unwrap(),
            serde_json::json!({ "event": "Finished" })
        );
    }

    #[test]
    fn the_mirror_manifest_is_under_the_public_api() {
        assert!(lynshen_manifest().ends_with("/v1/public/releases/desktop/latest.json"));
    }

    #[test]
    fn feature_flags_read_only_a_features_json() {
        assert!(features_url(
            "https://www.lynshen.org/v1/public/releases/desktop/features.json"
        ));
        assert!(features_url("http://127.0.0.1:8080/features.json"));
        assert!(!features_url(
            "https://www.lynshen.org/v1/public/releases/desktop/latest.json"
        ));
        assert!(!features_url("file:///etc/features.json"));
        assert!(!features_url("https://example.com/features.json?x=1"));
    }

    #[test]
    fn feature_flags_without_a_source_is_none() {
        let flags = tauri::async_runtime::block_on(feature_flags(vec![
            "file:///features.json".to_string(),
            "https://www.lynshen.org/v1/public/releases/desktop/latest.json".to_string(),
        ]));
        assert_eq!(flags, None);
    }
}
