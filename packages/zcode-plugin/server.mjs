#!/usr/bin/env node
// Session-isolated stdio MCP: replies to the waiting tool invocation, so the
// harness owns routing. It does not impersonate an undocumented desktop API.
import http from 'node:http';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { apply } from '../dsh-plugin/index.mjs';

const routes = [], disposers = [], agents = new Map(), pages = new Map(), waiters = new Map();
const cancelledRequests = new Set();
const capability = randomUUID();
const ownerId = 'mcp-session-' + randomUUID();
const server = http.createServer((req, res) => {
  const route = routes.find(r => r.kind === 'exact' ? req.url === r.path : req.url.startsWith(r.path));
  if (route) route.handler(req, res); else { res.writeHead(404); res.end(); }
});
apply({
  agents: { get: id => agents.get(id) },
  connection: { admit: req => req.headers['x-agent-html-collab-capability'] === capability || req.url.startsWith('/agent-html-collab/pages/') ? {} : { rejection: 401 } },
  sessionController: { prompt: async request => {
    const waiter = [...waiters.values()].find(value => request.content[0].text.includes(value.prefix));
    if (!waiter) throw new Error('对话尚未等待反馈；请让 agent 调用 wait_feedback，然后重试通知');
    waiters.delete(waiter.bindingId); clearTimeout(waiter.timer);
    waiter.resolve({ file: waiter.prefix + request.requestId.replace('agent-html-collab-', 'feedback-') + '.json', text: request.content[0].text, instruction: 'Report receipt and process this feedback. Do not automatically wait again. Ask whether the user wants another feedback round; wait again only after they agree or previously explicitly requested continuous collection.' });
    return { accepted: true };
  } },
  webServer: { register: route => { routes.push(route); return () => {}; } },
  effect: factory => { const dispose = factory(); disposers.push(dispose); return dispose; },
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const post = (path, body) => fetch(base + path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'x-agent-html-collab-capability': capability }, body: JSON.stringify(body) }).then(async r => { const result = await r.json(); if (!r.ok) throw new Error(result.error); return result; });
const tools = [
  { name: 'open_studio', description: 'Open a page bound to this MCP session. Open returned URL in the built-in browser, tell the user how to edit and send feedback, then call wait_feedback once.', inputSchema: { type: 'object', properties: { projectRoot: { type: 'string' } }, required: ['projectRoot'], additionalProperties: false } },
  { name: 'wait_feedback', description: 'Wait for one feedback round after telling the user the page is ready and how to send. On receipt, process feedback and ask before another round. On timeout, end the turn with a clear status; repeat only if the user explicitly requested continuous collection.', inputSchema: { type: 'object', properties: { bindingId: { type: 'string' }, timeoutSeconds: { type: 'number', minimum: 1, maximum: 600 } }, required: ['bindingId'], additionalProperties: false } },
  { name: 'close_studio', description: 'Invalidate a bound page and stop its prototype service.', inputSchema: { type: 'object', properties: { bindingId: { type: 'string' } }, required: ['bindingId'], additionalProperties: false } },
];

async function invoke(name, args, requestId) {
  if (name === 'open_studio') {
    if (pages.size) throw new Error('此会话已有原型页面，请先 close_studio 再打开另一项目');
    if (typeof args.projectRoot !== 'string') throw new Error('projectRoot required');
    const projectRoot = resolve(args.projectRoot);
    if (!(await stat(projectRoot)).isDirectory()) throw new Error('Project directory required');
    const agent = { session: { header: { cwd: projectRoot } } };
    agents.set(ownerId, agent);
    const page = await post('/agent-html-collab/open', { sessionId: ownerId, pageId: randomUUID() });
    page.projectRoot = projectRoot;
    pages.set(page.bindingId, page);
    return { ...page, url: base + page.url, deliveryMode: 'waiting-tool', instruction: 'Open this URL inside the client browser. Before waiting, tell the user: 页面已打开，请在右侧原型中选择“编辑”改字或“标注”提意见，再点击“发送反馈”并确认。我会等待这一轮反馈；无需在聊天里重复粘贴。 Then call wait_feedback once. Do not start an automatic waiting loop unless the user explicitly requested continuous collection.' };
  }
  const page = pages.get(args.bindingId);
  if (!page) throw new Error('Unknown or closed page binding');
  if (name === 'close_studio') {
    await post(page.url.replace(/\/studio$/, '/close'), {});
    pages.delete(args.bindingId);
    const waiter = waiters.get(args.bindingId);
    if (waiter) { clearTimeout(waiter.timer); waiters.delete(args.bindingId); waiter.reject(new Error('Page closed')); }
    return { closed: true };
  }
  if (name !== 'wait_feedback') throw new Error('Unknown tool');
  if (waiters.has(args.bindingId)) throw new Error('This page already has a pending wait');
  const seconds = args.timeoutSeconds ?? 600;
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 600) throw new Error('Invalid timeoutSeconds');
  // Read the effective project configuration just as the Host saver does.
  const { readFile } = await import('node:fs/promises');
  const { join, sep } = await import('node:path');
  const config = await readFile(join(page.projectRoot, 'proto.config.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  if (cancelledRequests.has(requestId)) throw new Error('等待工具已取消，请重新等待后重试通知');
  const prefix = resolve(page.projectRoot, config.server?.feedbackDir || 'feedback') + sep;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(args.bindingId); resolve({ timedOut: true, instruction: 'No feedback arrived during this wait. Unless the user explicitly requested continuous collection, end this turn and tell them: 本轮等待已结束，尚未收到反馈。准备好后在聊天里说“继续收集反馈”，我重新等待后你再发送；页面里的改动仍可保留，当前不会主动唤醒我。 Do not automatically call wait_feedback again.' }); }, seconds * 1000);
    waiters.set(args.bindingId, { bindingId: args.bindingId, requestId, prefix, resolve, reject, timer });
  });
}

function respond(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
const input = readline.createInterface({ input: process.stdin });
input.on('line', async line => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.method === 'notifications/cancelled') {
    cancelledRequests.add(request.params?.requestId);
    for (const waiter of waiters.values()) {
      if (waiter.requestId !== request.params?.requestId) continue;
      clearTimeout(waiter.timer); waiters.delete(waiter.bindingId);
      waiter.reject(new Error('等待工具已取消，请重新等待后重试通知'));
    }
    return;
  }
  if (request.id === undefined) return;
  try {
    let result;
    if (request.method === 'initialize') result = { protocolVersion: request.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-html-collab', version: '0.3.0' } };
    else if (request.method === 'ping') result = {};
    else if (request.method === 'tools/list') result = { tools };
    else if (request.method === 'tools/call') {
      try { result = { content: [{ type: 'text', text: JSON.stringify(await invoke(request.params.name, request.params.arguments || {}, request.id)) }] }; }
      catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
    } else throw new Error('Unsupported MCP method');
    cancelledRequests.delete(request.id);
    respond({ jsonrpc: '2.0', id: request.id, result });
  } catch (error) { respond({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: error.message } }); }
});
async function close() {
  for (const waiter of waiters.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('MCP session closed')); }
  waiters.clear();
  for (const dispose of disposers.reverse()) await dispose?.();
  server.close();
}
input.on('close', close);
process.once('SIGTERM', () => close().then(() => process.exit(0)));
process.once('SIGINT', () => close().then(() => process.exit(0)));
