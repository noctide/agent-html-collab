// Same-origin srcdoc regression for project-scoped Studio drafts.
// Uses an isolated Chromium profile and temporary projects; never touches user storage.
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { apply } from '../packages/dsh-plugin/index.mjs';

const prefix = 'agent-html-collab-storage-';
const tempRoot = resolve(tmpdir());
const fixture = await mkdtemp(join(tempRoot, prefix));
const roots = { A: join(fixture, 'project-a'), B: join(fixture, 'project-b') };
const cleanup = [], queued = [], routes = [], results = [];
let browser, server;
let stage = 'prepare fixture';
const browserPath = process.env.PUPPETEER_EXECUTABLE_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
].find(existsSync);
const check = (value, label) => { assert.ok(value, label); results.push('PASS  ' + label); };
const legacy = {
  'proto.edits': JSON.stringify({ shared: [{ path: 'main>h1', from: 'Original title', to: 'Legacy title' }] }),
  'proto.anno.comments': JSON.stringify({ 'shared-01': { page: 'shared', region: 'Banner', comment: 'Legacy comment' } }),
  'proto.anno.ecount': JSON.stringify({ shared: 9 }),
  'proto.studio.mode': JSON.stringify('edit'),
  'proto.anno.mode': JSON.stringify('1'),
  'proto.page': JSON.stringify('shared'),
  'proto.notify': JSON.stringify('0'),
};

