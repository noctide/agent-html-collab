# Claude 系适配条(可选)

Claude 系(Claude Code / Skills)使用开放 Agent Skills 格式,直接复用内核 skill。

## 安装
把 `skills/agent-html-collab/` 整个目录复制/软链到 Claude 的 skills 目录(如 `~/.claude/skills/agent-html-collab/`),
或项目内 `.claude/skills/agent-html-collab/`。Claude 依据 SKILL.md 的 frontmatter description 自动触发
(触发词:原型协同 / 方案稿标注 / 处理反馈)。

## CLAUDE.md
Claude 项目指令文件等价于 AGENTS.md,把 `AGENTS-SNIPPET.md` 追加进 `CLAUDE.md` 即可。

## 说明
Claude 无 ZCode 的"退出唤醒",走 AGENTS.md §4 的扫盘约定:`feedback/*.json` → `studio/apply.mjs` → 刷核对。

其余细节见内核 `skills/agent-html-collab/SKILL.md`。
