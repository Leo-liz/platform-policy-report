@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local-admin.ps1"
if errorlevel 1 (
  echo.
  echo Startup failed. Keep the error text in this window for Codex diagnosis.
  pause
)
