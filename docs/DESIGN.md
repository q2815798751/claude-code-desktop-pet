# 架构设计

## 总览
```
┌────────────────────────────┐  SSE /events   ┌────────────────────────────────┐
│ ClaudePet.Host.exe         │◄──────────────►│ node app/server.js             │
│  WebView2 · DWM 真透明     │  状态变化即推送 │  HTTP @127.0.0.1:9876          │
│  app/pet.html (HUD+GIF)    │                │                                │
│  双击→/api/focus 等交互     │  POST /event   │  · state.js    纯状态机        │
└────────────────────────────┘◄───────────────│  · transcript.js 转录快照      │
        ▲                        hooks 转发    │  · usage.js    token 用量账本   │
        │                                      │  · alerts.js   用量告警规则     │
        │                                      │  · util.js     SSR 安全注入    │
        │                                      │  · PowerShell 窗口操作          │
        │                                      └────┬──────────────┬────────────┘
        │                                           │ 回退读取      │ 兜底探活
        │                                 ┌─────────▼────────┐  ┌──▼──────────────┐
        │                                 │ ~/.claude/       │  │ Get-CimInstance │
        │      ┌──────────────────────────┤ projects/**.jsonl│  │ claude/node 进程│
        └──────┤ Claude Code hooks        └──────────────────┘  └─────────────────┘
               │ (app/notify.cmd → POST /event)
               └── 由 install.bat 幂等写入 ~/.claude/settings.json
```

## 三个信号源，按可信度排序

| 优先级 | 来源 | 精确度 | 成本 |
|---|---|---|---|
| 1 | **Claude Code hooks** → `POST /event` | 精确：知道是哪个工具、回合何时结束、何时在等你 | 事件发生时一次 curl（约 27ms），空闲时零开销 |
| 2 | **转录快照** `~/.claude/projects/**/*.jsonl` | 中等：只能按内容分类推断"回合中/回合结束" | 每次 tick 一次目录扫描 + 一次尾部读（带缓存） |
| 3 | **进程探活** `Get-CimInstance Win32_Process` | 粗糙：只能回答"claude 还在不在" | 8s 一次，且有活动时完全跳过 |

hooks 没装时架构自动退回第 2、3 层，功能不减，只是精度下降（面板左下角 `CLI ON*` 的星号表示 hooks 已接入）。

- **SSE 推送**：`GET /events` 是 `text/event-stream`，状态真正变化时才推一帧（15s 心跳保活）。页面用 `EventSource` 接收。旧的 500ms 轮询保留为回退路径（`EventSource` 不可用或连续出错时启用）。
- **SSR 注入**：`GET /` 把 `safeJson(stateJson())` 写进 HTML 的 `window.__INIT__`，首屏即正确状态，无闪烁。

## 状态机（`app/state.js`，纯函数）

`reduce(prev, facts, cfg) -> next`。没有任何 IO、定时器或模块级全局：输入是事实，输出是新的机器对象。**这是它能被测的原因**（`app/state.test.js`）。

状态集：

| 状态 | 含义 | GIF |
|---|---|---|
| `offline` | 没有 claude 在跑 | offlineandidle |
| `idle` | claude 在，等你说下一句 | offlineandidle |
| `thinking` | 模型在生成（没有工具在跑） | thinking |
| `working` | 有工具在执行；`tool` 字段带工具名 | working（回合 >30s 时用 workinglong） |
| `awaiting` | claude 卡在你这（权限确认 / 空闲提醒） | offlineandidle（琥珀色） |
| `done` | 一个回合刚结束，闪 5s | done |
| `error` | 工具失败（在错误窗口内，且 claude 还活着） | errorandwaityou |

优先级（自上而下短路）：`shuttingDown` → `forced`（调试）→ `error` → `!claudeAlive` → 活动分类。

关键规则：
- **`done` 只在真的工作过之后才闪**（`wasWorking`），避免空闲时凭空闪一下。
- **`awaiting` 不再清掉 `wasWorking`/`turnStart`**：你在回答一个提示时，那个回合仍然在飞；否则紧随其后的 `Stop` 就不会闪 `done`。
- **`awaiting` 有 30s 的保持期**，期间转录推断出的 `working` 压不过它（转录慢半拍，会把"等你"瞬间冲掉）；任何 hook 事件立即解除。
- **错误不只看 30s 窗口**：claude 一旦产出更新的消息就说明它已恢复，桌面宠物立刻闭嘴，不必等窗口走完。

