// CLAUDE.PET — pure state machine. No IO, no timers, no module globals.
// Everything it needs is passed in as `facts`; every call returns a NEW machine
// object. That is what makes the pet's behaviour testable: feed facts, assert states.
// See state.test.js.
'use strict';

const DEFAULTS = {
  THINK_MS: 5000,           // transcript-only: first 5s of a turn reads as "thinking"
  WORK_MS: 30000,           // a turn longer than this is presented as long-running
  DONE_HOLD_MS: 5000,       // "done" flashes this long after a turn ends
  STALE_MS: 600000,         // a working marker older than this is not really active
  ERROR_WINDOW_MS: 30000,   // a tool error inside this window drives "error"
  ATTENTION_HOLD_MS: 30000, // a "waiting for you" nudge holds this long
  SESSION_TTL_MS: 7200000,  // hooked session with no events for 2h is dropped
  DEAD_GRACE_MS: 90000,     // hooked session idle this long + probe says gone -> offline
  ACTIVITY_FRESH_MS: 10000, // activity this recent proves claude is alive (skip the probe)
  PROBE_INTERVAL_MS: 8000,  // how often the process probe may run
};

// offline   no claude anywhere
// idle      claude is up, waiting for you to type
// thinking  the model is generating (no tool running)
// working   a tool is executing — `tool` carries its name
// awaiting  claude is blocked on you (permission prompt / idle nudge)
// done      a turn just finished (flashes, then falls back to idle)
// error     a tool failed within ERROR_WINDOW_MS
const STATES = ['offline', 'idle', 'thinking', 'working', 'awaiting', 'done', 'error'];

function initState(now) {
  return {
    state: 'offline',
    since: now,
    tool: null,        // tool name while state === 'working'
    long: false,       // turn exceeded WORK_MS -> long-running presentation
    wasWorking: false,
    turnStart: 0,
    doneUntil: 0,
    awaitingUntil: 0,
  };
}

function commit(m, s, now) {
  if (m.state !== s) { m.state = s; m.since = now; }
  return m;
}

// Is claude running?
// With hooks installed we know the live sessions directly, so the (comparatively
// expensive) process probe only has to settle the ambiguous case: a session that
// has gone quiet. Without hooks we fall back to the probe alone, as before.
function computeAlive(f) {
  const sessions = f.hookSessions || [];
  if (sessions.length) {
    let last = 0;
    for (const s of sessions) if (s.lastAt > last) last = s.lastAt;
    if (f.now - last < DEFAULTS.DEAD_GRACE_MS) return true; // recent hook traffic
    if (f.procAlive === null || f.procAlive === undefined) return true; // unknown: stay optimistic
    return !!f.procAlive; // quiet session — let the probe decide
  }
  return f.procAlive === true;
}

// facts = {
//   now, claudeAlive, shuttingDown, forced,
//   activity: { kind: 'thinking'|'working'|'done'|'awaiting', ts, tool, src: 'hook'|'transcript' } | null,
//   error:    { at } | null,
// }
function reduce(prev, f, cfg) {
  const c = cfg || DEFAULTS;
  const now = f.now;
  const m = Object.assign({}, prev);

  const flat = () => { m.wasWorking = false; m.tool = null; m.long = false; };

  if (f.shuttingDown) { flat(); return commit(m, 'offline', now); }

  if (f.forced) { flat(); return commit(m, f.forced, now); }

  // a recent tool failure outranks every working state — but only while claude lives
  if (f.error && f.claudeAlive) { flat(); return commit(m, 'error', now); }

  if (!f.claudeAlive) { flat(); return commit(m, 'offline', now); }

  const a = f.activity;
  if (!a) { flat(); return commit(m, 'idle', now); } // claude up, nothing to report yet

  if (a.kind === 'done') {
    if (m.wasWorking) { m.doneUntil = now + c.DONE_HOLD_MS; m.wasWorking = false; }
    m.awaitingUntil = 0;
    m.tool = null; m.long = false;
    return commit(m, now < m.doneUntil ? 'done' : 'idle', now);
  }

  // "claude needs you" — hold it so a transcript tick can't immediately clobber it.
  // The turn is still in flight while you answer, so wasWorking/turnStart stay put:
  // otherwise the Stop that follows a prompt would not flash "done".
  if (a.kind === 'awaiting') {
    m.awaitingUntil = now + c.ATTENTION_HOLD_MS;
    m.tool = null; m.long = false;
    return commit(m, 'awaiting', now);
  }
  if (m.awaitingUntil && now < m.awaitingUntil && a.src !== 'hook') {
    m.tool = null; m.long = false;
    return commit(m, 'awaiting', now);
  }
  m.awaitingUntil = 0;

  // working marker: the model is generating, or a tool is executing
  if (a.ts && (now - a.ts) > c.STALE_MS) { flat(); return commit(m, 'idle', now); }
  if (!m.wasWorking) { m.turnStart = a.ts || now; m.wasWorking = true; }
  m.long = (now - m.turnStart) > c.WORK_MS;

  if (a.tool) { m.tool = a.tool; return commit(m, 'working', now); }

  // No tool name. A hook event means the model itself is generating; from the
  // transcript we only have the age of the turn to go on.
  m.tool = null;
  const dur = now - m.turnStart;
  return commit(m, (a.src === 'hook' || dur < c.THINK_MS) ? 'thinking' : 'working', now);
}

module.exports = { DEFAULTS, STATES, initState, reduce, computeAlive };
