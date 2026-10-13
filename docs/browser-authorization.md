# 浏览器授权

软件内点击「在浏览器中授权 Aogiri」，然后在官网登录或注册。
核对网页与软件显示的代码，勾选确认框并点击「授权并继续」。
切回软件后即可选择模型。授权窗口有效期为 10 分钟。

每台设备获得独立的 30 天 API 凭据，可以读取账号名称、邮箱和余额，
查看可用模型，并使用账号的现有额度调用模型。凭据不包含网站登录会话或管理权限。
软件不收集账号密码，也不自动处理登录验证码。

在软件中退出登录会撤销该设备凭据。网络失败时软件保留凭据，并提示重试。
也可在官网控制台的 API 密钥管理中删除对应的 `LynShen Desktop / ...` 项（官网给设备起的名字，没有随应用改名）。
凭据过期或被撤销后，需要重新进行浏览器授权。

## 实现与部署

- 官网授权页：`https://www.lynshen.org/oauth/authorize?user_code=...`。
- 设备流程接口：`/api/desktop/oauth/device`、`request`、`decision`、`token`、`cancel`。
- 设备身份与撤销接口：`/api/desktop/oauth/me`、`revoke`。
- 设备密钥只在原生进程内存中存在；兑换后的 API 凭据使用既有凭据存储。
- 浏览器只能批准授权，不能接收 API 凭据；网页明确核对代码后才能批准。
- 软件每 5 秒轮询一次，成功、失败、取消或关闭授权界面后停止。
- 待处理授权保存在官网程序内存中；服务进程切换后可能需要重新开始。
- 一次性兑换若遇到响应丢失，需重新授权，可在官网删除未使用的设备密钥。

服务端协议和安全约束见 Monoize 仓库的 `spec/desktop-authorization.spec.md`。


## Provider subscription authorization

Open Settings → Providers → OpenAI to authorize a ChatGPT/Codex subscription.
The subscription is stored as `openai-codex`; OpenAI API keys remain under `openai`.
Anthropic also offers browser authorization for supported Claude subscriptions.
Authorization uses the system browser, PKCE, a random state, and a loopback callback.
Desktop runs `lynshen auth-login` as a separate process. It does not create a session.
Closing the dialog cancels the process. Closing Desktop closes its input pipe.
Tokens stay in the native credential store. The existing provider library refreshes them.
Use Clear credentials to remove either the key or the OAuth credential for a provider.

Reference implementations checked for the Codex flow:
- https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/pkg/openai/oauth.go
- https://github.com/router-for-me/CLIProxyAPI/blob/main/internal/auth/codex/openai_auth.go

No source code was copied from these projects. A live subscription login needs the
account owner to finish authorization in their own browser.
