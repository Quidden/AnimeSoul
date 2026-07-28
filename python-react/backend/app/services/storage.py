"""Atomic JSON profile storage used by the React client."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any


class JsonStorage:
    """Serialize writes so a progress update cannot corrupt the save file."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.file = data_dir / "animesoul-storage.json"
        self.temp_file = data_dir / "animesoul-storage.tmp.json"
        self._lock = asyncio.Lock()

    async def read(self) -> dict[str, Any] | None:
        if not self.file.exists():
            return None
        return json.loads(await asyncio.to_thread(self.file.read_text, encoding="utf-8"))

    async def write(self, document: dict[str, Any]) -> None:
        async with self._lock:
            await asyncio.to_thread(self.data_dir.mkdir, parents=True, exist_ok=True)
            serialized = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
            await asyncio.to_thread(self.temp_file.write_text, serialized, encoding="utf-8")
            await asyncio.to_thread(self.temp_file.replace, self.file)
