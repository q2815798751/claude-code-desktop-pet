ClaudePet 桌宠 - 快速上手
================================

一个透明桌面宠物，实时反映 Claude Code CLI 的工作状态（思考/工作/长任务/完成/待命/离线/异常）。

【环境要求】
  · Windows 10/11
  · Node.js >= 18      （nodejs.org 下载，装完重开终端）
  · Claude Code CLI    （npm i -g @anthropic-ai/claude-code）
  · Microsoft Edge     （Win10/11 自带）

【安装】
  推荐：双击 ClaudePet-Setup.exe（自动检测 node/claude，缺失弹窗警告、可指定路径；免管理员）
  手动：双击 install.bat，复制完成会生成 "Claude Pet" 快捷方式
  然后双击桌面 "Claude Pet" → 终端启动 claude + 右下角出现桌宠

【使用】
  · 双击桌宠      激活 claude 终端
  · 桌宠按钮       焦点 / 收起-打开 / 调试(循环切GIF) / 退出
  · 键盘           D=调试切态   Esc=退出
  · 关闭终端      桌宠 5 秒内自动退出

【卸载】
  运行 %LOCALAPPDATA%\ClaudePet\uninstall.bat

【遇到问题】
  运行 check-env.bat 查看环境自检报告，缺什么装什么。
  缺少必须环境（node/claude）时启动会弹窗提示；首次启动会自动编译 host 窗口。
