// CLAUDE.PET — transcript reader.
//
// One directory scan and one tail read per call, memoised until the newest
// .jsonl actually changes. The server used to re-scan ~/.claude/projects four
// times per poll (and again on every /api/state hit); everything now comes from
// a single snapshot.
//
// Claude Code appends one JSONL line per message EVENT (user input, tool_result,
// assistant thinking/text/tool_use) but does NOT write during long text
// streaming, so the newest line tells us the phase: working markers mean claude
// is mid-turn, a pure-text assistant line means the turn finished.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const TAIL_BYTES = 256 * 1024;   // window read from the end of the newest transcript
const ERROR_WINDOW_MS = 30000;

const DEFAULT_DIR = path.join(os.homedir(), '.claude', 'projects');

// Memoised PARSE result, not the finished snapshot: the error window has to be
// re-evaluated against the current clock even when the file has not moved.
let cache = null; // { dir, path, mtimeMs, size, parsed }

// Every .jsonl under <dir>/<project>/, with the stat each caller needs. Shared
// with usage.js so the projects tree is walked one way, not two.
function listTranscripts(dir) {
  const out = [];
  let projects;
  try { projects = fs.readdirSync(dir); } catch { return out; }
  for (const proj of projects) {
    const d = path.join(dir, proj);
    let files;
    try {
      if (!fs.statSync(d).isDirectory()) continue;
      files = fs.readdirSync(d);
    } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(d, f);
      try {
        const st = fs.statSync(p);
        out.push({ path: p, mtimeMs: st.mtimeMs, size: st.size });
      } catch { /* raced with a write */ }
    }
  }
  return out;
}

function newestTranscript(dir) {
  let best = null;
  for (const f of listTranscripts(dir)) {
    if (!best || f.mtimeMs > best.mtimeMs) best = f;
  }
  return best;
}

function readTail(file, size) {
  if (!size) return '';
  const start = Math.max(0, size - TAIL_BYTES);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

function classify(o) {
  const t = o.type || '';
  const role = (o.message && o.message.role) || '';
  const content = o.message && o.message.content;
  const kinds = Array.isArray(content) ? content.map((c) => (c && c.type) || '') : [];
  if (t === 'user') return 'working'; // input or tool_result -> claude is mid-turn
  if (t === 'assistant' || role === 'assistant') {
    if (kinds.includes('thinking') || kinds.includes('tool_use')) return 'working';
    if (kinds.includes('text')) {
      const nonText = kinds.filter((k) => k && k !== 'text');
      return nonText.length === 0 ? 'done' : 'working'; // pure text = turn finished
    }
    return 'working';
  }
  return null; // metadata / other lines are skipped
}

// One reverse walk collects the newest message, the newest tool_use and the
// newest error flag at once. Time-independent: the error window is applied
// later by errorOf(), so the result stays valid across cache hits.
function parseTail(text) {
  const partial = text.length > 0 && text.charAt(text.length - 1) !== '\n';
  const lines = text.split('\n');
  let msg = null, tool = '', errAt = null, errSeen = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const ts = o.timestamp ? new Date(o.timestamp).getTime() : NaN;
    const hasTs = Number.isFinite(ts);

    // the newest error line decides — an older one must not resurrect an error
    if (!errSeen && /"isError"\s*:\s*true/.test(line)) {
      errSeen = true;
      errAt = hasTs ? ts : null;
    }

    if (!tool) {
      const content = o.message && o.message.content;
      if (Array.isArray(content)) {
        for (let j = content.length - 1; j >= 0; j--) {
          const c = content[j];
          if (c && c.type === 'tool_use' && c.name) { tool = c.name; break; }
        }
      }
    }

    if (!msg && hasTs) {
      const kind = classify(o);
      if (kind) msg = { kind, ts };
    }
  }
  return { msg, tool, errAt, partial };
}

// A tool failure stays on screen while it is the newest thing that happened,
// and never longer than ERROR_WINDOW_MS. Once claude produces a newer event it
// has recovered, so the pet stops shouting.
function errorOf(parsed, now) {
  if (!parsed || !parsed.errAt) return null;
  if (now - parsed.errAt > ERROR_WINDOW_MS) return null;
  if (parsed.msg && parsed.msg.ts > parsed.errAt) return null;
  return { at: parsed.errAt };
}

// opts: { dir, now, force }
function snapshot(opts) {
  const dir = (opts && opts.dir) || DEFAULT_DIR;
  const now = (opts && opts.now) || Date.now();
  const head = newestTranscript(dir);

  if (!head) {
    cache = null;
    return { path: null, mtime: 0, msg: null, tool: '', error: null };
  }

  let parsed;
  if (cache && !(opts && opts.force) && cache.dir === dir && cache.path === head.path
      && cache.mtimeMs === head.mtimeMs && cache.size === head.size) {
    parsed = cache.parsed;
  } else {
    try {
      parsed = parseTail(readTail(head.path, head.size));
    } catch {
      parsed = { msg: null, tool: '', errAt: null, partial: false };
    }
    cache = { dir, path: head.path, mtimeMs: head.mtimeMs, size: head.size, parsed };
  }

  let msg = parsed.msg;
  if (!msg && parsed.partial) msg = { kind: 'working', ts: now }; // mid-append = actively writing

  return { path: head.path, mtime: head.mtimeMs, msg, tool: parsed.tool, error: errorOf(parsed, now) };
}

function reset() { cache = null; }

module.exports = {
  snapshot, reset, newestTranscript, listTranscripts, parseTail, errorOf, classify,
  DEFAULT_DIR, TAIL_BYTES, ERROR_WINDOW_MS,
};
