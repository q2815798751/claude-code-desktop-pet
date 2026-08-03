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
if errorlevel 1 (
  echo.
  echo  [ERR] node not found - run check-env.bat for details.
  echo.
  exit /b 1
)

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
if not defined UP (
  echo  [ERR] pet server did not start on port %PORT%
  exit /b 1
)

for /f "delims=" %%W in ('curl -s http://127.0.0.1:%PORT%/api/window') do set "WIN=%%W"
if not "%WIN%"=="1" (
  echo  [pet] opening window...
  start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0app\pet.ps1" -Action open
)

endlocal
exit /b 0
