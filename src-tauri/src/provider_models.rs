//! 获取可用模型 for a provider the user configures (Settings → 提供商): the
//! model list of its endpoint, read here and not in the page, so the request
//! has no CORS limits and a saved key never reaches the page.
//!
//! The list URL follows the engine's request URL for the wire format
//! (llm-provider-kit `transport::endpoint`): `{base}/models` for the OpenAI
//! formats, and the Messages URL with `/models` for `/messages` for the
//! Anthropic format (so `https://relay/v1` lists `https://relay/v1/models`).
//! The answer is cut down to ids and the few fields gateways commonly add
//! (window, output cap, input kinds, whether the model reasons and its
//! effort tiers).
use serde_json::{json, Value};
use std::io::Read;
use std::time::Duration;

/// Version header of the Anthropic API (the kit's `ANTHROPIC_VERSION`).
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Larger answers are refused (OpenRouter's full list is about 1 MB).
const MAX_BODY_BYTES: u64 = 8 * 1024 * 1024;
/// More models than any provider lists; the rest is dropped.
const MAX_MODELS: usize = 2000;

/// The URL of the model list for a base URL and wire format; an error for
/// anything but an http(s) URL with a host.
pub(crate) fn models_url(format: &str, base_url: &str) -> Result<String, String> {
    let base = base_url.trim().trim_end_matches('/');
    let rest = base
        .strip_prefix("https://")
        .or_else(|| base.strip_prefix("http://"))
        .ok_or_else(|| "the base URL must start with http:// or https://".to_string())?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() || base.chars().any(char::is_whitespace) {
        return Err("the base URL has no host".to_string());
    }
    if format != "anthropic" {
        return Ok(format!("{base}/models"));
    }
    // `messages_url`: a base ending in /v1 or the official host gets
    // /v1/messages; any other base an /anthropic/v1 mount.
    let official = base
        .strip_prefix("https://api.anthropic.com")
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'));
    Ok(if base.ends_with("/v1") {
        format!("{base}/models")
    } else if base.ends_with("/anthropic") || official {
        format!("{base}/v1/models")
    } else {
        format!("{base}/anthropic/v1/models")
    })
}

/// A positive whole number from the first of `keys` that has one
/// (`a.b` reads a nested field).
fn first_count(model: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        let value = at(model, key)?;
        value
            .as_u64()
            .or_else(|| value.as_f64().filter(|n| n.fract() == 0.0 && *n > 0.0).map(|n| n as u64))
            .or_else(|| value.as_str().and_then(|s| s.trim().parse::<u64>().ok()))
            .filter(|n| *n > 0)
    })
}

/// The value at `path` (`a.b` reads a nested field).
fn at<'a>(model: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.').try_fold(model, |at, part| at.get(part))
}

/// A yes or no at `path`: a boolean, or `{"supported": bool}` (the
/// capabilities of Anthropic's model list).
fn flag(model: &Value, path: &str) -> Option<bool> {
    let value = at(model, path)?;
    value.as_bool().or_else(|| value.get("supported").and_then(Value::as_bool))
}

/// "text" and "image" from the first list of input kinds the model states,
/// else from an image flag (Anthropic `capabilities.image_input`, Mistral
/// `capabilities.vision`).
fn input_kinds(model: &Value) -> Option<Vec<&'static str>> {
    let list = ["architecture.input_modalities", "input_modalities", "modalities.input"]
        .iter()
        .find_map(|key| at(model, key)?.as_array());
    let Some(list) = list else {
        let image = ["capabilities.image_input", "capabilities.vision", "supports_vision"]
            .iter()
            .find_map(|key| flag(model, key))?;
        return Some(if image { vec!["text", "image"] } else { vec!["text"] });
    };
    let has = |kind: &str| list.iter().any(|v| v.as_str() == Some(kind));
    let kinds: Vec<&'static str> = [("text", has("text")), ("image", has("image"))]
        .into_iter()
        .filter_map(|(kind, on)| on.then_some(kind))
        .collect();
    (!kinds.is_empty()).then_some(kinds)
}

