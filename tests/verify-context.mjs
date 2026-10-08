// Browser regression for element-scoped editing; only isolated temporary data.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
const ROOT = process.env.CONTEXT_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const puppeteer = require('puppeteer-core');
const tempRoot = resolve(tmpdir()), prefix = 'agent-html-collab-context-';
const fixture = mkdtempSync(join(tempRoot, prefix));
const results = [], errors = [];
let browser, server, stage = 'fixture', serverLog = '';
const check = (value, label) => { assert.ok(value, label); results.push('PASS  ' + label); };
const sleep = ms => new Promise(done => setTimeout(done, ms));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1.2, `${actual} != ${expected}`);
try {
  for (const id of ['a', 'b']) writeFileSync(join(fixture, id + '.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Page ${id}</title><style>
  *{box-sizing:border-box}body{margin:0;padding:40px;font:18px sans-serif}main{width:700px}h1{margin:0 0 30px}p{margin-bottom:30px}#card{width:180px;height:90px;padding:25px;background:#dae9e3;margin-bottom:30px;transform:rotate(2deg);translate:7px 5px !important}#scaled{transform:scale(1.5);transform-origin:top left;width:220px;height:70px;margin-bottom:80px}#scaled-child{width:130px;height:45px;background:#eadcc8;padding:12px}#transition{width:180px;height:70px;transition:all 1s !important;background:#eadfea}#spacer{height:1200px}a{display:inline-block;padding:12px}input{display:block;margin-top:20px}</style></head><body><main>
  <h1 id="title">Page ${id}</h1><p id="intro">Original description</p><div id="card">Card ${id}</div><a id="link" href="#native" onclick="window.activations++">Native link</a><aside id="scaled"><div id="scaled-child">Scaled</div></aside><article id="transition">Transition</article><input id="input" value="Native input"><div id="spacer"></div></main><script>window.activations=0;window.doubleClicks=0;document.querySelector('#intro').ondblclick=()=>window.doubleClicks++;</script></body></html>`);
  writeFileSync(join(fixture, 'proto.config.json'), JSON.stringify({ title: 'Context regression', source: { mode: 'pages', dir: '.', index: 'a.html' }, pages: { container: 'body', singlePerFile: true, switch: 'auto', list: [{ id: 'a', title: 'Page A', file: 'a.html' }, { id: 'b', title: 'Page B', file: 'b.html' }] }, viewport: { desktop: 900 }, server: { feedbackDir: 'feedback/', wakeOnFeedback: false } }));
  const probe = createServer(); await new Promise(done => probe.listen(0, '127.0.0.1', done)); const port = probe.address().port; await new Promise(done => probe.close(done));
  const base = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, [join(ROOT, 'studio', 'serve.mjs'), '--root', fixture, '--port', String(port)], { stdio: 'pipe', windowsHide: true });
  server.stdout.on('data', data => { serverLog += data; }); server.stderr.on('data', data => { serverLog += data; });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { ready = await fetch(base + '/api/ping', { signal: AbortSignal.timeout(500) }).then(r => r.ok).catch(() => false); if (!ready) await sleep(100); }
  check(ready, 'isolated Studio starts: ' + serverLog.trim().split('\n')[0]);
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-first-run'] });
  const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(base + '/studio', { waitUntil: 'networkidle0' });
  const frame = () => page.frames().find(f => f.url().includes('/project/'));
  const stored = field => page.evaluate(name => JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage[name]) || '{}'), field);
  async function waitPage(id) { await page.waitForFunction(value => document.querySelector('#page-sel').value === value && document.querySelector('#proto').contentWindow.__PB_BRIDGE && document.querySelector('#proto').contentWindow.location.pathname.endsWith('/' + value + '.html'), {}, id); }
  async function browse() { await frame().waitForFunction(() => !['pbx-edit', 'pbx-move', 'pbx-anno', 'pbx-pick'].some(name => document.body.classList.contains(name))); await page.waitForFunction(() => document.querySelector('#move-panel').hidden && document.querySelector('#edit-pick').getAttribute('aria-pressed') === 'false'); }
  async function point(selector) { return page.evaluate(value => { const f = document.querySelector('#proto'), r = f.contentDocument.querySelector(value).getBoundingClientRect(), b = f.getBoundingClientRect(), s = b.width / parseFloat(f.style.width); return { x: b.left + (r.x + r.width / 2) * s, y: b.top + (r.y + r.height / 2) * s, scale: s }; }, selector); }
  async function click(selector, options) { const p = await point(selector); await page.mouse.click(p.x, p.y, options); }
  async function context(selector, action) { await click(selector, { button: 'right' }); await page.waitForSelector('.element-menu', { visible: true }); if (action) { await page.click('.element-menu [data-act=' + (action === 'move' ? 'edit' : action) + ']'); if (action === 'edit') { await page.waitForSelector('#move-panel', { visible: true }); await click(selector); await frame().waitForFunction(value => document.querySelector(value).contentEditable === 'true', {}, selector); } if (action === 'move') await page.waitForSelector('#move-panel', { visible: true }); } }
  async function text(value) { await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type(value); }
  async function coordinates(selector) { return frame().$eval(selector, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, style: el.getAttribute('style'), transform: el.style.transform }; }); }
  async function drag(selector, dx, dy, cancel = false) { const p = await point('#pbx-move-handle'); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + dx * p.scale, p.y + dy * p.scale, { steps: 8 }); if (cancel) await page.keyboard.press('Escape'); await page.mouse.up(); }
  async function numeric(x, y) { for (const [selector, value] of [['#move-x', x], ['#move-y', y]]) { await page.click(selector); await text(String(value)); } }
  await waitPage('a');
  stage = 'default browsing';
  await page.evaluate(() => { localStorage.setItem(window.PROTO_CONFIG.storage.mode, '"move"'); localStorage.setItem(window.PROTO_CONFIG.storage.annoMode, '"1"'); });
  await page.reload({ waitUntil: 'networkidle0' }); await waitPage('a'); await browse();
  check(await page.$('#bar .seg') === null && await page.$('#notify') === null && await page.$('#current-path') === null, 'toolbar removes global modes, unlabeled switch and persistent path');
  check(await page.$eval('#send', el => el.textContent === '发送' && el.disabled) && await page.$eval('#undo', el => el.disabled), 'empty draft disables send and undo');
  await page.click('#page-notes');
  check(await page.$eval('.feedback-pages', el => el.textContent.includes('还没有标注或改动')) && await page.$eval('#page-notes', el => el.getAttribute('aria-expanded') === 'true' && el.textContent === ''), 'icon-only page finder has an accessible expanded state and empty guidance');
  await page.click('#page-notes'); check(await page.$('.feedback-pages') === null && await page.$eval('#page-notes', el => el.getAttribute('aria-expanded') === 'false'), 'clicking the page icon again closes the list');
  await click('#link'); check(await frame().evaluate(() => location.hash === '#native' && window.activations === 1), 'normal browsing preserves native link behavior');
  await click('#intro', { count: 2 }); check(await frame().evaluate(() => window.doubleClicks > 0) && await page.$('.element-menu') === null, 'double-click preserves prototype behavior');
  stage = 'text transactions';
  await context('#title');
  check(await frame().$eval('#title', el => el.classList.contains('pbx-context-selected')), 'right-click highlights the target');
  check(await page.$$eval('.element-menu [data-act]', els => els.map(el => el.textContent.trim()).join('|')) === '编辑元素|添加标注|还原此元素(未改动)', 'context menu contains element actions and disabled restore');
  await page.click('.element-menu [data-act=edit]'); await page.waitForSelector('#move-panel', { visible: true }); await click('#title'); await click('#title');
  check(await page.evaluate(() => { const p = document.querySelector('#move-panel').getBoundingClientRect(), f = document.querySelector('#proto'), b = f.getBoundingClientRect(), r = f.contentDocument.querySelector('#title').getBoundingClientRect(), s = b.width / parseFloat(f.style.width); return p.top >= b.top + r.bottom * s || p.bottom <= b.top + r.top * s || p.left >= b.left + r.right * s || p.right <= b.left + r.left * s; }), 'text controls stay outside the selected wide heading');
  await text('Cancelled title');
  check(Object.keys(await stored('edits')).length === 0, 'typing remains uncommitted until completion');
  await page.click('#move-cancel'); await browse();
  check(await frame().$eval('#title', el => el.textContent === 'Page a' && !el.hasAttribute('contenteditable')), 'cancel restores original text and editable attribute');
  await context('#title', 'edit'); await text('Updated title'); await page.keyboard.press('Enter'); await browse();
  check((await stored('edits')).a[0].to === 'Updated title', 'Enter commits only the selected text and returns to browse');
  const existingText = JSON.stringify(await stored('edits'));
  await context('#title', 'edit'); await text('Temporary second edit'); await page.keyboard.press('Escape'); await browse();
  check(JSON.stringify(await stored('edits')) === existingText && await frame().$eval('#title', el => el.textContent === 'Updated title'), 'cancel of a repeated edit preserves the earlier draft');
  await frame().evaluate(() => { const span = document.createElement('span'); span.id = 'native-child'; span.textContent = ' detail'; window.childClicks = 0; span.addEventListener('click', () => window.childClicks++); document.querySelector('#intro').appendChild(span); });
  await context('#intro', 'edit'); await text('Temporary replacement'); await page.click('#move-cancel'); await browse(); await click('#native-child');
  check(await frame().evaluate(() => window.childClicks === 1), 'cancel preserves original child nodes and prototype event listeners');
  await context('#link', 'edit'); await click('#link'); check(await frame().evaluate(() => window.activations === 1), 'editing a link does not activate its prototype click handler'); await page.click('#move-cancel'); await browse();
  stage = 'discoverable selection and annotations';
  await page.click('#edit-pick'); await frame().waitForFunction(() => document.body.classList.contains('pbx-pick')); await click('#intro'); await page.waitForSelector('#move-panel', { visible: true }); await click('#intro', { button: 'right' });
  await page.waitForSelector('.element-menu', { visible: true }); await page.click('[data-act=anno]'); await page.type('.pop [data-f=comment]', 'Make this shorter'); await page.click('.pop [data-x=save]'); await browse();
  check(Object.values(await stored('comments')).some(c => c.comment === 'Make this shorter'), 'editing entry selects a target, saves annotation, and returns to browse');
  await page.click('#page-notes');
  check(await page.$$eval('.feedback-pages [data-page]', els => els.length === 1 && els[0].dataset.page === 'a' && els[0].textContent.includes('Page A') && els[0].textContent.includes('当前页') && els[0].textContent.includes('意见 1') && els[0].textContent.includes('Make this shorter')), 'page finder groups notes and changes under their page title with an excerpt');
  await page.keyboard.press('Escape');
  check(await page.$('.feedback-pages') === null && await page.$eval('#page-notes', el => document.activeElement === el), 'Escape closes page finder and restores keyboard focus');
  stage = 'move transactions';
  const original = await coordinates('#card'); await context('#card', 'move');
  check(await frame().$('#pbx-move-handle') !== null, 'selected element exposes a grip');
  await drag('#card', 40, 24);
  let moved = await coordinates('#card'); near(moved.x - original.x, 40); near(moved.y - original.y, 24);
  check(Object.keys(await stored('moves')).length === 0 && moved.transform === original.transform, 'drag previews without committing and preserves original transform');
  await page.click('#move-cancel'); await browse(); moved = await coordinates('#card'); near(moved.x, original.x); near(moved.y, original.y);
  check(moved.style === original.style, 'move cancel restores original inline style and creates no record');
  await context('#card', 'move'); await numeric(30, 12); await page.click('#move-apply'); await browse();
  check((await stored('moves')).a[0].to.x === 30 && (await stored('moves')).a[0].to.y === 12, 'Done commits numeric offsets and returns to browse');
  const existingMove = JSON.stringify(await stored('moves'));
  await context('#card', 'move'); await page.click('[data-move-key=ArrowRight]'); await page.click('[data-move-key=ArrowDown]'); await page.keyboard.press('Escape'); await browse();
  moved = await coordinates('#card'); near(moved.x - original.x, 30); near(moved.y - original.y, 12);
  check(JSON.stringify(await stored('moves')) === existingMove, 'cancel after nudging preserves earlier offset and timestamp');
  await context('#link', 'move'); await drag('#link', 20, 10, true); await browse();
  check(await frame().evaluate(() => window.activations === 1) && JSON.stringify(await stored('moves')) === existingMove, 'Escape during link drag cancels without activating the link or changing drafts');
  await context('#card', 'move'); await drag('#pbx-move-handle', 10, 8); await page.click('#move-apply'); await browse();
  check((await stored('moves')).a[0].to.x === 40 && (await stored('moves')).a[0].to.y === 20, 'grip drag continues from existing offset');
  stage = 'transformed parent and transition';
  const scaled = await coordinates('#scaled-child'); await context('#scaled-child', 'move'); await drag('#scaled-child', 30, 18); await page.click('#move-apply'); await browse();
  moved = await coordinates('#scaled-child'); near(moved.x - scaled.x, 30); near(moved.y - scaled.y, 18);
  const scaledRecord = (await stored('moves')).a.find(r => r.path === 'main>aside>div'); check(scaledRecord.to.x === 20 && scaledRecord.to.y === 12, 'scaled parent drag commits correct local CSS offsets');
  const transition = await coordinates('#transition'); await context('#transition', 'move'); await drag('#transition', 35, 22); await page.click('#move-apply'); await browse();
  moved = await coordinates('#transition'); near(moved.x - transition.x, 35); near(moved.y - transition.y, 22);
  check((await stored('moves')).a.find(r => r.path === 'main>article').to.x === 35, 'transition element moves immediately and commits accurately');
  stage = 'responsive panels';
  await page.evaluate(() => document.querySelector('#stage').scrollTop = 0); await context('#card', 'move');
  for (const [width, height] of [[500, 800], [375, 420]]) {
    await page.setViewport({ width, height }); await sleep(100);
    check(await page.$eval('#bar', el => el.scrollWidth <= el.clientWidth) && await page.$eval('#move-panel', el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= document.querySelector('#bar').getBoundingClientRect().bottom && r.bottom <= innerHeight; }), `${width}px toolbar and local panel fit viewport`);
    await page.click('#move-apply'); await browse();
    if (width === 500) { await page.setViewport({ width: 1400, height: 1000 }); await context('#card', 'move'); }
  }
  await page.setViewport({ width: 1400, height: 1000 });
  stage = 'undo, reload and pages';
  await page.click('#undo'); await page.waitForFunction(() => !JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.moves) || '{}').a?.some(r => r.path === 'main>article'));
  check((await stored('moves')).a.some(r => r.path === 'main>div:nth-of-type(1)'), 'visible undo removes recent change while retaining other elements');
  await context('#card', 'move'); await numeric(99, 99); await page.select('#page-sel', 'b'); await waitPage('b'); await browse();
  check((await stored('moves')).a.find(r => r.path === 'main>div:nth-of-type(1)').to.x === 40 && !(await stored('moves')).b, 'page switch cancels unfinished movement and isolates drafts');
  await context('#title', 'anno'); await page.type('.pop [data-f=comment]', 'Review page B'); await page.click('.pop [data-x=save]');
  await page.click('#page-notes');
  check(await page.$$eval('.feedback-pages [data-page]', els => els.map(el => el.dataset.page).join('|') === 'a|b' && els[1].textContent.includes('Review page B') && els[1].textContent.includes('当前页')), 'notes on separate pages appear as separate destinations');
  if (process.env.PAGE_NOTES_SCREENSHOT) { await sleep(250); await page.screenshot({ path: process.env.PAGE_NOTES_SCREENSHOT }); }
  await page.click('.feedback-pages [data-page=a]'); await waitPage('a'); await browse();
  check(await frame().$eval('#title', el => el.textContent === 'Updated title') && await page.$('.feedback-pages') === null, 'page finder returns directly to annotated page and retains completed edits');
  await page.select('#page-sel', 'b'); await waitPage('b');
  await context('#title', 'move'); await numeric(99, 99); await page.click('#page-notes'); await page.click('.feedback-pages [data-page=a]'); await waitPage('a'); await browse();
  check(!(await stored('moves')).b, 'page finder cancels unfinished movement before switching');
  await page.select('#page-sel', 'b'); await waitPage('b'); await page.click('#count'); await page.select('[data-f=review-scope]', 'page'); await page.click('[data-act=clear-comments]'); await page.click('[data-act=confirm-clear]'); await page.keyboard.press('Escape');
  await page.click('#page-notes'); check(await page.$$eval('.feedback-pages [data-page]', els => els.length === 1 && els[0].dataset.page === 'a'), 'clearing a page removes it from the annotated page list');
  await page.click('.feedback-pages [data-page=a]'); await waitPage('a'); await browse();
  await page.evaluate(() => { const key = window.PROTO_CONFIG.storage.comments, cs = JSON.parse(localStorage.getItem(key)); cs['STALE-E1'] = { page: 'removed-page', comment: '<img src=x onerror=alert(1)>' }; localStorage.setItem(key, JSON.stringify(cs)); });
  await page.click('#page-notes');
  check(await page.$eval('.feedback-pages [data-page=removed-page]', el => el.disabled && el.textContent.includes('页面已不在目录中') && el.querySelector('img') === null), 'notes for removed pages remain identifiable, escaped and unavailable for navigation');
  await page.keyboard.press('Escape'); await page.evaluate(() => { const key = window.PROTO_CONFIG.storage.comments, cs = JSON.parse(localStorage.getItem(key)); delete cs['STALE-E1']; localStorage.setItem(key, JSON.stringify(cs)); });
  await page.reload({ waitUntil: 'networkidle0' }); await waitPage('a'); await browse();
  check(await frame().$eval('#title', el => el.textContent === 'Updated title'), 'reload restores committed edits while always starting in browse');
  stage = 'send preferences and feedback';
  await page.click('#send'); await page.waitForSelector('#send-notify'); check(await page.$eval('#send-notify', el => el.checked), 'send dialog labels notification preference');
  await page.click('#send-notify'); await page.click('[data-x=c]'); await page.click('#send'); check(await page.$eval('#send-notify', el => !el.checked), 'notification preference survives reopening confirmation');
  await page.click('[data-x=ok]'); await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('已保存'));
  const { readdirSync } = await import('node:fs'); const file = readdirSync(join(fixture, 'feedback')).find(name => name.endsWith('.json'));
  const bundle = JSON.parse(readFileSync(join(fixture, 'feedback', file), 'utf8'));
  check(bundle.edits.length === 1 && bundle.moves.length === 2 && bundle.comments.length === 1 && bundle.notify === false, 'sending stores only completed changes with selected notification preference');
  await page.waitForFunction(() => document.querySelector('#send').textContent === '发送');
  check(errors.length === 0, 'no browser script errors: ' + errors.join('; '));
  if (process.env.CONTEXT_SCREENSHOT) {
    await page.evaluate(() => document.querySelector('#stage').scrollTop = 0);
    await context('#title', 'edit'); await sleep(200); await page.screenshot({ path: process.env.CONTEXT_SCREENSHOT.replace('context-menu.png', 'edit-text.png') }); await page.click('#move-cancel'); await browse();
    await context('#card', 'move'); await sleep(200); await page.screenshot({ path: process.env.CONTEXT_SCREENSHOT.replace('context-menu.png', 'move-element.png') }); await page.click('#move-cancel'); await browse();
    await context('#card'); await sleep(200); await page.screenshot({ path: process.env.CONTEXT_SCREENSHOT });
  }
  console.log(results.join('\n')); console.log(`${results.length} checks passed`);
} catch (error) { console.error('FAIL at ' + stage + ': ' + error.stack); process.exitCode = 1; }
finally {
  await browser?.close();
  if (server) { server.kill(); await Promise.race([new Promise(done => server.once('exit', done)), sleep(2000)]); }
  const absolute = resolve(fixture);
  if (dirname(absolute) !== tempRoot || !basename(absolute).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
  rmSync(absolute, { recursive: true, force: true });
}
