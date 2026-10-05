// Real OpenCode backend smoke test. All configuration and sessions live in tmp.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import http from 'node:http';

const cli = process.env.PROTOBRIDGE_OPENCODE_CLI;
if (!cli) throw new Error('Set PROTOBRIDGE_OPENCODE_CLI to the OpenCode V2 executable');
const root = await mkdtemp(join(tmpdir(), 'agent-html-collab-opencode-v2-'));
const project = join(root, 'project');
await mkdir(project);
await writeFile(join(project, 'proto.html'), '<html><head></head><body><p>Original</p></body></html>');
await mkdir(join(project, 'other-project', '.git'), { recursive: true });
await writeFile(join(project, 'other-project', 'debug.html'), '<title>Unrelated debug page</title>');
await mkdir(join(project, 'studio'));
await writeFile(join(project, 'studio', 'studio.html'), '<title>Tool runtime</title>');
await writeFile(join(project, 'studio', 'serve.mjs'), '');
const initialized = spawnSync(process.execPath, [fileURLToPath(new URL('../studio/init.mjs', import.meta.url)), '--root', project], { encoding: 'utf8' });
assert.equal(initialized.status, 0, initialized.stderr);
assert.equal(JSON.parse(await readFile(join(project, 'proto.config.json'), 'utf8')).source.file, 'proto.html');
await unlink(join(project, 'proto.config.json'));
const env = { ...process.env, XDG_DATA_HOME: join(root, 'data'), XDG_CONFIG_HOME: join(root, 'config'),
  XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
const modelRequests = [];
const model = http.createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  const input = JSON.parse(text);
  modelRequests.push(input);
  const content = JSON.stringify(input).includes('Agent HTML Collab:新反馈包') ?
    'Agent HTML Collab local fixture processed feedback.' : 'Agent HTML Collab local fixture opened page.';
  if (input.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const choice of [{ delta: { role: 'assistant', content }, finish_reason: null }, { delta: {}, finish_reason: 'stop' }])
      res.write('data: ' + JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, ...choice }] }) + '\n\n');
    res.end('data: [DONE]\n\n');
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion', created: 1, model: 'fixture', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  }
});
await new Promise(done => model.listen(0, '127.0.0.1', done));
const install = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/agent-html-collab.mjs', import.meta.url)), 'install-plugin'], { env, encoding: 'utf8' });
assert.equal(install.status, 0, install.stderr);
const configPath = join(root, 'config/opencode/opencode.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
config.model = 'agent-html-collab-fixture/fixture';
config.providers = { 'agent-html-collab-fixture': { name: 'Local fixture', package: '@opencode/ai/providers/openai-compatible',
  settings: { baseURL: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'fixture' },
  models: { fixture: { name: 'Fixture', limit: { context: 32000, output: 1000 }, capabilities: { tools: false, input: ['text'], output: ['text'] } } } } };
await writeFile(configPath, JSON.stringify(config));
const child = spawn(cli, ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
  env, cwd: project, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '', errors = '';
child.stderr.on('data', b => { errors += b; });
const ready = new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error('Isolated OpenCode startup timeout')), 20000);
  child.once('error', error => { clearTimeout(timer); fail(error); });
  child.once('exit', code => { clearTimeout(timer); fail(new Error(`OpenCode exited ${code}: ${errors.slice(-1000)}`)); });
  child.stdout.on('data', b => {
    log += b;
    const url = log.match(/server listening on (http:\/\/\S+)/), password = log.match(/server password (\S+)/);
    if (url && password) { clearTimeout(timer); done({ base: url[1], password: password[1] }); }
  });
});
let report, browser;
try {
  const { base, password } = await ready;
  const api = async (path, body) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: {
      authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64'), 'content-type': 'application/json',
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`);
    return text ? JSON.parse(text).data : null;
  };
  const a = await api('/api/session', { title: 'Agent HTML Collab fixture A', location: { directory: project } });
  const b = await api('/api/session', { title: 'Agent HTML Collab fixture B', location: { directory: project } });
  await api(`/api/session/${a.id}/command`, { name: 'agent-html-collab', text: '' });
  let messages = await api(`/api/session/${a.id}/inbox`);
  let serialized = JSON.stringify(messages);
  if (!serialized.includes('/agent-html-collab/pages/')) {
    messages = await api(`/api/session/${a.id}/message`);
    serialized = JSON.stringify(messages);
  }
  const url = serialized.match(/http:\/\/127\.0\.0\.1:\d+\/agent-html-collab\/pages\/[a-z0-9-]+\/studio/)[0];
  assert.ok((await fetch(url)).ok);
  const pageConfig = await fetch(url.replace(/\/studio$/, '/api/pages')).then(r => r.json());
  assert.equal(pageConfig.mode, 'single');
  assert.equal(pageConfig.entry, '/project/proto.html');
  assert.ok((await fetch(url.replace(/\/studio$/, '/project/proto.html')).then(r => r.text())).includes('Original'));
  const feedbackURL = url.replace(/\/studio$/, '/feedback');
  const bundle = { feedbackId: 'feedback_opencode_0001', notify: true, comments: [{ text: 'Fixture feedback' }], edits: [], sessionId: b.id };
  const send = () => fetch(feedbackURL, { method: 'POST', headers: { origin: new URL(url).origin, 'content-type': 'application/json' }, body: JSON.stringify(bundle) }).then(r => r.json());
  const saved = await send();
  assert.equal(saved.delivery, 'queued', JSON.stringify(saved));
  assert.equal(saved.saved, true);
  assert.equal(JSON.parse(await readFile(saved.file, 'utf8')).sessionId, undefined);
  assert.equal((await send()).file, saved.file);
  assert.equal((await fetch(feedbackURL, { method: 'POST', headers: { origin: 'https://other.example', 'content-type': 'application/json' }, body: JSON.stringify(bundle) })).status, 403);
  let output = [];
  for (let i = 0; i < 50; i++) {
    output = await api(`/api/session/${a.id}/message`);
    if (JSON.stringify(output).includes('Agent HTML Collab local fixture processed feedback.')) break;
    await new Promise(done => setTimeout(done, 200));
  }
  assert.ok(JSON.stringify(output).includes('Agent HTML Collab local fixture processed feedback.'), JSON.stringify(output).slice(-1500));
  const containsPath = value => typeof value === 'string' ? value.includes(saved.file) :
    value && typeof value === 'object' && Object.values(value).some(containsPath);
  assert.ok(modelRequests.some(containsPath));
  assert.deepEqual(await api(`/api/session/${b.id}/inbox`), []);
  assert.deepEqual(await api(`/api/session/${b.id}/message`), []);
  if (process.env.PROTOBRIDGE_PLAYWRIGHT_MODULE) {
    const { chromium } = await import(pathToFileURL(process.env.PROTOBRIDGE_PLAYWRIGHT_MODULE));
    browser = await chromium.launch({ executablePath: process.env.PROTOBRIDGE_BROWSER, headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const prototype = page.frameLocator('#proto');
    await prototype.locator('p').waitFor();
    await page.locator('#bar [data-x=m-edit]').click();
    await prototype.locator('p').click();
    await prototype.locator('p').fill('Edited through browser');
    await page.locator('#send').click();
    await page.locator('[data-x=ok]').click();
    await page.locator('#send').filter({ hasText: '已保存' }).waitFor();
    let uiReceived = false;
    for (let i = 0; i < 50; i++) {
      const values = modelRequests.flatMap(input => input.messages || []);
      for (const value of values) {
        const content = typeof value.content === 'string' ? value.content : '';
        const paths = content.match(/[A-Z]:\\[^\r\n]*?\.json/g) || [];
        for (const path of paths) {
          try { if ((await readFile(path, 'utf8')).includes('Edited through browser')) uiReceived = true; } catch {}
        }
      }
      if (uiReceived) break;
      await new Promise(done => setTimeout(done, 200));
    }
    assert.ok(uiReceived, 'Browser edit feedback must reach the model');
    assert.deepEqual(errors, []);
    assert.deepEqual(await api(`/api/session/${b.id}/message`), []);
  }
  await api(`/api/session/${a.id}/command`, { name: 'agent-html-collab-close', text: '' });
  assert.equal((await fetch(url)).status, 410);
  report = { root, opencode: '2.0.22', passed: ['isolated install and V2 plugin load', 'command captures session', 'Studio and prototype served', 'feedback saved', 'feedback delivered to original session', 'local model received feedback path and answered', 'retry reuses feedback file', 'forged session ignored', 'other session untouched', 'close invalidates page'], limitation: 'Local deterministic model fixture, not user model credentials or desktop GUI.' };
  if (browser) report.passed.push('browser text edit and send reach original session without page errors');
  report.passed.push('automatic discovery excludes nested repositories and Studio runtime');
} finally {
  await browser?.close();
  child.kill();
  model.closeAllConnections();
  await new Promise(done => model.close(done));
}
if (report) { await writeFile(new URL('../research/opencode-v2-validation-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); }
