// serve.mjs — ProtoBridge 通用协同服务(运行时层 ①,agent 无关)
//
// 用法:
//   node studio/serve.mjs [--root <项目根>] [--config proto.config.json] [--port 8123]
//                         [--source <方案稿路径>] [--feedback-dir <目录>] [--stay-alive]
//   也兼容位置参数: node studio/serve.mjs 8123
//
// 职责:
//   - 静态托管项目方案稿(/project/* 映射到项目根)与内核 studio(/studio)
//   - 注入运行时(/tool-res/anno.js、anno.css、可选 annotation-map.js)
//   - POST /api/feedback → 落盘 <feedbackDir>/feedback-<时间戳>.json
//   - 唤醒解耦:默认落盘后继续运行并打印提示;仅当环境变量 PROTOBRIDGE_WAKE=1
//     或 config.server.wakeOnFeedback=true 时才"落盘即退出"(兼容 ZCode 旧行为)。
import http from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ============================================================
   0. 参数 / 路径
   ============================================================ */
const KERNEL = dirname(fileURLToPath(import.meta.url));        // studio/
const PKG_ROOT = resolve(KERNEL, '..');                        // protobridge/
const SKIP_DIRS = new Set(['node_modules', '.git', 'feedback', 'backup', '.opencode', 'dist', 'build']);

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const [k, inline] = t.slice(2).split('=');
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline != null) a[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) a[key] = argv[++i];
      else a[key] = true;
    } else a._.push(t);
  }
  return a;
}
const ARGS = parseArgs(process.argv.slice(2));

const PROJECT_ROOT = resolve(ARGS.root || process.cwd());
const LOCAL_CFG = join(PROJECT_ROOT, 'proto.config.json');
const KERNEL_CFG = join(PKG_ROOT, 'studio/proto.config.json');
/* 配置来源:显式 --config → 项目根 proto.config.json → 自动探测根下 HTML → 内核默认 */
let AUTO_CFG = null;
let CONFIG_PATH = null;
if (ARGS.config) {
  const c = resolve(process.cwd(), ARGS.config);
  CONFIG_PATH = existsSync(c) ? c : resolve(PROJECT_ROOT, ARGS.config);   // 相对 cwd 找不到 → 相对 --root
  if (!existsSync(CONFIG_PATH)) CONFIG_PATH = null;                        // 指定的配置不存在 → 走自动探测
} else if (existsSync(LOCAL_CFG)) {
  CONFIG_PATH = LOCAL_CFG;
}
if (!CONFIG_PATH) {
  AUTO_CFG = autoDetectConfig();
  if (!AUTO_CFG) CONFIG_PATH = KERNEL_CFG;   // 根下没有 HTML 时退回内置默认
}
const CONFIG_LABEL = AUTO_CFG ? '(自动探测)' : CONFIG_PATH;

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { console.error('[serve] 配置解析失败 ' + p + ': ' + e.message); process.exit(1); }
}

/* ============================================================
   1. 配置合并(defaults → config 文件 → CLI)
   ============================================================ */
const DEFAULTS = {
  title: '原型协同',
  source: { mode: 'single', file: 'proto.html', dir: 'pages/', urls: [], index: '' },
  pages: { container: '.pg-sec', activeClass: 'act', idAttr: 'data-page', switch: 'auto', rootId: 'pg-{id}', single: false, singlePerFile: false, list: [] },
  viewport: { desktop: 1440, narrow: [{ match: '.is-mobile', width: 390 }] },
  ui: { whitelist: ['.pb-badge', '.pb-pop', '.pb-anno-fab', '.pbx-echip'] },
  tools: { anno: false },
  server: { port: 8123, feedbackDir: 'feedback/', wakeOnFeedback: false },
};
const FILE_CFG = AUTO_CFG || (CONFIG_PATH && existsSync(CONFIG_PATH) ? readJson(CONFIG_PATH) : {});
const CFG = deepMerge(deepMerge(structuredClone(DEFAULTS), FILE_CFG), {
  server: {
    port: ARGS.port ? Number(ARGS.port) : (ARGS._[0] ? Number(ARGS._[0]) : undefined),
    feedbackDir: ARGS.feedbackDir || undefined,
    stayAlive: ARGS.stayAlive ? true : undefined,
  },
});
if (ARGS.source) CFG.source = Object.assign({ mode: 'single' }, CFG.source, { file: ARGS.source });
if (CFG.server.port == null) CFG.server.port = 8123;

function deepMerge(base, extra) {
  if (!extra) return base;
  for (const k of Object.keys(extra)) {
    const v = extra[k];
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) base[k] = deepMerge(base[k], v);
    else base[k] = v;
  }
  return base;
}

const FEEDBACK_DIR = resolve(PROJECT_ROOT, CFG.server.feedbackDir || 'feedback/');
mkdirSync(FEEDBACK_DIR, { recursive: true });

/* ============================================================
   2. 页面清单 / 自动探测(便于 studio 渲染下拉,不依赖方案稿内部 PROTO_PAGES)
   ============================================================ */
