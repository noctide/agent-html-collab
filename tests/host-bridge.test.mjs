import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageBridge } from '../packages/host-bridge/index.mjs';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const feedback = (id = 'feedback_0001') => ({ feedbackId: id, comments: [], edits: [], notify: true });
const owner = { pageId: 'page-a', sessionId: 'session-a', projectRoot: '.' };

test('Studio inline scripts parse and the installed plugin includes its runtime', async () => {
  const html = readFileSync(new URL('../studio/studio.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!match[1].includes('text/plain')) new vm.Script(match[2]);
  }
  const root = mkdtempSync(join(tmpdir(), 'protobridge-install-test-'));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/protobridge.mjs', import.meta.url)), 'install-plugin', '--to', join(root, 'plugin')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const runtime = await import(pathToFileURL(join(root, 'plugin', 'host-bridge', 'index.mjs')));
  assert.equal(typeof runtime.createPageBridge, 'function');
});

test('two page owners remain isolated; forged routing is ignored', async () => {
  const messages = [], saves = [];
  const make = (o) => createPageBridge({ owner: o,
    saveFeedback: async (value) => { saves.push(value); return '/feedback/test.json'; },
    enqueue: async (value) => { messages.push(value); } });
  const a = make(owner), b = make({ ...owner, pageId: 'page-b', sessionId: 'session-b', projectRoot: './other' });
  await a.pageApi.submitFeedback({ ...feedback(), sessionId: 'session-b', projectRoot: '/forged', routing: { mode: 'forged' } });
  await b.pageApi.submitFeedback(feedback());
  assert.deepEqual(messages.map(x => x.sessionId), ['session-a', 'session-b']);
  assert.equal(saves[0].projectRoot, resolve('.'));
  assert.equal(saves[0].bundle.sessionId, undefined);
  assert.equal(saves[0].bundle.routing.pageId, 'page-a');
});

test('concurrent sends deduplicate; failed delivery retries without saving again', async () => {
  let saves = 0, attempts = 0;
  const bridge = createPageBridge({ owner,
    saveFeedback: async () => { saves++; return '/feedback/test.json'; },
    enqueue: async () => { if (++attempts === 1) throw new Error('offline'); } });
  const results = await Promise.all([bridge.pageApi.submitFeedback(feedback()), bridge.pageApi.submitFeedback(feedback())]);
  assert.ok(results.every(x => x.saved && x.delivery === 'failed'));
  assert.equal(saves, 1); assert.equal(attempts, 1);
  assert.equal((await bridge.pageApi.submitFeedback(feedback())).delivery, 'queued');
  await bridge.pageApi.submitFeedback(feedback());
  assert.equal(saves, 1); assert.equal(attempts, 2);
  await assert.rejects(bridge.pageApi.submitFeedback({ ...feedback(), notify: false }), /内容不能变化/);
});

test('disabled notifications and disposed bindings never enqueue', async () => {
  let calls = 0;
  const bridge = createPageBridge({ owner, saveFeedback: async () => '/feedback/test.json', enqueue: async () => calls++ });
  assert.equal((await bridge.pageApi.submitFeedback({ ...feedback(), notify: false })).delivery, 'disabled');
  bridge.dispose();
  await assert.rejects(bridge.pageApi.submitFeedback(feedback('feedback_0002')), /失效/);
  assert.equal(calls, 0);
});

test('closing a page during save prevents subsequent wakeup', async () => {
  let release, calls = 0;
  const bridge = createPageBridge({ owner,
    saveFeedback: () => new Promise(r => { release = r; }), enqueue: async () => calls++ });
  const pending = bridge.pageApi.submitFeedback(feedback());
  bridge.dispose(); release('/feedback/test.json');
  assert.equal((await pending).delivery, 'failed'); assert.equal(calls, 0);
});

test('browser transport uses captured Host; bound errors never fall back to HTTP', async () => {
  const source = readFileSync(new URL('../studio/host-transport.js', import.meta.url), 'utf8');
  let calls = 0;
  const window = { PROTOBRIDGE_HOST: { version: 1, submitFeedback: async () => { throw new Error('closed'); } } };
  vm.runInNewContext(source, { window, fetch: () => { calls++; } });
  await assert.rejects(window.ProtoBridgeTransport.submitFeedback(feedback()), /closed/);
  assert.equal(calls, 0);
});

test('HTTP fallback serves transport, reports manual delivery and saves distinct files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'protobridge-test-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../studio/serve.mjs', import.meta.url)), '--root', root, '--port', '0', '--stay-alive']);
  let log = '';
  try {
    const port = await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Server startup timeout: ' + log)), 10000);
      child.stdout.on('data', chunk => { log += chunk; const match = log.match(/127\.0\.0\.1:(\d+)\/studio/); if (match) { clearTimeout(timer); done(match[1]); } });
      child.on('error', error => { clearTimeout(timer); fail(error); });
      child.stderr.on('data', chunk => { log += chunk; });
    });
    const base = 'http://127.0.0.1:' + port;
    assert.equal((await fetch(base + '/tool-res/host-transport.js')).status, 200);
    const send = () => fetch(base + '/api/feedback', { method: 'POST', body: JSON.stringify({ ...feedback(), sessionId: 'forged' }) }).then(r => r.json());
    const [a, b] = await Promise.all([send(), send()]);
    assert.equal(a.saved, true); assert.equal(a.delivery, 'manual');
    assert.notEqual(a.file, b.file);
    assert.equal(readdirSync(join(root, 'feedback')).length, 2);
    const saved = JSON.parse(readFileSync(a.file, 'utf8'));
    assert.equal(saved.sessionId, undefined); assert.equal(saved.routing.mode, 'manual');
  } finally { child.kill(); }
});
