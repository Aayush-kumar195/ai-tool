param(
  [switch]$RunYouTubeTest,
  [string]$YouTubeQuery = 'Daft Punk Get Lucky'
)

$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:3000/api'
$pass = 0
$fail = 0

function Test-Step([string]$Name, [scriptblock]$Action) {
  try {
    & $Action
    Write-Host "[PASS] $Name" -ForegroundColor Green
    $script:pass++
    return
  } catch {
    Write-Host "[FAIL] $Name :: $($_.Exception.Message)" -ForegroundColor Red
    $script:fail++
    return
  }
}

Write-Host '=== JARVIS + Hermes Windows Acceptance ===' -ForegroundColor Cyan
Write-Host "Target API: $base"

Test-Step 'Node.js available' { node --version | Out-Host }
Test-Step 'npm available' { npm --version | Out-Host }

$hermesPath = $null
try { $cmd = Get-Command hermes -ErrorAction Stop; $hermesPath = $cmd.Source } catch {}
if (-not $hermesPath) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.exe'),
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.cmd'),
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.bat')
  )
  $candidate = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($candidate) { $hermesPath = $candidate }
}
Test-Step 'Hermes installed' {
  if (-not $hermesPath) { throw 'Hermes executable not found.' }
  & $hermesPath --version | Out-Host
}
Test-Step 'Hermes Computer Use ready' {
  if (-not $hermesPath) { throw 'Hermes executable not found.' }
  & $hermesPath computer-use status | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Computer Use status returned a non-zero exit code.' }
}

Test-Step 'JARVIS health endpoint' {
  $x = Invoke-RestMethod "$base/health" -TimeoutSec 10
  if (-not $x.success) { throw 'Health endpoint returned success=false.' }
}

$hs = $null
Test-Step 'JARVIS sees Hermes + Computer Use' {
  $script:hs = Invoke-RestMethod "$base/hermes/status" -TimeoutSec 20
  if (-not $script:hs.installed) { throw 'JARVIS reports Hermes is not installed.' }
  if (-not $script:hs.computerUseReady) { throw 'JARVIS reports Computer Use is not ready.' }
}

$activity = $null
Test-Step 'Real-time activity agent online' {
  $script:activity = Invoke-RestMethod "$base/activity/state" -TimeoutSec 10
  if (-not $script:activity.success) { throw 'Activity endpoint returned success=false.' }
  if (-not $script:activity.state.online) { throw 'Activity agent is not reporting online.' }
}

Test-Step 'Background process scan returns data' {
  $x = Invoke-RestMethod "$base/activity/processes" -TimeoutSec 15
  if (-not $x.success) { throw 'Process endpoint returned success=false.' }
  if ([int]$x.count -lt 1) { throw 'No running processes were returned.' }
  Write-Host "      Processes: $($x.count) | Foreground: $($x.currentForeground.app) — $($x.currentForeground.title)" -ForegroundColor DarkGray
}

Test-Step 'Installed application scan returns data' {
  $x = Invoke-RestMethod "$base/activity/installed-apps" -TimeoutSec 20
  if (-not $x.success) { throw 'Installed-app endpoint returned success=false.' }
  if ([int]$x.count -lt 1) { throw 'No installed apps were returned.' }
  Write-Host "      Installed apps: $($x.count)" -ForegroundColor DarkGray
}

Test-Step 'Downloads folder action' {
  $x = Invoke-RestMethod "$base/action" -Method Post -ContentType 'application/json' -Body (@{action='open-path';value='downloads'} | ConvertTo-Json) -TimeoutSec 15
  if (-not $x.success) { throw $x.output }
}

Test-Step 'Calculator app action' {
  $x = Invoke-RestMethod "$base/action" -Method Post -ContentType 'application/json' -Body (@{action='open-app';value='calculator'} | ConvertTo-Json) -TimeoutSec 15
  if (-not $x.success) { throw $x.output }
}

Test-Step 'Filesystem search endpoint' {
  $x = Invoke-RestMethod "$base/files/search" -Method Post -ContentType 'application/json' -Body (@{query='desktop';maxResults=5} | ConvertTo-Json) -TimeoutSec 20
  if (-not $x.success) { throw $x.error }
}

if ($RunYouTubeTest) {
  Test-Step "Real YouTube playback task: $YouTubeQuery" {
    $x = Invoke-RestMethod "$base/agent/task" -Method Post -ContentType 'application/json' -Body (@{task="Play the requested YouTube media now: '$YouTubeQuery'. Use the actual desktop UI. Search YouTube, choose the best matching result, start playback, and verify that the video player is actively playing. Do not merely open the search page."} | ConvertTo-Json -Depth 5) -TimeoutSec 620
    if (-not $x.success) { throw $x.error }
    $toolNames = @($x.toolUses | ForEach-Object { if ($_ -is [string]) { $_ } elseif ($_ -and $_.name) { $_.name } })
    if ($toolNames -notcontains 'computer_use') { throw 'Hermes did not report a computer_use tool call.' }
    $playbackVerified = $x.text -match '(?i)(actively\s+playing|playback\s+(has\s+)?started|now\s+playing|is\s+playing|player\s+is\s+playing|playing\s+now)' -and
      $x.text -notmatch '(?i)(could\s+not|couldn''t|unable|blocked|failed|not\s+playing|did\s+not\s+start|cannot)'
    if (-not $playbackVerified) { throw "Hermes returned a task result without positive playback verification: $($x.text)" }
    Write-Host "      Hermes result: $($x.text)" -ForegroundColor DarkGray
  }
} else {
  Write-Host '[SKIP] Real YouTube playback test (rerun with -RunYouTubeTest).' -ForegroundColor Yellow
}

Write-Host "`n=== Result ===" -ForegroundColor Cyan
Write-Host "Passed: $pass" -ForegroundColor Green
Write-Host "Failed: $fail" -ForegroundColor $(if($fail){'Red'}else{'Green'})
if ($fail) { exit 1 } else { exit 0 }
