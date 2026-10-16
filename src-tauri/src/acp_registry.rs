//! ACP agent registry: which external Agent Client Protocol agents the
//! desktop may launch, and with what fixed command line.
//!
//! Users register agents (id, name, command, args, env) through the
//! dedicated registry commands below, where every field is validated; a
//! session starts from its entry, whose command line the desktop hands to the
//! daemon. Registered args are fixed configuration (they may legitimately
//! start with `-`, e.g. `--experimental-acp`).
//!
//! The registry persists as `acp-agents.json` in the per-app config dir
//! (same directory as the other desktop app-data files).
//!
//! Presets are agents Settings offers to add in one click (OpenCode: `opencode
//! acp`); adding one writes an ordinary registry entry.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::backend;

/// One launchable ACP agent. `env` is applied on top of the shell-env
/// snapshot / custom backend env when the child is spawned.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AcpAgent {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Default)]
struct RegistryFile {
    agents: Vec<AcpAgent>,
}

const FILE_NAME: &str = "acp-agents.json";
const MAX_AGENTS: usize = 32;
const MAX_ARGS: usize = 32;
const MAX_ARG_LEN: usize = 300;
const MAX_NAME_LEN: usize = 100;
const MAX_COMMAND_LEN: usize = 300;

fn valid_text(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && !s.chars().any(|c| c.is_control())
}

/// Validates one registry entry. Applied on every write AND on every read, so
/// a hand-edited registry file can't smuggle malformed entries into a spawn.
pub fn validate_agent(agent: &AcpAgent) -> Result<(), String> {
    if !backend::is_valid_acp_agent_id(&agent.id) {
        return Err(format!(
            "invalid agent id: {} (lowercase letters, digits, - and _ only)",
            agent.id
        ));
    }
    if !valid_text(&agent.name, MAX_NAME_LEN) {
        return Err("agent name must be 1-100 characters without control characters".to_string());
    }
    if !valid_text(&agent.command, MAX_COMMAND_LEN) || agent.command.starts_with('-') {
        return Err("agent command must be a program name or path (not a flag)".to_string());
    }
    if agent.args.len() > MAX_ARGS {
        return Err(format!("agent accepts at most {MAX_ARGS} arguments"));
    }
    for arg in &agent.args {
        if arg.is_empty() || arg.len() > MAX_ARG_LEN || arg.chars().any(|c| c.is_control()) {
            return Err(format!("invalid agent argument: {arg:?}"));
        }
    }
    if agent.env.len() > backend::MAX_CUSTOM_ENV_VARS {
        return Err(format!(
            "agent env accepts at most {} variables",
            backend::MAX_CUSTOM_ENV_VARS
        ));
    }
    for (name, value) in &agent.env {
        if !backend::is_valid_env_name(name) {
            return Err(format!("invalid env variable name: {name}"));
        }
        if value.len() > backend::MAX_CUSTOM_ENV_VALUE_LEN || value.contains('\0') {
            return Err(format!("invalid env value for {name}"));
        }
    }
    Ok(())
}

/// Id of the engine's own ACP surface that earlier versions seeded as the
/// first-run entry. LynShen runs natively, so wrapping it in ACP added nothing;
/// the entry is dropped from existing registries on load.
const RETIRED_DEFAULT_ID: &str = "lynshen-acp";

/// Parses the registry file contents, validating every entry.
fn parse_registry(text: &str) -> Result<Vec<AcpAgent>, String> {
    let file: RegistryFile =
        serde_json::from_str(text).map_err(|e| format!("acp registry is malformed: {e}"))?;
    for agent in &file.agents {
        validate_agent(agent)?;
    }
    Ok(file
        .agents
        .into_iter()
        .filter(|a| a.id != RETIRED_DEFAULT_ID)
        .collect())
}

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app config dir unavailable: {e}"))?;
    Ok(dir.join(FILE_NAME))
}

/// Loads the registry; a missing file is an empty registry.
pub fn load(app: &AppHandle) -> Result<Vec<AcpAgent>, String> {
    let path = registry_path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => parse_registry(&text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("failed to read {}: {e}", path.display())),
    }
}

/// Write-then-rename so a crash mid-write can't truncate the registry.
fn save(app: &AppHandle, agents: &[AcpAgent]) -> Result<(), String> {
    let path = registry_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&RegistryFile {
        agents: agents.to_vec(),
    })
    .map_err(|e| e.to_string())?;
    let mut tmp = path.clone();
    tmp.set_file_name(format!("{FILE_NAME}.tmp"));
    std::fs::write(&tmp, text.as_bytes())
        .map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

