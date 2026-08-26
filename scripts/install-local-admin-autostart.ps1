[CmdletBinding()]
param(
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $PSScriptRoot "start-local-admin.ps1"
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "平台政策通知配置后台服务.lnk"

if ($Uninstall) {
  Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
  Write-Host "Local notification admin autostart removed." -ForegroundColor Yellow
  return
}

if (-not (Test-Path -LiteralPath $startScript)) {
  throw "Local admin start script is missing: $startScript"
}

$powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powerShell
$shortcut.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.WindowStyle = 7
$shortcut.Description = "平台政策抓取通知配置本机后台服务（仅监听 127.0.0.1）"
$shortcut.Save()

$localUrl = "http://localhost:4317/admin/notifications"
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $localUrl -TimeoutSec 2
}
catch {
  # Ask the existing Windows shell to launch the shortcut.  Explorer owns the
  # long-running hidden PowerShell/Node process, so it is not tied to the
  # installer or Codex command lifetime.
  Start-Process -FilePath explorer.exe -ArgumentList @("`"$shortcutPath`"") -WindowStyle Hidden
  $response = $null
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $localUrl -TimeoutSec 2
      if ($response.StatusCode -eq 200) { break }
    }
    catch {
      $response = $null
    }
  }
}
if (-not $response -or $response.StatusCode -ne 200) {
  throw "Local notification admin did not become ready after the scheduled task started."
}

Write-Host "Local notification admin autostart installed for the current Windows user." -ForegroundColor Green
Write-Host "Startup shortcut: $shortcutPath"
Write-Host "Admin URL: $localUrl"
