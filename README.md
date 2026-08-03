# ClaudePet · 桌面桌宠

一个 **320×440 透明桌面宠物**，实时反映 **Claude Code CLI** 的工作状态——思考、工作中、长任务、完成、待命、离线、异常。

- **零外部依赖**：Node.js 内置模块 HTTP 服务 + Edge 窗口 + 系统自带 PowerShell。
- **赛博朋克 HUD**：Cascadia Code + 霓虹扫描线，GIF 状态随工作实时切换（≤1s）。
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

## 交互

| 操作 | 作用 |
|---|---|
| 双击桌宠 | 激活 claude 终端 |
| 焦点 / 收起 / 打开 | 聚焦 / 最小化 / 还原终端 |
| 调试 | 循环切换各状态（验 GIF 用） |
| 退出 | 关闭桌宠与服务 |
| 键盘 `D` / `Esc` | 调试切态 / 退出 |

## 开发

架构与 API 见 [docs/DESIGN.md](docs/DESIGN.md)。给 AI 协作者的约定见 [CLAUDE.md](CLAUDE.md)。

## 许可

MIT，见 [LICENSE](LICENSE)。
