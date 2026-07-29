"""Atomic JSON profile storage used by the React client."""

from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path
from typing import Any


class JsonStorage:
    """Serialize writes so a progress update cannot corrupt the save file."""

    def __init__(
        self,
        data_dir: Path,
        import_candidates: tuple[Path, ...] = (),
    ) -> None:
        self.data_dir = data_dir
        self.file = data_dir / "animesoul-storage.json"
        self.temp_file = data_dir / "animesoul-storage.tmp.json"
        self.import_candidates = import_candidates
        self._lock = asyncio.Lock()

    async def read(self) -> dict[str, Any] | None:
        # On the first main-stack run, copy an existing legacy save without
        # deleting or rewriting the source application data.
        if not self.file.exists():
            await self._import_first_existing()
        if not self.file.exists():
            return None
        return json.loads(await asyncio.to_thread(self.file.read_text, encoding="utf-8"))

    async def write(self, document: dict[str, Any]) -> None:
        async with self._lock:
            await asyncio.to_thread(self.data_dir.mkdir, parents=True, exist_ok=True)
            serialized = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
            await asyncio.to_thread(self.temp_file.write_text, serialized, encoding="utf-8")
            await asyncio.to_thread(self.temp_file.replace, self.file)

    async def _import_first_existing(self) -> Path | None:
        async with self._lock:
            if self.file.exists():
                return None
            for candidate in self.import_candidates:
                if not candidate.is_file():
                    continue
                try:
                    document = json.loads(
                        await asyncio.to_thread(candidate.read_text, encoding="utf-8")
                    )
                except (OSError, json.JSONDecodeError):
                    continue
                if not isinstance(document, dict) or not isinstance(document.get("profiles"), list):
                    continue
                await asyncio.to_thread(self.data_dir.mkdir, parents=True, exist_ok=True)
                await asyncio.to_thread(shutil.copy2, candidate, self.file)
                return candidate
        return None
