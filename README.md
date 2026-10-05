# Agent HTML Collab · 通用 HTML 原型协同插件

把「高保真原型 → 用户就地改字/标注提意见 → 反馈回灌 agent 改源码」的人机协同闭环,
做成**任何 HTML 原型项目、任何编码 agent 都能用**的通用插件。

设计规格见 [`SPEC.md`](./SPEC.md)。

## 三层架构(agent 无关)

```
③ 适配层    adapters/zcode.md · opencode.md · claude.md        可选薄条,丢了不影响
② 约定层    AGENTS-SNIPPET.md · skills/agent-html-collab/SKILL.md   跨 agent 的真正载体
            feedback/*.json + schema(数据契约)
① 运行时层  studio/(studio.html · serve.mjs · apply.mjs · init.mjs · anno/) 纯 Web/Node,手动也能用
            bin/agent-html-collab.mjs(CLI)· proto.config.json
```

原则:**① 不依赖任何 agent;② 只用开放约定(AGENTS.md / Agent Skills / JSON 文件);③ 可有可无**。
模型经 Cline / OpenCode 等 harness 运行——只要约定在仓库里,换模型/换 harness 行为一致。

## 零安装试用(npx,无需 clone)

```bash
# 扫描当前项目并起 studio:没配置也能用(1 个 HTML→单文档;多个→多文件,每文件整页)
npx github:noctide/agent-html-collab serve --root .

# 想固定配置(生成 proto.config.json,自动探测模式/页面/端口)
npx github:noctide/agent-html-collab init --root .

# 回灌反馈(先出报告,确认后 --apply)
npx github:noctide/agent-html-collab apply latest --root . --apply
```

打开提示的 `http://127.0.0.1:<port>/studio` 即可改字/标注;点「发送反馈」落盘到 `feedback/`。
> 没写 `proto.config.json` 时,`serve` 会自动按根下 HTML 数量推断模式;`?src=/project/xxx.html` 也可直接打开任意同根文件。

## 手动启动(选目录,最省事)

```bash
npm i -g github:noctide/agent-html-collab    # 装一次
agent-html-collab open                       # 弹文件夹选择框 → 起 studio → 自动开浏览器
```
`open` 也支持 `--root <目录>`(跳过选择框)、`--port`、`--no-open`(自动化不开浏览器)。

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

## 内置浏览器：按页面归属通知对话

客户端只安装一次插件，不需要在每个 HTML 所在目录放插件包。页面打开时由 Host 取得所属对话并建立绑定；切换原型文件不改变目标，关闭页面后绑定失效。无全局目标、无最近对话兜底。

**接入状态：** 已按本机 DSH 0.2.0-rc.2 和 ZCode 3.14.4 的接口实现适配，Host/HTTP 和 stdio MCP 测试通过，真实 GUI 安装联动尚待验证。DSH 页面按所属对话投递；ZCode 通过当前会话的等待工具返回反馈，需保持 wait_feedback 运行。见 [客户端接入](docs/client-adapters.md)。

`agent-html-collab install-plugin` 安装 OpenCode 适配包。V2（本机 2.0.22）提供 `/agent-html-collab`：从所属会话打开绑定的本地网页链接，保存反馈后自动向该会话排队投递；`/agent-html-collab-close` 结束。后端与本地模型 fixture 已验证，实际桌面 GUI 和用户模型仍待验证。该命令不使用旧版全局目标或“启用协同”兜底；V1 未接入页面契约时仍需手动处理。升级用 `--force` 并重启客户端。见 [OpenCode 接入](packages/opencode-plugin/README.md)。

## Releases

下载见 [Releases](https://github.com/noctide/agent-html-collab/releases)。每版提供 npm 安装包、独立 ZIP 和 SHA256 校验。草稿版本不对公众可见。

- TGZ：`npm install -g ./agent-html-collab-0.3.0.tgz`。
- ZIP：解压后运行 `node package/bin/agent-html-collab.mjs serve --root <项目目录>`，无运行时 npm 依赖。
- 自动通知仍取决于客户端页面适配是否完成。

发布工作流模板见 docs/release-workflow.yml。当前 GitHub 凭证缺少 workflow 权限，尚未启用 Actions；维护者将模板放入 .github/workflows/release.yml 后，推送与 package.json 一致的 v* 标签可创建草稿 Release。

## 目录

| 路径 | 说明 |
|---|---|
| `bin/agent-html-collab.mjs` | CLI 入口:`serve` / `apply` / `init` / `install-plugin`(供 `npx github:` 调用) |
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
| `skills/agent-html-collab/SKILL.md` | 开放 Agent Skills 格式的进阶操作手册 |
| `packages/opencode-plugin/` | OpenCode 插件(全局装一次):页面归属 Host 适配入口（需客户端接入） |
| `adapters/` | ZCode / OpenCode / Claude 薄条 |

## 默认值 / 无配置起步

`studio/proto.config.json` 即全部默认值。配置解析顺序:**显式 `--config` → 项目根 `proto.config.json` → 自动探测 → 内置默认**。

自动探测:按项目根下 HTML 数量推断——只有 1 个 → `single`(整页一页);多个 → `pages` + `singlePerFile`(每文件整页)。
根下没有 HTML 时退回内置默认(`.pg-sec / .act / data-page` 约定、桌面 1440 / 手机 390、反馈落 `feedback/`)。

## 反馈数据契约(schema v2)

`path` 语义固定:**相对页面根容器、同名标签序 `nth-of-type` 链**。任何 agent 读 JSON 即可定位元素,
不需要理解 studio 内部。详见 `SPEC.md` §4 与 `AGENTS-SNIPPET.md`。


## 从 ProtoBridge 升级

新版名称为 `agent-html-collab`，界面显示 Agent HTML Collab。使用 `node bin/agent-html-collab.mjs install-plugin --force` 更新本地 OpenCode 插件，然后完整重启客户端。安装器迁移旧插件登记，保留其他插件配置。新命令为 `/agent-html-collab` 与 `/agent-html-collab-close`。项目配置仍为 `proto.config.json`，既有反馈文件与浏览器存储继续使用；旧 Host 注入名 `PROTOBRIDGE_HOST`、环境变量 `PROTOBRIDGE_WAKE` 和 V1 自定义 `ctx.protobridge` 契约为兼容格式保留。
