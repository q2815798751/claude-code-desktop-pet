@echo off
rem ============================================================
rem  CLAUDE.PET - open the pet window only (server auto-starts)
rem  Needs node; does NOT require claude to be running.
rem  (pure ASCII)
rem ============================================================
setlocal
cd /d "%~dp0"
set "PORT=9876"

where node >nul 2>&1
if errorlevel 1 goto :nonode

curl -s http://127.0.0.1:%PORT%/api/health >nul 2>&1
if errorlevel 1 (
  echo  [pet] starting server...
  start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$w = Get-Location; $node = (Get-Command node).Source; Start-Process -FilePath $node -ArgumentList 'app\server.js' -WorkingDirectory $w.Path -WindowStyle Hidden"
)

set "UP="
for /l %%I in (1,1,30) do (
  curl -s http://127.0.0.1:%PORT%/api/health >nul 2>&1
  if not errorlevel 1 ( set "UP=1" & goto :up )
  %SystemRoot%\System32\timeout.exe /t 1 /nobreak >nul
)
:up
if not defined UP goto :noserver

rem ---- build the host window exe if it has never been built (fresh clone) ----
if not exist "%~dp0host\ClaudePet.Host.exe" (
  echo  [pet] building host window - first run...
  call "%~dp0host\build.bat"
  if errorlevel 1 goto :nohost
)

for /f "delims=" %%W in ('curl -s http://127.0.0.1:%PORT%/api/window') do set "WIN=%%W"
if not "%WIN%"=="1" (
  echo  [pet] opening window...
  start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0app\pet.ps1" -Action open
)

endlocal
exit /b 0

:nonode
echo.
echo  [ERR] Node.js not found.
echo        ClaudePet needs Node.js 18 or newer. Install it from https://nodejs.org, then open a NEW terminal.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('ClaudePet needs Node.js 18 or newer. Install it from https://nodejs.org, then reopen this window.','ClaudePet - Error')" >nul 2>&1
pause
exit /b 1

:noserver
echo  [ERR] pet server did not start on port %PORT%
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('The ClaudePet server did not start on port 9876. This usually means Node.js is not available.','ClaudePet - Error')" >nul 2>&1
pause
exit /b 1

:nohost
echo  [ERR] failed to build the host window (ClaudePet.Host.exe)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('ClaudePet could not build its host window. .NET Framework 4.x (csc.exe) may be missing.','ClaudePet - Error')" >nul 2>&1
pause
exit /b 1
