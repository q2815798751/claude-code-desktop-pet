@echo off
rem ============================================================
rem  CLAUDE.PET - installer (pure ASCII)
rem  Copies app to %LOCALAPPDATA%\ClaudePet, creates Desktop +
rem  Start Menu shortcuts, writes config.txt.
rem  Env check runs first but does NOT block installation.
rem ============================================================
setlocal
set "TARGET=%LOCALAPPDATA%\ClaudePet"
set "VER=1.0.2"

echo ==========================================
echo   ClaudePet v%VER% - Installer
echo ==========================================
echo.

rem stop a running pet first so files are not locked
curl -s -X POST http://127.0.0.1:9876/api/exit >nul 2>&1
%SystemRoot%\System32\timeout.exe /t 1 /nobreak >nul

echo  [1/4] Environment check (informational)...
call "%~dp0check-env.bat"

echo.
echo  [2/4] Installing to %TARGET% ...
if exist "%TARGET%" (
  echo        removing previous installation...
  rmdir /s /q "%TARGET%" 2>nul
)
mkdir "%TARGET%" 2>nul
xcopy "%~dp0app" "%TARGET%\app\" /e /i /y /q >nul
if errorlevel 1 (
  echo  [ERR] failed to copy app files.
  exit /b 1
)
for %%F in (check-env.bat check-env.js start-both.bat start-pet.bat stop-pet.bat uninstall.bat) do (
  copy /y "%~dp0%%F" "%TARGET%\" >nul
)

echo  [3/4] Writing config...
> "%TARGET%\config.txt" echo ClaudePet v%VER%
>> "%TARGET%\config.txt" echo installed=%date% %time%
>> "%TARGET%\config.txt" echo home=%USERPROFILE%

echo  [4/4] Creating desktop + start menu shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $icon = '%TARGET%\app\pet.ico,0'; foreach ($folder in @($ws.SpecialFolders.Item('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) { $s = $ws.CreateShortcut((Join-Path $folder 'Claude Pet.lnk')); $s.TargetPath = '%TARGET%\start-both.bat'; $s.WorkingDirectory = '%TARGET%'; $s.IconLocation = $icon; $s.Description = 'ClaudePet - Claude Code desktop pet'; $s.WindowStyle = 7; $s.Save() }"

echo.
echo  ==========================================
echo   Installed to %TARGET%
echo   Double-click the "Claude Pet" shortcut.
echo   Uninstall:  %TARGET%\uninstall.bat
echo  ==========================================
echo.
endlocal
exit /b 0
