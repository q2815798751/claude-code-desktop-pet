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

// Multi-session reads are deliberately cheaper per file than the single-session
// one: a session only needs its newest line plus its title, and the title lines
// (ai-title / last-prompt) repeat every turn, so they are always in the tail.
const SESSION_TAIL_BYTES = 64 * 1024;
// A tool-heavy turn can append hundreds of KB with no text block at all (every
// assistant line is a tool_use). The first read of a transcript therefore digs
// deeper once, so the detail card can show the conversation's actual prompt;
// later reads inherit it (see snapshotAll) instead of paying for the deep scan
// on every append.
const SESSION_DEEP_TAIL_BYTES = 1024 * 1024;
const SESSION_MAX_AGE_MS = 30 * 60 * 1000; // a transcript untouched this long is not "open"
const SESSION_LIMIT = 5;                   // never read more than this many per tick

// The session detail card in the panel only has room for a couple of lines, so the
// newest assistant/user text is clipped here rather than shipping a whole message
// through SSE on every tick.
const LAST_TEXT_MAX = 240;
const LAST_USER_MAX = 120;

function clipText(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + '…';
}

// Concatenated text blocks of a message. Tool results / tool_use / thinking are
// deliberately excluded: the panel wants something a human wrote or read, not a
// JSON blob. A tool_result carries no `text` block, so an array of only those
// yields '' and the reverse walk keeps looking.
function textBlocks(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const c of content) {
    if (c && c.type === 'text' && typeof c.text === 'string' && c.text.trim()) parts.push(c.text);
  }
  return parts.join(' ').trim();
}

const DEFAULT_DIR = path.join(os.homedir(), '.claude', 'projects');

// Memoised PARSE result, not the finished snapshot: the error window has to be
// re-evaluated against the current clock even when the file has not moved.
let cache = null; // { dir, path, mtimeMs, size, parsed }

// Separate per-file cache for the multi-session path, keyed by path. Same idea:
// only a file whose (mtime,size) moved is re-read and re-parsed, so a steady state
// costs one stat per transcript and no reads at all.
const sessionCache = new Map(); // path -> { mtimeMs, size, parsed }

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

function newestOf(files) {
  let best = null;
  for (const f of files) {
    if (!best || f.mtimeMs > best.mtimeMs) best = f;
  }
  return best;
}

function newestTranscript(dir) {
  return newestOf(listTranscripts(dir));
}

