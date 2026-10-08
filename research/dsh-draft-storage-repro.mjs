// Reproduce legacy shared keys directly, bypassing the server's project-scoped defaults.
// Synthetic memory only; no browser data is read.
// Run: node research/dsh-draft-storage-repro.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../studio/studio.html', import.meta.url), 'utf8');
const storageLine = source.match(/^    storage: (\{[^\r\n]+\}),?$/m);
assert.ok(storageLine, 'Studio storage defaults must be found in the real source');
const defaults = vm.runInNewContext('(' + storageLine[1] + ')');
assert.equal(defaults.comments, 'proto.anno.comments');
assert.equal(defaults.edits, 'proto.edits');

const start = source.indexOf('  function collectBundle() {');
const end = source.indexOf('\n  function downloadText(', start);
assert.ok(start >= 0 && end > start, 'The real collectBundle implementation must be found');
const collectBundleSource = source.slice(start, end);

const draftFromA = {
  comments: { 'project-a-note': { page: 'home', comment: 'Synthetic Project A note' } },
  edits: { home: [{ path: 'h1', from: 'Project A', to: 'Changed Project A', ts: '2026-01-01T00:00:00.000Z' }] },
};
const sharedStorage = new Map([
  [defaults.comments, JSON.stringify(draftFromA.comments)],
  [defaults.edits, JSON.stringify(draftFromA.edits)],
]);

function collectForProjectB(storage) {
  const context = {
    ST: storage,
    CFG: { title: 'Synthetic Project B' },
    SRC: '/project-b/proto.html',
    win: null,
    isNotifyOn: () => true,
    lsGet: (key, fallback) => sharedStorage.has(key) ? JSON.parse(sharedStorage.get(key)) : fallback,
  };
  const bundle = vm.runInNewContext(collectBundleSource + '\ncollectBundle();', context);
  return JSON.parse(JSON.stringify(bundle));
}

const defaultBundle = collectForProjectB(defaults);
assert.equal(defaultBundle.app, 'Synthetic Project B');
assert.equal(defaultBundle.source, '/project-b/proto.html');
assert.deepEqual(defaultBundle.summary, { comments: 1, edits: 1, moves: 0 });
assert.equal(defaultBundle.comments[0].comment, draftFromA.comments['project-a-note'].comment);
assert.equal(defaultBundle.edits[0].to, draftFromA.edits.home[0].to);

const projectBStorage = Object.fromEntries(Object.keys(defaults).map(key => [key, 'synthetic-project-b.' + key]));
const isolatedBundle = collectForProjectB(projectBStorage);
assert.deepEqual(isolatedBundle.summary, { comments: 0, edits: 0, moves: 0 });
assert.deepEqual(isolatedBundle.comments, []);
assert.deepEqual(isolatedBundle.edits, []);

console.log(JSON.stringify({
  verified: true,
  data: 'Synthetic in-memory drafts only; no user browser storage accessed',
  defaultKeys: { comments: defaults.comments, edits: defaults.edits },
  projectBWithDefaultKeys: defaultBundle.summary,
  projectBWithIndependentKeys: isolatedBundle.summary,
}, null, 2));
