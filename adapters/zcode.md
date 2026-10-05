# ZCode 适配条(可选)

把下面两条斜杠命令加到 ZCode 配置即可;逻辑一律指向项目 `AGENTS.md` 的对应小节,本文件不复制实现。

## `/agent-html-collab init`
> 读项目 `AGENTS.md` 的「原型协同(Agent HTML Collab)约定」§2,起本地服务:
> `node <agent-html-collab>/studio/serve.mjs --root . --config proto.config.json`,并告诉我 studio 地址。

## `/agent-html-collab feedback`
> 按 `AGENTS.md` §4 处理反馈:扫 `feedback/*.json` → 跑 `studio/apply.mjs` 出报告 → 确认 `--apply` 回灌(自动备份/归包)→ 提示我刷新核对。

## 说明
- ZCode 旧增强:落盘即退出唤醒依赖 `PROTOBRIDGE_WAKE=1`,保留即可;其他 harness 用 AGENTS.md §4 的"扫盘 + 处理反馈"约定,不需要退出机制。
- 其余细节见内核 `skills/agent-html-collab/SKILL.md`。
