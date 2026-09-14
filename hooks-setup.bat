@echo off
rem ============================================================
rem  CLAUDE.PET - install or remove the Claude Code hooks
rem  (pure ASCII)
rem
rem  Usage: hooks-setup.bat install|remove
rem
rem  Resolves node from app\runtime.ini (installer-set) first,
rem  then PATH, so it also works when node is not on PATH.
rem  Always exits 0 - a missing node must not fail an install.
rem ============================================================
setlocal
cd /d "%~dp0"
set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=install"

set "NODE="
if exist "%~dp0app\runtime.ini" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0app\runtime.ini") do if /i "%%A"=="NODE" set "NODE=%%B"
)
if defined NODE if not exist "%NODE%" set "NODE="
if not defined NODE for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE set "NODE=%%N"

if not defined NODE (
  echo  [claudepet] node not found - skipping hook %ACTION%.
  endlocal
  exit /b 0
)
if not exist "%~dp0app\hooks.js" (
  echo  [claudepet] app\hooks.js not found - skipping hook %ACTION%.
  endlocal
  exit /b 0
)

"%NODE%" "%~dp0app\hooks.js" %ACTION% --app "%~dp0app"
endlocal
exit /b 0
