// CLAUDE.PET — tiny rolling file log.
//
// start-pet.bat launches the server through a hidden PowerShell window, so
// console.log / console.error go nowhere at all: when the pet died there was
// nothing to read afterwards, and the crash was silent. This mirrors everything
// the server prints into app/pet.log, uncaught exceptions included.
//
// Size-based rotation keeps it bounded: pet.log -> pet.log.1 -> pet.log.2, with the
// oldest dropped, so the set never exceeds (keep + 1) * maxBytes (3 MB by default).
// Logging is best-effort and must never take the server down: a write that fails
// turns the logger off instead of throwing, and it never re-enters itself.
'use strict';

const fs = require('fs');
const util = require('util');

const MAX_BYTES = 1024 * 1024;   // rotate once the current file passes this
const KEEP = 2;                  // pet.log.1 .. pet.log.2; older generations are dropped

function pad(n, w) { return String(n).padStart(w || 2, '0'); }

// Local time, so a line can be lined up with what the user was doing.
function stamp(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
}

// file: the log path. opts: { maxBytes, keep, now } (now is a test seam).
function createLogger(file, opts) {
  const maxBytes = (opts && opts.maxBytes) || MAX_BYTES;
  const keep = (opts && opts.keep) != null ? opts.keep : KEEP;
  const clock = (opts && opts.now) || (() => new Date());

  let size = 0;
  try { size = fs.statSync(file).size; } catch { size = 0; }
  let off = false;               // a failed write disables the log rather than throwing

  function rotate() {
    try { fs.rmSync(file + '.' + keep, { force: true }); } catch { /* may not exist */ }
    for (let i = keep - 1; i >= 1; i--) {
      try { fs.renameSync(file + '.' + i, file + '.' + (i + 1)); } catch { /* may not exist */ }
    }
    try { fs.renameSync(file, file + '.1'); } catch { /* may not exist */ }
    size = 0;
  }

  function write(line) {
    if (off) return;
    const text = stamp(clock()) + ' ' + (line == null ? '' : String(line)) + '\n';
    try {
      if (size + Buffer.byteLength(text) > maxBytes) rotate();
      fs.appendFileSync(file, text, 'utf8');
      size += Buffer.byteLength(text);
    } catch { off = true; }
  }

  return { file, write, rotate, size: () => size, enabled: () => !off };
}

// Mirror console output into the log, leaving the console itself working. `target`
// defaults to the global console; tests pass a stub so they never touch the real
// one. opts.process === false skips the process-level handlers (also for tests).
function install(logger, opts) {
  const o = opts || {};
  const target = o.console || console;
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = typeof target[level] === 'function' ? target[level].bind(target) : function () {};
    target[level] = function (...args) {
      let text;
      try { text = util.format(...args); } catch { text = args.map(String).join(' '); }
      logger.write('[' + level + '] ' + text);
      try { orig(...args); } catch { /* the console is gone; the log still has it */ }
    };
  }
  if (o.process !== false) {
    // Default Node behaviour for an uncaught exception is a silent exit — with the
    // window hidden nobody ever sees the stack. Record it and keep the pet up; the
    // log is the only place this would otherwise be visible.
    process.on('uncaughtException', (err) => {
      logger.write('[uncaughtException] ' + (err && err.stack ? err.stack : String(err)));
    });
    process.on('unhandledRejection', (reason) => {
      logger.write('[unhandledRejection] ' + (reason && reason.stack ? reason.stack : String(reason)));
    });
  }
  return logger;
}

// createLogger + install in one call, which is how server.js uses it.
function open(file, opts) { return install(createLogger(file, opts), opts); }

module.exports = { MAX_BYTES, KEEP, createLogger, install, open };