## 存活判定（`computeAlive`）

```
有 hook 会话：
  最近 90s 内有事件        → 活着
  探活结果未知(null)       → 乐观认为活着
  会话安静 + 探活说没了     → 离线
没有 hook 会话：
  只看探活结果
```

没有 hooks 时行为与旧版一致；有 hooks 时多了一层"安静 90s 才降级到探活"的缓冲。

**探活的省法**：`shouldProbe()` 在最近 10s 内有任何活动（hook 事件或转录写入）时直接跳过探活——有活动就证明 claude 活着，探活纯属浪费，而这正是最常见的情况。空闲时才每 8s 探一次。

## 生命周期

- **状态锚在会话**：hook 的 `SessionStart`/`SessionEnd` 直接告知会话生灭，不再只能靠 PID 猜。
- **退出锚在终端 PID**：`start-both.bat` 拉起的终端 PID 记在 `app/term.pid`，死了就进入关闭流程（客户端收到 `shutdown:true` 后 `window.close()`，服务端 800ms 后强杀宿主兜底）。手动起的 claude 不受这条约束——它们是状态来源，不是生死判据。
- **窗口存活**：`/api/window` 在"有 SSE 连接"或"5s 内被访问过"时返回 `1`，供 `start-both.bat` 幂等判断要不要开窗。

## Token 用量与告警

第四个信号源，和转录同源但**独立节奏**：读的是每条 assistant 行的 `message.usage`。

```
~/.claude/projects/**.jsonl
        │  transcript.listTranscripts()（两个模块共用同一次目录遍历）
        ▼
  usage.js  createScanner().step(budget)          ← 4s 一轮，不进 500ms 的 tick
        │    每个文件记字节水位线 read，只读新增区间；
        │    只处理到最后一个换行为止（尾部常是半行）；
        │    size 变小 = 被重写 → 先减掉旧贡献再重算
        ▼
   usage.json（账本）  files / total / days / sessions / recent / lastTurn
        │
        ▼
  usage.snapshot(ledger, {session})  →  本次 / 今日 / 累计 / ctx / spark
        │
        ▼
  alerts.reduce(state, usage, now, cfg)  →  活跃告警 + 本帧新触发
        │
        ▼
  stateJson().usage / .alerts  →  SSE  →  面板瘦条 / 用量页 / 告警气泡
```

**为什么必须按 `message.id` 去重**：一条 API 响应按内容块（thinking / text / tool_use）连续写 2~4 行，
每行带**完全相同**的 `usage`。实测 4852 行 → 1763 个唯一 id，按行计虚报 2.75 倍行数、3.13 倍 token。
去重分两层：批内连续 id + 每文件 32 个 id 的环形缓冲（跨扫描边界）。

**为什么告警必须边沿触发**：v2.0.0 修过一次"`error` 状态每 500ms 响一次"，用量告警是同一个坑——
上下文占用会在阈值上方停留很久。所以条件成立只报一次，回落后才重新武装；冷却只作为抖动兜底，
**冷却期内不放行但保持武装**（否则"压缩上下文后再次涨满"会被静默吃掉）。
另外首次建账那一帧必须跳过速率类规则：账本从 0 跳到全量语料，看起来就是一次巨大暴涨。

**不显示金额**：不内置任何价目表。模型名与单价因代理 / 第三方网关而异，猜一个数字不如不给。

## 多会话与读开销

会话 = `~/.claude/projects/<proj>/<sessionId>.jsonl`。`snapshotAll()` 筛出 `maxAgeMs` 内写过的文件，
每个读一段尾部（`SESSION_TAIL_BYTES` = 64KB，比单会话的 256KB 小：一个会话只需要最新一行加标题，
而 `ai-title` 每回合都会重写，永远在尾部）。解析结果按 `(path, mtime, size)` 缓存在 `sessionCache`，
**只有变化的文件才重新解析**，落在窗口外的会被逐出。

**每 tick 只走一次目录**：`server.js` 调一次 `transcript.listTranscripts()`，把结果同时交给
`snapshot()`（单会话，决定大状态）和 `snapshotAll()`（多会话列表），两者都接受 `files` 参数。

实测（本机 47 个转录，fs 1.35）：

| | |
|---|---|
| `listTranscripts()` | 0.891ms（每 tick 的固定成本，readdir + 47 次 stat） |
| `snapshot()`（命中缓存） | 0.010ms |
| `snapshotAll()`（命中缓存） | 0.020ms |
| 冷解析一次 `snapshotAll` | 0.58ms（仅在文件变化时） |
| **每 tick 读开销合计** | **≈0.92ms / 500ms = 0.18%** |

