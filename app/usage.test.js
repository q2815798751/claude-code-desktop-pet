// node --test app/usage.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('./usage');

const T0 = 1700000000000;
const iso = (ms) => new Date(ms).toISOString();
const U_ = (i, o, cc, cr) => ({
  input_tokens: i, output_tokens: o,
  cache_creation_input_tokens: cc || 0, cache_read_input_tokens: cr || 0,
});

// One assistant line. Claude Code writes several of these per API response — one
// per content block — all sharing message.id and all carrying the same usage.
function line(ms, id, u, model) {
  return JSON.stringify({
    type: 'assistant', timestamp: iso(ms), sessionId: 'sess-a',
    message: {
      id, model: model || 'claude-sonnet-5', role: 'assistant',
      content: [{ type: 'text', text: 'x' }], usage: u,
    },
  });
}
const noise = (ms) => JSON.stringify({ type: 'user', timestamp: iso(ms), message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } });

function tmpDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-u-'));
  fs.mkdirSync(path.join(root, 'proj'));
  return { dir: root, file: path.join(root, 'proj', 'sess-a.jsonl') };
}
function scan(dir, ledger, opts) {
  const s = U.createScanner(Object.assign({ dir, ledger }, opts));
  let r;
  do { r = s.step(1000); } while (!r.done);
  return ledger;
}
const agg = (ledger, key) => ledger.sessions[key];

// ---- the 2.76x bug -----------------------------------------------------------

test('parseLine: a usage line is read into a record', () => {
  const r = U.parseLine(line(T0, 'm1', U_(100, 20, 5, 7)));
  assert.equal(r.id, 'm1');
  assert.equal(r.in, 100);
  assert.equal(r.out, 20);
  assert.equal(r.cc, 5);
  assert.equal(r.cr, 7);
  assert.equal(r.ts, T0);
  assert.equal(r.model, 'claude-sonnet-5');
});

test('parseLine: lines with no usage are skipped without parsing', () => {
  assert.equal(U.parseLine(noise(T0)), null);
  assert.equal(U.parseLine('{"type":"summary","summary":"x"}'), null);
  assert.equal(U.parseLine('not json at all'), null);
});

// The bug this file exists to prevent: one API response = 2..4 identical lines.
// Counting lines instead of message.id over-reports by 2.76x on a real corpus.
test('dedup: one message.id written 4 times counts once', () => {
  const { dir, file } = tmpDir();
  const u = U_(26436, 501);
  fs.writeFileSync(file, [
    line(T0, 'dup', u), line(T0 + 30, 'dup', u), line(T0 + 60, 'dup', u), line(T0 + 90, 'dup', u),
  ].join('\n') + '\n');

  const ledger = scan(dir, U.createLedger());
  assert.equal(ledger.total.msgs, 1);
  assert.equal(ledger.total.in, 26436);
  assert.equal(ledger.total.out, 501);
});

test('dedup: a duplicate run straddling two scans still counts once', () => {
  const { dir, file } = tmpDir();
  const u = U_(1000, 100);
  const ledger = U.createLedger();

  fs.writeFileSync(file, line(T0, 'x', u) + '\n');
  scan(dir, ledger);
  // the same response continues into the next scan
  fs.appendFileSync(file, line(T0 + 50, 'x', u) + '\n' + line(T0 + 80, 'x', u) + '\n');
  scan(dir, ledger);

  assert.equal(ledger.total.msgs, 1);
  assert.equal(ledger.total.in, 1000);
});

test('dedup: distinct messages all count', () => {
  const { dir, file } = tmpDir();
  fs.writeFileSync(file, [
    line(T0, 'a', U_(10, 1)), line(T0 + 1, 'b', U_(20, 2)), line(T0 + 2, 'c', U_(30, 3)),
  ].join('\n') + '\n');
  const ledger = scan(dir, U.createLedger());
  assert.equal(ledger.total.msgs, 3);
  assert.equal(ledger.total.in, 60);
  assert.equal(ledger.total.out, 6);
});

// ---- incremental ------------------------------------------------------------

test('incremental: appending in two scans equals one full scan', () => {
  const a = tmpDir(), b = tmpDir();
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(line(T0 + i * 100, 'm' + i, U_(100 + i, 10 + i, 1, 2)));

  fs.writeFileSync(a.file, rows.join('\n') + '\n');
  const full = scan(a.dir, U.createLedger());

  const led = U.createLedger();
  fs.writeFileSync(b.file, rows.slice(0, 5).join('\n') + '\n');
  scan(b.dir, led);
  fs.appendFileSync(b.file, rows.slice(5).join('\n') + '\n');
  scan(b.dir, led);

  assert.deepEqual(led.total, full.total);
  assert.equal(led.total.msgs, 12);
});

