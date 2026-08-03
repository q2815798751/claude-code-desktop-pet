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
if errorlevel 1 (
  echo.
  echo  [pet] environment check failed - fix the issues above, then retry.
  echo.
  exit /b 1
)

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
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','app\pet-term.ps1' -PassThru; Set-Content -Path ('%CD%\app\term.pid') -Value $p.Id -Encoding Ascii"
)

rem ---- 2) pet server (skip if already listening) ----
curl -s http://127.0.0.1:%PORT%/api/health >nul 2>&1
if errorlevel 1 (
  echo  [pet] starting server...
  start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$w = Get-Location; $node = (Get-Command node).Source; Start-Process -FilePath $node -ArgumentList 'app\server.js' -WorkingDirectory $w.Path -WindowStyle Hidden"
)

rem ---- 3) wait for server ----
set "UP="
for /l %%I in (1,1,30) do (
  curl -s http://127.0.0.1:%PORT%/api/health >nul 2>&1
  if not errorlevel 1 ( set "UP=1" & goto :up )
  %SystemRoot%\System32\timeout.exe /t 1 /nobreak >nul
)
:up
if not defined UP (
  echo  [ERR] pet server did not start on port %PORT%
  exit /b 1
)

rem ---- 4) open pet window (skip if already open) ----
for /f "delims=" %%W in ('curl -s http://127.0.0.1:%PORT%/api/window') do set "WIN=%%W"
if not "%WIN%"=="1" (
  echo  [pet] opening window...
  start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0app\pet.ps1" -Action open
)

endlocal
exit /b 0
