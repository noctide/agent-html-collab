// The client supplies trusted page ownership; HTML never supplies routing.
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

export function createPageBridge({ owner, saveFeedback, enqueue, maxFeedback = 1000 }) {
  if (!owner?.pageId || !owner?.sessionId || !owner?.projectRoot) throw new Error('Page ownership is required');
  if (typeof saveFeedback !== 'function' || typeof enqueue !== 'function') throw new Error('Host callbacks are required');
  const binding = Object.freeze({ bindingId: randomUUID(), pageId: owner.pageId,
    sessionId: owner.sessionId, projectRoot: resolve(owner.projectRoot) });
  const records = new Map();
  let active = true;
  async function submitFeedback(input) {
    if (!active) throw new Error('页面绑定已失效，请重新打开页面');
    const bundle = JSON.parse(JSON.stringify(input));
    if (!bundle || !Array.isArray(bundle.comments) || !Array.isArray(bundle.edits)) throw new Error('反馈结构不符');
    if (typeof bundle.feedbackId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(bundle.feedbackId)) throw new Error('反馈 ID 不合法');
    delete bundle.sessionId;
    delete bundle.sessionID;
    delete bundle.projectRoot;
    delete bundle.bindingId;
    bundle.routing = { bindingId: binding.bindingId, pageId: binding.pageId, mode: 'page' };
    const fingerprint = JSON.stringify(bundle);
    let record = records.get(bundle.feedbackId);
    if (record && record.fingerprint !== fingerprint) throw new Error('相同反馈 ID 的内容不能变化');
    if (!record) {
      if (records.size >= maxFeedback) throw new Error('页面反馈数量已达上限，请重新打开页面');
      record = { fingerprint, bundle, file: null, delivery: 'pending', running: null };
      records.set(bundle.feedbackId, record);
    }
    if (record.running) return record.running;
    record.running = (async () => {
      if (!record.file) record.file = await saveFeedback({ projectRoot: binding.projectRoot, bundle: record.bundle });
      if (typeof record.file !== 'string' || !record.file) throw new Error('Host 未返回反馈文件路径');
      if (!active) return { saved: true, file: record.file, delivery: 'failed', error: '页面绑定已失效' };
      if (record.bundle.notify === false) record.delivery = 'disabled';
      else if (record.delivery !== 'queued') {
        try {
          await enqueue({ sessionId: binding.sessionId, projectRoot: binding.projectRoot,
            feedbackId: record.bundle.feedbackId, file: record.file,
            text: `Agent HTML Collab:新反馈包，请按项目约定读取并处理。\n包路径:${record.file}` });
          record.delivery = 'queued';
        } catch (error) {
          record.delivery = 'failed';
          return { saved: true, file: record.file, delivery: 'failed', error: String(error.message || error) };
        }
      }
      return { saved: true, file: record.file, delivery: record.delivery };
    })();
    try { return await record.running; } finally { record.running = null; }
  }
  return { binding, pageApi: Object.freeze({ version: 1, submitFeedback }), dispose() { active = false; } };
}
