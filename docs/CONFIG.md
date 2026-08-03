# 配置 / 状态机 / API / 自定义

## 状态机
数据源：`~/.claude/projects/**/*.jsonl` 转录文件的 mtime（最新一次写入时间）+ 进程检测。

**连续活动（burst）推断**（`app/server.js` 内，可改常量）：

| 状态 | 触发 | 常量 |
|---|---|---|
| thinking | 连续活动 < 5s | `THINK_MS=5000` |
| working | 连续活动 5s–30s | `WORK_MS=30000` |
| working_long | 连续活动 > 30s | 由 `WORK_MS` 推 |
| done | 一次活动结束，保持 5s | `DONE_HOLD_MS=5000` |
| idle | 安静（活动间隔超 `BURST_GAP_MS=25000`） | `BURST_GAP_MS=25000` |
| offline | 未检测到 claude 进程 | — |
| error | 最近 30s 转录出现 `"isError":true` | `ERROR_WINDOW_MS=30000` |

- 服务端每 **500ms** 轮询一次，进程检测每 **2s** 一次（`tasklist` / `Get-CimInstance`）。
- 客户端每 **500ms** 拉 `/api/state` 切 GIF → 状态变化 **≤1s** 反映。
- 终端进程死亡 → 进入关闭流程，**≤5s** 桌宠自退（`SHUTDOWN_HOLD_MS=2500` + 客户端 `window.close()` + 强杀 Edge）。

## HTTP API（127.0.0.1:9876）
| 路径 | 说明 |
|---|---|
| `GET /` | SSR HTML，注入当前状态（首屏即正确） |
| `GET /api/state` | `{state, since, lastActivity, ageMs, claude, term, termAlive, forced, shutdown, ts}` |
| `GET /api/health` | `{server, window, state, shutdown}` |
| `GET /api/window` | `1` / `0`（桌宠窗是否存活，幂等判断用） |
| `POST /api/open` | 重新打开桌宠窗 |
| `POST /api/focus` | 激活 claude 终端 |
| `POST /api/terminal?act=min\|restore` | 最小化 / 还原终端 |
| `POST /api/debug?state=X` | 强制状态 `X`（`auto` 恢复自动） |
| `POST /api/debug?cycle=1` | 在 `auto→thinking→working→working_long→done→idle→offline→error` 间循环 |
| `POST /api/exit` | 关闭桌宠并退出服务（终端不动） |
| `GET /gifs/<file>` | 状态 GIF |

## GIF 与配色
GIF 映射与霓虹配色在 `app/pet.html` 顶部：
```js
const GIFS = { thinking:'thinking.gif', working:'working.gif',
  working_long:'workinglong.gif', done:'done.gif',
  idle:'offlineandidle.gif', offline:'offlineandidle.gif', error:'errorandwaityou.gif' };
```
换图：同名替换 `app/` 下的 GIF 即可（建议透明背景、正方形）。

## 自定义
- **阈值**：改 `app/server.js` 顶部常量后重启服务。
- **窗口位置/大小**：`app/pet.ps1` 的 `Open-EdgeWindow`（`--window-size=320,472`、右下角定位）。
- **终端宿主**：`app/pet-term.ps1`（默认在 `$env:USERPROFILE` 里启动 claude）。
