const cp = require('node:child_process');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = 'D:/05_project/00_chat/zcode-plugin-integration';
const ts = require(path.join(repo, 'node_modules/typescript'));
const ref = 'upstream/feat/ui-plugin';
const base = 'packages/ui/src/plugin-ui/';
const passed = [];
function load(file, dependencies) {
  const source = cp.execFileSync('git', ['show', `${ref}:${base}${file}`], { cwd: repo, encoding: 'utf8' });
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, TextEncoder, require: name => {
    if (!(name in dependencies)) throw new Error(`Unprovided dependency: ${name}`);
    return dependencies[name];
  }};
  vm.runInNewContext(js, context, { filename: file });
  return context.exports;
}
async function check(name, run) { await run(); passed.push(name); }
async function main() {
  const shared = { MCP_APPS_STRUCTURED_CONTENT_MAX_BYTES: 1024 * 1024, MCP_APPS_IMAGE_MAX_BYTES: 4 * 1024 * 1024, MCP_APPS_IMAGE_MIME_TYPES: ['image/png', 'image/jpeg', 'image/webp'], buildPluginSandboxScopeId: s => `surface:${s.surfaceId}`, concatMcpAppsTextContent: blocks => blocks.filter(b => b.type === 'text').map(b => b.text).join('\n') };
  const prompt = load('domain/pluginUiFollowUp.ts', { '@zcode/shared/mcp-apps': shared });
  const images = load('domain/pluginUiImageBlocks.ts', { '@zcode/shared/mcp-apps': shared });
  let current, confirm, sent, gesture, live;
  const interactions = load('adapters/pluginUiInteractions.ts', {
    '@/plugin-ui/adapters/pluginUiSessionActions.js': { getPluginUiSessionActions: () => current },
    '@zcode/shared/mcp-apps': shared,
    '../app/pluginUiFollowUpDialogStore.js': { requestPluginUiFollowUpConfirmation: async () => confirm() },
    '../domain/pluginUiFollowUp.js': prompt,
    '../domain/pluginUiImageBlocks.js': images,
    './pluginUiModelContextEvents.js': { dispatchPluginUiModelContextAdd: () => false },
  }).createPluginUiInteractions({ workspacePath: 'C:/fixture', sessionId: 'A', pluginId: 'fixture', scope: { kind: 'surface', surfaceId: 'editor' } });
  const context = { consumeUserGesture: async () => gesture, assertCurrent: () => { if (!live) throw new Error('closed'); } };
  const reset = () => { sent = []; current = { sendFollowUp: async p => sent.push(p) }; gesture = true; live = true; confirm = () => 'edited'; };
  const send = () => interactions.onSendFollowUpMessage({ prompt: 'feedback' }, context);
  await check('gesture sends to bound action', async () => { reset(); await send(); assert.equal(sent[0].prompt, 'feedback'); });
  await check('no gesture uses edited confirmation', async () => { reset(); gesture = false; await send(); assert.equal(sent[0].prompt, 'edited'); });
  await check('cancel sends nothing', async () => { reset(); gesture = false; confirm = () => null; await assert.rejects(send, e => e.code === -32000); assert.equal(sent.length, 0); });
  await check('binding replacement during confirmation rejects', async () => { reset(); gesture = false; confirm = () => { current = { sendFollowUp: async () => { throw new Error('wrong session'); } }; return 'edited'; }; await assert.rejects(send, e => e.code === -32601); assert.equal(sent.length, 0); });
  await check('closed page rejects before delivery', async () => { reset(); live = false; await assert.rejects(send, /closed/); assert.equal(sent.length, 0); });
  await check('missing session rejects', async () => { reset(); current = null; await assert.rejects(send, e => e.code === -32601); });
  await check('empty message rejects', async () => { reset(); await assert.rejects(() => interactions.onSendFollowUpMessage({ prompt: '  ' }, context), e => e.code === -32602); });
  const binding = load('adapters/pluginUiSessionBinding.ts', { '../domain/pluginUiImageBlocks.js': images });
  for (const ack of [undefined, 'sent', 'blocked', 'confirmationRequired']) {
    await check(`ACK ${String(ack)}`, async () => {
      const action = binding.createPluginUiSessionActions({}, { sendText: async () => ack });
      const run = () => action.sendFollowUp({ prompt: 'feedback', source: { kind: 'pluginUi', pluginId: 'fixture' } });
      if (ack === 'blocked' || ack === 'confirmationRequired') await assert.rejects(run, /not ready/); else await run();
    });
  }
  await check('attachment upload failure prevents message send', async () => {
    let count = 0;
    const action = binding.createPluginUiSessionActions({}, { uploadAttachment: async () => { throw new Error('upload failed'); }, sendText: async () => { count++; } });
    await assert.rejects(() => action.sendFollowUp({ prompt: 'feedback', source: { kind: 'pluginUi', pluginId: 'fixture' }, images: [{ mimeType: 'image/png', dataBase64: 'YQ==' }] }), /upload failed/);
    assert.equal(count, 0);
  });
  const result = { ref: cp.execFileSync('git', ['rev-parse', ref], { cwd: repo, encoding: 'utf8' }).trim(), scope: 'Actual branch modules transpiled in VM; host/session/dialog ports and shared constants are fixtures. No Electron, SDK handshake, real session or GUI validation.', passed };
  fs.writeFileSync(path.join(__dirname, 'zcode-local-validation-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
