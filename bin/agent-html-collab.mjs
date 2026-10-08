#!/usr/bin/env node
// Agent HTML Collab CLI 入口:serve | open | apply | init | install-plugin | uninstall-plugin
//
//   agent-html-collab open                      # 选目录 → 起 studio → 开浏览器(推荐手动使用)
//   npx github:noctide/agent-html-collab serve --root .
//   npx github:noctide/agent-html-collab init  --root .
//   agent-html-collab install-plugin
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO = join(ROOT, 'studio');
const SCRIPT = { serve: 'serve.mjs', apply: 'apply.mjs', init: 'init.mjs' };
const PLUGIN_SRC = join(ROOT, 'packages', 'opencode-plugin');
const OPENCODE_DIR = process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, 'opencode') : join(os.homedir(), '.config', 'opencode');
const DEFAULT_PLUGIN_DST = join(OPENCODE_DIR, 'plugins', 'agent-html-collab');
const PLUGIN_REL = './plugins/agent-html-collab';   // 相对全局 opencode.json 的插件目录
const OLD_PLUGIN_REL = './plugins/protobridge';
const isOwnPlugin = value => [PLUGIN_REL, PLUGIN_REL + '/index.js', OLD_PLUGIN_REL, OLD_PLUGIN_REL + '/index.js'].includes(value);
const [cmd, ...rest] = process.argv.slice(2);

const opt = (name, def) => { const i = rest.indexOf(name); return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : def; };
const hasFlag = (name) => rest.includes(name);

function help() {
  console.log(`Agent HTML Collab — HTML 原型编辑与反馈工具

用法:
  agent-html-collab open   [--root <目录>] [--port 8123] [--no-open]  # 选目录 → 起 studio → 开浏览器
  agent-html-collab serve  [--root <目录>] [--config proto.config.json] [--port 8123]
  agent-html-collab apply  [feedback.json|latest] [--root <目录>] [--config proto.config.json] [--apply]
  agent-html-collab init   [--root <目录>] [--force]
  agent-html-collab install-plugin    [--to <目录>] [--force]   # 全局安装 OpenCode 适配包（需客户端接入）
  agent-html-collab uninstall-plugin  [--to <目录>]

示例:
  agent-html-collab open                      # 手动使用:弹目录选择框,自动开浏览器
  agent-html-collab open --root . --no-open   # 指定目录,不开浏览器(自动化)
  agent-html-collab install-plugin

说明:
  · open/serve 未写 proto.config.json 时,会自动扫描根目录下的 HTML 起步
    (1 个 → single;多个 → pages,每文件整页)。
  · install-plugin 默认装到 ~/.config/opencode/plugins/agent-html-collab,
    并在全局 opencode.json 的 plugins 里登记 ./plugins/agent-html-collab（OpenCode V2）;需重启 OpenCode。
  · 页面所属对话由客户端 Host 自动绑定；需客户端实现页面适配接口，详见 docs/host-integration.md。`);
}

/* ---- 打开浏览器(跨平台) ---- */
function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    console.log('[agent-html-collab] 已打开浏览器: ' + url);
  } catch { console.log('[agent-html-collab] 请手动打开: ' + url); }
}

/* ---- 手动选择目录:Windows 弹文件夹框;其它平台命令行输入 ---- */
function promptPath(def) {
  process.stdout.write('输入原型项目目录(回车=当前目录): ');
  try {
    const buf = Buffer.alloc(2048);
    const n = fs.readSync(0, buf, 0, buf.length, null);
    const s = buf.toString('utf8', 0, n).trim();
    return s || def;
  } catch { return def; }
}
function pickDirectory() {
  if (process.platform === 'win32') {
    const ps = 'Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = "选择原型项目目录"; $d.ShowNewFolderButton = $true; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }';
    try {
      const r = spawnSync('powershell', ['-NoProfile', '-STA', '-Command', ps], { encoding: 'utf8' });
      const p = (r.stdout || '').trim();
      return p || promptPath(process.cwd());   // 取消/失败 → 退化为输入
    } catch { return promptPath(process.cwd()); }
  }
  return promptPath(process.cwd());
}

/* ---- open:选目录 → 起 serve → 解析端口 → 开浏览器 ---- */
function runOpen() {
  let root = opt('--root', null) || pickDirectory();
  if (!root) { console.error('[agent-html-collab] 未选择目录,已取消'); process.exit(1); }
  root = resolve(root);
  if (!fs.existsSync(root)) { console.error('[agent-html-collab] 目录不存在: ' + root); process.exit(1); }
  const args = [join(STUDIO, 'serve.mjs'), '--root', root];
  const port = opt('--port', null); if (port) args.push('--port', String(port));
  console.log('[agent-html-collab] 启动 studio: ' + root);
  const child = spawn(process.execPath, args, { stdio: ['inherit', 'pipe', 'pipe'] });
  let opened = false;
  const relay = (chunk, out) => {
    out.write(chunk);
    if (opened) return;
    const m = String(chunk).match(/127\.0\.0\.1:(\d+)\/studio/);
    if (m) { opened = true; if (!hasFlag('--no-open')) openBrowser('http://127.0.0.1:' + m[1] + '/studio'); }
  };
  child.stdout.on('data', (c) => relay(c, process.stdout));
  child.stderr.on('data', (c) => relay(c, process.stderr));
  child.on('error', (e) => { console.error('[agent-html-collab] 启动失败: ' + e.message); process.exit(1); });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code == null ? 0 : code)));
  process.on('SIGINT', () => { try { child.kill(); } catch { /* ignore */ } });
  process.on('SIGTERM', () => { try { child.kill(); } catch { /* ignore */ } });
}

