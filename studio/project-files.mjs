import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'feedback', 'backup', '.opencode', 'dist', 'build']);

export function findHtml(rootDir, sub) {
  const base = sub ? join(rootDir, sub) : rootDir;
  let out = [], entries = [];
  try { entries = readdirSync(base, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const rel = (sub ? sub + '/' : '') + e.name;
    if (e.isDirectory()) {
      const child = join(base, e.name);
      // 子项目需从其所属会话打开，不把相邻仓库或工具运行文件当作原型。
      if (e.isSymbolicLink() || existsSync(join(child, '.git')) ||
          (existsSync(join(child, 'studio.html')) && existsSync(join(child, 'serve.mjs')))) continue;
      out = out.concat(findHtml(rootDir, rel));
    }
    else if (/\.html?$/i.test(e.name)) out.push(rel.replace(/\\/g, '/'));
  }
  return out.sort();
}
export function readTitle(abs) {
  try { const m = readFileSync(abs, 'utf8').slice(0, 4096).match(/<title[^>]*>([^<]*)<\/title>/i); return m ? m[1].trim() : ''; } catch { return ''; }
}
export function pageIdOf(rel) {
  const slug = String(rel).replace(/\.html?$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'page';
}
export function uniqueIds(list) {
  const seen = Object.create(null);
  list.forEach(p => { let id = p.id, n = 2; while (seen[id]) id = p.id + '-' + (n++); seen[id] = true; p.id = id; });
  return list;
}
