# Aogiri

Aogiri（中文名梧桐）是一个桌面应用，用来让编程智能体（coding agent）在你的项目里读代码、改代码、跑命令。一个窗口里可以开多个项目和多个会话。每个会话选一个智能体：LynShen 自带的引擎、Claude Code、Codex，或者任何支持 [ACP](https://agentclientprotocol.com) 的智能体。对话旁边是这个项目的文件、Git、终端和内置浏览器。

0.5.x 及以前的版本叫 LynShen Desktop。改名只改了应用的名字：引擎仍叫 LynShen，账号仍是 LynShen 账号，数据目录 `~/.lynshen` 和 `lynshen` 命令不变。已安装的 LynShen 会自动更新成 Aogiri，见下面的「从 LynShen 更新」。

本仓库是桌面端（Tauri 2 + Svelte 5）。智能体引擎、后台服务和 `lynshen` 命令行在 [LynShen-CLI](https://github.com/Libra1337/LynShen-CLI) 仓库。

[English](#english)

## 下载和安装

macOS 和 Windows 的安装包在 [LynShen 官网下载页](https://www.lynshen.org/download)。全部平台（包括 Linux）的安装包都在 [GitHub Releases](https://github.com/Libra1337/LynShen_Agent/releases)。

| 系统 | 文件 |
| --- | --- |
| macOS（Apple 芯片） | `Aogiri_<版本>_aarch64.dmg` |
| macOS（Intel） | `Aogiri_<版本>_x64.dmg` |
| Windows x64 | `Aogiri_<版本>_x64-setup.exe`，或 `Aogiri_<版本>_x64_en-US.msi` |
| Linux x64 | `Aogiri_<版本>_amd64.AppImage`、`Aogiri_<版本>_amd64.deb` 或 `Aogiri-<版本>-1.x86_64.rpm` |

0.5.x 及以前的安装包以 `LynShen` 开头。

安装包没有经过 Apple 公证，也没有 Windows 代码签名，所以第一次打开时系统会拦截。各系统的放行步骤见 [docs/install.md](docs/install.md)。在 macOS 上，如果系统提示「Aogiri 已损坏」，在终端执行下面的命令，然后重新打开：

```sh
xattr -dr com.apple.quarantine /Applications/Aogiri.app
```

装好以后，应用自己检查更新：启动时检查一次，之后每 10 分钟检查一次。新版本在后台下载并校验签名，下载完成后你点「立即重启」才安装。如果当前版本已停止支持，应用会要求先更新再使用。正在运行的任务在后台服务里继续，重启窗口不会中断它们。

### 从 LynShen 更新

已安装的 LynShen 0.5.x 照常提示更新，更新后应用的名字、窗口标题和图标变成 Aogiri。登录状态、对话、设置、技能、`~/.lynshen` 和 `~/Documents/LynShen` 里的文件都不动，也不需要重新授权。

- **Windows（setup.exe）**：安装程序先卸载旧的 LynShen，再把 Aogiri 装到 `%LOCALAPPDATA%\Aogiri`（自选过目录的，装到旁边的 `Aogiri` 目录）。「应用和功能」里只剩 Aogiri 一项。开始菜单和桌面快捷方式、任务栏固定和开机自启都改成指向 Aogiri。
- **Windows（MSI）**：新的 MSI 替换旧的 LynShen，装到 `C:\Program Files\Aogiri`，旧的快捷方式和目录一并删除；开机自启在 Aogiri 第一次启动时改过来。
- **macOS**：应用在原位置更新，文件仍叫 `/Applications/LynShen.app`，所以访达和启动台里显示的还是 LynShen，打开后是 Aogiri。不需要再从 dmg 装一份 Aogiri，否则会有两个应用。
- **Linux**：deb 和 rpm 包改名为 `aogiri`，更新时替换旧的 `lyn-shen` 包；命令 `LynShen` 保留，启动的是 Aogiri。AppImage 在原文件上更新，文件名不变。

## 第一次打开

第一次启动会打开设置向导，按顺序有这几步：

1. **依赖安装。** 检查 Node.js（含 npm）和 Git，这两个是必需的。FFmpeg 用于录屏，GitHub CLI 用于 Pull Request，这两个可以跳过。缺少的工具可以一键安装。在 Linux 上应用不会自己执行 `sudo`，它给出命令，你复制到终端运行。
2. **账号。** 登录 LynShen 账号，或填写自己的 API Key，也可以先跳过。
3. **编程智能体。** 选择新对话默认用哪个智能体。Claude Code 和 Codex 是可选的，需要时在这一步或「设置 → 编码智能体」里安装，安装来源是它们的官方渠道。
4. **模型。** 选一个模型，然后点「确认模型」。
5. **外观和基础操作。** 选择主题和语言，看几个常用快捷键。

LynShen 账号在 [LynShen Console](https://www.lynshen.org)（LynShen 官网）注册和管理。登录后，应用通过 LynShen 网关调用模型，使用账号的额度。

登录用浏览器授权。应用打开官网，你在网页上登录或注册，核对网页和应用显示的代码，然后同意授权。应用拿到的是这台设备专用的 30 天凭据，不是你的密码，也不是网站的登录状态。在应用里退出登录会吊销这份凭据。你也可以在官网控制台的 API 密钥管理里删除对应的 `LynShen Desktop` 项（官网上的名字没有改）。

应用自带一份 LynShen CLI，放在 `~/.lynshen/bin`，随应用一起更新。如果想在终端里直接用 `lynshen` 命令，到「设置 → 编码智能体」里把它加成终端命令。

## 主要功能

**会话和智能体**

- 每个会话用一个智能体：LynShen 引擎、Claude Code、Codex，或在「设置 → 外部智能体（ACP）」里添加的 ACP 智能体（例如 `gemini --experimental-acp`）。
- Claude Code 和 Codex 会话可以用本机已有的登录，也可以走 LynShen 网关，用 LynShen 账号的额度。
- 不属于任何项目的对话（独立对话）各有一个文件夹，在 `~/Documents/LynShen`（文稿/LynShen）下，按日期和第一条消息命名，不同对话的文件不会混在一起。
- 「设置 → 从其他工具导入」一次扫描本机的 Claude Code、Codex、opencode、zcode 和 omp，列出它们的历史对话、技能和 MCP 服务器，勾选后一键导入。对话导入后在 Aogiri 里接着聊。应用只复制，不改原文件。
- 想用智能体原本的终端界面时，可以在标签页里运行真正的 `lynshen`、`codex` 或 `claude` TUI。从命令面板（`⌘K`）或面板的「+」菜单打开。

**审批和计划**

- 审批模式决定智能体改文件、跑命令之前是否先问你。在输入框里用 `Shift+Tab` 切换。
- 审批卡片的快捷键：`1` 允许一次，`2` 始终允许，`3` 或 `Esc` 拒绝。
- 计划模式（LynShen、Claude Code、Codex 会话）：智能体先只读调研，再交一份计划。计划在对话右侧单独的页面里边写边显示。你可以批准并选择执行时的审批模式，也可以让它修改计划。
- 窗口在后台时，如果有命令等你批准，或有计划等你确认，应用会发系统通知。

**项目工具**

- 文件：浏览和编辑项目文件，`⌘P` 快速打开。
- Git：暂存、提交、丢弃改动、拉取、推送、看 diff。装了 GitHub CLI 后可以查看和创建 Pull Request。还可以用 git worktree 开并行任务，做完合并回主仓库。
- 终端：`` Ctrl+` `` 打开。
- 浏览器：在应用里打开网页（例如本地开发服务器的页面），可以选中页面元素并在消息里引用它。

**模型、技能和其他**

- 模型来源：LynShen 网关（登录 LynShen 账号）、你自己的 API Key，或智能体自己的登录。在「设置 → 提供商」里管理。
- 生图：智能体可以画图和改图。在模型菜单里选一个生图模型（名字带 image 之类的），它就成为生图模型，对话模型不变。
- 技能市场：「设置 → 技能市场」，从 Anthropic 和社区仓库（Ikaleio、Superpowers、Composio）安装技能。Claude Code 会话装到 `~/.claude/skills`，其他会话装到 `~/.lynshen/skills`。
- MCP 服务器：「设置 → MCP 服务器」。
- 语音输入、截屏和录屏，结果作为消息附件发给智能体。录屏需要 FFmpeg。

## 用手机远程控制

所有会话都运行在本机的后台服务（`lynshen daemon`）里，所以关掉窗口后任务还会继续。你可以用手机查看会话、发消息、处理审批：

1. 打开「设置 → 远程访问」，打开「允许通过中继远程访问」。
2. 点「添加设备」，用手机相机扫二维码，或把链接发到手机上打开。二维码只能用一次。
3. 手机浏览器打开 `app.lynshen.org` 上的远程页面，配对完成后就能连上这台电脑。

手机和电脑不需要在同一个网络。连接经过 LynShen 中继，内容端到端加密，中继只看到连接元数据。已配对的设备列在同一页，可以随时吊销。

## 快捷键

macOS 用 `⌘`，Windows 和 Linux 用 `Ctrl`。

| 快捷键 | 作用 |
| --- | --- |
| `⌘K` | 命令面板 |
| `⌘N` | 新建会话 |
| `⌘P` | 快速打开文件 |
| `⌘F` | 在对话中查找 |
| `⌘B` | 收起或展开侧栏 |
| `⌘,` | 设置 |
| `⌘/` | 全部快捷键 |
| `⌘.` | 停止生成 |
| `⌘⇧N` | 记下想法 |

## 数据和隐私

- **凭据**保存在 `~/.lynshen/auth.json`，默认是明文。在 `~/.lynshen/config.json` 里设置 `"encrypt_secrets": true` 后，凭据会加密保存。加密方式和它能防什么、不能防什么，见 CLI 仓库的 [docs/secrets.md](https://github.com/Libra1337/LynShen-CLI/blob/main/docs/secrets.md)。
- **提示词和代码**发给当前会话的模型服务：LynShen 网关、你的 API Key 对应的服务商，或智能体自己的服务。
- **远程访问**默认关闭。打开后，后台服务保持一条到 `wss://app.lynshen.org/relay/v1` 的连接。
- **语音输入**把录音发给你在「设置 → 语音」里配置的语音识别服务。
- **用量**：登录 LynShen 账号后，后台服务把每一轮对话的 token 数、模型、引擎和耗时上报到你的账号，用于在多台电脑之间汇总用量。不上报提示词、代码和项目路径。
- **设置同步**：语言、主题、默认模型、网络和语音等基础设置通过账号在电脑之间同步。密钥、自定义服务商、MCP、技能和 Agent 只留在本机。
- **匿名使用数据**：应用统计功能的使用次数和错误类型，带一个随机的安装 ID，不含对话、代码和文件路径。默认开启，可以在「设置 → 通用」里关闭「发送匿名使用数据」。
- **更新**：应用从 LynShen 官网检查和下载更新。

## 从源码构建

需要：

- Node.js 22 和 pnpm（版本见 `package.json` 的 `packageManager`）
- Rust 稳定版工具链
- 你所在平台的 [Tauri 依赖](https://v2.tauri.app/start/prerequisites/)
- 一个 `lynshen` 可执行文件

开发版按这个顺序找 `lynshen`：`LYNSHEN_BIN`、设置里指定的路径、PATH、常见安装目录，最后是旁边 `LynShen-CLI` 仓库的 `target/debug` 或 `target/release`。所以最简单的做法是把两个仓库克隆到同一个目录下：

```sh
git clone --recurse-submodules https://github.com/Libra1337/LynShen-CLI.git
(cd LynShen-CLI && cargo build)

git clone https://github.com/Libra1337/LynShen_Agent.git
cd LynShen_Agent
pnpm install
pnpm tauri dev
```

常用命令：

```sh
pnpm check                                          # svelte-check
pnpm test                                           # vitest
pnpm build                                          # 构建前端（Rust 测试之前要先跑）
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
pnpm tauri build                                    # 打包，不含内置 CLI
```

环境变量：

- `LYNSHEN_BIN`、`CLAUDE_BIN`、`CODEX_BIN`：指定对应引擎的可执行文件。
- `LYNSHEN_CWD`：没有指定目录时智能体的工作目录，默认是启动应用的目录。

正式版内置的 CLI 版本固定在 `src-tauri/lynshen-cli.ref`（提交）和 `src-tauri/lynshen-cli.version`（版本号）。发布流程按这个提交构建 CLI，放到 `src-tauri/binaries/lynshen-cli-<目标三元组>`，再用 `pnpm tauri build --config src-tauri/tauri.bundle.conf.json` 打包。

设置里的服务商列表来自 `src/lib/providers/catalog.json`，它是 [models.dev](https://models.dev) 的一个子集。用 `pnpm catalog:refresh` 更新（需要联网）。

### 代码结构

```
WebView (Svelte 5)  ── WebSocket ──▶  lynshen daemon  ──▶  LynShen / Claude Code / Codex / ACP
       │
       └── invoke ──▶  src-tauri (Rust)：启动 daemon、文件、git、PTY、配置、安装、更新
```

- 后台服务监听 `ws://127.0.0.1:7788`，运行所有引擎，把各自的协议转成同一种事件流。协议见 CLI 仓库的 [docs/daemon-protocol.md](https://github.com/Libra1337/LynShen-CLI/blob/main/docs/daemon-protocol.md)。
- `src/lib/chat.svelte.ts` 把事件流转成对话状态。
- `src/routes/+page.svelte` 是主窗口，`src/lib/workbench/` 是分栏布局，`src/routes/remote/` 和 `src/lib/remote/` 是手机远程页面。
- `src-tauri/src/` 是 Rust 端命令。
- 没有界面的逻辑放在普通 TypeScript 模块里，旁边有单元测试。

## 发布

1. 同步版本号：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`，再更新 `src-tauri/Cargo.lock`。发布时 `scripts/check-release-version.mjs` 检查前三个文件和 tag 一致。
2. 写更新公告 `release-notes/<版本>.md`，中文，每行以「新增」「优化」或「修复」开头。没有这个文件，发布流程会失败。
3. 推送 tag `v<版本>`。GitHub Actions 构建 macOS（Apple 芯片和 Intel）、Windows、Linux 四个平台，上传到同一个草稿 Release。检查完整后公开 Release，并同步到官网的下载和更新服务。

细节和服务器配置见 [docs/updater.md](docs/updater.md)。

## 反馈问题

- 在应用里：「设置 → 通用 → 反馈问题」。反馈会作为工单提交到你的 LynShen 账号，进度和回复在官网控制台的「工单」页查看。
- 在 GitHub：[Issues](https://github.com/Libra1337/LynShen_Agent/issues)。

## 许可证

Apache License 2.0，见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。Copyright 2026 LynShen Innovations INC.

许可证覆盖代码。LynShen 名称和图标是 LynShen Innovations INC. 的商标，不授权给分支项目使用。Claude Code、Codex 和应用对接的其他工具属于各自的所有者，应用从它们的官方渠道安装。

---

## English

Aogiri (Chinese name 梧桐) is a desktop app for working with coding agents. One window holds several projects and sessions. Each session runs one agent: LynShen's own engine, Claude Code, Codex, or any [ACP](https://agentclientprotocol.com) agent. The project's files, git, terminal and a built-in browser sit next to the conversation. The engine, the background service and the `lynshen` CLI live in [LynShen-CLI](https://github.com/Libra1337/LynShen-CLI).

Up to 0.5.x the app was called LynShen Desktop. Only the app's name changed: the engine is still LynShen, the account is still a LynShen account, and `~/.lynshen` and the `lynshen` command stay. An installed LynShen updates itself to Aogiri. On Windows the installer replaces the LynShen install and moves its shortcuts and its start at login; the Linux packages `aogiri` replace `lyn-shen` and keep a `LynShen` command; on macOS the app updates in place and its file stays `/Applications/LynShen.app`.

**Install.** Get the macOS and Windows installers from the [download page](https://www.lynshen.org/download), or any platform (Linux included) from [GitHub Releases](https://github.com/Libra1337/LynShen_Agent/releases). The builds are not notarized or code-signed, so macOS and Windows block the first launch. [docs/install.md](docs/install.md) shows how to open the app. After that, the app updates itself.

**First launch.** A setup guide checks Node.js and Git, signs you in to LynShen through the browser (or takes your own API key), and asks for a default agent and model. The app gets a 30-day credential for this device, not your password. Claude Code and Codex are optional and install from their official sources.

**What you get.** Sessions on several agents, plan mode, approvals with keyboard shortcuts, files, git (with pull requests and worktree tasks), a terminal, a browser whose elements you can reference in a message, image generation, a skills marketplace, MCP servers, voice and screen capture, and a one-step import of conversations, skills and MCP servers from Claude Code, Codex, opencode, zcode and omp (Settings → Import from other tools). Every session runs in the local `lynshen daemon`, so it keeps going when the window closes. You can follow and drive it from your phone through an end-to-end encrypted relay (Settings → Remote access).

**Privacy.** Credentials are in `~/.lynshen/auth.json`, plain text unless `"encrypt_secrets": true` is set in `~/.lynshen/config.json`. Prompts and code go to the model provider of the session. Signed in, the daemon reports each turn's token counts, model, engine and timing to your account (no prompts, code or paths). Anonymous usage counts are on by default; turn them off in Settings → General.

**Build from source.** Install Node.js 22, pnpm, Rust and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Clone LynShen-CLI next to this repository and run `cargo build` there, or set `LYNSHEN_BIN`. Then run `pnpm install` and `pnpm tauri dev`. Checks: `pnpm check`, `pnpm test`, and `cargo test --manifest-path src-tauri/Cargo.toml` after `pnpm build`.

**Problems.** Use Settings → General → Send feedback in the app, or open a [GitHub issue](https://github.com/Libra1337/LynShen_Agent/issues).

**License.** Apache License 2.0. The LynShen name and logo are trademarks of LynShen Innovations INC. and are not licensed for use by forks.
