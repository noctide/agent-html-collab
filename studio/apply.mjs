// apply.mjs — Agent HTML Collab 反馈回灌(契约 + CLI,运行时层 ①)
//
// 用法:
//   node studio/apply.mjs [feedback.json|latest] [--config <path>] [--root <dir>] [--apply]
//
// 契约(见 SPEC §3.4):
//   内核负责:备份 → 定位源码 → 文本兜底匹配 → 写回 → 出报告 → 移动反馈包
//   项目可选提供适配器(config.apply.adapter),导出:
//     export function plans({ feedback, config, projectRoot }) => {
//       edits:    [{ record, file, from, to }]   // file 相对 projectRoot
//       comments: [{ comment, file, line }]      // 定位提示(不自动改)
//     }
//   没有适配器时,内核用 config(source/pages.list/apply.map)自行定位。
// 默认只出报告,不改源码;加 --apply 才写回并备份、归包到 feedback/done/。
import { parseArgs } from './cli-args.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, renameSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KERNEL = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(KERNEL, '..');

const ARGS = parseArgs(process.argv.slice(2));

export function loadConfig(projectRoot, configPath) {
  const p = configPath ? resolve(configPath) : [join(projectRoot, 'proto.config.json'), join(PKG_ROOT, 'studio/proto.config.json')].find(existsSync);
  return p && existsSync(p) ? { config: JSON.parse(readFileSync(p, 'utf8')), configPath: p } : { config: {}, configPath: null };
}

function rel(root, full) { return relative(root, full).split(sep).join('/'); }
export function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

/* ---------- 反馈包选择 ---------- */
export function pickFeedback(feedbackDir, target) {
  if (target && target !== 'latest') return resolve(target);
  const list = existsSync(feedbackDir) ? readdirSync(feedbackDir).filter(f => /^feedback-.*\.json$/.test(f)).sort() : [];
  if (!list.length) throw new Error('feedbackDir 下没有反馈包: ' + feedbackDir);
  return join(feedbackDir, list[list.length - 1]);
}

/* ---------- 通用定位:page → 源码文件 ---------- */
export function locatePageFile(config, projectRoot, page) {
  const apply = config.apply || {};
  if (apply.map) {
    const mp = resolve(projectRoot, apply.map);
    if (existsSync(mp)) {
      try { const j = JSON.parse(readFileSync(mp, 'utf8')); const pg = j.pages && j.pages[page]; if (pg && pg.file) return pg.file; } catch (e) {}
    }
  }
  const list = (config.pages && config.pages.list) || [];
  const hit = list.find(p => p.id === page);
  if (hit && hit.file) return hit.file;
  const src = config.source || {};
  if (src.mode === 'single' && src.file) return src.file;
  if (src.mode === 'pages' && src.dir) {
    const dir = resolve(projectRoot, src.dir);
    if (existsSync(dir)) { const f = readdirSync(dir).find(x => x.startsWith(page)); if (f) return join(src.dir, f).split(sep).join('/'); }
  }
  return null;
}

/* ---------- 通用 plan 生成 ---------- */
function genericPlans({ feedback, config, projectRoot }) {
  const edits = (feedback.edits || []).map((record) => {
    const file = locatePageFile(config, projectRoot, record.page);
    return { record, file, from: record.from, to: record.to };
  });
  const comments = (feedback.comments || []).map((comment) => {
    const apply = config.apply || {};
    if (apply.map) {
      const mp = resolve(projectRoot, apply.map);
      if (existsSync(mp)) {
        try {
          const j = JSON.parse(readFileSync(mp, 'utf8')); const pg = j.pages && j.pages[comment.page];
          if (pg) { const reg = (pg.regions || []).find(r => r.id === comment.id); if (reg) return { comment, file: pg.file, line: reg.line }; }
        } catch (e) {}
      }
    }
    const file = locatePageFile(config, projectRoot, comment.page);
    return { comment, file, line: null };
  });
  return { edits, comments };
}

async function adapterPlans(config, projectRoot, ctx) {
  const rel0 = config.apply && config.apply.adapter;
  if (!rel0) return null;
  const candidates = [resolve(projectRoot, rel0), resolve(dirname(config.__path || projectRoot), rel0), resolve(PKG_ROOT, rel0), resolve(rel0)];
  const p = candidates.find(existsSync);
  if (!p) { console.warn('[apply] 适配器不存在,改用内核定位: ' + rel0); return null; }
  const mod = await import(pathToFileURL(p).href);
  const fn = mod.plans || mod.default || mod.resolve;
  if (typeof fn !== 'function') { console.warn('[apply] 适配器未导出 plans(): ' + p); return null; }
  return await fn(ctx);
}

/* ---------- 文本定位 ---------- */
export function locateText(src, from) {
  if (!from) return null;
  const hit = src.indexOf(from);
  if (hit >= 0) return { index: hit, length: from.length, exact: true };
  const segs = norm(from).split(' ').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(segs.join('\\s*(?:<[^>]+>)?\\s*'));
  const m = src.match(re);
  return m ? { index: m.index, length: m[0].length, exact: false } : null;
}

