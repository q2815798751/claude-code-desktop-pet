// CLAUDE.PET — token usage ledger.
//
// Claude Code writes `message.usage` on every assistant line:
//   input_tokens / output_tokens / cache_creation_input_tokens / cache_read_input_tokens
// That is the whole data source. No API call, no network, no extra dependency —
// just a read-only walk of ~/.claude/projects, the same tree transcript.js reads.
//
// THE ONE RULE: dedup by `message.id`.
// A single API response is appended as several consecutive lines (one per content
// block: thinking, text, tool_use), each carrying an IDENTICAL `usage` object.
// Measured on a real corpus: 4753 usage lines, 1722 distinct message ids — i.e.
// counting lines instead of messages over-reports by 2.76x. Don't.
//
// Scanning is incremental. Every file keeps a byte watermark (`read`) plus a small
// ring of recently seen ids, so a scan only ever parses the bytes appended since
// the last one. Steady state costs one readdir + N stat calls.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const transcript = require('./transcript');

const DEFAULT_DIR = path.join(os.homedir(), '.claude', 'projects');

const LEDGER_VERSION = 1;
const RECENT_IDS_MAX = 32;        // ring: covers the duplicate run straddling a scan boundary
const DAYS_KEEP = 60;             // day buckets retained in the ledger
const SESSIONS_KEEP = 20;         // session buckets retained
const MAX_FILE_BYTES = 200 * 1024 * 1024; // a transcript bigger than this is read from the tail only
const SPARK_DAYS = 7;
const RECENT_CALLS = 20;          // rolling window behind the cache-hit alert

// Context windows, longest prefix match. Unknown models fall back to cfg.ctxWindow.
const CONTEXT_WINDOWS = [
  ['claude-opus', 200000],
  ['claude-sonnet', 200000],
  ['claude-haiku', 200000],
  ['claude-fable', 200000],
  ['claude-mythos', 200000],
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Compact token counts for a 320px panel. The page keeps its own copy (it is a
// static file with no imports); keep the two in step, same as TOOL_LABELS/TOOL_CN.
function fmtTok(n) {
  const v = Number(n) || 0;
  const trim = (s) => s.replace(/\.0$/, '');
  if (v < 1000) return String(Math.round(v));
  if (v < 1e6) return trim((v / 1000).toFixed(1)) + 'k';
  return trim((v / 1e6).toFixed(1)) + 'M';
}

function emptyAgg() { return { msgs: 0, in: 0, out: 0, cc: 0, cr: 0 }; }

function addAgg(a, r) {
  a.msgs++; a.in += r.in; a.out += r.out; a.cc += r.cc; a.cr += r.cr;
}

function subAgg(a, b) {
  if (!a || !b) return;
  a.msgs -= b.msgs; a.in -= b.in; a.out -= b.out; a.cc -= b.cc; a.cr -= b.cr;
}

function isZero(a) {
  return !a || (a.msgs === 0 && a.in === 0 && a.out === 0 && a.cc === 0 && a.cr === 0);
}

// Local calendar day of a timestamp — the user reads "today" in their own timezone.
function dayKey(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// ---- line parsing -----------------------------------------------------------

// Most lines (user prompts, tool results, metadata) carry no usage at all, so the
// cheap substring test runs before JSON.parse and skips the majority of the corpus.
function parseLine(line) {
  if (line.indexOf('"usage"') === -1) return null;
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  const msg = o.message;
  if (!msg || !msg.id || !msg.usage) return null;
  const u = msg.usage;
  const ts = o.timestamp ? Date.parse(o.timestamp) : NaN;
  return {
    id: String(msg.id),
    ts: Number.isFinite(ts) ? ts : 0,
    model: String(msg.model || ''),
    in: num(u.input_tokens),
    out: num(u.output_tokens),
    cc: num(u.cache_creation_input_tokens),
    cr: num(u.cache_read_input_tokens),
  };
}

// ---- ledger -----------------------------------------------------------------

function newFileRec(e) {
  return {
    size: e.size,
    mtimeMs: e.mtimeMs,
    read: 0,                    // byte watermark: everything before this is counted
    recentIds: [],              // ring of ids already counted, for cross-scan dedup
    session: path.basename(e.path, '.jsonl'),
    agg: emptyAgg(),
    days: {},                   // per-day slice of this file, so a reset can subtract
    sessions: {},               // per-session slice of this file
  };
}

function createLedger() {
  return {
    v: LEDGER_VERSION,
    files: {},
    total: emptyAgg(),
    days: {},
    sessions: {},
    recent: [],                 // last RECENT_CALLS records, for the cache-hit alert
    lastTurn: null,             // { in, out, cc, cr, ts, model, file }
    at: 0,
  };
}

function loadLedger(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && raw.v === LEDGER_VERSION && raw.files && raw.total) {
      return Object.assign(createLedger(), raw);
    }
  } catch { /* missing or corrupt: start from zero */ }
  return createLedger();
}

// Atomic: a half-written ledger would be indistinguishable from a corrupt one.
function saveLedger(file, ledger) {
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(ledger), 'utf8');
    fs.renameSync(tmp, file);
  } catch { /* never fatal — the ledger is a cache, not the source of truth */ }
}

