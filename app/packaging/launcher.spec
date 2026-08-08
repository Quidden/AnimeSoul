# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller recipe for the small Windows launcher."""

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules


APP_ROOT = Path(SPECPATH).parent
ICON_FILE = APP_ROOT / "packaging" / "assets" / "animesoul.ico"

a = Analysis(
    [str(APP_ROOT / "launcher.py")],
    pathex=[str(APP_ROOT)],
    binaries=[],
    datas=[
        (
            str(APP_ROOT / "packaging" / "assets"),
            "assets",
        )
    ],
    hiddenimports=collect_submodules("webview"),
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
    name="AnimeSoul Launcher",
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
