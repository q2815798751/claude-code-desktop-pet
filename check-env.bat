@echo off
rem ============================================================
rem  CLAUDE.PET - environment self check
rem  Runs even without node: reports missing node in English,
rem  otherwise hands off to check-env.js for the full report.
rem  (pure ASCII - never put Chinese chars inside .bat files)
rem ============================================================
setlocal
chcp 65001 >nul

rem resolve node: app\runtime.ini (installer-set) first, else PATH
set "NODE="
if exist "%~dp0app\runtime.ini" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0app\runtime.ini") do if /i "%%A"=="NODE" set "NODE=%%B"
)
if defined NODE if not exist "%NODE%" set "NODE="
if not defined NODE for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE set "NODE=%%N"
if not defined NODE (
  echo.
  echo  [CHECK-ENV] Node.js NOT FOUND on this machine.
  echo  ClaudePet needs Node.js 18 or newer to run its local server.
  echo  Install it from https://nodejs.org then run this again.
  echo  IMPORTANT: open a NEW terminal after installing so PATH updates.
  echo.
  set "RC=1"
  goto :end
)

"%NODE%" "%~dp0check-env.js"
set "RC=%errorlevel%"

:end
endlocal & exit /b %RC%
