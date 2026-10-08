// verify-multi.mjs — 多文件(每文件整页)模式冒烟
// 覆盖:装载 → 页清单 → 编辑 A → 切页 → 编辑 B(各自定位)→ 发送反馈 → 落盘 → 回灌
// 用法: node tests/verify-multi.mjs   (需要 examples/multi/proto.config.json)
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FIX = join(ROOT, 'examples', 'multi');
const PORT = 8135;
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

const PROTO_A = join(FIX, 'a.html');
const PROTO_B = join(FIX, 'b.html');
const BAK_A = join(FIX, 'a.html.verifybak');
const BAK_B = join(FIX, 'b.html.verifybak');
copyFileSync(PROTO_A, BAK_A);
copyFileSync(PROTO_B, BAK_B);
function restore() {
  try { copyFileSync(BAK_A, PROTO_A); } catch (e) {}
  try { copyFileSync(BAK_B, PROTO_B); } catch (e) {}
  try { rmSync(BAK_A); } catch (e) {}
  try { rmSync(BAK_B); } catch (e) {}
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
  const reframe = () => page.frames().find(f => f !== page.mainFrame());

  t(await page.evaluate(() => !!document.querySelector('#bar .seg')), '装载:顶栏渲染');
  t(await page.evaluate(() => document.getElementById('brand-title').textContent) === 'Agent HTML Collab · 人机协同', '装载:工具品牌不被项目标题覆盖');
  t(await page.$$eval('#page-sel option', a => a.length) === 2, '装载:页清单 2 项');
  t(await page.$eval('#page-sel', s => s.value) === 'a', '装载:当前页 = a');
  t((await reframe().$eval('#a-title', n => n.textContent.trim())).includes('文件 A'), '装载:默认载入 a.html');

  async function setMode(m) {
    const on = await page.$eval('#bar [data-x=m-' + m + ']', el => el.classList.contains('on'));
    if (!on) await page.click('#bar [data-x=m-' + m + ']');
    await sleep(300);
  }
  async function editSel(sel, text) {
    await setMode('edit');
    const frame = reframe();
    await frame.evaluate((sel) => {
      const n = document.querySelector(sel); const r = n.getBoundingClientRect();
      n.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.x + 2, clientY: r.y + 2 }));
    }, sel);
    await frame.evaluate((t) => { try { document.execCommand('insertText', false, t); } catch (e) {} }, text);
    await sleep(80);
    await frame.evaluate(() => { const ae = document.activeElement; if (ae && ae.blur) ae.blur(); });
    await sleep(250);
  }
  const txt = async (sel) => { try { return await reframe().$eval(sel, n => n.textContent.trim()); } catch (e) { return ''; } };

  /* ---------- 编辑 A ---------- */
  await editSel('#a-title', '改版A');
  t((await txt('#a-title')).includes('改版A'), '编辑:改 a.html 生效', await txt('#a-title'));
  t(await page.evaluate(() => 'a' in JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.edits) || '{}')), '编辑:改动记在页 a 下');

  /* ---------- 切页 A → B ---------- */
  await setMode('browse');
  await page.select('#page-sel', 'b');
  await page.waitForFunction(() => { try { const f = document.querySelector('#proto'); return !!(f.contentDocument && f.contentDocument.querySelector('#b-title')); } catch (e) { return false; } }, { timeout: 10000 }).catch(() => {});
  await sleep(400);
  t(await page.$eval('#page-sel', s => s.value) === 'b', '切页:下拉 → b');
  t((await txt('#b-title')).includes('文件 B'), '切页:载入 b.html');

  /* ---------- 编辑 B ---------- */
  await editSel('#b-title', '改版B');
  t((await txt('#b-title')).includes('改版B'), '编辑:改 b.html 生效', await txt('#b-title'));
  t(await page.evaluate(() => 'b' in JSON.parse(localStorage.getItem(window.PROTO_CONFIG.storage.edits) || '{}')), '编辑:改动记在页 b 下');

  /* ---------- 发送反馈 → 落盘 ---------- */
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
    const pages = (fb.edits || []).map(e => e.page).sort();
    t(fb.v === 2 && pages.join(',') === 'a,b', '反馈:两条改动分属页 a/b', JSON.stringify(pages));
  }
  await page.close();

  /* ---------- 回灌 ---------- */
  if (feedFile) {
    const apply = spawn(process.execPath, [join(ROOT, 'studio', 'apply.mjs'), 'latest', '--root', FIX, '--apply'], { stdio: 'pipe' });
    let applyLog = ''; apply.stdout.on('data', d => applyLog += d); apply.stderr.on('data', d => applyLog += d);
    await new Promise(r => apply.on('close', r));
    t(existsSync(join(FIX, 'feedback', 'done', feedFile)), '回灌:反馈包移入 feedback/done/');
    t(readdirSync(join(FIX, 'feedback')).some(f => /^report-.*\.md$/.test(f)), '回灌:生成 report-*.md');
    t(readFileSync(PROTO_A, 'utf8').includes('改版A'), '回灌:a.html 已写回');
    t(readFileSync(PROTO_B, 'utf8').includes('改版B'), '回灌:b.html 已写回');
  }
} catch (e) {
  t(false, '流程异常', String(e && e.message || e).slice(0, 160));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server.exitCode === null) server.kill();
  restore();
}

console.log('\n===== Agent HTML Collab 多文件冒烟(examples/multi)=====\n' + results.join('\n'));
const fails = results.filter(r => r.startsWith('FAIL')).length;
console.log(fails ? '\n⚠️ ' + fails + ' 项失败\n' : '\n✅ ' + results.length + ' 项全部通过\n');
if (fails) console.log('server log:\n' + serverLog.split('\n').filter(l => l.includes('[serve]') || l.includes('[feedback]')).join('\n'));
process.exit(fails ? 1 : 0);
