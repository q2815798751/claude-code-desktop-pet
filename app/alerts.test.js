// node --test app/alerts.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('./alerts');

const T0 = 1700000000000;
const b = (inTok, out, cc, cr) => ({
  in: inTok, out: out, cc: cc || 0, cr: cr || 0,
  msgs: 1, input: inTok + (cc || 0) + (cr || 0), hit: 50,
});
const blank = (over) => Object.assign({
  ready: true, model: 'claude-sonnet-5',
  session: b(0, 0, 0, 0), today: b(0, 0, 0, 0), total: b(0, 0, 0, 0),
  lastTurn: null, recent: b(0, 0, 0, 0),
  ctx: { tokens: 0, window: 200000, pct: 0 }, spark: [],
}, over);

// ctx helper: pct of a 200k window
const ctx = (pct, tokens) => ({ tokens: tokens || Math.round(pct * 2000), window: 200000, pct });

// Drives a sequence of readings and collects the ids that FIRED at each step.
// Starts warm (the ledger already built) because that is the steady state every
// rule is about; the cold-start path has its own test.
function drive(seq, cfg, opts) {
  let state = Object.assign(A.createState(), { ready: !(opts && opts.cold) });
  const fired = [];
  const seen = [];
  for (const step of seq) {
    const r = A.reduce(state, step.u, step.t, cfg);
    state = r.state;
    seen.push(r.alerts);
    const now = [];
    for (const a of r.alerts) if (a.firedAt === step.t) now.push(a.id);
    fired.push(now);
  }
  return { state, fired, seen };
}

// ---- edge triggering --------------------------------------------------------

// The v2.0.0 bug in CHANGELOG.md: a condition that stays true must not re-fire.
test('edge: a condition held for 100 ticks fires exactly once', () => {
  const u = blank({ ctx: ctx(95) });
  const seq = [];
  for (let i = 0; i < 100; i++) seq.push({ t: T0 + i * 1000, u });
  const { fired } = drive(seq, {});
  assert.deepEqual(fired[0], ['ctx.crit']);
  for (let i = 1; i < 100; i++) assert.deepEqual(fired[i], [], 'tick ' + i + ' must stay silent');
});

test('edge: falling below the line re-arms the rule', () => {
  const hi = blank({ ctx: ctx(95) });
  const lo = blank({ ctx: ctx(10) });
  const { fired } = drive([
    { t: T0, u: hi },
    { t: T0 + 3600000, u: lo },
    { t: T0 + 7200000, u: hi },
  ], {});
  assert.deepEqual(fired[0], ['ctx.crit']);
  assert.deepEqual(fired[1], []);
  assert.deepEqual(fired[2], ['ctx.crit']);
});

// A reading that flaps across the line must not produce one alert per flap.
test('edge: the cooldown floors the gap between two firings', () => {
  const hi = blank({ ctx: ctx(95) });
  const lo = blank({ ctx: ctx(10) });
  const { fired } = drive([
    { t: T0, u: hi },
    { t: T0 + 1000, u: lo },
    { t: T0 + 2000, u: hi },                 // within the 30min crit cooldown
    { t: T0 + 60000, u: lo },
    { t: T0 + 1700000, u: hi },              // 28min: still inside the floor
    { t: T0 + 1860000, u: hi },              // 31min: floor has passed while armed
  ], {});
  assert.deepEqual(fired[0], ['ctx.crit']);
  assert.deepEqual(fired[2], [], 'blocked by cooldown');
  assert.deepEqual(fired[4], [], 'still blocked');
  assert.deepEqual(fired[5], ['ctx.crit'], 'fires once the floor has passed');
});

test('edge: a critical reading suppresses the warning for the same condition', () => {
  const { seen } = drive([{ t: T0, u: blank({ ctx: ctx(95) }) }], {});
  const ids = seen[0].map((a) => a.id);
  assert.deepEqual(ids, ['ctx.crit']);
});

test('edge: the warning fires on its own below the critical line', () => {
  const { seen } = drive([{ t: T0, u: blank({ ctx: ctx(85) }) }], {});
  assert.deepEqual(seen[0].map((a) => a.id), ['ctx.warn']);
  assert.equal(seen[0][0].active, true);
});

test('edge: a fired alert stays in the payload briefly, then drops out', () => {
  const hi = blank({ ctx: ctx(95) });
  const lo = blank({ ctx: ctx(5) });
  const r = A.reduce(Object.assign(A.createState(), { ready: true }), hi, T0, {});
  const stillThere = A.reduce(r.state, lo, T0 + 5000, {});
  assert.equal(stillThere.alerts.length, 1, 'shown as inactive while recent');
  assert.equal(stillThere.alerts[0].active, false);
  const gone = A.reduce(stillThere.state, lo, T0 + A.RECENT_MS + 1000, {});
  assert.deepEqual(gone.alerts, []);
});

