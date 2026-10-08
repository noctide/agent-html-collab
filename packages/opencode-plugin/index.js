// registerPageBridge is a Agent HTML Collab contract, not an upstream browser API.
import { createPageBridge } from './host-bridge/index.mjs'
import { createSessionHost } from './session-host.mjs'

async function legacyServer(ctx) {
  const adapter = ctx.protobridge
  if (typeof adapter?.registerPageBridge !== 'function') {
    console.warn('[agent-html-collab] 客户端未接入页面归属接口；请通过独立 Studio 保存反馈并手动处理，不自动唤醒。')
    return {}
  }
  const dispose = await adapter.registerPageBridge(owner => createPageBridge({
    owner,
    saveFeedback: adapter.saveFeedback.bind(adapter),
    enqueue: ({ sessionId, text, feedbackId }) => adapter.enqueue({ sessionId, text, feedbackId }),
  }))
  return {
    event: async ({ event }) => {
      if (event.type === 'server.instance.disposed') await dispose?.()
    },
  }
}

export default {
  id: 'agent-html-collab',
  // V2 owns registration cleanup. Session identity comes from command invocation.
  async setup(ctx) {
    const host = await createSessionHost(ctx)
    try {
      await ctx.command.transform(editor => {
        editor.add({ name: 'agent-html-collab', description: '打开本会话的Agent HTML Collab页面',
          execute: async ({ sessionID }) => {
            const page = await host.open(sessionID)
            await ctx.session.synthetic({ sessionID,
              text: `Agent HTML Collab 页面：${page.url}\n请向用户展示此链接，说明打开后可编辑文字、移动元素或标注，并点击发送反馈。反馈会投递到本会话，无需等待工具，不要进入等待循环。元素移动表示布局调整意图，请按反馈核对源码结构和样式。结束时执行 /agent-html-collab-close。`, delivery: 'queue' })
          } })
        editor.add({ name: 'agent-html-collab-close', description: '关闭本会话的Agent HTML Collab页面',
          execute: async ({ sessionID }) => { await host.closePage(sessionID) } })
      })
      return () => host.dispose()
    } catch (error) { await host.dispose(); throw error }
  },
  server: legacyServer,
}
