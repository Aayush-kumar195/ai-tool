$ErrorActionPreference = 'Continue'
$base = 'http://127.0.0.1:3000/api'
Write-Host '=== JARVIS Windows Doctor ===' -ForegroundColor Cyan

Write-Host "`n[Node]" -ForegroundColor Yellow
node --version
npm --version

Write-Host "`n[Hermes]" -ForegroundColor Yellow
$hermes = Get-Command hermes -ErrorAction SilentlyContinue
$hermesPath = if ($hermes) { $hermes.Source } else { $null }
if (-not $hermesPath) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.exe'),
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.cmd'),
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.bat')
  )
  $candidate = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($candidate) { $hermesPath = $candidate }
}
if ($hermesPath) {
  & $hermesPath --version
  & $hermesPath computer-use status
} else {
  Write-Host 'Hermes: NOT FOUND' -ForegroundColor Red
}

Write-Host "`n[JARVIS API]" -ForegroundColor Yellow
try {
  $health = Invoke-RestMethod "$base/health" -TimeoutSec 5
  $health | ConvertTo-Json -Depth 6
} catch { Write-Host "JARVIS health unavailable: $($_.Exception.Message)" -ForegroundColor Red }

try {
  $hs = Invoke-RestMethod "$base/hermes/status" -TimeoutSec 15
  $hs | ConvertTo-Json -Depth 8
} catch { Write-Host "Hermes status unavailable through JARVIS: $($_.Exception.Message)" -ForegroundColor Red }

try {
  $as = Invoke-RestMethod "$base/activity/state" -TimeoutSec 5
  $as | ConvertTo-Json -Depth 8
} catch { Write-Host "Activity state unavailable: $($_.Exception.Message)" -ForegroundColor Red }

try {
  $ps = Invoke-RestMethod "$base/activity/processes" -TimeoutSec 8
  Write-Host "Running process count: $($ps.count)" -ForegroundColor Green
  Write-Host "Foreground: $($ps.currentForeground.app) — $($ps.currentForeground.title)"
} catch { Write-Host "Process snapshot unavailable: $($_.Exception.Message)" -ForegroundColor Red }

Write-Host "`nDoctor complete." -ForegroundColor Cyan
