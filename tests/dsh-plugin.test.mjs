import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply } from '../packages/dsh-plugin/index.mjs';
import vm from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';

async function createHost({ prompt } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'agent-html-collab-dsh-'));
  await writeFile(join(root, 'proto.html'), '<html><body><p>Original</p></body></html>');
  const agents = new Map(['session-a', 'session-b'].map(id => [id, { session: { id, header: { cwd: root } } }]));
  const routes = [], disposers = [], queued = [], upstreams = [], listeners = new Map();
  apply({
    agents: { get: id => agents.get(id) },
    connection: { admit: req => {
      if (req.headers['sec-fetch-site'] === 'cross-site' || req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return { rejection: 403 };
      return req.headers['x-test-auth'] ? {} : { rejection: 401 };
    } },
    sessionController: { prompt: async (request, signal) => { signal.throwIfAborted(); queued.push(request); return prompt ? prompt(request, signal) : { accepted: true }; } },
    webServer: { register: route => { routes.push(route); return () => {}; } },
    on: (event, listener) => { listeners.set(event, listener); const dispose = () => listeners.delete(event); disposers.push(dispose); return dispose; },
    effect: factory => { const dispose = factory(); disposers.push(dispose); return dispose; },
  }, { fetchLocal: (url, options) => { upstreams.push(url); return fetch(url, options); } });
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const route = routes.find(r => r.kind === 'exact' ? pathname === r.path : pathname === r.path || pathname.startsWith(r.path + '/'));
    if (route) route.handler(req, res); else { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (path, body, auth = true) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { 'x-test-auth': '1' } : {}) }, body: JSON.stringify(body) });
  return {
    root, agents, queued, upstreams, base, post,
    get: path => fetch(base + path, { headers: { 'x-test-auth': '1' } }),
    emit: async (event, value) => listeners.get(event)?.(value),
    dispose: async () => {
      for (const dispose of disposers.reverse()) await dispose?.();
      await new Promise(r => server.close(r));
    },
  };
}

async function assertStudioStopped(url) {
  assert.ok(url, 'a successful proxy request must expose the real Studio URL');
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      await response.arrayBuffer();
    } catch (error) {
      if (error.cause?.code === 'ECONNREFUSED') return;
      if (error.cause?.code !== 'ECONNRESET' && error.cause?.code !== 'UND_ERR_SOCKET') throw error;
    }
    await delay(50);
  }
  assert.fail('Studio still responds after its page owner was disposed');
}

test('DSH launcher registers a persistent entry even without a composer or session', async () => {
  let module;
  let status;
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: () => [null, value => { status = value; }],
  };
  vm.runInNewContext(await readFile(new URL('../packages/dsh-plugin/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: value => { module = value.factory(() => React); } } },
  });
  const entries = [];
  module.apply({
    effect: factory => factory(),
    locale: { register: () => () => {}, bind: () => key => key },
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { openTab: () => { throw new Error('sidebarRight: no session surface is mounted'); } },
    slots: { inject: (name, factory) => factory(), register: (options, component) => { entries.push({ options, component }); return () => {}; } },
  });
  const entry = entries.find(value => value.options.name === 'conversation.header.leading');
  assert.ok(entry, 'new-conversation hero must have an entry outside the composer dock');
  const view = entry.component({ ...entry.options.inject(), t: key => key });
  assert.equal(view.props.style.position, 'relative');
  assert.ok(!entries.some(value => value.options.name === 'shell.overlay'));
  const button = view.children.find(value => typeof value?.type === 'function');
  assert.equal(button.children[1], 'title');
  button.props.onClick();
  assert.equal(status, 'select');
});

test('DSH routes authenticate, capture page owner, proxy Studio and queue to that owner', async () => {
  const host = await createHost();
  const { agents, queued, base, post } = host;
  try {
    assert.equal((await post('/agent-html-collab/open', { sessionId: 'session-a', pageId: 'page-a' }, false)).status, 401);
    assert.equal((await fetch(base + '/agent-html-collab/open', { method: 'POST', headers: { origin: 'https://other.example', 'x-test-auth': '1' }, body: '{}' })).status, 403);
    const a = await post('/agent-html-collab/open', { sessionId: 'session-a', pageId: 'page-a' }).then(r => r.json());
    const b = await post('/agent-html-collab/open', { sessionId: 'session-b', pageId: 'page-b' }).then(r => r.json());
    assert.ok(a.bindingId, JSON.stringify(a)); assert.ok(b.bindingId, JSON.stringify(b));
    assert.equal(a.runtimeRevision, 'project-storage-v1');
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
    assert.equal(queued[0].requestId, 'agent-html-collab-feedback_dsh_0001');
    assert.equal(JSON.parse(await readFile(saved.file, 'utf8')).routing.pageId, 'page-a');
    await post(prefix + '/close', {});
    assert.equal((await post(feedbackPath, bundle)).status, 410);
    agents.delete('session-b');
    assert.equal((await fetch(base + b.url, { headers: { 'x-test-auth': '1' } })).status, 410);
  } finally {
    await host.dispose();
  }
});

