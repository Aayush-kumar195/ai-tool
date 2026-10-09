$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:3000/api'
Write-Host '=== JARVIS end-to-end Windows smoke test ===' -ForegroundColor Cyan

function Get-Api($path) { Invoke-RestMethod "$base$path" -TimeoutSec 15 }

$health = Get-Api '/health'
if (-not $health.success) { throw 'Health check failed.' }
Write-Host '[PASS] health' -ForegroundColor Green

$hs = Get-Api '/hermes/status'
if (-not $hs.installed) { throw 'Hermes is not installed.' }
Write-Host "[PASS] Hermes installed: $($hs.version)" -ForegroundColor Green
if (-not $hs.computerUseReady) { throw 'Hermes Computer Use is not ready.' }
Write-Host '[PASS] Computer Use ready' -ForegroundColor Green

$activity = Get-Api '/activity/state'
Write-Host "[PASS] Activity agent online=$($activity.state.online), foreground=$($activity.state.foreground.app)" -ForegroundColor Green

$apps = Get-Api '/activity/installed-apps'
Write-Host "[PASS] Installed app snapshot: $($apps.count) entries" -ForegroundColor Green

$procs = Get-Api '/activity/processes'
Write-Host "[PASS] Process snapshot: $($procs.count) processes" -ForegroundColor Green

Write-Host "`nSmoke test passed. Run the actual user-task matrix from TEST_MATRIX.md next." -ForegroundColor Cyan
