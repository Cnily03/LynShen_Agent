//! Browser-based LynShen device authorization. Passwords stay on the website.
use serde_json::{json, Value};
use std::io::Read;
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
    api_call_status(method, path, bearer, body).map_err(|failure| failure.message)
}

/// A gateway call that failed: the HTTP status when the gateway answered, its
/// readable reason, and its error code (`{"error":{"code"}}`) when it sent one.
struct CallFailure {
    status: Option<u16>,
    message: String,
    code: Option<String>,
}

/// [`api_call`] that also returns the HTTP status of a gateway error.
fn api_call_status(
    method: &str,
    path: &str,
    bearer: Option<&str>,
    body: Option<Value>,
) -> Result<Value, CallFailure> {
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
                return resp.into_json::<Value>().map_err(|e| CallFailure {
                    status: None,
                    message: e.to_string(),
                    code: None,
                });
            }
            Err(ureq::Error::Status(status, resp)) => {
                // 网关有应答（含 401/409 等业务错误）：透出错误信息，不切换域名。
                BASE_INDEX.store(index, Ordering::Relaxed);
                let parsed = resp.into_json::<Value>().ok();
                return Err(CallFailure {
                    status: Some(status),
                    message: match &parsed {
                        Some(v) => gateway_error_message(v),
                        None => format!("gateway error {status} via {}", BASES[index]),
                    },
                    code: parsed
                        .as_ref()
                        .and_then(|v| v["error"]["code"].as_str().or_else(|| v["code"].as_str()))
                        .map(String::from),
                });
            }
            Err(e) => {
                last_network_err = format!("{}: {e}", BASES[index]);
            }
        }
    }
    Err(CallFailure {
        status: None,
        message: format!("all gateways unreachable ({last_network_err})"),
        code: None,
    })
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
    api_call_status(method, path, Some(&gateway_key()?), body).map_err(|failure| match failure.status {
        Some(401) => format!("401 unauthorized: {}", failure.message),
        _ => failure.message,
    })
}

/// [`gateway_key_send`] whose error is JSON `{"status", "code", "message"}`,
/// so a page can tell the gateway's reasons apart (`insufficient_balance`,
/// `email_unverified`, `invite_code_invalid`…). Without a device key the
/// code is `not_signed_in`.
pub(crate) fn gateway_key_call(method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    let key = gateway_key().map_err(|message| json!({ "status": null, "code": "not_signed_in", "message": message }).to_string())?;
    api_call_status(method, path, Some(&key), body).map_err(|failure| {
        json!({ "status": failure.status, "code": failure.code, "message": failure.message }).to_string()
    })
}

/// The JSON error of [`gateway_key_bytes`].
fn key_failure(
    status: Option<u16>,
    code: Option<&str>,
    message: &str,
    param: Option<&str>,
) -> String {
    json!({ "status": status, "code": code, "message": message, "param": param }).to_string()
}

