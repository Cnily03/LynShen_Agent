# Aogiri 开发指南

<guide project="Aogiri">
  <workflow>
    <stage name="定位">
      <action>从界面文案、命令、事件名或报错文本搜索执行路径，阅读入口、调用方和相邻测试。</action>
      <command>rg -n "命令、事件或界面文案" src src-tauri</command>
      <command>rg --files src | rg "模块名.*test"</command>
    </stage>
    <stage name="修改">
      <action>沿现有 store、协议封装和共享组件延伸；跨进程改动同时检查生产者与消费者。</action>
      <action>保留工作区已有修改，将 diff 控制在任务范围内。</action>
    </stage>
    <stage name="交付">
      <action>运行与影响范围匹配的检查，审查完整 diff，记录验证结果和未覆盖的平台行为。</action>
    </stage>
  </workflow>

  <architecture>
    <connections>
      <connection from="Svelte / WebView" to="Rust 系统宿主" transport="Tauri IPC">
        <purpose>调用文件、进程、终端和平台能力。</purpose>
      </connection>
      <connection from="Svelte / WebView" to="lynshen daemon" transport="WebSocket">
        <purpose>创建和恢复会话，发送操作，接收引擎事件。</purpose>
      </connection>
      <connection from="lynshen daemon" to="LynShen / Claude / Codex / ACP" transport="引擎各自协议">
        <purpose>运行智能体并统一事件格式。</purpose>
      </connection>
      <connection from="手机浏览器" to="lynshen daemon" transport="端到端加密中继">
        <purpose>远程查看和操作本机会话。</purpose>
      </connection>
    </connections>

    <component name="界面" paths="src/routes, src/lib">
      <responsibility>组合工作台、呈现对话、维护界面状态。</responsibility>
      <entry path="src/lib/session.svelte.ts">项目树、会话生命周期与恢复。</entry>
      <entry path="src/lib/chat.svelte.ts">引擎事件到对话状态的归约。</entry>
      <convention>Svelte 5 runes；解析、计算和转换放入可单独测试的 TypeScript 模块。</convention>
    </component>

    <component name="系统宿主" paths="src-tauri">
      <responsibility>文件、进程、PTY、安装更新和平台集成。</responsibility>
      <boundary>在 Rust 侧校验 WebView 传入的路径、命令、参数和配置。</boundary>
    </component>

    <component name="会话运行时" paths="LynShen-CLI">
      <responsibility>daemon 持有会话与引擎进程，统一不同引擎的事件协议。</responsibility>
      <lifecycle>窗口关闭后任务继续运行；关闭标签会结束对应 daemon 会话。</lifecycle>
      <repository>https://github.com/Libra1337/LynShen-CLI</repository>
    </component>

    <component name="引擎适配" paths="src/lib/backends">
      <responsibility>转换操作和事件，描述各引擎支持的能力。</responsibility>
      <convention>界面通过 caps 判断能力；引擎差异集中在适配层。</convention>
      <reference>src/lib/backends/README.md</reference>
    </component>

    <component name="远程客户端" paths="src/routes/remote, src/lib/remote, src/lib/relay">
      <responsibility>设备配对、远程会话、连接恢复和端到端加密中继。</responsibility>
      <scenario>多客户端并发、桌面离线、缓存过期、断线重连。</scenario>
    </component>
  </architecture>

  <entrypoints>
    <task goal="会话创建、发送、恢复或关闭">
      <trace>src/lib/session.svelte.ts → src/lib/backends/router.ts → src/lib/daemon.ts</trace>
    </task>
    <task goal="消息、工具卡片、审批或用量">
      <trace>src/lib/chat.svelte.ts → 对应 Svelte 组件</trace>
    </task>
    <task goal="智能体行为或能力">
      <trace>src/lib/backends → LynShen-CLI（涉及协议时）</trace>
    </task>
    <task goal="分栏、标签或工作区">
      <trace>src/lib/workbench → src/routes/+page.svelte</trace>
    </task>
    <task goal="模型、账号或设置">
      <trace>src/lib/settings → 配置读写模块</trace>
    </task>
    <task goal="文件、命令、终端或系统集成">
      <trace>src/lib/protocol.ts → src-tauri/src</trace>
    </task>
    <task goal="安装、更新或发布">
      <trace>src-tauri/src/app_update.rs → scripts → docs/updater.md</trace>
    </task>
  </entrypoints>

  <contracts>
    <contract name="命名">
      <term product="Aogiri" chinese="梧桐">桌面应用。</term>
      <term product="LynShen">引擎、账号、网关、中继和命令行。</term>
      <stable>com.lynshen.desktop, ~/.lynshen, ~/Documents/LynShen, lynshen://, LYNSHEN_*</stable>
    </contract>
    <contract name="backend">
      <meaning>运行会话的智能体引擎，对应 BackendId / backendId；daemon 协议使用 engine。</meaning>
    </contract>
    <contract name="会话标识">
      <rule>分别维护界面会话 ID、daemon 会话 ID、引擎对话 ID 及其映射。</rule>
      <applies-to>恢复、重启、远程访问、跨客户端同步。</applies-to>
    </contract>
    <contract name="会话生命周期">
      <rule>草稿在首次发送时启动引擎；切换模型或审批模式仅更新草稿配置。</rule>
      <rule>分别处理窗口关闭、标签关闭、停止生成和引擎退出。</rule>
    </contract>
    <contract name="持久化与协议">
      <scope>daemon 协议、~/.lynshen 配置、凭据、工作区与布局。</scope>
      <rule>新增字段提供默认值，读取时兼容旧版本；格式变更附带迁移与回退路径。</rule>
      <verify>旧客户端、新客户端和已有数据共同参与验证。</verify>
    </contract>
    <contract name="秘密与用户内容">
      <rule>日志、测试夹具和错误上报排除密钥、令牌及用户内容。</rule>
      <reference>docs/secrets.md</reference>
    </contract>
  </contracts>

  <practices>
    <practice context="响应式状态">
      <rule>$effect 只订阅驱动当前同步的输入；store 写入使用 untrack 隔离意外依赖。</rule>
      <reason>store 方法读取的状态也会成为 effect 依赖。</reason>
    </practice>
    <practice context="异步操作">
      <rule>回复抵达时核对会话和操作代次；处理重复事件、断线、重试与超时。</rule>
    </practice>
    <practice context="错误处理">
      <rule>保留传输错误、daemon 错误和引擎错误的类别，向用户提供下一步操作。</rule>
      <cleanup>定时器、事件监听器、WebSocket、子进程。</cleanup>
    </practice>
    <practice context="界面">
      <rule>复用主题变量、i18n 和共享组件，为中英文界面补充文案。</rule>
      <verify>键盘、焦点、窗口缩放、窄布局、减少动态效果。</verify>
    </practice>
    <practice context="方案选择">
      <rule>用最小改动验证假设；新增模块或抽象时说明它消除的复杂性。</rule>
    </practice>
  </practices>

  <checks>
    <check scope="前端类型与 Svelte">pnpm check</check>
    <check scope="TypeScript 单元测试">pnpm test</check>
    <check scope="前端生产构建">pnpm build</check>
    <check scope="Rust 测试" requires="pnpm build">cargo test --manifest-path src-tauri/Cargo.toml</check>
    <check scope="Rust 静态检查">cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings</check>
    <regression>行为变化优先补充相邻测试；局部逻辑先跑对应测试文件。</regression>
    <manual>远程连接、安装更新和平台权限需要在实际环境验证。</manual>
  </checks>

  <documentation>
    <user>README.md：安装、上手、隐私和源码运行。</user>
    <module>所在目录：模块协议、适配方式和局部约定。</module>
    <topic>docs/：安全、发布和专项设计。</topic>
  </documentation>
</guide>
