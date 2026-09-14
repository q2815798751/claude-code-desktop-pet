@echo off
rem ============================================================
rem  CLAUDE.PET - uninstaller (pure ASCII)
rem  Stops the pet server, removes shortcuts + installed folder.
rem  Folder removal runs from a detached temp bat so this file
rem  can be deleted while it is still executing.
rem ============================================================
setlocal
set "TARGET=%LOCALAPPDATA%\ClaudePet"

echo ==========================================
echo   ClaudePet - Uninstaller
echo ==========================================
echo.

echo  [1/3] Stopping pet server (if running)...
curl -s -X POST http://127.0.0.1:9876/api/exit >nul 2>&1
%SystemRoot%\System32\timeout.exe /t 2 /nobreak >nul

echo  [2/3] Removing Claude Code hooks...
if exist "%TARGET%\hooks-setup.bat" (
  call "%TARGET%\hooks-setup.bat" remove
) else (
  echo        hooks-setup.bat not found - nothing to remove.
)

echo  [3/3] Removing shortcuts and files...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; foreach ($folder in @($ws.SpecialFolders.Item('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) { $f = Join-Path $folder 'Claude Pet.lnk'; if (Test-Path $f) { Remove-Item $f -Force } }"

> "%TEMP%\pet-uninstall-cleanup.bat" echo @echo off
>> "%TEMP%\pet-uninstall-cleanup.bat" echo %SystemRoot%\System32\timeout.exe /t 3 /nobreak ^>nul
>> "%TEMP%\pet-uninstall-cleanup.bat" echo rmdir /s /q "%TARGET%" 2^>nul
>> "%TEMP%\pet-uninstall-cleanup.bat" echo if exist "%TARGET%" ^( echo [warn] files in use - close ClaudePet and run uninstall again ^)
>> "%TEMP%\pet-uninstall-cleanup.bat" echo del "%%~f0"
start "" /min "%TEMP%\pet-uninstall-cleanup.bat"

echo.
echo   Uninstalled - cleanup finishing in background.
echo ==========================================
endlocal
exit /b 0
