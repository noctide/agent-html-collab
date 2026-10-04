#!/usr/bin/env node
// ProtoBridge CLI 入口:serve | apply | init | install-plugin | uninstall-plugin
//
//   npx github:noctide/protobridge serve --root .
//   npx github:noctide/protobridge init  --root .
//   npx github:noctide/protobridge apply latest --root . --apply
//   protobridge install-plugin            # 全局安装 OpenCode 自动唤醒插件
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO = join(ROOT, 'studio');
const SCRIPT = { serve: 'serve.mjs', apply: 'apply.mjs', init: 'init.mjs' };
const PLUGIN_SRC = join(ROOT, 'packages', 'opencode-plugin');
const OPENCODE_DIR = process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, 'opencode') : join(os.homedir(), '.config', 'opencode');
const DEFAULT_PLUGIN_DST = join(OPENCODE_DIR, 'plugins', 'protobridge');
const PLUGIN_REL = './plugins/protobridge';   // 相对全局 opencode.json 的插件目录
const [cmd, ...rest] = process.argv.slice(2);

const opt = (name, def) => { const i = rest.indexOf(name); return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : def; };
const hasFlag = (name) => rest.includes(name);

function help() {
  console.log(`ProtoBridge — 通用 HTML 原型协同工具

用法:
  protobridge serve  [--root <目录>] [--config proto.config.json] [--port 8123]
  protobridge apply  [feedback.json|latest] [--root <目录>] [--config proto.config.json] [--apply]
  protobridge init   [--root <目录>] [--force]
  protobridge install-plugin    [--to <目录>] [--force]   # 全局安装 OpenCode 自动唤醒插件
  protobridge uninstall-plugin  [--to <目录>]

示例:
  npx github:noctide/protobridge serve --root .
  npx github:noctide/protobridge init  --root .
  protobridge install-plugin

说明:
  · 未写 proto.config.json 时,serve 会自动扫描根目录下的 HTML 起步
    (1 个 → single;多个 → pages,每文件整页)。
  · install-plugin 默认装到 ~/.config/opencode/plugins/protobridge,
    并在全局 opencode.json 的 plugins 里登记 ./plugins/protobridge(双保险);需重启 OpenCode。
  · 绑定目标会话:在目标对话执行 /protobridge 命令(选中即绑定,不发消息),或发一句「启用协同」。`);
}

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { help(); process.exit(0); }
if (cmd === '--version' || cmd === '-v') {
  try { console.log(JSON.parse(fs.readFileSync(join(ROOT, 'package.json'), 'utf8')).version); } catch { console.log('0.0.0'); }
  process.exit(0);
}

/* ---- 全局配置读写(仅改 plugins 数组;解析失败则跳过,不破坏) ---- */
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
    console.warn('[protobridge] 未改全局配置(解析失败,可能是含注释的 JSONC,请手动添加): ' + e.message);
    return;
  }
  const before = JSON.stringify(obj.plugins);
  mutate(obj);
  if (JSON.stringify(obj.plugins) === before) { console.log('[protobridge] 全局配置无需变更: ' + p); return; }
  fs.mkdirSync(dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  console.log('[protobridge] 已更新全局配置 ' + p + '  plugins=' + JSON.stringify(obj.plugins));
}

/* ---- OpenCode 插件全局安装/卸载(不依赖 opencode CLI)---- */
if (cmd === 'install-plugin' || cmd === 'uninstall-plugin') {
  const dst = resolve(opt('--to', DEFAULT_PLUGIN_DST));
  const isDefault = dst === resolve(DEFAULT_PLUGIN_DST);
  if (cmd === 'install-plugin') {
    if (!fs.existsSync(PLUGIN_SRC)) { console.error('[protobridge] 找不到插件源: ' + PLUGIN_SRC); process.exit(1); }
    if (fs.existsSync(dst) && !hasFlag('--force')) { console.error('[protobridge] 已存在 ' + dst + ';如需覆盖请加 --force'); process.exit(1); }
    fs.mkdirSync(dirname(dst), { recursive: true });
    fs.cpSync(PLUGIN_SRC, dst, { recursive: true, force: true });
    console.log('[protobridge] 插件已安装到 ' + dst);
    if (isDefault) editGlobalPlugins((o) => { const l = Array.isArray(o.plugins) ? o.plugins : (o.plugins = []); if (!l.includes(PLUGIN_REL)) l.push(PLUGIN_REL); });
    else console.log('[protobridge] 自定义 --to:请自行在全局 opencode.json 的 plugins 里加入该目录');
    console.log('[protobridge] 重启 OpenCode 后生效(全局,所有项目)。在目标会话的 / 菜单选 /protobridge 绑定(或发「启用协同」)。');
  } else {
    if (fs.existsSync(dst)) { fs.rmSync(dst, { recursive: true, force: true }); console.log('[protobridge] 插件已卸载: ' + dst); }
    else console.log('[protobridge] 未安装: ' + dst);
    if (isDefault) editGlobalPlugins((o) => { if (Array.isArray(o.plugins)) o.plugins = o.plugins.filter((x) => x !== PLUGIN_REL); });
  }
  process.exit(0);
}

if (!SCRIPT[cmd]) { console.error('[protobridge] 未知命令: ' + cmd + '\n'); help(); process.exit(1); }

const child = spawn(process.execPath, [join(STUDIO, SCRIPT[cmd]), ...rest], { stdio: 'inherit' });
child.on('error', (e) => { console.error('[protobridge] 启动失败: ' + e.message); process.exit(1); });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code == null ? 0 : code)));
