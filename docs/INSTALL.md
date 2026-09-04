# 安装 / 卸载 / 故障排查

## 环境要求
| 组件 | 版本 | 检测方式 | 缺了怎么办 |
|---|---|---|---|
| Node.js | ≥ 18 | `node --version` | https://nodejs.org 下载安装，**装完重开终端** |
| Claude Code CLI | 任意 | `claude --version` | `npm i -g @anthropic-ai/claude-code` 或 https://claude.com/download |
| Microsoft Edge | 任意 | 检测安装路径 | Win10/11 自带；仅用于桌宠窗口 |
| `~/.claude/projects` | — | 目录存在 | 先运行一次 `claude` 自动创建 |

## 安装包（推荐）
1. 双击 `ClaudePet-Setup.exe`（Inno Setup 向导，**无需管理员**，用户机零运行时依赖）。
2. 向导的「运行环境」页会自动检测 **Node.js** 与 **Claude Code**：
   - 检测到 → 自动填入相应路径；
   - 缺失 → **弹出提示框**警告，并可在该页**直接输入 / 粘贴** `node.exe` 与 `claude.cmd` 的完整路径；
   - 点「Re-detect」可重新自动检测。
3. 安装到 `%LOCALAPPDATA%\ClaudePet`，**写入 `app\runtime.ini`**（NODE / CLAUDE 的绝对路径），并在桌面 + 开始菜单创建 `Claude Pet` 快捷方式。
   - 即使 PATH 里没有 node / claude，桌面快捷方式也能凭 `app\runtime.ini` 正常拉起服务与 Claude —— 不依赖环境变量。

> 可选：`installer\claudepet.iss` + `installer\build-setup.bat` 可从源码重新编译出 `ClaudePet-Setup.exe`（需 Inno Setup 6/7）。

## 手动安装（开发者 / install.bat）
1. 解压 `ClaudePet-安装包-v*.zip` 到任意位置；或直接克隆仓库。
2. 双击 `install.bat`：
   - 先跑环境自检（只提示，不阻断安装）；
   - 复制程序到 `%LOCALAPPDATA%\ClaudePet`；
   - **自动编译桌宠窗口宿主 `ClaudePet.Host.exe`**（仓库不内置 exe，用系统自带 .NET Framework `csc` 现编译）；若本机缺 .NET 4.x 会弹窗/停顿提示；
   - 在**桌面**和**开始菜单**创建 `Claude Pet` 快捷方式（最小化运行）。
3. 双击桌面 **Claude Pet** 启动。
   - 若缺少 Node.js 18+ 或 Claude Code CLI，会**弹出提示框**并列出缺哪一项；`start-pet.bat` 仅要求 Node。
   - 若直接运行仓库克隆而不走 `install.bat`，首次启动也会自动编译 `ClaudePet.Host.exe`。

> 说明：环境自检发现问题时仍会安装；真正启动（start-both.bat）时若必需项缺失会中止并提示。
> 说明：`app\runtime.ini` 记录 node/claude 绝对路径，启动脚本会优先读它，PATH 无关。

## 使用
- `start-both.bat`：终端里启动 `claude` + 启动服务 + 打开桌宠窗（幂等，可反复双击）。
- `start-pet.bat`：只开桌宠（不要求 claude 在跑）。
- `stop-pet.bat`：关闭桌宠与服务（终端不动）。
- **关闭终端 → 桌宠 5s 内自动退出。**

## 卸载
双击 `%LOCALAPPDATA%\ClaudePet\uninstall.bat`（或安装包里的 `uninstall.bat`）：
停掉服务 → 删除桌面/开始菜单快捷方式 → 后台清理安装目录。

## 常见问题
| 现象 | 处理 |
|---|---|
| 缺少 node / claude / 环境自检失败 | 启动会**弹出提示框**说明缺哪一项；按提示安装后**新建终端**重试（PATH 变化需重开终端才生效） |
| 桌宠窗没出现 | 首次运行会自动编译 `ClaudePet.Host.exe`；检查 Edge 是否可用；或手动运行 `start-pet.bat` 看服务是否起来（`curl http://127.0.0.1:9876/api/health`） |
| 桌宠不见了 / 可能在屏幕外 | 宿主会把你上次保存的位置**自动拉回屏幕内**（3.x 起）；仍跑偏可删掉 `app\host.json` 恢复右下角默认位置 |
| 状态一直是 OFFLINE | `claude` 没在运行；或装的是 npm 版 claude 且没启动任何会话 |
| 状态切不过去 | 桌宠上点"调试"按钮强制循环 GIF 验证资源；再点回自动 |
| 端口 9876 被占用 | 说明已有实例在跑（幂等复用了它），先 `stop-pet.bat` 或关掉旧实例 |
| 关闭终端后桌宠没退 | 确认终端是通过 `start-both.bat` 拉起的（服务记录其 PID）；手动 `stop-pet.bat` |