// ---- individual rules -------------------------------------------------------

test('turn.big: a single oversized turn', () => {
  const { fired } = drive([{ t: T0, u: blank({ lastTurn: { in: 5, out: 40000, cc: 0, cr: 0, ts: T0 } }) }], {});
  assert.deepEqual(fired[0], ['turn.big']);
});

test('turn.big: a normal turn is quiet', () => {
  const { fired } = drive([{ t: T0, u: blank({ lastTurn: { in: 5, out: 800, cc: 0, cr: 0, ts: T0 } }) }], {});
  assert.deepEqual(fired[0], []);
});

test('cache.low: needs both a bad hit rate and enough input to matter', () => {
  const bad = { in: 60000, out: 100, cc: 0, cr: 0, msgs: 20, input: 60000, hit: 12 };
  assert.deepEqual(drive([{ t: T0, u: blank({ recent: bad }) }], {}).fired[0], ['cache.low']);

  const small = { in: 100, out: 10, cc: 0, cr: 0, msgs: 2, input: 100, hit: 0 };
  assert.deepEqual(drive([{ t: T0, u: blank({ recent: small }) }], {}).fired[0], [], 'too little input to care');
});

test('cache.low: a healthy hit rate is quiet', () => {
  const good = { in: 20000, out: 100, cc: 0, cr: 60000, msgs: 20, input: 80000, hit: 75 };
  assert.deepEqual(drive([{ t: T0, u: blank({ recent: good }) }], {}).fired[0], []);
});

test('day.heavy: the daily total', () => {
  const heavy = { in: 1000000, out: 1500000, cc: 0, cr: 0, msgs: 100, input: 1000000, hit: 0 };
  assert.deepEqual(drive([{ t: T0, u: blank({ today: heavy }) }], {}).fired[0], ['day.heavy']);
});

test('usage.spike: a fast burn inside the five minute window', () => {
  const { fired } = drive([
    { t: T0, u: blank({ total: b(0, 0) }) },
    { t: T0 + 60000, u: blank({ total: b(500000, 500000) }) },
  ], {});
  assert.deepEqual(fired[1], ['usage.spike']);
});

// The bug this guards: the first full scan of an existing corpus moves the ledger
// from empty to every token ever recorded, in one step. That is not a spike.
test('usage.spike: a freshly built ledger does not read as a spike', () => {
  const { fired } = drive([
    { t: T0, u: blank({ ready: false, total: b(0, 0) }) },
    { t: T0 + 100, u: blank({ total: b(2000000, 2000000) }) },   // the whole corpus lands
    { t: T0 + 600, u: blank({ total: b(2000000, 2000000) }) },
    { t: T0 + 1200, u: blank({ total: b(2000000, 2000000) }) },
  ], {}, { cold: true });
  assert.deepEqual(fired[0], [], 'not ready yet');
  assert.deepEqual(fired[1], [], 'the first ready frame only seeds the baseline');
  assert.deepEqual(fired[2], []);
  assert.deepEqual(fired[3], []);
});

test('usage.spike: the same growth spread over an hour is quiet', () => {
  const { fired } = drive([
    { t: T0, u: blank({ total: b(0, 0) }) },
    { t: T0 + 3600000, u: blank({ total: b(500000, 500000) }) },
  ], {});
  assert.deepEqual(fired[1], []);
});

// ---- gating -----------------------------------------------------------------

test('enabled:false silences everything', () => {
  const { fired, state } = drive([
    { t: T0, u: blank({ ctx: ctx(99) }) },
  ], { enabled: false });
  assert.deepEqual(fired[0], []);
  assert.deepEqual(state.lastFired, {});
});

test('a fresh install with no usage does not warn about an empty context', () => {
  const { fired } = drive([{ t: T0, u: blank({}) }], {});
  assert.deepEqual(fired[0], []);
});

// ---- config -----------------------------------------------------------------

test('sanitize: unknown keys are dropped and numbers are clamped', () => {
  const c = A.sanitize({ ctxWarnPct: 900, turnOutWarn: -5, bogus: 1, enabled: false });
  assert.equal(c.ctxWarnPct, 100);
  assert.equal(c.turnOutWarn, 1000);
  assert.equal(c.bogus, undefined);
  assert.equal(c.enabled, false);
  assert.equal(c.ctxWindow, A.DEFAULT_CFG.ctxWindow, 'defaults survive a partial update');
});

test('sanitize: the critical line can never sit below the warning line', () => {
  const c = A.sanitize({ ctxWarnPct: 90, ctxCritPct: 50 });
  assert.equal(c.ctxCritPct, 90);
});

test('sanitize: junk input yields the defaults', () => {
  assert.deepEqual(A.sanitize(null), A.DEFAULT_CFG);
  assert.deepEqual(A.sanitize('nope'), A.DEFAULT_CFG);
});
