# Agent HTML Collab OpenCode Host 适配包

全局安装一次：`agent-html-collab install-plugin`；升级用 `--force` 并重启客户端。HTML 项目不需要复制插件。

本包以本机 OpenCode **2.0.22** 为验证基线。安装器在 V2 配置的 `plugins` 数组登记 `./plugins/agent-html-collab`。此前依据 V1 文档判断 `setup` 和 `plugins` 不兼容是错误的；V2 使用对象式 `id/setup`，另保留 V1 `server` 降级入口。升级清理本包误写到 V1 `plugin` 字段的登记，保留其他条目。

此版本移除全局目标文件、最近会话兜底、/agent-html-collab 手动绑定和文件扫描自动通知。

## V2 自动回传实验

在所属会话执行 `/agent-html-collab`。命令从 OpenCode 的可信调用上下文取得 sessionID，再通过 `ctx.session.get` 读取该会话的目录，启动绑定页面。Agent 收到页面链接并向用户说明操作；用户打开链接、编辑或标注后点击发送反馈。

反馈先保存，再通过 `ctx.session.prompt` 投递到原会话，采用 `delivery: queue`，不抢占正在运行的 turn。消息 ID 由会话与反馈身份稳定派生。返回 `queued` 表示后端已接收，不表示模型已经完成修改。发送失败保留文件，页面可重试；结束时执行 `/agent-html-collab-close`。

这不是 DSH 的原生侧栏按钮。当前只提供本地网页链接，不自动启动外部浏览器，也不注入 OpenCode 安装文件。默认使用 PATH 中的 `node` 启动 Studio；可在 V2 插件 options 指定 `nodeExecutable` 为现有 Node 的绝对路径。

真实 OpenCode 2.0.22 隔离后端及本地模型 fixture 已验证保存、自动续接、会话隔离、重试、关闭和安装产物。用户实际模型和桌面 GUI 尚未验证。复现：设置 `PROTOBRIDGE_OPENCODE_CLI` 后运行 `node tests/verify-opencode-v2.mjs`；测试只使用临时配置、项目、会话与本地模型。

V1 的 `ctx.protobridge.registerPageBridge`、`saveFeedback`、`enqueue` 仍只是本项目的可选契约。未接入时返回空 hooks，需另行启动 Studio 手动处理；V1 实际客户端未验证。

完整生命周期及 RPC 接入见 [Host 接入说明](../../docs/host-integration.md)。
