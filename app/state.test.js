// node --test app/state.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const st = require('./state');

const T0 = 1700000000000;
const C = st.DEFAULTS;

function fact(over) {
  return Object.assign({
    now: T0, claudeAlive: true, shuttingDown: false, forced: null, activity: null, error: null,
  }, over);
}
function run(seq) {
  let m = st.initState(T0);
  for (const f of seq) m = st.reduce(m, f, C);
  return m;
}
function working(now, tool, src) {
  return { kind: 'working', ts: now, tool: tool || '', src: src || 'hook' };
}

test('no claude at all -> offline', () => {
  assert.equal(run([fact({ claudeAlive: false })]).state, 'offline');
});

test('claude up but nothing to report -> idle', () => {
  assert.equal(run([fact({})]).state, 'idle');
});

test('UserPromptSubmit -> thinking', () => {
  const m = run([fact({ activity: { kind: 'thinking', ts: T0, tool: '', src: 'hook' } })]);
  assert.equal(m.state, 'thinking');
});

test('PreToolUse -> working, and the tool name rides along', () => {
  const m = run([fact({ activity: working(T0, 'Bash') })]);
  assert.equal(m.state, 'working');
  assert.equal(m.tool, 'Bash');
  assert.equal(m.long, false);
});

test('a turn past WORK_MS is flagged long (this is what picks the long GIF)', () => {
  const m = run([fact({ activity: working(T0, 'Bash') }), fact({ now: T0 + 31000, activity: working(T0 + 30000, 'Bash') })]);
  assert.equal(m.state, 'working');
  assert.equal(m.long, true);
});

test('done flashes for DONE_HOLD_MS then falls back to idle', () => {
  const seq = [
    fact({ activity: working(T0, 'Bash') }),
    fact({ now: T0 + 1000, activity: { kind: 'done', ts: T0 + 1000, src: 'hook' } }),
  ];
  assert.equal(run(seq).state, 'done');
  seq.push(fact({ now: T0 + 6000, activity: { kind: 'done', ts: T0 + 1000, src: 'hook' } }));
  assert.equal(run(seq).state, 'idle');
});

test('done only flashes if we were actually working (no phantom flash)', () => {
  const m = run([fact({ activity: { kind: 'done', ts: T0, src: 'hook' } })]);
  assert.equal(m.state, 'idle');
});

test('awaiting survives a transcript tick but yields to a hook event', () => {
  const held = run([
    fact({ activity: { kind: 'awaiting', ts: T0, src: 'hook' } }),
    fact({ now: T0 + 1000, activity: { kind: 'working', ts: T0 + 1000, src: 'transcript' } }),
  ]);
  assert.equal(held.state, 'awaiting');

  const released = run([
    fact({ activity: { kind: 'awaiting', ts: T0, src: 'hook' } }),
    fact({ now: T0 + 1000, activity: working(T0 + 1000, 'Bash', 'hook') }),
  ]);
  assert.equal(released.state, 'working');
});

test('awaiting expires on its own', () => {
  const m = run([
    fact({ activity: { kind: 'awaiting', ts: T0, src: 'hook' } }),
    fact({ now: T0 + C.ATTENTION_HOLD_MS + 1, activity: { kind: 'working', ts: T0, src: 'transcript' } }),
  ]);
  assert.equal(m.state, 'working');
});

test('a tool error outranks a running tool', () => {
  const m = run([fact({ activity: working(T0, 'Bash'), error: { at: T0 } })]);
  assert.equal(m.state, 'error');
});

test('a tool error does not outrank a dead claude', () => {
  const m = run([fact({ activity: working(T0, 'Bash'), error: { at: T0 }, claudeAlive: false })]);
  assert.equal(m.state, 'offline');
});

test('a turn interrupted by a prompt still flashes done when it ends', () => {
  const m = run([
    fact({ activity: working(T0, 'Bash') }),
    fact({ now: T0 + 1000, activity: { kind: 'awaiting', ts: T0 + 1000, src: 'hook' } }),
    fact({ now: T0 + 2000, activity: { kind: 'done', ts: T0 + 2000, src: 'hook' } }),
  ]);
  assert.equal(m.state, 'done');
});

test('a stale working marker decays to idle', () => {
  const m = run([fact({ now: T0 + C.STALE_MS + 1, activity: working(T0, 'Bash') })]);
  assert.equal(m.state, 'idle');
});

test('forced state wins over everything except shutdown', () => {
  assert.equal(run([fact({ forced: 'working', activity: null, claudeAlive: false })]).state, 'working');
  assert.equal(run([fact({ forced: 'working', shuttingDown: true })]).state, 'offline');
});

test('computeAlive: no hooks falls back to the process probe', () => {
  assert.equal(st.computeAlive({ now: T0, procAlive: true, hookSessions: [] }), true);
  assert.equal(st.computeAlive({ now: T0, procAlive: false, hookSessions: [] }), false);
  assert.equal(st.computeAlive({ now: T0, procAlive: null, hookSessions: [] }), false);
});

test('computeAlive: a hooked session is trusted while it is live', () => {
  const sessions = [{ id: 'a', lastAt: T0 - 1000 }];
  assert.equal(st.computeAlive({ now: T0, procAlive: false, hookSessions: sessions }), true);
});

test('computeAlive: a quiet hooked session defers to the probe', () => {
  const quiet = [{ id: 'a', lastAt: T0 - C.DEAD_GRACE_MS - 1 }];
  assert.equal(st.computeAlive({ now: T0, procAlive: false, hookSessions: quiet }), false);
  assert.equal(st.computeAlive({ now: T0, procAlive: true, hookSessions: quiet }), true);
  assert.equal(st.computeAlive({ now: T0, procAlive: null, hookSessions: quiet }), true);
});

test('every state the machine can emit is in STATES', () => {
  const seen = new Set();
  const seqs = [
    [fact({ claudeAlive: false })],
    [fact({})],
    [fact({ activity: { kind: 'thinking', ts: T0, src: 'hook' } })],
    [fact({ activity: working(T0, 'Bash') })],
    [fact({ activity: { kind: 'awaiting', ts: T0, src: 'hook' } })],
    [fact({ activity: { kind: 'done', ts: T0, src: 'hook' } })],
    [fact({ activity: working(T0, 'Bash'), error: { at: T0 } })],
  ];
  for (const s of seqs) seen.add(run(s).state);
  assert.equal(seen.has('done'), false); // 'done' needs a preceding working stretch
  for (const s of seen) assert.ok(st.STATES.indexOf(s) !== -1, s + ' missing from STATES');
});
