// node --test app/labels.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('./labels');

test('built-in tools keep their short Chinese label', () => {
  assert.equal(L.toolLabel('Bash'), '运行命令');
  assert.equal(L.toolLabel('Edit'), '编辑文件');
});

test('playwright MCP tools become server·action in Chinese', () => {
  assert.equal(L.toolLabel('mcp__playwright__browser_take_screenshot'), '浏览器·截图');
  assert.equal(L.toolLabel('mcp__playwright__browser_click'), '浏览器·点击');
  assert.equal(L.toolLabel('mcp__playwright__browser_navigate'), '浏览器·打开网页');
  assert.equal(L.toolLabel('mcp__playwright__browser_console_messages'), '浏览器·读取控制台');
});

test('unknown MCP server stays short and Chinese', () => {
  assert.equal(L.toolLabel('mcp__some-very-long-server__read_file'), '外部·读取');
  assert.equal(L.toolLabel('mcp-very-long-integration-name'), '外部工具');
});

test('unmapped long ASCII cannot overflow a row', () => {
  assert.equal(L.toolLabel('some_extremely_long_tool_name'), '工具');
  assert.equal(L.toolLabel('Task'), '调用子代理');
});

test('the tooltip keeps the original name for hover', () => {
  assert.equal(
    L.toolTitle('mcp__playwright__browser_evaluate'),
    '浏览器·执行脚本（mcp__playwright__browser_evaluate）'
  );
});
