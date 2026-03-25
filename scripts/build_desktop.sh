#!/usr/bin/env bash
# Build the F1 PitWall desktop app (frontend + backend exe + Electron).
# Usage: ./scripts/build_desktop.sh [--portable-only]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[pitwall] Building desktop app..."

# ── 1. Frontend ──────────────────────────────────
echo "[pitwall] Step 1/3: Building frontend..."
cd "$ROOT/frontend"
npm install
VITE_BASE_PATH="./" npm run build

# ── 2. Backend executable ────────────────────────
echo "[pitwall] Step 2/3: Building backend executable..."
cd "$ROOT/backend"
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip
pip install -e . pyinstaller
python -m PyInstaller --noconfirm pitwall_backend.spec

mkdir -p "$ROOT/backend_dist"
if [ -f "dist/pitwall-backend.exe" ]; then
    cp -f "dist/pitwall-backend.exe" "$ROOT/backend_dist/"
elif [ -f "dist/pitwall-backend" ]; then
    cp -f "dist/pitwall-backend" "$ROOT/backend_dist/"
fi
deactivate

# ── 3. Electron ──────────────────────────────────
echo "[pitwall] Step 3/3: Building Electron app..."
cd "$ROOT/electron"
npm install

if [[ "${1:-}" == "--portable-only" ]]; then
    npx electron-builder --win portable
else
    npx electron-builder --win nsis portable
fi

echo ""
echo "[pitwall] Done! Outputs:"
ls -lh "$ROOT/electron/dist/"*.exe 2>/dev/null || echo "  (check electron/dist/ for build output)"
