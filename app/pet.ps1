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
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tpl);
    [DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint m);
    [DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint m);
    [DllImport("kernel32.dll")] public static extern bool WriteConsoleInput(IntPtr hConsoleInput, INPUT_RECORD[] lpBuffer, uint nLength, out uint lpNumberOfEventsWritten);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern short VkKeyScanW(char ch);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct KEY_EVENT_RECORD {
        public bool bKeyDown;
        public ushort wRepeatCount;
        public ushort wVirtualKeyCode;
        public ushort wVirtualScanCode;
        public char UnicodeChar;
        public uint dwControlKeyState;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT_RECORD {
        public ushort EventType;
        public ushort Padding;
        public KEY_EVENT_RECORD KeyEvent;
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

# Inject text into the target console's input buffer via WriteConsoleInput.
# claude runs with ENABLE_VIRTUAL_TERMINAL_INPUT (0x200), whose translation corrupts
# injected CJK, so we temporarily clear that flag, inject, then restore it.
function Send-TextToConsole {
    param([int]$Target, [string]$Text)
    if ($Text.Length -eq 0) { return }
    # attach to the target's console (retry - can be flaky right after spawn)
    [PetWin]::FreeConsole() | Out-Null
    $attached = $false
    for ($i = 0; $i -lt 3 -and -not $attached; $i++) {
        $attached = [PetWin]::AttachConsole([uint32]$Target)
        if (-not $attached) { Start-Sleep -Milliseconds 150 }
    }
    if (-not $attached) { return }
    # AttachConsole does NOT redirect std handles -> open CONIN$ explicitly.
    # GENERIC_READ|GENERIC_WRITE = 3221225472; FILE_SHARE_READ|WRITE = 3; OPEN_EXISTING = 3
    $hIn = [PetWin]::CreateFile('CONIN$', [uint32]3221225472, [uint32]3, [IntPtr]::Zero, [uint32]3, [uint32]0, [IntPtr]::Zero)
    if ($hIn -eq [IntPtr]::Zero -or $hIn -eq [IntPtr](-1)) { [PetWin]::FreeConsole() | Out-Null; return }

    # save console mode, then disable VT input (0x200) and quick-edit (0x40)
    $saved = [uint32]0
    [PetWin]::GetConsoleMode($hIn, [ref]$saved) | Out-Null
    [PetWin]::SetConsoleMode($hIn, ($saved -band (-bnot (0x200 -bor 0x40)))) | Out-Null

    $records = New-Object 'System.Collections.Generic.List[PetWin+INPUT_RECORD]'
    foreach ($ch in $Text.ToCharArray()) {
        # UnicodeChar carries the exact char; VK from VkKeyScanW or VK_PACKET for CJK
        $vk = [PetWin]::VkKeyScanW($ch)
        if ($vk -eq -1) { $code = 0xE7 } else { $code = $vk -band 0xFF }
        foreach ($down in @($true, $false)) {
            $ir = New-Object PetWin+INPUT_RECORD
            $ir.EventType = 1  # KEY_EVENT
            $ke = New-Object PetWin+KEY_EVENT_RECORD
            $ke.bKeyDown = $down
            $ke.wRepeatCount = 1
            $ke.wVirtualKeyCode = $code
            $ke.wVirtualScanCode = [uint16][char]$ch
            $ke.UnicodeChar = $ch
            $ir.KeyEvent = $ke
            $records.Add($ir) | Out-Null
        }
    }
    # Enter (VK_RETURN / \r) to submit
    foreach ($down in @($true, $false)) {
        $ir = New-Object PetWin+INPUT_RECORD
        $ir.EventType = 1
        $ke = New-Object PetWin+KEY_EVENT_RECORD
        $ke.bKeyDown = $down
        $ke.wRepeatCount = 1
        $ke.wVirtualKeyCode = 13
        $ke.wVirtualScanCode = [uint16]13
        $ke.UnicodeChar = [char]13
        $ir.KeyEvent = $ke
        $records.Add($ir) | Out-Null
    }
    $arr = $records.ToArray()
    $written = [uint32]0
    [PetWin]::WriteConsoleInput($hIn, $arr, [uint32]$arr.Length, [ref]$written) | Out-Null
    # wait for claude to read the input while VT input is still off, then restore
    Start-Sleep -Milliseconds 800
    [PetWin]::SetConsoleMode($hIn, $saved) | Out-Null
    [PetWin]::FreeConsole() | Out-Null
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
