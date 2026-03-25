@echo off
setlocal

cd /d %~dp0
powershell -ExecutionPolicy Bypass -File "%~dp0build_one_exe.ps1"

if %errorlevel% neq 0 (
  echo [pitwall] build failed.
  exit /b %errorlevel%
)

echo [pitwall] build finished.
endlocal
