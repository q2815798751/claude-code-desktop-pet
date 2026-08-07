// CLAUDE.PET server — zero external dependencies (Node built-ins only)
// Windows desktop pet that reflects claude code CLI working state.
// HTTP server @127.0.0.1:9876, SSR injects init state, client polls every 500ms.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile } = require('child_process');

const ROOT = __dirname;
const HTML_FILE = path.join(ROOT, 'pet.html');
const PS_FILE = path.join(ROOT, 'pet.ps1');
const TERM_PID_FILE = path.join(ROOT, 'term.pid');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

const PORT = 9876;
const HOST = '127.0.0.1';

// state thresholds (ms)
const THINK_MS = 5000;        // thinking  <5s of continuous activity
const WORK_MS = 30000;        // working   <30s
const DONE_HOLD_MS = 5000;    // done state holds 5s
const STALE_MS = 600000;      // a working marker older than this is treated as idle (safety)
const SHUTDOWN_HOLD_MS = 2500;// self-exit within 5s of terminal death
const ERROR_WINDOW_MS = 30000;// recent tool error within 30s -> error state
const PROC_CHECK_MS = 2000;   // re-run tasklist at most every 2s
const WINDOW_STALE_MS = 5000; // pet window considered alive if polled within 5s
const TAIL_BYTES = 256 * 1024;// bytes read from the tail of the newest transcript

const GIF_EXT = { '.gif': 'image/gif', '.png': 'image/png', '.ico': 'image/x-icon' };

// ---- mutable state ----
let claudeAlive = null;
let termAlive = null;
let lastProcCheck = 0;
let lastActivity = 0;          // ms epoch of the last transcript event (for display)
let turnStart = 0;             // when the current working stretch began
let wasWorking = false;
let doneUntil = 0;
let state = 'offline';
let stateSince = Date.now();
let forced = null;             // debug override: 'auto' | a state name
let lastError = null;          // {at, msg}
let shuttingDown = false;
let shutdownAt = 0;
let windowActiveAt = 0;
let termPid = readTermPid();

// persisted UI config (theme + font scale)
let config = { theme: 'cyber', fs: 1 };
try { config = Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))); } catch {}
function saveConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config), 'utf8'); } catch {}
}

// ---- tiny helpers ----
function readTermPid() {
  try {
    const s = fs.readFileSync(TERM_PID_FILE, 'utf8').trim();
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

function scanLatestMtime() {
  let m = 0;
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { return m; }
  for (const proj of dirs) {
    const d = path.join(PROJECTS_DIR, proj);
    try { if (!fs.statSync(d).isDirectory()) continue; } catch { continue; }
    let files = [];
    try { files = fs.readdirSync(d); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        const st = fs.statSync(path.join(d, f));
        if (st.mtimeMs > m) m = st.mtimeMs;
      } catch {}
    }
  }
  return m;
}

function newestTranscriptPath() {
  let best = null, bestT = 0;
  try {
    for (const proj of fs.readdirSync(PROJECTS_DIR)) {
      const d = path.join(PROJECTS_DIR, proj);
      try { if (!fs.statSync(d).isDirectory()) continue; } catch { continue; }
      for (const f of fs.readdirSync(d)) {
        if (!f.endsWith('.jsonl')) continue;
        const p = path.join(d, f);
        try { const st = fs.statSync(p); if (st.mtimeMs > bestT) { bestT = st.mtimeMs; best = p; } } catch {}
      }
    }
  } catch {}
  return best;
}

function scanRecentError(now) {
  const file = newestTranscriptPath();
  if (!file) return null;
  try {
    const size = fs.statSync(file).size;
    if (size === 0) return null;
    const start = Math.max(0, size - 128 * 1024);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - start);
    try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith('{')) continue;
      if (!/"isError"\s*:\s*true/.test(line)) continue;
      let ts;
      try {
        const o = JSON.parse(line);
        ts = o.timestamp ? new Date(o.timestamp).getTime() : NaN;
      } catch { ts = NaN; }
      if (Number.isFinite(ts) && now - ts <= ERROR_WINDOW_MS) {
        return { at: ts, msg: 'tool error' };
      }
      // if the newest error line is older than the window, nothing recent
      if (Number.isFinite(ts) && now - ts > ERROR_WINDOW_MS) return null;
    }
  } catch {}
  return null;
}

