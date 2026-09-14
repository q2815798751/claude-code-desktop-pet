# CLAUDE.md — 给 AI 协作者的开发说明

本文件帮助 AI 与人类协作时理解项目结构与约定。

## 项目是什么
一个 Windows 透明桌面宠物（悬浮球 + 全面板），实时反映 **Claude Code CLI** 的工作状态。
零外部依赖：Node.js 内置模块 HTTP 服务 + WinForms/WebView2 无边框真透明宿主 + PowerShell 辅助。

## 目录结构
```
app/                  ← 部署单元（必须保持扁平：server.js 与 pet.html/gif 同目录）
  server.js            HTTP 服务 @127.0.0.1:9876 + SSE + hook 事件入口 + 进程探活
  state.js             纯状态机（无 IO、无全局，可直接单测）
  transcript.js        转录快照（一次扫描 + 一次尾部读，按 (path,size,mtime) 缓存）
  util.js              safeJson：SSR 注入转义
  pet.html             赛博朋克 HUD，EventSource 订阅 /events 切 GIF
  notify.cmd           hook 转发器（stdin → POST /event，永远 exit 0）
  hooks.js             幂等挂载/摘除 ~/.claude/settings.json 里的 hooks
  pet.ps1              窗口助手（开宿主窗 / 焦点 / 收起 / 展开终端）
  pet-term.ps1         终端宿主（在 $env:USERPROFILE 里启动 claude）
  *.test.js            node --test 用例
  *.gif  pet.ico       状态动画与图标
check-env.bat/.js      环境自检（node / claude / WebView2 / curl / 转录目录）
install.bat / uninstall.bat
start-both.bat         终端+claude + 服务 + 桌宠窗（幂等，先自检）
start-pet.bat / stop-pet.bat
docs/                  INSTALL / CONFIG / DESIGN / HOST
```

## 硬性约定（踩过坑，勿破）
1. **`.bat` 文件必须纯 ASCII**——中文会被 cmd 代码页乱码。中文只写进 `.js` / `.md` / `.txt`。
2. **零外部依赖**——只允许 Node 内置模块；窗口操作用系统自带的 PowerShell；压缩用 `Compress-Archive`。不要引入 npm 包。
3. **路径一律 `%~dp0` / `%CD%` 展开**，不要在 .bat 里写死含中文的路径字面量。
4. PowerShell 里 **`$PID` 是只读自动变量**，参数名不能叫 `Pid`（会导致静默失败），用 `ProcId`。
5. **自身进程误判**：server.js 检测 claude 时，命令行含 `server.js` 的 node 进程必须排除（安装路径 `ClaudePet` 含 "claude" 字样，否则会自匹配误报在线）。
6. **`.bat` 块内文本严禁未加引号的括号**：凡位于 `if (...) (  ...  )` 或 `for ... do (  ...  )` 块内的 `echo`/文本不能含裸露的 `(` `)`（如 `echo ...(first run)...`)，否则 cmd 解析整份 `.bat` 会崩、直接 `exit 255` 且不进入任何后续分支（曾导致首次启动静默失败）。必须改为不加括号的写法（如 `- first run`），或塞进被块内引号包住的字符串里。

7. **改 `~/.claude/settings.json` 只准动 hooks，且只动带 `notify.cmd` 标记的条目**——`app/hooks.js` 已封装
   （幂等、自动备份、保留他人条目）。不要手写这段 JSON，也不要碰 `env` 等其它字段。
8. **`notify.cmd` 必须永远 `exit /b 0`**——它挂在每一次工具调用上，非零退出会在你的会话里刷警告。

## 关键文件入口
- 状态机与阈值：`app/state.js` 的 `DEFAULTS` 与 `reduce()`（优先级：shuttingDown → forced → error → !alive → 活动）。
- 存活判定：`app/state.js` 的 `computeAlive()`；探活频率与"有活动就跳过"在 `app/server.js` 的 `shouldProbe()`。
- 信号仲裁：`app/server.js` 的 `currentActivity()`（hooks 优先，转录兜底）。
- 转录解析：`app/transcript.js` 的 `parseTail()` / `classify()` / `errorOf()`。
- 进程检测：`app/server.js` 的 `probeClaude()`（claude.exe 或 node 跑 claude CLI，排除自身）。
- 工具中文名：`app/server.js` 的 `TOOL_LABELS` 与 `app/pet.html` 的 `TOOL_CN`（**两处要一致**）。
- API 说明：见 `docs/CONFIG.md`。

## 测试流程
1. `node --test app/*.test.js` —— 状态机/解析/转义的单测，改完先跑这个。
2. `check-env.bat` → `start-both.bat`（或 `node app/server.js`）→ 观察 `/api/state`、GIF 切换。
3. 与正在运行的桌宠共存调试：`CLAUDEPET_PORT=19876 node app/server.js`（宿主窗固定在 9876，别改默认端口）。
4. 手动喂事件：`curl -X POST http://127.0.0.1:9876/event -H "Content-Type: application/json" -d '{"hook_event_name":"PreToolUse","session_id":"t","tool_name":"Bash"}'`。
5. 关掉终端验证 5s 内桌宠自退。`.bat` 层面因沙箱限制常用 `node` 包装 `execFile` 来调用。