/// A device-key request with a raw body (`content_type`, `body`) whose answer is
/// read as bytes, at most `max_bytes`: `(content type, body)`. Domains fail over
/// as in [`api_call_status`]. An error is [`gateway_key_call`]'s JSON plus the
/// gateway's `param` (e.g. the seconds of `avatar_rate_limited`).
pub(crate) fn gateway_key_bytes(
    method: &str,
    path: &str,
    content_type: Option<&str>,
    body: Option<&[u8]>,
    max_bytes: u64,
) -> Result<(String, Vec<u8>), String> {
    let key = gateway_key()
        .map_err(|message| key_failure(None, Some("not_signed_in"), &message, None))?;
    let mut last_network_err = String::new();
    for index in base_order() {
        let mut req = http()
            .request(method, &format!("{}{}", BASES[index], path))
            .set("Authorization", &format!("Bearer {key}"));
        if let Some(kind) = content_type {
            req = req.set("Content-Type", kind);
        }
        let result = match body {
            Some(bytes) => req.send_bytes(bytes),
            None => req.call(),
        };
        match result {
            Ok(resp) => {
                BASE_INDEX.store(index, Ordering::Relaxed);
                let kind = resp.content_type().to_string();
                let mut bytes = Vec::new();
                resp.into_reader()
                    .take(max_bytes + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|e| key_failure(None, None, &e.to_string(), None))?;
                if bytes.len() as u64 > max_bytes {
                    return Err(key_failure(
                        None,
                        Some("too_large"),
                        "the gateway's answer is too large",
                        None,
                    ));
                }
                return Ok((kind, bytes));
            }
            Err(ureq::Error::Status(status, resp)) => {
                BASE_INDEX.store(index, Ordering::Relaxed);
                let parsed = resp.into_json::<Value>().ok();
                let message = match &parsed {
                    Some(v) => gateway_error_message(v),
                    None => format!("gateway error {status} via {}", BASES[index]),
                };
                let code = parsed
                    .as_ref()
                    .and_then(|v| v["error"]["code"].as_str().or_else(|| v["code"].as_str()));
                let param = parsed.as_ref().and_then(|v| v["error"]["param"].as_str());
                return Err(key_failure(Some(status), code, &message, param));
            }
            Err(e) => last_network_err = format!("{}: {e}", BASES[index]),
        }
    }
    Err(key_failure(
        None,
        None,
        &format!("all gateways unreachable ({last_network_err})"),
        None,
    ))
}

