<img width="1872" height="1080" alt="image" src="https://github.com/user-attachments/assets/4f70567a-d5dc-4bb4-b25a-ed7781932edc" />

# Agent HTML Collab

### 在 HTML 页面上表达想法，与 agent 一起改好它。

**中文** · [English](README.en.md)

Agent HTML Collab 是一个面向人与编码 agent 的 HTML 原型协同工具。你可以直接修改页面文字、拖动元素表达布局想法、在具体元素上标注意见，再把反馈交给 agent 处理，无需在聊天里反复描述“左边第二个按钮”。

它使用已有的 HTML 文件，不要求换框架，也不绑定某个模型。DeepSeek Harness、OpenCode 和 ZCode 提供不同的接入方式；其他客户端可以使用独立网页和项目约定。

## 怎么协作

1. **打开原型**：从项目会话打开已有 HTML，预览并切换页面。
2. **直接反馈**：就地改字、移动元素，或选择元素留下意见。
3. **发送给 agent**：保存为 JSON 反馈包。已接入的客户端会将反馈交回页面所属会话。
4. **核对改动**：agent 读取反馈并处理；文字回灌工具可先预览报告，再备份、写回源码。刷新页面检查结果。

自动通知表示反馈已投递，不代表模型已经改好页面。未接入的客户端需要手动让 agent 读取反馈文件。

## 可以做什么

- **就地改字、移动元素与标注**：把文字、布局和意见放在具体页面和元素上。
- **单文档与多文件原型**：自动发现项目内的 HTML，也可用配置指定页面。
- **页面查看**：浏览、编辑、移动、标注模式，缩放与小地图。
- **可控反馈**：通知开关、保存、失败重试；重试不会重复保存同一反馈包。
- **会话归属**：使用绑定的会话，不按最近对话或当前焦点猜测目标。
- **可检查的回灌**：生成报告；执行文字回灌前备份，并归档已处理反馈。

## 先试一下

需要 Node.js 18 或更高版本。在自己的 HTML 项目目录运行：

```bash
npx github:noctide/agent-html-collab serve --root .
```

打开终端显示的本地 Studio 地址，编辑、移动或标注后点击“发送反馈”。独立网页模式会保存反馈，不会自动唤醒会话。

点击“移动”（快捷键 `M`），选择并拖动元素；按住 `Shift` 拖动锁定预览中的水平或垂直方向，松开后继续自由移动。方向键或面板上的箭头按钮每次微调 1 个 CSS 像素，按住 `Shift` 每次微调 10 像素。移动面板可输入 X/Y 偏移，也可选中父元素整体移动；按住 `Alt` 点击可重新选中容器里的子元素。偏移相对元素原始布局，X 向右、Y 向下为正，缩放不会改变记录单位。可撤销、还原单个元素或当前页/全部页面，并通过移动标记查看记录。草稿会保存，支持 JSON 导入、导出和发送。

让 agent 读取反馈，或使用文字回灌工具：

```bash
# 先查看报告，不修改 HTML
npx github:noctide/agent-html-collab apply latest --root .

# 核对报告后执行文字改动，备份源码
npx github:noctide/agent-html-collab apply latest --root . --apply
```

标注意见和元素移动由 agent 逐条处理；自动回灌工具只写回精确匹配的文字改动，并在报告中列出移动路径和偏移，供 agent 核对布局后修改源码。移动预览不改变 DOM 层级，选择父元素是改为移动该父元素。`--apply` 归档反馈包后，报告中的意见和移动仍需 agent 处理。

## 在客户端里使用

| 客户端 | 使用方式 | 验证范围 |
|---|---|---|
| DeepSeek Harness | 从所属会话打开原型协同右侧面板，反馈回到该会话 | 按 0.2.0-rc.2 接口适配；此前版本完成真实单会话联调，当前更新通过 Host 与嵌入页面回归，GUI 更新验收待完成 |
| OpenCode V2 | 安装一次插件，在会话执行 `/agent-html-collab`，打开网页链接 | 2.0.22 隔离后端与浏览器流程通过；使用本地模拟模型，非原生侧栏 |
| ZCode | 会话隔离 MCP 打开页面，单轮 `wait_feedback` 接收反馈 | stdio MCP 测试通过；正式安装版的原生页面接口兼容性尚未确认 |
| 其他 agent | 独立 Studio 配合项目约定，手动交接反馈文件 | 不承诺客户端自动通知 |

OpenCode 安装：

```bash
npm install -g github:noctide/agent-html-collab
agent-html-collab install-plugin
```

完整重启 OpenCode 后，在目标项目会话执行 `/agent-html-collab`；用完执行 `/agent-html-collab-close`。

详见 [客户端接入](docs/client-adapters.md)、[OpenCode 插件说明](packages/opencode-plugin/README.md) 和 [Host 接入契约](docs/host-integration.md)。

## 配置、示例与开发

- [配置模板](studio/proto.config.json)：项目可使用 `proto.config.json` 指定页面、视口和反馈目录；无配置时自动扫描，跳过子 Git 仓库与 Studio 工具目录。
- [单文档示例](examples/single/) · [多文件示例](examples/multi/) · [完整示例](examples/demo/)
- [项目协作约定](AGENTS-SNIPPET.md) · [Agent Skill](skills/agent-html-collab/SKILL.md) · [规格与数据契约](SPEC.md)
- [更新记录](CHANGELOG.md) · [发布工作流模板](docs/release-workflow.yml)

```bash
npm ci
npm test
npm run verify
npm run verify:single
npm run verify:multi
npm run verify:move
```

当前 32 项单元测试、45 项移动回归、41 项通用页面检查、17 项单文档检查、18 项多文件检查和 15 项草稿隔离检查通过。浏览器测试需要本机 Chrome/Edge；移动回归使用 `npm run verify:move`，草稿隔离使用 `npm run verify:storage`。OpenCode 独立验证方法及限制见 [验证记录](research/opencode-v2-validation-notes.md)。

## 从 ProtoBridge 升级

在本地仓库运行 `node bin/agent-html-collab.mjs install-plugin --force`，然后完整重启 OpenCode。安装器会迁移旧插件登记并保留其他插件配置。新命令为 `/agent-html-collab` 和 `/agent-html-collab-close`。

已有 `proto.config.json` 和反馈文件继续使用。反馈包新增可选 `moves` 数组，旧包无需改写。浏览器草稿默认按项目隔离，显式配置的存储键保留；移动草稿默认使用 `storage.edits + ".moves"`，也可显式配置 `storage.moves`。旧共享 `proto.*` 草稿不删除，也不自动归入当前项目，可确认所属项目后通过 JSON 导出/导入迁移。`PROTOBRIDGE_HOST`、`PROTOBRIDGE_WAKE` 与 V1 的 `ctx.protobridge` 自定义契约作为兼容格式保留。