/* 递归收集 rootDir 下的 HTML(返回相对路径,统一 / 分隔),跳过噪音目录与隐藏项 */
function findHtml(rootDir, sub) {
  const base = sub ? join(rootDir, sub) : rootDir;
  let out = [], entries = [];
  try { entries = readdirSync(base, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const rel = (sub ? sub + '/' : '') + e.name;
    if (e.isDirectory()) out = out.concat(findHtml(rootDir, rel));
    else if (/\.html?$/i.test(e.name)) out.push(rel.replace(/\\/g, '/'));
  }
  return out.sort();
}
function readTitle(abs) {
  try { const m = readFileSync(abs, 'utf8').slice(0, 4096).match(/<title[^>]*>([^<]*)<\/title>/i); return m ? m[1].trim() : ''; } catch { return ''; }
}
function pageIdOf(rel) {
  const slug = String(rel).replace(/\.html?$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'page';
}
function uniqueIds(list) {
  const seen = Object.create(null);
  list.forEach(p => { let id = p.id, n = 2; while (seen[id]) id = p.id + '-' + (n++); seen[id] = true; p.id = id; });
  return list;
}
/* 无配置文件时:按根下 HTML 数量推断模式(1 个→single;多个→pages,每文件整页) */
function autoDetectConfig() {
  const files = findHtml(PROJECT_ROOT, '');
  if (!files.length) return null;
  if (files.length === 1) {
    const rel = files[0];
    return {
      title: readTitle(resolve(PROJECT_ROOT, rel)) || '原型协同',
      source: { mode: 'single', file: rel },
      pages: { container: 'body', single: true, defaultId: 'page', list: [{ id: 'page', title: '整页文档' }] },
    };
  }
  const list = uniqueIds(files.map(rel => ({
    id: pageIdOf(rel),
    title: readTitle(resolve(PROJECT_ROOT, rel)) || rel.replace(/\.html?$/i, ''),
    file: rel,
  })));
  const idx = list.find(p => /(^|\/)index\.html?$/i.test(p.file));
  return {
    title: (idx || list[0]).title || '原型协同',
    source: { mode: 'pages', dir: '.', index: idx ? idx.file : '' },
    pages: { container: 'body', singlePerFile: true, list },
  };
}
function scanPages() {
  const src = CFG.source || {};
  if (Array.isArray(CFG.pages.list) && CFG.pages.list.length) return CFG.pages.list;
  if (src.mode === 'pages') {
    const sub = String(src.dir || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    const files = findHtml(PROJECT_ROOT, (sub && sub !== '.') ? sub : '');
    return uniqueIds(files.map(rel => ({ id: pageIdOf(rel), title: rel.replace(/\.html?$/i, ''), file: rel })));
  }
  return [];
}
const PAGES = scanPages();

/* 入口 URL:studio iframe 默认装载的地址(servable 路径或绝对 URL) */
function entryUrl() {
  const src = CFG.source || {};
  if (src.mode === 'urls') return (src.urls && src.urls[0]) || 'about:blank';
  if (src.mode === 'pages') {
    if (src.index) return '/project/' + String(src.index).replace(/^\/+/, '');
    const first = PAGES[0];
    return first ? '/project/' + first.file : 'about:blank';
  }
  return '/project/' + String(src.file || 'proto.html').replace(/^\/+/, '');
}
CFG.source.entry = entryUrl();
CFG.pages.list = PAGES;

/* ============================================================
   3. 注入 studio 的运行时配置
   ============================================================ */
function buildInjectedConfig() {
  return Object.assign({}, CFG, {
    _meta: {
      injectedBy: 'protobridge/serve.mjs',
      configPath: CONFIG_PATH || null,
      autoDetected: !!AUTO_CFG,
      projectRoot: PROJECT_ROOT,
      feedbackDir: FEEDBACK_DIR,
      kernelDir: KERNEL,
      builtAt: new Date().toISOString(),
    },
  });
}

/* ============================================================
   4. 静态资源
   ============================================================ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
function safeResolve(rootDir, rel) {
  const full = resolve(rootDir, '.' + (rel.startsWith('/') ? rel : '/' + rel));
  const r = rootDir.endsWith(sep) ? rootDir : rootDir + sep;
  return full === rootDir || full.startsWith(r) ? full : null;
}
function statFile(p) { try { return existsSync(p) && statSync(p).isFile(); } catch { return false; } }
function sendFile(res, full) {
  const type = MIME[extname(full).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(readFileSync(full));
}

/* 可选标注模块:内核自带 anno.js/anno.css;annotation-map.js 优先取项目配置,否则空桩 */
function annoMapSrc() {
  const custom = CFG.tools && CFG.tools.annoMap;
  if (custom) {
    const p = resolve(PROJECT_ROOT, custom);
    if (statFile(p)) return readFileSync(p, 'utf8');
  }
  return '/* protobridge: 未配置 tools.annoMap,区域标注映射为空 */\nwindow.PROTO_ANNO_MAP = { pages: {} };\n';
}

/* ============================================================
   5. 服务
   ============================================================ */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const send = (code, type, body, extra) => {
    res.writeHead(code, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }, extra || {}));
    res.end(body);
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  /* ---- API ---- */
  if (req.method === 'GET' && u.pathname === '/api/ping') {
    return send(200, MIME['.json'], JSON.stringify({ ok: true, app: 'protobridge', build: new Date().toISOString() }));
  }
  if (req.method === 'GET' && u.pathname === '/api/config') {
    return send(200, MIME['.json'], JSON.stringify(buildInjectedConfig()));
  }
  if (req.method === 'GET' && u.pathname === '/api/pages') {
    return send(200, MIME['.json'], JSON.stringify({ mode: CFG.source.mode, entry: CFG.source.entry, pages: PAGES }));
  }

  if (req.method === 'POST' && u.pathname === '/api/feedback') {
    let body = '', size = 0;
    req.on('data', (c) => { size += c.length; if (size > 8e6) req.destroy(); body += c; });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        if (!j || typeof j !== 'object' || (!Array.isArray(j.comments) && !Array.isArray(j.edits))) throw new Error('结构不符');
        j.v = j.v || 2;
        j.app = j.app || CFG.title;
        mkdirSync(FEEDBACK_DIR, { recursive: true });   // 目录可能被外部清理,写入前确保存在
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const file = join(FEEDBACK_DIR, 'feedback-' + stamp + '.json');
        writeFileSync(file, JSON.stringify(j, null, 2));
        const notify = j.notify !== false;
        console.log('[feedback] 已保存 ' + file + '  意见 ' + (j.comments || []).length + ' 条 / 改动 ' + (j.edits || []).length + ' 处' + (notify ? '' : '  (协同通知关闭)'));
        send(200, MIME['.json'], JSON.stringify({ ok: true, file }));
        const wake = process.env.PROTOBRIDGE_WAKE === '1' && !CFG.server.stayAlive;
        if (wake || CFG.server.wakeOnFeedback) {
          setTimeout(() => { console.log('[feedback] 按约定退出,唤醒 Agent 处理'); process.exit(0); }, 1200);
        } else {
          console.log('[feedback] 反馈已落盘,服务继续运行;' + (notify ? '对 Agent 说「处理反馈」即可回灌。' : '协同通知为关,需手动让 Agent「处理反馈」。'));
        }
      } catch (e) {
        console.error('[feedback] 解析失败:', e.message);
        send(400, MIME['.json'], JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  /* ---- 静态 ---- */
  if (req.method === 'GET') {
    let p = decodeURIComponent(u.pathname);

    // 内核 studio
    if (p === '/studio' || p === '/studio/') {
      let html = readFileSync(join(KERNEL, 'studio.html'), 'utf8');
      const inject = '<script>window.PROTO_CONFIG = ' + JSON.stringify(buildInjectedConfig()).replace(/</g, '\\u003c') + ';<\/script>';
      html = html.includes('<!-- PROTOBRIDGE_CONFIG -->')
        ? html.replace('<!-- PROTOBRIDGE_CONFIG -->', inject)
        : html.replace('</head>', inject + '\n</head>');
      return send(200, MIME['.html'], html);
    }
    // 运行时注入资源
    if (p.startsWith('/tool-res/')) {
      if (p === '/tool-res/anno.js') return send(200, MIME['.js'], readFileSync(join(KERNEL, 'anno/anno.js')));
      if (p === '/tool-res/anno.css') return send(200, MIME['.css'], readFileSync(join(KERNEL, 'anno/anno.css')));
      if (p === '/tool-res/annotation-map.js') return send(200, MIME['.js'], annoMapSrc());
      return send(404, 'text/plain; charset=utf-8', 'not found');
    }

    // 项目文件:/project/* 前缀,以及根路径
    let full = null;
    if (p.startsWith('/project/')) full = safeResolve(PROJECT_ROOT, p.slice('/project'.length));
    else if (p === '/' || p === '/index.html') {
      const entry = CFG.source.entry;
      if (/^https?:/i.test(entry)) { res.writeHead(302, { Location: entry }); return res.end(); }
      full = safeResolve(PROJECT_ROOT, entry.replace(/^\/project/, '').replace(/^\//, '/'));
    } else full = safeResolve(PROJECT_ROOT, p);

    if (full && statFile(full)) return sendFile(res, full);
    return send(404, 'text/plain; charset=utf-8', 'not found: ' + p);
  }

  send(405, 'text/plain; charset=utf-8', 'method not allowed');
});

server.on('error', (e) => { console.error('[serve] 启动失败:', e.message); process.exit(1); });
server.listen(CFG.server.port, '127.0.0.1', () => {
  console.log('[serve] protobridge  http://127.0.0.1:' + CFG.server.port + '/studio');
  console.log('[serve] 项目根   ' + PROJECT_ROOT);
  console.log('[serve] 配置     ' + CONFIG_LABEL + '   模式 ' + CFG.source.mode + (CFG.pages.singlePerFile ? '(每文件整页)' : '') + '   入口 ' + CFG.source.entry);
  console.log('[serve] 反馈目录 ' + FEEDBACK_DIR + (process.env.PROTOBRIDGE_WAKE === '1' ? '   [PROTOBRIDGE_WAKE=1 落盘即退出]' : '   [落盘后常驻]'));
});
