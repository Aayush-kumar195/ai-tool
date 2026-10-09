################################################################################
#  JARVIS INTEGRATION HUB — PowerShell Control Center
#  Aayush's Personal AI System — Full Integration Script
#  Usage: Right-click > Run with PowerShell
################################################################################

$Host.UI.RawUI.WindowTitle = "JARVIS Integration Hub — Aayush's AI System"
$JARVIS_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$PORT = if ($env:PORT) { [int]$env:PORT } else { 3000 }
$SERVER_URL  = "http://127.0.0.1:$PORT"
$API_URL     = "http://127.0.0.1:$PORT/api"
$MEM_FILE    = Join-Path $JARVIS_DIR "memories.json"
$LOG_FILE    = Join-Path $JARVIS_DIR "jarvis_server.log"
$ERR_LOG_FILE = Join-Path $JARVIS_DIR "jarvis_server.error.log"

function Show-Banner {
  Clear-Host
  Write-Host ""
  Write-Host "  ============================================================" -ForegroundColor Cyan
  Write-Host "    JARVIS  ·  INTEGRATION HUB  ·  CONTROL CENTER" -ForegroundColor Cyan
  Write-Host "    Aayush's Personal AI System — v2.0" -ForegroundColor DarkCyan
  Write-Host "  ============================================================" -ForegroundColor Cyan
  Write-Host ""
}

function Show-Menu {
  Show-Banner
  Write-Host "  MAIN MENU" -ForegroundColor Yellow
  Write-Host "  ---------------------------------------------------------"
  Write-Host "  [1]  Start JARVIS (Server + Browser)"
  Write-Host "  [2]  Stop JARVIS Server"
  Write-Host "  [3]  Restart JARVIS Server"
  Write-Host "  [4]  Check Server Status"
  Write-Host "  [5]  View Memory Bank"
  Write-Host "  [6]  Add Memory to JARVIS"
  Write-Host "  [7]  Clear All Memories"
  Write-Host "  [8]  View Server Logs"
  Write-Host "  [9]  Open JARVIS in Browser"
  Write-Host "  [10] Install / Update Dependencies (npm install)"
  Write-Host "  [11] Hermes Status"
  Write-Host "  [12] Quick System Check"
  Write-Host "  [0]  Exit"
  Write-Host "  ---------------------------------------------------------"
  Write-Host ""
}

function Start-JarvisServer {
  Write-Host ""
  Write-Host "  [..] Starting JARVIS Intelligence Server..." -ForegroundColor Yellow

  # Check if already running
  $proc = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue
  if ($proc) {
    Write-Host "  [!]  Server already running on port $PORT." -ForegroundColor Green
    return
  }

  # Verify Hermes CLI and Computer Use locally. JARVIS invokes Hermes chat per task;
  # a gateway is not required for local Computer Use.
  try {
    $hermes = Get-Command hermes -ErrorAction Stop
    & $hermes.Source --version
    & $hermes.Source computer-use status
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  [..] Repairing Hermes Computer Use..." -ForegroundColor Yellow
      & (Join-Path $JARVIS_DIR "scripts\repair-hermes.ps1")
    }
  } catch {
    Write-Host "  [!!] Hermes CLI is not installed. Use menu option [11] or scripts\install-hermes.ps1." -ForegroundColor Red
  }

  # Start node server with separate stdout/stderr logs.
  $serverProc = Start-Process -FilePath "node" `
    -ArgumentList "server.js" `
    -WorkingDirectory $JARVIS_DIR `
    -RedirectStandardOutput $LOG_FILE `
    -RedirectStandardError $ERR_LOG_FILE `
    -WindowStyle Hidden `
    -PassThru

  Write-Host "  [..] Warming up... (PID: $($serverProc.Id))" -ForegroundColor DarkCyan
  Start-Sleep -Seconds 3

  # Verify
  $check = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue
  if ($check) {
    Write-Host "  [OK] JARVIS Server ONLINE at $SERVER_URL" -ForegroundColor Green
  } else {
    Write-Host "  [!]  Server may still be initializing. Check logs for details." -ForegroundColor DarkYellow
  }
}

function Stop-JarvisServer {
  Write-Host ""
  Write-Host "  [..] Stopping JARVIS Server..." -ForegroundColor Yellow

  $connections = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue
  if (-not $connections) {
    Write-Host "  [!]  No server found running on port $PORT." -ForegroundColor DarkYellow
    return
  }

  foreach ($conn in $connections) {
    $pid = $conn.OwningProcess
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Write-Host "  [OK] Killed process PID $pid" -ForegroundColor Green
  }
  Write-Host "  [OK] JARVIS Server stopped." -ForegroundColor Green
}

