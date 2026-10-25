$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $projectRoot 'app'
$backendRoot = Join-Path $appRoot 'app\backend'
$sourceEntry = Join-Path $backendRoot 'src\server.js'
$packagedEntry = Join-Path $appRoot 'bindarr-server.exe'
$siteUrl = 'http://localhost:3001/'
$healthUrl = 'http://127.0.0.1:3001/api/health'
$stdoutLog = Join-Path $appRoot 'bindarr-server.log'
$stderrLog = Join-Path $appRoot 'bindarr-server-error.log'

function Test-BindarrHealth {
  try {
    $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    return $response.status -eq 'ok'
  } catch {
    return $false
  }
}

function Wait-BindarrHealth([int]$seconds = 45) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    if (Test-BindarrHealth) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

if (Test-BindarrHealth) {
  Write-Host 'Bindarr is already running. Opening it now.' -ForegroundColor Green
  Start-Process $siteUrl
  exit 0
}

$listeners = @(Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
  $ownerPid = $listeners[0].OwningProcess
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid" -ErrorAction SilentlyContinue
  $ownerName = if ($owner) { $owner.Name } else { "PID $ownerPid" }
  Write-Host "Port 3001 is already used by $ownerName, but it is not a healthy Bindarr server." -ForegroundColor Red
  Write-Host 'Close that program (or its old Bindarr process), then run this launcher again.' -ForegroundColor Yellow
  exit 1
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($node -and (Test-Path -LiteralPath $sourceEntry)) {
  # Prefer the checked-out source so every locally built change is what the
  # launcher actually runs. The packaged executable remains an offline fallback.
  Write-Host 'Starting Bindarr from the current project source...'
  # DB_PATH in this personal install is intentionally relative to backendRoot;
  # changing this working directory silently creates a second empty collection.
  Start-Process -FilePath $node.Source -ArgumentList @($sourceEntry) -WorkingDirectory $backendRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
} elseif (Test-Path -LiteralPath $packagedEntry) {
  Write-Host 'Node.js was not found; starting the packaged Bindarr server...'
  Start-Process -FilePath $packagedEntry -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
} else {
  Write-Host 'Bindarr server files were not found.' -ForegroundColor Red
  exit 1
}

if (-not (Wait-BindarrHealth 45)) {
  Write-Host 'Bindarr did not become ready within 45 seconds.' -ForegroundColor Red
  Write-Host "See: $stderrLog" -ForegroundColor Yellow
  if (Test-Path -LiteralPath $stderrLog) { Get-Content -LiteralPath $stderrLog -Tail 20 }
  exit 1
}

Write-Host 'Bindarr is ready. Opening it now.' -ForegroundColor Green
Start-Process $siteUrl
exit 0
