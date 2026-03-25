# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

backend_root = Path.cwd()
data_file = backend_root / "data" / "strategy_model.json"

datas = []
if data_file.exists():
    datas.append((str(data_file), "data"))

hiddenimports = [
    # uvicorn core
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "uvicorn.config",
    "uvicorn.main",
    # FastAPI / Starlette
    "fastapi",
    "fastapi.middleware.cors",
    "starlette",
    "starlette.routing",
    "starlette.middleware.cors",
    "starlette.staticfiles",
    "starlette.responses",
    "starlette.websockets",
    # Pydantic v2
    "pydantic",
    "pydantic.v1",
    # Async runtime
    "anyio",
    "anyio._backends._asyncio",
    "anyio._backends._trio",
    "sniffio",
    # HTTP / WebSocket transport
    "h11",
    "websockets",
    "websockets.legacy",
    "websockets.legacy.server",
    "websockets.legacy.client",
    # HTTP tools (optional but prevent ImportError at runtime)
    "httptools",
    "httptools.parser",
    # Email-validator (used by Pydantic internally)
    "email_validator",
]

a = Analysis(
    ["src/pitwall_desktop_entry.py"],
    pathex=[str(backend_root / "src")],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="pitwall-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
