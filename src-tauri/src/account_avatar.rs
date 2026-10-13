//! The LynShen account's avatar in the app (gateway `desktop-authorization.spec.md`
//! DA-12). `/api/desktop/oauth/me` names the account's current avatar in
//! `user.avatar_url`; the app downloads the picture with the device key once per
//! avatar and keeps it in `~/.lynshen/account-avatar.json` beside the user's id, so it
//! shows offline and at the next start. A change made here is uploaded with the same
//! key and becomes the avatar on the website too. Signing out deletes the file.
use base64::Engine as _;
use serde_json::{json, Value};
use std::path::PathBuf;

/// AV-11: the largest avatar the gateway accepts. It serves 256 × 256 WebP, far smaller.
const MAX_BYTES: usize = 1_048_576;
/// DA-12: where the gateway serves the device key owner's avatar.
const AVATAR_PATH: &str = "/api/desktop/oauth/avatars/";

fn cache_path() -> PathBuf {
    crate::lynshen_dir().join("account-avatar.json")
}

/// The image type from the leading bytes (the gateway's AV-12 signatures).
fn image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn data_url(bytes: &[u8]) -> Option<String> {
    let kind = image_type(bytes)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{kind};base64,{encoded}"))
}

/// Only the DA-12 address with a plain id: the webview passes `url` in, and the
/// device key must not be sent to any other path.
fn valid_avatar_url(url: &str) -> bool {
    url.strip_prefix(AVATAR_PATH).is_some_and(|id| {
        (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    })
}

/// The cached avatar when it is `user_id`'s: `(url, data URL)`.
fn cached_for(cache: &Value, user_id: &str) -> Option<(String, String)> {
    if cache["user_id"].as_str() != Some(user_id) {
        return None;
    }
    let url = cache["url"].as_str()?;
    let data = cache["data_url"].as_str()?;
    Some((url.to_string(), data.to_string()))
}

fn store(user_id: &str, url: &str, data: &str) -> Result<(), String> {
    crate::write_json(
        &cache_path(),
        &json!({ "user_id": user_id, "url": url, "data_url": data }),
    )
}

/// Deletes the cached avatar (signing out, or the account has none any more).
pub(crate) fn forget() {
    let _ = std::fs::remove_file(cache_path());
}

/// An error as [`crate::monoize_auth::gateway_key_bytes`] reports one, for a check
/// made here before any request.
fn refusal(code: &str, message: &str) -> String {
    json!({ "status": null, "code": code, "message": message, "param": null }).to_string()
}

/// One `file` part, as the gateway's AV-10 asks: `(body, content type)`.
fn multipart(bytes: &[u8], kind: &str) -> (Vec<u8>, String) {
    let mut random = [0u8; 12];
    let _ = getrandom::getrandom(&mut random);
    let boundary: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let boundary = format!("aogiri-avatar-{boundary}");
    let extension = match kind {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        _ => "webp",
    };
    let mut body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"avatar.{extension}\"\r\nContent-Type: {kind}\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (body, format!("multipart/form-data; boundary={boundary}"))
}

/// Downloads the avatar at `url` with the device key: its data URL.
fn download(url: &str) -> Result<String, String> {
    let (_, bytes) =
        crate::monoize_auth::gateway_key_bytes("GET", url, None, None, MAX_BYTES as u64)?;
    data_url(&bytes).ok_or_else(|| {
        refusal(
            "avatar_invalid_image",
            "the gateway's avatar is not an image",
        )
    })
}

/// The signed-in account's cached avatar, without asking the gateway:
/// `{"url", "data_url"}`, or null.
#[tauri::command(async)]
pub fn monoize_avatar_cached() -> Option<Value> {
    let user = crate::monoize_auth::session_user_id()?;
    let (url, data_url) = cached_for(&crate::read_json(&cache_path()), &user)?;
    Some(json!({ "url": url, "data_url": data_url }))
}

/// Brings the cache to the avatar the gateway names (`avatar_url` of
/// `/api/desktop/oauth/me`): null deletes it, a new address downloads it. Answers
/// the data URL to show, or null for none.
#[tauri::command(async)]
pub fn monoize_avatar_sync(url: Option<String>) -> Result<Option<String>, String> {
    let Some(user) = crate::monoize_auth::session_user_id() else {
        return Ok(None);
    };
    let Some(url) = url else {
        forget();
        return Ok(None);
    };
    if !valid_avatar_url(&url) {
        return Err(refusal("invalid_request", "not an avatar address"));
    }
    if let Some((cached, data)) = cached_for(&crate::read_json(&cache_path()), &user) {
        if cached == url {
            return Ok(Some(data));
        }
    }
    let data = download(&url)?;
    store(&user, &url, &data)?;
    Ok(Some(data))
}

/// Sets the account's avatar (`PUT /api/desktop/oauth/avatar`). `image` is the
/// picture in base64: PNG, JPEG or WebP, at most 1 MiB (the app sends a 256 × 256
/// WebP). Answers `{"user": <profile>, "data_url"}`; the data URL is the gateway's
/// re-encoding, or the upload itself when that cannot be read now. Errors are
/// JSON `{"status", "code", "message", "param"}` (`avatar_rate_limited` carries
/// the seconds to wait in `param`).
#[tauri::command(async)]
pub fn monoize_avatar_upload(image: String) -> Result<Value, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(image.as_bytes())
        .map_err(|_| refusal("avatar_invalid_image", "the image is not base64"))?;
    if bytes.len() > MAX_BYTES {
        return Err(refusal(
            "avatar_too_large",
            "the avatar file must not exceed 1048576 bytes",
        ));
    }
    let kind = image_type(&bytes).ok_or_else(|| {
        refusal(
            "avatar_unsupported_type",
            "the avatar must be a PNG, JPEG, or WebP image",
        )
    })?;
    let (body, content_type) = multipart(&bytes, kind);
    let (_, answer) = crate::monoize_auth::gateway_key_bytes(
        "PUT",
        "/api/desktop/oauth/avatar",
        Some(&content_type),
        Some(&body),
        64 * 1024,
    )?;
    let reply: Value =
        serde_json::from_slice(&answer).map_err(|e| refusal("internal_error", &e.to_string()))?;
    let url = reply["user"]["avatar_url"]
        .as_str()
        .filter(|url| valid_avatar_url(url));
    let uploaded = data_url(&bytes).unwrap_or_default();
    let data = url.and_then(|url| download(url).ok()).unwrap_or(uploaded);
    if let (Some(user), Some(url)) = (crate::monoize_auth::session_user_id(), url) {
        store(&user, url, &data)?;
    }
    Ok(json!({ "user": reply["user"], "data_url": data }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const WEBP: &[u8] = b"RIFF\x24\0\0\0WEBPVP8 ";

    #[test]
    fn only_the_device_avatar_path_with_a_plain_id_is_fetched() {
        assert!(valid_avatar_url(
            "/api/desktop/oauth/avatars/0b7c41e2-9a1d-4c55-8f0e-2d1a3b4c5d6e"
        ));
        assert!(!valid_avatar_url("/api/dashboard/avatars/0b7c41e2"));
        assert!(!valid_avatar_url("/api/desktop/oauth/avatars/"));
        assert!(!valid_avatar_url("/api/desktop/oauth/avatars/../me"));
        assert!(!valid_avatar_url("/api/desktop/oauth/avatars/a?b=c"));
        assert!(!valid_avatar_url(
            "https://evil.example/api/desktop/oauth/avatars/abc"
        ));
    }

    #[test]
    fn images_are_told_apart_by_their_signature() {
        assert_eq!(image_type(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(image_type(b"\xff\xd8\xff\xe0"), Some("image/jpeg"));
        assert_eq!(image_type(WEBP), Some("image/webp"));
        assert_eq!(image_type(b"GIF89a"), None);
        assert_eq!(image_type(b"<svg/>"), None);
        assert!(data_url(WEBP)
            .unwrap()
            .starts_with("data:image/webp;base64,UklGR"));
    }

    #[test]
    fn the_cache_belongs_to_one_user() {
        let cache = json!({ "user_id": "u1", "url": "/api/desktop/oauth/avatars/a1", "data_url": "data:image/webp;base64,AA" });
        assert_eq!(
            cached_for(&cache, "u1"),
            Some((
                "/api/desktop/oauth/avatars/a1".into(),
                "data:image/webp;base64,AA".into()
            ))
        );
        assert_eq!(cached_for(&cache, "u2"), None);
        assert_eq!(cached_for(&json!({}), "u1"), None);
    }

    #[test]
    fn the_upload_is_one_file_part() {
        let (body, content_type) = multipart(WEBP, "image/webp");
        let boundary = content_type
            .strip_prefix("multipart/form-data; boundary=")
            .unwrap();
        let text = String::from_utf8_lossy(&body);
        assert!(text.starts_with(&format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"avatar.webp\"\r\nContent-Type: image/webp\r\n\r\n")));
        assert!(text.ends_with(&format!("\r\n--{boundary}--\r\n")));
        assert_eq!(text.matches("name=\"file\"").count(), 1);
        assert!(body.windows(WEBP.len()).any(|w| w == WEBP));
    }
}
