// init.mjs — 扫描目录并生成 proto.config.json(免手写配置)
//
// 用法:
//   node studio/init.mjs [--root <目录>] [--force]
//
// 规则:
//   - 根下只有 1 个 HTML → single 模式(整页一页);
//   - 根下多个 HTML       → pages 模式 + pages.singlePerFile(每文件整页);
//   - 已存在 proto.config.json 时不覆盖,除非 --force。
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import net from 'node:net';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const [k, v] = t.slice(2).split('=');
      a[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v != null ? v : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    } else a._.push(t);
  }
  return a;
}
const ARGS = parseArgs(process.argv.slice(2));
const ROOT = resolve(ARGS.root || process.cwd());
const CFG_PATH = join(ROOT, 'proto.config.json');

const SKIP_DIRS = new Set(['node_modules', '.git', 'feedback', 'backup', '.opencode', 'dist', 'build']);
function findHtml(rootDir, sub) {
  const base = sub ? join(rootDir, sub) : rootDir;
  let out = [], entries = [];
  try { entries = readdirSync(base, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const rel = (sub ? sub + '/' : '') + e.name;
    if (e.isDirectory()) out = out.concat(findHtml(rootDir, rel));
    else if (/\.html?$/i.test(e.name)) out.push(rel.split(sep).join('/'));
  }
  return out.sort();
}
function readTitle(abs) {
  try { const m = readFileSync(abs, 'utf8').slice(0, 4096).match(/<title[^>]*>([^<]*)<\/title>/i); return m ? m[1].trim() : ''; } catch { return ''; }
}
function pageIdOf(rel) {
  const name = rel.replace(/^.*\//, '').replace(/\.html?$/i, '');
  return ((name.match(/[a-z0-9]+/i) || [name])[0] || 'page').toLowerCase();
}
function uniqueIds(list) {
  const seen = Object.create(null);
  list.forEach(p => { let id = p.id, n = 2; while (seen[id]) id = p.id + '-' + (n++); seen[id] = true; p.id = id; });
  return list;
}
/* 探测是否用了内核容器约定(.pg-sec + data-page) */
function usesContainer(abs) {
  try { const t = readFileSync(abs, 'utf8'); return t.includes('pg-sec') && t.includes('data-page'); } catch { return false; }
}
function freePort(start, end) {
  return new Promise((res) => {
    const tryPort = (p) => {
      if (p > end) return res(start);
      const s = net.createServer();
      s.once('error', () => { s.close(); tryPort(p + 1); });
      s.once('listening', () => s.close(() => res(p)));
      s.listen(p, '127.0.0.1');
    };
    tryPort(start);
  });
}

async function main() {
  if (!existsSync(ROOT)) { console.error('[init] 目录不存在: ' + ROOT); process.exit(1); }
  if (existsSync(CFG_PATH) && !ARGS.force) {
    console.error('[init] 已存在 ' + CFG_PATH + ';如需覆盖请加 --force');
    process.exit(1);
  }
  const files = findHtml(ROOT, '');
  if (!files.length) { console.error('[init] 该目录下没有找到 .html 文件: ' + ROOT); process.exit(1); }
  const port = await freePort(8123, 8199);
  const title = readTitle(resolve(ROOT, files[0])) || '原型协同';

  let config;
  if (files.length === 1) {
    const rel = files[0];
    const con = usesContainer(resolve(ROOT, rel));
    config = {
      title,
      source: { mode: 'single', file: rel },
      pages: con
        ? { container: '.pg-sec', activeClass: 'act', idAttr: 'data-page', single: true, defaultId: 'page', list: [{ id: 'page', title }] }
        : { container: 'body', single: true, defaultId: 'page', list: [{ id: 'page', title: '整页文档' }] },
      viewport: { desktop: 1440, narrow: [{ match: '.is-mobile', width: 390 }] },
      tools: { anno: false },
      server: { port, feedbackDir: 'feedback/', wakeOnFeedback: false },
    };
  } else {
    const list = uniqueIds(files.map(rel => ({
      id: pageIdOf(rel),
      title: readTitle(resolve(ROOT, rel)) || rel.replace(/\.html?$/i, ''),
      file: rel,
    })));
    const idx = list.find(p => /(^|\/)index\.html?$/i.test(p.file));
    config = {
      title: (idx || list[0]).title || title,
      source: { mode: 'pages', dir: '.', index: idx ? idx.file : '' },
      pages: { container: 'body', singlePerFile: true, list },
      viewport: { desktop: 1440, narrow: [{ match: '.is-mobile', width: 390 }] },
      tools: { anno: false },
      server: { port, feedbackDir: 'feedback/', wakeOnFeedback: false },
    };
  }

  writeFileSync(CFG_PATH, JSON.stringify(config, null, 2) + '\n');
  console.log('[init] 已生成 ' + relative(process.cwd(), CFG_PATH).split(sep).join('/'));
  console.log('[init] 模式 ' + config.source.mode + (config.pages.singlePerFile ? '(每文件整页)' : '') + ' · 页面 ' + config.pages.list.length + ' · 端口 ' + port);
  console.log('[init] 下一步:  node studio/serve.mjs --root "' + ROOT + '" --config proto.config.json');
}
main().catch(e => { console.error('[init] 失败:', e.message); process.exit(1); });