test('incremental: a half-written trailing line is not counted, and is not skipped later', () => {
  const { dir, file } = tmpDir();
  const whole = line(T0, 'm1', U_(11, 1));
  fs.writeFileSync(file, whole + '\n' + whole.slice(0, 20));   // partial, no newline
  const ledger = U.createLedger();

  scan(dir, ledger);
  assert.equal(ledger.total.msgs, 1, 'only the complete line counts');

  // the writer finishes the line
  fs.writeFileSync(file, whole + '\n' + line(T0 + 5, 'm2', U_(22, 2)) + '\n');
  scan(dir, ledger);
  assert.equal(ledger.total.msgs, 2, 'the completed line is picked up, not lost');
});

test('incremental: an unchanged file is skipped entirely', () => {
  const { dir, file } = tmpDir();
  fs.writeFileSync(file, line(T0, 'm1', U_(5, 1)) + '\n');
  const ledger = U.createLedger();
  scan(dir, ledger);
  const readAfterFirst = ledger.files[file].read;
  const r2 = scan(dir, ledger);
  assert.equal(ledger.files[file].read, readAfterFirst);
  assert.equal(ledger.total.msgs, 1);
});

// A transcript that shrinks was rewritten, not appended to — its old bytes must be
// unwound from every rollup before the new ones are counted.
test('truncation: a shrunk file is recounted, not double counted', () => {
  const { dir, file } = tmpDir();
  fs.writeFileSync(file, [
    line(T0, 'm1', U_(100, 10)), line(T0 + 1, 'm2', U_(200, 20)), line(T0 + 2, 'm3', U_(300, 30)),
  ].join('\n') + '\n');
  const ledger = U.createLedger();
  scan(dir, ledger);
  assert.equal(ledger.total.in, 600);

  fs.writeFileSync(file, line(T0, 'm1', U_(100, 10)) + '\n');   // rewritten, shorter
  scan(dir, ledger);

  assert.equal(ledger.total.msgs, 1);
  assert.equal(ledger.total.in, 100);
  assert.equal(agg(ledger, 'sess-a').in, 100, 'the session rollup is unwound too');
});

test('lifecycle: a deleted transcript is dropped from the ledger', () => {
  const { dir, file } = tmpDir();
  fs.writeFileSync(file, line(T0, 'm1', U_(100, 10)) + '\n');
  const ledger = U.createLedger();
  scan(dir, ledger);
  assert.equal(ledger.total.in, 100);

  fs.unlinkSync(file);
  scan(dir, ledger);
  assert.equal(ledger.total.in, 0);
  assert.deepEqual(Object.keys(ledger.files), []);
});

test('scanner: a tiny budget still finishes, one slice at a time', () => {
  const { dir, file } = tmpDir();
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(line(T0 + i, 'm' + i, U_(10, 1)));
  fs.writeFileSync(file, rows.join('\n') + '\n');

  const s = U.createScanner({ dir, ledger: U.createLedger() });
  let steps = 0, r;
  do { r = s.step(0); steps++; } while (!r.done && steps < 100);
  assert.ok(r.done);
  assert.ok(steps >= 1);
  assert.equal(s.ledger.total.msgs, 40);
});

// ---- rollups ----------------------------------------------------------------

test('day buckets follow the local calendar day', () => {
  const { dir, file } = tmpDir();
  const d1 = new Date(2026, 8, 13, 23, 30).getTime();
  const d2 = new Date(2026, 8, 14, 0, 30).getTime();
  fs.writeFileSync(file, [line(d1, 'a', U_(10, 1)), line(d2, 'b', U_(20, 2))].join('\n') + '\n');

  const ledger = scan(dir, U.createLedger());
  assert.equal(ledger.days['2026-09-13'].in, 10);
  assert.equal(ledger.days['2026-09-14'].in, 20);
});

test('dayKey: zero padding', () => {
  assert.equal(U.dayKey(new Date(2026, 0, 5, 12).getTime()), '2026-01-05');
});

test('recent window is capped at the last 20 calls', () => {
  const { dir, file } = tmpDir();
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push(line(T0 + i, 'm' + i, U_(1, 1)));
  fs.writeFileSync(file, rows.join('\n') + '\n');
  const ledger = scan(dir, U.createLedger());
  assert.equal(ledger.recent.length, 20);
});

// ---- snapshot ---------------------------------------------------------------

