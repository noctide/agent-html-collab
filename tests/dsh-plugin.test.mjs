import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply } from '../packages/dsh-plugin/index.mjs';

test('DSH routes authenticate, capture page owner, proxy Studio and queue to that owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'protobridge-dsh-'));
  await writeFile(join(root, 'proto.html'), '<html><body><p>Original</p></body></html>');
  const agentA = { session: { header: { cwd: root } } };
  const agentB = { session: { header: { cwd: root } } };
  const agents = new Map([['session-a', agentA], ['session-b', agentB]]);
  const routes = [], disposers = [], queued = [];
  apply({
    agents: { get: id => agents.get(id) },
    connection: { admit: req => req.headers['x-test-auth'] ? {} : { rejection: 401 } },
    sessionController: { prompt: async request => { queued.push(request); return { accepted: true }; } },
    webServer: { register: route => { routes.push(route); return () => {}; } },
    effect: factory => { const dispose = factory(); disposers.push(dispose); return dispose; },
  });
  const server = http.createServer((req, res) => {
    const route = routes.find(r => r.kind === 'exact' ? req.url === r.path : req.url.startsWith(r.path));
    if (route) route.handler(req, res); else { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (path, body, auth = true) => fetch(base + path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', ...(auth ? { 'x-test-auth': '1' } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/protobridge/open', { sessionId: 'session-a', pageId: 'page-a' }, false)).status, 401);
    const a = await post('/protobridge/open', { sessionId: 'session-a', pageId: 'page-a' }).then(r => r.json());
    const b = await post('/protobridge/open', { sessionId: 'session-b', pageId: 'page-b' }).then(r => r.json());
    assert.ok(a.bindingId, JSON.stringify(a)); assert.ok(b.bindingId, JSON.stringify(b));
    const html = await fetch(base + a.url, { headers: { 'x-test-auth': '1' } }).then(r => r.text());
    assert.ok(html.includes('window.PROTOBRIDGE_HOST='));
    const prefix = a.url.replace(/\/studio$/, '');
    assert.ok(html.includes(prefix + '/tool-res/host-transport.js'));
    const config = await fetch(base + prefix + '/api/config', { headers: { 'x-test-auth': '1' } }).then(r => r.json());
    assert.ok(config.source.entry.startsWith(prefix + '/project/'));
    assert.equal((await fetch(base + prefix + '/project/proto.html', { headers: { 'x-test-auth': '1' } })).status, 200);
    const bundle = { feedbackId: 'feedback_dsh_0001', notify: true, comments: [], edits: [], sessionId: 'session-b' };
    const feedbackPath = prefix + '/feedback';
    const saved = await post(feedbackPath, bundle).then(r => r.json());
    assert.equal(saved.saved, true); assert.equal(saved.delivery, 'queued');
    await post(feedbackPath, bundle);
    assert.equal(queued.length, 1); assert.equal(queued[0].sessionId, 'session-a');
    assert.equal(queued[0].requestId, 'protobridge-feedback_dsh_0001');
    assert.equal(JSON.parse(await readFile(saved.file, 'utf8')).routing.pageId, 'page-a');
    await post(prefix + '/close', {});
    assert.equal((await post(feedbackPath, bundle)).status, 410);
    agents.delete('session-b');
    assert.equal((await fetch(base + b.url, { headers: { 'x-test-auth': '1' } })).status, 410);
  } finally {
    for (const dispose of disposers.reverse()) await dispose?.();
    await new Promise(r => server.close(r));
  }
});
