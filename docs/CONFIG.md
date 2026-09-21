# 配置 / 状态机 / API / 自定义

## 状态从哪来

三个信号源，优先级见 [DESIGN.md](DESIGN.md)。要点：

1. **hooks（精确）**：`app/notify.cmd` 把 Claude Code 的 hook 事件原样 POST 到 `/event`，服务端按 `hook_event_name` 映射：
   `SessionStart`→idle、`UserPromptSubmit`→thinking、`PreToolUse`→working(带工具名)、`PostToolUse`→thinking、
   `Notification`→awaiting、`Stop`/`SubagentStop`→done、`SessionEnd`→会话结束。
2. **转录（回退）**：`app/transcript.js` 读最新 `~/.claude/projects/**/*.jsonl` 的尾部并按内容分类：
   - `user`（输入或 `tool_result`）→ 回合中
   - `assistant` 含 `thinking` / `tool_use` / `text+tool_use` → 回合中
   - `assistant` 纯 `text` → 回合完成（done → idle）
   - 无时间戳的元数据行跳过；文件正在追加（尾部无换行）→ 视为正在写
3. **进程探活**：`claude.exe` 或跑 Claude Code CLI 的 `node.exe`（排除自身 `server.js`）。仅在活动停止后才有意义。

面板左下角 `CLI ON*` 的星号 = hooks 已接入。

## 状态表

| 状态 | 触发 | 常量 | GIF |
|---|---|---|---|
| `thinking` | 模型在生成（hook：`UserPromptSubmit`/`PostToolUse`）；无 hook 时按回合计时 < 5s | `THINK_MS=5000` | thinking.gif |
| `working` | 有工具在执行（hook `PreToolUse` 带工具名） | — | working.gif |
| `working`（长） | 同一回合 > 30s | `WORK_MS=30000` | workinglong.gif |
| `awaiting` | `Notification`：卡在权限确认 / 等你开口 | `ATTENTION_HOLD_MS=30000` | offlineandidle.gif（琥珀） |
| `done` | 回合结束，闪 5s | `DONE_HOLD_MS=5000` | done.gif |
| `idle` | claude 在但无事可报 / done 5s 后 | — | offlineandidle.gif |
| `offline` | 探活说 claude 不在（hook 会话安静 90s 才降级到探活） | `DEAD_GRACE_MS=90000` | offlineandidle.gif |
| `error` | 转录里最新的 `"isError":true`，且此后 claude 没再产出新消息 | `ERROR_WINDOW_MS=30000` | errorandwaityou.gif |

- 安全兜底：working 标记超过 `STALE_MS=600000`（10min）没更新 → 回 idle。
- 会话 TTL：hook 会话 2h 无事件后丢弃（`SESSION_TTL_MS`）。
- 常量都在 `app/state.js` 顶部的 `DEFAULTS`。

## 节奏

- 服务端每 **500ms** 一个 tick；状态真正变化时才推 SSE。
- 客户端用 `EventSource` 订阅 `/events`，状态变化**即时**反映；`EventSource` 不可用时回退到 1s 轮询。
- 转录快照按 `(path, size, mtimeMs)` 缓存：文件没动就不重复解析。
- 进程探活每 **8s** 一次，且**最近 10s 内有任何活动时完全跳过**（有活动即证明活着）。
- 终端进程死亡 → 进入关闭流程，**≤5s** 桌宠自退（`SHUTDOWN_HOLD_MS=2500` + 客户端 `window.close()` + 强杀宿主兜底）。

## 主题

`app/pet.html` 内置 6 套主题，点"主题"按钮或按键盘 `T` 循环切换，默认 `cyber`：

| 主题 | 风格 |
|---|---|
| cyber（默认） | 赛博霓虹：深蓝底 + 青/品红发光 + 扫描线 |
| paper | 极简白：米白底、近黑文字、发丝边框、无强发光 |
| matrix | 终端绿：纯黑底 + 荧光绿磷光 + 绿扫描线 |
| gold | 暗金 OLED：纯黑底 + 香槟金描边、内敛发光 |
| sunset | 落日橙：深紫/橙渐变 + 暖橙/粉霓虹 |
| ocean | 深海蓝：深蓝/青渐变 + 青绿霓虹 |