/// Looks up (and re-validates) one agent for spawning.
pub fn find_agent(app: &AppHandle, id: &str) -> Result<AcpAgent, String> {
    load(app)?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| format!("unknown acp agent: {id}"))
}

/// Lists the registered ACP agents (settings UI + new-session picker).
#[tauri::command]
pub fn acp_agents_list(app: AppHandle) -> Result<Vec<AcpAgent>, String> {
    load(&app)
}

/// Adds or replaces one agent (matched by id). Returns the updated list.
#[tauri::command]
pub fn acp_agent_upsert(app: AppHandle, agent: AcpAgent) -> Result<Vec<AcpAgent>, String> {
    validate_agent(&agent)?;
    let mut agents = load(&app)?;
    if let Some(existing) = agents.iter_mut().find(|a| a.id == agent.id) {
        *existing = agent;
    } else {
        if agents.len() >= MAX_AGENTS {
            return Err(format!("at most {MAX_AGENTS} acp agents can be registered"));
        }
        agents.push(agent);
    }
    save(&app, &agents)?;
    Ok(agents)
}

/// Removes one agent by id. Returns the updated list.
#[tauri::command]
pub fn acp_agent_remove(app: AppHandle, id: String) -> Result<Vec<AcpAgent>, String> {
    let mut agents = load(&app)?;
    agents.retain(|a| a.id != id);
    save(&app, &agents)?;
    Ok(agents)
}

/// An agent Settings can add in one click.
struct Preset {
    id: &'static str,
    name: &'static str,
    command: &'static str,
    args: &'static [&'static str],
    /// The npm package that installs `command` (see `npm_native_binary`).
    npm_package: &'static str,
}

const PRESETS: &[Preset] = &[Preset {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    args: &["acp"],
    npm_package: "opencode-ai",
}];

/// A preset as Settings lists it.
#[derive(Serialize, Debug, PartialEq)]
pub struct AcpPreset {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    /// Where its program was found (None: not installed, or not on PATH).
    pub path: Option<String>,
    /// A registered agent already runs it.
    pub registered: bool,
}

/// A command's program name without its folder or Windows extension
/// (`C:\x\opencode.exe` → `opencode`).
fn program_stem(command: &str) -> &str {
    let file = command.rsplit(['/', '\\']).next().unwrap_or(command);
    match file.rsplit_once('.') {
        Some((stem, ext))
            if ["exe", "cmd", "bat", "ps1"]
                .iter()
                .any(|e| ext.eq_ignore_ascii_case(e)) =>
        {
            stem
        }
        _ => file,
    }
}

/// Whether `agent` runs `preset`: the same program (by name or path) with the
/// same arguments.
fn runs_preset(agent: &AcpAgent, preset: &Preset) -> bool {
    program_stem(&agent.command).eq_ignore_ascii_case(preset.command)
        && agent
            .args
            .iter()
            .map(String::as_str)
            .eq(preset.args.iter().copied())
}

/// npm on Windows puts only shims on PATH (`opencode.cmd`, `.ps1`, and an
/// extensionless shell script); the program behind them is
/// `node_modules/<package>/bin/<command>.exe` next to them. A session that
/// runs the binary itself stops the agent when it stops, where through the
/// `.cmd` shim it would stop only the `cmd.exe` that started it.
fn npm_native_binary(found: &Path, package: &str, command: &str) -> Option<PathBuf> {
    let shim = match found.extension().and_then(|e| e.to_str()) {
        None => true,
        Some(ext) => ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("ps1"),
    };
    if !shim {
        return None;
    }
    let exe = found
        .parent()?
        .join("node_modules")
        .join(package)
        .join("bin")
        .join(format!("{command}.exe"));
    exe.is_file().then_some(exe)
}

/// The command a preset's registry entry runs: on Windows the binary behind
/// an npm shim (an absolute path), else the program name, which the daemon
/// finds on its PATH as the app does.
fn preset_command(preset: &Preset, found: Option<&Path>, windows: bool) -> String {
    let native = found
        .filter(|_| windows)
        .and_then(|found| npm_native_binary(found, preset.npm_package, preset.command));
    match native {
        Some(exe) => exe.display().to_string(),
        None => preset.command.to_string(),
    }
}

/// `base`, or `base-2`, `base-3` … when an agent already has that id.
fn free_id(agents: &[AcpAgent], base: &str) -> String {
    let taken = |id: &str| agents.iter().any(|a| a.id == id);
    if !taken(base) {
        return base.to_string();
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|id| !taken(id))
        .unwrap_or_default()
}

