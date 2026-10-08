import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fields = ['edits', 'moves', 'comments', 'ecount', 'mode', 'annoMode', 'page', 'notify'];
const serverFile = fileURLToPath(new URL('../studio/serve.mjs', import.meta.url));
const fixturePrefix = 'agent-html-collab-storage-';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), fixturePrefix));
  t.after(async () => {
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith(fixturePrefix));
    await rm(target, { recursive: true, force: true });
  });
  return root;
}

async function project(root, name, storage) {
  const target = join(root, name);
  await mkdir(target);
  await writeFile(join(target, 'proto.html'), '<!doctype html><title>Shared title</title><p>Draft</p>');
  if (storage !== undefined) {
    await writeFile(join(target, 'proto.config.json'), JSON.stringify({
      title: 'Shared title', source: { mode: 'single', file: 'proto.html' }, storage,
    }));
  }
  return target;
}

async function config(root, { basePath = '', configFile } = {}) {
  const args = [serverFile, '--root', root, '--port', '0', '--stay-alive'];
  if (basePath) args.push('--base-path', basePath);
  if (configFile) args.push('--config', configFile);
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  try {
    const port = await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Server startup timeout: ' + log)), 10000);
      const finish = (value, error) => {
        clearTimeout(timer);
        child.off('error', onError);
        child.off('exit', onExit);
        if (error) fail(error); else done(value);
      };
      const onError = error => finish(null, error);
      const onExit = code => finish(null, new Error('Server exited with ' + code + ': ' + log));
      child.on('error', onError);
      child.on('exit', onExit);
      child.stdout.on('data', chunk => {
        log += chunk;
        const match = log.match(/http:\/\/127\.0\.0\.1:(\d+)\/studio/);
        if (match) finish(match[1]);
      });
      child.stderr.on('data', chunk => { log += chunk; });
    });
    const response = await fetch('http://127.0.0.1:' + port + basePath + '/api/config', {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    return await response.json();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((done, fail) => {
        const timer = setTimeout(() => fail(new Error('Server did not stop')), 5000);
        child.once('close', () => { clearTimeout(timer); done(); });
        child.kill();
      });
    }
  }
}

function expectedStorage(root) {
  const path = resolve(root);
  const hash = createHash('sha256').update(process.platform === 'win32' ? path.toLowerCase() : path).digest('hex');
  const storage = Object.fromEntries(fields.filter(field => field !== 'moves').map(field => [field, 'proto.project.' + hash + '.' + field]));
  storage.moves = storage.edits + '.moves';
  return storage;
}

test('project roots with the same title receive distinct keys for every draft field', async t => {
  const root = await fixture(t);
  const a = await project(root, 'a');
  const b = await project(root, 'b');
  const [first, second] = await Promise.all([config(a), config(b)]);
  assert.equal(first.title, second.title);
  assert.deepEqual(first.storage, expectedStorage(a));
  assert.deepEqual(second.storage, expectedStorage(b));
  for (const field of fields) assert.notEqual(first.storage[field], second.storage[field]);
});

test('one project retains its draft keys across page base paths, restart and config changes', async t => {
  const root = await fixture(t);
  const target = await project(root, 'project');
  const first = await config(target, { basePath: '/session/first-page' });
  const second = await config(target, { basePath: '/session/second-page' });
  const configFile = join(target, 'alternate.json');
  await writeFile(configFile, JSON.stringify({ title: 'Changed title', source: { mode: 'single', file: 'proto.html' } }));
  const third = await config(join(target, '.'), { configFile });
  assert.deepEqual(first.storage, expectedStorage(target));
  assert.deepEqual(second.storage, first.storage);
  assert.deepEqual(third.storage, first.storage);
  assert.notEqual(third.title, first.title);
});

test('an explicit legacy draft key is retained while omitted fields stay project scoped', async t => {
  const root = await fixture(t);
  const a = await project(root, 'a', { edits: 'proto.edits' });
  const b = await project(root, 'b', { edits: 'custom.edits' });
  const [first, second] = await Promise.all([config(a), config(b)]);
  assert.deepEqual(first.storage, { ...expectedStorage(a), edits: 'proto.edits', moves: 'proto.edits.moves' });
  assert.deepEqual(second.storage, { ...expectedStorage(b), edits: 'custom.edits', moves: 'custom.edits.moves' });
  for (const field of fields.filter(field => field !== 'edits')) assert.notEqual(first.storage[field], second.storage[field]);
});

test('empty, null and non-string draft keys receive project defaults', async t => {
  const root = await fixture(t);
  const target = await project(root, 'project', {
    edits: '', comments: null, ecount: 0, mode: false, annoMode: {}, page: [], notify: 'explicit.notify',
  });
  const actual = await config(target);
  assert.deepEqual(actual.storage, { ...expectedStorage(target), notify: 'explicit.notify' });
});
