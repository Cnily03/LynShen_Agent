# 安装与首次打开

Aogiri（梧桐）内测版还没有做代码签名。macOS 和 Windows 在第一次打开时会拦截，按下面的步骤放行即可。之后应用会自动更新，不需要重复操作。

下载地址：[LynShen 官网](https://www.lynshen.org/download)。仅已发布的平台会显示下载按钮。

| 系统 | 下载文件 |
| --- | --- |
| macOS（Apple 芯片） | `Aogiri_<版本>_aarch64.dmg` |
| macOS（Intel 芯片） | `Aogiri_<版本>_x64.dmg` |
| Windows x64 | `Aogiri_<版本>_x64-setup.exe` |
| Linux x64 | `Aogiri_<版本>_amd64.AppImage`，或 `.deb`、`.rpm` |

发布流程覆盖 Apple Silicon 和 Intel Mac；是否已有安装包以下载页为准。

应用在 0.5.x 及以前叫 LynShen，安装包以 `LynShen` 开头。已经装了 LynShen 的电脑不需要重新下载，应用内更新后就是 Aogiri；在 macOS 上，更新后的应用仍是 `/Applications/LynShen.app`。

## macOS

1. 打开 dmg，把 Aogiri 拖进「应用程序」。
2. 在「应用程序」里打开 Aogiri。系统会提示无法验证开发者，点「完成」。
3. 打开「系统设置 → 隐私与安全性」，滚动到「安全性」一栏，找到「已阻止 Aogiri 以保护你的 Mac」，点「仍要打开」，输入登录密码确认。
4. 再次打开 Aogiri，在弹窗里点「打开」。

如果提示「Aogiri 已损坏，无法打开」，或者第 3 步找不到「仍要打开」，在终端执行：

```sh
xattr -dr com.apple.quarantine /Applications/Aogiri.app
```

然后重新打开 Aogiri。

### 权限

Aogiri 只在用到对应功能时申请权限，不用的功能不需要授权。

| 权限 | 用途 | 位置 |
| --- | --- | --- |
| 麦克风 | 语音输入 | 系统设置 → 隐私与安全性 → 麦克风 |
| 屏幕与系统录音 | 截屏、录屏发给智能体 | 系统设置 → 隐私与安全性 → 屏幕与系统录音 |
| 文件和文件夹 | 打开「桌面」「文稿」「下载」里的项目 | 首次访问时系统弹窗确认 |
| 通知 | 会话完成或需要确认时提醒 | 系统设置 → 通知 → Aogiri |

开启录屏权限后，macOS 会要求退出并重新打开 Aogiri 才生效。

因为内测版没有签名，更新到新版本后，系统可能把它当成新应用，麦克风和录屏权限需要重新开启。如果功能突然提示没有权限，到上表的位置把 Aogiri 关掉再打开即可。从 LynShen 更新上来的应用，在列表里可能仍显示为 LynShen。

## Windows

1. 运行 `Aogiri_<版本>_x64-setup.exe`。
2. 如果出现「Windows 已保护你的电脑」，点「更多信息」，再点「仍要运行」。
3. 按安装程序的提示完成安装，不需要管理员权限。

部分杀毒软件会拦截未签名的程序，需要在杀毒软件里放行 Aogiri。

## Linux

AppImage：

```sh
chmod +x Aogiri_*_amd64.AppImage
./Aogiri_*_amd64.AppImage
```

Ubuntu 22.04 及以后的版本运行 AppImage 需要 FUSE 2：Ubuntu 22.04 安装 `libfuse2`，Ubuntu 24.04 安装 `libfuse2t64`。

deb 和 rpm：

```sh
sudo apt install ./Aogiri_*_amd64.deb      # Debian、Ubuntu
sudo dnf install ./Aogiri-*.x86_64.rpm     # Fedora、RHEL
```

## 首次启动

首次启动会打开设置向导：

1. 检查 git 和 LynShen CLI，缺少的可以一键安装。
2. 点击「前往浏览器授权」，在官网登录或注册，核对软件显示的授权码并同意授权。
3. 选择常用模型。

软件不会收集账号密码。授权成功后切回软件即可继续，每台设备获得独立的 30 天凭据。
在软件中退出登录会撤销该设备凭据；也可在官网的 API 密钥管理中撤销对应的 `LynShen Desktop` 项。

Claude Code 和 Codex 是可选的。需要时在「设置 → 智能体」里安装，安装程序来自它们的官方渠道。
