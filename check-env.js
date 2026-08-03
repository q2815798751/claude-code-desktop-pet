// CLAUDE.PET - environment self check (Chinese report, UTF-8).
// Exit code: 0 = all required components present; 1 = required missing.
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let fail = false;
const lines = [];

function add(kind, ok, msg, fix) {
  const mark = ok ? '  [OK]      ' : (kind === 'WARN' ? '  [WARN]    ' : '  [MISSING] ');
  lines.push(mark + msg + (fix ? '\n             -> ' + fix : ''));
  if (!ok && kind !== 'WARN') fail = true;
}

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', windowsHide: true, timeout: 8000 }).trim();
  } catch {
    return '';
  }
}

lines.push('=================================================');
lines.push('   CLAUDE.PET - 环境自检  /  Environment Check');
lines.push('=================================================');
lines.push('');

// 1. node
const nodeV = sh('node --version');
const m = /^v(\d+)/.exec(nodeV);
const nodeOk = !!m && parseInt(m[1], 10) >= 18;
add('REQ', nodeOk, 'Node.js >= 18  （当前: ' + (nodeV || '未检测到') + '）',
  '下载安装 https://nodejs.org  （装完重开终端）');

// 2. claude code cli
const claudeV = sh('claude --version');
const claudeOk = !!claudeV;
add('REQ', claudeOk, 'Claude Code CLI  （当前: ' + (claudeV || '未检测到') + '）',
  'npm i -g @anthropic-ai/claude-code   或   https://claude.com/download');

// 3. edge
const edgeCands = [
  (process.env['ProgramFiles(x86)'] || '') + '\\Microsoft\\Edge\\Application\\msedge.exe',
  (process.env.ProgramFiles || '') + '\\Microsoft\\Edge\\Application\\msedge.exe',
];
const edgeOk = edgeCands.some((p) => p && fs.existsSync(p));
add('WARN', edgeOk, 'Microsoft Edge（桌宠窗口需要）',
  '仅影响窗口显示，服务端仍可运行');

// 4. transcripts dir
const proj = path.join(os.homedir(), '.claude', 'projects');
const projOk = fs.existsSync(proj);
add('WARN', projOk, 'Claude 转录目录  ' + proj,
  '先运行一次 "claude" 会自动创建');

// 5. os
add('OK', true, '操作系统  ' + os.type() + ' ' + os.release() + '  ' + os.arch());

lines.push('');
lines.push('-------------------------------------------------');
lines.push(fail ? '  结论: 有必需项缺失，请按上方提示安装后重试' : '  结论: 环境就绪，可以启动 ClaudePet');
lines.push('=================================================');

console.log(lines.join('\n'));
process.exit(fail ? 1 : 0);
