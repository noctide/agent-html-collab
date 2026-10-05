import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPageBridge } from '../host-bridge/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const inject = ['webServer', 'agents', 'sessionController', 'connection'];

export function apply(ctx) {
  const pages = new Map();
  const send = (res, status, value) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const readBody = async (req) => {
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 8e6) throw new Error('反馈过大');
    }
    return JSON.parse(text);
  };
  const admit = (req, res) => {
    const admission = ctx.connection.admit(req);
    if ('rejection' in admission) { send(res, admission.rejection, { error: '客户端认证失败' }); return false; }
    return true;
  };
  const stop = (id) => {
    const page = pages.get(id);
    if (!page) return;
    page.bridge.dispose(); page.child.kill(); pages.delete(id);
  };

  const open = async (sessionId, pageId) => {
    const agent = ctx.agents.get(sessionId);
    if (!agent?.session?.header?.cwd) throw new Error('所属会话未加载或没有项目目录，请先打开该对话');
    const projectRoot = resolve(agent.session.header.cwd);
    let closed = false;
    const bridge = createPageBridge({ owner: { sessionId, pageId, projectRoot },
      saveFeedback: async ({ projectRoot, bundle }) => {
        const config = await readFile(join(projectRoot, 'proto.config.json'), 'utf8').then(JSON.parse).catch(() => ({}));
        const dir = resolve(projectRoot, config.server?.feedbackDir || 'feedback');
        await mkdir(dir, { recursive: true });
        const file = join(dir, 'feedback-' + bundle.feedbackId + '.json');
        const text = JSON.stringify(bundle, null, 2);
        try { await writeFile(file, text, { flag: 'wx' }); }
        catch (error) { if (error.code !== 'EEXIST' || await readFile(file, 'utf8') !== text) throw error; }
        return file;
      },
      enqueue: async ({ sessionId, feedbackId, text }) => {
        if (closed || ctx.agents.get(sessionId) !== agent) throw new Error('页面所属会话已失效');
        const result = await ctx.sessionController.prompt({ sessionId, requestId: 'protobridge-' + feedbackId,
          content: [{ type: 'text', text }], mode: 'followup' });
        if (result?.accepted !== true) throw new Error('客户端未接受反馈通知');
      },
    });
    const id = bridge.binding.bindingId;
    const base = '/protobridge/pages/' + id;
    const child = spawn(process.execPath, [join(ROOT, 'studio/serve.mjs'), '--root', projectRoot, '--port', '0', '--stay-alive', '--base-path', base], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PROTOBRIDGE_WAKE: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    const page = { bridge, child, base, port: null, sessionId, agent };
    pages.set(id, page);
    child.once('exit', () => { closed = true; bridge.dispose(); pages.delete(id); });
    try {
      page.port = await new Promise((done, fail) => {
        let log = '';
        const timeout = setTimeout(() => fail(new Error('原型服务启动超时')), 10000);
        child.stdout.on('data', chunk => { log += chunk; const m = log.match(/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(timeout); done(m[1]); } });
        child.once('error', error => { clearTimeout(timeout); fail(error); });
        child.once('exit', () => { clearTimeout(timeout); fail(new Error('原型服务提前退出')); });
        child.stderr.on('data', chunk => { log += String(chunk).slice(0, 1000); });
      });
      return { bindingId: id, url: base + '/studio' };
    } catch (error) { stop(id); throw error; }
  };

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/protobridge/open', handler: async (req, res) => {
    try {
      if (!admit(req, res)) return;
      if (req.method !== 'POST') return send(res, 405, { error: 'POST required' });
      // connection.admit applies the client's Host/Origin fence and cookie auth.
      // Same-origin desktop requests may legitimately omit Origin.
      const { sessionId, pageId } = await readBody(req);
      if (typeof sessionId !== 'string' || typeof pageId !== 'string' || !pageId) throw new Error('页面归属不完整');
      send(res, 200, await open(sessionId, pageId));
    } catch (error) { send(res, 400, { error: error.message }); }
  } }), 'protobridge: open bound page');

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/protobridge/pages/', handler: async (req, res) => {
    try {
      if (!admit(req, res)) return;
      const url = new URL(req.url, 'http://localhost');
      const id = url.pathname.split('/')[3];
      const page = pages.get(id);
      if (!page || !page.port || ctx.agents.get(page.sessionId) !== page.agent) return send(res, 410, { error: '页面绑定已失效' });
      const tail = url.pathname.slice(page.base.length);
      if (req.method === 'POST') {
        if (tail === '/close') { stop(id); return send(res, 200, { closed: true }); }
        if (tail !== '/feedback') return send(res, 404, { error: 'Not found' });
        return send(res, 200, await page.bridge.pageApi.submitFeedback(await readBody(req)));
      }
      if (req.method !== 'GET') return send(res, 405, { error: 'GET required' });
      const upstream = await fetch('http://127.0.0.1:' + page.port + url.pathname + url.search);
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      res.writeHead(upstream.status, { 'content-type': contentType, 'cache-control': 'no-store', 'referrer-policy': 'same-origin' });
      if (tail === '/studio' && upstream.ok) {
        const html = await upstream.text();
        const api = `<script>window.PROTOBRIDGE_HOST={version:1,submitFeedback:function(bundle){return fetch(${JSON.stringify(page.base + '/feedback')},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(bundle)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'提交失败');return j})})}};<\/script>`;
        res.end(html.replace('<head>', '<head>' + api));
      } else res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) { send(res, 400, { error: error.message }); }
  } }), 'protobridge: bound page routes');

  ctx.effect(() => () => { for (const id of [...pages.keys()]) stop(id); }, 'protobridge: page cleanup');
}
