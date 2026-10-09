$ErrorActionPreference = 'Stop'
Write-Host '=== JARVIS / Hermes -> Ollama/Gemma Configuration ===' -ForegroundColor Cyan

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'

function Read-DotEnvValue([string]$key, [string]$defaultValue) {
  if (-not (Test-Path -LiteralPath $envFile)) { return $defaultValue }
  foreach ($raw in Get-Content -LiteralPath $envFile) {
    $line = $raw.Trim()
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) { continue }
    $index = $line.IndexOf('=')
    if ($index -le 0) { continue }
    $name = $line.Substring(0, $index).Trim()
    if ($name -ne $key) { continue }
    $value = $line.Substring($index + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      if ($value.Length -ge 2) { $value = $value.Substring(1, $value.Length - 2) }
    }
    return $value
  }
  return $defaultValue
}

function Find-Hermes {
  $cmd = Get-Command hermes -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Path }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.exe'),
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.cmd'),
    (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.bat')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

function Get-HermesConfigValue([string]$hermesPath, [string]$key) {
  try {
    $output = & $hermesPath config get $key --raw 2>$null
    if ($LASTEXITCODE -eq 0) { return (($output -join "`n").Trim()) }
  } catch {}
  return ''
}

$hermesPath = Find-Hermes
if (-not $hermesPath) { throw 'Hermes was not found. Run npm run hermes:install first.' }

$null = & $hermesPath --version
if ($LASTEXITCODE -ne 0) { throw "Hermes executable could not be started: $hermesPath" }

$model = Read-DotEnvValue 'HERMES_MODEL' (Read-DotEnvValue 'OLLAMA_MODEL' 'gemma4:e2b')
$provider = Read-DotEnvValue 'HERMES_PROVIDER' 'custom'
$baseUrl = Read-DotEnvValue 'HERMES_BASE_URL' ''
if (-not $baseUrl) {
  $ollamaBase = Read-DotEnvValue 'OLLAMA_BASE_URL' 'http://127.0.0.1:11434'
  $baseUrl = $ollamaBase.TrimEnd('/') + '/v1'
}
$contextLength = Read-DotEnvValue 'HERMES_CONTEXT_LENGTH' '65536'
$ollamaNumCtx = Read-DotEnvValue 'HERMES_OLLAMA_NUM_CTX' '65536'
$allowCloudFallback = (Read-DotEnvValue 'HERMES_ALLOW_CLOUD_FALLBACK' 'false').ToLowerInvariant() -eq 'true'

if ($provider -notin @('custom','ollama','vllm','llamacpp','llama.cpp')) {
  throw "HERMES_PROVIDER '$provider' is not a supported local provider for this JARVIS setup. Use custom or ollama."
}
if ([int64]$contextLength -lt 64000) { throw 'HERMES_CONTEXT_LENGTH must be at least 64000.' }
if ([int64]$ollamaNumCtx -lt 64000) { throw 'HERMES_OLLAMA_NUM_CTX must be at least 64000.' }

$current = @{
  'model.default' = Get-HermesConfigValue $hermesPath 'model.default'
  'model.provider' = Get-HermesConfigValue $hermesPath 'model.provider'
  'model.base_url' = Get-HermesConfigValue $hermesPath 'model.base_url'
  'model.context_length' = Get-HermesConfigValue $hermesPath 'model.context_length'
  'model.ollama_num_ctx' = Get-HermesConfigValue $hermesPath 'model.ollama_num_ctx'
}
$desired = @{
  'model.default' = $model
  'model.provider' = $provider
  'model.base_url' = $baseUrl.TrimEnd('/')
  'model.context_length' = [string]$contextLength
  'model.ollama_num_ctx' = [string]$ollamaNumCtx
}

$changes = @($desired.Keys | Where-Object { $current[$_] -ne $desired[$_] })

function Clear-PrimaryFallbackIfLocalOnly([string]$hermesExecutable, [bool]$allowCloud) {
  if ($allowCloud) {
    Write-Host '[WARN] Cloud fallback is explicitly enabled by HERMES_ALLOW_CLOUD_FALLBACK=true.' -ForegroundColor Yellow
    return
  }

  Write-Host '[..] Clearing Hermes primary fallback chain to keep this installation local-only...' -ForegroundColor Yellow
  & $hermesExecutable fallback clear
  if ($LASTEXITCODE -ne 0) {
    throw 'Hermes fallback chain could not be cleared. Local-only mode refuses to continue without explicit confirmation.'
  }
  Write-Host '[OK] Hermes primary fallback chain is empty (local-only).' -ForegroundColor DarkGreen
}

if ($changes.Count -eq 0) {
  Write-Host '[OK] Hermes model configuration already matches local Ollama/Gemma.' -ForegroundColor Green
  & $hermesPath config check
  if ($LASTEXITCODE -ne 0) { throw 'Hermes configuration check failed before applying local-only fallback policy.' }
  Clear-PrimaryFallbackIfLocalOnly $hermesPath $allowCloudFallback
  & $hermesPath config check
  if ($LASTEXITCODE -ne 0) { throw 'Hermes configuration check failed after applying the local-only fallback policy.' }
  exit 0
}

$configPath = ''
try { $configPath = (& $hermesPath config path 2>$null | Select-Object -First 1).Trim() } catch {}
if ($configPath -and (Test-Path -LiteralPath $configPath)) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = "$configPath.jarvis-backup-$stamp"
  Copy-Item -LiteralPath $configPath -Destination $backup -Force
  Write-Host "[OK] Backed up existing Hermes config to $backup" -ForegroundColor DarkGreen
}

foreach ($key in $changes) {
  Write-Host "[SET] $key = $($desired[$key])" -ForegroundColor Yellow
  & $hermesPath config set $key $desired[$key]
  if ($LASTEXITCODE -ne 0) { throw "Hermes rejected config key '$key'. If configuration is administrator-managed, update the managed file instead." }
}

& $hermesPath config check
if ($LASTEXITCODE -ne 0) { throw 'Hermes configuration check failed after applying the local Ollama configuration.' }

Clear-PrimaryFallbackIfLocalOnly $hermesPath $allowCloudFallback
& $hermesPath config check
if ($LASTEXITCODE -ne 0) { throw 'Hermes configuration check failed after applying the local-only fallback policy.' }

Write-Host '[OK] Hermes now targets the local Ollama/Gemma model.' -ForegroundColor Green
