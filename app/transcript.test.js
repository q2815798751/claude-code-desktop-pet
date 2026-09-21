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

// ---- multi-session ----

const metaLine = (o) => JSON.stringify(o);
const aiTitle = (title) => ({ type: 'ai-title', aiTitle: title, sessionId: 's' });
const withMeta = (ms, kind, extra) => Object.assign(
  { type: kind, timestamp: iso(ms), sessionId: 's', cwd: 'C:\\work\\proj-a', gitBranch: 'main', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
  extra || {});

function tmpProjectNamed(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-m-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  return { root, file: path.join(proj, name + '.jsonl') };
}

test('snapshotAll: a transcript newer than maxAge is a session', () => {
  const { root, file } = tmpProjectNamed('sess-1');
  write(file, [metaLine(aiTitle('桌宠面板优化')), metaLine(withMeta(T0, 'user'))]);
  const out = T.snapshotAll({ dir: root, now: T0 + 1000, force: true });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'sess-1');
  assert.equal(out[0].title, '桌宠面板优化');
  assert.equal(out[0].project, 'proj-a');
  assert.equal(out[0].branch, 'main');
  assert.equal(out[0].msg.kind, 'working');
});

// The id must be the FILENAME. A transcript also carries a snake_case session_id
// that is a different value, and the hook side can only be matched by file path.
test('snapshotAll: the id is the filename, never the snake_case session_id', () => {
  const { root, file } = tmpProjectNamed('abc-123');
  write(file, [metaLine({ type: 'user', timestamp: iso(T0), session_id: 'SOMETHING-ELSE', message: { role: 'user', content: [] } })]);
  const out = T.snapshotAll({ dir: root, now: T0 + 10, force: true });
  assert.equal(out[0].id, 'abc-123');
});

// Liveness is judged from the FILE's mtime, not from the timestamp inside the last
// line: a session whose process died mid-turn still has a "current" line in it.
test('snapshotAll: a stale transcript is not a session', () => {
  const { root, file } = tmpProjectNamed('old');
  write(file, [metaLine(withMeta(T0, 'user'))]);
  fs.utimesSync(file, new Date(T0), new Date(T0));
  const out = T.snapshotAll({ dir: root, now: T0 + T.SESSION_MAX_AGE_MS + 1000, force: true });
  assert.deepEqual(out, []);
});

test('snapshotAll: newest first, and capped by limit', () => {
  const { root, file } = tmpProjectNamed('a');
  const dir = path.dirname(file);
  for (let i = 0; i < 6; i++) {
    fs.writeFileSync(path.join(dir, 's' + i + '.jsonl'), JSON.stringify(withMeta(T0 + i * 1000, 'user')) + '\n');
    fs.utimesSync(path.join(dir, 's' + i + '.jsonl'), new Date(T0 + i * 1000), new Date(T0 + i * 1000));
  }
  const out = T.snapshotAll({ dir: root, now: T0 + 10000, limit: 3, force: true });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((s) => s.id), ['s5', 's4', 's3']);
});

test('snapshotAll: an unchanged file is not re-read', () => {
  const { root, file } = tmpProjectNamed('cached');
  write(file, [metaLine(withMeta(T0, 'user'))]);
  const a = T.snapshotAll({ dir: root, now: T0 + 10 });
  const b = T.snapshotAll({ dir: root, now: T0 + 20 });
  assert.equal(a[0].msg, b[0].msg, 'same parsed object served from cache');
  assert.equal(a[0].title, b[0].title);
});

test('snapshotAll: an appended file is re-read', () => {
  const { root, file } = tmpProjectNamed('grow');
  write(file, [metaLine(withMeta(T0, 'user'))]);
  assert.equal(T.snapshotAll({ dir: root, now: T0 + 10 })[0].tool, '');
  fs.appendFileSync(file, JSON.stringify(assistantTool(T0 + 500, 'Grep')) + '\n');
  const b = T.snapshotAll({ dir: root, now: T0 + 600 });
  assert.equal(b[0].tool, 'Grep');
});

test('snapshotAll: a session that fell out of the window is evicted from the cache', () => {
  const { root, file } = tmpProjectNamed('evict');
  write(file, [metaLine(withMeta(T0, 'user'))]);
  fs.utimesSync(file, new Date(T0), new Date(T0));
  T.snapshotAll({ dir: root, now: T0 + 10 });
  const before = T.sessionCacheSize();
  assert.equal(before, 1, 'cached while in the window');
  T.snapshotAll({ dir: root, now: T0 + T.SESSION_MAX_AGE_MS + 1000 });
  assert.equal(T.sessionCacheSize(), 0, 'evicted once out of the window');
});

test('snapshotAll: a caller-supplied file list skips its own directory walk', () => {
  const { root, file } = tmpProjectNamed('shared');
  write(file, [metaLine(withMeta(T0, 'user'))]);
  const files = T.listTranscripts(root);
  assert.equal(files.length, 1);
  const out = T.snapshotAll({ dir: root, now: T0 + 10, files, force: true });
  assert.equal(out[0].id, 'shared');
});
