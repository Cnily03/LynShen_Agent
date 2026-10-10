//! Browser-based LynShen device authorization. Passwords stay on the website.
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// 等价的网关域名，按序容灾（www 连不上就换 api，轮换）。
pub(crate) const BASES: [&str; 2] = ["https://www.lynshen.org", "https://api.lynshen.org"];

/// 一个域名多久连不上就换下一个。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// 上次成功的域名下标（失败切换后更新）。
static BASE_INDEX: AtomicUsize = AtomicUsize::new(0);

fn session_path() -> PathBuf {
    crate::lynshen_dir().join("monoize-session.json")
}

fn http() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout(Duration::from_secs(30))
        .build()
}

/// The domains in the order to try them: the last one that worked first.
fn base_order() -> impl Iterator<Item = usize> {
    let start = BASE_INDEX.load(Ordering::Relaxed);
    (0..BASES.len()).map(move |offset| (start + offset) % BASES.len())
}

/// The first domain whose authorization page loads within CONNECT_TIMEOUT
/// (tried in turn), or the last one that worked when none answers.
fn reachable_base() -> &'static str {
    let probe = ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout(CONNECT_TIMEOUT)
        .build();
    for index in base_order() {
        if probe
            .get(&format!("{}/oauth/authorize", BASES[index]))
            .call()
            .is_ok()
        {
            BASE_INDEX.store(index, Ordering::Relaxed);
            return BASES[index];
        }
    }
    BASES[BASE_INDEX.load(Ordering::Relaxed)]
}

/// 带域名容灾的网关请求。`path` 是完整路径（dashboard 接口带 `/api` 前缀，
/// key 级接口在根下）。网络层失败依次换域名；网关有应答时把响应体里的
/// 错误信息（`message`，或 `error.message`）作为错误返回（登录失败原因等），不再切换。
fn api_call(
    method: &str,
    path: &str,
    bearer: Option<&str>,
    body: Option<Value>,
) -> Result<Value, String> {
    api_call_status(method, path, bearer, body).map_err(|(_, message)| message)
}

/// [`api_call`] that also returns the HTTP status of a gateway error.
fn api_call_status(
    method: &str,
    path: &str,
    bearer: Option<&str>,
    body: Option<Value>,
) -> Result<Value, (Option<u16>, String)> {
    let mut last_network_err = String::new();
    for index in base_order() {
        let mut req = http().request(method, &format!("{}{}", BASES[index], path));
        if let Some(token) = bearer {
            req = req.set("Authorization", &format!("Bearer {token}"));
        }
        let result = match &body {
            Some(payload) => req.send_json(payload.clone()),
            None => req.call(),
        };
        match result {
            Ok(resp) => {
                BASE_INDEX.store(index, Ordering::Relaxed);
                return resp.into_json::<Value>().map_err(|e| (None, e.to_string()));
            }
            Err(ureq::Error::Status(status, resp)) => {
                // 网关有应答（含 401/409 等业务错误）：透出错误信息，不切换域名。
                BASE_INDEX.store(index, Ordering::Relaxed);
                let parsed = resp.into_json::<Value>().ok();
                return Err((
                    Some(status),
                    match &parsed {
                        Some(v) => gateway_error_message(v),
                        None => format!("gateway error {status} via {}", BASES[index]),
                    },
                ));
            }
            Err(e) => {
                last_network_err = format!("{}: {e}", BASES[index]);
            }
        }
    }
    Err((None, format!("all gateways unreachable ({last_network_err})")))
}

/// The readable reason of a gateway error body: `{"message"}` (dashboard
/// routes) or `{"error":{"message"}}` (OpenAI-style routes).
fn gateway_error_message(v: &Value) -> String {
    v["message"]
        .as_str()
        .or_else(|| v["error"]["message"].as_str())
        .or_else(|| v["error"].as_str())
        .map(String::from)
        .unwrap_or_else(|| v.to_string())
}

