# OpenCode 适配条(可选)

OpenCode 用 command(或直接对 agent 说话)。逻辑指向项目 `AGENTS.md`,不复制实现。

## 建议 command:`.opencode/command/protobridge.md`
```markdown
---
description: 起原型协同服务 / 处理原型反馈
---
参数为空时:读项目 AGENTS.md 的「原型协同(ProtoBridge)约定」§2,运行
`node <protobridge>/studio/serve.mjs --root . --config proto.config.json`,回报 studio 地址。
参数为 feedback 时:按 AGENTS.md §4 处理反馈(扫盘 → apply.mjs 报告 → --apply 回灌 → 提示刷新)。
```

## 也可以不开 command
直接把 `AGENTS-SNIPPET.md` 追加进项目 `AGENTS.md`,对 OpenCode 说「起原型服务」/「处理反馈」即可。
skill 放在 `skills/proto-bridge/SKILL.md`(开放 Agent Skills 格式),OpenCode 可自动加载。

其余细节见内核 `skills/proto-bridge/SKILL.md`。
