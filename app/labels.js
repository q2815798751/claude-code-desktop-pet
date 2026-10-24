// CLAUDE.PET — human labels for Claude Code tool names.
//
// The panel is 320px wide and its status/session rows are one line each. Raw names
// like `mcp__playwright__browser_take_screenshot` (41 ASCII chars) either push the
// useful part of a row out of view or get ellipsised down to "mcp__playwr…". Every
// tool shown in the UI goes through toolLabel(), which returns a short Chinese
// label; toolTitle() keeps the original for a hover tooltip.
//
// The browser-side copy lives in pet.html (TOOL_CN / MCP_SERVER_CN / MCP_TOOL_CN).
// The page is served as one static file with no imports, so the two tables have to
// stay in step — edit both when adding a tool.
'use strict';

const TOOL_CN = {
  // built-ins
  Bash: '运行命令',
  BashOutput: '查看输出',
  KillShell: '结束进程',
  Read: '读取文件',
  Edit: '编辑文件',
  MultiEdit: '批量编辑',
  Write: '写文件',
  NotebookRead: '读取笔记',
  NotebookEdit: '编辑笔记',
  Glob: '查找文件',
  Grep: '搜索代码',
  LS: '列目录',
  WebSearch: '联网搜索',
  WebFetch: '抓取网页',
  Agent: '调用子代理',
  Task: '调用子代理',
  TaskOutput: '读取代理结果',
  TaskStop: '停止子代理',
  TaskCreate: '创建任务',
  TaskUpdate: '更新任务',
  TaskList: '查看任务',
  TaskGet: '查看任务',
  TodoWrite: '更新任务',
  Skill: '调用技能',
  SlashCommand: '执行命令',
  EnterPlanMode: '进入规划',
  ExitPlanMode: '提交计划',
  AskUserQuestion: '询问用户',
  ListMcpResources: '列出外部资源',
  ReadMcpResource: '读取外部资源',
};

// MCP server name -> short Chinese category.
const MCP_SERVER_CN = {
  playwright: '浏览器',
  puppeteer: '浏览器',
  'chrome-devtools': '浏览器',
  chromeDevtools: '浏览器',
  'brave-search': '联网搜索',
  context7: '文档',
  filesystem: '文件',
  github: '代码库',
  git: '代码库',
  coderabbit: '代码审查',
  sqlite: '数据库',
  postgres: '数据库',
  postgresql: '数据库',
  mysql: '数据库',
  memory: '记忆',
  'sequential-thinking': '推理',
  sequentialthinking: '推理',
  fetch: '网页',
  time: '时间',
  notion: '笔记',
  slack: '聊天',
  sentry: '监控',
  'desktop-commander': '桌面控制',
  everything: '示例',
};

// MCP tool name -> short Chinese action. Covers the playwright server the pet is
// most often used with; suffix heuristics below handle the rest.
const MCP_TOOL_CN = {
  browser_click: '点击',
  browser_navigate: '打开网页',
  browser_navigate_back: '后退',
  browser_evaluate: '执行脚本',
  browser_run_code_unsafe: '执行脚本',
  browser_take_screenshot: '截图',
  browser_snapshot: '读取页面',
  browser_find: '查找页面',
  browser_wait_for: '等待',
  browser_console_messages: '读取控制台',
  browser_network_requests: '读取网络',
  browser_network_request: '读取请求',
  browser_close: '关闭页面',
  browser_resize: '调整窗口',
  browser_press_key: '按键',
  browser_type: '输入文本',
  browser_hover: '悬停',
  browser_drag: '拖拽',
  browser_drop: '拖放',
  browser_fill_form: '填写表单',
  browser_select_option: '选择选项',
  browser_tabs: '切换标签',
  browser_file_upload: '上传文件',
  browser_handle_dialog: '处理弹窗',
  browser_emulate_media: '模拟媒体',
  browser_install: '安装浏览器',
};

// First match wins. Chinese is intentionally generic — the tooltip carries the
// exact name, this only has to stay short and readable.
const MCP_TOOL_HINTS = [
  ['screenshot', '截图'],
  ['click', '点击'],
  ['navigate', '打开网页'],
  ['console', '读取控制台'],
  ['network', '读取网络'],
  ['evaluate', '执行脚本'],
  ['search', '搜索'],
  ['find', '查找'],
  ['query', '查询'],
  ['resolve', '查询'],
  ['read', '读取'],
  ['get', '读取'],
  ['list', '列表'],
  ['create', '创建'],
  ['write', '写入'],
  ['update', '更新'],
  ['edit', '编辑'],
  ['delete', '删除'],
  ['execute', '执行'],
  ['run', '执行'],
  ['type', '输入'],
  ['wait', '等待'],
  ['open', '打开'],
  ['close', '关闭'],
];

function mcpToolWord(tool) {
  if (MCP_TOOL_CN[tool]) return MCP_TOOL_CN[tool];
  const low = String(tool || '').toLowerCase();
  for (const [needle, cn] of MCP_TOOL_HINTS) {
    if (low.indexOf(needle) !== -1) return cn;
  }
  return '调用';
}

// Short, display-safe Chinese label. Unknown non-MCP names are returned as-is
// unless they are long ASCII, which would overflow a row — those become 工具.
function toolLabel(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  if (TOOL_CN[raw]) return TOOL_CN[raw];

  if (raw.indexOf('mcp__') === 0) {
    const parts = raw.split('__');
    const server = parts[1] || '';
    const tool = parts.slice(2).join('__');
    const s = MCP_SERVER_CN[server] || '外部';
    return s + '·' + mcpToolWord(tool);
  }
  // Some integrations report `mcp-playwright-browser_click` / `mcp_xxx` instead.
  if (/^mcp[-_]/.test(raw)) {
    const low = raw.toLowerCase();
    for (const key of Object.keys(MCP_SERVER_CN)) {
      if (low.indexOf(key.toLowerCase()) !== -1) return MCP_SERVER_CN[key] + '·' + mcpToolWord(low);
    }
    return '外部工具';
  }
  // Anything else that is a long unbroken ASCII identifier is unreadable at 9px.
  if (raw.length > 14 && /^[\x20-\x7e]+$/.test(raw)) return '工具';
  return raw;
}

function toolTitle(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const label = toolLabel(raw);
  return label && label !== raw ? label + '（' + raw + '）' : raw;
}

module.exports = { TOOL_CN, MCP_SERVER_CN, MCP_TOOL_CN, toolLabel, toolTitle };
