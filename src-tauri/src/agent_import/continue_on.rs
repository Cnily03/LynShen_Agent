//! A Claude Code or Codex conversation continued on the LynShen engine
//! (ticket #40): its text, tool calls and tool results become a LynShen
//! session, written as the other imports write theirs (`sessions.rs`
//! `write_session`), and the conversation goes on there with LynShen's
//! models. The original and its Claude Code / Codex copy stay as they are.
//!
//! What does not come along: thinking and reasoning (signed or encrypted by
//! the account that wrote them), images, and what the other engine kept for
//! itself (Codex's compaction summaries, Claude's sub-agent streams).
//! Tool calls keep their names and arguments as the other engine wrote
//! them: the model reads them as history, it does not run them again.

use super::sessions::{first_prompt, folder_key, lynshen_session_dir, tidy, write_session, Turn};
use super::Roots;
use crate::claude_history::{is_synthetic, truncate_chars};
use crate::native_import::{claude_session_file, codex_plan, codex_threads, json_lines, now_ms};
use serde::Serialize;
use serde_json::Value;

const MAX_TITLE_CHARS: usize = 80;

#[derive(Serialize, Debug)]
pub struct Continued {
    /// The LynShen session to open.
    pub id: String,
    pub title: String,
    pub cwd: String,
    /// Messages carried over.
    pub turns: usize,
}

/// Seconds since the epoch of an RFC 3339 time (`2026-10-19T08:01:02.345Z`),
/// 0 when it is not one.
fn epoch_secs(text: &str) -> u64 {
    let b = text.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return 0;
    }
    let num = |r: std::ops::Range<usize>| text.get(r).and_then(|s| s.parse::<i64>().ok());
    let (Some(y), Some(mo), Some(d), Some(h), Some(mi), Some(se)) = (
        num(0..4),
        num(5..7),
        num(8..10),
        num(11..13),
        num(14..16),
        num(17..19),
    ) else {
        return 0;
    };
    // Days from civil (Howard Hinnant's algorithm).
    let y = if mo <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (mo + if mo > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(days * 86_400 + h * 3_600 + mi * 60 + se).unwrap_or(0)
}

