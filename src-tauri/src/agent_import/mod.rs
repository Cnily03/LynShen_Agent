//! 一键导入: the conversations, skills and MCP servers of the other coding
//! agents on this machine (Claude Code, Codex, opencode, zcode, omp, DSH),
//! listed in one scan and imported in one go. Their own folders are only read.
//!
//! - Conversations: Claude Code and Codex ones become a cleaned copy in the
//!   engine's own format (native_import) and continue on that engine.
//!   opencode, zcode, omp and DSH (DeepSeek Harness, dsh.rs) have no engine
//!   here, so theirs are converted into LynShen sessions (sessions.rs). Either way
//!   `~/.lynshen/native-imports.json` records the import, and importing again
//!   reuses the first copy.
//! - Skills are copied into `~/.lynshen/skills` (skills.rs).
//! - MCP servers are mapped to `mcp_servers` entries (mcp.rs). The desktop
//!   adds them through the daemon (`mcp_set`), as Settings → MCP does, so
//!   open sessions pick them up.

mod dsh;
mod mcp;
mod opencode;
mod sessions;
mod skills;

use crate::claude_history::{process_env, user_home, Env};
use crate::native_import::{self, Homes};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Where everything is read from and written to (injectable so tests run
/// against a fixture home).
pub struct Roots {
    pub home: PathBuf,
    /// `~/.lynshen`: sessions, skills, config.json and the import registry.
    pub lynshen: PathBuf,
    /// Claude Code's config folder: `$CLAUDE_CONFIG_DIR`, else `~/.claude`.
    pub claude: PathBuf,
    /// Claude Code's `.claude.json`: in `$CLAUDE_CONFIG_DIR` when that is
    /// set, else in the home folder.
    pub claude_json: PathBuf,
    pub codex: PathBuf,
    /// `$XDG_DATA_HOME` or `~/.local/share` (opencode's database), on every
    /// OS: opencode uses these paths on Windows too.
    pub data_home: PathBuf,
    /// `$XDG_CONFIG_HOME` or `~/.config` (opencode's config and skills).
    pub config_home: PathBuf,
    /// `$OPENCODE_DB`: the database opencode was told to use instead.
    pub opencode_db: Option<PathBuf>,
    /// zcode's session database.
    pub zcode_db: PathBuf,
    /// omp's agent folder (skills, MCP servers, sessions).
    pub omp_agent: PathBuf,
    /// Other folders omp may keep sessions in: profiles, `$PI_CODING_AGENT_SESSION_DIR`, the XDG data folder.
    pub omp_sessions: Vec<PathBuf>,
    /// DeepSeek Harness's home folders (`$DSH_HOME`, `~/.dsh`), the one in use first.
    pub dsh: Vec<PathBuf>,
}

/// `~/x` with the home folder (zcode and omp expand it in their settings).
fn expand_home(path: &str, home: &Path) -> PathBuf {
    match path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        Some(rest) => home.join(rest),
        None if path == "~" => home.to_path_buf(),
        None => PathBuf::from(path),
    }
}

impl Roots {
    fn real() -> Roots {
        let mut roots = Roots::from_env(&process_env, cfg!(windows), crate::lynshen_dir());
        // Also where DSH's desktop edition saved a moved home for apps started later.
        roots.dsh = dsh::homes(&process_env, cfg!(windows), &roots.home, &dsh::saved_homes());
        roots
    }

