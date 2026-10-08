import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyFeedback } from '../studio/apply.mjs';

test('external feedback creates missing report directory; preview preserves source and apply backs it up', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-html-collab-apply-'));
  const projectRoot = join(root, 'project');
  await mkdir(projectRoot);
  const source = join(projectRoot, 'proto.html');
  const file = join(root, 'external.json');
  const original = '<p>Original text</p>';
  await writeFile(source, original);
  const feedback = { __file: file, comments: [], edits: [{ page: 'page', from: 'Original text', to: 'Updated text' }] };
  await writeFile(file, JSON.stringify(feedback));
  const config = { source: { mode: 'single', file: 'proto.html' }, server: { feedbackDir: 'nested/feedback' } };
  const preview = await applyFeedback({ feedback, config, projectRoot, stamp: 'preview' });
  assert.match(await readFile(preview.reportPath, 'utf8'), /Updated text/);
  assert.equal(await readFile(source, 'utf8'), original);
  assert.ok(await readFile(file, 'utf8'));
  const applied = await applyFeedback({ feedback, config, projectRoot, apply: true, stamp: 'apply' });
  assert.equal(await readFile(source, 'utf8'), '<p>Updated text</p>');
  assert.equal(await readFile(join(applied.backupDir, 'proto.html'), 'utf8'), original);
  assert.ok(await readFile(applied.movedTo, 'utf8'));
});

test('movement feedback reports CSS offsets and preserves source styles in preview and apply', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'agent-html-collab-moves-'));
  const source = join(projectRoot, 'proto.html');
  const original = '<main><p style="transform: rotate(10deg); position: relative">Move me</p></main>';
  await writeFile(source, original);
  const record = { page: 'page', path: 'main>p', label: 'Card | CTA', from: { x: 0, y: 0 }, to: { x: 24.5, y: -12 }, ts: '2026-10-07T00:00:00Z' };
  const feedback = { comments: [], edits: [], moves: [record] };
  const config = { source: { mode: 'single', file: 'proto.html' } };
  const preview = await applyFeedback({ feedback, config, projectRoot, stamp: 'preview' });
  const report = await readFile(preview.reportPath, 'utf8');
  assert.equal(preview.moves.length, 1);
  assert.equal(preview.moves[0].file, 'proto.html');
  assert.match(preview.moves[0].reason, /不自动改写 CSS/);
  assert.match(report, /main>p/);
  assert.match(report, /\(0, 0\) px/);
  assert.match(report, /\(24\.5, -12\) px/);
  assert.ok(report.includes('Card \\| CTA'));
  assert.equal(await readFile(source, 'utf8'), original);
  const file = join(projectRoot, 'feedback.json');
  feedback.__file = file;
  await writeFile(file, JSON.stringify(feedback));
  const applied = await applyFeedback({ feedback, config, projectRoot, apply: true, stamp: 'apply' });
  assert.equal(applied.applied.length, 0);
  assert.equal(applied.moves.length, 1);
  assert.equal(await readFile(source, 'utf8'), original);
  assert.equal(await readFile(join(applied.backupDir, 'proto.html'), 'utf8'), original);
  assert.deepEqual(JSON.parse(await readFile(applied.movedTo, 'utf8')).moves, [record]);
});

test('legacy adapters retain movements alongside text edits; movement adapters can enrich source locations', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'agent-html-collab-move-adapter-'));
  const source = join(projectRoot, 'proto.html');
  await writeFile(source, '<p>Original text</p>');
  await writeFile(join(projectRoot, 'legacy.mjs'), 'export function plans({ feedback }) { return { edits: feedback.edits.map(record => ({ record, file: "proto.html" })), comments: [] }; }');
  await writeFile(join(projectRoot, 'moves.mjs'), 'export function plans({ feedback }) { return { edits: [], comments: [], moves: feedback.moves.map(record => ({ record, file: "proto.html", line: 42 })) }; }');
  const record = { page: 'page', path: 'p', from: { x: 0, y: 0 }, to: { x: -30, y: 8 } };
  const feedback = { comments: [], edits: [{ page: 'page', from: 'Original text', to: 'Updated text' }], moves: [record] };
  const config = { source: { mode: 'single', file: 'proto.html' }, apply: { adapter: 'legacy.mjs' } };
  const legacy = await applyFeedback({ feedback, config, projectRoot, apply: true, stamp: 'legacy' });
  assert.equal(legacy.applied.length, 1);
  assert.equal(legacy.moves.length, 1);
  assert.equal(legacy.moves[0].file, 'proto.html');
  assert.equal(await readFile(source, 'utf8'), '<p>Updated text</p>');
  const enriched = await applyFeedback({ feedback: { comments: [], edits: [], moves: [record] }, config: { apply: { adapter: 'moves.mjs' } }, projectRoot, stamp: 'enriched' });
  assert.equal(enriched.moves[0].line, 42);
  assert.match(await readFile(enriched.reportPath, 'utf8'), /proto\.html:42/);
});

test('invalid or unmapped movement records remain visible as actionable report failures', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'agent-html-collab-invalid-moves-'));
  const source = join(projectRoot, 'proto.html');
  await writeFile(source, '<p>Keep intact</p>');
  const move = { page: 'page', path: 'p', from: { x: 0, y: 0 }, to: { x: 20, y: 10 } };
  const feedback = { moves: [
    { ...move, to: { x: '20', y: 10 } },
    { ...move, path: ' ' },
    { ...move, from: { x: 5, y: 0 } },
    { ...move, page: 'unmapped' },
    { ...move, page: 'missing' },
    null,
  ] };
  const config = { pages: { list: [{ id: 'page', file: 'proto.html' }, { id: 'missing', file: 'missing.html' }] } };
  const result = await applyFeedback({ feedback, config, projectRoot, apply: true, stamp: 'invalid' });
  assert.equal(result.moves.length, 6);
  assert.match(result.moves[0].reason, /有效坐标/);
  assert.match(result.moves[1].reason, /元素路径/);
  assert.match(result.moves[2].reason, /起点须为原始布局/);
  assert.match(result.moves[3].reason, /页面未映射/);
  assert.match(result.moves[4].reason, /源文件不存在/);
  assert.match(result.moves[5].reason, /元素路径/);
  assert.match(await readFile(result.reportPath, 'utf8'), /无效坐标/);
  assert.equal(await readFile(source, 'utf8'), '<p>Keep intact</p>');
});
