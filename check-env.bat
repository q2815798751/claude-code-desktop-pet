@echo off
rem ============================================================
rem  CLAUDE.PET - environment self check
rem  Runs even without node: reports missing node in English,
rem  otherwise hands off to check-env.js for the full report.
rem  (pure ASCII - never put Chinese chars inside .bat files)
rem ============================================================
setlocal
chcp 65001 >nul

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [CHECK-ENV] Node.js NOT FOUND on this machine.
  echo  ClaudePet needs Node.js 18 or newer to run its local server.
  echo  Install it from https://nodejs.org then run this again.
  echo  IMPORTANT: open a NEW terminal after installing so PATH updates.
  echo.
  set "RC=1"
  goto :end
)

node "%~dp0check-env.js"
set "RC=%errorlevel%"

:end
endlocal & exit /b %RC%
