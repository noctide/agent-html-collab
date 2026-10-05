import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apply } from '../packages/dsh-plugin/index.mjs';
const { chromium } = await import(pathToFileURL(process.env.PROTOBRIDGE_PLAYWRIGHT_MODULE));
const root = await mkdtemp(join(tmpdir(), 'protobridge-host-ui-'));
await writeFile(join(root, 'proto.html'), '<html><body><h1 id="title">Original title</h1><p>Example</p></body></html>');
const routes = [], cleanup = [], queued = [];
const agent = { session: { header: { cwd: root } } };
apply({ agents: { get: () => agent }, connection: { admit: () => ({}) }, sessionController: { prompt: async request => { queued.push(request); return { accepted: true }; } },
  webServer: { register: route => { routes.push(route); return () => {}; } }, effect: factory => { const dispose = factory(); cleanup.push(dispose); return dispose; } });
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const route = routes.find(r => r.kind === 'exact' ? pathname === r.path : pathname === r.path || pathname.startsWith(r.path + '/'));
  if (route) route.handler(req, res); else { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const opened = await fetch(base + '/protobridge/open', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'session-ui-test', pageId: 'page-ui-test' }) }).then(r => r.json());
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PROTOBRIDGE_BROWSER, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), new URL(r.url()).pathname); });
  page.on('console', message => { if (message.type() === 'error') console.log('CONSOLE', message.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + opened.url);
  const html = await fetch(base + opened.url).then(r => r.text());
  await page.evaluate(({ html, url }) => {
    document.body.innerHTML = '';
    const outer = document.createElement('iframe');
    outer.id = 'studio-host';
    outer.style.cssText = 'width:100%;height:950px;border:0';
    outer.sandbox = 'allow-scripts allow-same-origin allow-downloads';
    outer.srcdoc = html.replace('<head>', '<head><base href="' + url + '">');
    document.body.appendChild(outer);
  }, { html, url: base + opened.url });
  const studio = page.frameLocator('#studio-host');
  const frame = studio.frameLocator('#proto');
  try { await frame.locator('#title').waitFor({ timeout: 10000 }); }
  catch (error) {
    console.log('ERRORS', errors);
    console.log('FRAMES', page.frames().map(f => ({ url: f.url() })));
    console.log('TEXT', (await page.locator('body').innerText()).slice(-1500));
    await page.screenshot({ path: process.env.PROTOBRIDGE_SCREENSHOT, fullPage: true });
    throw error;
  }
  await studio.locator('#bar [data-x=m-edit]').click();
  assert.ok(await studio.locator('#mmap').isVisible());
  assert.ok((await studio.locator('#current-path').innerText()).includes(root));
  assert.ok((await studio.locator('#current-path').innerText()).includes('proto.html'));
  assert.equal(await studio.locator('#current-path').innerText(), '当前页面：' + join(root, 'proto.html'));
  await page.locator('#studio-host').evaluate(element => { element.style.width = '620px'; });
  await studio.locator('#zoom-sel').waitFor({ state: 'visible' });
  await studio.locator('#zoom-sel').selectOption('1');
  const narrowFrame = page.frames().find(value => value.url() === 'about:srcdoc');
  assert.equal(await narrowFrame.evaluate(() => document.querySelector('#proto').style.transform), 'scale(1)');
  assert.equal(await narrowFrame.evaluate(() => getComputedStyle(document.querySelector('#current-path')).position), 'static');
  await page.locator('#studio-host').evaluate(element => { element.style.width = '100%'; });
  await studio.locator('#zoom-sel').selectOption('fit');
  await frame.locator('#title').click();
  await frame.locator('#title').fill('Changed by UI test');
  await frame.locator('p').click();
  await studio.locator('#send').click();
  await studio.locator('[data-x=ok]').click();
  await studio.locator('#send').filter({ hasText: '已保存' }).waitFor();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].sessionId, 'session-ui-test');
  assert.deepEqual(errors, []);
  const studioFrame = page.frames().find(value => value.url() === 'about:srcdoc');
  await studioFrame.evaluate(() => {
    window.PROTOBRIDGE_HOST.submitFeedback = async () => ({ saved: true, delivery: 'failed', error: 'test notification failure' });
    document.execCommand = () => false;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.testCopiedFeedback = text; } } });
  });
  await frame.locator('#title').click();
  await frame.locator('#title').fill('Manual fallback test');
  await frame.locator('p').click();
  await studio.locator('#send').click();
  await studio.locator('[data-x=ok]').click();
  await studio.locator('[data-f=bundle]').waitFor();
  assert.ok(await studioFrame.evaluate(() => window.testCopiedFeedback.includes('Manual fallback test')));
  assert.ok((await studio.locator('.sum').innerText()).includes('复制到剪贴板'));
  await page.screenshot({ path: process.env.PROTOBRIDGE_SCREENSHOT, fullPage: true });
  console.log('PASS: bound Studio loads, text edit saves and feedback queues to its owner; no page errors');
} finally {
  await browser?.close();
  for (const dispose of cleanup.reverse()) await dispose?.();
  await new Promise(r => server.close(r));
}
