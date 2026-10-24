// node --test app/log.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./log');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pet-log-'));
}
function read(f) { return fs.readFileSync(f, 'utf8'); }

test('each line carries a local timestamp', () => {
  const dir = tmp();
  const file = path.join(dir, 'pet.log');
  const logger = L.createLogger(file, { now: () => new Date(2026, 9, 18, 14, 5, 9, 7) });
  logger.write('hello');
  logger.write('world');

  const lines = read(file).split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '2026-10-18 14:05:09.007 hello');
  assert.equal(lines[1], '2026-10-18 14:05:09.007 world');
});

test('rotation keeps the log bounded and drops the oldest generation', () => {
  const dir = tmp();
  const file = path.join(dir, 'pet.log');
  const logger = L.createLogger(file, { maxBytes: 200, keep: 2 });
  for (let i = 0; i < 40; i++) logger.write('line ' + i + ' ' + 'x'.repeat(30));

  assert.deepEqual(fs.readdirSync(dir).sort(), ['pet.log', 'pet.log.1', 'pet.log.2']);

  const total = fs.readdirSync(dir)
    .reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  // (keep + 1) files, plus the one line that may overshoot the threshold.
  assert.ok(total <= 200 * 3 + 200, 'log grew to ' + total + ' bytes');

  // the newest line is in the live file, and the very first line is long gone
  assert.match(read(file), /line 39 /);
  assert.doesNotMatch(read(file) + read(path.join(dir, 'pet.log.2')), /line 0 /);
});

test('a bigger rotation keeps every generation in order', () => {
  const dir = tmp();
  const file = path.join(dir, 'pet.log');
  const logger = L.createLogger(file, { maxBytes: 100, keep: 3 });
  for (let i = 0; i < 30; i++) logger.write('e' + i);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['pet.log', 'pet.log.1', 'pet.log.2', 'pet.log.3']);
});

test('an unwritable path disables the logger instead of throwing', () => {
  const dir = tmp();
  // the parent directory does not exist, so every append fails
  const logger = L.createLogger(path.join(dir, 'missing', 'pet.log'));
  assert.doesNotThrow(() => logger.write('x'));
  assert.equal(logger.enabled(), false);
  assert.doesNotThrow(() => logger.write('y'), 'a disabled logger stays quiet');
});

test('install mirrors console output and still calls the original', () => {
  const dir = tmp();
  const file = path.join(dir, 'pet.log');
  const seen = [];
  const fake = {
    log: (...a) => seen.push(['log', a.join(' ')]),
    error: (...a) => seen.push(['error', a.join(' ')]),
  };
  L.install(L.createLogger(file), { console: fake, process: false });

  fake.log('hello', 42);
  fake.error('boom', { code: 'EADDRINUSE' });

  // the fake joins with String(), so the object reads as [object Object] there —
  // what matters is that the original console was still called, with both args.
  assert.deepEqual(seen, [['log', 'hello 42'], ['error', 'boom [object Object]']]);
  const text = read(file);
  assert.match(text, /\[log\] hello 42/);
  // ...while the log line goes through util.format, so the object is inspectable
  assert.match(text, /\[error\] boom \{ code: 'EADDRINUSE' \}/);
});

test('install survives an argument the console cannot format', () => {
  const dir = tmp();
  const file = path.join(dir, 'pet.log');
  const circular = {};
  circular.self = circular;
  const fake = { log: () => {} };
  L.install(L.createLogger(file), { console: fake, process: false });
  assert.doesNotThrow(() => fake.log('circular', circular));
  assert.match(read(file), /\[log\] circular/);
});

test('open() is createLogger + install', () => {
  const dir = tmp();
  const file = path.join(dir, 'pet.log');
  const logger = L.open(file, { process: false, console: { log: () => {} } });
  logger.write('direct');
  assert.match(read(file), /direct/);
  assert.equal(L.MAX_BYTES, 1024 * 1024);
  assert.equal(L.KEEP, 2);
});
