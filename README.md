<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/brand/aogiri-horizontal-dark.svg">
    <img src="design/brand/aogiri-horizontal-light.svg" alt="Aogiri · 梧桐" width="440">
  </picture>

  <p>把编程智能体、代码和项目工具放在同一个桌面工作台里。</p>

  <p>
    <a href="https://www.lynshen.org/download">官网下载</a> ·
    <a href="https://github.com/Libra1337/LynShen_Agent/releases">全部版本</a> ·
    <a href="https://github.com/Libra1337/LynShen_Agent/issues">问题反馈</a>
  </p>

  <p><strong>简体中文</strong> · <a href="README.en-US.md">English</a></p>
</div>

你可以同时管理多个项目和会话，使用 LynShen、Claude Code、Codex 或兼容 [ACP](https://agentclientprotocol.com) 的智能体，并在对话旁查看文件、Git 改动、终端和网页。支持 macOS、Windows 和 Linux。

## 安装

| 平台 | 安装包 |
| --- | --- |
| macOS | Apple 芯片选 `aarch64.dmg`，Intel 选 `x64.dmg` |
| Windows x64 | `x64-setup.exe` |
| Linux x64 | `AppImage`、`.deb` 或 `.rpm` |

当前安装包尚未经过 Apple 公证或 Windows 代码签名，首次打开可能被系统拦截。各平台的安装和放行步骤见[安装指南](docs/install.md)。

旧版 LynShen Desktop 可直接更新为 Aogiri，登录状态、对话和设置都会保留；应用内引擎、账号和 `lynshen` 命令仍使用 LynShen 名称。

## 开始使用

1. **登录或配置模型。** 首次打开时，可通过浏览器登录 LynShen 账号，也可以跳过登录，在「设置 → 提供商」中使用自己的 API Key 或智能体已有账号。
2. **选择智能体。** 内置 LynShen 可直接使用；Claude Code、Codex 和 ACP 智能体按需安装或添加。选择模型后即可开始。
3. **打开项目，发送任务。** 一个项目可以有多个会话。让智能体阅读代码、修改文件、运行命令，也可以先使用计划模式讨论方案。

通过 LynShen 账号登录时，应用只获取当前设备的授权凭据，不会获取你的账号密码。退出登录会吊销该设备的凭据。

## 日常使用

- **掌握操作权限：** 按 `Shift+Tab` 切换审批模式；收到审批请求时，按 `1` 允许一次、`2` 始终允许、`3` 或 `Esc` 拒绝。
- **查看和修改项目：** 使用文件编辑器、Git diff、暂存与提交、拉取与推送；安装 GitHub CLI 后还可处理 Pull Request。并行任务可以使用独立的 Git worktree。
- **在同一窗口工作：** 打开终端或内置浏览器，将网页元素带入对话；也可以切回智能体自己的终端界面。
- **按需扩展：** 在设置中管理模型、技能、MCP 服务器、语音输入和生图模型，或从其他编程工具导入历史对话与配置。
- **离开窗口也不中断：** 会话由本机后台服务运行。关闭窗口或重启应用不会停止正在执行的任务。

### 常用快捷键

macOS 使用 `⌘`，Windows 和 Linux 使用 `Ctrl`。

| 快捷键 | 作用 |
| --- | --- |
| `⌘K` | 命令面板 |
| `⌘N` | 新建会话 |
| `⌘P` | 快速打开文件 |
| `⌘F` | 在对话中查找 |
| `` Ctrl+` `` | 打开终端 |
| `⌘B` | 收起或展开侧栏 |
| `⌘.` | 停止生成 |
| `⌘/` | 查看全部快捷键 |

## 手机远程访问

远程访问默认关闭。需要时：

1. 打开「设置 → 远程访问」，启用中继访问。
2. 点击「添加设备」，用手机扫描二维码或打开配对链接。
3. 在手机浏览器中查看会话、发送消息和处理审批。

手机与电脑无需处于同一网络。连接内容经过端到端加密，中继服务无法读取；已配对设备可以随时吊销。

## 数据与隐私

- 提示词、代码和附件会发送给当前会话使用的模型服务商；语音输入会发送给你配置的语音识别服务。
- 凭据默认保存在本机 `~/.lynshen/auth.json`，为明文。可选择启用静态加密，但它不能防御本机恶意程序，启用前请阅读[安全边界与使用说明](docs/secrets.md)。
- 登录账号后，会汇总模型、引擎、Token 用量和耗时，不上报提示词、代码或项目路径。部分基础设置可跨设备同步，密钥、技能和 MCP 配置保留在本机。
- 匿名使用统计默认开启，包含功能使用次数、错误类型和随机安装 ID，不包含对话、代码或文件路径。可在「设置 → 通用」中关闭。
- 应用会从 LynShen 官网检查和下载更新，并在你确认后安装。

## 遇到问题

先在[安装指南](docs/install.md)查看系统拦截、Linux 依赖和权限相关说明。其他问题可通过「设置 → 通用 → 反馈问题」提交，或前往 [GitHub Issues](https://github.com/Libra1337/LynShen_Agent/issues)；请附上系统、应用版本、所用智能体和错误信息，不要粘贴 API Key 或访问令牌。

## 从源码运行

本仓库只包含桌面端；智能体引擎与后台服务位于 [LynShen-CLI](https://github.com/Libra1337/LynShen-CLI)。开发需要 Node.js 22、pnpm、Rust 稳定版和 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。

将两个仓库放在同一目录，构建 CLI 后启动桌面端：

```sh
git clone --recurse-submodules https://github.com/Libra1337/LynShen-CLI.git
(cd LynShen-CLI && cargo build)
git clone https://github.com/Libra1337/LynShen_Agent.git
cd LynShen_Agent
pnpm install
pnpm tauri dev
```

也可用 `LYNSHEN_BIN` 指定已有的 `lynshen` 可执行文件。常用检查：`pnpm check`、`pnpm test`，以及先运行 `pnpm build` 再运行 `cargo test --manifest-path src-tauri/Cargo.toml`。架构与开发约定见 [AGENTS.md](AGENTS.md)。

## 许可证

代码采用 [Apache License 2.0](LICENSE)，另见 [NOTICE](NOTICE)。LynShen 名称和图标的商标权归 LynShen Innovations INC. 所有；第三方智能体及工具归各自所有者所有。