for (const invalidation of ['deleted', 'replaced']) {
  test(`DSH close stops the Studio after its session is ${invalidation}`, async () => {
    const host = await createHost();
    try {
      const page = await host.post('/agent-html-collab/open', { sessionId: 'session-a', pageId: 'page-a' }).then(r => r.json());
      assert.equal((await host.get(page.url)).status, 200);
      const upstream = host.upstreams.at(-1);
      if (invalidation === 'deleted') host.agents.delete('session-a');
      else host.agents.set('session-a', { session: { header: { cwd: host.root } } });
      const closePath = page.url.replace(/\/studio$/, '/close');
      assert.equal((await host.post(closePath, {}, false)).status, 401, 'cleanup still requires client authentication');
      assert.equal((await fetch(upstream)).status, 200, 'unauthenticated close must leave the Studio running');
      const closed = await host.post(closePath, {});
      assert.equal(closed.status, 200);
      assert.deepEqual(await closed.json(), { closed: true });
      await assertStudioStopped(upstream);
      assert.equal((await host.get(page.url)).status, 410);
    } finally { await host.dispose(); }
  });
}

for (const route of ['GET', 'feedback']) {
  test(`DSH ${route} rejects an invalid owner and stops its Studio`, async () => {
    const host = await createHost();
    try {
      const page = await host.post('/agent-html-collab/open', { sessionId: 'session-a', pageId: 'page-a' }).then(r => r.json());
      assert.equal((await host.get(page.url)).status, 200);
      const upstream = host.upstreams.at(-1);
      host.agents.delete('session-a');
      const response = route === 'GET' ? await host.get(page.url) : await host.post(page.url.replace(/\/studio$/, '/feedback'), {
        feedbackId: 'feedback_stale_0001', notify: true, comments: [], edits: [],
      });
      assert.equal(response.status, 410);
      assert.equal(host.queued.length, 0);
      await assertStudioStopped(upstream);
    } finally { await host.dispose(); }
  });
}

test('DSH session disposal stops only the Studio owned by that session', async () => {
  const host = await createHost();
  try {
    const a = await host.post('/agent-html-collab/open', { sessionId: 'session-a', pageId: 'page-a' }).then(r => r.json());
    const b = await host.post('/agent-html-collab/open', { sessionId: 'session-b', pageId: 'page-b' }).then(r => r.json());
    assert.equal((await host.get(a.url)).status, 200);
    const upstreamA = host.upstreams.at(-1);
    assert.equal((await host.get(b.url)).status, 200);
    await host.emit('session/disposed', host.agents.get('session-a').session);
    await assertStudioStopped(upstreamA);
    assert.equal((await host.get(a.url)).status, 410);
    assert.equal((await host.get(b.url)).status, 200);
  } finally { await host.dispose(); }
});

test('DSH closing a page aborts its prompt signal when the controller supports cancellation', async () => {
  let promptSignal, releasePrompt, markEntered, pending;
  const entered = new Promise(resolve => { markEntered = resolve; });
  const host = await createHost({ prompt: async (request, signal) => {
    promptSignal = signal;
    markEntered();
    return new Promise((resolve, reject) => {
      releasePrompt = () => resolve({ accepted: true });
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  } });
  try {
    const page = await host.post('/agent-html-collab/open', { sessionId: 'session-a', pageId: 'page-a' }).then(r => r.json());
    pending = host.post(page.url.replace(/\/studio$/, '/feedback'), { feedbackId: 'feedback_abort_0001', notify: true, comments: [], edits: [] });
    let timeout;
    await Promise.race([entered, new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('feedback did not reach the prompt controller')), 3000);
    })]).finally(() => clearTimeout(timeout));
    assert.equal(promptSignal.aborted, false);
    assert.equal((await host.post(page.url.replace(/\/studio$/, '/close'), {})).status, 200);
    assert.equal(promptSignal.aborted, true);
    const result = await pending.then(r => r.json());
    assert.equal(result.saved, true);
    assert.equal(result.delivery, 'failed');
    assert.equal((await host.post(page.url.replace(/\/studio$/, '/feedback'), { feedbackId: 'feedback_abort_0002', comments: [], edits: [] })).status, 410);
    assert.equal(host.queued.length, 1);
  } finally {
    releasePrompt?.();
    await pending?.catch(() => {});
    await host.dispose();
  }
});

