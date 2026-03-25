$ErrorActionPreference = 'Stop'

Write-Host "[pitwall] Building backend executable..."
Set-Location "$PSScriptRoot/../../backend"

if (-not (Test-Path ".venv")) {
  Write-Host "[pitwall] Creating backend virtualenv..."
  py -3.11 -m venv .venv
}

$python = ".venv/Scripts/python.exe"

& $python -m pip install --upgrade pip
& $python -m pip install -e . pyinstaller

# Build one-file backend executable
& $python -m PyInstaller --noconfirm pitwall_backend.spec

$outDir = "../backend_dist"
if (-not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

Copy-Item -Force "dist/pitwall-backend.exe" "../backend_dist/pitwall-backend.exe"
Write-Host "[pitwall] Backend EXE ready: ../backend_dist/pitwall-backend.exe"