fn gateway_key() -> Result<String, String> {
    crate::read_auth()
        .get("providers")
        .and_then(|p| p.get("monoize"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "未配置 Monoize API key".to_string())
}

/// key 级接口（/user/balance、/v1/models）：用 auth.json 里存的 monoize key。
pub(crate) fn gateway_key_get(path: &str) -> Result<Value, String> {
    api_call("GET", path, Some(&gateway_key()?), None)
}

/// A request with the desktop's device key (the one this app's sign-in
/// stored); a 401 reads `401 unauthorized: …` so the caller can ask to sign in.
pub(crate) fn gateway_key_send(method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    api_call_status(method, path, Some(&gateway_key()?), body).map_err(|(status, message)| match status {
        Some(401) => format!("401 unauthorized: {message}"),
        _ => message,
    })
}

fn read_session() -> Value {
    crate::read_json(&session_path())
}
fn write_session(session: &Value) -> Result<(), String> {
    crate::write_json(&session_path(), session)?;
    crate::secrets::restrict_to_owner(&session_path());
    Ok(())
}
/// DA-4a: a random id generated once per installation and kept across sign-outs, so the
/// gateway lets this install sign in again in its own device seat.
fn installation_id() -> Option<String> {
    let path = crate::lynshen_dir().join("installation-id");
    let valid = |value: &str| {
        (8..=64).contains(&value.len())
            && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    };
    if let Ok(stored) = std::fs::read_to_string(&path) {
        let stored = stored.trim();
        if valid(stored) {
            return Some(stored.to_string());
        }
    }
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).ok()?;
    let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    std::fs::create_dir_all(crate::lynshen_dir()).ok()?;
    std::fs::write(&path, &id).ok()?;
    Some(id)
}

fn clear_session() {
    let _ = std::fs::remove_file(session_path());
}
fn store_api_key(key: &str) -> Result<(), String> {
    crate::store_provider_key("monoize".to_string(), key.to_string())
}

#[derive(Clone)]
struct Authorization {
    device_code: String,
    user_code: String,
    expires: Instant,
}
fn pending() -> &'static Mutex<Option<Authorization>> {
    static PENDING: OnceLock<Mutex<Option<Authorization>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}

#[tauri::command(async)]
pub fn monoize_oauth_start() -> Result<Value, String> {
    let mut guard = pending().lock().unwrap_or_else(|error| error.into_inner());
    if guard
        .as_ref()
        .is_some_and(|attempt| attempt.expires > Instant::now())
    {
        return Err("An authorization is already in progress".into());
    }
    let response = api_call(
        "POST",
        "/api/desktop/oauth/device",
        None,
        Some(json!({"client_id":"lynshen-desktop"})),
    )?;
    let device_code = response["device_code"]
        .as_str()
        .ok_or("Missing device code")?
        .to_string();
    let user_code = response["user_code"]
        .as_str()
        .ok_or("Missing user code")?
        .to_string();
    if user_code.len() != 12 || !user_code.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid authorization code".into());
    }
    // The page opens on a domain that answers now; the others are offered
    // as alternates in case the browser cannot reach it.
    let base = reachable_base();
    let page = |base: &str| format!("{base}/oauth/authorize?user_code={user_code}");
    let alternates: Vec<String> = BASES.iter().filter(|b| **b != base).map(|b| page(b)).collect();
    *guard = Some(Authorization {
        device_code,
        user_code: user_code.clone(),
        expires: Instant::now() + Duration::from_secs(600),
    });
    Ok(
        json!({"user_code": user_code, "verification_uri_complete": page(base), "alternates": alternates, "interval": 5, "expires_in": 600}),
    )
}

