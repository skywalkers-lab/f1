
#!/bin/bash
# F1 25 Pit Wall — Backend Server
# UDP telemetry listener on 0.0.0.0:20777 (configurable via PITWALL_UDP_PORT)
# WebSocket + HTTP API on 0.0.0.0:8765
#
# Usage:
#   ./run_server.sh                          # default
#   PITWALL_UDP_PORT=20888 ./run_server.sh   # custom UDP port

set -e
cd "$(dirname "$0")/backend"

if [ ! -d .venv ]; then
  echo "[pitwall] Creating Python virtual environment..."
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -e ".[dev]" --quiet
else
  source .venv/bin/activate
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║          F1 25  PIT WALL  BACKEND                ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  HTTP/WS  : http://0.0.0.0:8765                 ║"
echo "║  UDP Port : ${PITWALL_UDP_PORT:-20777} (PITWALL_UDP_PORT)              ║" 
echo "║  Frontend : http://localhost:5173                ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

uvicorn pitwall.main:app --reload --host 0.0.0.0 --port 8765