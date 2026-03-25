import os
from pathlib import Path

import uvicorn


def _prepare_runtime_paths() -> None:
    """Ensure backend data paths are writable in packaged/runtime mode."""
    exe_dir = Path(os.path.abspath(os.path.dirname(__file__))).resolve()
    # In PyInstaller one-file mode, __file__ points into temp extraction dir.
    # Use current working directory for persistent runtime data.
    cwd = Path.cwd().resolve()
    data_dir = cwd / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "sessions").mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("PITWALL_RAW_LOG_PATH", str(data_dir / "raw_packets.log"))
    os.environ.setdefault("PITWALL_ML_MODEL_PATH", str(data_dir / "strategy_model.json"))


def main() -> None:
    _prepare_runtime_paths()
    host = os.getenv("PITWALL_HOST", os.getenv("PITWALL_WS_HOST", "127.0.0.1"))
    port = int(os.getenv("PITWALL_PORT", os.getenv("PITWALL_WS_PORT", "8765")))
    uvicorn.run("pitwall.main:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