test('DSH closing a page cannot retract feedback already entering native prompt admission', async () => {
  let promptSignal, releasePrompt, markEntered, pending;
  const entered = new Promise(resolve => { markEntered = resolve; });
  const admission = new Promise(resolve => { releasePrompt = resolve; });
  const host = await createHost({ prompt: async (request, signal) => {
    // Native DSH checks cancellation on entry, then admission can still complete.
    signal.throwIfAborted();
    promptSignal = signal;
    markEntered();
    await admission;
    return { accepted: true };
  } });
  try {
    const page = await host.post('/agent-html-collab/open', { sessionId: 'session-a', pageId: 'page-a' }).then(r => r.json());
    pending = host.post(page.url.replace(/\/studio$/, '/feedback'), { feedbackId: 'feedback_admission_0001', notify: true, comments: [], edits: [] });
    let timeout;
    await Promise.race([entered, new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('feedback did not reach the prompt controller')), 3000);
    })]).finally(() => clearTimeout(timeout));
    assert.equal((await host.post(page.url.replace(/\/studio$/, '/close'), {})).status, 200);
    assert.equal(promptSignal.aborted, true);
    releasePrompt();
    const result = await pending.then(r => r.json());
    assert.equal(result.saved, true);
    assert.equal(result.delivery, 'queued', 'an accepted native admission cannot be reported as retracted');
    assert.equal(host.queued.length, 1);
  } finally {
    releasePrompt();
    await pending?.catch(() => {});
    await host.dispose();
  }
});

test('DSH reopened pages reuse identical feedback and its request ID but reject changed business content', async () => {
  const host = await createHost();
  try {
    const a = await host.post('/agent-html-collab/open', { sessionId: 'session-a', pageId: 'page-a' }).then(r => r.json());
    const bundle = { feedbackId: 'feedback_reopen_0001', notify: true, comments: [{ text: 'Keep this note' }], edits: [], source: { entry: 'proto.html' } };
    const firstResponse = await host.post(a.url.replace(/\/studio$/, '/feedback'), bundle);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    const original = await readFile(first.file, 'utf8');
    assert.equal((await host.post(a.url.replace(/\/studio$/, '/close'), {})).status, 200);
    const b = await host.post('/agent-html-collab/open', { sessionId: 'session-a', pageId: 'page-b' }).then(r => r.json());
    assert.notEqual(b.bindingId, a.bindingId);
    const secondResponse = await host.post(b.url.replace(/\/studio$/, '/feedback'), bundle);
    assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json();
    assert.equal(second.saved, true);
    assert.equal(second.delivery, 'queued');
    assert.equal(second.file, first.file);
    assert.equal(await readFile(first.file, 'utf8'), original, 'retries must preserve the original saved feedback');
    assert.equal(host.queued.length, 2);
    assert.deepEqual(host.queued.map(request => request.requestId), ['agent-html-collab-feedback_reopen_0001', 'agent-html-collab-feedback_reopen_0001']);
    assert.ok(host.queued.every(request => request.sessionId === 'session-a'));
    await host.post(b.url.replace(/\/studio$/, '/close'), {});
    const changes = [
      { ...bundle, comments: [{ text: 'Changed note' }] },
      { ...bundle, notify: false },
      { ...bundle, source: { entry: 'different.html' } },
    ];
    for (const [index, changed] of changes.entries()) {
      const c = await host.post('/agent-html-collab/open', { sessionId: 'session-a', pageId: 'page-c-' + index }).then(r => r.json());
      const rejected = await host.post(c.url.replace(/\/studio$/, '/feedback'), changed);
      assert.equal(rejected.status, 400);
      await host.post(c.url.replace(/\/studio$/, '/close'), {});
    }
    assert.equal(host.queued.length, 2, 'conflicting feedback must not be delivered');
    assert.equal(await readFile(first.file, 'utf8'), original);
  } finally { await host.dispose(); }
});

test('DSH feedback retries ignore only transient routing fields', async () => {
  const host = await createHost();
  try {
    const a = await host.post('/agent-html-collab/open', { sessionId: 'session-a', pageId: 'page-a' }).then(r => r.json());
    const bundle = { feedbackId: 'feedback_routing_0001', comments: [], edits: [] };
    const saved = await host.post(a.url.replace(/\/studio$/, '/feedback'), bundle).then(r => r.json());
    const stored = JSON.parse(await readFile(saved.file, 'utf8'));
    stored.routing.mode = 'other';
    await writeFile(saved.file, JSON.stringify(stored, null, 2));
    await host.post(a.url.replace(/\/studio$/, '/close'), {});
    const b = await host.post('/agent-html-collab/open', { sessionId: 'session-a', pageId: 'page-b' }).then(r => r.json());
    const response = await host.post(b.url.replace(/\/studio$/, '/feedback'), bundle);
    assert.equal(response.status, 400);
    assert.equal(host.queued.length, 1, 'persistent routing differences must not pass as an identical retry');
    assert.equal(JSON.parse(await readFile(saved.file, 'utf8')).routing.mode, 'other');
  } finally { await host.dispose(); }
});
