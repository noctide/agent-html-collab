# DSH 与 ZCode 接入

客户端各安装一次插件，原型 HTML 无需携带插件。多个 HTML 共用项目配置。

## DeepSeek Harness（0.2.0-rc.2）

使用插件管理器的本地包安装入口选择本包目录或 TGZ。根 package.json 提供 `dsh.bundle.patch`、Host export 和浏览器 client export。

在所属对话顶部点击常驻的“原型协同”按钮。入口注册在 `conversation.header.leading`；插件通过会话 scoped Slot 的 `sessionId` 创建独立侧栏页面。Host 使用 `agents.get(sessionId).session.header.cwd` 确定项目，不让原型网页选择会话或项目。尚未创建对话时，按钮会提示先打开已有对话或发送第一条消息。

Host 路由通过 `connection.admit(req)` 验证客户端认证，提交同时检查 Origin。页面关闭后绑定失效。保存成功后调用 `sessionController.prompt`，requestId 使用 feedbackId，重复投递由控制器去重；当前安装版本的控制器内部调用 `agent.followup()`。这不保证客户端崩溃或重启后的消息恰好执行一次。

关闭页面会使传给控制器的 AbortSignal 失效，但 rc.2 的 `prompt` 仅在入口检查取消状态；已经开始接收或已经接受的消息不能保证撤回。此边界已核对本机控制器源码，并有模拟原生入口行为的回归测试；取消竞态尚未通过真实 GUI 验收。

源码证据来自用户安装的 0.2.0-rc.2：

- `@deepseek-ai/dsh-client-ui-sidebar-browser/lib/client.js`：sidebar pane 的 inject(sessionId, actions)、openTabs 的 sessionId/tabId。
- `@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js`：会话 scoped Slot、可扩展 tab 类型与导航服务。
- `@deepseek-ai/dsh-client-connection/lib/index.js`：webServer 与 connection.admit 的认证入口。
- `@deepseek-ai/dsh-api-session-controller/lib/index.js`：prompt、requestId 去重、followup。

已验证 HTTP/Host 协议集成和页面隔离。2026-10-06 已在真实 DSH GUI 完成单会话联调：安装更新并重启、顶部按钮打开内嵌 Studio、编辑标题、反馈 JSON 落盘、原会话收到通知并回复、关闭和重新打开标签页。多会话切换、删除会话和取消竞态仍由协议回归测试覆盖，尚未逐项 GUI 验收。详见 [DSH 验证记录](dsh-validation-notes.md)。未修改客户端安装包或 app.asar。

首次联调确认旧默认 `proto.*` localStorage 键在 DSH 同源内嵌页之间共享，可能混入其他项目的意见和改动。现在由 Studio Host 按可信项目根目录生成稳定默认键，隔离意见、文字改动、编号、模式和通知状态。显式配置的存储键保留；旧共享草稿不自动迁移或删除。该行为通过配置回归和同源内嵌页浏览器回归验证，具体范围见 [DSH 验证记录](dsh-validation-notes.md)。

## ZCode（3.14.4）

根 `.zcode-plugin/plugin.json` 提供 Skills 和 stdio MCP；在 ZCode 插件市场添加本地目录后安装。MCP 配置声明 `isolation: session`、660 秒调用超时；使用已经存在的 Node，无额外运行时依赖。

agent 调用 open_studio(projectRoot)，通过自身 Browser 工具在内置浏览器打开返回 URL。页面加载后先告诉用户在哪里编辑、如何发送，以及正在等待这一轮反馈，再调用一次 wait_feedback(bindingId)。
用户发送后，反馈作为该工具调用的返回值交回原对话。每个 MCP 进程、每个页面拥有独立随机绑定，反馈不会发到最近对话。

等待最长 600 秒；默认超时结束本轮并提示用户准备好后说“继续收集反馈”，不无限续等。收到反馈后先报告并处理，再询问是否继续收集；只有用户明确要求持续收集时才自动续等。没有正在等待的工具时，反馈照常保存，通知明确失败，页面可在 agent 重新等待后重试。
这不是任意空闲会话的主动消息投递；用户结束对话或客户端取消工具后，插件无法凭标准 MCP 主动唤醒模型。

### 启动入口与桌面接入状态

`$agent-html-collab` 是当前包的技能入口，需要模型读取指引并调用 MCP 和 Browser 工具，不是点击即打开页面的客户端按钮。

此前只检查 main 就判断需要新增 ZCode 原生接口，依据不充分，该判断已撤回。官方 [UI Plugin 文档](https://github.com/zai-org/ZCode/blob/feat/ui-plugin/UI_PLUGIN.md)及本地功能分支 `662c30bea4e833acaacbfb745a65eb09c23d55f8` 已提供清单 `ui.surfaces` 手动面板和 MCP Apps `App.sendMessage()`。消息复用绑定会话的发送入口；无用户手势时要求确认，发送前重新检查会话绑定和页面实例。

这些是功能分支的源码能力，不等于官网安装版已支持。本机 3.14.4 的构建提交为 `10bbcea5`；安装包扫描未找到所查 UI Plugin 标记，但没有完成真实插件握手和 GUI 验证，不能仅凭扫描断言不支持。源码消息适配的本地隔离检查见 `research/zcode-validation-notes.md`，不代表真实客户端验收。

按当前工作范围，暂停桌面接入实验，不修改客户端安装文件或 ZCode 开发版。当前包继续使用会话隔离 stdio MCP 和单轮 `wait_feedback`；后续正式版支持确认后，优先通过独立插件接入现有接口，避免依赖会被升级覆盖的安装目录补丁。不得用全局目标、最近会话或外部浏览器代替可信会话绑定。

声明格式与隔离设置已对照本机插件 creator 文档和运行时配置解析；stdio MCP 多进程协议测试已通过。真实 ZCode 插件安装、隔离与内置浏览器联动尚待 GUI 验证。

## Releases

同一个 TGZ/ZIP 包包含两个客户端入口。DSH 使用 bundle manifest；ZCode 使用 .zcode-plugin manifest。无需每个 HTML 复制一包。
当前草稿 Release 保留为待 GUI 验证状态。
