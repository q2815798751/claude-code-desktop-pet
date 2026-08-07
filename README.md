# ClaudePet · 桌面桌宠

一个 **320×440 透明桌面宠物**，实时反映 **Claude Code CLI** 的工作状态——思考、工作中、长任务、完成、待命、离线、异常。赛博朋克 HUD 风格，多种主题可切换，字号可缩放，配置持久化。

- **零外部依赖**：Node.js 内置模块 HTTP 服务 + Edge 窗口 + 系统自带 PowerShell。
- **赛博朋克 HUD**：Cascadia Code + 霓虹扫描线，GIF 状态随工作实时切换（≤1s）。
- **4 套主题**：赛博霓虹（默认）/ 极简白 / 终端绿 / 暗金 OLED，一键循环切换。
- **字体缩放**：右上角 `−`/`+` 按钮整体缩放字号与 UI（0.85–1.35）。
- **窗口可横向缩放**：桌宠与动态圆环始终居中，自适应窗口宽度。
- **配置持久化**：主题与字号保存到 `config.json` + localStorage，关闭/重开不丢。
- **即装即用**：`install.bat` 一键安装，`start-both.bat` 同时拉起 claude 终端和桌宠。
- **环境自检**：启动/安装时检查 Node.js、Claude Code CLI、Edge、转录目录，缺什么告诉你装什么。

![设计参考](docs/design-reference.png)

## 快速开始

**要求**：Windows 10/11 · Node.js ≥ 18 · Claude Code CLI · Microsoft Edge（Win10/11 自带）

```bat
:: 1) 解压安装包，双击 install.bat（自动自检 + 复制到 %LOCALAPPDATA%\ClaudePet + 建快捷方式）
:: 2) 双击桌面 "Claude Pet" 快捷方式
::    → 终端里启动 claude + 右下角出现桌宠窗
:: 3) 关闭终端 → 桌宠 5s 内自动退出
```

详细说明见 [docs/INSTALL.md](docs/INSTALL.md) 与 [docs/CONFIG.md](docs/CONFIG.md)。

## 状态一览

| 状态 | 含义 | GIF |
|---|---|---|
| THINKING | 刚有活动（<5s） | thinking.gif |
| WORKING | 持续工作中（<30s） | working.gif |
| WORKING LONG | 长任务（>30s） | workinglong.gif |
| DONE | 一次任务刚完成（闪 5s） | done.gif |
| IDLE | 安静待命 | offlineandidle.gif |
| OFFLINE | 未检测到 claude 进程 | offlineandidle.gif |
| ERROR | 最近 30s 内工具报错 | errorandwaityou.gif |

状态推断读取最新转录消息内容分类（而非文件 mtime），流式输出期间也能正确显示"工作中"。

## 主题

点"主题"按钮或按 `T` 循环切换，`localStorage` + `config.json` 持久化，默认 `cyber`：

| 主题 | 风格 |
|---|---|
| cyber（默认） | 赛博霓虹：深蓝底 + 青/品红发光 + 扫描线 |
| paper | 极简白：米白底、近黑文字、发丝边框、无强发光 |
| matrix | 终端绿：纯黑底 + 荧光绿磷光 + 绿扫描线 |
| gold | 暗金 OLED：纯黑底 + 香槟金描边、内敛发光 |

## 交互与功能

| 操作 | 作用 |
|---|---|
| `终端` 按钮 | 点一下最小化终端，再点还原并置前 |
| 双击桌宠 | 激活 claude 终端 |
| `主题` 按钮 / `T` | 循环切换 4 套主题 |
| 右上角 `−` / `+`（或 `-` / `=`） | 整体缩放字号与 UI（0.85–1.35） |
| 拖动窗口边缘 | 横向缩放窗口，桌宠/圆环始终居中 |
| `调试` 按钮 / `D` | 循环强制各状态（验 GIF 用） |
| `退出` 按钮 / `Esc` | 关闭桌宠与服务（配置已先保存） |

## 配置持久化

- 主题 + 字号缩放 **双保险保存**：客户端 `localStorage` + 服务端 `app/config.json`。
- 窗口关闭/退出前（`beforeunload`）自动再存一次，重开窗口配置不丢。

## 开发

架构与 API 见 [docs/DESIGN.md](docs/DESIGN.md)、[docs/CONFIG.md](docs/CONFIG.md)。给 AI 协作者的约定见 [CLAUDE.md](CLAUDE.md)。版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

MIT，见 [LICENSE](LICENSE)。
