[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = Join-Path $env:USERPROFILE ".codex\tools\node-portable\node.exe"
}
if (-not (Test-Path -LiteralPath $node)) {
  throw "Node.js was not found."
}

$secure = Read-Host "Enter the new local administrator password (minimum 12 characters)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ($plain.Length -lt 12) {
    throw "The administrator password must contain at least 12 characters."
  }
  $env:LOCAL_ADMIN_NEW_PASSWORD = $plain
  Push-Location $repoRoot
  try {
    & $node (Join-Path $PSScriptRoot "configure-local-admin.mjs") reset-password-env
    if ($LASTEXITCODE -ne 0) { throw "Password update failed." }
  }
  finally {
    Pop-Location
  }
}
finally {
  Remove-Item Env:LOCAL_ADMIN_NEW_PASSWORD -ErrorAction SilentlyContinue
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $plain = $null
}

Write-Host "The administrator password was updated. Restart the local notification configuration service." -ForegroundColor Green
