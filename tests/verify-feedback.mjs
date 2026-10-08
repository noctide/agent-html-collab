// 意见 / 改动管理回归；使用独立临时项目，不修改 examples 或已有反馈。
// 用法: node tests/verify-feedback.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_ROOT = resolve(tmpdir());
const PREFIX = 'agent-html-collab-feedback-';
const fixture = mkdtempSync(join(TEMP_ROOT, PREFIX));
const browserPath = process.env.PUPPETEER_EXECUTABLE_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
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

try {
  for (const [id, title] of [['a', 'Alpha'], ['b', 'Beta']]) {
    writeFileSync(join(fixture, id + '.html'), '<!doctype html><html><head><title>' + title +
      '</title><style>body{font:20px sans-serif;padding:40px}main{max-width:600px}' +
      'h1{margin:0 0 40px}p{margin:0 0 40px}</style></head><body><main>' +
      '<h1 id="title">' + title + '</h1><p id="intro">Description ' + id +
      '</p><span id="unchanged">' + title + '</span><section data-anno="' + id.toUpperCase() +
      '-01">Old banner</section></main></body></html>');
  }
  writeFileSync(join(fixture, 'proto.config.json'), JSON.stringify({
    title: 'Feedback regression',
    source: { mode: 'pages', dir: '.', index: 'a.html' },
    pages: { container: 'body', singlePerFile: true, switch: 'auto', list: [
      { id: 'a', title: 'Page A', file: 'a.html' },
      { id: 'b', title: 'Page B', file: 'b.html' },
    ] },
    viewport: { desktop: 900 },
    tools: { anno: true },
    server: { feedbackDir: 'feedback/', wakeOnFeedback: false },
  }));
  const importPath = join(fixture, 'feedback-import.json');
  writeFileSync(importPath, JSON.stringify({ v: 2, comments: [], edits: [
    { page: 'a', path: 'main>h1', from: 'Alpha', to: 'Imported revision', ts: '2026-10-05T10:00:00Z' },
  ] }));

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
  check(ready, '临时项目服务就绪');
  assert.ok(browserPath, '未找到 Chrome / Edge；请设置 PUPPETEER_EXECUTABLE_PATH');
  stage = '启动 Edge / Chrome';
  browser = await puppeteer.launch({ executablePath: browserPath, headless: true,
    args: ['--no-first-run', '--force-device-scale-factor=1'] });
  stage = '载入协同页面';
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
  await page.goto(base + '/studio', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });

  const storage = field => page.evaluate(name => JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage[name]) || '{}'), field);
  const frame = () => page.frames().find(item => item !== page.mainFrame() && item.url().includes('/project/'));
  async function waitPage(id) {
    await page.waitForFunction(pageId => {
      const iframe = document.querySelector('#proto');
      return document.querySelector('#page-sel')?.value === pageId &&
        iframe?.contentWindow?.location.pathname.endsWith('/' + pageId + '.html') &&
        iframe.contentWindow.__PB_BRIDGE && iframe.contentDocument.querySelector('#title');
    }, {}, id);
  }
  async function gotoPage(id) {
    await page.keyboard.press('Escape');
    await page.select('#page-sel', id);
    await waitPage(id);
  }
  async function setMode(mode) {
    if (!await page.$eval('#bar [data-x=m-' + mode + ']', button => button.classList.contains('on'))) {
      await page.click('#bar [data-x=m-' + mode + ']');
    }
    await frame().waitForFunction(value => document.body.classList.contains('pbx-' + value) ||
      (value === 'browse' && !document.body.classList.contains('pbx-edit') &&
        !document.body.classList.contains('pbx-anno')), {}, mode);
  }
  async function beginTitleEdit(text) {
    await setMode('edit');
    await clickMarker('#title', true);
    await frame().waitForFunction(() => document.querySelector('#title').contentEditable === 'true');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.down(modifier);
    await page.keyboard.press('a');
    await page.keyboard.up(modifier);
    await page.keyboard.type(text);
  }
  async function editTitle(text) {
    await beginTitleEdit(text);
    await frame().evaluate(() => document.activeElement.blur());
    await page.waitForFunction(value => Object.values(JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.edits) || '{}'))
      .some(records => records.some(record => record.to === value)), {}, text);
    assert.equal(await frame().$eval('#title', element => element.textContent.trim()), text);
  }
  async function openReview(viaMenu = false) {
    await page.keyboard.press('Escape');
    if (viaMenu) {
      await page.click('#more');
      await page.click('[data-act=feedback-review]');
    } else await page.click('#count');
    await page.waitForSelector('.feedback-manager', { visible: true });
  }
  async function confirmAction(action) {
    await page.click('.feedback-manager [data-act=' + action + ']');
    await page.waitForSelector('.feedback-manager [data-act=confirm-clear]', { visible: true });
    await page.click('.feedback-manager [data-act=confirm-clear]');
  }
  async function clickMarker(selector, textTarget = false) {
    // 使用真实屏幕点击；ElementHandle.click 的自动滚动会重建位置徽章。
    const point = await page.evaluate((value, useTextBounds) => {
      const iframe = document.querySelector('#proto');
      const element = iframe.contentDocument.querySelector(value);
      let marker = element.getBoundingClientRect();
      if (useTextBounds) {
        const range = iframe.contentDocument.createRange();
        range.selectNodeContents(element);
        marker = range.getBoundingClientRect();
      }
      const bounds = iframe.getBoundingClientRect();
      const scale = bounds.width / parseFloat(iframe.style.width);
      return { x: bounds.left + (marker.left + marker.width / 2) * scale,
        y: bounds.top + (marker.top + marker.height / 2) * scale };
    }, selector, textTarget);
    await page.mouse.click(point.x, point.y);
  }
  async function importFeedback(expectedNewEdits) {
    const chooserPromise = page.waitForFileChooser();
    await page.click('#more');
    await page.click('[data-act=import]');
    const chooser = await chooserPromise;
    await chooser.accept([importPath]);
    await page.waitForFunction(count => document.querySelector('#toast').textContent.includes('改动 +' + count),
      {}, expectedNewEdits);
  }
  const commentChip = '.pbx-echip[data-comment-id="A-E1"]';
  const editChip = '.pbx-edit-chip[data-page="a"]';
  const regionBadge = '.pbx-echip[data-comment-id="A-01"]';

  stage = '等待页面桥接就绪';
  await waitPage('a');
  stage = '验证位置反馈与清理操作';
  check(await page.$eval('#count', element => element.tagName === 'BUTTON'), '顶栏计数提供可点击按钮');
  await editTitle('First revision');
  await editTitle('Final revision');
  const firstEdits = (await storage('edits')).a;
  check(firstEdits.length === 1 && firstEdits[0].from === 'Alpha' && firstEdits[0].to === 'Final revision',
    '连续两次真实编辑保留初始原文，只记录最终改动');

  await setMode('anno');
  await clickMarker('#intro', true);
  await page.waitForSelector('.pop [data-f=comment]', { visible: true });
  await page.type('.pop [data-f=comment]', '请重写这段说明');
  await page.click('.pop [data-x=save]');
  await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.comments) || '{}'))
    .some(comment => comment.comment === '请重写这段说明'));
  const realComment = Object.values(await storage('comments'))
    .find(comment => comment.comment === '请重写这段说明');
  check(realComment.page === 'a' && realComment.path === 'main>p', '真实标注记录在被点击的说明段落位置');
  await page.evaluate(() => {
    const comments = JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.comments) || '{}');
    comments['A-E99'] = { page: 'a', path: 'main>aside', region: 'Removed target', comment: '已失去目标的意见' };
    comments['A-01'] = { page: 'a', region: 'Old banner', comment: '区域意见需要清理' };
    comments['B-E1'] = { page: 'b', path: 'main>p', origText: 'Description b', region: 'Description b', comment: '另一页的意见' };
    localStorage.setItem(window.PROTO_CONFIG.storage.comments, JSON.stringify(comments));
  });
  await setMode('browse');
  await page.reload({ waitUntil: 'networkidle0' });
  await waitPage('a');
  await frame().waitForSelector(commentChip, { visible: true });
  await frame().waitForSelector(editChip, { visible: true });
  await frame().waitForSelector(regionBadge, { visible: true });
  check(await frame().$(commentChip) && await frame().$(editChip) && await frame().$(regionBadge),
    '浏览模式在元素意见、文字改动、区域意见位置显示徽章');
  check(await frame().evaluate(selector => {
    const marker = document.querySelector(selector).getBoundingClientRect();
    const repeat = document.querySelector('#unchanged').getBoundingClientRect();
    return !(marker.left < repeat.right && marker.right > repeat.left &&
      marker.top < repeat.bottom && marker.bottom > repeat.top);
  }, regionBadge), '区域意见徽章不遮挡紧邻的重复原文元素');
  await setMode('edit');
  await frame().waitForSelector(commentChip, { visible: true });
  await frame().waitForSelector(editChip, { visible: true });
  await frame().waitForSelector(regionBadge, { visible: true });
  check(await frame().$(commentChip) && await frame().$(editChip) && await frame().$(regionBadge),
    '编辑模式也保留三类反馈的位置徽章');
  await beginTitleEdit('Uncommitted final');
  await clickMarker(editChip);
  await page.waitForSelector('.pop [data-act=restore-edit]', { visible: true });
  const pendingEditText = await page.$eval('.pop', panel => panel.textContent);
  check(pendingEditText.includes('Alpha') && pendingEditText.includes('Uncommitted final') &&
    (await storage('edits')).a[0].to === 'Uncommitted final',
  '编辑未失焦时直接真实点击既有改动徽章，可保存并查看最新文字');
  await page.keyboard.press('Escape');
  await setMode('browse');
  if (process.env.FEEDBACK_SCREENSHOT_PATH) {
    await page.screenshot({ path: resolve(process.env.FEEDBACK_SCREENSHOT_PATH) });
  }
  await clickMarker(commentChip);
  await page.waitForSelector('.pop [data-f=comment]', { visible: true });
  check(await page.$eval('.pop [data-f=comment]', input => input.value) === '请重写这段说明',
    '直接点击意见位置可查看完整意见正文');
  await page.click('.pop [data-x=del]');
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.comments) || '{}')['A-E1']);
  await frame().waitForSelector(commentChip, { hidden: true });
  check(Object.keys(await storage('comments')).length === 3, '直接删除元素意见并移除其位置徽章');

  await clickMarker(regionBadge);
  await page.waitForSelector('.pop [data-f=comment]', { visible: true });
  check(await page.$eval('.pop [data-f=comment]', input => input.value) === '区域意见需要清理',
    '直接点击区域位置可查看意见正文');
  await page.click('.pop [data-x=del]');
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.comments) || '{}')['A-01']);
  await frame().waitForSelector(regionBadge, { hidden: true });
  check(Object.keys(await storage('comments')).length === 2, '直接删除区域意见并移除其已填写标记');

  await clickMarker(editChip);
  await page.waitForSelector('.pop [data-act=restore-edit]', { visible: true });
  const editText = await page.$eval('.pop', panel => panel.textContent);
  check(editText.includes('Alpha') && editText.includes('Uncommitted final'), '直接点击改动位置可比较原文与修改后的文字');
  if (process.env.FEEDBACK_EDIT_SCREENSHOT_PATH) {
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.pop')).opacity === '1');
    await page.screenshot({ path: resolve(process.env.FEEDBACK_EDIT_SCREENSHOT_PATH) });
  }
  await page.click('.pop [data-act=restore-edit]');
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.edits) || '{}').a);
  await frame().waitForSelector(editChip, { hidden: true });
  check(await frame().$eval('#title', element => element.textContent.trim()) === 'Alpha' &&
    await frame().$eval('#unchanged', element => element.textContent.trim()) === 'Alpha',
  '逐条还原返回最初原文，重复原文元素不受影响并移除改动徽章');

  await openReview();
  check(await page.$eval('[data-f=review-scope]', select => select.value) === 'all', '计数按钮打开管理弹层，默认覆盖全部页面');
  await page.select('[data-f=review-scope]', 'page');
  await page.click('.feedback-manager [data-act=clear-comments]');
  await page.waitForSelector('[data-act=confirm-clear]', { visible: true });
  check(Object.keys(await storage('comments')).length === 2, '批量清空确认前保留意见');
  await page.keyboard.press('Escape');
  check(Object.keys(await storage('comments')).length === 2, '取消清空保留全部意见');
  await openReview();
  await page.select('[data-f=review-scope]', 'page');
  await confirmAction('clear-comments');
  check(Object.keys(await storage('comments')).join(',') === 'B-E1', '批量清空本页的孤立意见，保留其他页意见');
  await page.select('[data-f=review-scope]', 'all');
  await confirmAction('clear-comments');
  check(Object.keys(await storage('comments')).length === 0, '全部页面意见可确认后一并清空');

  await page.keyboard.press('Escape');
  await importFeedback(1);
  await importFeedback(0);
  const imported = (await storage('edits')).a;
  check(imported.length === 1 && imported[0].from === 'Alpha' && imported[0].to === 'Imported revision' &&
    await frame().$eval('#title', element => element.textContent.trim()) === 'Imported revision',
  '真实选择同一 JSON 反馈包导入两次，不产生重复改动');
  await clickMarker(editChip);
  await page.waitForSelector('.pop [data-act=restore-edit]', { visible: true });
  await page.click('.pop [data-act=restore-edit]');
  check(!Object.keys(await storage('edits')).length &&
    await frame().$eval('#title', element => element.textContent.trim()) === 'Alpha', '导入的改动可以逐条还原');

  await page.evaluate(() => localStorage.setItem(window.PROTO_CONFIG.storage.edits, JSON.stringify({ a: [
    { path: 'main>h1', from: 'Alpha', to: 'First', ts: '2026-10-05T10:00:00Z' },
    { path: 'main>h1', from: 'First', to: 'Second', ts: '2026-10-05T10:01:00Z' },
  ] })));
  await page.reload({ waitUntil: 'networkidle0' });
  await waitPage('a');
  check(await frame().$eval('#title', element => element.textContent.trim()) === 'Second' &&
    await frame().$$eval(editChip, chips => chips.length) === 1, '历史重复路径按顺序应用最终文字，位置只显示一个改动徽章');
  await clickMarker(editChip);
  await page.waitForSelector('.pop [data-act=restore-edit]', { visible: true });
  check(await page.$eval('.review-diff del', element => element.textContent) === 'Alpha' &&
    await page.$eval('.review-diff ins', element => element.textContent) === 'Second', '历史重复路径对照显示首条原文与最终文字');
  await page.click('.pop [data-act=restore-edit]');
  check(!Object.keys(await storage('edits')).length &&
    await frame().$eval('#title', element => element.textContent.trim()) === 'Alpha' &&
    await frame().$eval('#unchanged', element => element.textContent.trim()) === 'Alpha',
  '一次单条还原清除历史重复路径并恢复最初原文，不误改重复原文元素');

  await page.evaluate(() => localStorage.setItem(window.PROTO_CONFIG.storage.edits, JSON.stringify({ a: [
    { path: 'main>h1', from: 'Alpha', to: 'First', ts: '2026-10-05T10:00:00Z' },
    { path: 'main>h1', from: 'Alpha', to: 'Second', ts: '2026-10-05T10:01:00Z' },
  ] })));
  await frame().evaluate(() => window.__PB.applyEdits('a'));
  check(await frame().$eval('#title', element => element.textContent.trim()) === 'Second' &&
    await frame().$eval('#unchanged', element => element.textContent.trim()) === 'Alpha',
  '应用历史累计重复路径只修改目标标题，不误改相同原文的其他元素');
  const cumulativeRestored = await frame().evaluate(() => window.__PB.resetElement('a', 'main>h1'));
  check(cumulativeRestored && !Object.keys(await storage('edits')).length &&
    await frame().$eval('#title', element => element.textContent.trim()) === 'Alpha' &&
    await frame().$eval('#unchanged', element => element.textContent.trim()) === 'Alpha',
  '历史累计重复路径一次还原恢复初始文字并清空记录');

  await gotoPage('b');
  await editTitle('Shared');
  await gotoPage('a');
  await editTitle('Shared');
  await openReview();
  await page.select('[data-f=review-scope]', 'page');
  await confirmAction('restore-edits');
  const scopedEdits = await storage('edits');
  check(!scopedEdits.a && scopedEdits.b?.length === 1 &&
    await frame().$eval('#title', element => element.textContent.trim()) === 'Alpha',
  '批量还原本页保留其他文件的改动');
  await page.keyboard.press('Escape');
  await editTitle('Shared');
  await openReview();
  await page.select('[data-f=review-scope]', 'all');
  await confirmAction('restore-edits');
  await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.edits) || '{}')).length === 0);
  check(await frame().$eval('#title', element => element.textContent.trim()) === 'Alpha' &&
    await frame().$eval('#unchanged', element => element.textContent.trim()) === 'Alpha',
    '跨文件全部还原不会把 B 的原文错误写入当前 A');
  await gotoPage('b');
  check(await frame().$eval('#title', element => element.textContent.trim()) === 'Beta' &&
    await frame().$eval('#unchanged', element => element.textContent.trim()) === 'Beta', '切至另一文件后也恢复自己的原文');

  // 旧菜单入口也必须沿用安全的跨文件还原行为。
  await editTitle('Shared');
  await gotoPage('a');
  await editTitle('Shared');
  await page.click('#more');
  await page.click('[data-act=undo-all]');
  if (await page.$('[data-act=confirm-clear]')) await page.click('[data-act=confirm-clear]');
  await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.edits) || '{}')).length === 0);
  check(await frame().$eval('#title', element => element.textContent.trim()) === 'Alpha',
    '已有「还原全部页面改动」菜单不会混用其他页原文');

  for (const width of [900, 1000]) {
    await page.keyboard.press('Escape');
    await page.setViewport({ width, height: 800, deviceScaleFactor: 1 });
    check(await page.evaluate(() => {
      const bar = document.querySelector('#bar');
      const count = document.querySelector('#count');
      const rect = count.getBoundingClientRect();
      return getComputedStyle(count).display !== 'none' && rect.width > 0 && rect.height > 0 &&
        rect.left >= 0 && rect.right <= innerWidth && bar.scrollWidth <= bar.clientWidth;
    }), width + 'px 侧栏保持反馈计数可见，工具栏没有横向溢出');
    await openReview();
    check(!!await page.$('.feedback-manager'), width + 'px 侧栏可直接点击计数管理反馈');
  }
  await page.setViewport({ width: 720, height: 800, deviceScaleFactor: 1 });
  await openReview(true);
  check(await page.$eval('.feedback-manager', panel => {
    const bounds = panel.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
  }), '窄屏可通过更多菜单打开完整可见的管理面板');
  check(Object.keys(await storage('comments')).length === 0 &&
    Object.keys(await storage('edits')).length === 0 &&
    await frame().$$eval('.pbx-echip,.pbx-edit-chip,.pb-badge.filled', chips => chips.length) === 0,
  '清理完成后位置徽章与持久化存储均为空');
} catch (error) {
  failure = error;
  results.push('FAIL  ' + stage + ': ' + error.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise(resolveStop => server.once('close', resolveStop));
    server.kill();
    await stopped;
  }
  // 只清理本脚本 mkdtemp 返回的绝对路径，拒绝越界路径。
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