// The most recent tool action (for the "现在在做什么" line).
const TOOL_LABELS = {
  Bash: '运行 Bash', Edit: '编辑文件', Read: '读取文件', Write: '写文件',
  Glob: '查找文件', Grep: '搜索代码', NotebookEdit: '编辑笔记', WebSearch: '联网搜索',
  WebFetch: '抓取网页', Agent: '调用子代理', TaskCreate: '创建任务', TodoWrite: '更新任务',
  Skill: '调用技能',
};
function readLastAction() {
  const file = newestTranscriptPath();
  if (!file) return '';
  try {
    const size = fs.statSync(file).size;
    if (size === 0) return '';
    const start = Math.max(0, size - 128 * 1024);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - start);
    try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith('{')) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      const content = o.message && o.message.content;
      if (!Array.isArray(content)) continue;
      for (let j = content.length - 1; j >= 0; j--) {
        const c = content[j];
        if (c && c.type === 'tool_use' && c.name) return TOOL_LABELS[c.name] || c.name;
      }
    }
  } catch {}
  return '';
}

// ---- process checks (spawn tasklist, cached every PROC_CHECK_MS) ----
function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      resolve(err ? '' : (stdout || ''));
    });
  });
}

function claudeAliveCheck() {
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

async function updateProcesses() {
  const tasks = [claudeAliveCheck()];
  if (termPid) tasks.push(pidAliveCheck(termPid));
  const [c, t] = await Promise.all(tasks);
  claudeAlive = !!c;
  if (termPid) termAlive = !!t;
}

// ---- transcript content classification ----
// Claude Code appends one JSONL line per message EVENT (user input, tool_result,
// assistant thinking/text/tool_use), but does NOT write during long text streaming.
// So the last meaningful line tells us the phase: working markers (user/tool/thinking/
// tool_use) mean claude is mid-turn; a pure-text assistant line means the turn finished.
function classifyMessage(o) {
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

function readLastMessage() {
  const file = newestTranscriptPath();
  if (!file) return null;
  try {
    const size = fs.statSync(file).size;
    if (size === 0) return null;
    const start = Math.max(0, size - TAIL_BYTES);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - start);
    try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
    const text = buf.toString('utf8');
    const partial = text.length > 0 && text.charAt(text.length - 1) !== '\n';
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith('{')) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      const ts = o.timestamp ? new Date(o.timestamp).getTime() : NaN;
      if (!Number.isFinite(ts)) continue; // metadata line, skip
      const kind = classifyMessage(o);
      if (!kind) continue;
      return { kind, ts };
    }
    if (partial) return { kind: 'working', ts: Date.now() }; // mid-append = actively writing
  } catch {}
  return null;
}

// ---- state machine ----
function computeState(now, msg) {
  if (shuttingDown) { state = 'offline'; return; }
  if (forced && forced !== 'auto') { if (state !== forced) { state = forced; stateSince = now; } return; }

  // error overrides working states (still needs claude alive)
  if (lastError && claudeAlive) {
    if (state !== 'error') { state = 'error'; stateSince = now; wasWorking = false; }
    return;
  }

  if (!claudeAlive) {
    wasWorking = false;
    if (state !== 'offline') { state = 'offline'; stateSince = now; }
    return;
  }

  if (!msg) {
    // claude alive but no transcript yet (fresh install / never ran in a project)
    wasWorking = false;
    if (state !== 'idle') { state = 'idle'; stateSince = now; }
    return;
  }

  if (msg.kind === 'done') {
    // turn finished: assistant pure text -> flash done 5s, then idle
    if (wasWorking) { doneUntil = now + DONE_HOLD_MS; wasWorking = false; }
    const s = now < doneUntil ? 'done' : 'idle';
    if (state !== s) { state = s; stateSince = now; }
    return;
  }

  // working marker: claude is mid-turn (user input / tool_result / thinking / tool_use)
  if (!wasWorking) { turnStart = msg.ts || now; wasWorking = true; }
  if (msg.ts && (now - msg.ts) > STALE_MS) {
    // safety: marker very old with no follow-up -> not really active anymore
    wasWorking = false;
    if (state !== 'idle') { state = 'idle'; stateSince = now; }
    return;
  }
  const dur = now - turnStart;
  const s = dur < THINK_MS ? 'thinking' : dur < WORK_MS ? 'working' : 'working_long';
  if (state !== s) { state = s; stateSince = now; }
}

function beginShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownAt = Date.now();
  state = 'offline';
  stateSince = shutdownAt;
  // graceful: client polls shutdown:true and calls host Close + window.close();
  // fallback: force-close the pet host window so it never lingers.
  setTimeout(killPetWindow, 800);
}

function windowActive() {
  return (Date.now() - windowActiveAt) < WINDOW_STALE_MS;
}

