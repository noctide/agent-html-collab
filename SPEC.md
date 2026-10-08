> v0.2 变更：会话通知采用页面归属绑定，旧版全局目标/最近会话方案已移除。DSH Host 与 ZCode 等待工具已实现，真实 GUI 安装联动尚待验证，详见 [docs/client-adapters.md](docs/client-adapters.md)。下文旧自动监听描述仅为历史设计。

# Agent HTML Collab 通用协同插件 · 规格说明

> 目标:把「高保真原型 → 用户就地改字/移动元素/标注提意见 → 反馈回灌 agent 改源码」的人机协同闭环,
> 抽象为**任何 HTML 原型项目、任何编码 agent 都能用**的通用插件。
> 本文档是实施依据;动工前先确认方案,每阶段完成跑对应验收。

---

## 1. 目标与原则

- **① 不依赖任何 agent**:运行时是纯 Web/Node,手动打开也能用。
- **② 只用开放约定**:`AGENTS.md` 段落、开放 Agent Skills 格式、JSON 文件数据契约。
- **③ 可有可无**:适配层是薄条,丢了不影响运行;区域标注是可选模块,默认关。

模型经 harness 运行;只要约定在仓库里,**换模型 / 换 harness 行为一致**。

---

## 2. 架构:三层

```
┌─ ③ 适配层(各家一薄条,可选,丢了不影响使用)
│    adapters/zcode.md · opencode.md · claude.md
├─ ② 约定层(跨 agent 的真正载体,进仓库、开放格式)
│    AGENTS.md 约定段(AGENTS-SNIPPET.md)
│    skills/agent-html-collab/SKILL.md(开放 Agent Skills 格式)
│    feedback/*.json + schema(数据契约)
└─ ① 运行时层(agent 无关,纯 Web/Node,手动也能用)
     studio/(studio.html · serve.mjs · apply.mjs · anno/)
     proto.config.json
```

---

## 3. 运行时层设计

### 3.1 `proto.config.json`(唯一的项目配置)

```jsonc
{
  "title": "原型协同",                     // 顶栏品牌;也作为反馈包的 app 名
  "source": {                             // 方案稿来源,三选一
    "mode": "single",                     // single | pages | urls
    "file": "proto.html",                 // single:含全部页面的单文件(相对项目根)
    "dir": "pages/",                      // pages:每页一个 html 的目录
    "urls": ["http://…"],                 // urls:任意在线页面(只读标注)
    "index": "",                          // 可选:pages 模式的首屏文件
    "entry": ""                           // 由 serve.mjs 解析后注入,一般不用手写
  },
  "pages": {
    "container": ".pg-sec",               // 页面根选择器
    "activeClass": "act",                 // 当前页标记类
    "idAttr": "data-page",                // 页 ID 属性
    "switch": "auto",                     // auto=内核默认切换器 | hook=方案稿自带路由
    "rootId": "pg-{id}",                  // 兼容:按 id=pg-<id> 找页面根
    "overview": null,                     // 可选:总览页 {id,title},补进页清单
    "single": false,                      // 单文档:整页一页,忽略 activeClass、禁用切页
    "singlePerFile": false,               // pages 模式:每个文件整页(整页即页根),仍可切页
    "defaultId": "",                      // 单文档缺 idAttr 时的稳定页 id
    "list": []                            // 页清单 [{id,title,file}];缺省按 source.dir 递归扫描
  },
  "viewport": { "desktop": 1440, "narrow": [{ "match": ".is-mobile", "width": 390 }] },
  "ui": { "whitelist": [".pb-badge", ".pb-pop", ".pb-anno-fab", ".pbx-echip", ".pbx-move-chip"] },
  "tools": { "anno": false, "annoMap": "" },   // 可选区域标注模块;annoMap 指向 annotation-map.js
  "storage": {                                 // 可选:覆盖键名;省略则服务按项目隔离
    "edits": "my-project.edits", "comments": "my-project.comments", "ecount": "my-project.ecount",
    "moves": "my-project.edits.moves",          // 元素移动;省略则使用 storage.edits + ".moves"
    "mode": "my-project.mode", "annoMode": "my-project.annoMode", "page": "my-project.page",
    "notify": "my-project.notify"              // 协同通知开关
  },
  "server": { "port": 8123, "feedbackDir": "feedback/", "wakeOnFeedback": false },
  "apply": {                                   // 可选:回灌适配器
    "adapter": "",                             // 导出 plans() 的模块(相对配置文件目录)
    "map": "", "backupDir": "backup/"
  }
}
```