/// Whether the model reasons, when the answer says so:
/// - a flag `reasoning`, `supports_reasoning`, `thinking` (Gemini) or
///   `supports_thinking`, at the top or in `capabilities` (Anthropic:
///   `capabilities.thinking.supported`);
/// - OpenRouter's `supported_parameters`: "reasoning" or "include_reasoning"
///   (a list without them: no);
/// - a `capabilities`, `features` or `tags` list that names "reasoning" or
///   "thinking" (a list without them says nothing).
fn reasoning_hint(model: &Value) -> Option<bool> {
    const FLAGS: [&str; 4] = ["reasoning", "supports_reasoning", "thinking", "supports_thinking"];
    let stated = ["", "capabilities."]
        .iter()
        .flat_map(|prefix| FLAGS.iter().map(move |key| format!("{prefix}{key}")))
        .find_map(|path| flag(model, &path));
    if let Some(stated) = stated {
        return Some(stated);
    }
    if let Some(params) = model.get("supported_parameters").and_then(Value::as_array) {
        return Some(params.iter().any(|p| matches!(p.as_str(), Some("reasoning" | "include_reasoning" | "reasoning_effort"))));
    }
    let names = |v: &Value| v.as_str().is_some_and(|s| s.eq_ignore_ascii_case("reasoning") || s.eq_ignore_ascii_case("thinking"));
    ["capabilities", "features", "tags"]
        .iter()
        .filter_map(|key| model.get(*key).and_then(Value::as_array))
        .any(|list| list.iter().any(names))
        .then_some(true)
}

/// The effort tiers the answer states: Anthropic's `capabilities.effort`
/// levels (with "none" first when thinking can be turned off), or a list in
/// `reasoning_efforts`, `supported_reasoning_efforts` or
/// `capabilities.effort_levels`.
fn effort_hint(model: &Value) -> Option<Vec<String>> {
    if let Some(effort) = at(model, "capabilities.effort").filter(|e| flag(e, "supported") == Some(true)) {
        let off = flag(model, "capabilities.thinking.types.disabled") != Some(false);
        let tiers: Vec<String> = ["none", "low", "medium", "high", "xhigh", "max"]
            .into_iter()
            .filter(|tier| if *tier == "none" { off } else { flag(effort, tier) == Some(true) })
            .map(str::to_string)
            .collect();
        if tiers.iter().any(|tier| tier != "none") {
            return Some(tiers);
        }
    }
    ["reasoning_efforts", "supported_reasoning_efforts", "capabilities.effort_levels"]
        .iter()
        .find_map(|key| {
            let tiers: Vec<String> = at(model, key)?
                .as_array()?
                .iter()
                .filter_map(Value::as_str)
                .map(|tier| tier.trim().to_ascii_lowercase())
                .filter(|tier| !tier.is_empty())
                .collect();
            (!tiers.is_empty()).then_some(tiers)
        })
}