// Drop a file's contribution before recounting it. Every rollup the file fed is
// unwound by exactly what it added, so the totals stay exact without a full rescan.
function forgetFile(ledger, frec) {
  subAgg(ledger.total, frec.agg);
  for (const [d, a] of Object.entries(frec.days)) {
    subAgg(ledger.days[d], a);
    if (isZero(ledger.days[d])) delete ledger.days[d];
  }
  for (const [s, a] of Object.entries(frec.sessions)) {
    subAgg(ledger.sessions[s], a);
    if (isZero(ledger.sessions[s])) delete ledger.sessions[s];
  }
  if (ledger.lastTurn && ledger.lastTurn.file === frec.session) ledger.lastTurn = null;
  // Recent records carry their origin so a rewritten file drops only its own.
  ledger.recent = (ledger.recent || []).filter((r) => r.f !== frec.session);
}

function bucket(map, key) {
  if (!map[key]) map[key] = emptyAgg();
  return map[key];
}

function record(ledger, frec, r) {
  addAgg(frec.agg, r);
  addAgg(ledger.total, r);
  addAgg(bucket(frec.days, dayKey(r.ts)), r);
  addAgg(bucket(ledger.days, dayKey(r.ts)), r);
  addAgg(bucket(frec.sessions, frec.session), r);
  addAgg(bucket(ledger.sessions, frec.session), r);
  const recent = ledger.recent || (ledger.recent = []);
  recent.push({ f: frec.session, in: r.in, out: r.out, cc: r.cc, cr: r.cr });
  while (recent.length > RECENT_CALLS) recent.shift();

  if (!ledger.lastTurn || r.ts >= ledger.lastTurn.ts) {
    ledger.lastTurn = { in: r.in, out: r.out, cc: r.cc, cr: r.cr, ts: r.ts, model: r.model, file: frec.session };
  }
}

function readRange(file, from, to) {
  const len = to - from;
  if (len <= 0) return '';
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, from);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

// Ingest a byte range, stopping at the last newline: a transcript is appended to
// live, so the tail is routinely a half-written line. The watermark must not move
// past it or that line would never be counted.
function ingest(ledger, frec, text) {
  const nl = text.lastIndexOf('\n');
  if (nl < 0) return 0;                 // not one complete line yet
  const lines = text.slice(0, nl + 1).split('\n');
  let lastId = '';                      // batch-local: duplicate runs are consecutive
  for (const line of lines) {
    if (!line) continue;
    const r = parseLine(line);
    if (!r) continue;
    if (r.id === lastId) continue;
    if (frec.recentIds.indexOf(r.id) !== -1) continue;
    lastId = r.id;
    frec.recentIds.push(r.id);
    if (frec.recentIds.length > RECENT_IDS_MAX) frec.recentIds.shift();
    record(ledger, frec, r);
  }
  return nl + 1;
}

function scanOne(ledger, e) {
  let frec = ledger.files[e.path];
  if (!frec) frec = ledger.files[e.path] = newFileRec(e);

  // Shrunk -> the file was rewritten (not appended to). Unwind and recount.
  if (e.size < frec.read) {
    forgetFile(ledger, frec);
    frec = ledger.files[e.path] = newFileRec(e);
  }

  const unchanged = frec._stat && frec._stat.size === e.size && frec._stat.mtimeMs === e.mtimeMs;
  if (unchanged) return false;
  const firstEver = frec.read === 0 && !frec.agg.msgs;

  let changed = false;
  if (e.size > frec.read) {
    // An oversized transcript (never seen here, but don't hang on one) is read
    // from the tail; the partial first line simply fails to parse and is skipped.
    let from = frec.read;
    if (firstEver && e.size > MAX_FILE_BYTES) from = e.size - MAX_FILE_BYTES;
    const text = readRange(e.path, from, e.size);
    const consumed = ingest(ledger, frec, text);
    frec.read = from + consumed;
    changed = consumed > 0;
  }
  frec._stat = { size: e.size, mtimeMs: e.mtimeMs };
  return changed;
}

