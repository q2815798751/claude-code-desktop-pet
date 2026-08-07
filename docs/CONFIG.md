# 配置 / 状态机 / API / 自定义

## 状态机
数据源：`~/.claude/projects/**/*.jsonl` 转录文件的**最后一条消息内容分类** + 进程检测。
（Claude Code 只在回合边界写转录、流式期间不写，故不用 mtime，而读取内容判断当前是否"回合中"。）

`app/server.js` 的 `classifyMessage` 把最后一条有时间戳的消息分类：
- `user`（输入或 `tool_result`）→ 回合中（working）
- `assistant` 含 `thinking` / `tool_use` / `text+tool_use` → 回合中（working）
- `assistant` 纯 `text` → 回合完成（done → idle）
- 无时间戳的元数据行跳过

状态映射（`computeState`，可改常量）：

| 状态 | 触发 |
|---|---|
| thinking | 回合开始 < 5s（`THINK_MS=5000`） |
| working | 回合开始 5s–30s（`WORK_MS=30000`） |
| working_long | 回合开始 > 30s |
| done | 回合完成（assistant 纯 text 写入），闪 5s（`DONE_HOLD_MS=5000`） |
| idle | 回合完成 5s 后 / 无转录 |
| offline | 未检测到 claude 进程 |
| error | 最近 30s 转录出现 `"isError":true`（`ERROR_WINDOW_MS=30000`） |

- 安全兜底：working 标记超过 `STALE_MS=600000`（10min）未更新则回 idle。
- 服务端每 **500ms** 轮询一次，进程检测每 **2s** 一次（`tasklist` / `Get-CimInstance`）。
- 客户端每 **500ms** 拉 `/api/state` 切 GIF → 状态变化 **≤1s** 反映。
- 终端进程死亡 → 进入关闭流程，**≤5s** 桌宠自退（`SHUTDOWN_HOLD_MS=2500` + 客户端 `window.close()` + 强杀 Edge）。

## 主题
`app/pet.html` 内置 4 套主题，点"主题"按钮或按键盘 `T` 循环切换，`localStorage['pet_theme']` 持久化（重开窗口保留），默认 `cyber`：

| 主题 | 风格 |
|---|---|
| cyber（默认） | 赛博霓虹：深蓝底 + 青/品红发光 + 扫描线 |
| paper | 极简白：米白底、近黑文字、发丝边框、无强发光 |
| matrix | 终端绿：纯黑底 + 荧光绿磷光 + 绿扫描线 |
| gold | 暗金 OLED：纯黑底 + 香槟金描边、内敛发光 |

- 主题 = CSS 变量集（`--bg1/--bg2/--bg-body/--txt/--dim/--ac/--ac-rgb/--ac2/--ac2-rgb/--scan`），改 `app/pet.html` 顶部的 `<style>` 即可加新主题。
- 各主题有独立的状态色（JS 里 `STATE_COLORS` 按主题覆盖）。

## HTTP API（127.0.0.1:9876）
| 路径 | 说明 |
|---|---|
| `GET /` | SSR HTML，注入当前状态（首屏即正确） |
| `GET /api/state` | `{state, since, lastActivity, ageMs, claude, term, termAlive, forced, lastAction, shutdown, ts}`（`lastAction`=当前工具动作） |
| `GET /api/health` | `{server, window, state, shutdown}` |
| `GET /api/window` | `1` / `0`（桌宠窗是否存活，幂等判断用） |
| `POST /api/open` | 重新打开桌宠窗 |
| `POST /api/focus` | 激活 claude 终端 |
| `POST /api/terminal?act=toggle\|min\|restore` | 终端切换（最小化⇄还原置前）/ 最小化 / 还原 |
| `POST /api/debug?state=X` | 强制状态 `X`（`auto` 恢复自动） |
| `POST /api/debug?cycle=1` | 在 `auto→thinking→working→working_long→done→idle→offline→error` 间循环 |
| `POST /api/config {theme,fs}` | 保存 UI 配置到 `app/config.json`（主题 + 字号缩放） |
| `POST /api/exit` | 关闭桌宠并退出服务（终端不动） |
| `GET /gifs/<file>` | 状态 GIF |

## 悬浮球（默认形态）
- 平时只显示**可拖动的悬浮球**：圆环 + 图片 + 状态字（待命/思考中…，位于图片上方与外环之间，展开后消失）。
- **拖动**：按住球移动（宿主 `Move`）。
- **左键或悬停 ~350ms** → 展开全面板；面板右上 `⇲` 收起回球。
- **右键** → 弹出**中心对称透明气泡菜单**：主题 / 终端 / 置顶 / 透明度+ / 透明度− / 退出。
- **置顶 / 透明度**：气泡可调；位置、大小、透明度、置顶持久化到 `app/host.json`。

## 全面板交互
- 按钮行：**主题 | 终端 | 调试 | 退出**；面板含状态、进度、"现在在做什么"一行、字号缩放（右上 `−`/`+`，键盘 `-`/`=`，0.85–1.35）。
- 长任务完成或工具报错：toast + 提示音提醒。
- 双击面板桌宠 = 聚焦终端。

## 配置持久化
- UI 配置（主题 `theme` + 字号缩放 `fs`）**双保险保存**：
  1. 客户端 `localStorage`（`pet_theme` / `pet_fs`，实时写）；
  2. 服务端 `app/config.json`（`POST /api/config` 写盘，`GET /` SSR 注入 `window.__CONFIG__` 供首屏应用）。
- 窗口关闭/退出（`beforeunload`/`pagehide`）前再保存一次，重开窗口配置不丢。

## 窗口缩放
`#shell` 为流式宽度（`min-width:320px`），Edge 窗口可**横向拖拽缩放**；桌宠与圆环始终居中，尺寸按 `--pet-size` 自适应（封顶防 GIF 拉伸），主题配色任意宽度正常。窗口位置/初始尺寸见 `app/pet.ps1` 的 `Open-EdgeWindow`。

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
