// CLAUDE.PET — usage alerts. Pure: state in, state out, no IO, no timers.
// See alerts.test.js.
//
// Edge-triggered, deliberately. The v2.0.0 post-mortem in CHANGELOG.md is about a
// state that beeped twice a second for as long as it lasted; an alert that keeps
// re-firing while the token count sits above a line would be the same bug wearing
// a hat. So a rule fires on the rising edge only, and re-arms when the reading
// falls back below it. `cooldownMs` is the floor between two firings of one rule,
// for the case where the reading flaps across the line.
'use strict';

const { fmtTok } = require('./usage');

const DEFAULT_CFG = {
  enabled: true,
  ctxWarnPct: 80,          // context window used, warn
  ctxCritPct: 92,          // context window used, critical
  turnOutWarn: 30000,      // output tokens in a single turn
  cacheHitWarnPct: 40,     // cache hit rate below this, with enough input to matter
  cacheMinInput: 50000,
  dayTokWarn: 2000000,     // tokens in one calendar day
  spikeTokWarn: 500000,    // tokens added within SPIKE_WINDOW_MS
  ctxWindow: 200000,       // assumed context window for an unrecognised model
  cooldownMs: 600000,
};

const SPIKE_WINDOW_MS = 300000;   // "right now" = the last five minutes
const SAMPLE_MS = 10000;          // how often a spike sample is taken
const SAMPLE_KEEP_MS = 900000;
const MIN_SPIKE_SPAN_MS = 60000;  // no rate reading until the samples cover this much
const RECENT_MS = 20000;          // a fired alert stays in the payload this long

// A critical alert must not nag: it is the one most likely to sit true for a while.
const CRIT_COOLDOWN_MS = 1800000;

const RULES = [
  {
    id: 'ctx.crit', level: 'crit', title: '上下文将满',
    test: (u, c) => u.ctx.tokens > 0 && u.ctx.pct >= c.ctxCritPct,
    detail: (u) => '已用 ' + fmtTok(u.ctx.tokens) + ' / ' + fmtTok(u.ctx.window) + ' · ' + u.ctx.pct + '%',
  },
  {
    id: 'ctx.warn', level: 'warn', title: '上下文偏满',
    test: (u, c) => u.ctx.tokens > 0 && u.ctx.pct >= c.ctxWarnPct,
    detail: (u) => '已用 ' + fmtTok(u.ctx.tokens) + ' / ' + fmtTok(u.ctx.window) + ' · ' + u.ctx.pct + '%',
    suppressedBy: 'ctx.crit',
  },
  {
    id: 'turn.big', level: 'warn', title: '单回合输出偏大',
    test: (u, c) => u.lastTurn && u.lastTurn.out >= c.turnOutWarn,
    detail: (u) => '本次输出 ' + fmtTok(u.lastTurn.out) + ' tokens',
  },
  {
    id: 'cache.low', level: 'warn', title: '缓存命中偏低',
    test: (u, c) => u.recent &&
      u.recent.hit !== null && u.recent.hit < c.cacheHitWarnPct &&
      u.recent.input >= c.cacheMinInput,
    detail: (u) => '近 ' + u.recent.msgs + ' 次调用命中 ' + u.recent.hit + '%，输入 ' + fmtTok(u.recent.input),
  },
  {
    id: 'day.heavy', level: 'warn', title: '今日用量偏高',
    test: (u, c) => (u.today.in + u.today.out + u.today.cc + u.today.cr) >= c.dayTokWarn,
    detail: (u) => '今日 ' + fmtTok(u.today.in + u.today.out + u.today.cc + u.today.cr) + ' tokens',
  },
  {
    id: 'usage.spike', level: 'warn', title: '用量激增',
    test: (u, c, s) => spikeOf(s) >= c.spikeTokWarn,
    detail: (u, c, s) => '5 分钟内新增 ' + fmtTok(spikeOf(s)) + ' tokens',
  },
];

function totalOf(a) { return (a.in + a.out + a.cc + a.cr) || 0; }

// Oldest sample still inside the spike window; the delta against it is the rate.
function spikeOf(state) {
  const cutoff = state.now - SPIKE_WINDOW_MS;
  let oldest = null;
  for (const s of state.samples) {
    if (s.ts >= cutoff) { oldest = s; break; }
  }
  if (!oldest || oldest.ts >= state.now - 1000) return 0;
  // Too short a baseline to call anything a rate. Without this the very first scan
  // of an existing corpus reads as an enormous spike: the ledger goes from empty to
  // every token ever recorded in one step.
  if (oldest.ts > state.now - MIN_SPIKE_SPAN_MS) return 0;
  return Math.max(0, state.tokens - oldest.tokens);
}

