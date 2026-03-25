$ErrorActionPreference = 'Stop'

Write-Host "[pitwall] One-click desktop build started"
Set-Location "$PSScriptRoot/../../frontend"
npm install
npm run build

Set-Location "$PSScriptRoot"
./build_backend_exe.ps1

Set-Location "$PSScriptRoot/../../electron"
npm install
npm run build:portable:win

Write-Host "[pitwall] Done. Portable EXE is in electron/dist"
