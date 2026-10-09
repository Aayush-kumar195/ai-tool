$ErrorActionPreference = 'Continue'
Write-Host '=== Repair Hermes Computer Use ===' -ForegroundColor Cyan
$hermesCommand = Get-Command hermes -ErrorAction SilentlyContinue
$hermesPath = if ($hermesCommand) { $hermesCommand.Source } else { $null }
if (-not $hermesPath) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.exe'),
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.cmd'),
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.bat')
  )
  $candidate = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($candidate) { $hermesPath = $candidate }
}
if (-not $hermesPath) {
  Write-Host 'Hermes is not installed. Running installer...' -ForegroundColor Yellow
  & "$PSScriptRoot\install-hermes.ps1"
  exit $LASTEXITCODE
}
& $hermesPath computer-use install
& $hermesPath computer-use doctor