- 主题 = CSS 变量集（`--bg1/--bg2/--bg-body/--txt/--dim/--ac/--ac-rgb/--ac2/--ac2-rgb/--warn/--warn-rgb/--crit/--crit-rgb/--scan`），改 `app/pet.html` 顶部的 `<style>` 即可加新主题。
- 各主题有独立的状态色（JS 里 `STATE_COLORS` 按主题覆盖）。
- `--warn` / `--crit` 是**告警强调色**，取的就是该主题状态调色板里的 `awaiting` / `offline` 两个色，
  所以气泡不会像是从别的设计里贴过来的。加主题时这四个变量必须一起给。
  它们既要当**描边**也要当**正文色**（告警卡片的标题），所以得兼顾两者：
  面板/球上的告警卡片是实底，标题色必须在 `--bg1` 与 `--bg2` 上都达到 **4.5:1**。
  paper 主题原来的 `--warn:#c77800` 只有 2.98:1，已改为 `#965500`（5.06:1）。
- `--dim` 是次要文字色，当前对比度统一在 **7.4–8.5:1**（paper 浅底反色主题为 5.8:1），
  原先只有 2.89–4.54——paper 主题低于 WCAG AA。改主题时别把它调暗回去。
- 辉光是**单层且极轻**（`0 0 4px`）。此前状态字与球上状态用的是 `0 0 8px` + `0 0 20px` 双层，
  字缘互相晕开，"工作中"会糊成一团。

## HTTP API（127.0.0.1:9876）

`POST` 与 `/events` 需要同源（`Origin`/`Host` 为 `127.0.0.1:9876` 或 `localhost:9876`，或省略 `Origin`）。

| 路径 | 说明 |
|---|---|
| `GET /` | SSR HTML，注入当前状态与配置（首屏即正确） |
| `GET /events` | **SSE**，状态变化时推 `event: state` |
| `GET /api/state` | `{state, since, tool, long, lastActivity, ageMs, claude, hooked, term, termAlive, forced, lastAction, error, shutdown, runtime, usage, alerts, sessions, procs, ts}` |
| `GET /api/health` | `{server, window, state, shutdown, hooked}` |
| `GET /api/window` | `1` / `0`（桌宠窗是否存活，幂等判断用） |
| `GET /api/usage` | 完整用量快照（本次/今日/累计/上下文/近 7 日），见下 |
| `POST /event` | **hook 事件入口**，body 为 Claude Code 原样 JSON |
| `POST /api/open` | 重新打开桌宠窗 |
| `POST /api/focus` | 激活 claude 终端 |
| `POST /api/terminal?act=toggle\|min\|restore` | 终端切换（最小化⇄还原置前）/ 最小化 / 还原 |
| `POST /api/debug?state=X` | 强制状态 `X`（`auto` 恢复自动） |
| `POST /api/debug?cycle=1` | 在 `auto→offline→idle→thinking→working→awaiting→done→error` 间循环 |
| `POST /api/config {theme,fs,usage}` | 保存 UI 与告警配置到 `app/config.json`；`usage` 逐键白名单 + 区间 clamp，只写传了的键 |
| `POST /api/usage/rescan` | 丢弃账本重算（删过转录、或数字明显不对时用；扫描中返回 409） |
| `POST /api/exit` | 关闭桌宠并退出服务（终端不动） |
| `GET /gifs/<file>` | 状态 GIF |

## Token 用量

数据源是转录本身：Claude Code 在每条 assistant 行写 `message.usage`
（`input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`），
`app/usage.js` 只读扫描 `~/.claude/projects/**/*.jsonl`。不联网、不调 API、不装依赖。

**必须按 `message.id` 去重。** 同一条 API 响应会按内容块（thinking / text / tool_use）连续写 2~4 行，
每行带完全相同的 `usage`。实测本机 4852 行只有 1763 个唯一 id——按行计会**虚报 2.75 倍行数、3.13 倍 token**。
去重是「批内连续去重 + 32 个 id 的环形缓冲」两层，环形缓冲负责跨扫描边界。

账本落在 `app/usage.json`（**不进 git**，删掉会自动重建，但累计值会从 0 重新开始）：

```json
{ "v": 1,
  "files": { "<jsonl 路径>": { "size", "mtimeMs", "read", "recentIds", "session", "agg", "days", "sessions" } },
  "total":   { "msgs", "in", "out", "cc", "cr" },
  "days":    { "2026-09-14": { ... } },
  "sessions":{ "<sessionId>": { ... } },
  "recent":  [ "最近 20 次调用" ],
  "lastTurn":{ "in", "out", "cc", "cr", "ts", "model", "file" } }
```

- **增量**：每个文件记 `read`（已计入的字节水位线）。文件没动就整个跳过；
  只读新增区间，且**只处理到最后一个换行为止**——转录是边写边追加的，尾部常是半行。
