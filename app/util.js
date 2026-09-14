// CLAUDE.PET - small pure helpers.
'use strict';

const BS = String.fromCharCode(92); // backslash

const ES = {};
ES['<'] = BS + 'u003c';
ES[String.fromCharCode(0x2028)] = BS + 'u2028';
ES[String.fromCharCode(0x2029)] = BS + 'u2029';

// U+2028 / U+2029 are literal line terminators to a JS parser, so JSON that
// contains them would break the page it is injected into.
const RISKY = /[<\u2028\u2029]/g;

// JSON safe to drop inside an inline <script>. A bare "<" is enough for
// transcript-derived text (a tool name, a path) to close the tag early.
function safeJson(v) {
  return JSON.stringify(v).replace(RISKY, (ch) => ES[ch]);
}

module.exports = { safeJson, RISKY };
