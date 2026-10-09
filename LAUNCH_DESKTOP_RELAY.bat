@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo [JARVIS] Node.js was not found on PATH.
  pause
  exit /b 1
)
if not exist ".env" (
  echo [JARVIS] Missing .env in the JARVIS project root.
  echo Copy scripts\desktop-relay.env.example to .env and fill in the Render relay values first.
  pause
  exit /b 2
)
echo [JARVIS] Starting Windows desktop relay...
node scripts\desktop-relay-agent.js
set EXIT_CODE=%ERRORLEVEL%
echo [JARVIS] Relay stopped with exit code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
