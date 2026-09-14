@echo off
rem ============================================================
rem  CLAUDE.PET hook forwarder (pure ASCII)
rem  Claude Code runs this on every hook event and hands it the
rem  event JSON on stdin. We just forward that stdin to the pet
rem  server and get out of the way - all the interpretation
rem  happens server side, so this stays a one-liner.
rem
rem  ALWAYS exits 0. A pet that is not running must never block
rem  or warn inside a tool call.
rem ============================================================
curl.exe -s -m 1 --connect-timeout 1 -X POST "http://127.0.0.1:9876/event" -H "Content-Type: application/json" --data-binary @- >nul 2>&1
exit /b 0
