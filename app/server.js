// CLAUDE.PET server — zero external dependencies (Node built-ins only)
// Windows desktop pet that reflects claude code CLI working state.
// HTTP server @127.0.0.1:9876, SSR injects init state, client follows /events (SSE).
//
// Signals, best first:
//   1. Claude Code hooks POSTed to /event  — exact phase, zero polling cost
//   2. the newest transcript in ~/.claude/projects — works with no hooks installed
//   3. a process probe — only to settle "is an idle session still there?"
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile } = require('child_process');
const st = require('./state');
const transcript = require('./transcript');
const { safeJson } = require('./util');

const ROOT = __dirname;
const HTML_FILE = path.join(ROOT, 'pet.html');
const PS_FILE = path.join(ROOT, 'pet.ps1');
const TERM_PID_FILE = path.join(ROOT, 'term.pid');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const RUNTIME_FILE = path.join(ROOT, 'runtime.ini');
const PROJECTS_DIR = transcript.DEFAULT_DIR;

const PORT = parseInt(process.env.CLAUDEPET_PORT, 10) || 9876;
const HOST = '127.0.0.1';
// Only for running a second pet next to a live one (tests). The host window and
// notify.cmd both point at 9876, so leave it alone in normal use.
const ORIGINS = [`${HOST}:${PORT}`, `localhost:${PORT}`];

// state thresholds (ms)
const DONE_HOLD_MS = 5000;     // done state holds 5s
const SHUTDOWN_HOLD_MS = 2500; // self-exit within 5s of terminal death
const WINDOW_STALE_MS = 5000;  // pet window considered alive if seen within 5s
const PROBE_INTERVAL_MS = 8000;// re-run the process probe at most every 8s
const HEARTBEAT_MS = 15000;    // SSE keep-alive

const CFG = Object.assign({}, st.DEFAULTS, {
  DONE_HOLD_MS,
  SESSION_TTL_MS: st.DEFAULTS.SESSION_TTL_MS,
  DEAD_GRACE_MS: st.DEFAULTS.DEAD_GRACE_MS,
  ACTIVITY_FRESH_MS: st.DEFAULTS.ACTIVITY_FRESH_MS,
});

const GIF_EXT = { '.gif': 'image/gif', '.png': 'image/png', '.ico': 'image/x-icon' };

// The most recent tool action (for the "现在在做什么" line).
const TOOL_LABELS = {
  Bash: '运行 Bash', Edit: '编辑文件', Read: '读取文件', Write: '写文件',
  Glob: '查找文件', Grep: '搜索代码', NotebookEdit: '编辑笔记', WebSearch: '联网搜索',
  WebFetch: '抓取网页', Agent: '调用子代理', TaskCreate: '创建任务', TodoWrite: '更新任务',
  Skill: '调用技能',
};

// ---- mutable state ----
let pet = st.initState(Date.now());
// Last complete fact set handed to the reducer. /api/debug re-reduces against
// this instead of a partial one, so forcing a state can't accidentally wipe the
// live signal (a missing claudeAlive reads as "offline").
let lastFacts = { now: Date.now(), claudeAlive: false, shuttingDown: false, forced: null, activity: null, error: null };
let forced = null;             // debug override: a state name, or null for auto
let shuttingDown = false;
let shutdownAt = 0;
let lastActivity = 0;
let lastAction = '';
let lastError = null;
let windowSeenAt = 0;

// process probe
let procAlive = null;          // null = not probed yet
let lastProbeAt = 0;

// hook sessions
const hookSessions = new Map(); // session_id -> lastAt
let hookEnabled = false;        // a hook event has been received at least once
let lastHookAt = 0;
let lastHookActivity = null;    // { kind, ts, tool }

// ---- persisted UI config (server is the single source of truth) ----
let config = { theme: 'cyber', fs: 1 };
try { config = Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))); } catch {}
function saveConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config), 'utf8'); } catch {}
}

// runtime paths (node/claude) written by the installer so the pet works
// even when PATH has no node/claude. Key=value ASCII in app/runtime.ini.
function readRuntimeIni() {
  const map = {};
  try {
    const t = fs.readFileSync(RUNTIME_FILE, 'utf8').split(/\r?\n/);
    for (const line of t) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) map[m[1].toUpperCase()] = m[2];
    }
  } catch {}
  return map;
}
const runtime = readRuntimeIni();

// ---- tiny helpers ----
function readTermPid() {
  try {
    const s = fs.readFileSync(TERM_PID_FILE, 'utf8').trim();
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}
let termPid = readTermPid();
let termAlive = null;


// ---- process probe (only to settle a quiet session; skipped while active) ----
function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      resolve(err ? '' : (stdout || ''));
    });
  });
}

