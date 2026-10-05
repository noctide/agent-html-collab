# 内置浏览器页面绑定（v0.2 接入契约）

插件只在客户端安装一次。HTML 文件不需要复制插件包。绑定属于内置浏览器页面实例，页面中切换原型文件不会改投递目标。

## 当前状态

仓库提供通用核心与 DSH、ZCode 适配。DSH 已按本机安装代码接入页面 scoped Slot 和 sessionController.prompt（内部 followup）；ZCode 采用会话隔离的 stdio MCP 等待工具。真实客户端 GUI 尚待安装联动验证。见 [客户端接入](client-adapters.md)。
以下是其他客户端实现适配时的通用契约。

## 客户端接入

Host 在打开 Studio 页面时，从客户端可信的页面归属记录取得 `pageId`、`sessionId`、`projectRoot`。不要使用“当前聚焦对话”、最近消息、页面查询参数或页面提供的 sessionId 作为路由依据。

```js
import { createPageBridge } from '../packages/host-bridge/index.mjs';

const bridge = createPageBridge({
  owner: { pageId, sessionId, projectRoot }, // 来自客户端页面归属
  saveFeedback: async ({ projectRoot, bundle }) => {
    // 保存到此项目的反馈目录，使用 feedbackId 实现持久幂等。
    // 返回已保存文件的绝对路径。
    return saveProjectFeedback(projectRoot, bundle);
  },
  enqueue: async ({ sessionId, feedbackId, text }) => {
    // 客户端真实的会话投递 API：应验证会话归属、排队投递。
    // 用 feedbackId 持久去重，解决“已接受消息但响应丢失”的重试。
    await enqueueSessionMessage(sessionId, text, feedbackId);
  },
});
```

上例 `saveProjectFeedback` 和 `enqueueSessionMessage` 是客户端要实现的回调，非仓库现成 API。
通过客户端受限的 preload/RPC 桥，在 Studio 脚本执行前暴露 `window.PROTOBRIDGE_HOST = bridge.pageApi`（version=1、submitFeedback）。Host 对 RPC 的页面发送者做校验，不向 iframe 或任意外部页面暴露该桥。跨进程不能直接注入 Node 对象，要用客户端的 RPC 包装同名方法。
页面关闭、归属变化、会话删除时调用 `bridge.dispose()`。重新绑定必须创建新 bridge；不得修改已有绑定。

OpenCode 包的 `ctx.protobridge.registerPageBridge(factory)` 是本项目约定的适配入口，**不是已核实的上游 API**。客户端实现它，负责上述页面打开、桥注入和关闭生命周期，同时提供 `saveFeedback` 和 `enqueue`。

## 行为

- 成功：`{ saved: true, file, delivery: 'queued' }`。
- 关闭通知：`delivery: 'disabled'`，只保存。
- 通知失败：`delivery: 'failed'`，保留文件；页面重试同一包，不重复保存。
- 无 Host：本地 `/api/feedback` 返回 `delivery: 'manual'`，页面提示手动处理。
- 两个页面分别打开同一 HTML，可以分别绑定不同对话，不共享全局目标。

内存去重覆盖当前页面生命周期；跨重启去重由 Host 回调负责。cookie 不用于确定目标会话。

## 从 v0.1 迁移

移除全局目标、最近对话兜底及文件扫描自动通知。旧 `protobridge-target.json` 不再读取。
升级时停用旧版本插件，安装新包并重启客户端。未实现页面适配的客户端将退回手动处理，不再自动唤醒。
