// CLAUDE.PET — register/unregister the Claude Code hooks that feed the pet.
//
//   node app/hooks.js install [--app <dir>]   add our hooks to ~/.claude/settings.json
//   node app/hooks.js remove                  take them back out
//   node app/hooks.js status                  is it wired up?
//
// Every hook entry we own has `notify.cmd` in its command, which is how we find
// our own entries again — so installs are idempotent and removal never touches
// hooks you wrote yourself. The first install leaves a .claudepet.bak next to it.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const MARKER = 'notify.cmd';
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const BACKUP = SETTINGS + '.claudepet.bak';

// Everything worth knowing about a running session.
const EVENTS = [
  'SessionStart',      // claude came up            -> idle
  'UserPromptSubmit',  // you sent a prompt         -> thinking
  'PreToolUse',        // a tool started            -> working <tool>
  'PostToolUse',       // a tool finished           -> thinking
  'Notification',      // claude needs you          -> awaiting
  'Stop',              // the turn ended            -> done
  'SubagentStop',
  'SessionEnd',        // claude went away          -> offline
];
// Only tool events carry a matcher.
const MATCHED = new Set(['PreToolUse', 'PostToolUse']);

function fail(msg) { console.error('[claudepet] ' + msg); process.exit(1); }

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not an object');
    return o;
  } catch (e) {
    fail('cannot parse ' + file + ' (' + e.message + ') — leaving it untouched.');
  }
}

function writeSettings(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function isOurs(entry) {
  return !!(entry && Array.isArray(entry.hooks)
    && entry.hooks.some((h) => h && typeof h.command === 'string'
      && h.command.toLowerCase().indexOf(MARKER) !== -1));
}

// Strip our entries out of one event's array, leaving yours alone.
function strip(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    if (isOurs(entry)) {
      const kept = entry.hooks.filter((h) => !(h && typeof h.command === 'string'
        && h.command.toLowerCase().indexOf(MARKER) !== -1));
      if (kept.length) out.push(Object.assign({}, entry, { hooks: kept }));
    } else {
      out.push(entry);
    }
  }
  return out;
}

function ourEntry(cmd, ev) {
  const e = { hooks: [{ type: 'command', command: cmd }] };
  if (MATCHED.has(ev)) e.matcher = '*';
  return e;
}

function countOurs(settings) {
  let n = 0;
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return 0;
  for (const ev of Object.keys(hooks)) if (strip(hooks[ev]).length !== hooks[ev].length) n++;
  return n;
}

function install(appDir) {
  const cmd = '"' + path.join(appDir, 'notify.cmd') + '"';
  if (!fs.existsSync(path.join(appDir, 'notify.cmd'))) fail('notify.cmd not found in ' + appDir);

  const s = readSettings(SETTINGS);
  if (!fs.existsSync(BACKUP) && fs.existsSync(SETTINGS)) {
    fs.copyFileSync(SETTINGS, BACKUP);   // one-time safety net
  }
  if (!s.hooks || typeof s.hooks !== 'object' || Array.isArray(s.hooks)) s.hooks = {};
  for (const ev of EVENTS) s.hooks[ev] = strip(s.hooks[ev]).concat([ourEntry(cmd, ev)]);
  writeSettings(SETTINGS, s);
  console.log('[claudepet] hooks installed -> ' + cmd);
  console.log('[claudepet] settings: ' + SETTINGS + ' (backup: ' + BACKUP + ')');
  console.log('[claudepet] restart your claude session for them to take effect.');
}

function remove() {
  if (!fs.existsSync(SETTINGS)) { console.log('[claudepet] no settings file, nothing to do.'); return; }
  const s = readSettings(SETTINGS);
  if (!s.hooks || typeof s.hooks !== 'object') { console.log('[claudepet] no hooks, nothing to do.'); return; }
  for (const ev of Object.keys(s.hooks)) {
    const left = strip(s.hooks[ev]);
    if (left.length) s.hooks[ev] = left; else delete s.hooks[ev];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  writeSettings(SETTINGS, s);
  console.log('[claudepet] hooks removed from ' + SETTINGS);
}

function status() {
  const s = readSettings(SETTINGS);
  const n = countOurs(s);
  console.log('[claudepet] ' + (n ? n + ' event(s) wired up' : 'not installed'));
  process.exit(n ? 0 : 1);
}

// ---- cli ----
const argv = process.argv.slice(2);
const action = argv[0] || 'status';
let appDir = __dirname;
const ai = argv.indexOf('--app');
if (ai !== -1 && argv[ai + 1]) appDir = path.resolve(argv[ai + 1]);

if (action === 'install') install(appDir);
else if (action === 'remove' || action === 'uninstall') remove();
else if (action === 'status') status();
else fail('unknown action: ' + action + '  (install | remove | status)');

module.exports = { EVENTS, strip, isOurs };