function Check-HermesStatus {
  Write-Host ""
  Write-Host "  HERMES AGENT STATUS" -ForegroundColor Cyan
  Write-Host "  ---------------------------------------------------------"
  try {
    $resp = Invoke-RestMethod -Uri "$API_URL/hermes/status" -TimeoutSec 15 -ErrorAction Stop
    if ($resp.computerUseReady) {
      Write-Host "  [OK] Hermes + Computer Use are ready." -ForegroundColor Green
    } elseif ($resp.installed) {
      Write-Host "  [!] Hermes is installed but Computer Use is not ready." -ForegroundColor Yellow
      Write-Host "      $($resp.detail)"
      Write-Host "      Run: hermes computer-use doctor"
    } else {
      Write-Host "  [!!] Hermes is not installed." -ForegroundColor Red
      Write-Host "      Run: .\scripts\install-hermes.ps1" -ForegroundColor DarkYellow
    }
    Write-Host "  Version: $($resp.version)"
    Write-Host "  Toolsets: $($resp.toolsets)"
  } catch {
    Write-Host "  [!!] JARVIS status API unavailable: $($_.Exception.Message)" -ForegroundColor Red
  }
}

function Check-ServerStatus {
  Write-Host ""
  Write-Host "  [..] Checking JARVIS Server status..." -ForegroundColor Yellow

  try {
    $resp = Invoke-WebRequest -Uri "$API_URL/memories" -TimeoutSec 3 -ErrorAction Stop
    if ($resp.StatusCode -eq 200) {
      Write-Host "  [OK] JARVIS Server is ONLINE and responding." -ForegroundColor Green
      $data = $resp.Content | ConvertFrom-Json
      $memCount = $data.memories.Count
      Write-Host "  [OK] Memory bank loaded: $memCount stored memories." -ForegroundColor Cyan
    }
  } catch {
    Write-Host "  [!!] JARVIS Server is OFFLINE or not responding." -ForegroundColor Red
    Write-Host "       Start the server using Option [1]." -ForegroundColor DarkYellow
  }
}

function Show-Memories {
  Write-Host ""
  Write-Host "  JARVIS LONG-TERM MEMORY BANK" -ForegroundColor Cyan
  Write-Host "  ---------------------------------------------------------"

  if (-not (Test-Path $MEM_FILE)) {
    Write-Host "  [!] memories.json not found." -ForegroundColor DarkYellow
    return
  }

  $memData = Get-Content $MEM_FILE | ConvertFrom-Json
  $memories = $memData.memories

  if ($memories.Count -eq 0) {
    Write-Host "  [!] Memory bank is empty." -ForegroundColor DarkYellow
  } else {
    $i = 1
    foreach ($m in $memories) {
      Write-Host ("  [{0:D2}] {1}" -f $i, $m) -ForegroundColor White
      $i++
    }
  }
  Write-Host ""
  Write-Host "  Total memories: $($memories.Count)" -ForegroundColor DarkCyan
}