fn text_of(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p["text"].as_str().or_else(|| p.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// A Claude Code session file as turns: the user's prompts, the replies'
/// text, each `tool_use` and its `tool_result`.
pub(super) fn claude_turns(rows: impl Iterator<Item = Value>) -> Vec<(u64, Turn)> {
    let mut turns = Vec::new();
    for row in rows {
        let kind = row["type"].as_str().unwrap_or_default();
        if !matches!(kind, "user" | "assistant") || is_synthetic(&row) {
            continue;
        }
        let at = epoch_secs(row["timestamp"].as_str().unwrap_or_default());
        let content = &row["message"]["content"];
        if let Some(text) = content.as_str() {
            let text = text.trim();
            // Slash-command echoes and local command output, not conversation.
            if !text.is_empty() && !text.starts_with('<') {
                turns.push((
                    at,
                    if kind == "user" {
                        Turn::User(text.to_string())
                    } else {
                        Turn::Assistant(text.to_string())
                    },
                ));
            }
            continue;
        }
        for block in content.as_array().into_iter().flatten() {
            match block["type"].as_str() {
                Some("text") => {
                    let text = block["text"].as_str().unwrap_or_default().trim();
                    if text.is_empty() || text.starts_with('<') {
                        continue;
                    }
                    turns.push((
                        at,
                        if kind == "user" {
                            Turn::User(text.to_string())
                        } else {
                            Turn::Assistant(text.to_string())
                        },
                    ));
                }
                Some("tool_use") => turns.push((
                    at,
                    Turn::Call {
                        call_id: block["id"].as_str().unwrap_or_default().to_string(),
                        name: block["name"].as_str().unwrap_or("tool").to_string(),
                        arguments: block["input"].to_string(),
                    },
                )),
                Some("tool_result") => {
                    let mut output = text_of(&block["content"]);
                    if block["is_error"].as_bool() == Some(true) {
                        output = format!("Error: {output}");
                    }
                    turns.push((
                        at,
                        Turn::Output {
                            call_id: block["tool_use_id"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            name: String::new(),
                            output,
                        },
                    ))
                }
                _ => {}
            }
        }
    }
    name_outputs(turns)
}

/// A Codex rollout's rows (the thread's chain, in order) as turns.
pub(super) fn codex_turns(rows: impl Iterator<Item = Value>) -> Vec<(u64, Turn)> {
    let mut turns = Vec::new();
    for row in rows {
        if row["type"].as_str() != Some("response_item") {
            continue;
        }
        let at = epoch_secs(row["timestamp"].as_str().unwrap_or_default());
        let p = &row["payload"];
        match p["type"].as_str() {
            Some("message") => {
                let text = p["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|c| c["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                let text = text.trim();
                // Codex adds AGENTS.md and its environment as user messages.
                if text.is_empty() || text.starts_with('<') || text.starts_with("# AGENTS.md") {
                    continue;
                }
                match p["role"].as_str() {
                    Some("user") => turns.push((at, Turn::User(text.to_string()))),
                    Some("assistant") => turns.push((at, Turn::Assistant(text.to_string()))),
                    _ => {}
                }
            }
            Some("function_call") | Some("custom_tool_call") => turns.push((
                at,
                Turn::Call {
                    call_id: p["call_id"].as_str().unwrap_or_default().to_string(),
                    name: p["name"].as_str().unwrap_or("tool").to_string(),
                    arguments: p["arguments"]
                        .as_str()
                        .or_else(|| p["input"].as_str())
                        .unwrap_or("{}")
                        .to_string(),
                },
            )),
            Some("function_call_output") | Some("custom_tool_call_output") => {
                let output = match &p["output"] {
                    Value::String(s) => s.clone(),
                    other if other["content"].is_null() => text_of(other),
                    other => text_of(&other["content"]),
                };
                turns.push((
                    at,
                    Turn::Output {
                        call_id: p["call_id"].as_str().unwrap_or_default().to_string(),
                        name: String::new(),
                        output,
                    },
                ))
            }
            _ => {}
        }
    }
    name_outputs(turns)
}

/// Each output named after its call (the formats name only the call).
fn name_outputs(mut turns: Vec<(u64, Turn)>) -> Vec<(u64, Turn)> {
    let mut names = std::collections::HashMap::new();
    for (_, turn) in &mut turns {
        match turn {
            Turn::Call { call_id, name, .. } => {
                names.insert(call_id.clone(), name.clone());
            }
            Turn::Output { call_id, name, .. } if name.is_empty() => {
                *name = names
                    .get(call_id)
                    .cloned()
                    .unwrap_or_else(|| "tool".to_string());
            }
            _ => {}
        }
    }
    turns
}

/// Continues `source`'s conversation `id` (a Claude Code session or a Codex
/// thread, its LynShen copy's id or the original's) of folder `cwd` on the
/// LynShen engine. Each call writes a new session: continuing twice gives two.
pub fn continue_on_lynshen(
    roots: &Roots,
    source: &str,
    cwd: &str,
    id: &str,
) -> Result<Continued, String> {
    let h = roots.native();
    let (turns, title) = match source {
        "claude" => {
            let path = claude_session_file(&h, cwd, id)
                .ok_or_else(|| format!("Claude Code session {id} not found"))?;
            let turns = claude_turns(json_lines(&path)?.filter_map(Result::ok));
            let title = crate::claude_history::preview_of(&path);
            (turns, title)
        }
        "codex" => {
            let threads = codex_threads(&h.codex);
            let mut rows = Vec::new();
            for (path, below) in codex_plan(&threads, id)? {
                for row in json_lines(&path)?.filter_map(Result::ok) {
                    if row["ordinal"].as_i64().is_some_and(|o| o >= below) {
                        continue;
                    }
                    rows.push(row);
                }
            }
            let title = crate::native_import::codex_names(&h.codex)
                .get(id)
                .cloned()
                .unwrap_or_default();
            (codex_turns(rows.into_iter()), title)
        }
        other => {
            return Err(format!(
                "{other} conversations continue in their own engine"
            ))
        }
    };
    let turns = tidy(turns);
    if !turns.iter().any(|(_, t)| matches!(t, Turn::User(_))) {
        return Err("this conversation has no messages to carry over".to_string());
    }
    let title = if title.trim().is_empty() {
        first_prompt(&turns)
    } else {
        title.trim().to_string()
    };
    let title = truncate_chars(&title, MAX_TITLE_CHARS);
    let cwd = folder_key(cwd);
    let updated = turns
        .iter()
        .map(|(at, _)| *at)
        .max()
        .unwrap_or(0)
        .max(now_ms() / 1000);
    let sid = write_session(
        &lynshen_session_dir(&roots.lynshen, &cwd),
        &title,
        updated,
        &turns,
    )?;
    Ok(Continued {
        id: sid,
        title,
        cwd,
        turns: turns.len(),
    })
}

/// The command: the conversation of a Claude Code / Codex session tab
/// continued in a new LynShen session.
#[tauri::command(async)]
pub fn continue_on_lynshen_cmd(
    source: String,
    cwd: String,
    id: String,
) -> Result<Continued, String> {
    continue_on_lynshen(&Roots::real(), &source, &cwd, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_rfc3339_times() {
        assert_eq!(epoch_secs("1970-01-01T00:00:10Z"), 10);
        assert_eq!(epoch_secs("2026-10-19T08:00:00.123Z"), 1_792_396_800);
        assert_eq!(epoch_secs("yesterday"), 0);
    }

    #[test]
    fn a_claude_session_keeps_text_calls_and_results_not_thinking() {
        let rows = vec![
            json!({"type": "user", "timestamp": "2026-10-19T08:00:00Z", "message": {"content": "修一下登录"}}),
            json!({"type": "assistant", "message": {"content": [
                {"type": "thinking", "thinking": "secret", "signature": "x"},
                {"type": "text", "text": "先看代码。"},
                {"type": "tool_use", "id": "toolu_1", "name": "Read", "input": {"file_path": "a.rs"}}
            ]}}),
            json!({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "toolu_1", "content": [{"type": "text", "text": "fn main() {}"}]}]}}),
            json!({"type": "assistant", "isSidechain": true, "message": {"content": "sub-agent"}}),
            json!({"type": "user", "message": {"content": "<command-name>/clear</command-name>"}}),
            json!({"type": "assistant", "message": {"content": [{"type": "text", "text": "改好了。"}]}}),
        ];
        let turns = tidy(claude_turns(rows.into_iter()));
        let kinds: Vec<String> = turns
            .iter()
            .map(|(_, t)| match t {
                Turn::User(s) => format!("user:{s}"),
                Turn::Assistant(s) => format!("assistant:{s}"),
                Turn::Call {
                    name, arguments, ..
                } => format!("call:{name}:{arguments}"),
                Turn::Output { name, output, .. } => format!("output:{name}:{output}"),
            })
            .collect();
        assert_eq!(
            kinds,
            [
                "user:修一下登录",
                "assistant:先看代码。",
                "call:Read:{\"file_path\":\"a.rs\"}",
                "output:Read:fn main() {}",
                "assistant:改好了。",
            ]
        );
        assert_eq!(turns[0].0, 1_792_396_800);
    }

    #[test]
    fn a_codex_thread_keeps_text_calls_and_results_not_reasoning() {
        let rows = vec![
            json!({"type": "session_meta", "payload": {"id": "t"}}),
            json!({"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "# AGENTS.md\nrules"}]}}),
            json!({"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "跑测试"}]}}),
            json!({"type": "response_item", "payload": {"type": "reasoning", "encrypted_content": "zzz"}}),
            json!({"type": "response_item", "payload": {"type": "function_call", "call_id": "c1", "name": "shell", "arguments": "{\"cmd\":\"cargo test\"}"}}),
            json!({"type": "response_item", "payload": {"type": "function_call_output", "call_id": "c1", "output": "ok"}}),
            json!({"type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "都过了。"}]}}),
        ];
        let turns = tidy(codex_turns(rows.into_iter()));
        assert_eq!(turns.len(), 4);
        assert!(matches!(&turns[0].1, Turn::User(s) if s == "跑测试"));
        assert!(
            matches!(&turns[2].1, Turn::Output { name, output, .. } if name == "shell" && output == "ok")
        );
        assert!(matches!(&turns[3].1, Turn::Assistant(s) if s == "都过了。"));
    }
}
