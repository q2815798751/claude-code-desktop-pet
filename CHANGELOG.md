# Changelog

本文件记录 ClaudePet 的每次功能与修复改动。

## v2.1.1 (2026-09-14) — 告警红点改为"未读"语义、球上文案不再截断

**修复**
- **fix 球上告警被截断**：球窗口只有 150×170，一行省略号放不下 `今日用量偏高 · 今日 62M tokens` 这类文案
  （字号缩放后更甚）。改为**标题一行 + 明细一行**、最多三行的换行布局，字号收小并加 `--bg1` 描边保证
  压在 GIF 上仍可读。实测最长文案两行完整显示，`scrollWidth === clientWidth` 无裁剪。
- **fix 告警红点常亮**：角标此前数的是"条件仍成立"的告警，于是一个持续一下午的条件（上下文高于阈值、
  当日用量高于阈值）会让红点一直亮着，久而久之就没有意义了。现在区分**未读**：
  - 点角标 → 清除红点 + 弹出气泡让人看清内容（球形态下顺带展开面板）；
  - **手动**关掉气泡（点卡片或 `×`）也算已读；**8 秒超时自动消失不算**——没人看的时候超时，
    不该被当成"看过了"；
  - 同一条规则**再次触发**（新的 `firedAt`）才重新点亮。
- **fix 双击按钮会抢终端**：用量页的 dblclick 聚焦不区分目标，双击「今日」tab、告警开关或 `A+`
  会在执行自身动作之外，顺手把 claude 终端切到前台。现在只在空白处生效。
- **fix 每次点击都写一次 DOM**：`hideBubbles()` 在菜单未打开时也照样 `innerHTML = ''`，
  而它挂在全局 `click` 上。加了开关判断（实测 20 次点击的 DOM 写入数由 20 降到 0）。

**变更**
- 告警角标进入拖动的排除名单：它是小目标，手抖 3px 变成"移动窗口"而不是"打开告警"，是最糟的结果。

## v2.1.0 (2026-09-14) — 用量可视化、告警气泡、面板可拖动

**新增**
- **feat token 用量统计**（`app/usage.js`）：只读扫描 `~/.claude/projects/**/*.jsonl` 里每条 assistant 行的
  `message.usage`，增量落盘到 `app/usage.json`。面板新增**常驻用量瘦条**（`↑输入 ↓输出 CTX 百分比`）与
  **用量页**（`▤` 或点瘦条切换）：本次 / 今日 / 累计三档、缓存命中率、API 调用次数、上下文占用条、近 7 日柱状。
  **不显示金额**——模型名与单价因代理/第三方网关而异，猜一个数字不如不给。
- **feat 用量告警**（`app/alerts.js`）：6 条规则（上下文将满 / 偏满、单回合输出偏大、缓存命中偏低、今日用量偏高、
  用量激增），**边沿触发 + 冷却**，阈值在 `app/config.json` 的 `usage` 段可调，用量页底部一键开关。
- **feat 告警气泡**：聊天软件观感的卡片，从「现在:」上方往上堆叠，最多 3 条，8 秒倒计时自动消失，点卡片或 `×` 关闭。
  配色取自主题的告警强调色（`--warn` 琥珀 / `--crit` 红），crit 级带一次抖动 + 双音。悬浮球形态下改为
  圆环角标 + 底部一行告警文字；**crit 级会自己展开面板**弹出气泡。
- **feat 面板可拖动**：标题行 + 状态行就是拖动区（`makeDraggable`，球与面板共用一套）。移动小于 2px 仍算点击，
  `▤` / `⇲` 不受影响。
- **feat 面板展开以窗口中心为锚点**：此前球→面板是从左上角往右下"长"，视觉上跳一下；现在围绕中心缩放，
  并复用既有的边界 clamp，角落里的球不会把面板顶出屏幕。

**修复**
- **fix 拖动时刷盘**：`MoveBy` 每个 pointermove 都写一次 `host.json`（拖动时每秒几十次）。改为脏标记 +
  停手 400ms 后落一次（`ClaudePetHost._saveTimer`）。
