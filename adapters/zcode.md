# ZCode 适配

优先安装根 `.zcode-plugin/plugin.json` 声明的本地插件，使用会话隔离的 stdio MCP。agent 调用 `open_studio(projectRoot)`，通过客户端 Browser 工具在内置浏览器打开返回 URL，再调用一次 `wait_feedback(bindingId)` 收集这一轮反馈。

发送反馈时必须有正在等待的工具调用；等待超时、取消或结束后，反馈仍保存，但通知失败。用户要求继续收集时重新等待，再从页面重试。收到反馈后先处理并报告结果，只有用户明确要求持续收集时才自动续等。结束时调用 `close_studio`。此入口不能从空闲会话主动唤醒模型，也不使用落盘后退出进程来通知。

详见 [客户端接入](../docs/client-adapters.md)；真实 ZCode 插件安装与内置浏览器联动尚待 GUI 验证。

## 手动命令(可选)

没有上述客户端接口时，可把下面两条斜杠命令加到 ZCode 配置。命令指向项目 `AGENTS.md` 的对应小节，由 agent 手动读取反馈文件。

### `/agent-html-collab init`

> 读项目 `AGENTS.md` 的「原型协同(Agent HTML Collab)约定」§2,起本地服务:
> `node <agent-html-collab>/studio/serve.mjs --root . --config proto.config.json`,并告诉我 studio 地址。

### `/agent-html-collab feedback`

> 按 `AGENTS.md` §4 处理反馈:扫 `feedback/*.json` → 跑 `studio/apply.mjs` 出报告 → 确认 `--apply` 回灌(自动备份/归包)→ 提示我刷新核对。

其余细节见内核 [操作手册](../skills/agent-html-collab/SKILL.md)。