    /// The folders the other tools use, found as they find them, from the
    /// environment `env` (Windows: `windows`).
    fn from_env(env: Env, windows: bool, lynshen: PathBuf) -> Roots {
        let home = user_home(env, windows);
        let under = |parts: &[&str]| parts.iter().fold(home.clone(), |path, part| path.join(part));
        let xdg = |var: &str, fallback: &[&str]| {
            env(var).map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(|| under(fallback))
        };
        let data_home = xdg("XDG_DATA_HOME", &[".local", "share"]);
        let config_dir = env("CLAUDE_CONFIG_DIR").map(PathBuf::from);
        let opencode_db = env("OPENCODE_DB")
            .filter(|v| v.to_str() != Some(":memory:"))
            .map(|v| data_home.join("opencode").join(PathBuf::from(v)));
        // zcode: `$ZCODE_SESSION_DB_PATH` (or its old name), else
        // `storage.sessionDbPath` in its config, else the default.
        let zcode_config = crate::read_json(&under(&[".zcode", "cli", "config.json"]));
        let zcode_db = env("ZCODE_SESSION_DB_PATH")
            .or_else(|| env("ZCODE_SESSION_DB"))
            .map(|v| expand_home(&v.to_string_lossy(), &home))
            .or_else(|| zcode_config["storage"]["sessionDbPath"].as_str().map(|p| expand_home(p, &home)))
            .filter(|p| p.is_absolute())
            .unwrap_or_else(|| under(&[".zcode", "cli", "db", "db.sqlite"]));
        // omp: `~/.omp` (renamed by `$PI_CONFIG_DIR`), its agent folder
        // (`$PI_CODING_AGENT_DIR`), profiles under `profiles/<name>/agent`,
        // a session folder of its own (`$PI_CODING_AGENT_SESSION_DIR`), and
        // on Linux and macOS `$XDG_DATA_HOME/omp/sessions` once that exists.
        let omp_home = home.join(env("PI_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(".omp")));
        let omp_agent = env("PI_CODING_AGENT_DIR")
            .map(|v| expand_home(&v.to_string_lossy(), &home))
            .unwrap_or_else(|| omp_home.join("agent"));
        let mut omp_sessions: Vec<PathBuf> = env("PI_CODING_AGENT_SESSION_DIR")
            .map(|v| expand_home(&v.to_string_lossy(), &home))
            .into_iter()
            .collect();
        for profile in std::fs::read_dir(omp_home.join("profiles")).into_iter().flatten().flatten() {
            omp_sessions.push(profile.path().join("agent").join("sessions"));
        }
        if !windows && data_home.join("omp").is_dir() {
            omp_sessions.push(data_home.join("omp").join("sessions"));
        }
        let dsh = dsh::homes(env, windows, &home, &[]);
        Roots {
            lynshen,
            claude: config_dir.clone().unwrap_or_else(|| under(&[".claude"])),
            claude_json: config_dir.unwrap_or_else(|| home.clone()).join(".claude.json"),
            codex: native_import::codex_home(env, windows),
            config_home: xdg("XDG_CONFIG_HOME", &[".config"]),
            data_home,
            opencode_db,
            zcode_db,
            omp_agent,
            omp_sessions,
            dsh,
            home,
        }
    }

    fn native(&self) -> Homes {
        Homes { claude: self.claude.clone(), codex: self.codex.clone(), registry: self.registry() }
    }

    fn registry(&self) -> PathBuf {
        self.lynshen.join("native-imports.json")
    }

    fn zcode_db(&self) -> PathBuf {
        self.zcode_db.clone()
    }

    fn zcode_plugins(&self) -> PathBuf {
        self.home.join(".zcode").join("cli").join("plugins").join("cache")
    }

    fn omp_agent(&self) -> PathBuf {
        self.omp_agent.clone()
    }

    /// Every folder omp may keep sessions in, without repeats.
    fn omp_session_dirs(&self) -> Vec<PathBuf> {
        let mut dirs = vec![self.omp_agent.join("sessions")];
        for dir in &self.omp_sessions {
            if !dirs.contains(dir) {
                dirs.push(dir.clone());
            }
        }
        dirs
    }
}

/// A plugin another agent has installed: skills and MCP servers come with
/// it (`skills/`, `.mcp.json`).
pub(crate) struct Plugin {
    pub source: &'static str,
    pub name: String,
    pub dir: PathBuf,
}

/// Codex's `config.toml` as JSON (null when missing or unreadable).
fn codex_config(roots: &Roots) -> serde_json::Value {
    std::fs::read_to_string(roots.codex.join("config.toml"))
        .ok()
        .and_then(|text| text.parse::<toml::Table>().ok())
        .and_then(|table| serde_json::to_value(table).ok())
        .unwrap_or_default()
}

/// The newest version folder of a plugin cache entry (`<plugin>/<version>/`).
fn latest_version(dir: &Path) -> Option<PathBuf> {
    let key = |p: &PathBuf| -> Vec<(u64, String)> {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        name.split(['.', '-', '+'])
            .map(|part| part.parse::<u64>().map_or((0, part.to_string()), |n| (n, String::new())))
            .collect()
    };
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir() && !p.file_name().and_then(|n| n.to_str()).unwrap_or(".").starts_with('.'))
        .max_by(|a, b| key(a).cmp(&key(b)))
}

/// Installed plugins: Claude Code's registry (less the ones turned off in its
/// settings), the ones Codex's config enables, and every one in zcode's cache.
fn plugins(roots: &Roots) -> Vec<Plugin> {
    let mut out = Vec::new();
    let installed = crate::read_json(&roots.claude.join("plugins").join("installed_plugins.json"));
    let enabled = crate::read_json(&roots.claude.join("settings.json"));
    for (key, entry) in installed["plugins"].as_object().into_iter().flatten() {
        if enabled["enabledPlugins"][key] == serde_json::json!(false) {
            continue;
        }
        // One install (older registries) or one per scope.
        let entries = entry.as_array().cloned().unwrap_or_else(|| vec![entry.clone()]);
        let dir = entries.iter().rev().filter_map(|e| e["installPath"].as_str()).map(PathBuf::from).find(|p| p.is_dir());
        if let Some(dir) = dir {
            out.push(Plugin { source: "claude", name: key.split('@').next().unwrap_or(key).to_string(), dir });
        }
    }
    let config = codex_config(roots);
    for (key, entry) in config["plugins"].as_object().into_iter().flatten() {
        let Some((name, market)) = key.split_once('@') else { continue };
        if entry["enabled"] == serde_json::json!(false) || name.contains(['/', '\\']) || market.contains(['/', '\\']) {
            continue;
        }
        if let Some(dir) = latest_version(&roots.codex.join("plugins").join("cache").join(market).join(name)) {
            out.push(Plugin { source: "codex", name: name.to_string(), dir });
        }
    }
    for market in std::fs::read_dir(roots.zcode_plugins()).into_iter().flatten().flatten() {
        for plugin in std::fs::read_dir(market.path()).into_iter().flatten().flatten() {
            if let Some(dir) = latest_version(&plugin.path()) {
                out.push(Plugin { source: "zcode", name: plugin.file_name().to_string_lossy().into_owned(), dir });
            }
        }
    }
    out
}

#[derive(Serialize, Debug)]
pub struct Scan {
    pub sessions: Vec<sessions::Found>,
    /// Conversations that were found but could not be read, and why.
    pub skipped: Vec<sessions::Skipped>,
    /// The ones of them the source can name, each with why.
    pub unreadable: Vec<sessions::Unreadable>,
    pub skills: Vec<skills::Found>,
    pub mcp: Vec<mcp::Found>,
}

fn scan(roots: &Roots) -> (Scan, sessions::Report) {
    let mut report = sessions::Report::default();
    let sessions = sessions::scan(roots, &mut report);
    let scan = Scan {
        sessions,
        skipped: report.skipped.clone(),
        unreadable: report.unreadable.clone(),
        skills: skills::scan(roots),
        mcp: mcp::scan(roots),
    };
    (scan, report)
}

/// `text` with the home folder written `~` and the user's name left out, for
/// the log a bug report carries.
fn redact(text: &str, home: &Path) -> String {
    let home_text = home.to_string_lossy();
    let mut out = if home_text.len() > 1 { text.replace(home_text.as_ref(), "~") } else { text.to_string() };
    // The name may also appear in other paths (another drive, `/Users/x`).
    let user = home.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if user.chars().count() >= 3 {
        out = out.replace(&user, "<user>");
    }
    out
}

/// What a scan found per tool, what it skipped and where it looked, as lines
/// for the app's log (paths redacted).
fn scan_log(roots: &Roots, scan: &Scan, report: &sessions::Report, took: std::time::Duration) -> Vec<String> {
    let mut lines = vec![format!(
        "import scan ({} ms): {} conversations, {} skills, {} MCP servers",
        took.as_millis(),
        scan.sessions.len(),
        scan.skills.len(),
        scan.mcp.len()
    )];
    for source in ["claude", "codex", "opencode", "zcode", "omp", "dsh"] {
        let listed = scan.sessions.iter().filter(|s| s.source == source).count();
        let skipped: Vec<String> = scan
            .skipped
            .iter()
            .filter(|s| s.source == source)
            .map(|s| if s.count > 0 { format!("{} {}", s.count, s.reason) } else { s.reason.clone() })
            .collect();
        let notes: Vec<&str> = report.log.iter().filter_map(|l| l.strip_prefix(&format!("{source}: "))).collect();
        let mut line = format!("import scan {source}: {listed} listed");
        if !skipped.is_empty() {
            line.push_str(&format!("; skipped: {}", skipped.join(", ")));
        }
        if !notes.is_empty() {
            line.push_str(&format!("; {}", notes.join("; ")));
        }
        lines.push(redact(&line, &roots.home));
    }
    lines
}

#[derive(Deserialize, Debug)]
pub struct SessionPick {
    pub source: String,
    pub id: String,
    /// The folder the scan found it in (Claude Code and Codex copies are
    /// written per folder).
    #[serde(default)]
    pub cwd: String,
}

#[derive(Deserialize, Debug)]
pub struct SkillPick {
    pub source: String,
    pub path: String,
}

#[derive(Deserialize, Debug, Default)]
pub struct Selection {
    #[serde(default)]
    pub sessions: Vec<SessionPick>,
    #[serde(default)]
    pub skills: Vec<SkillPick>,
}

/// What became of one picked item.
#[derive(Serialize, Debug)]
pub struct Outcome {
    /// "session" or "skill".
    pub kind: &'static str,
    pub source: String,
    /// The item as the scan named it: a session id, a skill folder.
    pub key: String,
    /// "imported"; "existing" when an earlier import (or a skill of that
    /// name) is already there; "failed".
    pub status: &'static str,
    /// Sessions: the copy to open. Skills: the folder it was copied to.
    pub target: Option<String>,
    pub title: Option<String>,
    /// Sessions: the folder the conversation belongs to, and the engine its
    /// copy continues on ("lynshen", "claude", "codex").
    pub cwd: Option<String>,
    pub engine: Option<String>,
    /// Whether `cwd` is still a folder on this machine (only then can it be a
    /// project).
    pub cwd_exists: bool,
    pub error: Option<String>,
}

impl Outcome {
    fn failed(kind: &'static str, source: &str, key: &str, error: String) -> Outcome {
        Outcome {
            kind,
            source: source.to_string(),
            key: key.to_string(),
            status: "failed",
            target: None,
            title: None,
            cwd: None,
            engine: None,
            cwd_exists: false,
            error: Some(error),
        }
    }
}

fn apply(roots: &Roots, selection: Selection) -> Vec<Outcome> {
    // One import at a time, here or from a history picker: each extends the
    // registry.
    let _one = native_import::IMPORTING.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = Vec::new();
    for pick in &selection.sessions {
        out.push(match sessions::import(roots, pick) {
            Ok(done) => Outcome {
                kind: "session",
                source: pick.source.clone(),
                key: pick.id.clone(),
                status: if done.reused { "existing" } else { "imported" },
                target: Some(done.id),
                title: Some(done.title),
                cwd_exists: Path::new(&done.cwd).is_dir(),
                cwd: Some(done.cwd),
                engine: Some(done.engine.to_string()),
                error: None,
            },
            Err(e) => Outcome::failed("session", &pick.source, &pick.id, e),
        });
    }
    if !selection.skills.is_empty() {
        let found = skills::scan(roots);
        for pick in &selection.skills {
            out.push(match skills::import(roots, &found, &pick.source, &pick.path) {
                Ok((copied, dest)) => Outcome {
                    kind: "skill",
                    source: pick.source.clone(),
                    key: pick.path.clone(),
                    status: if copied { "imported" } else { "existing" },
                    target: Some(dest.display().to_string()),
                    title: None,
                    cwd: None,
                    engine: None,
                    cwd_exists: false,
                    error: None,
                },
                Err(e) => Outcome::failed("skill", &pick.source, &pick.path, e),
            });
        }
    }
    out
}

/// OpenCode's conversations of `cwd`, newest first, for a history picker:
/// `imported` names the daemon session a copy continues in.
pub fn opencode_sessions(cwd: &str) -> Vec<native_import::NativeSession> {
    opencode_sessions_in(&Roots::real(), cwd)
}

fn opencode_sessions_in(roots: &Roots, cwd: &str) -> Vec<native_import::NativeSession> {
    let registry = native_import::load_registry(&roots.registry());
    let mut report = sessions::Report::default();
    let mut found: Vec<sessions::Found> = opencode::scan(roots, opencode::Tool::Opencode, &registry, &mut report)
        .into_iter()
        .filter(|s| native_import::same_dir(&s.cwd, cwd))
        .collect();
    found.sort_by_key(|s| std::cmp::Reverse(s.updated_at_ms));
    found.truncate(50);
    found
        .into_iter()
        .map(|s| native_import::NativeSession {
            imported: opencode::copied_in_opencode(&registry, opencode::Tool::Opencode, &s.id),
            title: s.title,
            mtime_ms: s.updated_at_ms,
            origin: "OpenCode".to_string(),
            unreadable: None,
            id: s.id,
        })
        .collect()
}

/// DSH's conversations of `cwd`, newest first, for a history picker; the
/// ones that cannot be imported are listed with why (`unreadable`).
pub fn dsh_sessions(cwd: &str) -> Vec<native_import::NativeSession> {
    let roots = Roots::real();
    let registry = native_import::load_registry(&roots.registry());
    dsh::picker(&roots, &registry, cwd)
}

/// Converts DSH conversation `id` into a LynShen session of the project
/// `cwd` (an earlier copy is reused), for a history picker.
pub fn import_dsh(cwd: &str, id: &str) -> Result<native_import::ImportedSession, String> {
    let pick = SessionPick { source: dsh::SOURCE.to_string(), id: id.to_string(), cwd: cwd.to_string() };
    let done = sessions::import(&Roots::real(), &pick)?;
    Ok(native_import::ImportedSession { id: done.id, title: done.title })
}

// --- commands ----------------------------------------------------------------

/// Everything the other agents on this machine have that LynShen can take
/// over: conversations (all folders), skills and MCP servers.
#[tauri::command(async)]
pub fn import_scan() -> Scan {
    let roots = Roots::real();
    let started = std::time::Instant::now();
    let (found, report) = scan(&roots);
    for line in scan_log(&roots, &found, &report, started.elapsed()) {
        crate::desktop_log(&line);
    }
    found
}

/// Imports the picked conversations and skills (MCP servers go through the
/// daemon, see the module docs); one outcome per item, in order.
#[tauri::command(async)]
pub fn import_apply(selection: Selection) -> Vec<Outcome> {
    apply(&Roots::real(), selection)
}

#[cfg(test)]
pub(crate) mod testutil {
    use super::Roots;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// A fresh fake home for one test, its folders found as on this OS with
    /// nothing else set.
    pub fn roots(name: &str) -> Roots {
        let home = fake_home(name);
        let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        let env = move |k: &str| (k == key).then(|| home.clone().into_os_string());
        Roots::from_env(&env, cfg!(windows), fake_home_path(name).join(".lynshen"))
    }