/// The models of a list answer: `{data: [...]}` (OpenAI, Anthropic and most
/// gateways), `{models: [...]}`, or a bare array. Each is `{id}` plus what
/// the answer says about it.
pub(crate) fn parse_models(body: &Value) -> Vec<Value> {
    let list = body
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| body.get("models").and_then(Value::as_array))
        .or_else(|| body.as_array());
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for model in list.into_iter().flatten() {
        let raw = model
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| model.get("name").and_then(Value::as_str))
            .or_else(|| model.as_str())
            .unwrap_or("")
            .trim();
        // Gemini's OpenAI-compatible list names models `models/<id>`.
        let id = raw.strip_prefix("models/").unwrap_or(raw);
        if id.is_empty() || id.chars().any(char::is_whitespace) || !seen.insert(id.to_string()) {
            continue;
        }
        let mut entry = json!({ "id": id });
        let label = model
            .get("display_name")
            .or_else(|| model.get("name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|label| !label.is_empty() && *label != raw && *label != id);
        if let Some(label) = label {
            entry["display_name"] = json!(label);
        }
        let window = first_count(
            model,
            &["context_window", "context_length", "max_context_length", "max_input_tokens", "input_token_limit", "top_provider.context_length"],
        );
        if let Some(window) = window {
            entry["context_window"] = json!(window);
        }
        let output = first_count(
            model,
            &["max_output_tokens", "max_completion_tokens", "output_token_limit", "max_tokens", "top_provider.max_completion_tokens"],
        );
        if let Some(output) = output {
            entry["max_output_tokens"] = json!(output);
        }
        if let Some(kinds) = input_kinds(model) {
            entry["input_modalities"] = json!(kinds);
        }
        if let Some(reasoning) = reasoning_hint(model) {
            entry["reasoning"] = json!(reasoning);
        }
        if let Some(tiers) = effort_hint(model) {
            entry["reasoning_efforts"] = json!(tiers);
        }
        out.push(entry);
        if out.len() == MAX_MODELS {
            break;
        }
    }
    out
}

/// The error text of a refused request: the answer's own message when it has
/// one (`error.message`, `message`, `error`), else its status.
fn status_error(code: u16, body: &str) -> String {
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let message = parsed
        .get("error")
        .and_then(|e| e.get("message").and_then(Value::as_str).or_else(|| e.as_str()))
        .or_else(|| parsed.get("message").and_then(Value::as_str))
        .map(str::trim)
        .filter(|m| !m.is_empty());
    match message {
        Some(message) => format!("HTTP {code}: {}", message.chars().take(300).collect::<String>()),
        None => format!("HTTP {code}"),
    }
}

/// The key saved for `provider` in auth.json (a plain API key entry).
fn saved_key(provider: &str) -> Option<String> {
    crate::read_auth()
        .get("providers")
        .and_then(|p| p.get(provider))
        .and_then(Value::as_str)
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
}