**进程探活是唯一昂贵的东西**，且代价全在 PowerShell 进程启动（~150ms）而不在查询本身：
服务端过滤 CIM（224ms）和 `Get-Process`（151ms）都比现有查询快不了多少，所以**频率才是杠杆**。
`probeInterval()` 在安静超过 `PROBE_BACKOFF_AFTER_MS`（2 分钟）后退避到 60s 一次；有活动时探活整个跳过。

有一条是**实测推翻的假设**：把终端存活检查和进程计数合并进同一次 PowerShell 更慢
（269ms vs 237ms）。原因是两者原本靠 `Promise.all` **并行**，墙钟取 max；
串行进同一个进程后变成相加。所以现在仍是两个并行 spawn——只是顺便把计数带回来了。

## 文件职责

| 文件 | 职责 |
|---|---|
| `app/state.js` | 纯状态机（`reduce` / `computeAlive` / `STATES`）— 无 IO，可直接单测 |
| `app/transcript.js` | 转录快照：一次目录扫描 + 一次尾部读，按 (path,size,mtime) 缓存解析结果；`snapshotAll()` 提供多会话 |
| `app/usage.js` | token 账本：增量扫描 + 按 `message.id` 去重 + 聚合桶；落盘 `usage.json` |
| `app/alerts.js` | 告警规则（纯函数）：边沿触发 + 冷却 + 配置 clamp |
| `app/util.js` | `safeJson`：SSR 注入用的转义（`<` / U+2028 / U+2029） |
| `app/server.js` | HTTP 服务、SSE、hook 事件入口、进程探活、PowerShell 调用、配置读写 |
| `app/pet.html` | HUD UI：霓虹样式、SSE 订阅、拖动、用量页、告警气泡、键盘快捷键 |
| `app/notify.cmd` | hook 转发器：把 stdin 上的事件 JSON 原样 POST 给服务，**永远 exit 0** |
| `app/hooks.js` | 幂等写入/移除 `~/.claude/settings.json` 里的 hooks（带 `.claudepet.bak` 备份） |
| `app/pet.ps1` | 开宿主窗、焦点/最小化/还原终端（ShowWindow P/Invoke） |
| `app/pet-term.ps1` | 终端宿主：在 `$env:USERPROFILE` 启动 claude（保证包可移动） |
| `app/*.test.js` | `node --test` 用例：状态机、转录解析、转义 |
| `check-env.bat/.js` | 环境自检（node / claude / WebView2 / curl / 转录目录） |
| `start-both.bat` | 幂等启动：环境自检 → 终端+claude → 服务 → 桌宠窗 |
| `install.bat` / `uninstall.bat` | 安装/卸载（含 hooks 的挂载与摘除） |

## 安全与边界

- 服务只监听 `127.0.0.1`，不对外暴露。
- **同源校验**：所有 `POST` 与 `/events` 都检查 `Origin` / `Host`，只接受 `127.0.0.1:9876` 或 `localhost:9876`，或完全没有 `Origin` 的本地调用（curl / hooks）。
  没有这道校验时，任意网页都能用一行 `fetch('http://127.0.0.1:9876/api/exit', {method:'POST'})` 关掉桌宠——简单请求不触发预检，CORS 只挡读、不挡执行。
- **SSR 注入转义**：`safeJson` 把 `<`（以及 U+2028/U+2029 两个行分隔符）转义掉，注入的 JSON 因此不可能提前闭合它所在的 `<script>` 标签。
  `lastAction` 的值来自转录里的工具名（模型输出），不转义就等于把用户数据注入进页面。
- 只读扫描转录文件，不修改用户数据；运行期文件（`term.pid`、`config.json`、`host.json`、`usage.json`、`webview2data/`）都在安装目录内。
  `usage.json` 是唯一的写入型聚合产物，且只是缓存——删掉即从转录重建（但 `days`/`total` 是累计和，重建后从 0 起算）。
- **告警文本走 `textContent`**：`alerts.js` 拼出的 `detail` 含转录派生的数字与模型名，面板把它当文本插入，不当标签。
- 改 `~/.claude/settings.json` 仅限 hooks 一项，且只增删带 `notify.cmd` 标记的条目，首次安装前自动备份。
- 零外部依赖：Node 内置模块 + 系统自带 PowerShell / curl / WebView2 运行时。
