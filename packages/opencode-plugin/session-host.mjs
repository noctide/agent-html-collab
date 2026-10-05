import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

// 使用 Node HTTP 直连回环地址，避免 OpenCode/Bun 的全局 fetch 代理影响本地链路。
function localFetch(url, options = {}) {
  return new Promise((done, fail) => {
    const request = http.request(url, { method: options.method || 'GET', headers: options.headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', fail);
      response.on('end', () => done(new Response(Buffer.concat(chunks), {
        status: response.statusCode, headers: response.headers,
      })));
    });
    request.on('error', fail);
    request.end(options.body);
  });
}

// The installed package carries the same local Host and Studio as the workspace.
async function loadHost() {
  const installed = new URL('./runtime/packages/dsh-plugin/index.mjs', import.meta.url);
  try { await access(installed); return import(installed); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return import('../dsh-plugin/index.mjs');
}

export async function createSessionHost(ctx) {
  const routes = [], disposers = [], agents = new Map(), pages = new Map();
  const capability = randomUUID();
  let closed = false;
  const server = http.createServer((req, res) => {
    // Browser requests may use only their unpredictable page URL, not the open route.
    if (req.headers.host !== new URL(base).host ||
        (req.headers.origin && req.headers.origin !== base) ||
        req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: '本地 Host/Origin 校验失败', host: req.headers.host, expected: new URL(base).host })); return;
    }
    const pathname = new URL(req.url, base).pathname;
    const route = routes.find(r => r.kind === 'exact' ? pathname === r.path : pathname.startsWith(r.path + '/'));
    if (route) route.handler(req, res); else { res.writeHead(404); res.end(); }
  });
  let base;
  const { apply } = await loadHost();
  apply({
    agents: { get: id => agents.get(id) },
    connection: { admit: req => req.headers['x-agent-html-collab-capability'] === capability ||
      req.url.startsWith('/agent-html-collab/pages/') ? {} : { rejection: 401 } },
    sessionController: { prompt: async request => {
      const owner = agents.get(request.sessionId);
      const current = await ctx.session.get({ sessionID: request.sessionId });
      if (!owner || closed || resolve(current.location.directory) !== owner.session.header.cwd)
        throw new Error('页面所属会话已失效或工作区已改变');
      // Stable message identity survives a lost HTTP response; queue never steers a running turn.
      const id = 'msg_' + createHash('sha256').update(request.sessionId + ':' + request.requestId).digest('hex');
      const result = await ctx.session.prompt({ sessionID: request.sessionId, id,
        text: request.content[0].text, delivery: 'queue' });
      if (!result?.id) throw new Error('OpenCode 未确认接收反馈');
      return { accepted: true };
    } },
    webServer: { register: route => { routes.push(route); return () => {}; } },
    effect: factory => { const dispose = factory(); disposers.push(dispose); return dispose; },
  }, { nodeExecutable: ctx.options?.nodeExecutable || 'node', fetchLocal: localFetch });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  base = 'http://127.0.0.1:' + server.address().port;
  const post = async (path, body) => {
    const response = await localFetch(base + path, { method: 'POST', headers: {
      origin: base, 'content-type': 'application/json', 'x-agent-html-collab-capability': capability,
    }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(value?.error || `Agent HTML Collab HTTP ${response.status}`);
    return value;
  };
  return {
    async open(sessionID) {
      if (closed) throw new Error('Agent HTML Collab 已关闭');
      const session = await ctx.session.get({ sessionID });
      if (!session.location?.directory) throw new Error('会话没有本地项目目录');
      const existing = pages.get(sessionID);
      if (existing) return existing;
      agents.set(sessionID, { session: { header: { cwd: resolve(session.location.directory) } } });
      const page = await post('/agent-html-collab/open', { sessionId: sessionID, pageId: randomUUID() });
      const value = { ...page, url: base + page.url };
      pages.set(sessionID, value);
      return value;
    },
    async closePage(sessionID) {
      const page = pages.get(sessionID);
      if (page) await post(new URL(page.url).pathname.replace(/\/studio$/, '/close'), {});
      pages.delete(sessionID); agents.delete(sessionID);
    },
    async dispose() {
      closed = true;
      for (const dispose of disposers.reverse()) await dispose?.();
      agents.clear(); pages.clear();
      await new Promise(done => server.close(done));
    },
  };
}
