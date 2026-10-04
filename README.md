# ProtoBridge · 通用 HTML 原型协同插件

把「高保真原型 → 用户就地改字/标注提意见 → 反馈回灌 agent 改源码」的人机协同闭环,
做成**任何 HTML 原型项目、任何编码 agent 都能用**的通用插件。

设计规格见 [`SPEC.md`](./SPEC.md)。

## 三层架构(agent 无关)

```
③ 适配层    adapters/zcode.md · opencode.md · claude.md        可选薄条,丢了不影响
② 约定层    AGENTS-SNIPPET.md · skills/proto-bridge/SKILL.md   跨 agent 的真正载体
            feedback/*.json + schema(数据契约)
① 运行时层  studio/(studio.html · serve.mjs · apply.mjs · init.mjs · anno/) 纯 Web/Node,手动也能用
            bin/protobridge.mjs(CLI)· proto.config.json
```

原则:**① 不依赖任何 agent;② 只用开放约定(AGENTS.md / Agent Skills / JSON 文件);③ 可有可无**。
模型经 Cline / OpenCode 等 harness 运行——只要约定在仓库里,换模型/换 harness 行为一致。

## 零安装试用(npx,无需 clone)

```bash
# 扫描当前项目并起 studio:没配置也能用(1 个 HTML→单文档;多个→多文件,每文件整页)
npx github:noctide/protobridge serve --root .

# 想固定配置(生成 proto.config.json,自动探测模式/页面/端口)
npx github:noctide/protobridge init --root .

# 回灌反馈(先出报告,确认后 --apply)
npx github:noctide/protobridge apply latest --root . --apply
```

打开提示的 `http://127.0.0.1:<port>/studio` 即可改字/标注;点「发送反馈」落盘到 `feedback/`。
> 没写 `proto.config.json` 时,`serve` 会自动按根下 HTML 数量推断模式;`?src=/project/xxx.html` 也可直接打开任意同根文件。

## 快速开始

```bash
# 1.(可选)安装校验依赖
npm install

# 2. 为你的项目准备 proto.config.json,然后起服务
node studio/serve.mjs --root <你的项目根> --config proto.config.json
#   打开 http://127.0.0.1:8123/studio

# 3. 用户改字/标注 → 点「发送反馈」→ feedback/*.json

# 4. agent 回灌(先出报告,确认后 --apply)
node studio/apply.mjs latest --root <你的项目根> --config proto.config.json
node studio/apply.mjs latest --root <你的项目根> --config proto.config.json --apply

# 5. 通用冒烟(用 examples/demo 跑通完整闭环)
node tests/verify-generic.mjs
```

## OpenCode 自动唤醒(可选)

**装一次、全局生效**(不依赖 `opencode` CLI):
```bash
protobridge install-plugin          # 复制到 ~/.config/opencode/plugins/protobridge
# 或(有 opencode CLI 时):
opencode plugin add 'github:noctide/protobridge::path:packages/opencode-plugin'
```
重启 OpenCode 后:用户在 studio 点「发送反馈」→ 反馈包落盘 → 插件**自动**向"目标会话"投递一条消息,agent 无需你再说「处理」。
插件源码在 `packages/opencode-plugin/`;也可只复制到单个项目的 `.opencode/plugins/protobridge/`。

- 插件只用 Node 内置模块,**不导入 `@opencode/plugin`**——该运行时的本地插件加载器不做 node_modules 解析,直接导出 `{ id, setup }` 即可。
- **目标会话**(优先级):① 显式绑定——在目标对话里发一次 `启用协同`,插件记下该会话 id 并持久化;② 最近一次"用户输入"的会话(后台事件不会抢占);③ 最近事件兜底。新开的对话发一句 `启用协同` 即可成为目标;换目标就在新对话里再发一次。
- **页面开关**:studio 顶栏「协同通知:开/关」。关掉时反馈仍落盘,但包内 `notify:false`,插件不自动唤醒,需手动让 agent「处理反馈」。
- OpenCode 插件 API 没有"当前聚焦会话",浏览器页面也无法自己识别会话,所以"发给哪个对话"必须由对话侧用触发词声明;页面开关只控制是否自动通知。
- 用**独占标记文件**原子去重,避免多实例重复唤醒;扫描会跳过 `examples/**`、`tests/**` 夹具,跑冒烟不会误唤醒。
- 自检日志:`%TEMP%\protobridge-plugin.log`。

## 目录

| 路径 | 说明 |
|---|---|
| `bin/protobridge.mjs` | CLI 入口:`serve` / `apply` / `init` / `install-plugin`(供 `npx github:` 调用) |
| `studio/studio.html` | 内核 studio(配置驱动,内嵌 bridge) |
| `studio/serve.mjs` | 通用服务:静态 + `/api/feedback` 落盘 + `/api/config` + 注入运行时 + 递归扫描/自动探测 |
| `studio/apply.mjs` | 回灌契约 + CLI:备份 → 定位 → 文本兜底匹配 → 写回 → 报告 → 归包 |
| `studio/init.mjs` | 扫描目录生成 `proto.config.json`(免手写) |
| `studio/anno/` | 可选区域标注模块(`tools.anno=true` 才注入) |
| `studio/proto.config.json` | 配置模板(全部字段与默认值) |
| `examples/demo/` | 纯通用示例(3 页 single + 区域标注 + apply 适配器样例) |
| `examples/single/` | 单文档模式示例(整页一页,无容器约定) |
| `examples/multi/` | 多文件每文件整页示例(`pages.singlePerFile`) |
| `tests/verify-generic.mjs` | 通用端到端冒烟(装载/编辑/切页/标注/发送/回灌 + 交互细节) |
| `tests/verify-single.mjs` | 单文档模式冒烟 |
| `tests/verify-multi.mjs` | 多文件每文件整页冒烟 |
| `AGENTS-SNIPPET.md` | 追加到项目 `AGENTS.md` 的约定段 |
| `skills/proto-bridge/SKILL.md` | 开放 Agent Skills 格式的进阶操作手册 |
| `packages/opencode-plugin/` | OpenCode 插件(全局装一次):反馈落盘后唤醒绑定/最近会话(适配层 ③) |
| `adapters/` | ZCode / OpenCode / Claude 薄条 |

## 默认值 / 无配置起步

`studio/proto.config.json` 即全部默认值。配置解析顺序:**显式 `--config` → 项目根 `proto.config.json` → 自动探测 → 内置默认**。

自动探测:按项目根下 HTML 数量推断——只有 1 个 → `single`(整页一页);多个 → `pages` + `singlePerFile`(每文件整页)。
根下没有 HTML 时退回内置默认(`.pg-sec / .act / data-page` 约定、桌面 1440 / 手机 390、反馈落 `feedback/`)。

## 反馈数据契约(schema v2)

`path` 语义固定:**相对页面根容器、同名标签序 `nth-of-type` 链**。任何 agent 读 JSON 即可定位元素,
不需要理解 studio 内部。详见 `SPEC.md` §4 与 `AGENTS-SNIPPET.md`。