function probeClaude() {
  // claude.exe (native / WinGet) OR node.exe running the Claude Code CLI (npm install).
  // Exclude our own server process (command line contains 'server.js') so an install
  // under a path like ...\ClaudePet\app\server.js is never a false positive.
  return new Promise((resolve) => {
    execFile('powershell.exe', [
      '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
      "$m = Get-CimInstance Win32_Process | Where-Object { ( $_.Name -eq 'claude.exe' ) -or ( $_.Name -eq 'node.exe' -and $_.CommandLine -match 'claude-code|@anthropic-ai|cli\\.js' -and $_.CommandLine -notmatch 'server\\.js' ) }; if ( $m ) { '1' } else { '0' }"
    ], { windowsHide: true, timeout: 5000 }, (err, out) => {
      resolve(!err && /1/.test((out || '').trim()));
    });
  });
}

function pidAliveCheck(pid) {
  return run(`tasklist /FI "PID eq ${pid}" /NH`)
    .then((out) => out.includes(String(pid)));
}

// A transcript write within the freshness window proves claude is running, so the
// probe is skipped entirely while claude is actually working. That is when the
// probe would have been pure waste — and it is the common case.
function shouldProbe(now) {
  if (lastHookAt && now - lastHookAt < CFG.ACTIVITY_FRESH_MS) return false;
  if (lastActivity && now - lastActivity < CFG.ACTIVITY_FRESH_MS) return false;
  return now - lastProbeAt > PROBE_INTERVAL_MS;
}

async function updateProcesses(now) {
  if (!shouldProbe(now)) {
    if (lastHookAt && now - lastHookAt < CFG.ACTIVITY_FRESH_MS) procAlive = true;
    else if (lastActivity && now - lastActivity < CFG.ACTIVITY_FRESH_MS) procAlive = true;
  } else {
    lastProbeAt = now;
    const tasks = [probeClaude()];
    if (termPid) tasks.push(pidAliveCheck(termPid));
    const [c, t] = await Promise.all(tasks);
    procAlive = !!c;
    if (termPid) termAlive = !!t;
  }
}

// ---- hook events ----
function pruneSessions(now) {
  for (const [id, at] of hookSessions) {
    if (now - at > CFG.SESSION_TTL_MS) hookSessions.delete(id);
  }
}

function onHookEvent(body, now) {
  const name = String(body.hook_event_name || '');
  const sid = String(body.session_id || '');
  hookEnabled = true;
  lastHookAt = now;

  if (name === 'SessionEnd') {
    if (sid) hookSessions.delete(sid);
    if (!hookSessions.size) { lastHookActivity = null; lastProbeAt = 0; } // re-probe now
  } else if (sid) {
    hookSessions.set(sid, now);
  }

  switch (name) {
    case 'SessionStart':     lastHookActivity = null; break;
    case 'UserPromptSubmit': lastHookActivity = { kind: 'thinking', ts: now, tool: '' }; break;
    case 'PreToolUse':       lastHookActivity = { kind: 'working', ts: now, tool: String(body.tool_name || '') }; break;
    case 'PostToolUse':      lastHookActivity = { kind: 'thinking', ts: now, tool: '' }; break;
    case 'Notification':     lastHookActivity = { kind: 'awaiting', ts: now, tool: '' }; break;
    case 'Stop':
    case 'SubagentStop':     lastHookActivity = { kind: 'done', ts: now, tool: '' }; break;
    case 'SessionEnd':       lastHookActivity = null; break;
    default: break;
  }
}

// Hooks know the phase exactly; the transcript is the fallback.
//
// A fresh hook event is authoritative. Comparing timestamps alone is not enough:
// the transcript line for the same moment is written at almost the same instant,
// so a few hundred ms of skew would let the coarse transcript reading shadow the
// precise hook one — and the tool name would flicker away. Once the hooks go
// quiet (not installed, or another session is the one writing) whichever saw
// something more recently wins.
const HOOK_PREF_MS = 3000;
function currentActivity(snap, now) {
  const fromTranscript = snap.msg
    ? { kind: snap.msg.kind, ts: snap.msg.ts, tool: '', src: 'transcript' }
    : null;
  if (lastHookActivity) {
    if (now - lastHookActivity.ts < HOOK_PREF_MS) return Object.assign({ src: 'hook' }, lastHookActivity);
    if (!fromTranscript || lastHookActivity.ts >= fromTranscript.ts) {
      return Object.assign({ src: 'hook' }, lastHookActivity);
    }
  }
  return fromTranscript;
}

