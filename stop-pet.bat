@echo off
rem ============================================================
rem  CLAUDE.PET - close pet window and stop server
rem  Graceful first, then a forced fallback so a hung scanner or
rem  a lost window cannot leave node/port 9876 behind.
rem  (pure ASCII)
rem ============================================================
setlocal
curl -s -X POST http://127.0.0.1:9876/api/exit >nul 2>&1
echo [pet] exit signal sent - waiting...
%SystemRoot%\System32\timeout.exe /t 4 /nobreak >nul

rem ---- fallback: force-stop the pet server and host if still present ----
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'app\\server\.js' }; foreach ($x in $p) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
taskkill /IM ClaudePet.Host.exe /F >nul 2>&1
echo [pet] stopped
endlocal
exit /b 0
