// OpenCode host integration. registerPageBridge is a ProtoBridge adapter contract,
// not an upstream browser API. Missing integration never falls back to another chat.
import { createPageBridge } from './host-bridge/index.mjs'
export default {
  id: 'protobridge',
  async setup(ctx: any) {
    const adapter = ctx.protobridge
    if (typeof adapter?.registerPageBridge !== 'function') {
      console.warn('[protobridge] 客户端未接入页面归属接口；仅保存反馈，不自动唤醒。')
      return () => {}
    }
    return adapter.registerPageBridge((owner: any) => createPageBridge({
      owner,
      saveFeedback: adapter.saveFeedback.bind(adapter),
      enqueue: ({ sessionId, text, feedbackId }: any) => adapter.enqueue({ sessionId, text, feedbackId }),
    }))
  },
}
