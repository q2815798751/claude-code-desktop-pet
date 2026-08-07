# 悬浮球宿主（host/）

`ClaudePet.Host.exe` 是一个 **WinForms + WebView2** 无边框、真透明、始终置顶的窗口，替代旧版 Edge `--app` 窗口，实现"悬浮球"体验。

## 特性
- 无标题栏 / 无最小化 / 无关闭按钮（`FormBorderStyle=None`）。
- 真透视（`TransparencyKey` + WebView2 透明背景）：只有球/面板内容可见，其余透出桌面。
- 始终置顶（`TopMost`），可关（气泡"置顶"）。
- 可拖动（页面指针事件 → `petHost.Move`）。
- 透明度可调（`petHost.SetOpacity`，0.15–1.0）。
- 位置/大小/透明度/置顶持久化到 `app/host.json`，重开恢复。

## 依赖
- **运行时**：Win10/11 自带的 **WebView2 Runtime**（无需用户安装）。
- **构建期**：`Microsoft.Web.WebView2` NuGet 的 managed DLL（`host/lib/` 已随仓库提供）。

## 构建
```bat
host\build.bat
```
用内置 `.NET Framework` 的 `csc.exe` 编译 `ClaudePetHost.cs` → `ClaudePet.Host.exe`，并把 WebView2 DLL 复制到 `host\`。产物：`ClaudePet.Host.exe` + 3 个 DLL。

## 页面桥（petHost）
页面通过 `window.chrome.webview.hostObjects.petHost` 调用：
| 方法 | 作用 |
|---|---|
| `Move(dx,dy)` | 拖动移动窗口 |
| `Resize(w,h)` | 球/面板切换时调整窗口大小 |
| `SetOpacity(percent)` | 设置窗口透明度 |
| `SetTopMost(bool)` | 置顶开关 |
| `Close()` | 保存配置并关闭 |

## 目录
- `host/ClaudePetHost.cs`：宿主源码。
- `host/build.bat`：构建脚本。
- `host/lib/`：WebView2 managed DLL（构建输入）。
- `host/webview2data/`：WebView2 运行时数据（自动生成，git 忽略）。
