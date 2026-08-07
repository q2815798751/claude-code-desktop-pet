# Changelog

本文件记录 ClaudePet 的每次功能与修复改动。

## v1.0.1 (2026-08-03)
- **fix 状态推断**：不再依赖转录文件 mtime（流式输出期间不写转录，导致误判 idle / 结束后延迟 25s 才变 idle）。改为读取**最新转录的最后一条有意义消息并按内容分类**：`user输入 / tool_result / thinking / tool_use` → working（回合中）；`assistant 纯text` → done(5s) → idle；回合时长驱动 thinking/working/working_long。见 `app/server.js` 的 `classifyMessage` / `readLastMessage`。
- **feat 主题功能**：新增 4 套主题 —— `cyber`(赛博霓虹,默认) / `paper`(极简白) / `matrix`(终端绿) / `gold`(暗金OLED)。新增"主题"按钮 + 键盘 `T` 循环切换，`localStorage` 持久化，标题栏显示当前主题名，各主题独立状态配色。见 `app/pet.html`。
- **fix 收起/还原/焦点**：终端进程的 `MainWindowHandle` 为 0 导致失效。改用 `FreeConsole→AttachConsole→GetConsoleWindow` 获取真实控制台句柄后 `ShowWindow`/`SetForegroundWindow`，失败回退旧逻辑。见 `app/pet.ps1`。
- **chore**：新增本文件；`docs/CONFIG.md` 补主题说明。

## v1.0.0 (2026-08-03)
- 初始版本：零依赖 Windows 桌面桌宠（320×440），实时反映 Claude Code CLI 工作状态（thinking/working/working_long/done/idle/offline/error）。
- 架构：Node.js 内置模块 HTTP 服务 `127.0.0.1:9876` + `msedge --app` 伪透明窗口 + 系统 PowerShell 窗口操作；SSR 注入初始状态，客户端 500ms 轮询切 GIF。
- 配套：环境自检 `check-env.bat/.js`、便携安装/卸载 `install.bat`/`uninstall.bat`、幂等启动 `start-both.bat`、GitHub 私有仓库 `q2815798751/claude-code-desktop-pet`。