// ---- poll loop ----
function beginShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownAt = Date.now();
  lastFacts = Object.assign({}, lastFacts, { now: shutdownAt, shuttingDown: true });
  pet = st.reduce(pet, lastFacts, CFG);
  broadcast(true);
  // graceful: client sees shutdown:true and calls host Close + window.close();
  // fallback: force-close the pet host window so it never lingers.
  setTimeout(killPetWindow, 800);
}

function killPetWindow() {
  execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
    "Get-Process -Name 'ClaudePet.Host' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"
  ], { windowsHide: true }, () => {});
}

function windowActive() {
  return sseClients.size > 0 || (Date.now() - windowSeenAt) < WINDOW_STALE_MS;
}

// ---- PowerShell window ops (execFile avoids cmd mangling of Unicode paths) ----
function psRun(action, pid) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', PS_FILE, '-Action', action];
  if (pid) args.push('-ProcId', String(pid));
  execFile('powershell.exe', args, { windowsHide: true }, (err, so, se) => {
    if (err || (se && se.trim())) console.log('[ps:' + action + ']', err && err.message, se && se.trim().split('\n').slice(0, 3).join(' | '));
  });
}

async function tick() {
  const now = Date.now();

  // adopt a (possibly new) terminal pid written by start-both.bat
  const newPid = readTermPid();
  if (newPid !== termPid) {
    termPid = newPid;
    termAlive = null;          // unknown until checked
    lastProbeAt = 0;           // force a probe this tick
  }
  if (termPid && termAlive === null) lastProbeAt = 0;

  pruneSessions(now);

  const snap = transcript.snapshot({ now });
  const activity = currentActivity(snap, now);
  const actTs = Math.max(snap.mtime, lastHookAt, snap.msg ? snap.msg.ts : 0);
  if (actTs) lastActivity = actTs;
  lastError = snap.error;
  lastAction = (activity && activity.tool) ? activity.tool : (snap.tool || '');

  await updateProcesses(now);

  const alive = st.computeAlive({
    now,
    procAlive,
    hookSessions: [...hookSessions].map(([id, at]) => ({ id, lastAt: at })),
  });

  lastFacts = {
    now,
    claudeAlive: alive,
    shuttingDown,
    forced,
    activity,
    error: lastError,
  };
  pet = st.reduce(pet, lastFacts, CFG);

  broadcast(false);

  // terminal died -> pet self-exits within 5s (only when we know it is dead)
  if (!shuttingDown && termPid && termAlive === false) beginShutdown();
  if (shuttingDown && now - shutdownAt >= SHUTDOWN_HOLD_MS) process.exit(0);
}

setInterval(() => { tick().catch(() => {}); }, 500);

// ---- HTTP ----
function stateJson() {
  const now = Date.now();
  return {
    state: pet.state,
    since: pet.since,
    tool: pet.tool || '',
    long: !!pet.long,
    lastActivity,
    ageMs: Math.max(0, now - lastActivity),
    claude: !!lastFacts.claudeAlive,
    hooked: hookEnabled,
    term: termPid,
    termAlive: termAlive === null ? null : !!termAlive,
    forced: !!forced,
    lastAction: TOOL_LABELS[lastAction] || lastAction || '',
    error: !!lastError,
    shutdown: shuttingDown,
    runtime: { node: runtime.NODE || null, claude: runtime.CLAUDE || null },
    ts: now,
  };
}

function stateSig(s) {
  return [s.state, s.tool, s.long, s.claude, s.hooked, s.termAlive, s.lastAction, s.error, s.shutdown, s.forced].join('|');
}
let lastSig = '';

