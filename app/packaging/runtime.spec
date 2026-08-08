# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller recipe for the FastAPI + React + WebView runtime."""

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules


APP_ROOT = Path(SPECPATH).parent
ICON_FILE = APP_ROOT / "packaging" / "assets" / "animesoul.ico"
# Hidden imports are collected before Analysis applies ``pathex``. Make the
# application package importable at collection time so FastAPI routes and
# services are included in the frozen runtime.
sys.path.insert(0, str(APP_ROOT))
hidden_imports = (
    collect_submodules("backend")
    + collect_submodules("uvicorn")
    + collect_submodules("webview")
)

a = Analysis(
    [str(APP_ROOT / "run.py")],
    pathex=[str(APP_ROOT)],
    binaries=[],
    datas=[
        (
            str(APP_ROOT / "frontend" / "dist"),
            str(Path("frontend") / "dist"),
        ),
        (
            str(APP_ROOT / "packaging" / "assets"),
            "assets",
        ),
    ],
    hiddenimports=hidden_imports,
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
    [],
    exclude_binaries=True,
    name="AnimeSoul Runtime",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    icon=str(ICON_FILE),
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="AnimeSoul Runtime",
)