fn read_session() -> Value {
    crate::read_json(&session_path())
}
/// The signed-in account's user id, from the session written at sign-in.
pub(crate) fn session_user_id() -> Option<String> {
    read_session()["user"]["id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .map(String::from)
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

/// The device authorisation's token request: the device code, this
/// installation's id and, when the machine id could be read, the device hash
/// (`device_id.rs`; left out otherwise, and old gateways ignore it).
fn token_request(device_code: &str, installation: Option<String>, device_hash: Option<String>) -> Value {
    let mut body = json!({
        "client_id": "lynshen-desktop",
        "device_code": device_code,
        "installation_id": installation,
    });
    if let Some(hash) = device_hash {
        body["device_hash"] = json!(hash);
    }
    body
}

/// The trial claim's body: this installation's id and, when there is one, the
/// device hash.
fn trial_claim_request(installation: &str, device_hash: Option<String>) -> Value {
    let mut body = json!({ "installation_id": installation });
    if let Some(hash) = device_hash {
        body["device_hash"] = json!(hash);
    }
    body
}

/// This installation's id (DA-4a), which the app keys its trial claim by.
#[tauri::command(async)]
pub fn desktop_installation_id() -> Option<String> {
    installation_id()
}

/// Claims the first-use trial plan (`POST /api/dashboard/trial/claim` with
/// the device key). The gateway decides who gets it; the answer is its body
/// (`granted`, `already_granted`, `not_eligible`, `disabled`). A refusal is
/// [`gateway_key_call`]'s JSON error: a 404 is a gateway without the
/// endpoint, a status of null a network failure. The app calls it once per
/// installation and account (src/lib/trial.ts).
#[tauri::command(async)]
pub fn monoize_trial_claim() -> Result<Value, String> {
    let installation = installation_id().ok_or_else(|| {
        json!({ "status": null, "code": "no_installation_id", "message": "no installation id" }).to_string()
    })?;
    gateway_key_call(
        "POST",
        "/api/dashboard/trial/claim",
        Some(trial_claim_request(&installation, crate::device_id::device_hash())),
    )
}

/// The account's desktop plan in force (trial or paid; null without one) and
/// this device key's funding choice (`GET /api/desktop/oauth/plan`). Errors
/// as [`gateway_key_call`]'s (a 404: a gateway without the endpoint).
#[tauri::command(async)]
pub fn monoize_desktop_plan() -> Result<Value, String> {
    gateway_key_call("GET", "/api/desktop/oauth/plan", None)
}

/// The models this device key can use, with names, vendors, versions,
/// health, prices and plan coverage (`GET /api/desktop/models/catalog`,
/// gateway contract MC-API). Errors as [`gateway_key_call`]'s (a 404: a
/// gateway without the catalog; the app then reads the plain model list).
#[tauri::command(async)]
pub fn monoize_model_catalog() -> Result<Value, String> {
    gateway_key_call("GET", "/api/desktop/models/catalog", None)
}

/// The body of `PUT /api/desktop/oauth/plan`: `plan` or `balance` only.
fn plan_funding_request(funding: &str) -> Option<Value> {
    matches!(funding, "plan" | "balance").then(|| json!({ "plan_funding": funding }))
}

/// Sets who pays this device key's requests in the plan's groups: `plan`
/// (the default) or `balance` (`PUT /api/desktop/oauth/plan`). Answers the
/// same body as [`monoize_desktop_plan`]; it applies from the next request.
#[tauri::command(async)]
pub fn monoize_set_plan_funding(funding: String) -> Result<Value, String> {
    let body = plan_funding_request(&funding).ok_or_else(|| {
        json!({ "status": null, "code": "invalid_request", "message": "plan_funding must be plan or balance" }).to_string()
    })?;
    gateway_key_call("PUT", "/api/desktop/oauth/plan", Some(body))
}

/// An order id the app puts in a path: letters, digits and `-` only, so it
/// cannot change the path it is put in.
fn store_order_id(id: &str) -> Result<&str, String> {
    if !id.is_empty() && id.len() <= 128 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        Ok(id)
    } else {
        Err(json!({ "status": null, "code": "invalid_request", "message": "invalid order id" }).to_string())
    }
}

/// The body of `POST /api/desktop/oauth/store/orders` (gateway DP-O1).
fn store_order_request(product_id: &str, channel_id: &str, custom_minor: Option<&str>, request_id: &str) -> Value {
    let mut body = json!({
        "product_id": product_id,
        "payment_channel_id": channel_id,
        "request_id": request_id,
    });
    if let Some(minor) = custom_minor {
        body["custom_recharge_minor"] = json!(minor);
    }
    body
}

/// The body of `POST /api/desktop/oauth/store/orders/{id}/attempts` (DP-A1).
fn store_attempt_request(method: Option<&str>, request_id: &str) -> Value {
    let mut body = json!({ "request_id": request_id });
    if let Some(method) = method {
        body["payment_method"] = json!(method);
    }
    body
}

/// What this device key can buy: plans and balance packs with prices in CNY
/// fen, the ways to pay, and the custom top-up range
/// (`GET /api/desktop/oauth/store/catalog`). Errors as [`gateway_key_call`]'s
/// (a 404: a gateway that does not sell to the app yet).
#[tauri::command(async)]
pub fn monoize_store_catalog() -> Result<Value, String> {
    gateway_key_call("GET", "/api/desktop/oauth/store/catalog", None)
}

/// The account's recent orders, newest first (`GET /api/desktop/oauth/store/orders`).
#[tauri::command(async)]
pub fn monoize_store_orders(limit: u32) -> Result<Value, String> {
    gateway_key_call(
        "GET",
        &format!("/api/desktop/oauth/store/orders?limit={}", limit.clamp(1, 50)),
        None,
    )
}

/// Creates an order for a product (`POST /api/desktop/oauth/store/orders`);
/// the same `request_id` returns the same order, so a retry cannot buy twice.
#[tauri::command(async)]
pub fn monoize_store_order(
    product_id: String,
    channel_id: String,
    custom_minor: Option<String>,
    request_id: String,
) -> Result<Value, String> {
    gateway_key_call(
        "POST",
        "/api/desktop/oauth/store/orders",
        Some(store_order_request(&product_id, &channel_id, custom_minor.as_deref(), &request_id)),
    )
}

/// Starts paying an order: the answer holds a QR code to show or a payment
/// page to open (`POST /api/desktop/oauth/store/orders/{id}/attempts`).
#[tauri::command(async)]
pub fn monoize_store_pay(order_id: String, method: Option<String>, request_id: String) -> Result<Value, String> {
    let id = store_order_id(&order_id)?;
    gateway_key_call(
        "POST",
        &format!("/api/desktop/oauth/store/orders/{id}/attempts"),
        Some(store_attempt_request(method.as_deref(), &request_id)),
    )
}

/// The order as it stands; the gateway asks the payment provider while it is
/// unpaid (`POST /api/desktop/oauth/store/orders/{id}/query`).
#[tauri::command(async)]
pub fn monoize_store_query(order_id: String) -> Result<Value, String> {
    let id = store_order_id(&order_id)?;
    gateway_key_call("POST", &format!("/api/desktop/oauth/store/orders/{id}/query"), None)
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
        Some(token_request(
            &attempt.device_code,
            installation_id(),
            crate::device_id::device_hash(),
        )),
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
    crate::account_avatar::forget();
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

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "24401ae4dace2b94ffa466898373967a78f2b066a98891c8f94b41590cef7cdd";

    #[test]
    fn the_token_request_carries_the_device_hash_when_there_is_one() {
        let body = token_request("dc-1", Some("inst-1".into()), Some(HASH.into()));
        assert_eq!(
            body,
            json!({
                "client_id": "lynshen-desktop",
                "device_code": "dc-1",
                "installation_id": "inst-1",
                "device_hash": HASH,
            })
        );
    }

    #[test]
    fn the_token_request_leaves_out_a_missing_device_hash() {
        let body = token_request("dc-1", Some("inst-1".into()), None);
        assert!(body.get("device_hash").is_none());
        assert_eq!(body["installation_id"], "inst-1");
    }

    #[test]
    fn store_requests_carry_only_what_was_chosen() {
        assert_eq!(
            store_order_request("p1", "store-channel-epay", None, "req-1"),
            json!({ "product_id": "p1", "payment_channel_id": "store-channel-epay", "request_id": "req-1" })
        );
        assert_eq!(
            store_order_request("p1", "c1", Some("2345"), "req-2")["custom_recharge_minor"],
            "2345"
        );
        assert_eq!(
            store_attempt_request(Some("wxpay"), "req-3"),
            json!({ "request_id": "req-3", "payment_method": "wxpay" })
        );
        assert!(store_attempt_request(None, "req-4").get("payment_method").is_none());
    }

    #[test]
    fn an_order_id_cannot_change_the_path() {
        assert_eq!(store_order_id("6f1d2c3e-aaaa-4bbb-8ccc-0123456789ab"), Ok("6f1d2c3e-aaaa-4bbb-8ccc-0123456789ab"));
        let long = "x".repeat(129);
        for bad in ["", "../plan", "a/b", "a?b=1", "a b", long.as_str()] {
            assert!(store_order_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_funding_choice_is_plan_or_balance() {
        assert_eq!(
            plan_funding_request("balance"),
            Some(json!({ "plan_funding": "balance" }))
        );
        assert_eq!(
            plan_funding_request("plan"),
            Some(json!({ "plan_funding": "plan" }))
        );
        assert_eq!(plan_funding_request("both"), None);
        assert_eq!(plan_funding_request(""), None);
    }

    #[test]
    fn the_trial_claim_sends_the_installation_and_the_device_hash() {
        assert_eq!(
            trial_claim_request("inst-1", Some(HASH.into())),
            json!({ "installation_id": "inst-1", "device_hash": HASH })
        );
        assert_eq!(
            trial_claim_request("inst-1", None),
            json!({ "installation_id": "inst-1" })
        );
    }
}
