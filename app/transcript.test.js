// node --test app/transcript.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('./transcript');

const T0 = 1700000000000;
const iso = (ms) => new Date(ms).toISOString();

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-t-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  return { root, file: path.join(proj, 'session.jsonl') };
}
function write(file, lines) { fs.writeFileSync(file, lines.join('\n') + '\n'); }
const userLine = (ms) => ({ type: 'user', timestamp: iso(ms), message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } });
const assistantText = (ms) => ({ type: 'assistant', timestamp: iso(ms), message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } });
const assistantTool = (ms, name) => ({ type: 'assistant', timestamp: iso(ms), message: { role: 'assistant', content: [{ type: 'tool_use', name, id: 'x' }] } });
const assistantThink = (ms) => ({ type: 'assistant', timestamp: iso(ms), message: { role: 'assistant', content: [{ type: 'thinking', thinking: '...' }] } });
const errLine = (ms) => ({ type: 'user', timestamp: iso(ms), message: { role: 'user', content: [{ type: 'tool_result', isError: true }] } });

test.after(() => { /* temp dirs are left to the OS */ });

// ---- classification ----
test('classify: a user line means mid-turn', () => {
  assert.equal(T.classify(userLine(T0)), 'working');
});
test('classify: pure assistant text means the turn finished', () => {
  assert.equal(T.classify(assistantText(T0)), 'done');
});
test('classify: assistant text next to a tool_use is still mid-turn', () => {
  const o = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'Bash' }] } };
  assert.equal(T.classify(o), 'working');
});
test('classify: thinking and tool_use are mid-turn', () => {
  assert.equal(T.classify(assistantThink(T0)), 'working');
  assert.equal(T.classify(assistantTool(T0, 'Bash')), 'working');
});
test('classify: metadata lines are ignored', () => {
  assert.equal(T.classify({ type: 'summary', summary: 'x' }), null);
});

// ---- parseTail ----
test('parseTail: the newest meaningful line wins', () => {
  const p = T.parseTail([
    JSON.stringify(userLine(T0)),
    JSON.stringify(assistantTool(T0 + 1000, 'Edit')),
    JSON.stringify(assistantText(T0 + 2000)),
  ].join('\n') + '\n');
  assert.equal(p.msg.kind, 'done');
  assert.equal(p.msg.ts, T0 + 2000);
  assert.equal(p.tool, 'Edit');
});

test('parseTail: only the newest error line counts', () => {
  const p = T.parseTail([
    JSON.stringify(errLine(T0 + 9000)),
    JSON.stringify(userLine(T0 + 10000)),
  ].join('\n') + '\n');
  assert.equal(p.errAt, T0 + 9000);
});

test('parseTail: a line without a parseable timestamp is skipped', () => {
  const p = T.parseTail(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] } }) + '\n');
  assert.equal(p.msg, null);
});

// ---- error window ----
test('errorOf: a fresh error shows', () => {
  assert.deepEqual(T.errorOf({ errAt: T0, msg: { kind: 'working', ts: T0 } }, T0 + 1000), { at: T0 });
});
test('errorOf: an error older than the window is dropped', () => {
  assert.equal(T.errorOf({ errAt: T0, msg: null }, T0 + T.ERROR_WINDOW_MS + 1), null);
});
test('errorOf: claude recovering clears it early', () => {
  const parsed = { errAt: T0, msg: { kind: 'done', ts: T0 + 500 } };
  assert.equal(T.errorOf(parsed, T0 + 1000), null);
});

// ---- snapshot ----
test('snapshot: empty project dir yields an empty reading', () => {
  const { root } = tmpProject();
  const s = T.snapshot({ dir: root, now: T0, force: true });
  assert.equal(s.msg, null);
  assert.equal(s.path, null);
});

test('snapshot: reads the newest transcript', () => {
  const { root, file } = tmpProject();
  write(file, [JSON.stringify(userLine(T0)), JSON.stringify(assistantTool(T0 + 100, 'Grep'))]);
  const s = T.snapshot({ dir: root, now: T0 + 200, force: true });
  assert.equal(s.msg.kind, 'working');
  assert.equal(s.tool, 'Grep');
  assert.equal(s.path, file);
});

test('snapshot: a mid-append file reads as actively writing', () => {
  const { root, file } = tmpProject();
  fs.writeFileSync(file, '{"type":"assist');   // partial line, no newline
  const s = T.snapshot({ dir: root, now: T0, force: true });
  assert.equal(s.msg.kind, 'working');
  assert.equal(s.msg.ts, T0);
});

test('snapshot: a new write is picked up', () => {
  const { root, file } = tmpProject();
  write(file, [JSON.stringify(userLine(T0))]);
  assert.equal(T.snapshot({ dir: root, now: T0 + 10, force: true }).msg.kind, 'working');
  write(file, [JSON.stringify(userLine(T0)), JSON.stringify(assistantText(T0 + 500)), JSON.stringify(assistantTool(T0 + 900, 'Read'))]);
  const s = T.snapshot({ dir: root, now: T0 + 1000 });
  assert.equal(s.msg.kind, 'working');
  assert.equal(s.tool, 'Read');
});

// The bug this guards: the parse result used to be cached together with the
// finished error, so an error never expired while the file sat still.
test('snapshot: the error window still expires on a cached read', () => {
  const { root, file } = tmpProject();
  write(file, [JSON.stringify(errLine(T0))]);
  const fresh = T.snapshot({ dir: root, now: T0 + 1000 });
  assert.ok(fresh.error, 'error should be visible right after it happens');
  const stale = T.snapshot({ dir: root, now: T0 + T.ERROR_WINDOW_MS + 1 });
  assert.equal(stale.error, null, 'error must expire even though the file never changed');
});

test('snapshot: caching does not go stale across a second call', () => {
  const { root, file } = tmpProject();
  write(file, [JSON.stringify(assistantTool(T0, 'Bash'))]);
  const a = T.snapshot({ dir: root, now: T0 });
  const b = T.snapshot({ dir: root, now: T0 + 5 });
  assert.deepEqual(a.msg, b.msg);
  assert.equal(a.path, b.path);
});
