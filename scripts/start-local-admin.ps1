[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 4317,
  [switch]$Background
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$privateEnvFile = Join-Path $repoRoot ".env.admin.local"

function Resolve-NodeCommand {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $fallback = Join-Path $env:USERPROFILE ".codex\tools\node-portable\node.exe"
  if (Test-Path -LiteralPath $fallback) {
    return $fallback
  }

  throw "Node.js was not found. Restore the Codex Node.js runtime and retry."
}

if (-not (Test-Path -LiteralPath $privateEnvFile)) {
  throw ".env.admin.local is missing. Run the one-time local admin setup before starting this service."
}

function Test-LocalAdminReady {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    return $response.StatusCode -eq 200
  }
  catch {
    return $false
  }
}

Push-Location $repoRoot
try {
  $localUrl = "http://localhost:$Port/admin/notifications"
  if (Test-LocalAdminReady -Url $localUrl) {
    Write-Host "Local notification admin is already running: $localUrl" -ForegroundColor Green
    return
  }

  $node = Resolve-NodeCommand
  $env:LOCAL_ADMIN_PORT = "$Port"

  if ($Background) {
    $logDirectory = Join-Path $repoRoot "logs"
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $stdoutPath = Join-Path $logDirectory "local-admin.stdout.log"
    $stderrPath = Join-Path $logDirectory "local-admin.stderr.log"
    $serverScript = Join-Path $PSScriptRoot "local-admin-server.mjs"
    $process = Start-Process -FilePath $node `
      -ArgumentList @("`"$serverScript`"") `
      -WorkingDirectory $repoRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -PassThru

    for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
      if (Test-LocalAdminReady -Url $localUrl) {
        Write-Host "Local notification admin started in background: $localUrl" -ForegroundColor Green
        return
      }
      if ($process.HasExited) {
        throw "The local admin service exited unexpectedly (exit=$($process.ExitCode)). See $stderrPath"
      }
      Start-Sleep -Milliseconds 500
    }
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "The local admin service did not become ready within 15 seconds. See $stderrPath"
  }

  Write-Host ""
  Write-Host "Local notification admin: $localUrl" -ForegroundColor Green
  Write-Host "Keep this window open. Press Ctrl+C when configuration is complete."
  Write-Host "The service listens on 127.0.0.1 only."
  Write-Host ""

  & $node (Join-Path $PSScriptRoot "local-admin-server.mjs")
  if ($LASTEXITCODE -ne 0) {
    throw "The local admin service exited unexpectedly (exit=$LASTEXITCODE)."
  }
}
finally {
  Pop-Location
}
