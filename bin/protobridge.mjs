#!/usr/bin/env node
// ProtoBridge CLI 入口:serve | apply | init
//
//   npx github:noctide/protobridge serve --root .
//   npx github:noctide/protobridge init  --root .
//   npx github:noctide/protobridge apply latest --root . --apply
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO = join(ROOT, 'studio');
const SCRIPT = { serve: 'serve.mjs', apply: 'apply.mjs', init: 'init.mjs' };
const [cmd, ...rest] = process.argv.slice(2);

function help() {
  console.log(`ProtoBridge — 通用 HTML 原型协同工具

用法:
  protobridge serve  [--root <目录>] [--config proto.config.json] [--port 8123]
  protobridge apply  [feedback.json|latest] [--root <目录>] [--config proto.config.json] [--apply]
  protobridge init   [--root <目录>] [--force]

示例:
  npx github:noctide/protobridge serve --root .
  npx github:noctide/protobridge init  --root .
  npx github:noctide/protobridge apply latest --root . --apply

说明:
  · 未写 proto.config.json 时,serve 会自动扫描根目录下的 HTML 起步
    (1 个 → single;多个 → pages,每文件整页)。
  · 想生成固定配置:先跑 init。`);
}

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { help(); process.exit(0); }
if (cmd === '--version' || cmd === '-v') {
  try { console.log(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version); } catch { console.log('0.0.0'); }
  process.exit(0);
}
if (!SCRIPT[cmd]) { console.error('[protobridge] 未知命令: ' + cmd + '\n'); help(); process.exit(1); }

const child = spawn(process.execPath, [join(STUDIO, SCRIPT[cmd]), ...rest], { stdio: 'inherit' });
child.on('error', (e) => { console.error('[protobridge] 启动失败: ' + e.message); process.exit(1); });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code == null ? 0 : code)));