function Add-Memory {
  Write-Host ""
  Write-Host "  ADD MEMORY TO JARVIS" -ForegroundColor Cyan
  Write-Host "  ---------------------------------------------------------"
  Write-Host "  Enter the detail/fact you want JARVIS to remember:" -ForegroundColor Yellow
  $detail = Read-Host "  > "

  if ([string]::IsNullOrWhiteSpace($detail)) {
    Write-Host "  [!] Empty input. Memory not saved." -ForegroundColor DarkYellow
    return
  }

  # Try via API first, then write directly to file
  try {
    $body = @{ detail = $detail } | ConvertTo-Json
    $resp = Invoke-RestMethod -Uri "$API_URL/chat" -Method POST `
      -ContentType "application/json" `
      -Body $body -ErrorAction Stop
    Write-Host "  [OK] Memory added via API." -ForegroundColor Green
  } catch {
    # Fallback: write directly to memories.json
    $memData = if (Test-Path $MEM_FILE) {
      Get-Content $MEM_FILE | ConvertFrom-Json
    } else {
      [PSCustomObject]@{ memories = @() }
    }

    $memList = [System.Collections.Generic.List[string]]($memData.memories)
    if (-not $memList.Contains($detail)) {
      $memList.Add($detail)
    }

    $memData.memories = $memList.ToArray()
    $memData | ConvertTo-Json -Depth 5 | Set-Content $MEM_FILE -Encoding UTF8
    Write-Host "  [OK] Memory saved directly to bank: `"$detail`"" -ForegroundColor Green
  }
}

function Clear-Memories {
  Write-Host ""
  Write-Host "  CLEAR ALL JARVIS MEMORIES" -ForegroundColor Red
  Write-Host "  ---------------------------------------------------------"
  Write-Host "  [!]  WARNING: This will delete ALL memories from JARVIS!" -ForegroundColor Red
  Write-Host "       This action cannot be undone." -ForegroundColor DarkYellow
  $confirm = Read-Host "  Type CONFIRM to proceed"

  if ($confirm -eq "CONFIRM") {
    $fresh = @{ memories = @("The user's name is Aayush.") } | ConvertTo-Json
    $fresh | Set-Content $MEM_FILE -Encoding UTF8
    Write-Host "  [OK] Memory bank cleared. Aayush's identity re-seeded." -ForegroundColor Green
  } else {
    Write-Host "  [--] Operation cancelled." -ForegroundColor DarkCyan
  }
}

function Show-ServerLogs {
  Write-Host ""
  Write-Host "  JARVIS SERVER LOG (last 30 lines)" -ForegroundColor Cyan
  Write-Host "  ---------------------------------------------------------"
  if (Test-Path $LOG_FILE) {
    Get-Content $LOG_FILE -Tail 30 | ForEach-Object {
      if ($_ -match "ERROR|FAIL|error") {
        Write-Host "  $_" -ForegroundColor Red
      } elseif ($_ -match "ONLINE|OK|SUCCESS|started") {
        Write-Host "  $_" -ForegroundColor Green
      } else {
        Write-Host "  $_" -ForegroundColor DarkGray
      }
    }
  } else {
    Write-Host "  [!] No log file found. Start JARVIS first." -ForegroundColor DarkYellow
  }
}

function Open-Browser {
  Write-Host ""
  Write-Host "  [..] Opening JARVIS interface in browser..." -ForegroundColor Yellow
  Start-Process $SERVER_URL
  Write-Host "  [OK] Browser launched." -ForegroundColor Green
}

function Install-Dependencies {
  Write-Host ""
  Write-Host "  [..] Running npm install in: $JARVIS_DIR" -ForegroundColor Yellow
  Push-Location $JARVIS_DIR
  npm install
  Pop-Location
  Write-Host "  [OK] Dependencies installed/updated." -ForegroundColor Green
}

function Quick-SystemCheck {
  Write-Host ""
  Write-Host "  JARVIS QUICK SYSTEM CHECK" -ForegroundColor Cyan
  Write-Host "  ---------------------------------------------------------"

  # Node.js
  try {
    $nodeVer = node -v 2>$null
    Write-Host "  [OK] Node.js:       $nodeVer" -ForegroundColor Green
  } catch {
    Write-Host "  [!!] Node.js:       NOT FOUND" -ForegroundColor Red
  }

  # npm
  try {
    $npmVer = npm -v 2>$null
    Write-Host "  [OK] npm:           v$npmVer" -ForegroundColor Green
  } catch {
    Write-Host "  [!!] npm:           NOT FOUND" -ForegroundColor Red
  }

  # node_modules
  if (Test-Path (Join-Path $JARVIS_DIR "node_modules")) {
    Write-Host "  [OK] node_modules:  Present" -ForegroundColor Green
  } else {
    Write-Host "  [!!] node_modules:  MISSING — run option [10]" -ForegroundColor Red
  }

  # server.js
  if (Test-Path (Join-Path $JARVIS_DIR "server.js")) {
    Write-Host "  [OK] server.js:     Found" -ForegroundColor Green
  } else {
    Write-Host "  [!!] server.js:     MISSING" -ForegroundColor Red
  }

  # memories.json
  if (Test-Path $MEM_FILE) {
    $memData = Get-Content $MEM_FILE | ConvertFrom-Json
    Write-Host "  [OK] memories.json: Found ($($memData.memories.Count) memories)" -ForegroundColor Green
  } else {
    Write-Host "  [!!] memories.json: MISSING" -ForegroundColor DarkYellow
  }

  # Server alive
  try {
    $resp = Invoke-WebRequest -Uri "$API_URL/memories" -TimeoutSec 2 -ErrorAction Stop
    Write-Host "  [OK] Server status: ONLINE at $SERVER_URL" -ForegroundColor Green
  } catch {
    Write-Host "  [--] Server status: OFFLINE" -ForegroundColor DarkYellow
  }

  # System resources
  $cpu = (Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average
  $os = Get-CimInstance Win32_OperatingSystem
  $ramTotal = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  $ramFree  = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
  $ramUsed  = [math]::Round($ramTotal - $ramFree, 1)
  Write-Host ("  [OK] CPU Load:      {0}%" -f $cpu) -ForegroundColor DarkCyan
  Write-Host ("  [OK] RAM:           {0} GB used / {1} GB total" -f $ramUsed, $ramTotal) -ForegroundColor DarkCyan
}

##############################################################
# MAIN LOOP
##############################################################
Show-Banner
Write-Host "  Welcome, Aayush. JARVIS Integration Hub is ready." -ForegroundColor Cyan
Write-Host ""

do {
  Show-Menu
  $choice = Read-Host "  Enter your choice"

  switch ($choice) {
    "1" {
      Start-JarvisServer
      Start-Sleep -Seconds 1
      Open-Browser
    }
    "2" { Stop-JarvisServer }
    "3" {
      Stop-JarvisServer
      Start-Sleep -Seconds 1
      Start-JarvisServer
    }
    "4" { Check-ServerStatus }
    "5" { Show-Memories }
    "6" { Add-Memory }
    "7" { Clear-Memories }
    "8" { Show-ServerLogs }
    "9" { Open-Browser }
    "10" { Install-Dependencies }
    "11" { Check-HermesStatus }
    "12" { Quick-SystemCheck }
    "0" {
      Write-Host ""
      Write-Host "  Shutting down JARVIS Integration Hub. Goodbye, Aayush." -ForegroundColor DarkCyan
      Write-Host ""
      exit
    }
    default {
      Write-Host "  [!] Invalid choice. Please select a valid option." -ForegroundColor DarkYellow
    }
  }

  Write-Host ""
  Write-Host "  Press any key to return to menu..." -ForegroundColor DarkGray
  $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

} while ($true)
