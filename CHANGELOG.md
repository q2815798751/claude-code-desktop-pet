# Changelog

本文件记录 ClaudePet 的每次功能与修复改动。

## v1.0.3 (2026-08-03)
- **移除**：放弃"文本发送到 claude + 对话面板"功能（多种注入方案对控制台 claude 均不可靠），清理 `pet.html`/`server.js`/`pet.ps1` 中的相关代码与残留（`send.txt`/`send.result`）。
- **feat 图片放大**：中心桌宠/圆环放大到 `min(80%,300px)`，左右留白大幅减少。
- **feat 字体缩放**：右上角新增 `−`/`+` 按钮（键盘 `-`/`=` 同效），整体字号 `--fs` 等比缩放（范围 0.85–1.35，默认 1.0=当前状态），UI/按钮/主题随字号自适应不裁切。
- **feat 配置持久化**：新增服务端 `app/config.json`（`POST /api/config` + SSR 注入 `__CONFIG__`），配合 `localStorage` 双写；窗口关闭/退出（`beforeunload`）前保存主题与字号。

## v1.0.2 (2026-08-03)
- **feat 终端按钮合并**："焦点"+"收起/打开"合并为一个"终端"按钮：点一下终端最小化，再点还原并置前（`pet.ps1` 用 `IsIconic` 判断状态后切换）。双击桌宠仍为聚焦。
- **feat 底部对话 + 文本输入**：桌宠底部新增对话面板（小字体、可折叠、自动滚动）显示最近对话，以及输入条可**发送文本到 claude**（回车或点"发送"）。发送走 **剪贴板 + 自动粘贴**（`Set-Clipboard` 保真 Unicode/中文 → 尝试聚焦终端 → `SendInput Ctrl+V`；聚焦失败则文本已在剪贴板，提示手动 Ctrl+V）。`WriteConsoleInput` 注入曾尝试但中文在 claude 的 VT 输入模式下必乱码，`SendInput` 打字又受 Windows 前台锁定限制，故采用剪贴板方案。仅当 claude 空闲时允许发送，忙碌/离线会 toast 提示；`/api/send` 返回 `how: pasted|clipboard` 供客户端提示。
- **feat 窗口横向缩放**：`#shell` 改流式（`width:100%; min-width:320px`），Edge 窗口可拖拽缩放；桌宠与动态圆环始终保持居中并按 `--pet-size` 自适应（封顶防模糊）；主题配色任意宽度下正常。
- 新增 API：`GET /api/conv`（最近对话）、`POST /api/send`（发送）；`/api/terminal?act=toggle`。
- `docs/CONFIG.md` 补充新按钮/API/对话说明。

## v1.0.1 (2026-08-03)
- **fix 状态推断**：不再依赖转录文件 mtime（流式输出期间不写转录，导致误判 idle / 结束后延迟 25s 才变 idle）。改为读取**最新转录的最后一条有意义消息并按内容分类**：`user输入 / tool_result / thinking / tool_use` → working（回合中）；`assistant 纯text` → done(5s) → idle；回合时长驱动 thinking/working/working_long。见 `app/server.js` 的 `classifyMessage` / `readLastMessage`。
- **feat 主题功能**：新增 4 套主题 —— `cyber`(赛博霓虹,默认) / `paper`(极简白) / `matrix`(终端绿) / `gold`(暗金OLED)。新增"主题"按钮 + 键盘 `T` 循环切换，`localStorage` 持久化，标题栏显示当前主题名，各主题独立状态配色。见 `app/pet.html`。
- **fix 收起/还原/焦点**：终端进程的 `MainWindowHandle` 为 0 导致失效。改用 `FreeConsole→AttachConsole→GetConsoleWindow` 获取真实控制台句柄后 `ShowWindow`/`SetForegroundWindow`，失败回退旧逻辑。见 `app/pet.ps1`。
- **chore**：新增本文件；`docs/CONFIG.md` 补主题说明。

## v1.0.0 (2026-08-03)
- 初始版本：零依赖 Windows 桌面桌宠（320×440），实时反映 Claude Code CLI 工作状态（thinking/working/working_long/done/idle/offline/error）。
- 架构：Node.js 内置模块 HTTP 服务 `127.0.0.1:9876` + `msedge --app` 伪透明窗口 + 系统 PowerShell 窗口操作；SSR 注入初始状态，客户端 500ms 轮询切 GIF。
- 配套：环境自检 `check-env.bat/.js`、便携安装/卸载 `install.bat`/`uninstall.bat`、幂等启动 `start-both.bat`、GitHub 私有仓库 `q2815798751/claude-code-desktop-pet`。
