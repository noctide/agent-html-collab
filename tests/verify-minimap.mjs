// 小地图浏览器回归；只写独立临时项目，不修改真实原型和已有反馈。
// 用法: node tests/verify-minimap.mjs
// 可选: PUPPETEER_EXECUTABLE_PATH 指定浏览器，MINIMAP_SCREENSHOT 指定截图绝对路径。
// MINIMAP_KERNEL_ROOT 可验证安装副本；MINIMAP_PROJECT_ROOT 可验证 Titanloom 四份 F 原型的临时副本。
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(process.env.MINIMAP_KERNEL_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..'));
const TEMP_ROOT = resolve(tmpdir());
const PREFIX = 'agent-html-collab-minimap-';
const fixture = mkdtempSync(join(TEMP_ROOT, PREFIX));
const browserPath = process.env.PUPPETEER_EXECUTABLE_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
].find(existsSync);
const results = [];
const failures = [];
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
let browser;
let server;
let multiServer;
let projectServer;
let serverLog = '';
let stage = '创建临时项目';
let failure;

function check(ok, name, details = '') {
  results.push((ok ? 'PASS' : 'FAIL') + '  ' + name + (details ? ' | ' + details : ''));
  if (!ok) failures.push(name);
}

async function unusedPort() {
  const probe = createServer();
  await new Promise((resolveListen, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolveListen);
  });
  const port = probe.address().port;
  await new Promise(resolveClose => probe.close(resolveClose));
  return port;
}

function source(id, height) {
  return `<!doctype html><html lang="zh-CN" class="fixture-root"><head>
<meta charset="UTF-8"><title>Minimap ${id.toUpperCase()}</title>
<link rel="stylesheet" href="palette-${id}.css"><style>
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:Arial,sans-serif;color:#17312e}
main{position:relative;min-height:${height}px;padding:48px;background:var(--paper)}
h1{margin:0 0 28px;font-size:2rem}.tag{font-size:1rem}.rem-probe{font-size:2rem}
.responsive{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin:30px 0}
.responsive>div{height:120px;background:var(--accent);color:white;padding:24px}
@media(max-width:1300px){.responsive{grid-template-columns:repeat(2,1fr)}}
svg{display:block;width:400px;height:180px}.chart-wrap{border-top:1px solid currentColor;padding-top:30px}
footer{position:absolute;left:48px;right:48px;bottom:24px;padding:24px;background:var(--accent);color:white}
</style></head><body class="fixture-page fixture-${id}"><main>
<h1 id="heading">${id.toUpperCase()} · Full page navigation</h1>
<span class="tag">External stylesheet · SVG · rem · media query</span>
<p class="rem-probe">The thumbnail keeps the prototype layout.</p>
<div class="responsive"><div>Prototype width: 1200</div><div>Two columns at this width</div><div>Long page: ${height}</div></div>
<section class="chart-wrap"><svg id="chart" viewBox="0 0 400 180" xmlns="http://www.w3.org/2000/svg">
<style>text{font-family:Arial,sans-serif;font-size:18px;fill:var(--accent)}
body.fixture-page{background:var(--paper)}html.fixture-root{font-size:var(--root-size)}</style>
<rect x="30" y="60" width="65" height="95" fill="var(--accent)"/><rect x="150" y="90" width="65" height="65" fill="var(--accent)"/>
<rect x="270" y="115" width="65" height="40" fill="var(--accent)"/>
<text id="svg-label" x="30" y="40">34</text><text x="150" y="70">21</text><text x="270" y="95">17</text></svg></section>
<svg id="reference-chart" viewBox="0 0 400 180" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="fixture-gradient"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>
<g id="fixture-symbol"><circle cx="200" cy="90" r="42" fill="#00ff00"/></g></defs>
<rect width="400" height="180" fill="url(#fixture-gradient)"/><use href="#fixture-symbol"/></svg>
<canvas id="canvas-probe" width="64" height="32"></canvas>
<form><input id="input-probe" value="Original"><input id="checked-probe" type="checkbox" checked>
<textarea id="textarea-probe">Original textarea</textarea>
<select id="select-probe"><option value="one" selected>One</option><option value="two">Two</option></select>
<select id="multiple-probe" multiple><option value="one" selected>One</option><option value="two">Two</option><option value="three">Three</option></select></form>
<footer id="bottom">Bottom of page ${id.toUpperCase()} — must stay visible and reachable</footer>
</main><script>
window.parent.__fixtureRuns=(window.parent.__fixtureRuns||0)+1;
const context=document.querySelector('#canvas-probe').getContext('2d');
context.fillStyle='#ef831d';context.fillRect(0,0,32,32);context.fillStyle='#19bdcd';context.fillRect(32,0,32,32);
document.querySelector('#input-probe').value='Current input ${id}';
document.querySelector('#checked-probe').checked=false;
document.querySelector('#textarea-probe').value='Current textarea ${id}';
document.querySelector('#select-probe').value='two';
Array.from(document.querySelector('#multiple-probe').options).forEach(option=>option.selected=option.value!=='one');
</script></body></html>`;
}

