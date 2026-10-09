# ZCode 适配

仓库提供 stdio MCP server 与技能说明，但当前不含 ZCode 原生插件清单，因此不能按 ZCode 插件市场扩展安装。客户端能发现并启动仓库 `.mcp.json` 中的 server 时，agent 可调用 `open_studio(projectRoot)`，再按客户端能力打开返回 URL 并调用一次 `wait_feedback(bindingId)` 收集这一轮反馈；真实安装版联动尚待 GUI 验证。

发送反馈时必须有正在等待的工具调用；等待超时、取消或结束后，反馈仍保存，但通知失败。用户要求继续收集时重新等待，再从页面重试。收到反馈后先处理并报告结果，只有用户明确要求持续收集时才自动续等。结束时调用 `close_studio`。此入口不能从空闲会话主动唤醒模型，也不使用落盘后退出进程来通知。

详见 [客户端接入](../docs/client-adapters.md)。

## 手动命令(可选)

没有上述客户端接口时，可把下面两条斜杠命令加到 ZCode 配置。命令指向项目 `AGENTS.md` 的对应小节，由 agent 手动读取反馈文件。

### `/agent-html-collab init`

> 读项目 `AGENTS.md` 的「原型协同(Agent HTML Collab)约定」§2,起本地服务:
> `node <agent-html-collab>/studio/serve.mjs --root . --config proto.config.json`,并告诉我 studio 地址。

### `/agent-html-collab feedback`

> 按 `AGENTS.md` §4 处理反馈:扫 `feedback/*.json` → 跑 `studio/apply.mjs` 出报告 → 确认 `--apply` 回灌(自动备份/归包)→ 提示我刷新核对。

其余细节见内核 [操作手册](../skills/agent-html-collab/SKILL.md)。
