# DSH 与 ZCode 接入

客户端各安装一次插件，原型 HTML 无需携带插件。多个 HTML 共用项目配置。

## DeepSeek Harness（0.2.0-rc.2）

使用插件管理器的本地包安装入口选择本包目录或 TGZ。根 package.json 提供 `dsh.bundle.patch`、Host export 和浏览器 client export。

在所属对话的输入区点击“打开原型协同”，插件通过会话 scoped Slot 的 `sessionId` 创建独立侧栏页面。Host 使用 `agents.get(sessionId).session.header.cwd` 确定项目，不让原型网页选择会话或项目。

Host 路由通过 `connection.admit(req)` 验证客户端认证，提交同时检查 Origin。页面关闭后绑定失效。保存成功后调用 `sessionController.prompt`，requestId 用 feedbackId 去重；当前安装版本的控制器内部调用 `agent.followup()`。

源码证据来自用户安装的 0.2.0-rc.2：

- `@deepseek-ai/dsh-client-ui-sidebar-browser/lib/client.js`：sidebar pane 的 inject(sessionId, actions)、openTabs 的 sessionId/tabId。
- `@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js`：会话 scoped Slot、可扩展 tab 类型与导航服务。
- `@deepseek-ai/dsh-client-connection/lib/index.js`：webServer 与 connection.admit 的认证入口。
- `@deepseek-ai/dsh-api-session-controller/lib/index.js`：prompt、requestId 去重、followup。

已验证 HTTP/Host 协议集成和页面隔离；还需要在真实 DSH GUI 安装后确认按钮呈现、插件激活和完整用户交互。不会修改客户端安装包或 app.asar。

## ZCode（3.14.4）

根 `.zcode-plugin/plugin.json` 提供 Skills 和 stdio MCP；在 ZCode 插件市场添加本地目录后安装。MCP 配置声明 `isolation: session`、660 秒调用超时；使用已经存在的 Node，无额外运行时依赖。

agent 调用 open_studio(projectRoot)，通过自身 Browser 工具在内置浏览器打开返回 URL，然后调用 wait_feedback(bindingId) 保持等待。
用户发送后，反馈作为该工具调用的返回值交回原对话。每个 MCP 进程、每个页面拥有独立随机绑定，反馈不会发到最近对话。

等待最长 600 秒；超时可再次调用。没有正在等待的工具时，反馈照常保存，通知明确失败，页面可在 agent 重新等待后重试。
这不是任意空闲会话的主动消息投递；用户结束对话或客户端取消工具后，插件无法凭标准 MCP 主动唤醒模型。

声明格式与隔离设置已对照本机插件 creator 文档和运行时配置解析；stdio MCP 多进程协议测试已通过。真实 ZCode 插件安装、隔离与内置浏览器联动尚待 GUI 验证。

## Releases

同一个 TGZ/ZIP 包包含两个客户端入口。DSH 使用 bundle manifest；ZCode 使用 .zcode-plugin manifest。无需每个 HTML 复制一包。
当前草稿 Release 保留为待 GUI 验证状态。
