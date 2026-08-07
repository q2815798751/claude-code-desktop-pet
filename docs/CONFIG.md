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
| `GET /api/state` | `{state, since, lastActivity, ageMs, claude, term, termAlive, forced, shutdown, ts}` |
| `GET /api/health` | `{server, window, state, shutdown}` |
| `GET /api/window` | `1` / `0`（桌宠窗是否存活，幂等判断用） |
| `POST /api/open` | 重新打开桌宠窗 |
| `POST /api/focus` | 激活 claude 终端 |
| `POST /api/terminal?act=toggle\|min\|restore` | 终端切换（最小化⇄还原置前）/ 最小化 / 还原 |
| `POST /api/debug?state=X` | 强制状态 `X`（`auto` 恢复自动） |
| `POST /api/debug?cycle=1` | 在 `auto→thinking→working→working_long→done→idle→offline→error` 间循环 |
| `GET /api/conv` | 最近对话 `{msgs:[{role,text}]}`（用户输入 + AI 文本回复） |
| `POST /api/send {text}` | 发送文本到 claude（仅空闲/完成时；写 `app/send.txt` → `pet.ps1 send` → WriteConsoleInput 注入终端） |
| `POST /api/exit` | 关闭桌宠并退出服务（终端不动） |
| `GET /gifs/<file>` | 状态 GIF |

## 交互
- 按钮行：**终端 | 主题 | 调试 | 退出**
  - `终端`：点一下最小化终端，再点还原并置前（合并了原"焦点/收起"）；双击桌宠 = 仅聚焦。
  - `主题`：循环 4 套主题（`T` 键同效）。
  - `调试`：循环强制各状态验 GIF。
  - `退出`：关闭桌宠与服务。
- **对话面板**：底部小字体显示最近对话，点"▾ 对话"可折叠；每 2s 自动刷新。
- **输入条**：输入后回车或点"发送"把内容发给 claude；claude 忙碌/离线时会被拒绝并提示。

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
