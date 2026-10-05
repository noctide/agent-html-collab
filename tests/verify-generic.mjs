// verify-generic.mjs — Agent HTML Collab 通用冒烟(用 examples/demo,不依赖任何具体业务项目)
// 覆盖闭环:装载 → 编辑 → 切页 → 标注 → 右键协作菜单/还原 → 平移 → 双击菜单+撤销
//           → 弹层关闭 → 缩放+小地图 → 滚轮转发/原生滚动 → 发送反馈 → 落盘 → 回灌
// 用法: node tests/verify-generic.mjs
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');                 // agent-html-collab/
const FIX = join(ROOT, 'examples', 'demo');
const PORT = 8131;
const BASE = 'http://127.0.0.1:' + PORT;
const require = createRequire(import.meta.url);

/* ---------- 依赖与浏览器 ---------- */
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

/* ---------- 备份/还原 demo ---------- */
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

  browser = await puppeteer.launch({ executablePath: browserPath, headless: 'new', args: ['--no-first-run', '--disable-features=Translate', '--force-device-scale-factor=1'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 });
  await page.goto(BASE + '/studio', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => { const f = document.querySelector('#proto'); return f && f.contentWindow && f.contentWindow.__PB_BRIDGE; }, { timeout: 15000 });
  await sleep(500);
  const frame = page.frames().find(f => f !== page.mainFrame());

  /* ---------- 坐标助手:同源读 iframe 内元素,按缩放换算成工具层屏幕坐标 ---------- */
  const selPoint = async (sel, dx = 20, dy = 8) => {
    await page.evaluate((sel) => {
      const f = document.querySelector('#proto'), d = f.contentDocument, st = document.querySelector('#stage');
      const n = d.querySelector(sel); if (!n) return;
      const fr = f.getBoundingClientRect(), b = n.getBoundingClientRect();
      const s = fr.width / parseFloat(f.style.width);
      const y = fr.top + b.y * s, stR = st.getBoundingClientRect();
      if (y > stR.bottom - 60) st.scrollTop += y - (stR.bottom - 160);
      else if (y < stR.top + 30) st.scrollTop -= (stR.top + 30) - y;
    }, sel);
    return page.evaluate((sel, dx, dy) => {
      const f = document.querySelector('#proto'), d = f.contentDocument;
      const n = d.querySelector(sel); const b = n.getBoundingClientRect(), fr = f.getBoundingClientRect();
      const s = fr.width / parseFloat(f.style.width);
      return { x: fr.left + (b.x + dx) * s, y: fr.top + (b.y + dy) * s };
    }, sel, dx, dy);
  };
  async function setMode(m) {
    const on = await page.$eval('#bar [data-x=m-' + m + ']', el => el.classList.contains('on'));
    if (!on) await page.click('#bar [data-x=m-' + m + ']');
    await sleep(300);
  }
  async function clickInFrame(sel) {
    await frame.evaluate((sel) => {
      const n = document.querySelector(sel); const r = n.getBoundingClientRect();
      n.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.x + 2, clientY: r.y + 2 }));
    }, sel);
    await sleep(150);
  }
  async function dblclickInFrame(sel) {
    await frame.evaluate((sel) => {
      const n = document.querySelector(sel); const r = n.getBoundingClientRect();
      n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.x + 4, clientY: r.y + 4 }));
    }, sel);
  }
  async function editSave(sel, text) {
    await setMode('edit');
    await clickInFrame(sel);
    await frame.evaluate((t) => { try { document.execCommand('insertText', false, t); } catch (e) {} }, text);
    await sleep(80);
    await frame.evaluate(() => { const ae = document.activeElement; if (ae && ae.blur) ae.blur(); });
    await sleep(250);
  }
  const err = async (sel) => { try { return await frame.$eval(sel, n => n.textContent.trim()); } catch (e) { return ''; } };

  /* ---------- 装载 ---------- */
  t(await page.evaluate(() => !!document.querySelector('#bar .seg')), '装载:顶栏渲染');
  t(await page.evaluate(() => document.getElementById('brand-title').textContent) === 'Agent HTML Collab · 人机协同', '装载:工具品牌不被项目标题覆盖');
  t(await page.$$eval('#page-sel option', a => a.length) === 3, '装载:页面清单来自 config(3 页)');
  t((await frame.$eval('.pg-sec.act', s => s.dataset.page)) === 'p01', '装载:默认活动页 p01');

  /* ---------- 协同通知开关 ---------- */
  t((await page.$('#notify')) !== null, '通知:开关按钮就位');
  await page.click('#notify'); await sleep(80);
  t(await page.evaluate(() => localStorage.getItem('proto.notify') === '"0"' && document.getElementById('notify').getAttribute('aria-checked') === 'false' && document.getElementById('notify').classList.contains('off') && document.getElementById('notify').textContent === ''), '通知:关闭并保存状态，开关不显示重复文案');
  await page.click('#notify'); await sleep(80);
  t(await page.evaluate(() => document.getElementById('notify').getAttribute('aria-checked') === 'true' && !document.getElementById('notify').classList.contains('off')), '通知:再点恢复开');

  /* ---------- 编辑 ---------- */
  await setMode('edit');
  t(await frame.evaluate(() => document.body.classList.contains('pbx-edit')), '编辑:模式同步进 iframe');
  await clickInFrame('#demo-title');
  await frame.evaluate(() => { try { document.execCommand('insertText', false, '改版'); } catch (e) {} });
  await sleep(80);
  await frame.evaluate(() => { const ae = document.activeElement; if (ae && ae.blur) ae.blur(); });
  await sleep(250);
  t((await err('#demo-title')).includes('改版'), '编辑:就地改字生效', await err('#demo-title'));
  t(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('proto.edits') || '{}')).reduce((a, b) => a + b.length, 0)) >= 1, '编辑:改动入库');

  // Esc 还原:不落库
  await setMode('edit');
  await clickInFrame('#demo-sub');
  await frame.evaluate(() => { try { document.execCommand('insertText', false, '临时'); } catch (e) {} });
  await frame.evaluate(() => { const ae = document.activeElement; ae.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  await sleep(250);
  t(!(await err('#demo-sub')).includes('临时'), '编辑:Esc 还原', await err('#demo-sub'));

  // 制造一个可还原的改动(给右键菜单用)
  await editSave('#demo-sub', 'ABC');

  /* ---------- 切页(auto 内核切换器) ---------- */
  await setMode('browse');
  await page.select('#page-sel', 'p02'); await sleep(350);
  t((await frame.$eval('.pg-sec.act', s => s.dataset.page)) === 'p02', '切页:下拉 → p02');
  await page.select('#page-sel', 'p03'); await sleep(300);
  t((await frame.$eval('.pg-sec.act', s => s.dataset.page)) === 'p03', '切页:下拉 → p03');
  await page.select('#page-sel', 'p01'); await sleep(300);
  t((await frame.$eval('.pg-sec.act', s => s.dataset.page)) === 'p01', '切页:切回 p01');

  /* ---------- 标注:元素意见 ---------- */
  await setMode('anno');
  await sleep(500);
  await clickInFrame('#demo-sub');
  await page.waitForFunction(() => !!document.querySelector('.pop .elinfo'), { timeout: 4000 }).catch(() => {});
  t(await page.$('.pop .elinfo') !== null, '标注:拾取表单弹在工具层');
  await page.type('.pop [data-f=comment]', '这句说明再短一点');
  await page.type('.pop [data-f=author]', '验收员');
  await page.click('.pop [data-x=save]');
  await sleep(300);
  t(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('proto.anno.comments') || '{}')).length) >= 1, '标注:元素意见入库');
  t(await frame.evaluate(() => document.querySelectorAll('.pbx-echip').length) >= 1, '标注:iframe 内意见徽章');

  /* ---------- 右键协作菜单 + 还原此元素 ---------- */
  await setMode('browse');
  const sp = await selPoint('#demo-sub', 30, 8);
  await page.mouse.click(sp.x, sp.y, { button: 'right' });
  t(await page.$('.pop .mi') !== null, '协作菜单:右键轻点弹出');
  await page.click('.pop [data-act=revert]');
  await sleep(300);
  t(!(await err('#demo-sub')).includes('ABC'), '协作菜单:还原此元素', await err('#demo-sub'));
  await page.evaluate(() => document.querySelector('#proto').contentDocument.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));

  /* ---------- 右键拖动平移(且不弹菜单) ---------- */
  await page.evaluate(() => { const st = document.querySelector('#stage'); st.scrollTop = 0; st.scrollLeft = 0; });
  const s0 = await page.evaluate(() => { const st = document.querySelector('#stage'); return [st.scrollLeft, st.scrollTop]; });
  const pp = await selPoint('#demo-title', 30, 8);
  await page.mouse.move(pp.x, pp.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(pp.x - 200, pp.y - 140, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await sleep(200);
  const s1 = await page.evaluate(() => { const st = document.querySelector('#stage'); return [st.scrollLeft, st.scrollTop]; });
  const moved = (s1[0] - s0[0]) + (s1[1] - s0[1]);
  t(moved > 60 && !(await page.$('.pop')), '交互:右键拖动平移且不出菜单', JSON.stringify([s0, s1]));

  /* ---------- 双击菜单 → 编辑 → 保存 → 撤销 ---------- */
  await page.evaluate(() => { const st = document.querySelector('#stage'); st.scrollTop = 0; st.scrollLeft = 0; });
  await dblclickInFrame('#demo-sub');
  t(await page.$('.pop .mi') !== null, '协作菜单:双击弹出');
  await page.click('.pop [data-act=edit]');
  await sleep(350);
  await frame.evaluate(() => { try { document.execCommand('insertText', false, '再改'); } catch (e) {} });
  await sleep(80);
  await page.click('#zoom-out');                     // 点工具栏触发 iframe 失焦保存
  await sleep(300);
  t((await err('#demo-sub')).includes('再改'), '协作菜单:进入就地编辑并保存', await err('#demo-sub'));
  await page.click('#more');
  await page.click('.pop [data-act=undo-last]');
  await sleep(300);
  t(!(await err('#demo-sub')).includes('再改'), '操作菜单:撤销上一次改动');

  /* ---------- 弹层关闭 ---------- */
  await setMode('browse');
  const openMenu = async () => { await dblclickInFrame('#demo-sub'); await page.waitForFunction(() => !!document.querySelector('.pop'), { timeout: 3000 }).catch(() => {}); };
  await openMenu();
  await page.keyboard.press('Escape');
  t(await page.$('.pop') === null, '弹层:Esc 收掉');
  await openMenu();
  t(await page.$('.pop .x') !== null, '弹层:协作菜单✕按钮');
  await page.click('.pop .x');
  t(await page.$('.pop') === null, '弹层:✕ 收掉');
  await openMenu();
  await page.evaluate(() => document.querySelector('#proto').contentDocument.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
  await sleep(150);
  t(await page.$('.pop') === null, '弹层:iframe 内按下收掉');

  /* ---------- 缩放 + 小地图 ---------- */
  await page.select('#zoom-sel', '0.5'); await sleep(200);
  const tr = await page.$eval('#proto', el => el.style.transform);
  t(tr === 'scale(0.5)' && await page.$eval('#mmap .vp', el => !!el.style.width), '视图:缩放 50% + 小地图视口框', tr);
  const mmVar = await page.evaluate(() => { const c = document.querySelector('#mmap-thumb .pg-sec'); return c ? getComputedStyle(c).getPropertyValue('--blue') : ''; });
  t(!!mmVar.trim(), '视图:小地图缩略图样式生效', mmVar);

  /* ---------- 滚轮转发 + 原生滚动 + 小地图定位 ---------- */
  await page.select('#zoom-sel', '1'); await sleep(250);
  await page.evaluate(() => { const st = document.querySelector('#stage'); st.scrollTop = 0; st.scrollLeft = 0; });
  const wp = await selPoint('#demo-title', 30, 8);
  await page.mouse.move(wp.x, wp.y);
  await page.mouse.wheel({ deltaY: 240 });
  await sleep(200);
  t(await page.evaluate(() => document.querySelector('#stage').scrollTop) > 100, '滚动:滚轮转发舞台');
  t(await page.evaluate(() => { const st = document.querySelector('#stage'); return getComputedStyle(st).overflowY === 'auto' && st.scrollHeight > st.clientHeight; }), '滚动:舞台原生滚动通道就位');
  await page.evaluate(() => { document.querySelector('#stage').scrollTop = 0; });
  const mb = await (await page.$('#mmap-body')).boundingBox();
  await page.mouse.click(mb.x + mb.width / 2, mb.y + mb.height - 8);
  await sleep(200);
  t(await page.evaluate(() => document.querySelector('#stage').scrollTop) > 100, '滚动:点击小地图定位跳转');

  /* ---------- 发送反馈 → 落盘(常驻) ---------- */
  await page.click('#send');
  t(await page.$('.pop .sum') !== null, '反馈:发送确认弹层');
  await page.click('.pop [data-x=ok]');
  let feedFile = null;
  for (let i = 0; i < 30 && !feedFile; i++) {
    await sleep(300);
    const dir = join(FIX, 'feedback');
    if (existsSync(dir)) { const hit = readdirSync(dir).filter(f => /^feedback-.*\.json$/.test(f)).sort().pop(); if (hit) { const st = statSync(join(dir, hit)); if (Date.now() - st.mtimeMs < 15000) feedFile = hit; } }
  }
  t(!!feedFile, '反馈:落盘 feedback/*.json', feedFile || '无');
  t(server.exitCode === null, '反馈:服务默认常驻(未退出)');
  if (feedFile) {
    const fb = JSON.parse(readFileSync(join(FIX, 'feedback', feedFile), 'utf8'));
    t(fb.v === 2 && fb.comments.length >= 1 && fb.edits.length >= 1, '反馈:schema v2 且意见/改动齐全', JSON.stringify(fb.summary));
  }
  await page.close();

  /* ---------- 回灌 → 报告 + 备份 + 写回 + 归包 ---------- */
  if (feedFile) {
    const apply = spawn(process.execPath, [join(ROOT, 'studio', 'apply.mjs'), 'latest', '--root', FIX, '--apply'], { stdio: 'pipe' });
    let applyLog = '';
    apply.stdout.on('data', d => applyLog += d);
    apply.stderr.on('data', d => applyLog += d);
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

console.log('\n===== Agent HTML Collab 通用冒烟(examples/demo)=====\n' + results.join('\n'));
const fails = results.filter(r => r.startsWith('FAIL')).length;
console.log(fails ? '\n⚠️ ' + fails + ' 项失败\n' : '\n✅ ' + results.length + ' 项全部通过\n');
if (fails) console.log('server log:\n' + serverLog.split('\n').filter(l => l.includes('[serve]') || l.includes('[feedback]')).join('\n'));
process.exit(fails ? 1 : 0);
