$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$failures = @()
function Check([string]$label, [scriptblock]$action) {
  Write-Host "`n[$label]" -ForegroundColor Cyan
  & $action
  if ($LASTEXITCODE -ne 0) {
    $script:failures += $label
    Write-Host "[FAIL] $label" -ForegroundColor Red
  } else {
    Write-Host "[PASS] $label" -ForegroundColor Green
  }
}

Write-Host '=== JARVIS FINAL LOCAL/Windows AUDIT ===' -ForegroundColor Cyan
Write-Host "Project: $projectRoot"

Check 'Node' { node --version }
Check 'npm' { npm --version }
Check 'JARVIS syntax' { node --check .\server.js; node --check .\hermes-bridge.js }
Check 'Dependency-free regression suite' { npm test }
Check 'Ollama installed' { ollama --version }
Check 'Gemma 4 E2B available' { ollama list | Select-String -SimpleMatch 'gemma4:e2b' | Out-Null; if ($?) { exit 0 } else { exit 1 } }
Check 'Hermes installed' { hermes --version }
Check 'Hermes model configuration' {
  $model = (& hermes config get model.default --raw 2>$null).Trim()
  $provider = (& hermes config get model.provider --raw 2>$null).Trim()
  $baseUrl = (& hermes config get model.base_url --raw 2>$null).Trim().TrimEnd('/')
  $context = (& hermes config get model.context_length --raw 2>$null).Trim()
  $ollamaNumCtx = (& hermes config get model.ollama_num_ctx --raw 2>$null).Trim()
  Write-Host "model=$model`nprovider=$provider`nbase_url=$baseUrl`ncontext_length=$context`nollama_num_ctx=$ollamaNumCtx"
  if ($model -ne 'gemma4:e2b') { exit 1 }
  if ($provider -notin @('custom','ollama','vllm','llamacpp','llama.cpp')) { exit 1 }
  if ($baseUrl -ne 'http://127.0.0.1:11434/v1') { exit 1 }
  if ([int64]$context -lt 64000) { exit 1 }
  if ([int64]$ollamaNumCtx -lt 64000) { exit 1 }
  exit 0
}
Check 'Hermes configuration check' { hermes config check }
Check 'Hermes Computer Use doctor' {
  $json = & hermes computer-use doctor --json 2>$null
  $parsed = $json | ConvertFrom-Json
  $parsed | ConvertTo-Json -Depth 8
  if (-not ($parsed.ok -eq $true -or "$($parsed.overall)".ToLowerInvariant() -eq 'ok')) { exit 1 }
  exit 0
}
Check 'Hermes primary fallback chain is empty by default' {
  $envFile = Join-Path $projectRoot '.env'
  $allowCloud = $false
  if (Test-Path -LiteralPath $envFile) {
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*HERMES_ALLOW_CLOUD_FALLBACK\s*=' } | Select-Object -First 1
    if ($line) { $allowCloud = ($line -split '=', 2)[1].Trim().Trim('"', "'").ToLowerInvariant() -eq 'true' }
  }
  if ($allowCloud) {
    Write-Warning 'HERMES_ALLOW_CLOUD_FALLBACK=true; intentionally skipping local-only fallback assertion.'
    exit 0
  }
  $output = (& hermes fallback list 2>&1) -join "`n"
  Write-Host $output
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  if ($output -notmatch 'No fallback providers configured') { exit 1 }
  exit 0
}

Write-Host "`n=== AUDIT SUMMARY ===" -ForegroundColor Cyan
if ($failures.Count -eq 0) {
  Write-Host 'ALL AUDIT CHECKS PASSED.' -ForegroundColor Green
  exit 0
}
Write-Host ('FAILED CHECKS: ' + ($failures -join ', ')) -ForegroundColor Red
exit 1