/// The registry entry that adds `preset` to `agents`.
fn preset_agent(
    preset: &Preset,
    agents: &[AcpAgent],
    found: Option<&Path>,
    windows: bool,
) -> AcpAgent {
    AcpAgent {
        id: free_id(agents, preset.id),
        name: preset.name.to_string(),
        command: preset_command(preset, found, windows),
        args: preset.args.iter().map(|a| a.to_string()).collect(),
        env: BTreeMap::new(),
    }
}

/// The presets, with whether each is installed and already registered.
#[tauri::command(async)]
pub fn acp_presets(app: AppHandle) -> Result<Vec<AcpPreset>, String> {
    let agents = load(&app)?;
    Ok(PRESETS
        .iter()
        .map(|preset| AcpPreset {
            id: preset.id.to_string(),
            name: preset.name.to_string(),
            command: preset.command.to_string(),
            args: preset.args.iter().map(|a| a.to_string()).collect(),
            path: crate::which(preset.command).map(|p| p.display().to_string()),
            registered: agents.iter().any(|a| runs_preset(a, preset)),
        })
        .collect())
}

/// Registers preset `id` (nothing changes when an agent already runs it).
/// Returns the updated list.
#[tauri::command(async)]
pub fn acp_preset_add(app: AppHandle, id: String) -> Result<Vec<AcpAgent>, String> {
    let preset = PRESETS
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("unknown preset: {id}"))?;
    let mut agents = load(&app)?;
    if agents.iter().any(|a| runs_preset(a, preset)) {
        return Ok(agents);
    }
    if agents.len() >= MAX_AGENTS {
        return Err(format!("at most {MAX_AGENTS} acp agents can be registered"));
    }
    let found = crate::which(preset.command);
    let agent = preset_agent(preset, &agents, found.as_deref(), cfg!(windows));
    validate_agent(&agent)?;
    agents.push(agent);
    save(&app, &agents)?;
    Ok(agents)
}

