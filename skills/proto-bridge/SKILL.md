---
name: proto-bridge
description: 为任意 HTML 原型项目接入"人机协同闭环"(就地改字 / 标注提意见 / 反馈回灌源码)。当用户提到「原型协同」「方案稿标注」「处理反馈」「protobridge」「给原型提意见」,或者需要在 HTML 原型上收集反馈并让 agent 改源码时使用。
---

# ProtoBridge 操作手册(agent 进阶)

本 skill 讲**怎么操作**,不内嵌大段代码;所有实现都在内核仓库,按路径引用。
基础约定(必读、进用户项目)见 `AGENTS-SNIPPET.md`。

## 0. 内核结构

```
protobridge/
├─ bin/protobridge.mjs  CLI 入口(serve / apply / init,供 npx github: 调用)
├─ studio/
│  ├─ studio.html      内核 studio(配置驱动,内嵌桥接脚本 bridge)
│  ├─ serve.mjs        通用静态服务 + /api/feedback 落盘 + /api/config + 递归扫描/自动探测
│  ├─ apply.mjs        回灌契约 + CLI(备份/定位/写回/报告/归包)
│  ├─ init.mjs         扫描目录生成 proto.config.json
│  ├─ anno/anno.js    可选区域标注模块(config.tools.anno=true 才注入)
│  ├─ anno/anno.css
│  └─ proto.config.json 配置模板(全部字段与默认值)
├─ examples/demo/      纯通用示例(3 页 single + 区域标注 + apply 适配器样例)
├─ examples/multi/     多文件每文件整页示例(config.pages.singlePerFile)
├─ tests/verify-generic.mjs / verify-single.mjs / verify-multi.mjs
├─ AGENTS-SNIPPET.md   追加到项目 AGENTS.md 的段落
├─ packages/opencode-plugin/  OpenCode 插件(全局装一次,③):protobridge install-plugin
└─ adapters/           zcode.md / opencode.md / claude.md 薄条
```

## 1. 给新项目接入(只改 config,不碰内核源码)

最快:`npx github:noctide/protobridge init --root .` 自动生成配置(1 个 HTML→single;多个→pages 每文件整页);
或手写一份(照抄 `studio/proto.config.json` 改):

1. 在项目根放 `proto.config.json`(照抄 `studio/proto.config.json` 改):
   - `title`:顶栏品牌。
   - `source.mode` + 对应字段(见 §2)。
   - `pages`:原型内部如何区分页面(容器选择器 / 当前页类 / 页 id 属性 / 切换方式);单文档用 `single:true` + `defaultId`。
   - `viewport`:`desktop` 宽 + `narrow` 列表(命中 `match` 选择器的页用更窄的设计宽)。
   - `ui.whitelist`:工具自身 UI 选择器(桥接不把点击当"改字/拾取")。
   - `tools.anno`:是否需要区域标注模块;`annoMap` 指向 `annotation-map.js`。
   - `server.port/feedbackDir/wakeOnFeedback`。
   - `apply`:回灌用(适配器路径、`map`)。
   - `storage`(可选):localStorage 键名前缀,默认 `proto.*`。
2. 方案稿只要满足:`页面根`能被 `pages.container` 选中、当前页带 `pages.activeClass`、页 id 写在 `pages.idAttr`。其余结构随意。
   - 页面清单优先取 `pages.list`;也可让方案稿暴露 `window.PROTO_PAGES` 作为回退。
3. 起服务:`node <protobridge>/studio/serve.mjs --root . --config proto.config.json`。
4. 回灌:`node <protobridge>/studio/apply.mjs latest --root . --config proto.config.json [--apply]`。

**真正通用性的验收**:只改 config + 适配器,不改内核。

## 2. 三种 source 模式的差异与坑

| mode | 用途 | 关键点/坑 |
|---|---|---|
| `single` | 单文件含全部页(每页一个根容器) | 桥接按"活动容器"取页;`switch:auto` 用内核切换器,项目自带路由则 `switch:hook` 并让方案稿广播 `pbx-page` |
| `pages` | 每页一个 html,`src` 直接换 iframe | 切页 = 换 iframe 地址,每次 load 重新注入;页清单靠 `pages.list` 或 `source.dir` 扫描文件名 |
| `urls` | 任意在线页面(只读标注) | **跨源**无法注入 bridge,改字/拾取不可用;仅浏览与整页查看。`sameOrigin=false` 时 studio 会提示 |