    fn fake_home_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("lynshen-agent-import-{}-{name}", std::process::id()))
    }

    /// Everything a scan lists, and what it reported.
    pub fn scan_all(roots: &Roots) -> (Vec<super::sessions::Found>, super::sessions::Report) {
        let mut report = super::sessions::Report::default();
        let found = super::sessions::scan(roots, &mut report);
        (found, report)
    }

    /// An empty folder for a fake home.
    pub fn fake_home(name: &str) -> PathBuf {
        let home = fake_home_path(name);
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        home
    }

    pub fn write(path: &Path, text: &str) -> PathBuf {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
        path.to_path_buf()
    }

    /// Copies a fixture folder.
    pub fn copy_tree(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for entry in fs::read_dir(from).unwrap().flatten() {
            let target = to.join(entry.file_name());
            if entry.path().is_dir() {
                copy_tree(&entry.path(), &target);
            } else {
                fs::copy(entry.path(), &target).unwrap();
            }
        }
    }

    /// The Codex home tests/fixtures/codex/make-fixtures.mjs writes:
    /// paginated, legacy and compressed rollouts of one Windows folder.
    pub fn codex_fixtures() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join("codex").join("home").join(".codex")
    }

    /// The folder every fixture thread ran in (make-fixtures.mjs `CWD`).
    pub const CODEX_FIXTURE_CWD: &str = r"D:\我要干大活\三角帧不掉洲";
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn env_of(pairs: Vec<(&'static str, PathBuf)>) -> impl Fn(&str) -> Option<OsString> {
        move |key: &str| pairs.iter().find(|(k, _)| *k == key).map(|(_, v)| v.clone().into_os_string())
    }

    #[test]
    fn windows_folders_come_from_the_profile() {
        let base = testutil::fake_home("discover-win");
        let profile = base.join("Users").join("demo");
        let env = env_of(vec![("USERPROFILE", profile.clone()), ("HOME", base.join("msys"))]);
        let roots = Roots::from_env(&env, true, base.join(".lynshen"));
        assert_eq!(roots.home, profile, "a Git Bash HOME is not where the tools keep their files");
        assert_eq!(roots.claude, profile.join(".claude"));
        assert_eq!(roots.claude_json, profile.join(".claude.json"));
        assert_eq!(roots.codex, profile.join(".codex"));
        assert_eq!(roots.data_home, profile.join(".local").join("share"));
        assert_eq!(roots.zcode_db, profile.join(".zcode").join("cli").join("db").join("db.sqlite"));
        assert_eq!(roots.omp_session_dirs(), vec![profile.join(".omp").join("agent").join("sessions")]);
        assert_eq!(roots.opencode_db, None);
        assert_eq!(roots.dsh, vec![profile.join(".dsh")]);
    }

    #[test]
    fn overrides_in_the_environment_are_followed() {
        let base = testutil::fake_home("discover-env");
        let home = base.join("home");
        let xdg = base.join("xdg");
        std::fs::create_dir_all(xdg.join("omp")).unwrap();
        std::fs::create_dir_all(home.join(".omp").join("profiles").join("work")).unwrap();
        let env = env_of(vec![
            ("HOME", home.clone()),
            ("CLAUDE_CONFIG_DIR", base.join("claude-alt")),
            ("CODEX_HOME", base.join("codex-alt")),
            ("XDG_DATA_HOME", xdg.clone()),
            ("XDG_CONFIG_HOME", PathBuf::from("relative/is/ignored")),
            ("OPENCODE_DB", PathBuf::from("work.db")),
            ("ZCODE_SESSION_DB", base.join("z.sqlite")),
            ("PI_CODING_AGENT_SESSION_DIR", base.join("omp-sessions")),
            ("DSH_HOME", base.join("dsh-moved")),
        ]);
        let roots = Roots::from_env(&env, false, base.join(".lynshen"));
        assert_eq!(roots.claude, base.join("claude-alt"));
        assert_eq!(roots.claude_json, base.join("claude-alt").join(".claude.json"));
        assert_eq!(roots.codex, base.join("codex-alt"));
        assert_eq!(roots.data_home, xdg);
        assert_eq!(roots.config_home, home.join(".config"));
        assert_eq!(roots.opencode_db, Some(xdg.join("opencode").join("work.db")));
        assert_eq!(roots.zcode_db, base.join("z.sqlite"));
        assert_eq!(roots.dsh, vec![base.join("dsh-moved"), home.join(".dsh")]);
        assert_eq!(
            roots.omp_session_dirs(),
            vec![
                home.join(".omp").join("agent").join("sessions"),
                base.join("omp-sessions"),
                home.join(".omp").join("profiles").join("work").join("agent").join("sessions"),
                xdg.join("omp").join("sessions"),
            ]
        );
        // An absolute OPENCODE_DB is used as it is; an in-memory one is no file.
        let abs = env_of(vec![("HOME", home.clone()), ("OPENCODE_DB", base.join("o.db"))]);
        assert_eq!(Roots::from_env(&abs, false, base.clone()).opencode_db, Some(base.join("o.db")));
        let mem = env_of(vec![("HOME", home.clone()), ("OPENCODE_DB", PathBuf::from(":memory:"))]);
        assert_eq!(Roots::from_env(&mem, false, base.clone()).opencode_db, None);
        // zcode's own setting, `~` expanded.
        testutil::write(&home.join(".zcode/cli/config.json"), r#"{"storage": {"sessionDbPath": "~/zdb/s.sqlite"}}"#);
        let plain = env_of(vec![("HOME", home.clone())]);
        assert_eq!(Roots::from_env(&plain, false, base.clone()).zcode_db, home.join("zdb").join("s.sqlite"));
    }

    #[test]
    fn logged_paths_leave_the_user_out() {
        let home = Path::new("/Users/someone");
        assert_eq!(
            redact("claude: 3 in /Users/someone/.claude/projects; D:/Data/someone/x", home),
            "claude: 3 in ~/.claude/projects; D:/Data/<user>/x"
        );
    }

    /// Scans this machine's real agents (read-only) and converts a few of the
    /// opencode / zcode / omp conversations into a temporary LynShen home.
    /// `cargo test --lib real_machine -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_machine_scan_and_convert() {
        let real = Roots::real();
        let started = std::time::Instant::now();
        let (found, report) = scan(&real);
        for line in scan_log(&real, &found, &report, started.elapsed()) {
            println!("{line}");
        }
        // For a look at the page with this machine's data (tests/browser).
        if let Some(path) = std::env::var_os("IMPORT_SCAN_JSON") {
            std::fs::write(path, serde_json::to_string(&found).unwrap()).unwrap();
        }
        let count = |s: &str| found.sessions.iter().filter(|x| x.source == s).count();
        for source in ["claude", "codex", "opencode", "zcode", "omp", "dsh"] {
            println!("{source}: {} conversations", count(source));
        }
        for s in found.sessions.iter().take(3) {
            println!("  e.g. {} {} {:?} {} prompts", s.source, s.id, s.title, s.messages);
        }
        println!("skills: {}", found.skills.len());
        for s in &found.skills {
            println!("  {} {} {} present={}", s.source, s.plugin.as_deref().unwrap_or("-"), s.name, s.present);
        }
        println!("mcp: {}", found.mcp.len());
        for m in &found.mcp {
            println!("  {} {} {} present={} {}", m.source, m.from, m.name, m.present, m.entry);
        }
        // Converted copies go to a temporary LynShen home, never ~/.lynshen.
        let tmp = testutil::roots("real");
        let into = Roots { lynshen: tmp.lynshen.clone(), ..Roots::real() };
        for source in ["opencode", "zcode", "omp", "dsh"] {
            for s in found.sessions.iter().filter(|x| x.source == source).take(3) {
                let pick = SessionPick { source: s.source.clone(), id: s.id.clone(), cwd: s.cwd.clone() };
                let done = sessions::import(&into, &pick).expect("converts");
                let dir = sessions::lynshen_session_dir(&into.lynshen, &done.cwd);
                let journal = std::fs::read_to_string(dir.join(format!("{}.jsonl", done.id))).unwrap();
                println!("{source} {} → {} ({} journal lines) in {}", s.id, done.id, journal.lines().count(), dir.display());
            }
        }
    }
}
