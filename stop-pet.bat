@echo off
rem ============================================================
rem  CLAUDE.PET - close pet window and stop server
rem  (pure ASCII)
rem ============================================================
curl -s -X POST http://127.0.0.1:9876/api/exit >nul 2>&1
echo [pet] exit signal sent - closing in a few seconds
