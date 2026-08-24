[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 4317
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

Push-Location $repoRoot
try {
  $localUrl = "http://localhost:$Port/admin/notifications"

  Write-Host ""
  Write-Host "Local notification admin: $localUrl" -ForegroundColor Green
  Write-Host "Keep this window open. Press Ctrl+C when configuration is complete."
  Write-Host "The service listens on 127.0.0.1 only."
  Write-Host ""

  $node = Resolve-NodeCommand
  $env:LOCAL_ADMIN_PORT = "$Port"
  & $node (Join-Path $PSScriptRoot "local-admin-server.mjs")
  if ($LASTEXITCODE -ne 0) {
    throw "The local admin service exited unexpectedly (exit=$LASTEXITCODE)."
  }
}
finally {
  Pop-Location
}
