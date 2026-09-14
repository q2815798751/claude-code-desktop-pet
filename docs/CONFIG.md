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

- 主题 = CSS 变量集（`--bg1/--bg2/--bg-body/--txt/--dim/--ac/--ac-rgb/--ac2/--ac2-rgb/--scan`），改 `app/pet.html` 顶部的 `<style>` 即可加新主题。
- 各主题有独立的状态色（JS 里 `STATE_COLORS` 按主题覆盖）。

## HTTP API（127.0.0.1:9876）

`POST` 与 `/events` 需要同源（`Origin`/`Host` 为 `127.0.0.1:9876` 或 `localhost:9876`，或省略 `Origin`）。

| 路径 | 说明 |
|---|---|
| `GET /` | SSR HTML，注入当前状态与配置（首屏即正确） |
| `GET /events` | **SSE**，状态变化时推 `event: state` |
| `GET /api/state` | `{state, since, tool, long, lastActivity, ageMs, claude, hooked, term, termAlive, forced, lastAction, error, shutdown, runtime, ts}` |
| `GET /api/health` | `{server, window, state, shutdown, hooked}` |
| `GET /api/window` | `1` / `0`（桌宠窗是否存活，幂等判断用） |
| `POST /event` | **hook 事件入口**，body 为 Claude Code 原样 JSON |
| `POST /api/open` | 重新打开桌宠窗 |
| `POST /api/focus` | 激活 claude 终端 |
| `POST /api/terminal?act=toggle\|min\|restore` | 终端切换（最小化⇄还原置前）/ 最小化 / 还原 |
| `POST /api/debug?state=X` | 强制状态 `X`（`auto` 恢复自动） |
| `POST /api/debug?cycle=1` | 在 `auto→offline→idle→thinking→working→awaiting→done→error` 间循环 |
| `POST /api/config {theme,fs}` | 保存 UI 配置到 `app/config.json`（主题 + 字号缩放） |
| `POST /api/exit` | 关闭桌宠并退出服务（终端不动） |
| `GET /gifs/<file>` | 状态 GIF |

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

## 全面板交互

- 按钮行：**主题 | 终端 | 调试 | 退出**；面板含状态、进度、"现在在做什么"一行、字号缩放（右上 `−`/`+`，键盘 `-`/`=`，0.85–1.35）。
- 状态变化时提醒：回合结束（`→done`）"任务完成"、工具失败（`→error`）"工具出错"、`→awaiting`"Claude 在等你"。
  **只在状态真正翻转的那一次提示**，不会在状态持续期间反复响。
- 双击面板桌宠 = 聚焦终端。

## 配置持久化

- **服务端 `app/config.json` 是唯一真相**：`POST /api/config` 写盘，`GET /` 用 SSR 注入 `window.__CONFIG__` 供首屏应用。
  页面不再自存一份 `localStorage`（两份来源会在手改 config.json 后互相打架）。
- **窗口位置/大小/透明度/置顶** 归宿主 `app/host.json`。

## GIF 与配色

```js
const GIFS = { thinking:'thinking.gif', working:'working.gif',
  working_long:'workinglong.gif', done:'done.gif', awaiting:'offlineandidle.gif',
  idle:'offlineandidle.gif', offline:'offlineandidle.gif', error:'errorandwaityou.gif' };
```

换图：同名替换 `app/` 下的 GIF 即可（建议透明背景、正方形）。`awaiting` 目前复用待命图，靠**琥珀色**区分。

## 自定义

- **阈值**：改 `app/state.js` 的 `DEFAULTS` 后重启服务。
- **工具中文名**：`app/server.js` 的 `TOOL_LABELS` 与 `app/pet.html` 的 `TOOL_CN`（两处保持一致）。
- **窗口位置/大小**：`app/pet.ps1` 与 `app/host.json`（也可直接拖）。
- **终端宿主**：`app/pet-term.ps1`（默认在 `$env:USERPROFILE` 里启动 claude）。
- **测试**：`node --test app/*.test.js`。