// ---- PowerShell window ops (execFile avoids cmd mangling of Unicode paths) ----
function psRun(action, pid) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', PS_FILE, '-Action', action];
  if (pid) args.push('-ProcId', String(pid));
  execFile('powershell.exe', args, { windowsHide: true }, (err, so, se) => {
    if (err || (se && se.trim())) console.log('[ps:' + action + ']', err && err.message, se && se.trim().split('\n').slice(0, 3).join(' | '));
  });
}

// ---- poll loop ----
function killPetWindow() {
  execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
    "Get-Process -Name 'ClaudePet.Host' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"
  ], { windowsHide: true }, () => {});
}

async function poll() {
  const now = Date.now();

  // adopt a (possibly new) terminal pid written by start-both.bat
  const newPid = readTermPid();
  if (newPid !== termPid) {
    termPid = newPid;
    termAlive = null;          // unknown until checked
    lastProcCheck = 0;         // force a process check this poll
  }

  if (now - lastProcCheck > PROC_CHECK_MS) {
    lastProcCheck = now;
    await updateProcesses();
  }
  const msg = readLastMessage();
  lastActivity = msg ? msg.ts : scanLatestMtime();
  lastError = scanRecentError(now);
  computeState(now, msg);

  // terminal died -> pet self-exits within 5s (only when we know it is dead)
  if (!shuttingDown && termPid && termAlive === false) beginShutdown();
  if (shuttingDown && now - shutdownAt >= SHUTDOWN_HOLD_MS) {
    process.exit(0);
  }
}

setInterval(() => { poll().catch(() => {}); }, 500);

// ---- HTTP ----
function stateJson() {
  const now = Date.now();
  return {
    state,
    since: stateSince,
    lastActivity,
    ageMs: Math.max(0, now - lastActivity),
    claude: claudeAlive,
    term: termPid,
    termAlive: termAlive === null ? null : !!termAlive,
    forced: !!forced,
    lastAction: readLastAction(),
    shutdown: shuttingDown,
    ts: now,
  };
}

function json(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveHtml(res) {
  let html;
  try { html = fs.readFileSync(HTML_FILE, 'utf8'); } catch {
    res.writeHead(500); res.end('pet.html missing'); return;
  }
  const init = JSON.stringify(stateJson());
  html = html.replace('__INIT_PAYLOAD__', init);
  html = html.replace('__CONFIG_PAYLOAD__', JSON.stringify(config));
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

const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, `http://${HOST}:${PORT}`); } catch { res.writeHead(400); res.end(); return; }
  const p = u.pathname;
  const q = u.searchParams;

  try {
    if (req.method === 'GET' && p === '/') return serveHtml(res);
    if (req.method === 'GET' && p === '/api/state') { windowActiveAt = Date.now(); return json(res, stateJson()); }
    if (req.method === 'GET' && p === '/api/health') return json(res, { server: true, window: windowActive(), state, shutdown: shuttingDown });
    if (req.method === 'GET' && p === '/api/window') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(windowActive() ? '1' : '0'); return; }

    if (req.method === 'POST' && p === '/api/open') {
      psRun('open');
      return json(res, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/focus') {
      psRun('focus', termPid);
      return json(res, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/terminal') {
      const a = q.get('act');
      const act = (a === 'restore' || a === 'toggle') ? a : 'min';
      psRun(act, termPid);
      return json(res, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/config') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1024) req.destroy(); });
      req.on('end', () => {
        try {
          const c = JSON.parse(body || '{}');
          if (typeof c.theme === 'string') config.theme = c.theme;
          if (typeof c.fs === 'number') config.fs = Math.min(1.35, Math.max(0.85, c.fs));
          saveConfig();
          return json(res, { ok: true, config });
        } catch { return json(res, { ok: false }); }
      });
      return;
    }
    if (req.method === 'POST' && p === '/api/debug') {
      if (q.has('cycle')) {
        const list = ['auto', 'thinking', 'working', 'working_long', 'done', 'idle', 'offline', 'error'];
        const idx = list.indexOf(forced || 'auto');
        forced = list[(idx + 1) % list.length];
      } else if (q.has('state')) {
        const s = q.get('state');
        forced = s === 'auto' ? null : s;
      } else {
        forced = forced ? null : 'thinking';
      }
      stateSince = Date.now();
      return json(res, { ok: true, forced });
    }
    if (req.method === 'POST' && p === '/api/exit') {
      beginShutdown();
      return json(res, { ok: true });
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
  updateProcesses().then(() => {
    // stale term pid at startup -> shut down
    if (termPid && termAlive === false) beginShutdown();
  }).catch(() => {});
});