function createState() {
  return { armed: {}, lastFired: {}, samples: [], tokens: 0, now: 0, ready: false };
}

function pushSample(state, tokens, now) {
  const last = state.samples[state.samples.length - 1];
  if (!last || now - last.ts >= SAMPLE_MS) state.samples.push({ ts: now, tokens });
  state.samples = state.samples.filter((s) => now - s.ts <= SAMPLE_KEEP_MS);
}

// usage: the snapshot from usage.snapshot(); cfg: a sanitized config.usage.
// Returns the new state plus the alert list the page should be showing.
function reduce(prev, usage, now, cfg) {
  const c = Object.assign({}, DEFAULT_CFG, cfg);
  const st = {
    armed: Object.assign({}, prev && prev.armed),
    lastFired: Object.assign({}, prev && prev.lastFired),
    samples: (prev && prev.samples) ? prev.samples.slice() : [],
    tokens: totalOf((usage && usage.total) || {}),
    now,
  };
  const idle = { armed: {}, lastFired: {}, samples: st.samples, tokens: st.tokens, now, ready: false };
  if (c.enabled === false) return { state: idle, alerts: [] };

  // The frame the ledger first becomes ready is the one where it was just built
  // from the whole corpus. Seed the baseline from here rather than comparing
  // against the empty ledger, and stay quiet for that single frame.
  const firstReady = !(prev && prev.ready);
  if (!usage || !usage.ready || firstReady) {
    return {
      state: { armed: {}, lastFired: {}, samples: [{ ts: now, tokens: st.tokens }], tokens: st.tokens, now, ready: !!usage && !!usage.ready },
      alerts: [],
    };
  }

  pushSample(st, st.tokens, now);
  st.now = now;
  st.ready = true;

  const live = {};
  for (const r of RULES) {
    if (r.suppressedBy && live[r.suppressedBy]) { st.armed[r.id] = true; continue; }
    let on = false;
    try { on = !!r.test(usage, c, st); } catch { on = false; }

    if (!on) { st.armed[r.id] = true; continue; }

    live[r.id] = true;
    const last = st.lastFired[r.id] || 0;
    const cd = r.id === 'ctx.crit' ? CRIT_COOLDOWN_MS : c.cooldownMs;
    // Cooldown blocks the firing but leaves the rule armed, so a reading that
    // stays high still gets announced once the floor has passed.
    if (st.armed[r.id] !== false && now - last >= cd) {
      st.lastFired[r.id] = now;
      st.armed[r.id] = false;
    }
  }

  const alerts = [];
  for (const r of RULES) {
    const firedAt = st.lastFired[r.id] || 0;
    const active = !!live[r.id];
    if (!active && !(firedAt && now - firedAt < RECENT_MS)) continue;
    alerts.push({
      id: r.id,
      level: r.level,
      title: r.title,
      detail: safeDetail(r, usage, c, st),
      active,
      firedAt,
    });
  }
  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'crit' ? -1 : 1));
  return { state: st, alerts };
}

function safeDetail(rule, usage, cfg, st) {
  try { return rule.detail(usage, cfg, st) || ''; } catch { return ''; }
}

// The page POSTs a partial config; only these keys are accepted, and every number
// is clamped to something that cannot make the panel lie or divide by zero.
const LIMITS = {
  ctxWarnPct: [1, 100],
  ctxCritPct: [1, 100],
  turnOutWarn: [1000, 100000000],
  cacheHitWarnPct: [0, 100],
  cacheMinInput: [0, 100000000],
  dayTokWarn: [10000, 10000000000],
  spikeTokWarn: [10000, 10000000000],
  ctxWindow: [1000, 100000000],
  cooldownMs: [60000, 86400000],
};

function sanitize(raw) {
  const out = Object.assign({}, DEFAULT_CFG);
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(raw[k]);
    if (Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  // The critical line must sit at or above the warning line, or the warning could
  // never be suppressed by it.
  if (out.ctxCritPct < out.ctxWarnPct) out.ctxCritPct = out.ctxWarnPct;
  return out;
}

module.exports = { DEFAULT_CFG, RULES, SPIKE_WINDOW_MS, RECENT_MS, createState, reduce, sanitize };
