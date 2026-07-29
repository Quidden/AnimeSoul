# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller recipe for the FastAPI + React + WebView runtime."""

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules


APP_ROOT = Path(SPECPATH).parent
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
        )
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