- **fix 用量激增规则在首次建账时误报**：账本从空跳到全量语料，读起来就是一次巨大暴涨。现在首次 ready 的那一帧
  只播种基线不评估速率类规则，且 `usage.spike` 需要至少 60s 的采样跨度才给读数。
- **fix 告警气泡盖住「现在:」行**：改成按 `nowbar` 的实测位置动态定位，字号放大时也不会压住。
- **fix 零值日期在 7 日柱状图里不可见**，看起来像图表断裂。零值日改为灰色基线柱。

**移除**
- **调试、退出按钮**：正常使用不需要；关终端即自动退出。退出入口保留在右键气泡菜单里。
- **`Esc` 退出 与 `D` 调试快捷键**：容易误触。（`POST /api/debug` 端点保留，`[DBG]` 标记保留。）
- 字号 `−` / `+` 按钮从标题行移到用量页底部（320px 宽的标题行放不下第 4 个按钮），键盘 `-` / `=` 不变。

**工程**
- 新增 `node --test` 用例 41 条（用量 22 / 告警 19），总数 39 → 80，`node --test app/*.test.js`。
- 实测校正：本机 4852 行带 `usage` 的转录只有 1763 个唯一 `message.id`——**按行计会虚报 2.75 倍行数、3.13 倍 token**。
  这条已写进 `CLAUDE.md` 的硬性约定。账本增量结果与全量重算逐位一致。
- `transcript.js` 抽出 `listTranscripts()`，转录快照与用量扫描共用同一次目录遍历。
- `app/config.json` 改为逐键白名单读取（原先 `Object.assign` 会把任意字段吃进内存）。

## v2.0.0 (2026-09-14) — 从"猜"改成"被通知"

**架构**
- **feat hooks 信号源**：新增 `app/notify.cmd`（把 hook 事件的 stdin JSON 原样 POST 给服务，**永远 exit 0**，绝不阻塞工具调用）
  与 `app/hooks.js`（幂等挂载/摘除 `~/.claude/settings.json` 里的 8 个事件，带 `.claudepet.bak` 备份，只增删带 `notify.cmd` 标记的条目）。
  install/uninstall 脚本已接入。**精确知道在跑哪个工具、回合何时结束、claude 何时在等你**——不再靠时间阈值猜。
- **feat SSE**：`GET /events` 推送状态变化，取代客户端 500ms 轮询（轮询保留为回退路径）。`windowActive()` 把 SSE 连接也算作窗口存活。
- **feat 新增 `awaiting` 状态**：`Notification` 事件触发，琥珀色 + 提示音——"claude 卡在你这"是最该被提醒的时刻。
- **feat 状态带工具名**：`working` 携带 `tool`，面板/悬浮球直接显示 `BASH` / `编辑文件`，而不是一律 "WORKING"。
- **refactor 状态机抽成纯函数** `app/state.js`：无 IO、无全局，`reduce(prev, facts) -> next`，可直接单测。
- **refactor 转录读取抽成** `app/transcript.js`：一次目录扫描 + 一次尾部读，按 `(path,size,mtime)` 缓存解析结果。
  此前每个 tick 会扫 4 遍目录（`scanLatestMtime` / `readLastMessage` / `scanRecentError` / `readLastAction`），
  且每次 `/api/state` 请求还会再扫一遍。
- **perf 进程探活**：每 2s → 每 8s，且**最近 10s 内有任何活动时完全跳过**（有活动即证明 claude 活着）。探活不再是常驻开销。
- **feat 会话锚点**：`SessionStart`/`SessionEnd` 直接告知会话生灭；PID 只保留"终端死亡则自退"这一条既有语义。