/// GET the model list of a provider's endpoint. `key`: one typed into the
/// form and not saved yet; without it, the key saved for `provider` (none:
/// the request goes without one). Answers `{url, models}`.
#[tauri::command(async)]
pub fn provider_models(provider: String, base_url: String, format: String, key: Option<String>) -> Result<Value, String> {
    let url = models_url(&format, &base_url)?;
    let key = key
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .or_else(|| saved_key(provider.trim()));
    // No redirects: the key goes to the configured host only.
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirects(0)
        .try_proxy_from_env(true)
        .build();
    let mut request = agent.get(&url).set("Accept", "application/json");
    if let Some(key) = &key {
        request = request.set("Authorization", &format!("Bearer {key}"));
        if format == "anthropic" {
            // Official Anthropic reads x-api-key; relays mostly read the bearer.
            request = request.set("x-api-key", key).set("anthropic-version", ANTHROPIC_VERSION);
        }
    } else if format == "anthropic" {
        request = request.set("anthropic-version", ANTHROPIC_VERSION);
    }
    let response = match request.call() {
        Ok(response) => response,
        Err(ureq::Error::Status(code, response)) => {
            let mut body = String::new();
            let _ = response.into_reader().take(64 * 1024).read_to_string(&mut body);
            return Err(status_error(code, &body));
        }
        Err(error) => return Err(error.to_string()),
    };
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_BODY_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BODY_BYTES {
        return Err("the model list is larger than 8 MB".to_string());
    }
    let body: Value = serde_json::from_slice(&bytes).map_err(|_| "the answer is not a JSON model list".to_string())?;
    Ok(json!({ "url": url, "models": parse_models(&body) }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_models_next_to_the_request_url() {
        assert_eq!(models_url("responses", "https://api.openai.com/v1/").unwrap(), "https://api.openai.com/v1/models");
        assert_eq!(models_url("chat", "https://openrouter.ai/api/v1").unwrap(), "https://openrouter.ai/api/v1/models");
        assert_eq!(models_url("anthropic", "https://www.lynshen.org/v1").unwrap(), "https://www.lynshen.org/v1/models");
        assert_eq!(models_url("anthropic", "https://api.anthropic.com").unwrap(), "https://api.anthropic.com/v1/models");
        assert_eq!(models_url("anthropic", "https://relay.example.com/anthropic").unwrap(), "https://relay.example.com/anthropic/v1/models");
        assert_eq!(models_url("anthropic", "https://www.lynshen.org").unwrap(), "https://www.lynshen.org/anthropic/v1/models");
        assert!(models_url("chat", "ftp://example.com").is_err());
        assert!(models_url("chat", "https://").is_err());
        assert!(models_url("chat", "www.lynshen.org/v1").is_err());
    }

    #[test]
    fn reads_the_common_list_shapes() {
        // The LynShen gateway: ids in `data`, Codex descriptors in `models`.
        let gateway = json!({"object": "list", "data": [{"id": "claude-fable-5", "object": "model"}, {"id": "gpt-6.1-sol"}], "models": [{"slug": "gpt-6.1-sol"}]});
        assert_eq!(parse_models(&gateway), vec![json!({"id": "claude-fable-5"}), json!({"id": "gpt-6.1-sol"})]);
        // Anthropic: display names.
        let anthropic = json!({"data": [{"type": "model", "id": "claude-fable-5", "display_name": "Claude Fable 5"}], "has_more": false});
        assert_eq!(parse_models(&anthropic), vec![json!({"id": "claude-fable-5", "display_name": "Claude Fable 5"})]);
        // OpenRouter: window, output cap and input kinds.
        let openrouter = json!({"data": [{
            "id": "anthropic/claude-fable-5", "name": "Anthropic: Claude Fable 5", "context_length": 1000000,
            "architecture": {"input_modalities": ["text", "image", "file"]},
            "top_provider": {"context_length": 1000000, "max_completion_tokens": 128000}
        }]});
        assert_eq!(
            parse_models(&openrouter),
            vec![json!({"id": "anthropic/claude-fable-5", "display_name": "Anthropic: Claude Fable 5", "context_window": 1000000, "max_output_tokens": 128000, "input_modalities": ["text", "image"]})]
        );
        // Gemini's names, duplicates, blanks and a bare array of names.
        let odd = json!({"models": [{"name": "models/gemini-3-pro", "input_token_limit": "1048576"}, {"id": "gemini-3-pro"}, {"id": " "}, {"id": "a b"}]});
        assert_eq!(parse_models(&odd), vec![json!({"id": "gemini-3-pro", "context_window": 1048576})]);
        assert_eq!(parse_models(&json!(["m1", "m2"])), vec![json!({"id": "m1"}), json!({"id": "m2"})]);
        assert!(parse_models(&json!({"error": "nope"})).is_empty());
    }

    #[test]
    fn reads_what_the_list_says_about_reasoning() {
        let models = |body: Value| parse_models(&body);
        // Anthropic: thinking, effort levels (none: thinking can be turned
        // off) and image input from `capabilities`.
        let anthropic = json!({"data": [
            {"id": "claude-opus-5-5", "max_input_tokens": 1000000, "max_tokens": 128000, "capabilities": {
                "effort": {"supported": true, "low": {"supported": true}, "medium": {"supported": true}, "high": {"supported": true}, "xhigh": {"supported": true}, "max": {"supported": true}},
                "image_input": {"supported": true},
                "thinking": {"supported": true, "types": {"adaptive": {"supported": true}, "disabled": {"supported": true}, "enabled": {"supported": false}}}
            }},
            {"id": "claude-sonnet-4", "capabilities": {"effort": {"supported": false}, "image_input": {"supported": true}, "thinking": {"supported": true, "types": {"disabled": {"supported": true}}}}},
            {"id": "claude-always-thinks", "capabilities": {"effort": {"supported": true, "high": {"supported": true}, "max": {"supported": true}, "low": {"supported": false}}, "thinking": {"supported": true, "types": {"disabled": {"supported": false}}}}},
            {"id": "claude-3-haiku", "capabilities": {"effort": {"supported": false}, "image_input": {"supported": false}, "thinking": {"supported": false}}}
        ]});
        assert_eq!(
            models(anthropic),
            vec![
                json!({"id": "claude-opus-5-5", "context_window": 1000000, "max_output_tokens": 128000, "input_modalities": ["text", "image"], "reasoning": true, "reasoning_efforts": ["none", "low", "medium", "high", "xhigh", "max"]}),
                json!({"id": "claude-sonnet-4", "input_modalities": ["text", "image"], "reasoning": true}),
                json!({"id": "claude-always-thinks", "reasoning": true, "reasoning_efforts": ["high", "max"]}),
                json!({"id": "claude-3-haiku", "input_modalities": ["text"], "reasoning": false})
            ]
        );
        // OpenRouter: `supported_parameters` (a list without "reasoning": no).
        let openrouter = json!({"data": [
            {"id": "deepseek/deepseek-v4-pro", "supported_parameters": ["max_tokens", "reasoning", "include_reasoning", "tools"]},
            {"id": "z-ai/glm-5.3", "supported_parameters": ["include_reasoning", "tools"]},
            {"id": "meta-llama/llama-4", "supported_parameters": ["max_tokens", "tools"]}
        ]});
        assert_eq!(
            models(openrouter),
            vec![
                json!({"id": "deepseek/deepseek-v4-pro", "reasoning": true}),
                json!({"id": "z-ai/glm-5.3", "reasoning": true}),
                json!({"id": "meta-llama/llama-4", "reasoning": false})
            ]
        );
        // Gateways and models.dev-like lists: flags, capability lists, tiers.
        let gateway = json!({"data": [
            {"id": "kimi-k3", "reasoning": true},
            {"id": "qwen3.8-max", "capabilities": {"supports_reasoning": true, "vision": false}, "reasoning_efforts": ["Low", "High"]},
            {"id": "mimo-v2.5-pro", "capabilities": ["tools", "Thinking"]},
            {"id": "gemini-3-pro", "thinking": true},
            {"id": "relay-mini", "supports_reasoning": false},
            {"id": "lynshen-model", "capabilities": {"reasoning": true, "effort_levels": ["low", "medium", "high"]}},
            {"id": "plain", "features": ["tools"]}
        ]});
        assert_eq!(
            models(gateway),
            vec![
                json!({"id": "kimi-k3", "reasoning": true}),
                json!({"id": "qwen3.8-max", "input_modalities": ["text"], "reasoning": true, "reasoning_efforts": ["low", "high"]}),
                json!({"id": "mimo-v2.5-pro", "reasoning": true}),
                json!({"id": "gemini-3-pro", "reasoning": true}),
                json!({"id": "relay-mini", "reasoning": false}),
                json!({"id": "lynshen-model", "reasoning": true, "reasoning_efforts": ["low", "medium", "high"]}),
                json!({"id": "plain"})
            ]
        );
    }

    #[test]
    fn a_refusal_says_why() {
        assert_eq!(status_error(401, r#"{"error":{"message":"invalid api key","type":"auth"}}"#), "HTTP 401: invalid api key");
        assert_eq!(status_error(404, r#"{"message":"Not Found"}"#), "HTTP 404: Not Found");
        assert_eq!(status_error(403, r#"{"error":"forbidden"}"#), "HTTP 403: forbidden");
        assert_eq!(status_error(502, "<html>bad gateway</html>"), "HTTP 502");
    }
}
