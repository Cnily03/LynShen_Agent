# ACP backend (Agent Client Protocol)

The desktop can drive any agent CLI that speaks the
[Agent Client Protocol](https://agentclientprotocol.com) (JSON-RPC 2.0 over
stdio, protocol v1) as a fourth engine backend, next to the native `lynshen`,
`codex` and `claude` adapters. OpenCode (`opencode acp`) is a preset: Settings
offers it in one click. Other agents (e.g. `gemini --experimental-acp`) can be
registered by hand.

## Where the pieces live

| piece | file |
|---|---|
| Agent registry (Rust-owned, validated) | `src-tauri/src/acp_registry.rs` → `~app-config/acp-agents.json` |
| Process and JSON-RPC ↔ AgentEvents | the daemon, LynShen-CLI `crates/daemon/src/engines/acp.rs` |
| Session start (registry entry → daemon `engine: "acp"`) | `src/lib/session.svelte.ts` (`#spawn`) |
| Settings UI (presets, add / edit / remove agents) | `src/lib/settings/AcpSection.svelte` |
| Presets (OpenCode) | `acp_registry.rs` (`PRESETS`, `acp_presets`, `acp_preset_add`) |
| Session environment (OpenCode's server password) | `src/lib/backends/acp-agents.ts` (`agentEnv`) |
| New-session picker rows | `src/lib/Composer.svelte` (below the native engines) |

## Launch model: the registry names the command

A registered agent is `{ id, name, command, args, env }`. Every entry is
re-validated on **every read and write** of the registry file, so a
hand-edited `acp-agents.json` cannot smuggle malformed entries into a spawn.
A session starts from the entry: the desktop sends its command line to the
daemon (`session_create` with `engine: "acp"`), which only local clients may
do — paired phones can watch and drive an ACP session but never start one.
The daemon resolves `command` on its `PATH` and runs `command args…` with
`env` on top of its own environment.

## Protocol mapping

Handshake per child process (initial spawn and every crash restart):
`initialize` (protocol v1, client advertises **no** fs/terminal capability) →
`session/new` (project cwd, no MCP servers) → ready. Then one
`session/prompt` per user turn; the turn is over when the prompt request
answers with a `stopReason`.

### What maps

| ACP | desktop surface |
|---|---|
| `session/update: agent_message_chunk` | assistant text stream |
| `session/update: agent_thought_chunk` | reasoning stream (thinking block) |
| `session/update: tool_call` / `tool_call_update` | ToolCard (start / progress / done), `content` + `locations` folded into the card body |
| tool-call `diff` content | ToolCard diff view (rendered as a unified diff) |
| `session/update: plan` | Plan panel in the right dock (entries + status) |
| `session/request_permission` | ApprovalCard; allow / always / deny picks the matching advertised option (`allow_once` / `allow_always` / `reject_once` / `reject_always`), no usable option ⇒ `cancelled` |
| stop button | `session/cancel` (outstanding permission requests are answered `cancelled` first, per spec) |
| `stopReason: refusal` / `max_tokens` / `max_turn_requests` | info notice in the transcript |
| `session/new` model info (when the agent reports it) | model label (read-only) |
| image attachments | `image` content blocks with `file://` uris, only when the agent advertised `promptCapabilities.image` — agents that require inline base64 data won't see them |
| agent stderr | dimmed `[acp]` info lines (ANSI stripped) |

ACP has no turn-started notification, so the busy indicator flips on the first
frame the agent sends after a prompt goes out. While a turn is in flight,
further user messages queue adapter-side and run as their own turns once the
current one settles (same UX as claude's stdin queue).

### What deliberately does NOT map (conservative caps)

- **Approval modes** — ACP session modes are agent-defined ids with no provable
  mapping onto the desktop's ask / auto-edit / full-auto trio. The picker is
  hidden; the desktop's startup mode sync is swallowed.
- **Steer** — no mid-turn injection in ACP; messages sent while busy become
  the next turn instead.
- **Hunk-subset approvals** — permission responses are whole-call option
  picks; there is no per-hunk protocol.
- **Resume picker** — the `/resume` picker and history list stay off: the
  daemon cannot list an agent's conversations. A tab still reopens its own
  conversation: the daemon (LynShen CLI after 0.6.3) keeps the agent's
  session id and asks for it with `session/load` (the replay becomes the
  transcript) or `session/resume`. An agent that offers neither starts a new
  conversation in the reopened tab, with a notice. Older daemons always start
  a new one.
- **Model picker** — `session/set_model` is optional; off until provable.
- **MCP live management** — `session/new` accepts an MCP server list, but
  there is no runtime add/remove/reconnect RPC; the desktop passes none and
  hides the management UI.
- **Skills, checkpoints, branch tree, goals tab, sub-agents, context/usage
  telemetry, /compact** — no ACP v1 equivalent.
- **Slash commands** — `available_commands_update` is received but there is no
  invocation RPC (commands are plain prompt text), so no command surface.
- **Client fs / terminal services** — the client advertises neither;
  `fs/read_text_file`, `fs/write_text_file` and `terminal/*` requests are
  declined with a JSON-RPC error so the agent falls back to its own tools
  instead of hanging.

## OpenCode

The preset registers `opencode acp` (OpenCode 1.19: `loadSession`, model and
mode config options, `usage_update`). Adding it on Windows stores the
`opencode.exe` behind an npm shim (`node_modules/opencode-ai/bin/`), so
stopping a session stops OpenCode and not only the `cmd.exe` that ran the
shim. `opencode acp` also serves its HTTP API on 127.0.0.1 (port 4096 when
free) without a password unless `OPENCODE_SERVER_PASSWORD` is set: each
session gets a random one (`agentEnv`) unless the entry sets its own.

OpenCode asks for permission only for `external_directory`, `doom_loop` and
`.env` reads by default; every other tool runs without asking. Its sessions
are its own (`~/.local/share/opencode/opencode.db`), so they also show in
OpenCode's TUI. Design notes and the next steps (approval modes, models on the
LynShen gateway, importing OpenCode sessions to continue on OpenCode):
`opencode-backend-design.md` in the owner's notes.

## Adding an agent

Settings → Behavior → ACP agents → *Add agent*: a display name, a command
(name or absolute path), optional fixed arguments (quoted tokens supported)
and optional per-agent `KEY=VALUE` env lines. Registered agents appear at the
bottom of the engine picker on new (virgin) sessions; each project remembers
its last choice. Bounds: ≤ 32 agents, ≤ 32 args, names/commands/args length-
and control-character-checked, env names/values validated like custom backend
env (dangerous variables rejected).

Tests: `src/lib/backends/acp.test.ts` (adapter, fake agent frames),
`src/lib/backends/acp-agents.test.ts` (settings-form helpers), and the
registry/spawn tests in `src-tauri/src/acp_registry.rs` / `backend.rs`.