配置来源:显式 `--config` → 项目根 `proto.config.json` → **自动探测**(根下只有 1 个 HTML → single;
多个 → pages + `singlePerFile`)→ 内核默认。即无配置也能起步,零破坏。

由 `serve.mjs` 托管时，省略的 storage 键默认是 `proto.project.<项目根目录 SHA256>.<字段>`，`moves` 例外：由最终解析的 `storage.edits + ".moves"` 派生，兼容已有自定义编辑命名空间，也可显式配置 `storage.moves`。项目根目录来自 Host，Windows 路径先统一大小写；同一浏览器来源内，同项目重开页面保留草稿，不同项目互不读取。命名空间不依赖标题、端口或临时页面绑定。显式配置的非空字符串键继续使用，使用同一显式键意味着主动共享该项存储。旧 `proto.*` 草稿保留，但不自动归入新项目；需要时先确认所属项目，再以 JSON 导出/导入迁移。

### 3.2 `studio.html`(内核工具)

- **装载**:方案稿进 iframe;同源时注入:
  1. `window.PROTOBRIDGE_CFG = <config>`;
  2. 编辑/浏览所需样式;
  3. `tools.anno=true` 时注入 `annotation-map`、`anno.js`、`anno.css`;
  4. 桥接脚本 `bridge`。
- **模式**:浏览 / 编辑(就地改字)/ 移动(元素位移)/ 标注(元素拾取 + 区域徽章),快捷键 E / M / A。
- **页切换**(统一 `pageList()` = `pages.overview?` + `pages.list` / `window.PROTO_PAGES`):
  - `switch=auto`:内核切换器切活动容器 + 广播 `pbx-page`;
  - `switch=hook`:改 `iframe.location.hash`,由方案稿路由响应(方案稿切页后广播 `pbx-page` 反向同步);
  - `pages` 模式:直接换 iframe `src`;`urls` 模式:换 URL(跨源只读)。
- **单文档**:`pages.single=true` 时整页视为一页(忽略 `activeClass`、禁用切页),`pages.defaultId` 提供稳定页 id;
  适用于没有页面容器约定的静态文档(整页一页)。
- **多文件每文件整页**:`source.mode=pages` + `pages.singlePerFile=true` 时,每个文件各自整页(整页即页根),
  仍可切页;页 id 按当前文件反查 `pages.list`。适用于一批互不相关的独立 HTML。
- **编辑**:桥接以活动容器(单文档即整页容器)为根计算 `path`(`nth-of-type` 链),只改文本节点;还原走 localStorage。
- **移动**:在活动页面选择元素并拖动，Shift 拖动锁定预览的水平或垂直方向，松开 Shift 后继续自由移动；Alt 点击可直接选择已选容器内的子元素。方向键或面板箭头按钮微调 1px、按住 Shift 微调 10px；面板支持数值 X/Y 和选中父元素，并在小窗口中内部滚动。记录相对原始布局的 CSS 像素偏移，不改变 DOM 层级。移动标记、撤销和单元素/当前页/全部页还原均跟随草稿，支持导入、导出和发送。
- **标注**:元素拾取(`pbx-pick`)+ 意见徽章(`pbx-echip`);可选区域模块提供 `data-anno` 编号徽章。
- **辅助**:缩放(固定设计宽 + `transform scale`)、小地图、右键/中键拖动平移、滚轮转发、快速还原。
- **发送反馈**:收集 edits+comments+moves → Host 或 `POST /api/feedback`;服务不在时下载 JSON 兜底。只含移动也可发送；列表、计数和通知包含移动记录。

### 3.3 `serve.mjs`(通用服务)

```
node studio/serve.mjs [--root <项目根>] [--config proto.config.json] [--port 8123]
                      [--source 路径] [--feedback-dir feedback] [--stay-alive]
```

