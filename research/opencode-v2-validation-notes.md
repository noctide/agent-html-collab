# OpenCode V2 本地验证

## 判断更正

本机运行版本为 OpenCode 2.0.22。此前依据 V1 文档把对象式 `id/setup` 和配置字段 `plugins` 判断为错误，并改成函数入口及 `plugin`，不适用于本机 V2。本轮已纠正，V2 使用 `setup` 与 `plugins`；V1 另保留 `server` 入口，不宣称已验证 V1 客户端。

依据：[V2 插件文档](https://opencode.ai/v2/docs/build/plugins/)，以及本机隔离服务直接生成的 OpenAPI schema。V2 `ctx.session.get` 返回会话 location，`ctx.session.prompt` 返回已接收的 inbox item，支持稳定消息 ID 和 queue 投递。不能把 V1 `client.session.prompt` 参数结构与 V2 混用。

## 当前实现

`/agent-html-collab` 从可信命令调用取得 sessionID，读取该会话目录，再复用现有 Host/Studio 创建独立绑定。命令将链接交回所属会话；页面保存反馈后通过 V2 会话 prompt 入队并自动续接。`/agent-html-collab-close` 关闭本会话页面。网页不能选择会话；会话工作区变化或会话消失时拒绝投递。未实现原生侧栏，不自动打开系统浏览器。

OpenCode 的打包程序不能当作 Node 执行 Studio，故明确使用已有 `node`，支持插件 options.nodeExecutable。安装器携带同一 Host 和 Studio，避免安装产物依赖源码目录。真实运行中发现本地 fetch 被代理返回 502；本地 Host 使用 Node HTTP 直连回环服务，未修改用户全局代理设置。

## 可复现验证

设置 `PROTOBRIDGE_OPENCODE_CLI` 为本机 V2 CLI 路径，执行 `node tests/verify-opencode-v2.mjs`。

同时设置 `PROTOBRIDGE_PLAYWRIGHT_MODULE` 为已有 playwright-core 的 index.mjs 绝对路径、`PROTOBRIDGE_BROWSER` 为 Chrome 可执行文件，可附加真实浏览器交互验证。本轮已通过：打开绑定 Studio、编辑原型文字、点击发送和确认，验证模型收到的反馈路径所指文件包含该文字，页面没有脚本错误，另一会话仍无消息。此测试不等同于 OpenCode 桌面界面验证。

测试在临时 XDG 目录中安装实际包，启动本机 2.0.22 后端，创建两个临时会话，使用回环 HTTP 模型 fixture。它执行真实注册命令、加载 Studio 和原型、提交反馈，确认文件落盘，确认本地模型收到原会话反馈路径并自动回答，确认伪造会话被忽略、另一会话无消息、重试复用文件、关闭后页面为 410。结果见 `opencode-v2-validation-result.json`。

`npm test` 13 项通过；包含原有 DSH、ZCode 与共享 Host 回归。本轮只改本地项目和临时测试配置，未修改真实 OpenCode 配置、客户端安装目录，也未 commit、push 或创建 PR。

## 扫描与文件清理

自动发现保留当前项目内的 HTML，跳过嵌套 Git 仓库与同时含 studio.html/serve.mjs 的工具运行目录；隔离测试加入两类干扰页面，确认只发现当前项目原型。使用父目录会话仍会将反馈保存到父目录，插件不推测目标子项目。截图所示 00_chat/feedback 提示会话根目录需要核对。

清理本仓库 dist 内旧安装副本、10 份发布目录及旧 TGZ/ZIP，和根目录旧 TGZ。examples 的 demo/single/multi 被三套冒烟脚本使用，继续保留；research 的验证脚本与结论保留为可复现证据。未清理相邻项目或用户反馈。

## 验证边界

使用确定性本地模型 fixture，不使用用户凭据，不验证真实模型修改源文件的质量；未操作桌面 GUI，页面链接在实际客户端的展示仍需用户试用。此前用户失败的具体步骤尚未提供，不能把本轮复现的代理或版本问题断言为此前失败的原因。

## v0.3.0 最终检查

最终名称 agent-html-collab，界面 Agent HTML Collab · 人机协同。14 项 node:test、41 项通用浏览器检查、17 项单文档检查、18 项多文件检查以及 OpenCode V2 12 项隔离检查通过。检查覆盖报告目录缺失修复、预览不改源文件、实际回灌与备份、旧插件登记迁移、文字编辑、标注、通知开关及会话隔离。全部 JS 语法、JSON 与 npm 打包清单检查通过。Puppeteer 在当前 Windows 沙箱内启动超时；获得授权后在沙箱外运行相同测试命令通过。

这些检查不证明所有客户端或真实模型的行为无缺陷；ZCode 正式安装版的原生页面接口和真实模型自动改稿仍按前述边界处理。历史记录中的“不提交/推送”描述对应当时阶段，最终用户已授权提交、推送与仓库更名；没有创建 PR。