- **截断**（size 变小）→ 该文件的贡献先从上卷的每一天/每个会话里减掉，再重算。
- **全量首扫**：36MB ≈ 200ms，用 `setImmediate` 按 15ms 切片，不阻塞 500ms 的 tick。稳态是 1 次 readdir + N 次 stat。
- **节奏**：独立 4s 一轮，**不在 tick 里**。

`GET /api/usage` 返回：

| 字段 | 说明 |
|---|---|
| `session` / `today` / `total` / `recent` | `{in, out, cc, cr, msgs, input, hit}`；`input = in+cc+cr`（真正发给模型的量），`hit` 是缓存命中率 |
| `ctx` | `{tokens, window, pct}`；`tokens` 是**最后一次** assistant 响应的 `in+cc+cr+out`（当前上下文占用），不是累计 |
| `lastTurn` | 最后一次调用的明细 |
| `spark` | 近 7 日 `[{day, tokens}]`，末项是今天 |
| `ready` | 首次全量扫完前为 `false`，面板显示 `…` |

**上下文窗口**按模型前缀匹配（`app/usage.js` 的 `CONTEXT_WINDOWS`），未知模型用配置的 `ctxWindow`（默认 200000）。
若实测值超过配置分母（代理模型、设置写小了），分母自动抬到实测值，**永远不会显示超过 100%**。

不显示金额：本项目不内置任何价目表，模型名与单价因代理/第三方网关而异，猜一个数字不如不给。

## 告警

规则在 `app/alerts.js` 的 `RULES`，全部基于 token，**没有金额规则**。

| id | 级别 | 触发 | 默认阈值 |
|---|---|---|---|
| `ctx.crit` | crit | 上下文占用 ≥ 窗口 92% | `ctxCritPct: 92` |
| `ctx.warn` | warn | 上下文占用 ≥ 窗口 80%（crit 成立时被压制） | `ctxWarnPct: 80` |
| `turn.big` | warn | 单回合 output ≥ 30k | `turnOutWarn: 30000` |
| `cache.low` | warn | 近 20 次调用命中 < 40% 且输入合计 ≥ 50k | `cacheHitWarnPct: 40` / `cacheMinInput: 50000` |
| `day.heavy` | warn | 今日 token 合计 ≥ 2M | `dayTokWarn: 2000000` |
| `usage.spike` | warn | 5 分钟内新增 ≥ 500k | `spikeTokWarn: 500000` |

- **边沿触发**：条件成立只报一次，回落后重新武装（"error 状态每 500ms 响一次"是同款教训）。
  另有冷却兜底（`cooldownMs` 默认 10min，`ctx.crit` 为 30min）——冷却期内不放行但**保持武装**，冷却一过仍会报。
- **首次建账那一帧不评估速率类规则**：账本从 0 跳到全量语料，看起来就是一次巨大暴涨。
  另外 `usage.spike` 需要至少 60s 的采样基线才给读数。
- **改阈值**：改 `app/config.json` 的 `usage` 段，或 `POST /api/config {"usage":{...}}`（只传要改的键）。
- **开关**：面板 → `▤` 用量页 → 底部「告警 开/关」。

## 悬浮球（默认形态）

调试时也可以不带任何 Origin 直接 `curl`：

```bash
curl -X POST "http://127.0.0.1:9876/api/debug?state=awaiting"
curl -X POST http://127.0.0.1:9876/event -H "Content-Type: application/json" \
     -d '{"hook_event_name":"PreToolUse","session_id":"t","tool_name":"Bash"}'
```

## hooks 的挂载

```bat
node app\hooks.js install --app <安装目录>\app   :: 写入 ~/.claude/settings.json（幂等）
node app\hooks.js status                         :: 查询
node app\hooks.js remove                         :: 摘除（只删带 notify.cmd 标记的条目）
```

- 首次修改前自动备份为 `~/.claude/settings.json.claudepet.bak`。
- 你自己写的 hooks 与其它字段一律保留。
- **改完需要重启 claude 会话才生效。**
- 手动删除安装目录而不运行卸载脚本，会让 hooks 指向不存在的 `notify.cmd`——此时 `notify.cmd` 已经不在，`cmd` 会报"找不到文件"（不阻塞工具调用，但会有噪音）。正常卸载不会遇到。

## 悬浮球（默认形态）

