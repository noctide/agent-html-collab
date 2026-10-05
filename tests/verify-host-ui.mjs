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
  const route = routes.find(r => r.kind === 'exact' ? req.url === r.path : req.url.startsWith(r.path));
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
  const frame = page.frameLocator('#proto');
  try { await frame.locator('#title').waitFor({ timeout: 10000 }); }
  catch (error) {
    console.log('ERRORS', errors);
    console.log('FRAMES', page.frames().map(f => ({ url: f.url() })));
    console.log('TEXT', (await page.locator('body').innerText()).slice(-1500));
    await page.screenshot({ path: process.env.PROTOBRIDGE_SCREENSHOT, fullPage: true });
    throw error;
  }
  await page.locator('#bar [data-x=m-edit]').click();
  await frame.locator('#title').click();
  await frame.locator('#title').fill('Changed by UI test');
  await frame.locator('p').click();
  await page.locator('#send').click();
  await page.locator('[data-x=ok]').click();
  await page.waitForFunction(() => document.querySelector('#send').textContent.includes('已保存'));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].sessionId, 'session-ui-test');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: process.env.PROTOBRIDGE_SCREENSHOT, fullPage: true });
  console.log('PASS: bound Studio loads, text edit saves and feedback queues to its owner; no page errors');
} finally {
  await browser?.close();
  for (const dispose of cleanup.reverse()) await dispose?.();
  await new Promise(r => server.close(r));
}