function json(res, obj, code) {
  const body = JSON.stringify(obj);
  res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveHtml(res) {
  let html;
  try { html = fs.readFileSync(HTML_FILE, 'utf8'); } catch {
    res.writeHead(500); res.end('pet.html missing'); return;
  }
  html = html.replace('__INIT_PAYLOAD__', safeJson(stateJson()));
  html = html.replace('__CONFIG_PAYLOAD__', safeJson(config));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function serveFile(res, name) {
  const safe = path.basename(name);
  const file = path.join(ROOT, safe);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  const type = GIF_EXT[path.extname(safe).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// SSE — one push per actual change instead of two polls a second.
const sseClients = new Set();

function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  sseClients.add(res);
  windowSeenAt = Date.now();
  const s = stateJson();
  lastSig = stateSig(s);
  res.write('event: state\ndata: ' + JSON.stringify(s) + '\n\n');
  req.on('close', () => sseClients.delete(res));
}

function broadcast(force) {
  if (!sseClients.size) { lastSig = ''; return; }
  const s = stateJson();
  const sig = stateSig(s);
  if (!force && sig === lastSig) return;
  lastSig = sig;
  windowSeenAt = Date.now();
  const frame = 'event: state\ndata: ' + JSON.stringify(s) + '\n\n';
  for (const c of sseClients) { try { c.write(frame); } catch { sseClients.delete(c); } }
}

setInterval(() => {
  for (const c of sseClients) { try { c.write(': hb\n\n'); } catch { sseClients.delete(c); } }
}, HEARTBEAT_MS);

// The pet page is same-origin (http://127.0.0.1:9876); hooks and curl send no
// Origin at all. Anything else is a drive-by from a web page.
function originAllowed(req) {
  const o = req.headers.origin;
  if (o !== undefined) {
    let host;
    try { host = new URL(o).host; } catch { return false; }
    if (ORIGINS.indexOf(host) === -1) return false;
  }
  const h = req.headers.host;
  if (h && ORIGINS.indexOf(h) === -1) return false;
  return true;
}

function readBody(req, limit, cb) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > limit) req.destroy(); });
  req.on('end', () => cb(body));
  req.on('error', () => cb(''));
}

const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, `http://${HOST}:${PORT}`); } catch { res.writeHead(400); res.end(); return; }
  const p = u.pathname;
  const q = u.searchParams;

  try {
    if (req.method === 'GET' && p === '/') return serveHtml(res);
    if (req.method === 'GET' && p === '/events') {
      if (!originAllowed(req)) { res.writeHead(403); res.end('forbidden'); return; }
      return sseHandler(req, res);
    }
    if (req.method === 'GET' && p === '/api/state') { windowSeenAt = Date.now(); return json(res, stateJson()); }
    if (req.method === 'GET' && p === '/api/health') return json(res, { server: true, window: windowActive(), state: pet.state, shutdown: shuttingDown, hooked: hookEnabled });
    if (req.method === 'GET' && p === '/api/window') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(windowActive() ? '1' : '0'); return; }

    if (req.method === 'POST') {
      if (!originAllowed(req)) return json(res, { ok: false, error: 'forbidden' }, 403);

      if (p === '/event') {
        return readBody(req, 64 * 1024, (body) => {
          try { onHookEvent(JSON.parse(body || '{}'), Date.now()); } catch { /* ignore malformed */ }
          return json(res, { ok: true, state: pet.state });
        });
      }
      if (p === '/api/open') { psRun('open'); return json(res, { ok: true }); }
      if (p === '/api/focus') { psRun('focus', termPid); return json(res, { ok: true }); }
      if (p === '/api/terminal') {
        const a = q.get('act');
        const act = (a === 'restore' || a === 'toggle') ? a : 'min';
        psRun(act, termPid);
        return json(res, { ok: true });
      }
      if (p === '/api/config') {
        return readBody(req, 1024, (body) => {
          try {
            const c = JSON.parse(body || '{}');
            if (typeof c.theme === 'string') config.theme = c.theme;
            if (typeof c.fs === 'number') config.fs = Math.min(1.35, Math.max(0.85, c.fs));
            saveConfig();
            return json(res, { ok: true, config });
          } catch { return json(res, { ok: false }); }
        });
      }
      if (p === '/api/debug') {
        if (q.has('cycle')) {
          const list = ['auto'].concat(st.STATES);
          const idx = list.indexOf(forced || 'auto');
          forced = list[(idx + 1) % list.length];
          if (forced === 'auto') forced = null;
        } else if (q.has('state')) {
          const s = q.get('state');
          forced = (s === 'auto' || !s) ? null : s;
        } else {
          forced = forced ? null : 'thinking';
        }
        pet = st.reduce(pet, Object.assign({}, lastFacts, { now: Date.now(), forced }), CFG);
        broadcast(true);
        return json(res, { ok: true, forced });
      }
      if (p === '/api/exit') { beginShutdown(); return json(res, { ok: true }); }
      return json(res, { ok: false, error: 'not found' }, 404);
    }

    if (req.method === 'GET' && p.startsWith('/gifs/')) {
      return serveFile(res, p.slice('/gifs/'.length));
    }

    res.writeHead(404); res.end('not found');
  } catch (e) {
    try { res.writeHead(500); res.end('error'); } catch {}
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[pet] listening on http://${HOST}:${PORT}`);
  updateProcesses(Date.now()).then(() => {
    // stale term pid at startup -> shut down
    if (termPid && termAlive === false) beginShutdown();
  }).catch(() => {});
});