- 平时只显示**可拖动的悬浮球**：圆环 + 图片 + 状态字（待命/思考中/运行命令…）。
- **拖动**：按住球移动（宿主 `Move`）。
- **左键或悬停 ~1s** → 展开全面板；面板右上 `⇲` 收起回球。
- **右键** → 弹出**中心对称透明气泡菜单**：主题 / 终端 / 置顶 / 透明度+ / 透明度− / 退出。
- **置顶 / 透明度**：气泡可调；位置、大小、透明度、置顶持久化到 `app/host.json`。
- **告警**：有**未读**告警时圆环右上出现红色角标（数量），底部显示最高优先级告警的**半透明胶囊**：
  第一行标题、第二行明细，按级别着色（warn 琥珀 / crit 红），最多三行。
  底色是 `rgba(--bg1-rgb, .42)` —— 够把文字从 GIF 的碎像素里托起来，又透明到不遮球、
  不改主题观感；配发丝边框与轻微文字描边，没有模糊也没有辉光。
  **10 秒后自动移除**，底部一条进度条把这段时间走完。移除只是收起这段文字，
  **角标与未读状态保留**——点角标（或展开面板）随时能看回来。
  胶囊 `pointer-events:none`，不影响拖动；角标才是点击目标。
  **crit 级会自己展开面板**弹出气泡（同一条告警只展开一次，拖动中不打断）。

  实现上有一处必须注意：胶囊**只在告警变化（`id:firedAt` 变了）时才重建 DOM**。
  它挂在每一帧 SSE 上，如果每帧重建，倒计时动画会被无限重启，进度条永远走不完。
- **点角标 = 已读**：点一下清掉角标与球上的告警行，并弹出气泡让你看清内容；球形态下顺带展开面板。
  同一条告警**再次触发**（新的 `firedAt`）才会重新点亮。

## 全面板交互

- **拖动**：面板顶部（标题行 + 状态行）就是拖动区，像标题栏一样按住即可移动窗口；球本身也照常可拖。
  移动小于 2px 视为点击。**任何自带点击行为的元素都不参与拖动**（按钮、告警角标、球上的红点），
  否则一次手抖 3px 就会变成"移动窗口"而不是"点到了我要点的东西"（`makeDraggable` 的 `skip`）。
- **状态行**：大字是**中文状态**（工作中 / 思考中 / 待命 / 离线 / 完成 / 等待输入 / 异常），
  副行是中文工具名（运行命令 / 编辑文件…）。具体命令提示保留在 `现在:` 一行（`运行 Bash`）。
  元信息行 `CLI` / `TERM` 保留英文缩写，`静默 5.2s`（原 `AGE`）与 `上下文 22%`（原 `CTX`）为中文。
- 按钮行：**主题 | 终端**（调试、退出已移除——正常使用不需要，关终端即自动退出；退出入口保留在右键气泡菜单里）。
- 标题行右侧：`▤` 用量页、`⇲` 收起为球；告警角标显示活跃数量，**点击可重放当前告警气泡**。
## 多会话（同时进行的对话窗口）

一个 Claude Code 会话 = `~/.claude/projects/<proj>/<sessionId>.jsonl`。**近期写过的转录文件就是开着的窗口**，
面板把它们列出来（状态点 + 会话名 + 状态/工具 + 空闲时长）。

- **只在 ≥2 个会话时显示**。单会话时它和上面的状态行重复，白占地方。
- 最多 2 行，多出的折成「还有 N 个会话」。
- 会话名取自转录里的 `ai-title` 字段（Claude Code 生成的会话标题，如"桌宠面板优化与 token 用量告警"），
  没有则退回 `slug`、项目名。项目路径与分支在悬停提示里。
- **活跃判定基于转录文件的 mtime**，不是最后一行的时间戳：进程死在回合中间时，最后一行看起来仍然是"当前"的。
  超过 `SESSION_SHOW_MS`（45s）没有写入且没有 hook 会话的，不再算"当前"——这就是它能跟着终端开合变化的原因。

**关于"对应窗口"的边界**：hook 载荷里**没有 PID**，claude 进程的命令行里**也没有会话 id**，
所以"进程 ↔ 会话"无法可靠对应，本项目不做这种假装。会话存活由转录 + hooks 判定；
进程数单独暴露（`/api/state` 的 `procs`），**如果它大于会话数，说明有会话没被追踪到**，这是可见的而不是被藏起来的。

`stateJson().sessions[]` 字段：`{id, title, project, branch, state, tool, ageMs, hooked}`。

## 用量瘦条

- 状态行下方是**常驻用量瘦条**：`↑输入 ↓输出 上下文 ▓▓░ 百分比`；超过 `ctxWarnPct`/`ctxCritPct` 时转琥珀/红。
  点瘦条或 `▤` 切到用量页。
