// verify-single.mjs — 单文档模式冒烟(用 examples/single)
// 覆盖:装载 → 编辑 → 标注意见 → 发送反馈 → 落盘 → 回灌(备份/报告/写回)
// 用法: node tests/verify-single.mjs
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FIX = join(ROOT, 'examples', 'single');
const PORT = 8133;
const BASE = 'http://127.0.0.1:' + PORT;
const require = createRequire(import.meta.url);

function loadPuppeteer() {
  const tries = [() => require('puppeteer-core')];
  for (const p of [join(ROOT, 'node_modules'), join(process.cwd(), 'node_modules'), process.env.PUPPETEER_CORE_MODULES].filter(Boolean)) {
    tries.push(() => createRequire(join(p, 'noop.js'))('puppeteer-core'));
  }
  for (const t of tries) { try { return t(); } catch (e) {} }
  throw new Error('未找到 puppeteer-core,请先 npm install');
}
const puppeteer = loadPuppeteer();
const browserPath = process.env.PUPPETEER_EXECUTABLE_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
].find(existsSync);

const results = [];
function t(ok, name, extra) { results.push((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  | ' + extra : '')); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PROTO = join(FIX, 'proto.html');
const PROTO_BAK = join(FIX, 'proto.html.verifybak');
copyFileSync(PROTO, PROTO_BAK);
function restore() {
  try { copyFileSync(PROTO_BAK, PROTO); } catch (e) {}
  try { rmSync(PROTO_BAK); } catch (e) {}
  try { rmSync(join(FIX, 'feedback'), { recursive: true, force: true }); } catch (e) {}
  try { rmSync(join(FIX, 'backup'), { recursive: true, force: true }); } catch (e) {}
}

const server = spawn(process.execPath, [join(ROOT, 'studio', 'serve.mjs'), '--root', FIX, '--port', String(PORT)], { stdio: 'pipe' });
let serverLog = '';
server.stdout.on('data', d => serverLog += d);
server.stderr.on('data', d => serverLog += d);
let browser = null;
try {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { await sleep(250); up = await fetch(BASE + '/api/ping').then(r => r.ok).catch(() => false); }
  t(up, '服务:/api/ping 就绪');

  browser = await puppeteer.launch({ executablePath: browserPath, headless: 'new', args: ['--no-first-run', '--force-device-scale-factor=1'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
  await page.goto(BASE + '/studio', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => { const f = document.querySelector('#proto'); return f && f.contentWindow && f.contentWindow.__PB_BRIDGE; }, { timeout: 15000 });
  await sleep(500);
  const frame = page.frames().find(f => f !== page.mainFrame());

  t(await page.evaluate(() => !!document.querySelector('#bar #edit-pick')), '装载:顶栏渲染');
  t(await page.evaluate(() => document.getElementById('proj-entry').getAttribute('aria-label').split(' · ')[0]) === 'Agent HTML Collab', '装载:工具品牌不被项目标题覆盖');
  t(await page.$$eval('#page-sel option', a => a.length) === 1, '装载:单文档页清单 1 项');
  t(await page.$eval('#page-sel', s => s.value) === 'page', '装载:当前页 = defaultId');
  t(await page.evaluate(() => getComputedStyle(document.getElementById('mmap')).display !== 'none' && document.querySelector('#mmap-thumb iframe[data-minimap]')?.contentDocument?.querySelector('#s-title')?.textContent === document.querySelector('#proto').contentDocument.querySelector('#s-title').textContent), '装载:单文档小地图显示整页内容');

  let wantedAction = 'browse';
  async function setMode(m) { wantedAction = m; if (m === 'browse') await page.keyboard.press('Escape'); }

  async function clickInFrame(sel) {
    await frame.evaluate((sel) => {
      const n = document.querySelector(sel); const r = n.getBoundingClientRect();
      n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 2, clientY: r.y + 2 }));
    }, sel);
    await page.waitForSelector('.element-menu');
    await page.click('.element-menu [data-act=' + (wantedAction === 'anno' ? 'anno' : 'edit') + ']'); if (wantedAction === 'edit') await frame.click(sel);
    wantedAction = 'browse';
    await sleep(150);
  }
  const txt = async (sel) => { try { return await frame.$eval(sel, n => n.textContent.trim()); } catch (e) { return ''; } };

  await setMode('edit');
  await clickInFrame('#s-title');
  t(await frame.evaluate(() => document.body.classList.contains('pbx-move')), '编辑:局部修改进入 iframe');
  await frame.evaluate(() => { try { document.execCommand('insertText', false, '改版'); } catch (e) {} });
  await sleep(80);
  await frame.evaluate(() => { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  await sleep(250);
  t((await txt('#s-title')).includes('改版'), '编辑:就地改字生效', await txt('#s-title'));
  t(await page.evaluate(() => 'page' in JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.edits) || '{}')), '编辑:改动记录在 defaultId 下');

  await setMode('anno');
  await sleep(400);
  await clickInFrame('#s-intro');
  await page.waitForFunction(() => !!document.querySelector('.pop .elinfo'), { timeout: 4000 }).catch(() => {});
  t(await page.$('.pop .elinfo') !== null, '标注:拾取表单弹出');
  await page.type('.pop [data-f=comment]', '措辞再正式一点');
  await page.click('.pop [data-x=save]');
  await sleep(300);
  t(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.comments) || '{}')).length) >= 1, '标注:元素意见入库');

  await page.click('#send');
  await page.click('.pop [data-x=ok]');
  let feedFile = null;
  for (let i = 0; i < 30 && !feedFile; i++) {
    await sleep(300);
    const dir = join(FIX, 'feedback');
    if (existsSync(dir)) { const hit = readdirSync(dir).filter(f => /^feedback-.*\.json$/.test(f)).sort().pop(); if (hit) { const st = statSync(join(dir, hit)); if (Date.now() - st.mtimeMs < 15000) feedFile = hit; } }
  }
  t(!!feedFile, '反馈:落盘 feedback/*.json', feedFile || '无');
  if (feedFile) {
    const fb = JSON.parse(readFileSync(join(FIX, 'feedback', feedFile), 'utf8'));
    t(fb.v === 2 && fb.comments.length >= 1 && fb.edits.length >= 1, '反馈:schema v2 齐全', JSON.stringify(fb.summary));
  }
  await page.close();

  if (feedFile) {
    const apply = spawn(process.execPath, [join(ROOT, 'studio', 'apply.mjs'), 'latest', '--root', FIX, '--apply'], { stdio: 'pipe' });
    let applyLog = ''; apply.stdout.on('data', d => applyLog += d); apply.stderr.on('data', d => applyLog += d);
    await new Promise(r => apply.on('close', r));
    t(existsSync(join(FIX, 'feedback', 'done', feedFile)), '回灌:反馈包移入 feedback/done/');
    t(readdirSync(join(FIX, 'feedback')).some(f => /^report-.*\.md$/.test(f)), '回灌:生成 report-*.md');
    t(existsSync(join(FIX, 'backup')), '回灌:生成 backup/');
    t(readFileSync(PROTO, 'utf8').includes('改版'), '回灌:改动已写回 proto.html');
  }
} catch (e) {
  t(false, '流程异常', String(e && e.message || e).slice(0, 160));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server.exitCode === null) server.kill();
  restore();
}

console.log('\n===== Agent HTML Collab 单文档冒烟(examples/single)=====\n' + results.join('\n'));
const fails = results.filter(r => r.startsWith('FAIL')).length;
console.log(fails ? '\n⚠️ ' + fails + ' 项失败\n' : '\n✅ ' + results.length + ' 项全部通过\n');
if (fails) console.log('server log:\n' + serverLog.split('\n').filter(l => l.includes('[serve]') || l.includes('[feedback]')).join('\n'));
process.exit(fails ? 1 : 0);
