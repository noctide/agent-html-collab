# 原型协同(Agent HTML Collab)约定 — 追加到你的 AGENTS.md

> 把本节复制进你的项目仓库 `AGENTS.md`(或 `CLAUDE.md` / `.clinerules` 等 agent 必读文件)。
> 任何编码 agent(OpenCode / ZCode / Cline 跑 DeepSeek / Claude 等)读到本节即可完成闭环。

## 1. 这是什么

本项目的高保真 HTML 原型接入 **Agent HTML Collab** 协同工具。用户在浏览器里对原型**就地改字 / 移动元素 / 标注提意见**,
反馈以 JSON 落盘到 `feedback/`;agent 读取反馈 → 定位源码 → 回灌修改。工具与 agent 无关,约定在仓库里,**换模型/换 harness 行为一致**。

## 2. 怎么起

```bash
# 在项目根目录(有 proto.config.json 的那层)执行;<agent-html-collab> 指内核目录
node <agent-html-collab>/studio/serve.mjs --root . --config proto.config.json [--port 8123]
```

- studio 地址:`http://127.0.0.1:<port>/studio`
- 默认落盘后服务**常驻**;仅当环境变量 `PROTOBRIDGE_WAKE=1` 时"落盘即退出,唤醒 agent"。

## 3. 反馈包在哪

- 用户点「发送反馈」→ `feedback/feedback-<时间戳>.json`(未处理)
- 处理完的包移入 `feedback/done/`;回灌报告为 `feedback/report-<时间戳>.md`
- **若本地服务未启动导致发送失败**:studio 会自动把反馈包复制到剪贴板并弹出错误原因,用户直接把内容粘贴给 agent 即可(也可在弹层里下载为文件)。

### schema(摘要,完整见 SPEC §4)

```jsonc
{
  "v": 2, "app": "<项目名>", "source": "<方案稿路径>", "generatedAt": "<ISO>",
  "summary": { "comments": 0, "edits": 0, "moves": 0 },
  "comments": [{ "id":"p03-E1", "page":"p03", "path":"section>div>p",
                 "origText":"前60字", "type":"修改|新增|删除|疑问",
                 "priority":"高|中|低", "comment":"…", "author":"…" }],
  "edits":    [{ "page":"p03", "path":"…", "from":"原文本", "to":"新文本", "ts":"<ISO>" }],
  "moves":    [{ "page":"p03", "path":"…", "label":"操作区",
                 "from":{"x":0,"y":0}, "to":{"x":24,"y":-12}, "ts":"<ISO>" }]
}
```

`path` 语义固定:**相对页面根容器、同名标签序 nth-of-type 链**。读 JSON 即可定位元素,无需理解 studio 内部。
`moves` 可省略；缺失时视为无移动。坐标为相对元素原始布局的 CSS 像素偏移，`from` 固定 `(0,0)`，`to` 是累计偏移，正 X 向右、正 Y 向下。它表示布局意图，不改变 DOM 层级，也不规定最终 CSS 实现。

## 4. 处理流程(用户说「处理反馈」时执行)

1. **扫盘**:读 `feedback/*.json`(忽略 `feedback/done/`);
2. **回灌**:`node <agent-html-collab>/studio/apply.mjs latest --root . --config proto.config.json`(先出报告)确认后加 `--apply`
   —— 内核会**先备份到 `backup/`**、定位源码、文本兜底匹配、写回、生成 `report-*.md`、把包移入 `feedback/done/`;
   comments 与 moves 类需 agent 逐条处理；`--apply` 归档原包后，仍须处理报告中的意见和移动任务，不能把归档视为全部完成;
3. **提示核对**:处理完请用户刷新 studio 核对。

## 5. 最小侵入原则

- 自动文字回灌**只动文本节点**(`setTextOnly` 语义)；元素移动由 agent 核对源码结构、现有布局与响应式样式后，以必要的最小改动实现，不盲目覆盖 `transform` 或 `position`;
- 任何写回前必须备份;命中不了的记录进报告 `skipped`/需人工清单,**不要猜着改**;
- 不要手改 `feedback/done/` 下的历史包;不要跳过备份。

## 6. 冒烟验证

```bash
node <agent-html-collab>/tests/verify-generic.mjs   # 用 examples/demo 跑通:装载→编辑→标注→反馈→回灌
```

## 7. 进阶

新建项目的 config 写法、回灌适配器接口、single/pages/urls 三模式差异与坑、常见故障,
见内核 skill:`<agent-html-collab>/skills/agent-html-collab/SKILL.md`。