- **用量页**（占据中间桌宠区，桌宠隐藏）：本次 / 今日 / 累计 三个 tab；一行四个统计格
  **输入 / 输出 / 缓存命中 / API 调用**（完整说明见悬停提示）；「本次」额外显示上下文占用条；
  下方是近 7 日柱状（末根为今天，零值日显示为灰色基线）。底部：告警开关 + 字号 `A−` / `A+`。
  用量页**永不溢出容器**：除柱状图外所有行都是固定高度，柱状图是唯一可伸缩元素（有 `min-height` 与
  `max-height` 双重限制），所以 0~3 条告警气泡下都能整页放下。
- **告警气泡**：排在 `.stage` 与 `现在:` 之间，最多 3 条；8 秒后自动消失（底部倒计时条），点卡片或 `×` 立即关闭。
  它是**面板 flex 流里的一个兄弟节点**，不是浮动层——气泡一出现 `.stage` 就让出空间，桌宠按自己的 `clamp()` 收缩
  （300px stage → 186px，3 条气泡挤到 137px stage → 120px 下限），所以**结构上不可能和桌宠重叠**；
  没有气泡时高度为 0，布局与从前完全一致。
  配色跟随主题（`--warn` 琥珀 / `--crit` 红），crit 级进场带一次抖动 + 双音提示。
  气泡**只在告警触发的那一刻弹出**；页面加载/重连时只显示角标，不重放历史气泡。
  **手动关掉气泡（点卡片或 `×`）也算已读**，会同时清掉角标；8 秒超时自动消失**不算**——没人看的时候超时，
  不该被当成"看过了"。
- 字号缩放：用量页底部 `A−` / `A+`，或键盘 `-` / `=`，范围 0.85–1.35（标题行不再放字号按钮，320px 放不下）。
- 键盘：`T` 切主题、`-`/`=` 调字号、双击面板 = 聚焦终端。**`Esc` 与 `D` 已移除**（容易误触）。
  双击只在**空白处**生效——双击 tab / 开关 / 字号按钮不会再顺手把终端抢到前台。
- 状态变化时提醒：回合结束（`→done`）"任务完成"、工具失败（`→error`）"工具出错"、`→awaiting`"Claude 在等你"。
  **只在状态真正翻转的那一次提示**，不会在状态持续期间反复响。

## 配置持久化

- **服务端 `app/config.json` 是唯一真相**：`POST /api/config` 写盘，`GET /` 用 SSR 注入 `window.__CONFIG__` 供首屏应用。
  页面不再自存一份 `localStorage`（两份来源会在手改 config.json 后互相打架）。
  结构：`{ theme, fs, usage: { enabled, ctxWarnPct, ctxCritPct, turnOutWarn, cacheHitWarnPct,
  cacheMinInput, dayTokWarn, spikeTokWarn, ctxWindow, cooldownMs } }`。
  读取与写入都逐键白名单 + 区间 clamp（`app/alerts.js` 的 `sanitize()`），手改错值不会让面板显示假数据。
- **窗口位置/大小/透明度/置顶** 归宿主 `app/host.json`。
  拖动时不再每个事件都写盘：宿主打了脏标记，停手 400ms 后落一次（`ClaudePetHost.cs` 的 `_saveTimer`）。
- **token 账本** 归 `app/usage.json`（运行期缓存，可随时删）。

## GIF 与配色

```js
const GIFS = { thinking:'thinking.gif', working:'working.gif',
  working_long:'workinglong.gif', done:'done.gif', awaiting:'offlineandidle.gif',
  idle:'offlineandidle.gif', offline:'offlineandidle.gif', error:'errorandwaityou.gif' };
```

换图：同名替换 `app/` 下的 GIF 即可（建议透明背景、正方形）。`awaiting` 目前复用待命图，靠**琥珀色**区分。

## 自定义

- **状态阈值**：改 `app/state.js` 的 `DEFAULTS` 后重启服务（不带金额/用量的语义）。
- **告警阈值**：改 `app/config.json` 的 `usage` 段，或 `POST /api/config {"usage":{...}}`（不用重启）。
- **上下文窗口**：`app/usage.js` 的 `CONTEXT_WINDOWS`（按模型前缀匹配），兜底用 `usage.ctxWindow`。
- **工具中文名**：`app/server.js` 的 `TOOL_LABELS` 与 `app/pet.html` 的 `TOOL_CN`（两处保持一致）。
- **数字格式**：`app/usage.js` 的 `fmtTok()` 与 `app/pet.html` 的 `fmtTok()`（两处保持一致，页面是无 import 的静态文件）。
- **窗口位置/大小**：`app/pet.ps1` 与 `app/host.json`（也可直接拖）。
- **终端宿主**：`app/pet-term.ps1`（默认在 `$env:USERPROFILE` 里启动 claude）。
- **测试**：`node --test app/*.test.js`。