try {
  for (const [id, rootSize, accent, paper, height] of [
    ['a', 20, '#267e71', '#edf5f2', 3600],
    ['b', 24, '#986021', '#fff4de', 2200],
    ['c', 20, '#634588', '#f4ecff', 1200],
  ]) {
    writeFileSync(join(fixture, id + '.html'), source(id, height));
    writeFileSync(join(fixture, 'palette-' + id + '.css'),
      ':root{--root-size:' + rootSize + 'px;--accent:' + accent + ';--paper:' + paper + '}' +
      'html{font-size:var(--root-size)}body{background:var(--paper)}.tag{color:var(--accent)}');
  }
  writeFileSync(join(fixture, 'proto.config.json'), JSON.stringify({
    title: 'Minimap regression',
    source: { mode: 'pages', dir: '.', index: 'a.html' },
    pages: { container: 'body', singlePerFile: true, switch: 'auto', list: [
      { id: 'a', title: 'Page A', file: 'a.html' },
      { id: 'b', title: 'Page B', file: 'b.html' },
      { id: 'c', title: 'Page C', file: 'c.html' },
    ] },
    viewport: { desktop: 1200 },
    tools: { anno: true },
    server: { feedbackDir: 'feedback/', wakeOnFeedback: false },
  }));
  const port = await unusedPort();
  const base = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, [join(ROOT, 'studio', 'serve.mjs'), '--root', fixture,
    '--port', String(port)], { stdio: 'pipe' });
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
  assert.ok(ready, '临时项目服务就绪');
  assert.ok(browserPath, '未找到 Chrome / Edge；请设置 PUPPETEER_EXECUTABLE_PATH');
  stage = '启动 Edge / Chrome';
  browser = await puppeteer.launch({ executablePath: browserPath, headless: true,
    args: ['--no-first-run', '--force-device-scale-factor=1'] });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
  stage = '载入协同页面';
  await page.goto(base + '/studio', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });

  async function waitPage(id) {
    await page.waitForFunction(pageId => {
      const proto = document.querySelector('#proto');
      const mini = document.querySelector('#mmap-thumb iframe[data-minimap]');
      const miniRoot = mini?.contentDocument?.body;
      return document.querySelector('#page-sel')?.value === pageId &&
        proto?.contentWindow?.location.pathname.endsWith('/' + pageId + '.html') &&
        proto.contentWindow.__PB_BRIDGE && miniRoot?.querySelector('#bottom')?.textContent.includes('page ' + pageId.toUpperCase());
    }, { timeout: 15000 }, id);
    await sleep(200);
  }

  async function snapshot() {
    return page.evaluate(() => {
      const proto = document.querySelector('#proto');
      const mini = document.querySelector('#mmap-thumb iframe[data-minimap]');
      const miniDoc = mini.contentDocument;
      const miniRoot = miniDoc.body;
      function styles(root, view, selector) {
        const element = root.querySelector(selector);
        const style = view.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return { fontSize: style.fontSize, fontFamily: style.fontFamily, color: style.color,
          fill: style.fill, gridColumns: style.gridTemplateColumns, width: bounds.width, height: bounds.height };
      }
      const sourceStyles = selector => styles(proto.contentDocument, proto.contentWindow, selector);
      const miniStyles = selector => styles(miniRoot, miniDoc.defaultView, selector);
      const rect = element => {
        const r = element.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      const thumb = document.querySelector('#mmap-thumb');
      const map = document.querySelector('#mmap-body');
      const vp = document.querySelector('#mmap-vp');
      const stage = document.querySelector('#stage');
      const fit = document.querySelector('#fit');
      const scale = proto.getBoundingClientRect().width / proto.offsetWidth;
      const mapScale = thumb.getBoundingClientRect().width / proto.offsetWidth;
      return {
        isolated: !!mini, sandbox: mini?.getAttribute('sandbox'),
        sourceRem: sourceStyles('.rem-probe'), miniRem: miniStyles('.rem-probe'),
        sourceTag: sourceStyles('.tag'), miniTag: miniStyles('.tag'),
        sourceGrid: sourceStyles('.responsive'), miniGrid: miniStyles('.responsive'),
        sourceSvg: sourceStyles('#chart'), miniSvg: miniStyles('#chart'),
        sourceText: sourceStyles('#svg-label'), miniText: miniStyles('#svg-label'),
        sourceRootFont: proto.contentWindow.getComputedStyle(proto.contentDocument.documentElement).fontSize,
        miniRootFont: mini.contentWindow.getComputedStyle(miniDoc.documentElement).fontSize,
        sourceBackground: proto.contentWindow.getComputedStyle(proto.contentDocument.body).backgroundColor,
        miniBackground: miniDoc.defaultView.getComputedStyle(miniRoot).backgroundColor,
        thumb: rect(thumb), map: rect(map), vp: rect(vp),
        miniBottom: rect(miniRoot.querySelector('#bottom')),
        sourceHeight: Math.max(proto.contentDocument.documentElement.scrollHeight, proto.contentDocument.body.scrollHeight),
        iframeHeight: proto.clientHeight,
        contentHeight: proto.contentDocument.querySelector('main').getBoundingClientRect().height,
        sourceWidth: proto.contentWindow.innerWidth, miniWidth: mini?.contentWindow?.innerWidth,
        stageHeight: stage.clientHeight, stageScroll: stage.scrollTop, stageMax: stage.scrollHeight - stage.clientHeight,
        scale, mapScale, fitTop: fit.offsetTop,
        parentFont: getComputedStyle(document.body).fontSize,
        parentBackground: getComputedStyle(document.body).backgroundColor,
        parentRootFont: getComputedStyle(document.documentElement).fontSize,
        parentInlineStyles: !!document.querySelector('#mmap-thumb style'),
        scripts: miniRoot.querySelectorAll('script').length,
        collaboration: miniRoot.querySelectorAll('.pb-badge,.pbx-echip,#pbx-chip-layer,#pb-badge-layer,.pb-anno-fab').length,
        editMode: miniRoot.classList.contains('pbx-edit') || miniRoot.classList.contains('pbx-anno'),
        sourceRuns: window.__fixtureRuns,
      };
    });
  }

  function sameStyles(s, label) {
    check(s.isolated && s.sandbox?.split(/\s+/).includes('allow-same-origin') &&
      !s.sandbox.split(/\s+/).includes('allow-scripts'), label + ' 小地图隔离文档可读且禁用脚本');
    check(s.sourceWidth === 1200 && s.miniWidth === 1200, label + ' 媒体查询使用原型的 1200px 宽度');
    check(s.sourceRootFont === s.miniRootFont && s.sourceRem.fontSize === s.miniRem.fontSize,
      label + ' root 字体与 rem 尺寸保持一致', s.sourceRem.fontSize + ' / ' + s.miniRem.fontSize);
    check(s.sourceBackground === s.miniBackground && s.sourceTag.color === s.miniTag.color,
      label + ' body 背景、自定义属性及外链 CSS 保持一致');
    check(s.sourceGrid.gridColumns === s.miniGrid.gridColumns, label + ' 响应式网格列宽保持一致');
    // 隔离 iframe 内部的元素边界未缩放，外层 thumb 统一缩放。
    check(s.sourceSvg.width === s.miniSvg.width && s.sourceSvg.height === s.miniSvg.height &&
      s.sourceText.fontSize === s.miniText.fontSize && s.sourceText.fill === s.miniText.fill,
    label + ' SVG 图表、内部 style 与 text 保持一致');
    check(s.parentFont === '13px' && s.parentRootFont === '16px' &&
      s.parentBackground === 'rgb(238, 236, 232)' && !s.parentInlineStyles,
    label + ' 原型 CSS 不污染 Studio');
    check(s.scripts === 0 && s.collaboration === 0 && !s.editMode,
      label + ' 快照去除脚本、协作浮层及编辑状态');
  }

  function mapGeometry(s, label) {
    check(s.thumb.top >= s.map.top - 1 && s.thumb.bottom <= s.map.bottom + 1 &&
      s.thumb.left >= s.map.left - 1 && s.thumb.right <= s.map.right + 1,
    label + ' 整张长页缩略图位于小地图边界内');
    check(Math.abs(s.thumb.height - s.sourceHeight * s.mapScale) < 1,
      label + ' 页面宽高统一等比例缩放');
    check(s.vp.top >= s.thumb.top - 1 && s.vp.bottom <= s.thumb.bottom + 1 &&
      s.vp.left >= s.thumb.left - 1 && s.vp.right <= s.thumb.right + 1,
    label + ' 视口框保持在完整缩略图内');
    const expectedTop = s.thumb.top + Math.max(0, (s.stageScroll - s.fitTop) / s.scale) * s.mapScale;
    const expectedHeight = Math.min(s.thumb.height, s.stageHeight / s.scale * s.mapScale);
    check(Math.abs(s.vp.top - expectedTop) < 2 && Math.abs(s.vp.height - expectedHeight) < 2,
      label + ' 视口框位置及高度映射准确');
  }

  async function liveContent(label) {
    const content = await page.evaluate(async () => {
      const sourceDoc = document.querySelector('#proto').contentDocument;
      const preview = document.querySelector('#mmap-thumb iframe[data-minimap]');
      if (!preview?.contentDocument) return { isolated: false };
      const miniDoc = preview.contentDocument;
      const values = doc => [doc.querySelector('#input-probe').value, doc.querySelector('#checked-probe').checked,
        doc.querySelector('#textarea-probe').value, doc.querySelector('#select-probe').value,
        Array.from(doc.querySelector('#multiple-probe').selectedOptions).map(option => option.value)];
      const canvas = sourceDoc.querySelector('#canvas-probe');
      const bitmap = miniDoc.querySelector('#canvas-probe');
      let pixels = [];
      if (bitmap?.tagName === 'IMG') {
        await bitmap.decode();
        const sample = document.createElement('canvas');
        sample.width = 64; sample.height = 32;
        const context = sample.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        pixels = [Array.from(context.getImageData(8, 8, 1, 1).data), Array.from(context.getImageData(40, 8, 1, 1).data)];
      }
      const chart = miniDoc.querySelector('#reference-chart');
      const local = chart.getBoundingClientRect();
      const outer = preview.getBoundingClientRect();
      const scale = outer.width / preview.offsetWidth;
      return { isolated: true, sourceValues: values(sourceDoc), miniValues: values(miniDoc), pixels,
        canvasMatches: bitmap?.src === canvas.toDataURL(), baseURI: miniDoc.baseURI,
        chart: { x: outer.left + local.left * scale, y: outer.top + local.top * scale,
          width: local.width * scale, height: local.height * scale } };
    });
    check(content.isolated && JSON.stringify(content.sourceValues) === JSON.stringify(content.miniValues),
      label + ' 表单保留当前输入、勾选、文本域及单选/多选值');
    check(content.canvasMatches && JSON.stringify(content.pixels) === '[[239,131,29,255],[25,189,205,255]]',
      label + ' canvas 保留脚本绘制后的位图和像素');
    if (!content.isolated) { check(false, label + ' SVG 引用保真（缺少隔离快照）'); return; }
    const png = await page.screenshot({ clip: content.chart });
    const colors = await page.evaluate(async imageUrl => {
      const image = new Image(); image.src = imageUrl; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return [0.2, 0.8, 0.5].map(x => Array.from(context.getImageData(Math.floor(image.width * x), Math.floor(image.height / 2), 1, 1).data));
    }, 'data:image/png;base64,' + Buffer.from(png).toString('base64'));
    check(colors[0][0] > 150 && colors[0][2] < 100 && colors[1][2] > 150 && colors[1][0] < 100,
      label + ' SVG defs 渐变 url(#id) 真实渲染正确', JSON.stringify(colors.slice(0, 2)));
    check(colors[2][1] > 240 && colors[2][0] < 15 && colors[2][2] < 15,
      label + ' SVG use href=#id 真实渲染正确', JSON.stringify(colors[2]));
    if (colors[0][0] <= 150 || colors[1][2] <= 150 || colors[2][1] <= 240)
      console.log('SVG snapshot baseURI: ' + content.baseURI);
  }

  await waitPage('a');
  stage = '页面 A 样式与长页映射';
  let s = await snapshot();
  sameStyles(s, '页面 A');
  mapGeometry(s, '页面 A 顶部');
  await liveContent('页面 A');
  const sourceRuns = s.sourceRuns;
  await page.mouse.click(s.thumb.left + s.thumb.width / 2, Math.min(s.map.bottom - 3, s.thumb.bottom - 3));
  await sleep(150);
  s = await snapshot();
  check(s.stageMax > 0 && Math.abs(s.stageScroll - s.stageMax) <= 2,
    '点击长页缩略图底部可导航到页面底部', s.stageScroll + ' / ' + s.stageMax);
  mapGeometry(s, '页面 A 底部');

  stage = '缩放及调整窗口';
  await page.select('#zoom-sel', '1');
  await sleep(150);
  mapGeometry(await snapshot(), '100% 缩放');
  await page.setViewport({ width: 960, height: 700, deviceScaleFactor: 1 });
  await sleep(250);
  s = await snapshot();
  sameStyles(s, '窄侧栏');
  mapGeometry(s, '窗口调整');
  check(s.thumb.bottom <= s.map.bottom + 1 && s.map.height <= 211,
    '窗口变矮后重新缩小完整长页');

  stage = '切换另一文件';
  await page.select('#page-sel', 'b');
  await waitPage('b');
  s = await snapshot();
  sameStyles(s, '页面 B');
  mapGeometry(s, '页面 B');
  await liveContent('页面 B');
  check(s.miniRem.fontSize === '48px' && s.miniTag.color === 'rgb(152, 96, 33)',
    '跨文件切页使用 B 的新 CSS 与 root 字体');
  check(s.sourceRuns === sourceRuns + 1, '每次切页只运行原型脚本，小地图不再次执行');

  stage = '同高度内容变化';
  const unchangedHeight = s.iframeHeight;
  await page.evaluate(() => {
    const doc = document.querySelector('#proto').contentDocument;
    setTimeout(() => { doc.querySelector('#heading').textContent = 'Async final heading'; }, 200);
  });
  await page.waitForFunction(() => document.querySelector('#mmap-thumb iframe[data-minimap]')?.contentDocument?.querySelector('#heading')?.textContent === 'Async final heading');
  check((await snapshot()).iframeHeight === unchangedHeight, '同高度异步内容变化后小地图自动刷新');
  await page.evaluate(() => {
    const input = document.querySelector('#proto').contentDocument.querySelector('#input-probe');
    input.value = 'User input after load'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('#mmap-thumb iframe[data-minimap]')?.contentDocument?.querySelector('#input-probe')?.value === 'User input after load');
  check(true, '输入值变化无需页面高度变化即可刷新');

  stage = '编辑模式及切回原文件';
  await page.click('#bar [data-x=m-edit]');
  await page.select('#page-sel', 'a');
  await waitPage('a');
  s = await snapshot();
  sameStyles(s, '切回页面 A');
  check(s.miniRem.fontSize === '40px' && s.miniTag.color === 'rgb(38, 126, 113)',
    '切回 A 后没有 B 的残留样式');
  check(!s.editMode && s.collaboration === 0, '编辑模式不把编辑状态和位置徽章绘入缩略图');
  await page.click('#bar [data-x=m-browse]');
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
  await page.select('#zoom-sel', 'fit');
  await page.evaluate(() => { document.querySelector('#stage').scrollTop = 950; });
  await sleep(250);
  if (process.env.MINIMAP_SCREENSHOT) {
    assert.ok(isAbsolute(process.env.MINIMAP_SCREENSHOT), '截图路径必须是绝对路径');
    await page.screenshot({ path: process.env.MINIMAP_SCREENSHOT });
  }
  stage = '跨文件长页切换短页';
  const longHeight = (await snapshot()).iframeHeight;
  let releasePage;
  await page.setRequestInterception(true);
  const interceptPage = request => {
    if (request.isInterceptResolutionHandled()) return;
    if (request.url().includes('/project/c.html')) releasePage = () => request.continue();
    else request.continue();
  };
  page.on('request', interceptPage);
  await page.select('#page-sel', 'c');
  await page.waitForFunction(() => !document.querySelector('#mmap-thumb iframe[data-minimap]'));
  check(true, '切换文件加载期间立即清除旧缩略图');
  for (let attempt = 0; attempt < 100 && !releasePage; attempt++) await sleep(20);
  assert.ok(releasePage, '拦截新页面请求');
  await releasePage();
  page.off('request', interceptPage);
  await page.setRequestInterception(false);
  await waitPage('c');
  s = await snapshot();
  check(s.contentHeight === 1200 && s.iframeHeight === s.contentHeight && s.iframeHeight < longHeight,
    '从长页切到短文件后主 iframe 缩回实际内容高度', s.iframeHeight + ' / ' + s.contentHeight);
  check(Math.abs(s.thumb.height - s.contentHeight * s.mapScale) < 1,
    '短文件缩略图高度按新内容测量', s.thumb.height + ' / ' + s.contentHeight * s.mapScale);
  mapGeometry(s, '短文件页面 C');

  stage = '窄窗口下的短内容';
  await page.setViewport({ width: 480, height: 760, deviceScaleFactor: 1 });
  await page.evaluate(() => {
    const doc = document.querySelector('#proto').contentDocument;
    doc.body.innerHTML = '<main style="height:200px;min-height:0;padding:0"><h1>Short content</h1></main>';
  });
  await page.waitForFunction(() => document.querySelector('#proto').clientHeight === 200);
  await sleep(200);
  const shortGeometry = await page.evaluate(() => ({
    frame: document.querySelector('#proto').clientHeight,
    map: document.querySelector('#mmap-body').getBoundingClientRect().height,
    thumb: document.querySelector('#mmap-thumb').getBoundingClientRect().height,
    mini: document.querySelector('#mmap-thumb iframe[data-minimap]')?.contentDocument?.querySelector('h1')?.textContent,
  }));
  check(shortGeometry.frame === 200 && shortGeometry.mini === 'Short content', '短内容不会被窄窗口的反向缩放高度撑大');
  check(Math.abs(shortGeometry.map - shortGeometry.thumb) < 1, '短页小地图底部没有最小容器高度造成的空白');
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });

  stage = '同一文件内页面切换';
  writeFileSync(join(fixture, 'multi.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">
<style>*{box-sizing:border-box}html,body{margin:0;padding:0}.pg-sec{display:none;position:relative;height:3600px;padding:40px;background:#edf5f2}
.pg-sec.act{display:block}#pg-equal{background:#fff4de}#pg-short{height:900px;background:#f4ecff}
footer{position:absolute;bottom:24px;left:40px}</style></head><body>
<section id="pg-long" class="pg-sec act" data-page="long"><h1>Long page</h1><footer>Long bottom</footer></section>
<section id="pg-equal" class="pg-sec" data-page="equal"><h1>Equal-height page</h1><footer>Equal bottom</footer></section>
<section id="pg-short" class="pg-sec" data-page="short"><h1>Short page</h1><footer>Short bottom</footer></section>
</body></html>`);
  writeFileSync(join(fixture, 'multi.config.json'), JSON.stringify({
    source: { mode: 'single', file: 'multi.html' },
    pages: { container: '.pg-sec', activeClass: 'act', switch: 'auto', list: [
      { id: 'long', title: 'Long' }, { id: 'equal', title: 'Equal' }, { id: 'short', title: 'Short' },
    ] }, viewport: { desktop: 1200 }, tools: { anno: false },
    server: { feedbackDir: 'feedback/', wakeOnFeedback: false },
  }));
  const multiPort = await unusedPort();
  const multiBase = 'http://127.0.0.1:' + multiPort;
  multiServer = spawn(process.execPath, [join(ROOT, 'studio', 'serve.mjs'), '--root', fixture,
    '--config', join(fixture, 'multi.config.json'), '--port', String(multiPort)], { stdio: 'pipe' });
  multiServer.stdout.on('data', data => { serverLog += data; });
  multiServer.stderr.on('data', data => { serverLog += data; });
  let multiSpawnError;
  multiServer.on('error', error => { multiSpawnError = error; });
  let multiReady = false;
  for (let attempt = 0; attempt < 60 && !multiReady; attempt++) {
    if (multiSpawnError) throw multiSpawnError;
    if (multiServer.exitCode !== null) throw new Error('单文件临时服务提前退出: ' + serverLog);
    multiReady = await fetch(multiBase + '/api/ping').then(response => response.ok).catch(() => false);
    if (!multiReady) await sleep(100);
  }
  assert.ok(multiReady, '单文件临时项目服务就绪');
  await page.goto(multiBase + '/studio', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('#mmap-thumb iframe[data-minimap]')?.contentDocument?.querySelector('.pg-sec.act'));

  async function multiSnapshot() {
    return page.evaluate(() => {
      const proto = document.querySelector('#proto');
      const preview = document.querySelector('#mmap-thumb iframe[data-minimap]');
      const active = proto.contentDocument.querySelector('.pg-sec.act');
      const miniActive = preview?.contentDocument?.querySelector('.pg-sec.act');
      const rect = element => {
        const r = element.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      const stage = document.querySelector('#stage');
      const thumb = document.querySelector('#mmap-thumb');
      return { sourcePage: active?.dataset.page, miniPage: miniActive?.dataset.page,
        sourceTitle: active?.querySelector('h1')?.textContent, miniTitle: miniActive?.querySelector('h1')?.textContent,
        sourceHeight: Math.max(proto.contentDocument.documentElement.scrollHeight, proto.contentDocument.body.scrollHeight),
        contentHeight: active?.getBoundingClientRect().height, iframeHeight: proto.clientHeight,
        thumb: rect(thumb), map: rect(document.querySelector('#mmap-body')), vp: rect(document.querySelector('#mmap-vp')),
        scale: proto.getBoundingClientRect().width / proto.offsetWidth,
        mapScale: thumb.getBoundingClientRect().width / proto.offsetWidth,
        fitTop: document.querySelector('#fit').offsetTop, stageHeight: stage.clientHeight, stageScroll: stage.scrollTop,
        ready: preview?.hasAttribute('data-ready'), visible: preview && getComputedStyle(preview).visibility === 'visible' };
    });
  }
  async function switchMulti(id) {
    await page.select('#page-sel', id);
    await page.waitForFunction(pageId => document.querySelector('#proto').contentDocument.querySelector('.pg-sec.act')?.dataset.page === pageId,
      { timeout: 15000 }, id);
    await sleep(300);
    return multiSnapshot();
  }

  await page.evaluate(() => { document.querySelector('#stage').scrollTop = 950; });
  await sleep(100);
  s = await switchMulti('equal');
  check(s.sourcePage === 'equal' && s.miniPage === 'equal' && s.sourceTitle === s.miniTitle && s.ready && s.visible,
    '同高度自动切页后缩略图刷新为新活动页', s.sourcePage + ' / ' + s.miniPage);
  check(s.stageScroll === 0, '同高度自动切页后主舞台滚动复位', String(s.stageScroll));
  mapGeometry(s, '同高度自动切页');

  const multiLongHeight = s.iframeHeight;
  s = await switchMulti('short');
  check(s.contentHeight === 900 && s.iframeHeight === s.contentHeight && s.iframeHeight < multiLongHeight,
    '单文件长页切到短页后主 iframe 缩回实际内容高度', s.iframeHeight + ' / ' + s.contentHeight);
  check(s.miniPage === 'short' && Math.abs(s.thumb.height - s.contentHeight * s.mapScale) < 1,
    '单文件短页缩略图刷新并缩回新内容高度', s.miniPage + ' / ' + s.thumb.height);
  mapGeometry(s, '单文件短页');

  stage = '折叠小地图时切页';
  await page.click('#mmap-fold');
  await switchMulti('long');
  await switchMulti('equal');
  await page.click('#mmap-fold');
  await sleep(300);
  s = await multiSnapshot();
  check(s.miniPage === 'equal' && s.ready && s.visible,
    '折叠期间切页后展开显示当前活动页', s.sourcePage + ' / ' + s.miniPage);
  mapGeometry(s, '折叠切页后展开');
  await page.evaluate(() => document.querySelector('#proto').contentDocument.querySelector('.pg-sec.act').classList.remove('act'));
  await page.waitForFunction(() => !document.querySelector('#mmap-thumb iframe[data-minimap]'));
  check(true, '活动根不存在时清除旧缩略图');

  if (process.env.MINIMAP_PROJECT_ROOT) {
    stage = 'Titanloom 实际原型副本';
    const project = join(fixture, 'titanloom'); mkdirSync(project);
    const files = ['FormDesigner', 'FormFill', 'FormRecords', 'Forms'];
    for (const id of files) cpSync(join(process.env.MINIMAP_PROJECT_ROOT, id + '.html'), join(project, id + '.html'));
    cpSync(join(process.env.MINIMAP_PROJECT_ROOT, 'assets'), join(project, 'assets'), { recursive: true });
    writeFileSync(join(project, 'proto.config.json'), JSON.stringify({
      source: { mode: 'pages', dir: '.', index: 'FormDesigner.html' },
      pages: { container: 'body', singlePerFile: true, list: files.map(id => ({ id, title: id, file: id + '.html' })) },
      viewport: { desktop: 1440 }, tools: { anno: false },
    }));
    const projectPort = await unusedPort(), projectBase = 'http://127.0.0.1:' + projectPort;
    projectServer = spawn(process.execPath, [join(ROOT, 'studio/serve.mjs'), '--root', project, '--port', String(projectPort)], { stdio: 'pipe' });
    projectServer.stdout.on('data', data => { serverLog += data; });
    projectServer.stderr.on('data', data => { serverLog += data; });
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await fetch(projectBase + '/api/ping').then(response => response.ok).catch(() => false)) break;
      await sleep(100);
    }
    await page.goto(projectBase + '/studio', { waitUntil: 'networkidle0' });
    async function waitPrototype(id) {
      await page.waitForFunction(id => {
        const source = document.querySelector('#proto'), mini = document.querySelector('#mmap-thumb iframe[data-minimap]');
        return source.contentWindow.location.pathname.endsWith('/' + id + '.html') && mini?.hasAttribute('data-ready') &&
          mini.contentDocument.title === source.contentDocument.title;
      }, { timeout: 15000 }, id);
      await sleep(250);
    }
    for (const viewport of [{ width: 1400, height: 900 }, { width: 480, height: 760 }]) {
      await page.setViewport(viewport);
      for (const id of files) {
        await page.select('#page-sel', id); await waitPrototype(id);
        const geometry = await page.evaluate(() => {
          const source = document.querySelector('#proto'), mini = document.querySelector('#mmap-thumb iframe[data-minimap]');
          const display = (doc, selector) => { const element = doc.querySelector(selector); return element ? doc.defaultView.getComputedStyle(element).display : null; };
          return { height: source.clientHeight, bottom: source.contentDocument.querySelector('#page')?.getBoundingClientRect().bottom,
            map: document.querySelector('#mmap-body').getBoundingClientRect().height, thumb: document.querySelector('#mmap-thumb').getBoundingClientRect().height,
            sourceGrid: display(source.contentDocument, '.ff-body'), miniGrid: display(mini.contentDocument, '.ff-body'),
            sourceFlex: display(source.contentDocument, '.fr-head'), miniFlex: display(mini.contentDocument, '.fr-head') };
        });
        const label = id + ' @' + viewport.width;
        check(geometry.sourceGrid === geometry.miniGrid && geometry.sourceFlex === geometry.miniFlex, label + ' 源页面和小地图布局一致');
        check((!geometry.bottom || Math.abs(geometry.height - geometry.bottom) < 2) && Math.abs(geometry.map - geometry.thumb) < 1,
          label + ' 内容高度正确且地图底部无额外空白', JSON.stringify(geometry));
      }
    }
    await page.setViewport({ width: 1400, height: 900 });
    await page.select('#page-sel', 'FormDesigner'); await waitPrototype('FormDesigner');
    await page.evaluate(() => document.querySelector('#proto').contentDocument.querySelector('button[data-act="tab"][data-v="flow"]').click());
    await page.waitForFunction(() => {
      const source = document.querySelector('#proto').contentDocument, mini = document.querySelector('#mmap-thumb iframe[data-minimap]');
      return mini?.hasAttribute('data-ready') && source.querySelector('#ws-flow')?.hidden === false && mini.contentDocument.querySelector('#ws-flow')?.hidden === false;
    }, { timeout: 15000 });
    check(true, 'FormDesigner 切换流程配置后同高度内容及时刷新');
    for (const id of files) await page.select('#page-sel', id);
    await waitPrototype('Forms'); check(true, '快速连续切换四个文件后显示最后一页');
    if (process.env.MINIMAP_SCREENSHOT) await page.screenshot({ path: process.env.MINIMAP_SCREENSHOT });
  }
  check(pageErrors.length === 0, '浏览器运行无未处理脚本异常', pageErrors.join(' / '));
  assert.equal(failures.length, 0, failures.join('\n'));
} catch (error) {
  failure = error;
  results.push('FAIL  ' + stage + ': ' + error.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const fixtureServer of [server, multiServer, projectServer]) {
    if (fixtureServer && fixtureServer.exitCode === null && fixtureServer.signalCode === null) {
      const stopped = new Promise(resolveStop => fixtureServer.once('close', resolveStop));
      fixtureServer.kill();
      await stopped;
    }
  }
  // 只清理本脚本 mkdtemp 返回的绝对目录，拒绝越界路径。
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
