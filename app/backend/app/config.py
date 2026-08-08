"""Application configuration and settings management.

Centralizes environment decisions, filesystem paths, and API keys.
Receives overrides from environment variables and animesoul.python.json.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PACKAGED_ROOT = Path(getattr(sys, "_MEIPASS", PROJECT_ROOT))
CONFIG_FILE = Path(
    os.getenv("ANIMESOUL_CONFIG_FILE", str(PROJECT_ROOT / "animesoul.python.json"))
)


@dataclass(slots=True)
class Settings:
    """Runtime configuration container shared by API routers and background services."""

    port: int = 8000
    yummy_token: str = ""
    gdrive_client_id: str = ""
    gdrive_client_secret: str = ""
    data_dir: Path = PROJECT_ROOT / "data"
    frontend_dist: Path = Path(
        os.getenv(
            "ANIMESOUL_FRONTEND_DIST",
            str(PACKAGED_ROOT / "frontend" / "dist"),
        )
    )
    legacy_storage_file: Path = (
        PROJECT_ROOT.parent
        / "legacy-old-stack"
        / "data"
        / "animesoul-storage.json"
    )


def load_settings() -> Settings:
    """Load configuration from JSON file and allow environment variable overrides.

    Returns:
        Settings: Initialized runtime configuration object.
    """
    env_file = PROJECT_ROOT / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ.setdefault(key.strip(), val.strip())

    payload: dict[str, object] = {}
    if CONFIG_FILE.exists():
        payload = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))

    port = int(os.getenv("ANIMESOUL_PYTHON_PORT", payload.get("port", 8000)))
    token = os.getenv(
        "YUMMYANIME_TOKEN",
        str(payload.get("yummy_public_token", payload.get("yummyAnimeToken", ""))),
    )
    gdrive_client_id = os.getenv(
        "GOOGLE_CLIENT_ID",
        str(payload.get("gdrive_client_id", "")),
    )
    gdrive_client_secret = os.getenv(
        "GOOGLE_CLIENT_SECRET",
        str(payload.get("gdrive_client_secret", "")),
    )
    configured_data_dir = payload.get("data_directory", PROJECT_ROOT / "data")
    data_dir = Path(os.getenv("ANIMESOUL_DATA_DIR", str(configured_data_dir)))
    if not data_dir.is_absolute():
        data_dir = PROJECT_ROOT / data_dir
    data_dir = data_dir.resolve()
    return Settings(
        port=port,
        yummy_token=token,
        gdrive_client_id=gdrive_client_id,
        gdrive_client_secret=gdrive_client_secret,
        data_dir=data_dir,
    )


settings = load_settings()
