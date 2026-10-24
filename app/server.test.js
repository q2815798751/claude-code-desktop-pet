// node --test app/server.test.js
//
// These boot a throwaway COPY of the server, never the installed one: server.js
// derives every path it writes (config.json, usage.json) from __dirname, so
// running the real file would touch the user's live install. The copy runs with
// USERPROFILE pointed at an empty temp home (so ~/.claude/projects is empty and
// no real transcript drives the state) and on an ephemeral port (so the live pet
// on 9876 is never involved). Nothing here kills or talks to the running pet.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const APP = __dirname;
const STATES = ['offline', 'idle', 'thinking', 'working', 'awaiting', 'done', 'error'];
const TIMEOUT = { timeout: 30000 };

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pet-srv-'));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

// Copy just what the server needs to run, so a test can never write into the
// installed app directory.
function makeCopy(dir) {
  const appDir = path.join(dir, 'app');
  fs.mkdirSync(appDir);
  for (const f of fs.readdirSync(APP)) {
    if (!f.endsWith('.js') || f.endsWith('.test.js')) continue;
    fs.copyFileSync(path.join(APP, f), path.join(appDir, f));
  }
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  return { appDir, home };
}

function launch(appDir, home, port) {
  const proc = spawn(process.execPath, [path.join(appDir, 'server.js')], {
    cwd: path.dirname(appDir),
    env: Object.assign({}, process.env, {
      USERPROFILE: home, CLAUDEPET_PORT: String(port),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { out: '' };
  proc.stdout.on('data', (d) => { state.out += d; });
  proc.stderr.on('data', (d) => { state.out += d; });
  return { proc, out: () => state.out };
}

function stop(proc) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
    proc.once('exit', resolve);
    try { proc.kill(); } catch { return resolve(); }
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 4000).unref();
  });
}

function waitExit(proc, ms) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) return resolve(proc.exitCode);
    const t = setTimeout(() => resolve(null), ms);
    proc.once('exit', (code) => { clearTimeout(t); resolve(code); });
  });
}

// Boot a copy and wait until it answers /api/health.
async function startServer(t) {
  const dir = tmpRoot();
  const { appDir, home } = makeCopy(dir);
  const port = await freePort();
  const { proc, out } = launch(appDir, home, port);
  t.after(async () => {
    await stop(proc);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  const base = 'http://127.0.0.1:' + port;
  const deadline = Date.now() + 20000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error('server exited early:\n' + out());
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) return { proc, base, dir, appDir, out };
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('server never came up:\n' + out());
    await new Promise((r) => setTimeout(r, 100));
  }
}

// A stale term.pid (the user closed the pet terminal, then launched the window)
// used to make a fresh server call beginShutdown() within a second — the pet
// window would connect and then vanish. Only a terminal that was seen alive and
// then died may stop the server.
test('a stale term.pid does not shut the server down at startup', TIMEOUT, async (t) => {
  const dir = tmpRoot();
  const { appDir, home } = makeCopy(dir);
  fs.writeFileSync(path.join(appDir, 'term.pid'), '999999\n');
  const port = await freePort();
  const { proc, out } = launch(appDir, home, port);
  t.after(async () => {
    await stop(proc);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });
  const base = 'http://127.0.0.1:' + port;
  const deadline = Date.now() + 20000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error('server exited early:\n' + out());
    try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('server never came up:\n' + out());
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 6500));   // longer than SHUTDOWN_HOLD_MS
  assert.equal(proc.exitCode, null, 'server must survive a dead pid from a previous run:\n' + out());
  const h = await (await fetch(base + '/api/health')).json();
  assert.equal(h.shutdown, false);
});

test('a hook event body that is not an object cannot crash the server', TIMEOUT, async (t) => {  const s = await startServer(t);
  for (const body of ['{"broken":', 'null', '[1,2,3]', '"hi"', '42', '{"hook_event_name":123,"tool_name":{"a":1}}']) {
    const r = await fetch(s.base + '/event', { method: 'POST', body });
    assert.equal(r.status, 200, 'body ' + JSON.stringify(body) + ' should be tolerated');
  }
  assert.equal((await fetch(s.base + '/api/health')).status, 200, 'server must survive malformed hook JSON');
});

test('an oversized POST is refused with 413, not a reset socket', TIMEOUT, async (t) => {
  const s = await startServer(t);
  const big = JSON.stringify({ hook_event_name: 'X', pad: 'y'.repeat(70000) });
  const r = await fetch(s.base + '/event', { method: 'POST', body: big });
  assert.equal(r.status, 413);
  assert.equal((await fetch(s.base + '/api/health')).status, 200);
});

test('GET /gifs/ (a directory) is a 404 and does not take the server down', TIMEOUT, async (t) => {
  const s = await startServer(t);
  // A real file still serves.
  fs.writeFileSync(path.join(s.appDir, 'probe.gif'), 'GIF89a');
  const ok = await fetch(s.base + '/gifs/probe.gif');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/gif');

  // The empty name resolves to the app directory itself; handing that to
  // createReadStream used to emit an unhandled EISDIR and kill the process.
  const r = await fetch(s.base + '/gifs/');
  assert.equal(r.status, 404);
  assert.equal(s.proc.exitCode, null, 'server must still be running');
  assert.equal((await fetch(s.base + '/api/health')).status, 200);
});

test('the server mirrors its console into a rolling pet.log', TIMEOUT, async (t) => {
  const s = await startServer(t);
  const text = fs.readFileSync(path.join(s.appDir, 'pet.log'), 'utf8');
  assert.match(text, /\[log\] \[pet\] listening on http:\/\/127\.0\.0\.1:/);
  // the startup line is a real timestamped log line
  assert.match(text, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} /);
});

test('a taken port is reported cleanly instead of throwing an unhandled error', TIMEOUT, async (t) => {
  const dir = tmpRoot();
  const { appDir, home } = makeCopy(dir);
  const port = await freePort();
  const blocker = net.createServer();
  await new Promise((res) => blocker.listen(port, '127.0.0.1', res));
  t.after(async () => {
    await new Promise((res) => blocker.close(res));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  const { proc, out } = launch(appDir, home, port);
  t.after(() => stop(proc));
  const code = await waitExit(proc, 15000);

  assert.equal(code, 1, 'it should exit rather than hang: ' + out());
  assert.match(out(), /cannot listen on 127\.0\.0\.1:/);
  assert.doesNotMatch(out(), /Unhandled 'error' event/);

  // the reason survives even though the window is hidden: it is in the log file
  assert.match(fs.readFileSync(path.join(appDir, 'pet.log'), 'utf8'), /\[error\] \[pet\] cannot listen on/);
});

test('a junk forced state is rejected, so the pet never leaves STATES', TIMEOUT, async (t) => {
  const s = await startServer(t);
  const r = await fetch(s.base + '/api/debug?state=bogus', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).forced, null);

  const j = await (await fetch(s.base + '/api/state')).json();
  assert.ok(STATES.indexOf(j.state) !== -1, 'state was ' + JSON.stringify(j.state));

  // ...and a real one is still honoured.
  const ok = await fetch(s.base + '/api/debug?state=awaiting', { method: 'POST' });
  assert.equal((await ok.json()).forced, 'awaiting');
  assert.equal((await (await fetch(s.base + '/api/state')).json()).state, 'awaiting');
});
