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
    [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint dwProcessId);
    [DllImport("kernel32.dll")] public static extern bool FreeConsole();
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
}
'@

function Open-HostWindow {
    $hostExe = Join-Path (Split-Path $PSScriptRoot -Parent) 'host\ClaudePet.Host.exe'
    if (-not (Test-Path $hostExe)) { Write-Error 'ClaudePet.Host.exe not found'; exit 1 }
    Start-Process -FilePath $hostExe
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

switch ($Action) {
    'open'    { Open-HostWindow }
    'min'     { Invoke-WindowAction -Action min -Target $ProcId }
    'restore' { Invoke-WindowAction -Action restore -Target $ProcId }
    'focus'   { Invoke-WindowAction -Action focus -Target $ProcId }
    'toggle'  { Invoke-WindowAction -Action toggle -Target $ProcId }
}