**修复**
- **fix 提示音刷屏**：`error` 状态持续期间每 500ms 触发一次 toast + 提示音。改为只在状态**真正翻转**时提醒（实测 4s 内由 8 次降到 1 次）。
- **fix 提示音失效**：`beep()` 每次新建 `AudioContext` 且从不释放，浏览器约 6 次后开始抛异常（被 catch 吞掉），表现为"响几声就哑了"。改为全页复用一个。
- **fix 断连即退**：`poll()` 的 catch 里直接 `window.close()`，服务重启的瞬时错误就会关掉桌宠。改为连续失败 6 次才退。
- **fix 本地 CSRF**：任意网页都能用一行 `fetch('http://127.0.0.1:9876/api/exit',{method:'POST'})` 关掉桌宠
  （简单请求不触发预检，CORS 只挡读不挡执行）。所有 `POST` 与 `/events` 现在校验 `Origin`/`Host`。
- **fix SSR 注入面**：`window.__INIT__` 用字符串替换注入 JSON，而 `lastAction` 来自转录里的工具名（模型输出）。
  新增 `app/util.js` 的 `safeJson`，转义 `<` 与 U+2028/U+2029。
- **fix 错误状态滞留**：工具报错后即使 claude 已经继续工作，仍会红 30s。现在 claude 一旦产出更新的消息就立即解除。
- **fix `awaiting` 吃掉回合**：等你在权限提示上做选择时，那个回合仍应算"进行中"，否则紧随其后的 `Stop` 不会闪 `done`。
- **fix `/api/debug` 打回 offline**：强制状态时用残缺的 facts 调 reducer，缺失的 `claudeAlive` 会被读成"离线"，导致循环调试时状态乱跳。
- **fix 配置双源**：主题/字号曾同时写 `localStorage` 与 `app/config.json`，手改 config.json 后两边会打架。现在服务端是唯一真相。

**文档 / 工程**
- 新增 `node --test` 用例 39 条（状态机 18 / 转录解析 17 / 转义 4），`node --test app/*.test.js`。
- 支持 `CLAUDEPET_PORT` 环境变量，方便与正在运行的桌宠共存调试。
- 重写 `README.md` 与 `docs/DESIGN.md`（此前两者仍描述 `msedge --app` 伪透明窗与 mtime 推断，与代码脱节已久），更新 `docs/CONFIG.md`、`docs/INSTALL.md`。


## v1.1.1 (2026-08-07)
- **feat 主题**：新增 2 套主题（`sunset` 落日橙、`ocean` 深海蓝），共 6 套循环切换。
- **feat 样式**：面板与气泡菜单文字加粗（font-weight:600）、文字色更深，任意主题下更醒目。
- **交互微调**：左键拖动/单击开面板、右键开面板+光标处气泡、悬停 1s 展开、离开 3s 收起。

## v1.1.0 (2026-08-07) — 悬浮球化（无边框真透明宿主）
- **架构**：新增 `host/`（WinForms + WebView2 无边框真透明宿主 `ClaudePet.Host.exe`），替代 Edge `--app` 窗口。无标题栏/最小化/关闭按钮，始终置顶、可拖动。
- **透明方案**：用 **DWM 玻璃**（`DwmExtendFrameIntoClientArea` 负边距）+ WebView2 透明背景实现真透视。**关键**：不能用 `TransparencyKey`/`Opacity`（会启用 `WS_EX_LAYERED`，导致 WebView2 收不到鼠标输入——球显示正常但点不动）；DWM 方案非分层，输入正常，透明度改为宿主 `ExecuteScriptAsync` 设置页面 CSS 淡出。
- **悬浮球**：平时仅显示可拖动的圆环+图片+状态字（待命/思考中…，位于图片与外环之间，展开后消失）；左键/悬停展开全面板；右键弹出**中心对称透明气泡菜单**（主题/终端/置顶/透明度±/退出）。
- **透明度**：气泡 `+透/−透` 调节窗口透明度（真透视淡出，存 `host.json`）。
- **置顶 + 记忆位置/大小**：始终置顶开关；窗口位置/大小/透明度持久化到 `app/host.json`，重开恢复。
- **"现在在做什么"**：面板显示 claude 当前动作（`/api/state` 新增 `lastAction`，从转录最新 `tool_use` 提取）。
- **完成/出错提醒**：长任务完成或工具报错时 toast + 提示音。
- **宿主构建**：`host/build.bat` 用内置 csc 编译；WebView2 运行时 Win10/11 自带（用户零安装）。

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
