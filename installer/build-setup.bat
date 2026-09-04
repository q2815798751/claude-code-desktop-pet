@echo off
rem ============================================================
rem  ClaudePet - build the Setup.exe installer
rem  Compiles the WebView2 host with csc, then drives Inno Setup.
rem  Requires Inno Setup 6/7 (ISCC.exe) - build-machine only.
rem  End users need nothing.  (pure ASCII)
rem ============================================================
setlocal
cd /d "%~dp0.."
set "ROOT=%CD%"

echo  [1/3] Building the host window exe...
call "%~dp0..\host\build.bat"
if errorlevel 1 (
  echo  [ERR] host build failed - nothing to package.
  exit /b 1
)

echo  [2/3] Locating Inno Setup (ISCC.exe)...
set "PFx86=%ProgramFiles(x86)%"
set "ISCC="
if exist "%PFx86%\Inno Setup 7\ISCC.exe"  set "ISCC=%PFx86%\Inno Setup 7\ISCC.exe"
if not defined ISCC if exist "%ProgramFiles%\Inno Setup 7\ISCC.exe"  set "ISCC=%ProgramFiles%\Inno Setup 7\ISCC.exe"
if not defined ISCC if exist "%LOCALAPPDATA%\Programs\Inno Setup 7\ISCC.exe" set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 7\ISCC.exe"
if not defined ISCC if exist "%PFx86%\Inno Setup 6\ISCC.exe" set "ISCC=%PFx86%\Inno Setup 6\ISCC.exe"
if not defined ISCC if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe"  set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if not defined ISCC if exist "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if not defined ISCC (
  echo  [ERR] Inno Setup ISCC.exe not found on this machine.
  echo         Install it, or put its path in PATH, then retry.
  echo         Download: https://jrsoftware.org/isdl.php
  exit /b 1
)
echo        Using %ISCC%

echo  [3/3] Compiling the installer...
"%ISCC%" "%~dp0\claudepet.iss"
if errorlevel 1 (
  echo  [ERR] Inno compile failed.
  exit /b 1
)

echo.
echo  [OK] Built %ROOT%\ClaudePet-Setup.exe
endlocal
exit /b 0
