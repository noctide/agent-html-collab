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