function readTail(file, size, maxBytes) {
  if (!size) return '';
  const start = Math.max(0, size - (maxBytes || TAIL_BYTES));
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
// `meta` is session identity, not state: Claude Code stamps every line with cwd /
// gitBranch / sessionId and periodically rewrites an `ai-title`, which is the only
// human-readable name a session has. All of it comes from the same reverse walk, so
// multi-session support costs no extra parsing.
function parseTail(text) {
  const partial = text.length > 0 && text.charAt(text.length - 1) !== '\n';
  const lines = text.split('\n');
  let msg = null, tool = '', errAt = null, errSeen = false;
  let title = '', slug = '', cwd = '', branch = '', sid = '';
  let lastText = '', lastTextTs = 0, lastUser = '', lastUserTs = 0;

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

    if (!title && o.type === 'ai-title' && o.aiTitle) title = String(o.aiTitle);
    if (!slug && o.slug) slug = String(o.slug);
    if (!cwd && o.cwd) cwd = String(o.cwd);
    if (!branch && o.gitBranch) branch = String(o.gitBranch);
    if (!sid) { if (o.sessionId) sid = String(o.sessionId); else if (o.session_id) sid = String(o.session_id); }

    const role = (o.message && o.message.role) || '';
    const content = o.message && o.message.content;

    // Newest human-facing text in each direction. The panel shows the assistant's
    // last words as "最新反馈"; the user's last prompt is the fallback while a
    // turn is still running and there is no reply yet.
    if (!lastText && (o.type === 'assistant' || role === 'assistant')) {
      const t = textBlocks(content);
      if (t) { lastText = clipText(t, LAST_TEXT_MAX); lastTextTs = hasTs ? ts : 0; }
    }
    if (!lastUser && o.type === 'user' && content) {
      const t = textBlocks(content);
      // `<...>` blocks are Claude Code's injected reminders, not typed input.
      if (t && !/^<[a-z-]+>/i.test(t)) { lastUser = clipText(t, LAST_USER_MAX); lastUserTs = hasTs ? ts : 0; }
    }

    if (!tool) {
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
  return { msg, tool, errAt, partial, title, slug, cwd, branch, sid,
    lastText, lastTextTs, lastUser, lastUserTs };
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

// opts: { dir, now, force, files }
function snapshot(opts) {
  const dir = (opts && opts.dir) || DEFAULT_DIR;
  const now = (opts && opts.now) || Date.now();
  const head = (opts && opts.files) ? newestOf(opts.files) : newestTranscript(dir);

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

// Every session with a transcript written inside `maxAgeMs`, newest first.
//
// This is what backs "show the concurrent conversations": Claude Code writes one
// <sessionId>.jsonl per session, so the recently-touched files ARE the open windows.
// Liveness is judged from the transcript itself rather than from a process probe —
// a process carries no session id, so correlating the two would be guesswork.
//
// opts: { dir, now, force, maxAgeMs, limit, tailBytes, files }
// `files` lets the caller hand in one listTranscripts() result so a tick walks the
// projects tree once instead of once per snapshot function.
function snapshotAll(opts) {
  const dir = (opts && opts.dir) || DEFAULT_DIR;
  const now = (opts && opts.now) || Date.now();
  const maxAge = (opts && opts.maxAgeMs) || SESSION_MAX_AGE_MS;
  const limit = (opts && opts.limit) || SESSION_LIMIT;
  const tailBytes = (opts && opts.tailBytes) || SESSION_TAIL_BYTES;
  const force = !!(opts && opts.force);

  const all = (opts && opts.files) || listTranscripts(dir);
  const live = all
    .filter((f) => now - f.mtimeMs <= maxAge)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);

  // Drop cache entries for sessions that fell out of the window, so a long-lived
  // server does not accumulate a parse per conversation ever held.
  const keep = new Set(live.map((f) => f.path));
  for (const k of sessionCache.keys()) if (!keep.has(k)) sessionCache.delete(k);

  const out = [];
  for (const f of live) {
    let rec = force ? null : sessionCache.get(f.path);
    if (!rec || rec.mtimeMs !== f.mtimeMs || rec.size !== f.size) {
      // First sight (or force) gets the deep window; later appends get the cheap
      // one and inherit whatever text was already found.
      const firstSeen = !rec;
      let parsed;
      try {
        parsed = parseTail(readTail(f.path, f.size, firstSeen ? SESSION_DEEP_TAIL_BYTES : tailBytes));
        if (rec && f.size >= rec.size) {
          // Append-only: the tail may contain no text block at all while claude
          // runs tool after tool, so keep the newest text we already knew about.
          if (!parsed.lastText && rec.parsed.lastText) {
            parsed.lastText = rec.parsed.lastText;
            parsed.lastTextTs = rec.parsed.lastTextTs;
          }
          if (!parsed.lastUser && rec.parsed.lastUser) {
            parsed.lastUser = rec.parsed.lastUser;
            parsed.lastUserTs = rec.parsed.lastUserTs;
          }
        }
      } catch {
        parsed = { msg: null, tool: '', errAt: null, partial: false, title: '', slug: '', cwd: '', branch: '', sid: '',
          lastText: '', lastTextTs: 0, lastUser: '', lastUserTs: 0 };
      }
      rec = { mtimeMs: f.mtimeMs, size: f.size, parsed };
      sessionCache.set(f.path, rec);
    }
    const p = rec.parsed;
    // The file is being appended to right now -> the turn is live, exactly as in
    // the single-session path. `mtime` is the honest activity clock either way.
    let msg = p.msg;
    if (!msg && p.partial) msg = { kind: 'working', ts: f.mtimeMs };

    out.push({
      // The filename IS the session id, and it is the only identifier the hook side
      // can be matched against (via transcript_path). A transcript also carries a
      // snake_case `session_id` that is a DIFFERENT value — do not use it here.
      id: path.basename(f.path, '.jsonl'),
      path: f.path,
      project: p.cwd ? path.basename(p.cwd) : path.basename(path.dirname(f.path)),
      cwd: p.cwd,
      branch: p.branch,
      slug: p.slug,
      title: p.title,
      mtime: f.mtimeMs,
      msg,
      tool: p.tool,
      error: errorOf(p, now),
      // Newest assistant reply / user prompt, already clipped for the panel's
      // expandable session card. lastTs lets the server notice a new message
      // that did not change the session's state or tool.
      lastText: p.lastText || '',
      lastUser: p.lastUser || '',
      lastTs: Math.max(p.lastTextTs || 0, p.lastUserTs || 0),
    });
  }
  return out;
}

function reset() { cache = null; sessionCache.clear(); }

// Test hook: lets a test assert that a session falling out of the window is
// actually evicted rather than accumulating for the life of the process.
function sessionCacheSize() { return sessionCache.size; }

module.exports = {
  snapshot, snapshotAll, reset, newestTranscript, listTranscripts, parseTail, errorOf, classify,
  sessionCacheSize,
  DEFAULT_DIR, TAIL_BYTES, SESSION_TAIL_BYTES, SESSION_MAX_AGE_MS, SESSION_LIMIT, ERROR_WINDOW_MS,
};