/* ---------- 主流程 ---------- */
export async function applyFeedback({ feedback, config, projectRoot, apply = false, stamp }) {
  projectRoot = resolve(projectRoot);
  stamp = stamp || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const feedbackDir = resolve(projectRoot, (config.server && config.server.feedbackDir) || 'feedback/');
  const backupRoot = resolve(projectRoot, (config.apply && config.apply.backupDir) || 'backup/');
  const reportPath = join(feedbackDir, 'report-' + stamp + '.md');

  const ctx = { feedback, config, projectRoot };
  config.__path = config.__path || join(projectRoot, 'proto.config.json');
  const plans = (await adapterPlans(config, projectRoot, ctx)) || genericPlans(ctx);

  /* 备份:所有被 plan 引用的文件 */
  const touched = new Set();
  plans.edits.forEach(e => e.file && touched.add(e.file));
  plans.comments.forEach(c => c.file && touched.add(c.file));
  let backupDir = null;
  if (apply && touched.size) {
    backupDir = join(backupRoot, stamp);
    for (const f of touched) {
      const full = resolve(projectRoot, f);
      if (!existsSync(full) || !statSync(full).isFile()) continue;
      const dest = join(backupDir, f);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(full, dest);
    }
    console.log('[apply] 已备份 ' + touched.size + ' 个源文件 → ' + rel(projectRoot, backupDir) + '/');
  }

  /* 执行 edits:仅"精确命中"自动写回;模糊命中只定位、请人工核对(最小侵入) */
  const applied = [], skipped = [];
  for (const plan of plans.edits) {
    const { record } = plan;
    if (!plan.file) { skipped.push({ record, reason: '页面未映射到源码文件' }); continue; }
    const full = resolve(projectRoot, plan.file);
    if (!existsSync(full)) { skipped.push({ record, reason: '源文件不存在: ' + plan.file }); continue; }
    const src = readFileSync(full, 'utf8');
    const loc = locateText(src, record.from);
    if (!loc) { skipped.push({ record, file: plan.file, reason: '原文未匹配(元素路径 ' + record.path + ')' }); continue; }
    const line = src.slice(0, loc.index).split('\n').length;
    if (!loc.exact) { skipped.push({ record, file: plan.file, line, fuzzy: true, reason: '原文非精确匹配(可能跨标签/已重构),需人工核对' }); continue; }
    if (apply) {
      const next = src.slice(0, loc.index) + record.to + src.slice(loc.index + loc.length);
      writeFileSync(full, next);
    }
    applied.push({ record, file: plan.file, line, exact: true });
  }

  /* 报告 */
  const lines = ['# 反馈回灌报告', '', '反馈包: ' + basename(feedback.__file || 'feedback.json') + '  生成: ' + (feedback.generatedAt || '?'), '',
    '| # | 页 | 原文 | 改后 | 定位 |', '|---|---|---|---|---|'];
  plans.edits.forEach((plan, i) => {
    const hit = applied.find(a => a.record === plan.record);
    const miss = skipped.find(s => s.record === plan.record);
    let loc = '❌ ' + (miss ? miss.reason : '未处理');
    if (miss && miss.file) loc = '⚠️ ' + miss.file + ':' + (miss.line || '?') + ' ' + miss.reason;
    if (hit) loc = '✅ ' + hit.file + ':' + hit.line;
    lines.push('| ' + (i + 1) + ' | ' + (plan.record.page || '') + ' | ' + norm(plan.record.from).slice(0, 30) + ' | ' + norm(plan.record.to).slice(0, 30) + ' | ' + loc + ' |');
  });
  lines.push('', '## 意见(comments,需 Agent 逐条处理)', '', '| 编号 | 页 | 区域 | 类型 | 优先级 | 意见 | 提出人 | 定位 |', '|---|---|---|---|---|---|---|---|');
  plans.comments.forEach(({ comment, file, line }) => {
    const loc = file ? file + (line ? ':' + line : '') : '—';
    lines.push('| ' + (comment.id || '') + ' | ' + (comment.page || '') + ' | ' + norm(comment.region).slice(0, 24) + ' | ' + (comment.type || '') + ' | ' + (comment.priority || '') + ' | ' + norm(comment.comment).slice(0, 60) + ' | ' + (comment.author || '') + ' | ' + loc + ' |');
  });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, lines.join('\n') + '\n');

  /* 归包 */
  let movedTo = null;
  if (apply && feedback.__file && existsSync(feedback.__file)) {
    const doneDir = join(feedbackDir, 'done');
    mkdirSync(doneDir, { recursive: true });
    movedTo = join(doneDir, basename(feedback.__file));
    try { renameSync(feedback.__file, movedTo); } catch (e) { movedTo = null; }
  }

  return { applied, skipped, comments: plans.comments, backupDir, reportPath, movedTo };
}

/* ============================================================
   CLI
   ============================================================ */
async function main() {
  const projectRoot = resolve(ARGS.root || process.cwd());
  const { config, configPath } = loadConfig(projectRoot, ARGS.config);
  if (configPath) config.__path = configPath;
  const feedbackDir = resolve(projectRoot, (config.server && config.server.feedbackDir) || 'feedback/');
  const target = pickFeedback(feedbackDir, ARGS._[0] || 'latest');
  const feedback = JSON.parse(readFileSync(target, 'utf8'));
  feedback.__file = target;
  const apply = !!ARGS.apply;
  const r = await applyFeedback({ feedback, config, projectRoot, apply });
  console.log('[apply] 意见 ' + r.comments.length + ' 条 / 改动 ' + (feedback.edits || []).length + ' 处;自动命中 ' + r.applied.length + ',需人工 ' + r.skipped.length);
  console.log('[apply] 报告 → ' + rel(projectRoot, r.reportPath));
  if (apply) console.log('[apply] 已写回源码' + (r.movedTo ? ',反馈包已移入 ' + rel(projectRoot, r.movedTo) : '') + ';请刷新 studio 核对');
  else console.log('[apply] 预览模式(未改源码);确认后加 --apply 执行');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('[apply] 失败:', e.message); process.exit(1); });
}
