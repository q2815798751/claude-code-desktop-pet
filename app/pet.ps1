# CLAUDE.PET window helpers (pure ASCII)
param([string]$Action='open', [int]$ProcId=0)

Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PetWin {
    [DllImport("user32.dll")]   public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]   public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]   public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]   public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]   public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool SystemParametersInfo(uint a, uint b, IntPtr c, uint d);
    [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint dwProcessId);
    [DllImport("kernel32.dll")] public static extern bool FreeConsole();
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
        public uint uMsg; public ushort wParamL; public ushort wParamH;
    }
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public INPUTUNION U;
    }
}
'@

function Get-EdgePath {
    $c = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
           "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
    foreach ($p in $c) { if (Test-Path $p) { return $p } }
    return $null
}

function Open-EdgeWindow {
    $s = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $x = $s.Right - 340
    $y = $s.Bottom - 502
    $e = Get-EdgePath
    if (-not $e) { Write-Error 'msedge not found'; exit 1 }
    $dir = $PSScriptRoot
    $pro = Join-Path $dir 'edge_profile'
    $edgeArgs = @(
        '--app=http://127.0.0.1:9876/',
        '--window-size=320,472',
        "--window-position=$x,$y",
        "--user-data-dir=$pro",
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-session-crashed-bubble'
    )
    Start-Process -FilePath $e -ArgumentList $edgeArgs
}

function Get-ConsoleWindowHandle {
    param([int]$Target)
    [PetWin]::FreeConsole() | Out-Null
    if ([PetWin]::AttachConsole([uint32]$Target)) {
        $h = [PetWin]::GetConsoleWindow()
        [PetWin]::FreeConsole() | Out-Null
        if ($h -ne [IntPtr]::Zero) { return $h }
    }
    $proc = Get-Process -Id $Target -ErrorAction SilentlyContinue
    if ($proc) { return $proc.MainWindowHandle }
    return [IntPtr]::Zero
}

function Invoke-WindowAction {
    param([string]$Action, [int]$Target)
    if ($Target -le 0) { return }
    $h = Get-ConsoleWindowHandle -Target $Target
    if ($h -eq [IntPtr]::Zero) { return }
    switch ($Action) {
        'min'     { [PetWin]::ShowWindow($h, 6) | Out-Null }
        'restore' { [PetWin]::ShowWindow($h, 9) | Out-Null; [PetWin]::SetForegroundWindow($h) | Out-Null }
        'focus'   { [PetWin]::SetForegroundWindow($h) | Out-Null }
        'toggle'  {
            if ([PetWin]::IsIconic($h)) {
                [PetWin]::ShowWindow($h, 9) | Out-Null
                [PetWin]::SetForegroundWindow($h) | Out-Null
            } else {
                [PetWin]::ShowWindow($h, 6) | Out-Null
            }
        }
    }
}

function Add-VkKey {
    param($List, [int]$Vk, [int]$Flags)
    $union = New-Object PetWin+INPUTUNION
    $ki = New-Object PetWin+KEYBDINPUT
    $ki.wVk = $Vk
    $ki.wScan = 0
    $ki.dwFlags = $Flags
    $ki.dwExtraInfo = [IntPtr]::Zero
    $union.ki = $ki
    $in = New-Object PetWin+INPUT
    $in.type = 1   # INPUT_KEYBOARD
    $in.U = $union
    $List.Add($in) | Out-Null
}

function Send-TextToConsole {
    param([int]$Target, [string]$Text)
    if ($Text.Length -eq 0) { return }
    $result = 'clipboard'
    try { [System.Windows.Forms.Clipboard]::SetText($Text) } catch {}   # safety net

    $hwnd = Get-ConsoleWindowHandle -Target $Target
    if ($hwnd -eq [IntPtr]::Zero) { Set-Content (Join-Path $PSScriptRoot 'send.result') $result; return }

    # console windows are owned by conhost.exe, so compute the terminal console's owner PID
    $conhostPid = [uint32]0
    [PetWin]::FreeConsole() | Out-Null
    $att = [PetWin]::AttachConsole([uint32]$Target)
    if ($att) {
        $cw = [PetWin]::GetConsoleWindow()
        [PetWin]::GetWindowThreadProcessId($cw, [ref]$conhostPid) | Out-Null
        [PetWin]::FreeConsole() | Out-Null
    }

    # focus the terminal (temporarily disable the foreground-lock timeout)
    $old = [IntPtr]::Zero
    [PetWin]::SystemParametersInfo(0x2000, 0, $old, 0) | Out-Null
    [PetWin]::SystemParametersInfo(0x2001, 0, [IntPtr]::Zero, 0) | Out-Null
    [PetWin]::ShowWindow($hwnd, 9) | Out-Null
    $fgOk = $false
    for ($i = 0; $i -lt 4; $i++) {
        [PetWin]::SetForegroundWindow($hwnd) | Out-Null
        Start-Sleep -Milliseconds 250
        $fgPid = [uint32]0
        [PetWin]::GetWindowThreadProcessId([PetWin]::GetForegroundWindow(), [ref]$fgPid) | Out-Null
        if ($fgPid -eq $conhostPid -or $fgPid -eq [uint32]$Target) { $fgOk = $true; break }
    }

    # paste while the foreground lock stays disabled (restore it AFTER sending)
    if ($fgOk) {
        $list = New-Object 'System.Collections.Generic.List[PetWin+INPUT]'
        Add-VkKey $list 0x11 0          # CTRL down
        Add-VkKey $list 0x56 0          # V down
        Add-VkKey $list 0x56 0x0002     # V up
        Add-VkKey $list 0x11 0x0002     # CTRL up
        Add-VkKey $list 0x0D 0          # ENTER down (submit claude input)
        Add-VkKey $list 0x0D 0x0002     # ENTER up
        $arr = $list.ToArray()
        # Marshal.SizeOf can't size Sequential+Explicit INPUT; INPUT is 40 bytes on x64, 28 on x86
        $cb = if ([IntPtr]::Size -eq 8) { 40 } else { 28 }
        $sent = [PetWin]::SendInput([uint32]$arr.Length, $arr, $cb)
        if ($sent -gt 0) { $result = 'pasted' }
    }
    [PetWin]::SystemParametersInfo(0x2001, 0, $old, 0) | Out-Null   # restore foreground lock
    Set-Content (Join-Path $PSScriptRoot 'send.result') $result
}

switch ($Action) {
    'open'    { Open-EdgeWindow }
    'min'     { Invoke-WindowAction -Action min -Target $ProcId }
    'restore' { Invoke-WindowAction -Action restore -Target $ProcId }
    'focus'   { Invoke-WindowAction -Action focus -Target $ProcId }
    'toggle'  { Invoke-WindowAction -Action toggle -Target $ProcId }
    'send'    {
        $txtFile = Join-Path $PSScriptRoot 'send.txt'
        if (-not (Test-Path $txtFile)) { exit }
        $text = Get-Content -Raw -Encoding UTF8 $txtFile
        Remove-Item $txtFile -Force -ErrorAction SilentlyContinue
        if ($text) { Send-TextToConsole -Target $ProcId -Text $text }
    }
}
