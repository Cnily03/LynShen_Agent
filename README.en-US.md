<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/brand/aogiri-horizontal-dark.svg">
    <img src="design/brand/aogiri-horizontal-light.svg" alt="Aogiri" width="440">
  </picture>

  <p>Coding agents, code, and project tools in one desktop workspace.</p>

  <p>
    <a href="https://www.lynshen.org/download">Download</a> ·
    <a href="https://github.com/Libra1337/LynShen_Agent/releases">All releases</a> ·
    <a href="https://github.com/Libra1337/LynShen_Agent/issues">Report an issue</a>
  </p>

  <p><a href="README.md">简体中文</a> · <strong>English</strong></p>
</div>

Manage multiple projects and sessions with LynShen, Claude Code, Codex, or any [ACP](https://agentclientprotocol.com)-compatible agent. Browse files, Git changes, terminals, and web pages alongside the conversation. Available for macOS, Windows, and Linux.

## Installation

| Platform | Package |
| --- | --- |
| macOS | `aarch64.dmg` for Apple silicon; `x64.dmg` for Intel |
| Windows x64 | `x64-setup.exe` |
| Linux x64 | `AppImage`, `.deb`, or `.rpm` |

Current packages are not notarized by Apple or signed for Windows, so your system may block the first launch. See the [installation guide](docs/install.md) for installation and security-prompt instructions.

You can update directly from an earlier LynShen Desktop release. Your sign-in, conversations, and settings are retained. Engines, accounts, and the `lynshen` command inside the app continue to use the LynShen name.

## Getting started

1. **Sign in or configure a model.** On first launch, sign in to a LynShen account in your browser, or skip sign-in and use your own API key or an existing agent account under Settings → Providers.
2. **Choose an agent.** LynShen is built in and ready to use. Install or add Claude Code, Codex, and ACP agents as needed, then select a model to begin.
3. **Open a project and send a task.** A project can contain multiple sessions. Ask the agent to read code, edit files, or run commands; plan mode is available for discussing an approach first.

When signing in with a LynShen account, the app receives credentials for the current device, not your account password. Signing out revokes that device's credentials.

## Everyday use

- **Control permissions:** Press `Shift+Tab` to change approval mode. For an approval request, press `1` to allow once, `2` to always allow, or `3` or `Esc` to deny.
- **Work with your project:** Use the file editor and Git diff, staging, commit, pull, and push tools. Install GitHub CLI to work with pull requests. Independent Git worktrees are available for parallel tasks.
- **Stay in one window:** Open a terminal or the built-in browser and bring web elements into the conversation. You can also switch to the agent's own terminal interface.
- **Extend your setup:** Manage models, skills, MCP servers, voice input, and image-generation models in Settings, or import conversations and configuration from other coding tools.
- **Keep tasks running:** Sessions run in a local background service. Closing the window or restarting the app does not stop an active task.

### Keyboard shortcuts

Use `⌘` on macOS and `Ctrl` on Windows and Linux.

| Shortcut | Action |
| --- | --- |
| `⌘K` | Command palette |
| `⌘N` | New session |
| `⌘P` | Quick file open |
| `⌘F` | Find in conversation |
| `` Ctrl+` `` | Open terminal |
| `⌘B` | Toggle sidebar |
| `⌘.` | Stop generation |
| `⌘/` | View all shortcuts |


## Remote access from your phone

Remote access is off by default. To enable it:

1. Open Settings → Remote Access and enable relay access.
2. Select Add Device, then scan the QR code with your phone or open the pairing link.
3. View sessions, send messages, and respond to approvals in your phone's browser.

Your phone and computer can be on different networks. Connection contents are end-to-end encrypted and cannot be read by the relay service. Paired devices can be revoked at any time.

## Data and privacy

- Prompts, code, and attachments are sent to the model provider used by the current session. Voice input is sent to your configured speech-recognition service.
- Credentials are stored locally in plaintext at `~/.lynshen/auth.json` by default. Optional static encryption is available, but it cannot protect against malicious software on your computer. Read the [security boundaries and usage notes](docs/secrets.md) before enabling it.
- After sign-in, model, engine, token usage, and duration statistics are collected. Prompts, code, and project paths are not reported. Some basic settings can sync across devices; keys, skills, and MCP configuration remain local.
- Anonymous usage statistics are enabled by default. They include feature-use counts, error types, and a random installation ID, but no conversations, code, or file paths. Turn them off under Settings → General.
- The app checks for and downloads updates from the LynShen website, then installs them after your confirmation.

## Troubleshooting

See the [installation guide](docs/install.md) for system security prompts, Linux dependencies, and permissions. For other problems, use Settings → General → Report Issue or open a [GitHub issue](https://github.com/Libra1337/LynShen_Agent/issues). Include your operating system, app version, agent, and error details; do not paste API keys or access tokens.

## Run from source

This repository contains the desktop app. Agent engines and the background service are in [LynShen-CLI](https://github.com/Libra1337/LynShen-CLI). Development requires Node.js 22, pnpm, stable Rust, and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/).

Place both repositories in the same parent directory, build the CLI, and start the desktop app:

```sh
git clone --recurse-submodules https://github.com/Libra1337/LynShen-CLI.git
(cd LynShen-CLI && cargo build)
git clone https://github.com/Libra1337/LynShen_Agent.git
cd LynShen_Agent
pnpm install
pnpm tauri dev
```

You can also use `LYNSHEN_BIN` to specify an existing `lynshen` executable. Common checks are `pnpm check` and `pnpm test`; run `pnpm build` before `cargo test --manifest-path src-tauri/Cargo.toml`. See [AGENTS.md](AGENTS.md) for architecture and development conventions.

## License

Code is licensed under the [Apache License 2.0](LICENSE); see also [NOTICE](NOTICE). The LynShen name and logo trademarks belong to LynShen Innovations INC. Third-party agents and tools belong to their respective owners.
