// 元素移动浏览器回归：只写独立临时项目，不修改真实原型或已有反馈。
// 用法：node tests/verify-move.mjs
// 可选：PUPPETEER_EXECUTABLE_PATH 指定 Chrome / Edge。
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_ROOT = resolve(tmpdir());
const PREFIX = 'agent-html-collab-move-';
const fixture = mkdtempSync(join(TEMP_ROOT, PREFIX));
const browserPath = process.env.PUPPETEER_EXECUTABLE_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
].find(existsSync);
const results = [];
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
let server;
let browser;
let serverLog = '';
let failure;
let stage = '创建临时项目';

function check(ok, name) {
  assert.ok(ok, name);
  results.push('PASS  ' + name);
}
function near(actual, expected, name) {
  assert.ok(Math.abs(actual - expected) < 1.1, name + ': ' + actual + ' ≠ ' + expected);
}
async function unusedPort() {
  const probe = createServer();
  await new Promise((done, fail) => { probe.once('error', fail); probe.listen(0, '127.0.0.1', done); });
  const port = probe.address().port;
  await new Promise(done => probe.close(done));
  return port;
}

try {
  for (const [id, title] of [['a', 'Alpha'], ['b', 'Beta']]) {
    writeFileSync(join(fixture, id + '.html'), `<!doctype html><html><head><meta charset="UTF-8">
<title>${title}</title><style>
*{box-sizing:border-box}body{margin:0;padding:40px;font:20px sans-serif}main{width:700px}
h1{margin:0 0 25px}#card{display:block;width:160px;height:90px;padding:25px;background:#d6e9e2;margin-bottom:40px}
#link{display:inline-block;padding:15px;background:#dce8f4;margin-bottom:35px}
#nested{width:300px;height:100px;padding:30px;background:#eee;margin-bottom:40px}
#scaled{transform:scale(1.5);transform-origin:top left;width:220px;height:80px;margin-bottom:80px}
#scaled-child{width:130px;height:45px;background:#eadcc8;padding:12px}
#transition{width:180px;height:70px;padding:20px;background:#eadfea;margin-bottom:30px}
#dynamic{width:160px;height:60px;padding:15px;background:#e9e4cd;margin-bottom:20px}
input{display:block;width:200px;padding:10px;margin-top:20px}
</style><style id="dynamic-style">#dynamic{translate:10px 0}</style></head><body><main><h1 id="title">${title}</h1>
<div id="card" style="transform:rotate(2deg);translate:7px 5px !important">Move ${id}</div>
<a id="link" href="#navigated" onclick="window.activations++">Link ${id}</a>
<section id="nested"><span id="child">Nested ${id}</span></section>
<aside id="scaled"><div id="scaled-child">Scaled ${id}</div></aside>
<article id="transition" style="transition:all 1s !important">Transition ${id}</article>
<footer id="dynamic">Dynamic ${id}</footer>
<svg id="vector" xmlns="http://www.w3.org/2000/svg" width="140" height="70" style="display:inline;transform:rotate(2deg)"><rect id="shape" x="5" y="5" width="100" height="50" fill="#cae0d4"/></svg>
<input id="input" value="Editable control"><nav style="transform:rotate(30deg);transform-origin:top left;width:160px;height:70px;margin-top:30px"><button id="rotated-child" style="width:120px;height:40px">Rotated</button></nav></main><script>window.activations=0;</script></body></html>`);
  }
  writeFileSync(join(fixture, 'proto.config.json'), JSON.stringify({
    title: 'Move regression',
    source: { mode: 'pages', dir: '.', index: 'a.html' },
    pages: { container: 'body', singlePerFile: true, switch: 'auto', list: [
      { id: 'a', title: 'Page A', file: 'a.html' }, { id: 'b', title: 'Page B', file: 'b.html' },
    ] },
    viewport: { desktop: 900 }, tools: { anno: true },
    server: { feedbackDir: 'feedback/', wakeOnFeedback: false },
  }));
  const port = await unusedPort();
  const base = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, [join(ROOT, 'studio', 'serve.mjs'), '--root', fixture, '--port', String(port)], { stdio: 'pipe' });
  server.stdout.on('data', data => { serverLog += data; });
  server.stderr.on('data', data => { serverLog += data; });
  let spawnError;
  server.on('error', error => { spawnError = error; });
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt++) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw new Error('临时服务提前退出: ' + serverLog);
    ready = await fetch(base + '/api/ping').then(response => response.ok).catch(() => false);
    if (!ready) await sleep(100);
  }
  check(ready, '临时项目服务就绪');
  assert.ok(browserPath, '未找到 Chrome / Edge；请设置 PUPPETEER_EXECUTABLE_PATH');
  stage = '启动 Chrome / Edge';
  browser = await puppeteer.launch({ executablePath: browserPath, headless: true,
    args: ['--no-first-run', '--force-device-scale-factor=1'] });
  const page = await browser.newPage();
  const downloads = join(fixture, 'downloads');
  mkdirSync(downloads);
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  stage = '载入协同页面';
  await page.goto(base + '/studio', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  const frame = () => page.frames().find(item => item !== page.mainFrame() && item.url().includes('/project/'));
  // Geometry checks commit their preview before inspecting the persisted draft;
  // verify-context.mjs separately covers explicit Done/Cancel transaction behavior.
  async function storage(field) {
    if (field === 'moves') await commitMove();
    return page.evaluate(name => JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage[name]) || '{}'), field);
  }
  async function waitPage(id) {
    await page.waitForFunction(pageId => {
      const iframe = document.querySelector('#proto');
      return document.querySelector('#page-sel')?.value === pageId &&
        iframe?.contentWindow?.location.pathname.endsWith('/' + pageId + '.html') &&
        iframe.contentWindow.__PB_BRIDGE && iframe.contentDocument.querySelector('#card');
    }, {}, id);
  }
  async function gotoPage(id) {
    await page.keyboard.press('Escape');
    await page.select('#page-sel', id);
    await waitPage(id);
  }
  let wantedMove = false;
  async function setMode(mode) { wantedMove = mode === 'move'; if (!wantedMove) await page.keyboard.press('Escape'); }
  async function selectTarget(selector) {
    const selected = await frame().evaluate(() => window.__PB.getMoveSelection());
    if (selected && await frame().$eval(selector, (el, path) => {
      const root = document.body;
      function find(path) { let node = root; for (const part of path.split('>')) node = node.querySelector(':scope > ' + part); return node; }
      return find(path) === el;
    }, selected.path)) return;
    const at = await point(selector);
    const control = await frame().$eval(selector, el => el.matches('input,textarea,select'));
    if (control) { await page.click('#edit-pick'); await page.mouse.click(at.x, at.y); } else await page.mouse.click(at.x, at.y, { button: 'right' });
    if (!control) { if (!control) { if (!control) { await page.waitForSelector('.element-menu'); await page.click('[data-act=edit]'); } } }
    await page.waitForSelector('#move-panel', { visible: true });
  }
  async function reopenMove(selected) {
    if (!selected) return;
    const control = await frame().evaluate(s => { let node = document.body; for (const part of s.path.split('>')) node = node.querySelector(':scope > ' + part); return node.matches('input,textarea,select'); }, selected);
    if (control) await page.click('#edit-pick');
    await frame().evaluate(({ s, control }) => {
      let node = document.body; for (const part of s.path.split('>')) node = node.querySelector(':scope > ' + part);
      const r = node.getBoundingClientRect(); node.dispatchEvent(new MouseEvent(control ? 'click' : 'contextmenu', { bubbles: true, cancelable: true, clientX: r.x, clientY: r.y }));
    }, { s: selected, control });
    if (!control) { if (!control) { if (!control) { await page.waitForSelector('.element-menu'); await page.click('[data-act=edit]'); } } } await page.waitForSelector('#move-panel', { visible: true });
  }
  async function commitMove() {
    const selected = await frame().evaluate(() => window.__PB.getMoveSelection());
    if (!selected) return;
    await page.click('#move-apply'); await page.waitForFunction(() => document.querySelector('#move-panel').hidden);
    await reopenMove(selected);
  }
  async function point(selector) {
    return page.evaluate(value => {
      const iframe = document.querySelector('#proto');
      const rect = iframe.contentDocument.querySelector(value).getBoundingClientRect();
      const bounds = iframe.getBoundingClientRect();
      const scale = bounds.width / parseFloat(iframe.style.width);
      return { x: bounds.left + (rect.left + rect.width / 2) * scale,
        y: bounds.top + (rect.top + rect.height / 2) * scale, scale };
    }, selector);
  }
  async function click(selector) {
    if (wantedMove && !selector.startsWith('.pbx-')) { await selectTarget(selector); return; }
    const at = await point(selector);
    await page.mouse.click(at.x, at.y);
  }
  async function drag(selector, x, y, cancel = false, modifier = null) {
    await selectTarget(selector);
    const selected = await frame().evaluate(() => window.__PB.getMoveSelection());
    const at = await point('#pbx-move-handle');
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + x * at.scale, at.y + y * at.scale, { steps: 8 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    if (modifier) await page.keyboard.up(modifier);
    if (cancel) await reopenMove(selected); else await commitMove();
  }
  async function touchDrag(selector, x, y) {
    await selectTarget(selector);
    const at = await point('#pbx-move-handle');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y, id: 1 }] });
      for (let step = 1; step <= 8; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
          x: at.x + x * at.scale * step / 8, y: at.y + y * at.scale * step / 8, id: 1,
        }] });
        await sleep(20);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
    await commitMove();
  }
  async function rect(selector) {
    return frame().$eval(selector, element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, transform: element.style.transform,
        translate: element.style.getPropertyValue('translate'), priority: element.style.getPropertyPriority('translate'),
        transition: element.style.getPropertyValue('transition'), transitionPriority: element.style.getPropertyPriority('transition') };
    });
  }
  async function numeric(x, y) {
    await page.waitForSelector('#move-panel', { visible: true });
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    for (const [selector, value] of [['#move-x', x], ['#move-y', y]]) {
      await page.click(selector);
      await page.keyboard.down(modifier); await page.keyboard.press('a'); await page.keyboard.up(modifier);
      await page.keyboard.type(String(value));
    }
    await commitMove();
  }
  async function menu(action) {
    await page.click('#more');
    await page.click('[data-act=' + action + ']');
    if (await page.$('[data-act=confirm-clear]')) await page.click('[data-act=confirm-clear]');
  }
  async function selection() { return frame().evaluate(() => window.__PB.getMoveSelection()); }
  const moveChip = '.pbx-move-chip[data-page="a"][data-path="main>div"]';

  stage = '真实拖动与原有样式';
  await waitPage('a');
  await page.select('#zoom-sel', '0.5');
  await page.waitForFunction(() => document.querySelector('#proto').style.transform === 'scale(0.5)');
  const original = await rect('#card');
  await setMode('move');
  await drag('#card', 40, 24);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.moves) || '{}').a?.length === 1);
  let records = (await storage('moves')).a;
  let moved = await rect('#card');
  near(moved.x - original.x, 40, '真实横向位移'); near(moved.y - original.y, 24, '真实纵向位移');
  check(records[0].path === 'main>div' && records[0].from.x === 0 && records[0].from.y === 0 &&
    records[0].to.x === 40 && records[0].to.y === 24 && moved.transform === original.transform,
  '50% 缩放真实拖动按原型像素记录，保留已有 transform');
  check((await selection()).path === 'main>div' && await page.$eval('#move-panel', panel => !panel.hidden),
    '选中元素后显示移动控制面板');

  stage = '连续移动、键盘与数字操作';
  await click('#card');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.down('Shift'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Shift');
  await frame().waitForFunction(() => window.__PB.getMoveSelection()?.y === 34);
  records = (await storage('moves')).a;
  check(records.length === 1 && records[0].to.x === 41 && records[0].to.y === 34,
    '方向键移动 1px，Shift 方向键移动 10px，重复移动合并为同一记录');
  await numeric(52, -12);
  records = (await storage('moves')).a;
  moved = await rect('#card');
  near(moved.x - original.x, 52, '数字横向位移'); near(moved.y - original.y, -12, '数字纵向位移');
  check(records.length === 1 && records[0].from.x === 0 && records[0].to.x === 52 && records[0].to.y === -12,
    '数字输入保存相对最初位置的最终位移');
  await page.setViewport({ width: 500, height: 1000, deviceScaleFactor: 1 });
  check(await page.$eval('#move-panel', panel => {
    const bounds = panel.getBoundingClientRect();
    return !panel.hidden && bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight &&
      bounds.top >= document.querySelector('#bar').getBoundingClientRect().bottom;
  }) && await page.$eval('#bar', bar => bar.scrollWidth <= bar.clientWidth),
  '500px 窄屏移动面板完整位于工具栏下方，工具栏无横向溢出');
  await page.setViewport({ width: 375, height: 420, deviceScaleFactor: 1 });
  await page.waitForFunction(() => {
    const panel = document.querySelector('#move-panel'), bounds = panel.getBoundingClientRect();
    return bounds.bottom <= innerHeight && bounds.top >= document.querySelector('#bar').getBoundingClientRect().bottom;
  }, { timeout: 2000 });
  await page.click('#move-apply');
  await page.waitForFunction(() => document.querySelector('#move-panel').hidden);
  check(await page.$eval('#move-panel', panel => panel.hidden), '375×420 小窗口移动面板跟随工具栏换行，内部滚动后应用按钮仍可点击');
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });

  stage = '链接拦截与 Escape 取消';
  await click('#link');
  check(await frame().evaluate(() => !location.hash && window.activations === 0) && (await storage('moves')).a.length === 1,
    '移动模式点击链接只选择元素，不导航、不触发 onclick、不创建空移动');
  const linkOriginal = await rect('#link');
  await drag('#link', 30, 10, true);
  const linkAfterCancel = await rect('#link');
  near(linkAfterCancel.x, linkOriginal.x, '取消后链接横坐标'); near(linkAfterCancel.y, linkOriginal.y, '取消后链接纵坐标');
  check((await storage('moves')).a.length === 1 && await frame().evaluate(() => !location.hash && window.activations === 0),
    'Escape 取消正在拖动的元素，草稿与链接行为不变');

  stage = '选择父层与单元素还原';
  await click('#child');
  check((await selection()).path === 'main>section>span', '可以选择嵌套元素');
  const childOriginal = await rect('#child');
  await page.keyboard.press('ArrowRight');
  near((await rect('#child')).x - childOriginal.x, 1, 'inline 文本键盘位移');
  await page.click('#move-reset'); await commitMove();
  near((await rect('#child')).x, childOriginal.x, 'inline 文本还原');
  check(await frame().$eval('#child', element => !element.hasAttribute('style')),
    '普通 inline 文本可以移动并完整还原，没有残留 inline style');
  await page.click('#move-parent');
  check((await selection()).path === 'main>section', '移动面板可以选择当前元素父层');
  await numeric(0, 15);
  check((await storage('moves')).a.some(record => record.path === 'main>section' && record.to.y === 15),
    '父层位置可通过数字控制修改');
  await page.keyboard.down('Alt');
  await click('#child');
  await page.keyboard.up('Alt');
  check((await selection()).path === 'main>section>span' &&
    (await storage('moves')).a.find(record => record.path === 'main>section').to.y === 15,
    '右键选择已移动父层的子元素，保留父层位移');
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    const before = await selection();
    await page.click('[data-move-key=' + key + ']');
    const after = await selection();
    assert.equal(after.x - before.x, key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0);
    assert.equal(after.y - before.y, key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0);
  }
  await page.keyboard.down('Shift');
  await page.click('[data-move-key=ArrowRight]');
  await page.keyboard.up('Shift');
  near((await rect('#child')).x - childOriginal.x, 10, '微调按钮实际位移');
  check((await selection()).x === 10 && (await selection()).y === 0,
    '四向按钮每次微调 1px，Shift 点击微调 10px，支持按钮保留焦点');
  await page.click('#move-reset'); await commitMove();
  await page.click('#move-parent');
  await page.click('#move-reset'); await commitMove();
  check((await storage('moves')).a.length === 1 && (await storage('moves')).a[0].path === 'main>div',
    '还原所选父层只删除该层移动，保留其他元素');
  const scaledOriginal = await rect('#scaled-child');
  await drag('#scaled-child', 30, 18);
  const scaledRecord = (await storage('moves')).a.find(record => record.path === 'main>aside>div');
  const scaledMoved = await rect('#scaled-child');
  near(scaledMoved.x - scaledOriginal.x, 30, '父层缩放下屏幕横向位移');
  near(scaledMoved.y - scaledOriginal.y, 18, '父层缩放下屏幕纵向位移');
  check(scaledRecord.to.x === 20 && scaledRecord.to.y === 12,
    '父层 scale(1.5) 中拖动跟随指针，保存正确的局部 CSS 位移');
  await page.click('#move-reset'); await commitMove();

  stage = 'Shift 锁定拖动方向';
  await drag('#scaled-child', 30, 18, false, 'Shift');
  let constrained = await rect('#scaled-child');
  near(constrained.x - scaledOriginal.x, 30, '锁定横向拖动');
  near(constrained.y, scaledOriginal.y, '锁定横向不改变纵坐标');
  check((await selection()).x === 20 && (await selection()).y === 0,
    'Shift 横向拖动在缩放父层中按局部 CSS 像素保存');
  await page.click('#move-reset'); await commitMove();
  await drag('#scaled-child', 12, 30, false, 'Shift');
  constrained = await rect('#scaled-child');
  near(constrained.x, scaledOriginal.x, '锁定纵向不改变横坐标');
  near(constrained.y - scaledOriginal.y, 30, '锁定纵向拖动');
  check((await selection()).x === 0 && (await selection()).y === 20,
    'Shift 纵向拖动按开始时的主要方向锁定');
  await page.click('#move-reset'); await commitMove();

  const dragAt = await point('#pbx-move-handle');
  await page.mouse.move(dragAt.x, dragAt.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(dragAt.x + 30 * dragAt.scale, dragAt.y + 10 * dragAt.scale, { steps: 4 });
  await page.keyboard.up('Shift');
  await page.mouse.move(dragAt.x + 30 * dragAt.scale, dragAt.y + 18 * dragAt.scale, { steps: 4 });
  await page.mouse.up();
  check((await selection()).x === 20 && (await selection()).y === 12,
    '拖动途中松开 Shift 恢复自由移动');
  await page.click('#move-reset'); await commitMove();
  await drag('#scaled-child', 30, 18, true, 'Shift');
  near((await rect('#scaled-child')).x, scaledOriginal.x, '方向锁定拖动取消后恢复横坐标');
  check(!(await storage('moves')).a.some(record => record.path === 'main>aside>div'),
    'Escape 取消方向锁定拖动不留下草稿');

  const rotatedOriginal = await rect('#rotated-child');
  await drag('#rotated-child', 30, 18, false, 'Shift');
  const rotatedMoved = await rect('#rotated-child');
  near(rotatedMoved.x - rotatedOriginal.x, 30, '旋转父层中的水平拖动');
  near(rotatedMoved.y, rotatedOriginal.y, '旋转父层锁定屏幕方向');
  near((await selection()).x, 30 * Math.cos(Math.PI / 6), '旋转父层局部 X');
  near((await selection()).y, -15, '旋转父层局部 Y');
  check(true, 'Shift 在旋转父层中锁定预览水平轴，保持指针方向与反馈坐标一致');
  await page.click('#move-reset'); await commitMove();

  stage = '触屏移动';
  await touchDrag('#link', 24, 16);
  const touchRecord = (await storage('moves')).a.find(record => record.path === 'main>a');
  const touchMoved = await rect('#link');
  near(touchMoved.x - linkOriginal.x, 24, '触屏横向位移');
  near(touchMoved.y - linkOriginal.y, 16, '触屏纵向位移');
  check(touchRecord?.to.x === 24 && touchRecord?.to.y === 16 &&
    await frame().evaluate(() => !location.hash && window.activations === 0),
  '真实 CDP 触屏拖动保存位移，不被浏览器平移取消、不触发链接动作');
  await page.click('#move-reset'); await commitMove();

  stage = '刷新与位置徽章';
  await setMode('browse');
  await page.reload({ waitUntil: 'networkidle0' });
  await waitPage('a');
  moved = await rect('#card');
  near(moved.x - original.x, 52, '刷新后横向位移'); near(moved.y - original.y, -12, '刷新后纵向位移');
  await frame().waitForSelector(moveChip, { visible: true });
  await click(moveChip);
  await page.waitForSelector('#move-panel', { visible: true });
  check((await selection()).path === 'main>div' && await page.$eval('#move-x', input => +input.value) === 52,
    '刷新恢复移动草稿；点击原位置附近移动徽章可查看和继续调整');
  await page.click('#move-reset'); await commitMove();
  const restored = await rect('#card');
  near(restored.x, original.x, '还原横坐标'); near(restored.y, original.y, '还原纵坐标');
  check(Object.keys(await storage('moves')).length === 0 && restored.transform === original.transform &&
    restored.translate === original.translate && restored.priority === original.priority,
    '单元素还原恢复原有 translate 数值和 important 优先级');

  stage = '撤销与跨页隔离';
  await setMode('move');
  await click('#card'); await numeric(30, 12);
  await click('#card');
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.down(modifier); await page.keyboard.press('z'); await page.keyboard.up(modifier);
  await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.moves) || '{}')).length === 0);
  check(Object.keys(await storage('moves')).length === 0 && (await rect('#card')).translate === original.translate,
    'Ctrl+Z 撤销最近元素移动并恢复原样式');
  await click('#card'); await numeric(30, 12);
  await gotoPage('b');
  const bOriginal = await rect('#card');
  check(!(await storage('moves')).b, '另一文件不会套用上一页相同路径的移动');
  await click('#card'); await numeric(-9, 11);
  await gotoPage('a');
  near((await rect('#card')).x - original.x, 30, '切页后恢复 A 位移');
  await menu('undo-page');
  check(!(await storage('moves')).a && (await storage('moves')).b[0].to.x === -9,
    '还原本页改动保留其他文件的移动');
  await click('#card'); await numeric(20, -8);

  stage = '导出与真实发送';
  await menu('export-json');
  let download;
  for (let attempt = 0; attempt < 50 && !download; attempt++) {
    download = readdirSync(downloads).find(name => name.endsWith('.json'));
    if (!download) await sleep(100);
  }
  assert.ok(download, 'JSON 反馈包必须真实下载至隔离临时目录');
  const exported = JSON.parse(readFileSync(join(downloads, download), 'utf8'));
  check(exported.moves.length === 2 && exported.summary.moves === 2 && exported.edits.length === 0 &&
    exported.moves.some(record => record.page === 'a' && record.to.x === 20) &&
    exported.moves.some(record => record.page === 'b' && record.to.x === -9),
  '纯移动反馈包导出包含各页路径、原始位移、最终位移和移动计数');
  await page.click('#send');
  await page.waitForSelector('.pop [data-x=ok]', { visible: true });
  await page.click('.pop [data-x=ok]');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('已保存'));
  const feedbackFiles = readdirSync(join(fixture, 'feedback')).filter(name => name.endsWith('.json'));
  assert.equal(feedbackFiles.length, 1);
  const sent = JSON.parse(readFileSync(join(fixture, 'feedback', feedbackFiles[0]), 'utf8'));
  assert.deepEqual(sent.moves, exported.moves);
  check(sent.summary.moves === 2, '真实发送纯移动反馈，服务器落盘保留完整移动记录');

  stage = '导入幂等与全部还原';
  const importPath = join(fixture, 'move-feedback.json');
  writeFileSync(importPath, JSON.stringify(exported));
  await menu('undo-all');
  check(Object.keys(await storage('moves')).length === 0, '还原全部页面改动清空各页移动');
  for (let repeat = 0; repeat < 2; repeat++) {
    const choosing = page.waitForFileChooser();
    await menu('import');
    await (await choosing).accept([importPath]);
    await page.waitForFunction(count => {
      const text = document.querySelector('#toast').textContent;
      return text.includes('导入完成') && text.endsWith('移动 +' + count);
    }, {}, repeat === 0 ? 2 : 0);
  }
  const imported = await storage('moves');
  check(imported.a.length === 1 && imported.b.length === 1 && imported.a[0].to.x === 20,
    '同一移动反馈包连续导入两次按页面和路径去重');
  near((await rect('#card')).x - original.x, 20, '导入后 A 位移');
  await menu('undo-all');
  await gotoPage('b');
  const bRestored = await rect('#card');
  near(bRestored.x, bOriginal.x, '全部还原后 B 横坐标'); near(bRestored.y, bOriginal.y, '全部还原后 B 纵坐标');
  check(Object.keys(await storage('moves')).length === 0 && bRestored.translate === bOriginal.translate,
    '跨文件全部还原后另一文件恢复自己的原始位置与样式');

  stage = 'transition 元素拖动';
  await gotoPage('a');
  await setMode('move');
  // 刷新后 Studio 恢复自适应缩放；固定 50% 使后面的低位 fixture 可真实点击。
  await page.select('#zoom-sel', '0.5');
  await page.waitForFunction(() => document.querySelector('#proto').style.transform === 'scale(0.5)');
  const transitionOriginal = await rect('#transition');
  await drag('#transition', 35, 22);
  const transitionRecord = (await storage('moves')).a?.find(record => record.path === 'main>article');
  const transitionMoved = await rect('#transition');
  assert.ok(transitionRecord, '拖动 transition 元素必须产生移动记录；当前选择：' + JSON.stringify(await selection()));
  near(transitionMoved.x - transitionOriginal.x, 35, 'transition 元素即时横向位移');
  near(transitionMoved.y - transitionOriginal.y, 22, 'transition 元素即时纵向位移');
  check(transitionRecord?.to.x === 35 && transitionRecord?.to.y === 22,
    'transition:all 1s 的元素真实拖动准确保存位移');
  await page.click('#move-reset'); await commitMove();
  const transitionRestored = await rect('#transition');
  near(transitionRestored.x, transitionOriginal.x, 'transition 元素还原横坐标');
  near(transitionRestored.y, transitionOriginal.y, 'transition 元素还原纵坐标');
  check(transitionRestored.transition === transitionOriginal.transition &&
    transitionRestored.transitionPriority === transitionOriginal.transitionPriority,
  '还原移动保留原 transition 数值与 important 优先级');

  stage = '还原后重新读取样式基线';
  const dynamicOriginal = await rect('#dynamic');
  await click('#dynamic'); await numeric(20, 0);
  near((await rect('#dynamic')).x - dynamicOriginal.x, 20, '动态元素第一次位移');
  await menu('undo-all');
  near((await rect('#dynamic')).x, dynamicOriginal.x, '动态元素第一次完全还原');
  await frame().$eval('#dynamic-style', style => { style.textContent = '#dynamic{translate:100px 0}'; });
  const dynamicChanged = await rect('#dynamic');
  near(dynamicChanged.x - dynamicOriginal.x, 90, '原型自身更改 translate 基线');
  await click('#dynamic'); await numeric(20, 0);
  near((await rect('#dynamic')).x - dynamicChanged.x, 20, '动态基线变化后相对位移');
  check((await storage('moves')).a[0].to.x === 20,
    '完全还原后 stylesheet translate 从 10 改为 100，新移动 20 使用新基线');

  stage = '存储失败时事务还原';
  await page.evaluate(() => {
    window.__moveFailures = 0;
    window.addEventListener('message', event => { if (event.data?.type === 'pbx-move-error') window.__moveFailures++; });
  });
  const failureOriginal = await rect('#dynamic');
  for (const [index, method, expected] of [[0, 'resetMove', false], [1, 'resetAll', 0]]) {
    const failedReset = await frame().evaluate(action => {
      const key = window.PROTOBRIDGE_CFG.storage.moves;
      const before = localStorage.getItem(key);
      const element = document.querySelector('#dynamic');
      const styleBefore = element.getAttribute('style');
      const setter = Storage.prototype.setItem;
      try {
        Storage.prototype.setItem = function () { throw new DOMException('Injected storage failure', 'QuotaExceededError'); };
        const result = action === 'resetMove' ? window.__PB.resetMove('a', 'main>footer') : window.__PB.resetAll();
        return { result, before, after: localStorage.getItem(key), styleBefore, styleAfter: element.getAttribute('style') };
      } finally { Storage.prototype.setItem = setter; }
    }, method);
    assert.equal(failedReset.result, expected);
    assert.equal(failedReset.after, failedReset.before);
    assert.equal(failedReset.styleAfter, failedReset.styleBefore);
    const failureAfter = await rect('#dynamic');
    near(failureAfter.x, failureOriginal.x, method + ' 失败后横坐标');
    near(failureAfter.y, failureOriginal.y, method + ' 失败后纵坐标');
    await page.waitForFunction(count => window.__moveFailures === count && document.querySelector('#toast').textContent.includes('存储'), {}, index + 1);
    check(true, method + ' 存储失败返回失败状态、保留预览与原移动记录，并提示错误');
  }
  await page.click('#move-reset'); await commitMove();
  near((await rect('#dynamic')).x, dynamicChanged.x, '恢复存储后正常还原');
  check(Object.keys(await storage('moves')).length === 0, '恢复 Storage setter 后可正常还原，不遗留记录');

  stage = 'SVG 根元素选择与移动';
  const vectorOriginal = await rect('#vector');
  await click('#shape');
  check((await selection()).path === 'main>svg', '选择 SVG 内部图形自动选择整个 SVG 根元素');
  await numeric(17, 9);
  const vectorMoved = await rect('#vector');
  near(vectorMoved.x - vectorOriginal.x, 17, 'SVG 根元素横向位移');
  near(vectorMoved.y - vectorOriginal.y, 9, 'SVG 根元素纵向位移');
  check(vectorMoved.transform === vectorOriginal.transform && await frame().$eval('#vector', svg => !svg.style.left && !svg.style.top),
    'inline SVG 使用 translate 移动，保留 transform 且无普通文本定位残留');
  await page.click('#move-reset'); await commitMove();
  const vectorRestored = await rect('#vector');
  near(vectorRestored.x, vectorOriginal.x, 'SVG 还原横坐标');
  near(vectorRestored.y, vectorOriginal.y, 'SVG 还原纵坐标');
  check(vectorRestored.translate === vectorOriginal.translate && vectorRestored.transform === vectorOriginal.transform,
    'SVG 移动还原完整恢复原样式');

  stage = '移动输入控件的键盘焦点';
  await setMode('browse');
  await click('#input');
  check(await frame().evaluate(() => document.activeElement.id === 'input'), '浏览模式可正常聚焦原型输入框');
  await setMode('move');
  const inputOriginal = await rect('#input');
  await click('#input');
  await frame().focus('#pbx-move-handle');
  await page.keyboard.press('ArrowRight');
  await frame().waitForFunction(() => window.__PB.getMoveSelection()?.x === 1);
  await commitMove();
  near((await rect('#input')).x - inputOriginal.x, 1, '输入控件键盘移动');
  check(await frame().$eval('#input', input => input.value === 'Editable control'),
    '移动模式选择原先聚焦的输入控件后，方向键移动元素而不编辑输入值');
  await page.click('#move-reset'); await commitMove();
  assert.deepEqual(errors, []);
  check(true, '浏览器无运行时错误');
} catch (error) {
  failure = error;
  results.push('FAIL  ' + stage + ': ' + error.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise(done => server.once('close', done));
    server.kill();
    await stopped;
  }
  // 只删除本脚本 mkdtemp 创建、经过绝对路径与前缀验证的临时目录。
  assert.equal(dirname(resolve(fixture)), TEMP_ROOT);
  assert.ok(basename(fixture).startsWith(PREFIX));
  rmSync(fixture, { recursive: true, force: true });
}
console.log(results.join('\n'));
if (failure) {
  console.error(failure.stack);
  console.error(serverLog);
  process.exitCode = 1;
} else console.log('\n' + results.length + ' 项全部通过');
