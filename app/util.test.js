// node --test app/util.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { safeJson } = require('./util');

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

test('safeJson: plain JSON is untouched', () => {
  assert.equal(safeJson({ a: 1, b: 'x' }), '{"a":1,"b":"x"}');
});

test('safeJson: a "<" cannot close the surrounding script tag', () => {
  const out = safeJson({ t: '</script><img src=x onerror=alert(1)>' });
  assert.equal(out.indexOf('<'), -1);
  assert.equal(JSON.parse(out).t, '</script><img src=x onerror=alert(1)>');
});

test('safeJson: line separators cannot break the script tag either', () => {
  const out = safeJson({ t: 'a' + LS + 'b' + PS + 'c' });
  assert.equal(out.indexOf(LS), -1);
  assert.equal(out.indexOf(PS), -1);
  assert.equal(JSON.parse(out).t, 'a' + LS + 'b' + PS + 'c');
});

test('safeJson: output is valid JSON for hostile input', () => {
  const hostile = { tool: '</script>', path: 'C:\\a\\b', n: null, arr: [1, '<', 2] };
  assert.deepEqual(JSON.parse(safeJson(hostile)), hostile);
});
