# CLAUDE.md — 给 AI 协作者的开发说明

本文件帮助 AI 与人类协作时理解项目结构与约定。

## 项目是什么
一个 Windows 透明桌面宠物（320×440），实时反映 **Claude Code CLI** 的工作状态。
零外部依赖：Node.js 内置模块 HTTP 服务 + `msedge --app` 伪透明窗口 + PowerShell 辅助。

## 目录结构
```
app/                  ← 部署单元（必须保持扁平：server.js 与 pet.html/gif 同目录）
  server.js            HTTP 服务 @127.0.0.1:9876 + 状态机 + 进程检测
  pet.html             赛博朋克 HUD，500ms 轮询 /api/state 切 GIF
  pet.ps1              窗口助手（开 Edge / 焦点 / 收起 / 展开终端）
  pet-term.ps1         终端宿主（在 $env:USERPROFILE 里启动 claude）
  *.gif  pet.ico       状态动画与图标
check-env.bat/.js      环境自检（node / claude / edge / 转录目录）
install.bat / uninstall.bat
start-both.bat         终端+claude + 服务 + 桌宠窗（幂等，先自检）
start-pet.bat / stop-pet.bat
docs/                  INSTALL / CONFIG / DESIGN
```

## 硬性约定（踩过坑，勿破）
1. **`.bat` 文件必须纯 ASCII**——中文会被 cmd 代码页乱码。中文只写进 `.js` / `.md` / `.txt`。
2. **零外部依赖**——只允许 Node 内置模块；窗口操作用系统自带的 PowerShell；压缩用 `Compress-Archive`。不要引入 npm 包。
3. **路径一律 `%~dp0` / `%CD%` 展开**，不要在 .bat 里写死含中文的路径字面量。
4. PowerShell 里 **`$PID` 是只读自动变量**，参数名不能叫 `Pid`（会导致静默失败），用 `ProcId`。
5. **自身进程误判**：server.js 检测 claude 时，命令行含 `server.js` 的 node 进程必须排除（安装路径 `ClaudePet` 含 "claude" 字样，否则会自匹配误报在线）。
6. **`.bat` 块内文本严禁未加引号的括号**：凡位于 `if (...) (  ...  )` 或 `for ... do (  ...  )` 块内的 `echo`/文本不能含裸露的 `(` `)`（如 `echo ...(first run)...`)，否则 cmd 解析整份 `.bat` 会崩、直接 `exit 255` 且不进入任何后续分支（曾导致首次启动静默失败）。必须改为不加括号的写法（如 `- first run`），或塞进被块内引号包住的字符串里。

## 关键文件入口
- 状态机与阈值：`app/server.js` 顶部常量区（THINK_MS / WORK_MS / BURST_GAP_MS / DONE_HOLD_MS / SHUTDOWN_HOLD_MS / ERROR_WINDOW_MS）。
- 进程检测：`app/server.js` 的 `claudeAliveCheck()`（claude.exe 或 node 跑 claude CLI，排除自身）。
- 活动推断：`scanLatestMtime()` 扫 `~/.claude/projects/**/*.jsonl` 的 mtime。
- API 说明：见 `docs/CONFIG.md`。

## 测试流程
改完先跑 `check-env.bat` → `start-both.bat`（或 `node app/server.js`）→ 观察 `/api/state`、
GIF 切换；关掉终端验证 5s 内桌宠自退。`.bat` 层面因沙箱限制常用 `node` 包装 `execFile` 来调用。
