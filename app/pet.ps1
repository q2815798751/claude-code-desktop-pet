# CLAUDE.PET window helpers (pure ASCII)
param([string]$Action='open', [int]$ProcId=0)

Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PetWin {
    [DllImport("user32.dll")]   public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]   public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint dwProcessId);
    [DllImport("kernel32.dll")] public static extern bool FreeConsole();
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
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
    # Console processes (powershell/cmd started via Start-Process) report
    # MainWindowHandle = 0, so attach to the target's console and read the
    # real console window handle instead.
    [PetWin]::FreeConsole() | Out-Null
    if ([PetWin]::AttachConsole([uint32]$Target)) {
        $h = [PetWin]::GetConsoleWindow()
        [PetWin]::FreeConsole() | Out-Null
        if ($h -ne [IntPtr]::Zero) { return $h }
    }
    # fallback: MainWindowHandle
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
    }
}

switch ($Action) {
    'open'    { Open-EdgeWindow }
    'min'     { Invoke-WindowAction -Action min -Target $ProcId }
    'restore' { Invoke-WindowAction -Action restore -Target $ProcId }
    'focus'   { Invoke-WindowAction -Action focus -Target $ProcId }
}
