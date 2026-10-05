import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import plugin from '../packages/opencode-plugin/index.js';

test('OpenCode V2 setup and V1 server entries exist; V1 without an adapter returns empty hooks', async () => {
  assert.equal(typeof plugin.server, 'function');
  assert.equal(typeof plugin.setup, 'function');
  assert.deepEqual(await plugin.server({ client: {} }), {});
});

test('OpenCode custom adapter preserves page ownership and disposes registration', async () => {
  let factory, disposed = 0;
  const delivered = [];
  const hooks = await plugin.server({ protobridge: {
    registerPageBridge: f => { factory = f; return () => { disposed++; }; },
    saveFeedback: async () => '/fixture/feedback.json',
    enqueue: async value => delivered.push(value),
  } });
  const page = factory({ pageId: 'page-a', sessionId: 'session-a', projectRoot: '.' });
  await page.pageApi.submitFeedback({ feedbackId: 'feedback_0001', sessionId: 'forged', comments: [], edits: [], notify: true });
  assert.equal(delivered[0].sessionId, 'session-a');
  await hooks.event({ event: { type: 'session.idle' } });
  assert.equal(disposed, 0);
  await hooks.event({ event: { type: 'server.instance.disposed' } });
  assert.equal(disposed, 1);
});

test('OpenCode isolated install migrates only its own legacy config and loads the installed entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-html-collab-opencode-'));
  const directory = join(root, 'opencode');
  await mkdir(directory);
  const configFile = join(directory, 'opencode.json');
  await mkdir(join(directory, 'plugins/protobridge'), { recursive: true });
  await writeFile(join(directory, 'plugins/protobridge/package.json'), JSON.stringify({ name: 'protobridge-opencode-plugin' }));
  await writeFile(configFile, JSON.stringify({ plugin: ['other-plugin', './plugins/protobridge/index.js'], plugins: ['./plugins/protobridge', 'unrelated'], theme: 'fixture' }));
  const cli = fileURLToPath(new URL('../bin/agent-html-collab.mjs', import.meta.url));
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], { env: { ...process.env, XDG_CONFIG_HOME: root }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  run('install-plugin');
  let config = JSON.parse(await readFile(configFile, 'utf8'));
  assert.deepEqual(config.plugin, ['other-plugin']);
  assert.deepEqual(config.plugins, ['unrelated', './plugins/agent-html-collab']);
  await assert.rejects(readFile(join(directory, 'plugins/protobridge/package.json')), { code: 'ENOENT' });
  assert.equal(config.theme, 'fixture');
  const installed = await import(pathToFileURL(join(directory, 'plugins/agent-html-collab/index.js')));
  assert.equal(typeof installed.default.setup, 'function');
  assert.deepEqual(await installed.default.server({ client: {} }), {});
  await writeFile(join(directory, 'plugins/agent-html-collab/index.ts'), 'old entry');
  run('install-plugin', '--force');
  await assert.rejects(readFile(join(directory, 'plugins/agent-html-collab/index.ts')), { code: 'ENOENT' });
  config = JSON.parse(await readFile(configFile, 'utf8'));
  assert.equal(config.plugins.length, 2);
  run('uninstall-plugin');
  config = JSON.parse(await readFile(configFile, 'utf8'));
  assert.deepEqual(config.plugin, ['other-plugin']);
  assert.deepEqual(config.plugins, ['unrelated']);
});
