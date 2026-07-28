"""Application configuration.

Keep all environment and filesystem decisions in this module. Other modules
receive a Settings object and therefore remain easy to test or replace.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
CONFIG_FILE = PROJECT_ROOT / "animesoul.python.json"


@dataclass(slots=True)
class Settings:
    """Runtime values shared by API routers and services."""

    port: int = 8000
    yummy_token: str = ""
    data_dir: Path = PROJECT_ROOT / "data"
    frontend_dist: Path = PROJECT_ROOT / "frontend" / "dist"


def load_settings() -> Settings:
    """Load configuration from JSON and allow environment overrides."""

    payload: dict[str, object] = {}
    if CONFIG_FILE.exists():
        payload = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))

    port = int(os.getenv("ANIMESOUL_PYTHON_PORT", payload.get("port", 8000)))
    token = os.getenv(
        "YUMMYANIME_TOKEN",
        str(payload.get("yummy_public_token", payload.get("yummyAnimeToken", ""))),
    )
    configured_data_dir = payload.get("data_directory", PROJECT_ROOT / "data")
    data_dir = Path(os.getenv("ANIMESOUL_DATA_DIR", str(configured_data_dir)))
    if not data_dir.is_absolute():
        data_dir = PROJECT_ROOT / data_dir
    data_dir = data_dir.resolve()
    return Settings(port=port, yummy_token=token, data_dir=data_dir)


settings = load_settings()
