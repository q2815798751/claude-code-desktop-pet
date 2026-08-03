# 架构设计

## 总览
```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│ msedge --app (伪透明窗)     │ 500ms  │ node app/server.js           │
│  app/pet.html (HUD+GIF)     │◄──────►│ HTTP @127.0.0.1:9876         │
│  500ms 轮询 /api/state       │ 轮询   │ · 状态机（转录 mtime 推断）  │
│  双击→/api/focus 等交互      │        │ · tasklist/Get-CimInstance  │
└─────────────────────────────┘        │ · PowerShell 窗口操作        │
                                       └──────┬───────────────────────┘
                                              │ 读取
                                    ┌─────────▼─────────┐
                                    │ ~/.claude/projects │  ← claude 会话转录
                                    │ *.jsonl  mtime     │
                                    └───────────────────┘
```
- **透明窗**：`msedge --app=http://127.0.0.1:9876/` 伪透明（快）；真透明需 C# WPF+WebView2（慢，未采用）。
- **SSR 注入**：`GET /` 把 `stateJson()` 写入 HTML 的 `window.__INIT__`，首屏即显示正确状态。
- **短轮询**：客户端 `setInterval(poll, 500)`，服务端同样 500ms 计算一次状态并缓存到内存。

## 状态推断
- `scanLatestMtime()`：扫描 `~/.claude/projects/**/*.jsonl`，取**最新 mtime** 作为“最后活动时间”。
- `claudeAliveCheck()`：识别 `claude.exe`（原生 / WinGet）**或** `node.exe` 运行 Claude Code CLI
  （npm 安装，命令行含 `claude-code` / `@anthropic-ai` / `cli.js`），并**排除自身**（命令行含 `server.js`，
  避免安装目录 `ClaudePet` 含 "claude" 导致的自我误判）。
- 终端存活：记录 `start-both.bat` 拉起的终端 PID 到 `app/term.pid`，服务每 2s 查一次；
  PID 死亡 → 服务进入关闭流程（客户端收到 `shutdown:true` 后 `window.close()`，服务端兜底强杀 Edge）。

## 状态机（活动 burst 模型）
```
claude 未运行 ─────────────► offline
claude 运行且最近 25s 内有写入：
  连续活动 <5s  → thinking
  5–30s         → working
  >30s          → working_long
无写入 >25s（活动结束）：
  先 done 5s ──► idle
最近 30s 转录含 "isError":true → error（覆盖上面）
```
“done” 在每次活动 burst 结束时闪 5s，模拟“刚完成任务”。

## 文件职责
| 文件 | 职责 |
|---|---|
| `app/server.js` | HTTP 服务、状态机、进程/转录监控、PowerShell 调用、GIF/HTML 托管 |
| `app/pet.html` | HUD UI：霓虹样式、500ms 轮询、交互按钮、键盘快捷键 |
| `app/pet.ps1` | 开 Edge 窗（右下角）、焦点/最小化/还原终端（ShowWindow P/Invoke） |
| `app/pet-term.ps1` | 终端宿主：在 `$env:USERPROFILE` 启动 claude（保证包可移动） |
| `check-env.bat/.js` | 环境自检（node / claude / edge / 转录目录） |
| `start-both.bat` | 幂等启动：环境自检 → 终端+claude → 服务 → 桌宠窗 |
| `install.bat` | 安装到 `%LOCALAPPDATA%\ClaudePet` + 快捷方式 |

## 安全与边界
- 服务只监听 `127.0.0.1`，API 无敏感操作（焦点/窗口/退出）。
- 只读扫描转录文件，不修改用户数据；运行期文件（`term.pid`、`edge_profile/`）都在安装目录内。
- 零外部依赖：全部使用 Node 内置模块 + Windows 自带 PowerShell / Edge / curl / Compress-Archive。