- 静态托管:项目文件(`/project/*`)、内核 studio(`/studio`)、运行时注入(`/tool-res/*`);
- 页面清单:`pages.list` 优先;否则按 `source.dir` **递归**扫描 HTML;无配置时自动探测;
- `GET /api/ping | /api/config | /api/pages`;
- `POST /api/feedback` → 落盘 `<feedbackDir>/feedback-<时间戳>.json`(schema 见 §4);
- **唤醒解耦**:默认落盘后继续运行并打印提示;仅当 `PROTOBRIDGE_WAKE=1` 或 `server.wakeOnFeedback=true`
  才"落盘即退出,唤醒 agent"(兼容依赖退出唤醒的 harness)。

### 3.4 `apply.mjs`(回灌契约 + CLI)

内核负责:备份 → 定位源码 → 文本兜底匹配 → 写回 → 出报告 → 归包。CLI:

```
node studio/apply.mjs [feedback.json|latest] [--root .] [--config proto.config.json] [--apply]
```

项目可选提供适配器(`config.apply.adapter`),导出:

```js
export function plans({ feedback, config, projectRoot }) => {
  edits:    [{ record, file, from, to }],   // file 相对 projectRoot
  comments: [{ comment, file, line }],      // 定位提示(人工处理)
  moves:    [{ record, file, line }]        // 可选;布局任务(Agent 核对后处理)
}
```

无适配器时,内核按 `config.apply.map` / `pages.list` / `source` 自行定位。
**仅精确命中才自动写回**;模糊/跨标签命中只定位、列入需人工清单(`skipped`)。
编辑回写只动文本节点(`setTextOnly` 语义),保持"最小侵入"。
`moves` 进入报告与返回结果，旧适配器未返回 moves 时按通用页面映射补充。DOM 路径与位移不足以决定源码布局规则，因此内核不自动覆盖 `transform`、`position` 等 CSS；Agent 应核对定位、现有布局与响应式样式后处理。`--apply` 会归档原包，报告中的意见与移动仍是待处理任务。

### 3.5 区域标注(可选模块)

`data-anno` 编号、`annotation-map`、标注悬浮球(`anno.js` + `anno.css`)全在 `studio/anno/`,
`tools.anno=true` 才注入;模块按配置的活动容器限定页面,单文件多页不再需要服务端打补丁。
内核的编辑/元素意见/还原不依赖它。

---

## 4. 反馈数据契约(schema v2,向后兼容 v1)

```jsonc
{
  "v": 2,
  "app": "<项目名>",
  "source": "<方案稿路径>",
  "notify": true,                              // 可选:false 表示不自动唤醒 agent(需手动处理)
  "generatedAt": "<ISO>",
  "summary": { "comments": 0, "edits": 0, "moves": 0 },
  "comments": [{ "id": "p03-E1", "page": "p03", "path": "section>div>p",
                 "origText": "前60字", "type": "修改|新增|删除|疑问",
                 "priority": "高|中|低", "comment": "…", "author": "…" }],
  "edits":    [{ "page": "p03", "path": "…", "from": "原文本", "to": "新文本", "ts": "<ISO>" }],
  "moves":    [{ "page": "p03", "path": "section>div:nth-of-type(2)", "label": "操作区",
                 "from": { "x": 0, "y": 0 }, "to": { "x": 24, "y": -12 }, "ts": "<ISO>" }]
}
```

`path` 语义固定:**相对页面根容器、同名标签序 `nth-of-type` 链**。这份契约写进 AGENTS.md,
任何 agent 读 JSON 即可定位元素,不需要理解 studio 内部。
`moves` 和 `summary.moves` 是 v2 的可选扩展，缺失时视为无移动。坐标单位为 CSS 像素，`from` 固定为原始布局 `(0,0)`；`to` 为累计偏移，正 X 向右、正 Y 向下，与 Studio 缩放比例无关。同一页同一路径只保留最新偏移，回到 `(0,0)` 则移除该草稿。移动不表示 DOM 重新挂载，也不指定最终 CSS 实现方式。

---

## 5. 去耦合:反馈交接约定(替代"退出唤醒")

- 落盘约定(写进 AGENTS.md):
  1. 用户发送反馈后,`feedback/` 出现未处理包;用户对 agent 说「处理反馈」时先扫 `feedback/*.json`;
  2. 处理流程:读包 → `apply.mjs` 定位/生成报告(`feedback/report-*.md`)→ 回灌(先备份 `backup/`)→ 包移入 `feedback/done/`;
  3. 处理完提示用户刷新 studio 核对。