/// Availability probe for one registered agent: resolves its command and runs
/// `<command> --version` best-effort (mirrors `check_backend`).
#[tauri::command(async)]
pub fn acp_agent_check(app: AppHandle, id: String) -> Result<crate::BackendStatus, String> {
    let agent = find_agent(&app, &id)?;
    let bin = backend::resolve_acp_program(&agent.command);
    let path = if bin.components().count() == 1 {
        crate::which(&bin.to_string_lossy())
    } else if bin.is_file() {
        Some(bin)
    } else {
        None
    };
    let Some(path) = path else {
        return Ok(crate::BackendStatus {
            found: false,
            path: None,
            version: None,
            signed_in: None,
        });
    };
    let mut cmd = std::process::Command::new(&path);
    crate::no_window(&mut cmd);
    cmd.arg("--version");
    let version = crate::run_with_timeout(cmd, std::time::Duration::from_secs(15))
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|v| !v.is_empty());
    Ok(crate::BackendStatus {
        found: true,
        path: Some(path.display().to_string()),
        version,
        signed_in: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(id: &str) -> AcpAgent {
        AcpAgent {
            id: id.to_string(),
            name: "Test Agent".to_string(),
            command: "test-agent".to_string(),
            args: vec!["--experimental-acp".to_string()],
            env: BTreeMap::new(),
        }
    }

    #[test]
    fn the_retired_lynshen_acp_entry_is_dropped_on_load() {
        let text = r#"{"agents":[{"id":"lynshen-acp","name":"LynShen (ACP)","command":"lynshen","args":["acp"]},{"id":"gemini","name":"Gemini","command":"gemini","args":["--experimental-acp"]}]}"#;
        let agents = parse_registry(text).unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].id, "gemini");
    }

    #[test]
    fn registered_args_may_be_flags_but_stay_bounded() {
        // Fixed config flags like --experimental-acp are legitimate.
        validate_agent(&agent("gemini")).unwrap();
        let mut too_many = agent("gemini");
        too_many.args = vec!["x".to_string(); MAX_ARGS + 1];
        assert!(validate_agent(&too_many).is_err());
        let mut newline = agent("gemini");
        newline.args = vec!["a\nb".to_string()];
        assert!(validate_agent(&newline).is_err());
        let mut empty = agent("gemini");
        empty.args = vec![String::new()];
        assert!(validate_agent(&empty).is_err());
    }

    #[test]
    fn ids_names_and_commands_are_validated() {
        for bad in ["", "UPPER", "a b", "--x", "a/b"] {
            assert!(validate_agent(&agent(bad)).is_err(), "{bad:?}");
        }
        let mut flag_cmd = agent("ok");
        flag_cmd.command = "--rm".to_string();
        assert!(validate_agent(&flag_cmd).is_err());
        let mut no_name = agent("ok");
        no_name.name = String::new();
        assert!(validate_agent(&no_name).is_err());
        // Paths (with spaces) are fine as commands.
        let mut path_cmd = agent("ok");
        path_cmd.command = "/opt/agents/my agent/bin/agent".to_string();
        validate_agent(&path_cmd).unwrap();
    }

    #[test]
    fn env_entries_are_validated_like_backend_env() {
        let mut bad_env = agent("ok");
        bad_env
            .env
            .insert("DYLD_INSERT_LIBRARIES".to_string(), "/evil".to_string());
        assert!(validate_agent(&bad_env).is_err());
        let mut bad_name = agent("ok");
        bad_name.env.insert("1BAD".to_string(), "x".to_string());
        assert!(validate_agent(&bad_name).is_err());
        let mut ok_env = agent("ok");
        ok_env
            .env
            .insert("GEMINI_API_KEY".to_string(), "k".to_string());
        validate_agent(&ok_env).unwrap();
    }

    #[test]
    fn a_preset_entry_runs_its_program_and_takes_a_free_id() {
        let opencode = &PRESETS[0];
        let agents = vec![agent("opencode")];
        let added = preset_agent(opencode, &agents, None, false);
        assert_eq!(added.id, "opencode-2");
        assert_eq!(added.name, "OpenCode");
        assert_eq!(added.command, "opencode");
        assert_eq!(added.args, vec!["acp"]);
        validate_agent(&added).unwrap();
        assert!(runs_preset(&added, opencode));
        // Registered by hand, by path or with a Windows extension, it counts.
        for command in [
            "/opt/homebrew/bin/opencode",
            "C:\\npm\\opencode.CMD",
            "opencode.exe",
        ] {
            let by_hand = AcpAgent {
                command: command.to_string(),
                ..added.clone()
            };
            assert!(runs_preset(&by_hand, opencode), "{command}");
        }
        let other_args = AcpAgent {
            args: vec!["serve".to_string()],
            ..added.clone()
        };
        assert!(!runs_preset(&other_args, opencode));
        let other_program = AcpAgent {
            command: "opencode-helper".to_string(),
            ..added
        };
        assert!(!runs_preset(&other_program, opencode));
    }

    #[test]
    fn on_windows_a_preset_runs_the_binary_behind_an_npm_shim() {
        let root = std::env::temp_dir().join(format!("lynshen-acp-preset-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let npm = root.join("npm");
        let bin = npm.join("node_modules").join("opencode-ai").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(npm.join("opencode.cmd"), "@echo off").unwrap();
        std::fs::write(bin.join("opencode.exe"), "").unwrap();
        let opencode = &PRESETS[0];
        let shim = npm.join("opencode.cmd");
        assert_eq!(
            preset_command(opencode, Some(&shim), true),
            bin.join("opencode.exe").display().to_string()
        );
        // The extensionless shell shim too; not elsewhere, or off Windows.
        assert_eq!(
            preset_command(opencode, Some(&npm.join("opencode")), true),
            bin.join("opencode.exe").display().to_string()
        );
        assert_eq!(preset_command(opencode, Some(&shim), false), "opencode");
        let scoop = root.join("scoop").join("opencode.exe");
        assert_eq!(preset_command(opencode, Some(&scoop), true), "opencode");
        assert_eq!(preset_command(opencode, None, true), "opencode");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn parse_registry_validates_every_entry() {
        let ok = r#"{"agents":[{"id":"gemini","name":"Gemini CLI","command":"gemini","args":["--experimental-acp"]}]}"#;
        let agents = parse_registry(ok).unwrap();
        assert_eq!(agents[0].id, "gemini");
        assert_eq!(agents[0].args, vec!["--experimental-acp"]);
        assert!(agents[0].env.is_empty());
        // A hand-edited file with a smuggled entry is rejected wholesale.
        let bad = r#"{"agents":[{"id":"OK?","name":"x","command":"sh"}]}"#;
        assert!(parse_registry(bad).is_err());
        assert!(parse_registry("not json").is_err());
        // An explicitly emptied registry stays empty (no re-seeding).
        assert_eq!(
            parse_registry(r#"{"agents":[]}"#).unwrap(),
            Vec::<AcpAgent>::new()
        );
    }
}
