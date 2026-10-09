@echo off
setlocal EnableExtensions EnableDelayedExpansion
title JARVIS - AI System Launcher
color 0A

cls
echo.
echo  ============================================================
echo    JARVIS  --  ADVANCED AI SYSTEM
echo    Gemma 4 E2B + Hermes Computer Use
echo  ============================================================
echo.

set "JDIR=%~dp0"
if "%JDIR:~-1%"=="\" set "JDIR=%JDIR:~0,-1%"
cd /d "%JDIR%"

:: ----- STEP 1: Check Node.js -----
echo  [1/6] Checking Node.js...
node -v >nul 2>&1
if errorlevel 1 (
  echo  [ERROR] Node.js is not installed.
  echo  Install Node.js LTS and restart this launcher.
  pause
  exit /b 1
)
echo  [OK] Node.js found.

:: ----- STEP 2: Install project dependencies -----
echo  [2/6] Checking JARVIS dependencies...
if not exist "%JDIR%\node_modules\express" (
  echo  [..] Running npm install...
  call npm install
  if errorlevel 1 (
    echo  [ERROR] npm install failed.
    pause
    exit /b 1
  )
)
echo  [OK] Dependencies ready.


:: ----- STEP 3: Check local Ollama / Gemma brain -----
echo  [3/6] Checking Ollama + Gemma 4 E2B...
where ollama >nul 2>&1
if errorlevel 1 (
  echo  [ERROR] Ollama is not installed or not on PATH.
  echo  Install Ollama, then run: ollama pull gemma4:e2b
  pause
  exit /b 1
)
ollama list | findstr /I /C:"gemma4:e2b" >nul 2>&1
if errorlevel 1 (
  echo  [ERROR] Gemma 4 E2B is not installed in Ollama.
  echo  Run: ollama pull gemma4:e2b
  pause
  exit /b 1
)
echo  [OK] Ollama + Gemma 4 E2B found.

:: ----- STEP 4: Install/repair Hermes + bind it to local Gemma -----
echo  [4/6] Checking Hermes Agent...
set "HERMES_CMD="
where hermes >nul 2>&1
if not errorlevel 1 set "HERMES_CMD=hermes"
if not defined HERMES_CMD if exist "%LOCALAPPDATA%\hermes\bin\hermes.exe" set "HERMES_CMD=%LOCALAPPDATA%\hermes\bin\hermes.exe"

if not defined HERMES_CMD (
  echo  [..] Hermes not found. Running official installer...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%JDIR%\scripts\install-hermes.ps1"
  if errorlevel 1 (
    echo  [ERROR] Hermes installation failed.
    pause
    exit /b 1
  )
  if exist "%LOCALAPPDATA%\hermes\bin\hermes.exe" set "HERMES_CMD=%LOCALAPPDATA%\hermes\bin\hermes.exe"
)

if not defined HERMES_CMD (
  echo  [ERROR] Hermes executable not found after installation.
  echo  Check %%LOCALAPPDATA%%\hermes\bin and rerun.
  pause
  exit /b 1
)

"%HERMES_CMD%" --version >nul 2>&1
if errorlevel 1 (
  echo  [ERROR] Hermes executable cannot start.
  pause
  exit /b 1
)

echo  [OK] Hermes CLI found.
powershell -NoProfile -ExecutionPolicy Bypass -File "%JDIR%\scripts\configure-hermes-ollama.ps1"
if errorlevel 1 (
  echo  [ERROR] Hermes could not be bound to the local Ollama/Gemma model.
  pause
  exit /b 1
)
"%HERMES_CMD%" computer-use doctor --json > "%TEMP%\jarvis-hermes-doctor.json" 2>nul
if errorlevel 1 (
  echo  [..] Computer Use is not ready. Attempting repair...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%JDIR%\scripts\repair-hermes.ps1"
  if errorlevel 1 (
    echo  [ERROR] Hermes Computer Use repair failed.
    pause
    exit /b 1
  )
  "%HERMES_CMD%" computer-use doctor --json > "%TEMP%\jarvis-hermes-doctor.json" 2>nul
  if errorlevel 1 (
    echo  [ERROR] Hermes Computer Use doctor still reports failure.
    echo  Check the JSON report: %TEMP%\jarvis-hermes-doctor.json
    pause
    exit /b 1
  )
)
echo  [OK] Hermes local model binding + Computer Use diagnostics passed.

:: ----- STEP 5: Start or reuse JARVIS server safely -----
echo  [5/6] Checking JARVIS server...
set "JARVIS_ALREADY_RUNNING=0"
powershell -NoProfile -Command "try { $x=Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 1; if ($x.success -and $x.service -eq 'jarvis') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 set "JARVIS_ALREADY_RUNNING=1"
if "!JARVIS_ALREADY_RUNNING!"=="1" (
  echo  [OK] Existing JARVIS server is already running.
  goto :SERVER_READY
)
netstat -ano | findstr ":3000 " >nul 2>&1
if not errorlevel 1 (
  echo  [ERROR] Port 3000 is already in use by another process.
  echo  JARVIS will NOT kill unrelated processes automatically.
  echo  Close the process using port 3000, then rerun this launcher.
  pause
  exit /b 1
)

echo  [..] Starting JARVIS server...
start "JARVIS Server" /min cmd /d /c "cd /d "%JDIR%" ^&^& node server.js > jarvis_server.log 2>jarvis_server.error.log"

set "READY=0"
for /l %%I in (1,1,20) do (
  powershell -NoProfile -Command "try { $x=Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 1; if ($x.success) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    set "READY=1"
    goto :SERVER_READY
  )
  timeout /t 1 /nobreak >nul
)

:SERVER_READY
if "!READY!"=="0" (
  echo  [ERROR] JARVIS server did not become ready.
  echo  Check jarvis_server.log and jarvis_server.error.log.
  pause
  exit /b 1
)

echo  [OK] JARVIS server online.

:: ----- STEP 6: Open interface -----
echo  [6/6] Opening JARVIS interface...
start "" "http://127.0.0.1:3000"

echo.
echo  ============================================================
echo    JARVIS IS ONLINE
echo    Gemma 4 E2B is the local reasoning brain.
echo    Hermes is the local execution engine.
echo    Computer Use + Browser + Files + Terminal are enabled.
echo    Activity monitoring is running while this desktop is online.
echo  ============================================================
echo.
exit /b 0
