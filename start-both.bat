@echo off
rem ============================================================
rem  CLAUDE.PET - start terminal+claude AND pet window
rem  Idempotent: safe to run repeatedly.
rem  Runs the env check first and aborts if required parts are
rem  missing.  (pure ASCII)
rem ============================================================
setlocal
cd /d "%~dp0"
set "PORT=9876"

rem ---- 0) environment check (required) ----
call "%~dp0check-env.bat"
if errorlevel 1 goto :envfail

rem ---- 1) terminal + claude (via app\pet-term.ps1, runs in user home dir) ----
set "TERMPID="
if exist "%~dp0app\term.pid" (
  for /f "delims=" %%P in (%~dp0app\term.pid) do set "TERMPID=%%P"
)
if defined TERMPID (
  tasklist /FI "PID eq %TERMPID%" /NH 2>nul | findstr /C:"%TERMPID%" >nul 2>&1
  if errorlevel 1 set "TERMPID="
)
if not defined TERMPID (
  echo  [pet] starting claude terminal...
  del /q "%~dp0app\term.pid" >nul 2>&1
  where wt.exe >nul 2>&1
  if not errorlevel 1 (
    echo  [pet] using Windows Terminal...
    wt.exe --window new --title "Claude Code - ClaudePet" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\pet-term.ps1"
  ) else (
    echo  [pet] Windows Terminal not found - using a PowerShell window...
    start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\pet-term.ps1"
  )
)

rem ---- resolve node path: app\runtime.ini (installer-set) first, else PATH ----
set "NODE="
if exist "%~dp0app\runtime.ini" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0app\runtime.ini") do if /i "%%A"=="NODE" set "NODE=%%B"
)
if defined NODE if not exist "%NODE%" set "NODE="
if not defined NODE for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE set "NODE=%%N"

rem ---- 2) pet server (skip if already listening) ----
curl -s http://127.0.0.1:%PORT%/api/health >nul 2>&1
if errorlevel 1 (
  echo  [pet] starting server...
  start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process -FilePath '%NODE%' -ArgumentList 'app\server.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
)

rem ---- 3) wait for server ----
set "UP="
for /l %%I in (1,1,30) do (
  curl -s http://127.0.0.1:%PORT%/api/health >nul 2>&1
  if not errorlevel 1 ( set "UP=1" & goto :up )
  %SystemRoot%\System32\timeout.exe /t 1 /nobreak >nul
)
:up
if not defined UP goto :noserver

rem ---- build the host window exe if it has never been built - fresh clone ----
if not exist "%~dp0host\ClaudePet.Host.exe" (
  echo  [pet] building host window - first run...
  call "%~dp0host\build.bat"
  if errorlevel 1 goto :nohost
)

rem ---- 4) open pet window (skip if already open) ----
for /f "delims=" %%W in ('curl -s http://127.0.0.1:%PORT%/api/window') do set "WIN=%%W"
if not "%WIN%"=="1" (
  echo  [pet] opening window...
  start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0app\pet.ps1" -Action open
)

endlocal
exit /b 0

:envfail
echo.
echo  [pet] environment check failed - fix the issues above, then retry.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('ClaudePet environment check failed. Required: Node.js 18+ and the Claude Code CLI. See the console window for which items are missing.','ClaudePet - Error')" >nul 2>&1
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
