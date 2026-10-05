import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

function client() {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../packages/zcode-plugin/server.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let id = 0;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => { const value = JSON.parse(line); pending.get(value.id)?.resolve(value.result); pending.delete(value.id); });
  child.stderr.on('data', () => {});
  const call = (method, params) => new Promise((resolve, reject) => {
    const next = ++id; pending.set(next, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n');
  });
  return { child, call, tool: (name, args) => call('tools/call', { name, arguments: args }).then(result => {
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  }), close: () => { child.stdin.end(); return new Promise(r => child.once('exit', r)); } };
}

test('ZCode isolated MCP pages return feedback only to their pending tool calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'protobridge-zcode-'));
  await writeFile(join(root, 'proto.html'), '<html><body><p>Original</p></body></html>');
  const a = client(), b = client();
  try {
    assert.equal((await a.call('initialize', { protocolVersion: '2024-11-05' })).serverInfo.name, 'protobridge');
    assert.equal((await a.call('tools/list', {})).tools.length, 3);
    const pageA = await a.tool('open_studio', { projectRoot: root });
    const pageB = await b.tool('open_studio', { projectRoot: root });
    assert.notEqual(pageA.bindingId, pageB.bindingId);
    await assert.rejects(b.tool('wait_feedback', { bindingId: pageA.bindingId, timeoutSeconds: 1 }), /Unknown/);
    const baseA = new URL(pageA.url).origin;
    const send = () => fetch(pageA.url.replace(/\/studio$/, '/feedback'), { method: 'POST', headers: { origin: baseA, 'content-type': 'application/json' }, body: JSON.stringify({ feedbackId: 'feedback_zcode_0001', notify: true, comments: [], edits: [] }) }).then(r => r.json());
    assert.equal((await send()).delivery, 'failed');
    const wait = a.tool('wait_feedback', { bindingId: pageA.bindingId, timeoutSeconds: 5 });
    // Ping is processed after the preceding wait request, proving it is registered.
    await a.call('ping', {});
    const delivered = await send();
    assert.equal(delivered.saved, true); assert.equal(delivered.delivery, 'queued');
    const feedback = await wait;
    assert.equal(feedback.file, delivered.file);
    assert.ok(feedback.text.includes(delivered.file));
    assert.equal((await b.tool('wait_feedback', { bindingId: pageB.bindingId, timeoutSeconds: 1 })).timedOut, true);
    await a.tool('close_studio', { bindingId: pageA.bindingId });
    assert.equal((await fetch(pageA.url)).status, 410);
  } finally { await Promise.all([a.close(), b.close()]); }
});