- 需要"退出唤醒"的 harness:`PROTOBRIDGE_WAKE=1` 或 config `wakeOnFeedback=true`。

---

## 6. 约定层文档(两份)

### 6.1 `AGENTS-SNIPPET.md`(进用户项目仓库,短、必读)
工具怎么起、studio 地址、反馈包位置与 schema 摘要、处理流程(§5)、回灌最小侵入原则、
冒烟验证命令、禁止事项(勿手改 `feedback/done/`、勿跳过备份)。

### 6.2 `skills/agent-html-collab/SKILL.md`(开放 Agent Skills 格式)
frontmatter `name` + 一句话 description(触发词:原型协同/反馈处理/方案稿标注)。
正文放**进阶流程知识**:如何为新项目写 config、如何写回灌适配器、三模式差异与坑、
verify 断言扩展、常见故障。原则:skill 承载"agent 怎么操作",不内嵌大段代码。

---

## 7. 适配层(③,可选薄条)

| 文件 | 内容 |
|---|---|
| `adapters/zcode.md` | ZCode 斜杠命令:`/agent-html-collab init` / `/agent-html-collab feedback` |
| `adapters/opencode.md` | OpenCode command 同内容 |
| `adapters/claude.md` | Claude 系 skill 链接/复制说明 |
| `packages/opencode-plugin/` | OpenCode V2 插件：反馈保存后排队投递到页面所属会话；`agent-html-collab install-plugin` 安装 |

内容都是一句话指向 AGENTS.md 的对应小节,不复制逻辑。

---

## 8. 仓库结构

```
agent-html-collab/
├─ SPEC.md                         # 本文档
├─ README.md
├─ studio/                         # ① 运行时
│  ├─ studio.html                  #   内核 studio(配置驱动,内嵌 bridge)
│  ├─ serve.mjs                    #   通用服务
│  ├─ apply.mjs                    #   回灌契约 + CLI
│  ├─ anno/                        #   可选区域标注模块
│  └─ proto.config.json            #   配置模板(全部字段与默认值)
├─ examples/demo/                  # 纯通用示例(3 页 + 标注 + apply 适配器样例)
├─ AGENTS-SNIPPET.md               # ② 提供给项目 AGENTS.md 追加的现成段落
├─ skills/agent-html-collab/SKILL.md    # ② 开放格式 skill
├─ adapters/                       # ③ zcode.md / opencode.md / claude.md
└─ tests/verify-generic.mjs        # 通用冒烟(用 examples/demo,不依赖任何具体项目)
```

---

## 9. 实施计划与验收

- **阶段 0 · 快速路径**:参数化 `serve.mjs` + 约定文档,现有工具零改动即可给其他 agent 用。
- **阶段 1 · 内核抽取(已实现)**:按 §3 产出 `studio/`;配置驱动、品牌参数化、anno 拆为可选模块;
  - 验收:`tests/verify-generic.mjs` 全绿(装载→编辑→切页→标注→反馈→落盘→回灌→备份/归包,含交互细节);
  - 不带 config 时行为稳定。
- **阶段 2 · 第二项目实测**:任选一个真实 HTML 原型走完整闭环,只改 config + 适配器、不碰内核源码;
  - 验收:只改 config 即接入,发现配置表达不了的就回补内核。
- **阶段 3 · 打包分发**:ZCode 本地测试市场插件(plugin.json + skills + assets);OpenCode/Claude 适配条;
  可选 `npx agent-html-collab` 化(把 serve.mjs 挂 bin);
  - 验收:三个 harness 各自从零安装 → 发现/触发 skill → 完成一次反馈闭环。

---

## 10. 风险与边界

1. **页面模型长尾**:无统一容器约定、页内自带路由、非同源 URL(urls 模式无法注入 bridge,只能整页查看)——阶段 2 逐个验;
2. **回灌精度**:`path` 在源码重构后失效,靠 `from`/`origText` 文本兜底匹配;仍失配则进 `skipped` 人工处理;
3. **verify 可移植**:`puppeteer-core` 依赖本机 Chrome/Edge 路径探测,已内置多路径候选;
4. **schema 演进**:v2 保持读兼容 v1;
5. **明确不做**:多用户协同、云服务、自动将移动偏移改写为源码 CSS。Studio 提供本地移动预览，Agent 核对后实现布局；MCP 仅用于客户端反馈适配。
