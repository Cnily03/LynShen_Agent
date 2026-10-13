# Aogiri (desktop app)

## Terms

- **Aogiri / LynShen**: the desktop app is Aogiri (Chinese name 梧桐); up to 0.5.x it was called LynShen Desktop. Everything else keeps the name LynShen: the engine (the `lynshen` backend, `BackendId` `lynshen`), the LynShen account and gateway, the relay, the company and lynshen.org. Identifiers keep it too: the bundle identifier `com.lynshen.desktop`, `~/.lynshen`, `~/Documents/LynShen`, the `lynshen://` scheme, `LYNSHEN_*` variables, the `lynshen-desktop` OAuth client. Write Aogiri only where the text means this app. What an update from the old name needs: docs/rename-aogiri-notes.md.
- **后端 (backend)**: the agent backend — the coding-agent engine that runs a session: LynShen's own engine, Claude Code, Codex, or an ACP agent. In code it is `BackendId` / `backendId`; the daemon protocol calls it `engine`. It never means a server side, the daemon (the UI calls that 后台服务, "background service"), or a model provider (`provider`).
- **草稿 (draft session)**: a new session before its first message. It has a chosen backend, model and effort but no engine and no daemon session; the first op sent to it starts the engine (`markDraft` in `src/lib/backends/router.ts`, `SessionStore.#startDraft`). Until then nothing may spawn a backend: switching backend, model or effort only records the choice.

## Recurring defects

- An `$effect` that calls store methods reads that store's state too, so the store's own changes re-run it (the web chat reset a new conversation as its first message saved it). Wrap the calls in `untrack` and depend only on the inputs that should drive it.
