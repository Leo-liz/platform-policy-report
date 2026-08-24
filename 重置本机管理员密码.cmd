@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\reset-local-admin-password.ps1"
if errorlevel 1 (
  echo.
  echo Password reset failed. Keep this error text for Codex diagnosis.
)
pause