test('snapshot: the context reading is the last turn, not a running total', () => {
  const { dir, file } = tmpDir();
  fs.writeFileSync(file, [
    line(T0, 'a', U_(10, 1)),
    line(T0 + 1, 'b', U_(100, 50, 20, 3000)),   // last turn: 100+20+3000 in, 50 out
  ].join('\n') + '\n');
  const ledger = scan(dir, U.createLedger());
  const s = U.snapshot(ledger, { session: 'sess-a', now: T0 + 2, ready: true });

  assert.equal(s.ctx.tokens, 3170);
  assert.equal(s.ctx.window, 200000);
  assert.equal(s.ctx.pct, 2);
  assert.equal(s.total.in, 110);
  assert.equal(s.session.msgs, 2);
});

// A configured window smaller than reality (proxy models, a wrong setting) must
// clamp at 100% rather than render 1370%.
test('snapshot: an overflowed context widens the window instead of exceeding 100%', () => {
  const { dir, file } = tmpDir();
  fs.writeFileSync(file, line(T0, 'a', U_(10, 500000)) + '\n');
  const ledger = scan(dir, U.createLedger());
  const s = U.snapshot(ledger, { session: 'sess-a', now: T0 + 1, ready: true });
  assert.equal(s.ctx.pct, 100);
  assert.equal(s.ctx.window, s.ctx.tokens);
});

test('snapshot: cache hit rate and the input total', () => {
  const { dir, file } = tmpDir();
  fs.writeFileSync(file, line(T0, 'a', U_(100, 10, 100, 800)) + '\n');
  const ledger = scan(dir, U.createLedger());
  const s = U.snapshot(ledger, { session: 'sess-a', now: T0 + 1, ready: true });
  assert.equal(s.session.input, 1000);
  assert.equal(s.session.hit, 80);
});

test('snapshot: an empty ledger reports zeroes, not NaN', () => {
  const s = U.snapshot(U.createLedger(), { session: 'nope', now: T0, ready: false });
  assert.equal(s.ctx.tokens, 0);
  assert.equal(s.ctx.pct, 0);
  assert.equal(s.total.in, 0);
  assert.equal(s.session.hit, null);
  assert.equal(s.spark.length, U.SPARK_DAYS);
  assert.equal(s.ready, false);
});

test('snapshot: the seven day spark ends on today', () => {
  const { dir, file } = tmpDir();
  const now = new Date(2026, 8, 14, 12).getTime();
  const today = new Date(2026, 8, 14, 9).getTime();
  fs.writeFileSync(file, line(today, 'a', U_(700, 300)) + '\n');
  const ledger = scan(dir, U.createLedger());
  const s = U.snapshot(ledger, { session: 'sess-a', now, ready: true });
  assert.equal(s.spark.length, 7);
  assert.equal(s.spark[6].day, '2026-09-14');
  assert.equal(s.spark[6].tokens, 1000);
  assert.equal(s.spark[5].tokens, 0);
});

// ---- persistence ------------------------------------------------------------

test('ledger: round-trips through disk', () => {
  const { dir, file } = tmpDir();
  const ledFile = path.join(dir, 'usage.json');
  fs.writeFileSync(file, line(T0, 'a', U_(10, 1)) + '\n');
  const ledger = scan(dir, U.createLedger());
  U.saveLedger(ledFile, ledger);

  const back = U.loadLedger(ledFile);
  assert.equal(back.total.in, 10);
  assert.ok(back.files[file]);

  // and a reloaded ledger keeps incrementing instead of restarting
  fs.appendFileSync(file, line(T0 + 1, 'b', U_(5, 1)) + '\n');
  scan(dir, back);
  assert.equal(back.total.in, 15);
  assert.equal(back.total.msgs, 2);
});

test('ledger: a corrupt file falls back to an empty ledger', () => {
  const { dir } = tmpDir();
  const ledFile = path.join(dir, 'usage.json');
  fs.writeFileSync(ledFile, '{ not json');
  assert.equal(U.loadLedger(ledFile).total.in, 0);
});

// ---- formatting -------------------------------------------------------------

test('fmtTok: compact token counts', () => {
  assert.equal(U.fmtTok(0), '0');
  assert.equal(U.fmtTok(999), '999');
  assert.equal(U.fmtTok(1000), '1k');
  assert.equal(U.fmtTok(1234), '1.2k');
  assert.equal(U.fmtTok(38400), '38.4k');
  assert.equal(U.fmtTok(1048576), '1M');
  assert.equal(U.fmtTok(1240000), '1.2M');
});