- `single` 的坑:多页同 DOM 时必须把 anno/编辑限定在活动容器,否则徽章跨页堆叠(内核已处理)。
- `pages` 的坑:每次换 iframe 都要重新注入;`src` 带 `?t=` 防缓存。
- `hook` 模式:studio 只改 `iframe.location.hash`,由方案稿自己的路由响应;方案稿切页后应 `postMessage({type:'pbx-page',page})` 让 studio 同步下拉。
- **单文档**(整页一页、没有容器/活动类约定):`pages.container` 指向整页根(常为 `body`),`pages.single=true`,`pages.defaultId` 给一个稳定页 id。禁用切页。样例见 `examples/single/`。
- **多文件每文件整页**(一批互不相关的独立 HTML):`source.mode="pages"` + `pages.singlePerFile=true` + `pages.list`(或 `source.dir` 递归扫描),`pages.container="body"`。每个文件各自整页、仍可切页;页 id 按当前文件反查。样例见 `examples/multi/`。
- 无 `proto.config.json` 时 `serve` 自动探测:根下 1 个 HTML→single;多个→pages+singlePerFile。

## 3. 回灌适配器接口

内核对 `from`/`to` 做**文本兜底匹配**(精确 → 空白归一 + 允许中间夹标签),并负责备份/写回/报告/归包。
仅当"页 → 源码文件"映射超出 config 表达能力时,才写适配器(`config.apply.adapter`):

```js
// 相对 config 文件所在目录(内核会依次尝试 projectRoot / config 目录 / 内核根)
export function plans({ feedback, config, projectRoot }) {
  // edits:    [{ record, file, from, to }]   file 相对 projectRoot
  // comments: [{ comment, file, line }]      定位提示(人工处理)
  return { edits: [...], comments: [...] };
}
```

样例见 `examples/demo/apply.mjs`。仅**精确命中**会自动写回;模糊/跨标签命中只定位、列入需人工清单。

## 4. 扩展/维护 verify

`tests/verify-generic.mjs` 用 `examples/demo` 跑完整闭环(服务/装载/编辑/切页/标注/发送/落盘/回灌/备份/归包),
并覆盖右键协作菜单、平移、双击菜单+撤销、缩放+小地图、滚轮转发、舞台原生滚动、弹层关闭等交互。
`tests/verify-single.mjs` 覆盖单文档;`tests/verify-multi.mjs` 覆盖多文件每文件整页(切页 + 各页独立定位)。
加断言:在对应阶段后 `t(条件, '名称', extra)`。demo 改动后请保持:
- 待编辑文本在 `proto.html` 中**唯一且连续**,否则回灌定位会退化或走 skipped;
- `examples/demo/proto.config.json` 的 `server.port` 与 verify 里的 `PORT` 一致。

## 5. 常见故障

| 现象 | 处置 |
|---|---|
| 端口被占 | `--port` 换端口;Windows `netstat -ano \| findstr :8123` |
| 标注组件资源加载失败 | 需经 `serve.mjs` 访问(经 `http://…/studio`);直接 `file://` 打开 studio 拿不到 `/tool-res/*` |
| 无法访问方案页面(跨源) | `urls` 模式正常现象;改字/标注不可用,改走可直接访问的同源文件 |
| 徽章跨页堆叠 | 确认 `pages.container/activeClass/idAttr` 配对(内核按活动容器限定) |
| 回灌大量 skipped | 源码文本被重构/折行;看 `report-*.md` 的 `⚠️/❌` 人工核对,`from` 会被用于模糊匹配 |
| 服务"落盘即退" | 环境里设了 `PROTOBRIDGE_WAKE=1`;要常驻就用 `--stay-alive` 或去掉该变量 |
| 点发送没有自动收到 | 确认插件已装(`protobridge install-plugin`,或项目内 `.opencode/plugins/protobridge/`)且 OpenCode 已重启;确认 studio「协同通知」为开(反馈包 `notify` 不为 false);确认目标会话——在你想接收的对话里发触发词 `启用协同` 或 `/protobridge bind` 绑定。查 `%TEMP%\protobridge-plugin.log`。插件只用 `node:` 内置模块 |
| 反馈发到了别的窗口 | 插件按"显式绑定 > 最近用户输入 > 最近事件"选目标;在目标会话发一次触发词即可纠正。OpenCode 无"聚焦会话"API,页面无法自行识别会话 |
| 点发送提示失败 | studio 已**自动复制反馈包到剪贴板并弹出错误原因**;把内容粘贴给 agent 即可(或点弹层里的「下载为文件」) |

## 6. 边界(明确不做)

多用户协同、云服务、MCP server、修改方案稿视觉呈现。内核只做"落盘 + 本地 HTTP + 约定"。