try {
  for (const root of Object.values(roots)) {
    await mkdir(root);
    await writeFile(join(root, 'proto.html'), '<!doctype html><html><head><title>Identical project</title>' +
      '<style>body{font:20px sans-serif;padding:40px}main{max-width:600px}h1,p{margin:0 0 40px}' +
      'section{margin-top:50px;padding:30px;background:#eee}</style></head><body><main>' +
      '<h1 id="title">Original title</h1><p id="intro">Original description</p>' +
      '<section data-anno="shared-01" data-anno-label="Banner">Original banner</section></main></body></html>');
    await writeFile(join(root, 'proto.config.json'), JSON.stringify({
      title: 'Identical project', source: { mode: 'single', file: 'proto.html' },
      pages: { container: 'body', single: true, defaultId: 'shared', list: [{ id: 'shared', title: 'Same page' }] },
      viewport: { desktop: 900 }, tools: { anno: true }, server: { feedbackDir: 'feedback', wakeOnFeedback: false },
    }));
  }
  const agents = Object.fromEntries(Object.entries(roots).map(([id, root]) => [id, { session: { header: { cwd: root } } }]));
  apply({ agents: { get: id => agents[id] }, connection: { admit: () => ({}) },
    sessionController: { prompt: async request => { queued.push(request); return { accepted: true }; } },
    webServer: { register: route => { routes.push(route); return () => {}; } },
    effect: factory => { const dispose = factory(); cleanup.push(dispose); return dispose; },
  });
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/fixture') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><body style="margin:0"></body>'); return; }
    const route = routes.find(item => item.kind === 'exact' ? pathname === item.path : pathname === item.path || pathname.startsWith(item.path + '/'));
    if (route) route.handler(req, res); else { res.writeHead(404); res.end(); }
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.ok(browserPath, 'No Chromium executable; set PUPPETEER_EXECUTABLE_PATH');
  stage = 'launch isolated Chromium';
  browser = await puppeteer.launch({ executablePath: browserPath, headless: true,
    args: ['--no-first-run', '--force-device-scale-factor=1'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  stage = 'load same-origin test host';
  await page.goto(base + '/fixture');

  async function open(id, slot) {
    const response = await fetch(base + '/agent-html-collab/open', { method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: id, pageId: slot }) });
    const opened = await response.json();
    assert.ok(response.ok, opened.error);
    const url = base + opened.url;
    const html = await fetch(url).then(value => value.text());
    await page.evaluate(({ html, url, slot }) => {
      const element = document.createElement('iframe');
      element.id = slot; element.sandbox = 'allow-scripts allow-same-origin allow-downloads';
      element.style.cssText = 'width:100%;height:950px;border:0';
      element.srcdoc = html.replace('<head>', '<head><base href="' + url + '">');
      document.body.appendChild(element);
    }, { html, url, slot });
    const handle = await page.$('#' + slot);
    const studio = await handle.contentFrame();
    await studio.waitForFunction(() => {
      const proto = document.querySelector('#proto');
      return proto?.contentWindow?.__PB_BRIDGE && proto.contentDocument.querySelector('#title');
    });
    const proto = await (await studio.$('#proto')).contentFrame();
    await studio.select('#zoom-sel', '1');
    await studio.waitForFunction(() => document.querySelector('#proto').style.transform === 'scale(1)');
    const storage = await studio.evaluate(() => window.PROTO_CONFIG.storage);
    assert.ok(storage?.edits, 'Studio must inject project-scoped storage configuration');
    return { studio, proto, storage, opened, slot, url };
  }
  async function show(view) {
    await page.evaluate(slot => {
      for (const iframe of document.querySelectorAll('body>iframe')) iframe.style.display = iframe.id === slot ? 'block' : 'none';
    }, view.slot);
  }
  async function stored(view, field, fallback = {}) {
    return view.studio.evaluate((key, value) => JSON.parse(localStorage.getItem(key) || JSON.stringify(value)), view.storage[field], fallback);
  }
  async function clickPrototype(view, selector, button = 'right') {
    // A badge is rebuilt on scrolling. Click its observed coordinates directly
    // so Puppeteer's auto-scroll cannot replace it before dispatching the click.
    const point = await view.studio.evaluate(value => {
      const iframe = document.querySelector('#proto');
      const target = iframe.contentDocument.querySelector(value).getBoundingClientRect();
      const bounds = iframe.getBoundingClientRect();
      const scale = bounds.width / parseFloat(iframe.style.width);
      return { x: bounds.left + (target.left + target.width / 2) * scale,
        y: bounds.top + (target.top + target.height / 2) * scale };
    }, selector);
    const outer = await page.$eval('#' + view.slot, element => {
      const bounds = element.getBoundingClientRect(); return { x: bounds.left, y: bounds.top };
    });
    await page.mouse.click(outer.x + point.x, outer.y + point.y, { button });
  }
  async function edit(view, text) {
    await show(view);
    await clickPrototype(view, '#title');
    await view.studio.waitForSelector('.element-menu');
    await view.studio.click('[data-act=edit]'); await view.proto.waitForFunction(() => document.body.classList.contains('pbx-move')); await clickPrototype(view, '#title', 'left');
    await view.proto.waitForFunction(() => document.querySelector('#title').contentEditable === 'true');
    await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('a');
    await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.type(text);
    // The nested srcdoc fixture can retain focus in its child frame; finish through the bridge API after real text input.
    await view.proto.evaluate(() => window.__PB.finishMove(true));
    await view.studio.waitForFunction((key, value) => Object.values(JSON.parse(localStorage.getItem(key) || '{}'))
      .some(records => records.some(record => record.to === value)), { timeout: 10000 }, view.storage.edits, text);
  }
  async function comment(view, text, region = false) {
    await show(view);
    await clickPrototype(view, region ? '[data-anno="shared-01"]' : '#intro');
    await view.studio.waitForSelector('.element-menu');
    await view.studio.click('[data-act=anno]');
    await view.studio.type('.pop [data-f=comment]', text);
    await view.studio.click('.pop [data-x=save]');
    await view.studio.waitForFunction((key, value) => Object.values(JSON.parse(localStorage.getItem(key) || '{}'))
      .some(record => record.comment === value), { timeout: 10000 }, view.storage.comments, text);
  }
  async function submit(view) {
    await show(view);
    await page.keyboard.press('Escape');
    await view.studio.click('#send');
    await view.studio.waitForSelector('.pop [data-x=ok]', { visible: true });
    await view.studio.click('.pop [data-x=ok]');
    await view.studio.waitForFunction(() => document.querySelector('#send').textContent.includes('已保存'));
    const names = await readdir(join(roots.B, 'feedback'));
    assert.equal(names.length, 1);
    return JSON.parse(await readFile(join(roots.B, 'feedback', names[0]), 'utf8'));
  }
  async function clear(view, action) {
    await show(view);
    await page.keyboard.press('Escape');
    await view.studio.click('#count');
    await view.studio.waitForSelector('.feedback-manager', { visible: true });
    await view.studio.click('.feedback-manager [data-act=' + action + ']');
    await view.studio.waitForSelector('[data-act=confirm-clear]', { visible: true });
    await view.studio.click('[data-act=confirm-clear]');
    await page.keyboard.press('Escape');
  }

  stage = 'create A drafts with real UI';
  const A = await open('A', 'studio-a');
  await edit(A, 'A draft title');
  await comment(A, 'A element comment');
  await comment(A, 'A region comment', true);
  await A.studio.click('#send');
  await A.studio.click('#send-notify');
  check(await A.studio.$eval('#send-notify', button => !button.checked), 'A notification preference changed through send dialog');
  await page.keyboard.press('Escape');
  const aEdits = await stored(A, 'edits'), aComments = await stored(A, 'comments');
  check(Object.values(aComments).length === 2 && aEdits.shared[0].to === 'A draft title', 'A stores text edit, element comment and region comment');
  stage = 'open identical B on same srcdoc origin';
  const B = await open('B', 'studio-b');
  await show(B);
  check(await A.studio.evaluate(() => parent.location.origin) === base &&
    await B.studio.evaluate(() => parent.location.origin) === base &&
    await page.evaluate(key => localStorage.getItem(key), A.storage.edits) === JSON.stringify(aEdits),
  'Both srcdoc Studio frames share the DSH host origin and localStorage');
  check(await B.proto.$eval('#title', element => element.textContent.trim()) === 'Original title', 'B never applies A text edits despite identical HTML and page IDs');
  check(Object.keys(await stored(B, 'edits')).length === 0 && Object.keys(await stored(B, 'comments')).length === 0,
    'B starts with no A element or region comments');
  check(await stored(B, 'notify', '1') === '1', 'B notification preference is independent of A');
  check(Object.keys(B.storage).length === 8 && Object.entries(A.storage).every(([field, key]) => key !== B.storage[field]),
    'All eight injected storage fields are project-scoped');

  stage = 'submit B real feedback';
  await edit(B, 'B draft title');
  await comment(B, 'B element comment');
  await comment(B, 'B region comment', true);
  const bEdits = await stored(B, 'edits'), bComments = await stored(B, 'comments');
  const bundle = await submit(B);
  check(bundle.summary.edits === 1 && bundle.summary.comments === 2 && bundle.edits[0].to === 'B draft title' &&
    bundle.comments.every(record => record.comment.startsWith('B ')), 'Actual B feedback file contains only B edits and comments');
  check(queued.length === 1 && queued[0].sessionId === 'B', 'B notification is queued to its own session');

  stage = 'reopen A after new page binding and seed legacy keys';
  await page.evaluate(values => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value); }, legacy);
  await page.evaluate(slot => document.getElementById(slot).remove(), A.slot);
  const closed = await fetch(base + '/agent-html-collab/pages/' + A.opened.bindingId + '/close', { method: 'POST' });
  assert.ok(closed.ok);
  const reopened = await open('A', 'studio-a-reopened');
  await show(reopened);
  check(reopened.opened.bindingId !== A.opened.bindingId && reopened.url !== A.url, 'Reopened A uses a fresh page binding and resource base path');
  assert.deepEqual(reopened.storage, A.storage);
  assert.deepEqual(await stored(reopened, 'edits'), aEdits);
  assert.deepEqual(await stored(reopened, 'comments'), aComments);
  check(await reopened.proto.$eval('#title', element => element.textContent.trim()) === 'A draft title' &&
    await stored(reopened, 'notify', '1') === '0',
  'A restores its own drafts and notification state across resource base paths');
  check(await reopened.studio.evaluate(values => Object.entries(values).every(([key, value]) => localStorage.getItem(key) === value), legacy),
    'Old proto.* keys are preserved without automatic import or deletion');

  stage = 'clear A through real feedback manager';
  await clear(reopened, 'clear-comments');
  await clear(reopened, 'restore-edits');
  check(Object.keys(await stored(reopened, 'edits')).length === 0 && Object.keys(await stored(reopened, 'comments')).length === 0 &&
    await reopened.proto.$eval('#title', element => element.textContent.trim()) === 'Original title', 'A feedback manager clears only A drafts');
  await show(B);
  assert.deepEqual(await stored(B, 'edits'), bEdits);
  assert.deepEqual(await stored(B, 'comments'), bComments);
  check(await B.proto.$eval('#title', element => element.textContent.trim()) === 'B draft title', 'Clearing A cannot remove or restore B drafts');
  assert.deepEqual(errors, []);
  check(true, 'No browser runtime errors');
  console.log(results.join('\n'));
  console.log('\n' + results.length + ' storage regression checks passed');
} catch (error) {
  console.log(results.join('\n'));
  console.error('FAIL  ' + stage + ': ' + error.message);
  throw error;
} finally {
  await browser?.close();
  for (const dispose of cleanup.reverse()) await dispose?.();
  if (server?.listening) await new Promise(done => server.close(done));
  // Only remove this script's verified mkdtemp directory.
  assert.equal(dirname(resolve(fixture)), tempRoot);
  assert.ok(basename(fixture).startsWith(prefix));
  await rm(fixture, { recursive: true, force: true });
}