function prune(ledger) {
  const days = Object.keys(ledger.days).sort();
  while (days.length > DAYS_KEEP) delete ledger.days[days.shift()];

  const sess = Object.entries(ledger.sessions);
  if (sess.length > SESSIONS_KEEP) {
    // Sessions carry no timestamp of their own; use the newest file that wrote to
    // each one, falling back to insertion order for a session with no file left.
    const lastAt = {};
    for (const f of Object.values(ledger.files)) {
      if (!f._stat) continue;
      lastAt[f.session] = Math.max(lastAt[f.session] || 0, f._stat.mtimeMs);
    }
    sess.sort((a, b) => (lastAt[a[0]] || 0) - (lastAt[b[0]] || 0));
    while (sess.length > SESSIONS_KEEP) delete ledger.sessions[sess.shift()[0]];
  }
}

// A stepping scanner: the caller decides how long each slice may block for, so the
// first (full) pass can be spread across several event-loop turns instead of
// stalling the 500ms tick. Subsequent passes finish in the first slice.
function createScanner(opts) {
  const dir = (opts && opts.dir) || DEFAULT_DIR;
  const ledger = (opts && opts.ledger) || createLedger();
  let queue = null, i = 0;

  function step(budgetMs) {
    const t0 = Date.now();
    if (!queue) {
      queue = transcript.listTranscripts(dir);
      // Whole directories disappear when a project is cleaned up; drop their bytes.
      const alive = new Set(queue.map((e) => e.path));
      for (const [p, frec] of Object.entries(ledger.files)) {
        if (!alive.has(p)) { forgetFile(ledger, frec); delete ledger.files[p]; }
      }
      i = 0;
    }
    const total = queue.length;
    let changed = false;
    while (i < queue.length) {
      if (scanOne(ledger, queue[i++])) changed = true;
      if (Date.now() - t0 >= budgetMs) break;
    }
    const done = i >= queue.length;
    if (done) { prune(ledger); ledger.at = Date.now(); queue = null; i = 0; }
    return { done, changed, processed: done ? total : i, total };
  }

  return { step, ledger, dir };
}

// ---- snapshot ---------------------------------------------------------------

function hitPct(a) {
  const denom = a.cr + a.cc + a.in;
  if (!denom) return null;
  return Math.round((a.cr / denom) * 100);
}

function bucketOut(a) {
  return {
    in: a.in, out: a.out, cc: a.cc, cr: a.cr, msgs: a.msgs,
    input: a.in + a.cc + a.cr,   // everything actually sent to the model
    hit: hitPct(a),
  };
}

function windowFor(model, fallback) {
  const m = String(model || '').toLowerCase();
  for (const [prefix, size] of CONTEXT_WINDOWS) if (m.startsWith(prefix)) return size;
  return fallback;
}

// `session` is the transcript the pet is currently watching, so "本次" means the
// same session the panel is reporting on — not merely the last file to be written.
function snapshot(ledger, opts) {
  const cfg = (opts && opts.cfg) || {};
  const sessionId = (opts && opts.session) || null;
  const last = ledger.lastTurn;

  const ctxTokens = last ? last.in + last.cc + last.cr + last.out : 0;
  // A transcript can outgrow the configured window (a proxy model, a wrong setting).
  // Never render more than 100%: widen the denominator to what was actually used.
  let win = windowFor(last && last.model, cfg.ctxWindow || 200000);
  if (ctxTokens > win) win = ctxTokens;

  const day = dayKey((opts && opts.now) || Date.now());
  const spark = [];
  const base = (opts && opts.now) || Date.now();
  for (let k = SPARK_DAYS - 1; k >= 0; k--) {
    const key = dayKey(base - k * 86400000);
    const a = ledger.days[key];
    spark.push({ day: key, tokens: a ? a.in + a.out + a.cc + a.cr : 0 });
  }

  const empty = emptyAgg();
  const recentAgg = emptyAgg();
  for (const r of ledger.recent || []) addAgg(recentAgg, r);

  return {
    ready: !!(opts && opts.ready),
    model: (last && last.model) || '',
    session: bucketOut((sessionId && ledger.sessions[sessionId]) || empty),
    today: bucketOut(ledger.days[day] || empty),
    total: bucketOut(ledger.total),
    lastTurn: last ? { in: last.in, out: last.out, cc: last.cc, cr: last.cr, ts: last.ts } : null,
    recent: bucketOut(recentAgg),
    ctx: {
      tokens: ctxTokens,
      window: win,
      pct: win ? Math.min(100, Math.round((ctxTokens / win) * 100)) : 0,
    },
    spark,
    at: ledger.at,
  };
}

module.exports = {
  DEFAULT_DIR, LEDGER_VERSION, SPARK_DAYS, RECENT_IDS_MAX, MAX_FILE_BYTES,
  emptyAgg, addAgg, dayKey, hitPct, fmtTok,
  parseLine, ingest, scanOne, createLedger, loadLedger, saveLedger,
  createScanner, snapshot,
};