/* ---- 全局配置读写(登记 V2 plugins 并清理本包错误的 V1 登记;解析失败则跳过,不破坏) ---- */
function globalConfigPath() {
  const a = join(OPENCODE_DIR, 'opencode.json');
  const b = join(OPENCODE_DIR, 'opencode.jsonc');
  return fs.existsSync(a) ? a : (fs.existsSync(b) ? b : a);
}
function editGlobalPlugins(mutate) {
  const p = globalConfigPath();
  let obj;
  try {
    obj = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { $schema: 'https://opencode.ai/config.json' };
  } catch (e) {
    console.warn('[agent-html-collab] 未改全局配置(解析失败,可能是含注释的 JSONC,请手动添加): ' + e.message);
    return false;
  }
  const before = JSON.stringify(obj);
  // 本机使用 OpenCode V2；撤回此前依据 V1 文档写入的本包 plugin 条目。
  if (Array.isArray(obj.plugin)) {
    obj.plugin = obj.plugin.filter(x => !isOwnPlugin(x));
    if (!obj.plugin.length) delete obj.plugin;
  }
  mutate(obj);
  if (JSON.stringify(obj) === before) { console.log('[agent-html-collab] 全局配置无需变更: ' + p); return true; }
  fs.mkdirSync(dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  console.log('[agent-html-collab] 已更新全局配置 ' + p + '  plugins=' + JSON.stringify(obj.plugins));
  return true;
}

function runPluginInstall(uninstall) {
  const dst = resolve(opt('--to', DEFAULT_PLUGIN_DST));
  const isDefault = dst === resolve(DEFAULT_PLUGIN_DST);
  if (!uninstall) {
    if (!fs.existsSync(PLUGIN_SRC)) { console.error('[agent-html-collab] 找不到插件源: ' + PLUGIN_SRC); process.exit(1); }
    if (fs.existsSync(dst) && !hasFlag('--force')) { console.error('[agent-html-collab] 已存在 ' + dst + ';如需覆盖请加 --force'); process.exit(1); }
    fs.mkdirSync(dirname(dst), { recursive: true });
    fs.cpSync(PLUGIN_SRC, dst, { recursive: true, force: true });
    // 独立安装必须携带原型服务与 Host，不能依赖本仓库的位置。
    const runtime = join(dst, 'runtime');
    fs.mkdirSync(join(runtime, 'packages', 'dsh-plugin'), { recursive: true });
    fs.mkdirSync(join(runtime, 'packages', 'host-bridge'), { recursive: true });
    fs.cpSync(join(ROOT, 'studio'), join(runtime, 'studio'), { recursive: true, force: true });
    fs.copyFileSync(join(ROOT, 'packages', 'dsh-plugin', 'index.mjs'), join(runtime, 'packages', 'dsh-plugin', 'index.mjs'));
    fs.copyFileSync(join(ROOT, 'packages', 'host-bridge', 'index.mjs'), join(runtime, 'packages', 'host-bridge', 'index.mjs'));
    fs.copyFileSync(join(ROOT, 'packages', 'host-bridge', 'index.mjs'), join(dst, 'host-bridge', 'index.mjs'));
    // 统一使用 JavaScript 入口，避免升级后残留旧版本代码。
    fs.rmSync(join(dst, 'index.ts'), { force: true });
    console.log('[agent-html-collab] 插件已安装到 ' + dst);
    if (isDefault) {
      const updated = editGlobalPlugins((o) => { const l = Array.isArray(o.plugins) ? o.plugins : []; o.plugins = l.filter(x => !isOwnPlugin(x)); o.plugins.push(PLUGIN_REL); });
      const oldDirectory = join(OPENCODE_DIR, 'plugins', 'protobridge');
      if (updated && fs.existsSync(oldDirectory)) {
        const oldPackage = JSON.parse(fs.readFileSync(join(oldDirectory, 'package.json'), 'utf8'));
        if (oldPackage.name === 'protobridge-opencode-plugin') fs.rmSync(oldDirectory, { recursive: true, force: true });
      }
    }
    else console.log('[agent-html-collab] 自定义 --to:请自行在全局 opencode.json 的 plugins 里加入该目录（OpenCode V2）');
    console.log('[agent-html-collab] 重启客户端后生效。OpenCode V2 中执行 /agent-html-collab 打开绑定本会话的原型链接；真实模型续接仍待验证。');
  } else {
    if (fs.existsSync(dst)) { fs.rmSync(dst, { recursive: true, force: true }); console.log('[agent-html-collab] 插件已卸载: ' + dst); }
    else console.log('[agent-html-collab] 未安装: ' + dst);
    if (isDefault) editGlobalPlugins((o) => { if (Array.isArray(o.plugins)) o.plugins = o.plugins.filter((x) => !isOwnPlugin(x)); });
  }
}

/* ================= 分发(互斥) ================= */
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  help(); process.exit(0);
} else if (cmd === '--version' || cmd === '-v') {
  try { console.log(JSON.parse(fs.readFileSync(join(ROOT, 'package.json'), 'utf8')).version); } catch { console.log('0.0.0'); }
  process.exit(0);
} else if (cmd === 'open') {
  runOpen();                       // 常驻,不 exit
} else if (cmd === 'install-plugin' || cmd === 'uninstall-plugin') {
  runPluginInstall(cmd === 'uninstall-plugin'); process.exit(0);
} else if (SCRIPT[cmd]) {
  const child = spawn(process.execPath, [join(STUDIO, SCRIPT[cmd]), ...rest], { stdio: 'inherit' });
  child.on('error', (e) => { console.error('[agent-html-collab] 启动失败: ' + e.message); process.exit(1); });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code == null ? 0 : code)));
} else {
  console.error('[agent-html-collab] 未知命令: ' + cmd + '\n'); help(); process.exit(1);
}
