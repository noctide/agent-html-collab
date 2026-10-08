# DSH 修复与验证记录

验证日期：2026-10-06 UTC（本地 2026-10-05）。宿主为用户安装的 DeepSeek Harness 0.2.0-rc.2。

## 本次修复

- 会话被删除或替换后，认证通过的 `/close` 仍可清理 Studio；其他失效请求立即清理页面。监听原生 `session/disposed`，关闭对应页面并向正在投递的请求发出取消信号。启动完成后再次检查归属，避免返回失效 URL。
- 相同 feedbackId 的跨页面重试只忽略临时 `routing.bindingId/pageId`，复用首次反馈文件且不修改其字节。业务内容和其他 routing 字段变化仍拒绝；投递使用当前有效绑定。

`npm test`：23/23 通过，其中 DSH 11/11。新增回归先在原实现上复现失败，再在修复后通过。测试使用真实临时 HTTP 和 Studio 子进程，DSH 服务接口由测试替身提供。`node --check packages/dsh-plugin/index.mjs` 和 `git diff --check` 通过。

## 真实 GUI 单会话联调

通过 pnpm 安装本地 TGZ 到既有 desktop profile，完全退出 DSH 后重启。安装前备份 profile 的 package.json 和 pnpm-lock.yaml 至忽略目录 `dist/dsh-profile-backup`；原有壁纸和挂件依赖版本保持不变。

安装的生产文件与仓库 `packages/dsh-plugin/index.mjs` 的 SHA256 一致：

`23427DCC2975D915AA8754A73DA808F207044281E00A27E4747482287428B22A`

独立测试目录为 `dist/dsh-gui-project`。测试会话名称为“DSH 插件联调临时会话 A”，明确要求模型只确认收到、不读取或修改文件。结果：

1. 顶部“原型协同”按钮出现，并打开会话内侧栏 Studio。
2. 关闭并重新打开侧栏后获得新的页面绑定。
3. 在原型里把标题从“DSH 插件联调原型”改为“DSH 插件联调原型 · GUI A 验证”；显示 0 条意见、1 处改动。
4. 确认发送后，生成 `dist/dsh-gui-project/feedback/feedback-3d3a7831-7dfb-4348-ad86-e2b79489af82.json`。内容为上述单一标题改动，`notify: true`，`routing.pageId: tab4`，bindingId 为 `fce21791-54d9-4413-86a5-20728fe2a04a`。
5. 原测试会话出现同一路径的 Agent HTML Collab 通知，模型回复“已收到反馈包”，并说明仅确认收到。原始 proto.html 内容保持不变。
6. 测试标签页关闭。保留测试会话和反馈作为核对记录。

这证明单会话的原生打开、编辑、落盘和 followup 往返。多会话切换、删除会话、后台子进程退出、同 ID 重试及取消竞态没有全部逐项 GUI 验证，不把协议测试替身当成真实宿主验收。

## 取消边界

本机 `@deepseek-ai/dsh-api-session-controller/lib/index.js` 的 prompt 方法仅在入口执行 `signal.throwIfAborted()`，随后调用 `commands.prompt(request)`，没有继续传递 signal。插件关闭页面能停止后续请求并发出取消信号，但已进入宿主接收流程或已接受的消息不能保证撤回。该边界由源码和回归测试证明；未进行 GUI 竞态实验。

## 历史问题：旧默认草稿没有项目隔离

独立新工作区第一次打开 Studio 时显示 1 条已有意见。设置测试专属 storage 键后显示 0 条。本次没有发送旧草稿，也没有读取、删除或迁移用户 localStorage。

旧版源码依据：`studio/studio.html` 使用固定默认 `proto.*` 键，`collectBundle()` 全量收集这些键里的意见和改动；DSH `packages/dsh-plugin/client.js` 用 `srcDoc` 与 `allow-same-origin` 加载页面，资源的 base URL 不隔离 localStorage。因此 Host 的会话路由虽然正确，草稿内容仍可能混入其他项目。

历史问题复现：在源码仓库运行 `node research/dsh-draft-storage-repro.mjs`，直接使用旧共享键、虚拟 Map 和真实 collectBundle 函数，绕过服务端注入的项目键，无用户数据。

当前修复：`studio/serve.mjs` 从可信项目根目录派生稳定存储键，覆盖默认意见、改字、编号、模式、页面和通知状态；移动草稿由最终改字键派生。显式配置保留，旧 `proto.*` 不自动导入或删除。重开页面的随机 bindingId 不影响项目键。

当前代码验证：32 项单元测试通过，其中 DSH 11 项；`node tests/verify-storage.mjs` 的 15 项同源嵌入页面回归通过，覆盖项目隔离、重开恢复、旧键保留及反馈归属。该浏览器回归使用隔离 Chromium 和模拟宿主服务，不代表新版的真实 DSH GUI 验收；上述真实单会话记录属于此前安装的版本。
