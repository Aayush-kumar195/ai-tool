$ErrorActionPreference = 'Stop'
Write-Host "=== JARVIS / Hermes Agent Installer ===" -ForegroundColor Cyan

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') {
  throw 'This installer is intended for native Windows.'
}

Write-Host '[1/4] Installing Hermes Agent (official installer)...' -ForegroundColor Yellow
$installer = Invoke-RestMethod -Uri 'https://hermes-agent.nousresearch.com/install.ps1'
& ([scriptblock]::Create($installer))

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$env:Path = (($userPath, $machinePath) | Where-Object { $_ } | Select-Object -Unique) -join ';'

$hermesCommand = Get-Command hermes -ErrorAction SilentlyContinue
$hermesPath = if ($hermesCommand) { $hermesCommand.Source } else { $null }
if (-not $hermesPath) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.exe'),
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.cmd'),
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.bat')
  )
  $candidate = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($candidate) {
    $hermesPath = $candidate
    $env:Path = "$(Split-Path $candidate);$env:Path"
  }
}
if (-not $hermesPath) {
  throw 'Hermes was installed but the executable could not be located. Close this terminal, open a new PowerShell window, then run this script again.'
}

Write-Host "[2/4] Hermes found: $hermesPath" -ForegroundColor Green
& $hermesPath --version

Write-Host '[3/4] Installing / repairing Computer Use runtime...' -ForegroundColor Yellow
& $hermesPath computer-use install

Write-Host '[4/4] Running Computer Use diagnostics...' -ForegroundColor Yellow
& $hermesPath computer-use status
try { & $hermesPath computer-use doctor } catch { Write-Warning $_ }

Write-Host "`nHermes installation step finished." -ForegroundColor Green
Write-Host 'Open a NEW PowerShell window before starting JARVIS.' -ForegroundColor Cyan