#[tauri::command(async)]
pub fn monoize_oauth_poll(user_code: String) -> Result<Value, String> {
    let attempt = pending()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
        .filter(|attempt| attempt.user_code == user_code)
        .ok_or("Authorization canceled")?;
    if attempt.expires <= Instant::now() {
        return Err("Authorization expired; start again".into());
    }
    let response = api_call(
        "POST",
        "/api/desktop/oauth/token",
        None,
        Some(json!({
            "client_id": "lynshen-desktop",
            "device_code": attempt.device_code,
            "installation_id": installation_id(),
        })),
    )?;
    if let Some(error) = response["error"].as_str() {
        return match error {
            "authorization_pending" | "slow_down" => Ok(json!({"pending": true})),
            "access_denied" => Err("Authorization was declined in the browser".into()),
            _ => Err("Authorization expired; start again".into()),
        };
    }
    let key = response["access_token"]
        .as_str()
        .ok_or("Missing desktop access token")?;
    let mut guard = pending().lock().unwrap_or_else(|error| error.into_inner());
    if !guard
        .as_ref()
        .is_some_and(|active| active.user_code == user_code)
    {
        let _ = api_call(
            "POST",
            "/api/desktop/oauth/revoke",
            Some(key),
            Some(json!({})),
        );
        return Err("Authorization canceled".into());
    }
    let result = store_api_key(key).and_then(|()| {
        write_session(&json!({
            "kind": "device", "key_id": response["key_id"], "user": response["user"],
        }))
    });
    *guard = None;
    if let Err(error) = result {
        let _ = api_call(
            "POST",
            "/api/desktop/oauth/revoke",
            Some(key),
            Some(json!({})),
        );
        return Err(error);
    }
    Ok(json!({"user": response["user"]}))
}

#[tauri::command(async)]
pub fn monoize_oauth_cancel(user_code: String) {
    let attempt = {
        let mut guard = pending().lock().unwrap_or_else(|error| error.into_inner());
        if guard
            .as_ref()
            .is_some_and(|active| active.user_code == user_code)
        {
            guard.take()
        } else {
            None
        }
    };
    if let Some(attempt) = attempt {
        let _ = api_call(
            "POST",
            "/api/desktop/oauth/cancel",
            None,
            Some(json!({"client_id":"lynshen-desktop", "device_code": attempt.device_code})),
        );
    }
}

fn current_session() -> Result<Option<Value>, String> {
    let session = read_session();
    if session["kind"] == "device" {
        return gateway_key_get("/api/desktop/oauth/me").map(Some);
    }
    let Some(token) = session["token"].as_str() else {
        return Ok(None);
    };
    let me = api_call("GET", "/api/dashboard/auth/me", Some(token), None)?;
    Ok(Some(
        json!({"token": token, "user": me.get("user").unwrap_or(&me), "key_id": session["key_id"]}),
    ))
}

#[tauri::command(async)]
pub fn monoize_session() -> Result<Value, String> {
    match current_session()? {
        Some(session) => Ok(json!({"logged_in": true, "session": {"user": session["user"]}})),
        None => Ok(json!({"logged_in": false})),
    }
}

#[tauri::command(async)]
pub fn monoize_logout() -> Result<(), String> {
    let session = read_session();
    if session["kind"] == "device" {
        let auth = crate::read_auth();
        if let Some(key) = auth["providers"]["monoize"].as_str() {
            api_call(
                "POST",
                "/api/desktop/oauth/revoke",
                Some(key),
                Some(json!({})),
            )?;
        }
    } else if let (Some(token), Some(key_id)) =
        (session["token"].as_str(), session["key_id"].as_str())
    {
        api_call(
            "DELETE",
            &format!("/api/dashboard/tokens/{key_id}"),
            Some(token),
            None,
        )?;
    }
    clear_session();
    crate::remove_provider_credential("monoize".to_string())
}

/// 模型广场：登录用户各分组内可调用的模型（服务端过滤）。逐分组拉取并
/// 合并，`groups` 记录模型出现的分组——跨分组同名模型由前端以 `模型@分组`
/// 区分；分组列表随 `groups` 一并返回。
#[tauri::command(async)]
pub fn monoize_marketplace() -> Result<Value, String> {
    let models = gateway_key_get("/api/desktop/oauth/models")?;
    Ok(json!(models["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| {
            model["id"].as_str().map(|id| json!({
            "model_id": id, "groups": model["groups"], "routing_status": model["routing_status"],
            "providers": model["providers"]
        }))
        })
        .collect::<Vec<_>>()))
}
