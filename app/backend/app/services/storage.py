"""Atomic JSON profile storage used by the React client."""

from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path
from typing import Any
from uuid import uuid4


_storage_locks: dict[Path, asyncio.Lock] = {}


def validate_storage_document(document: Any) -> bool:
    """Accept only storage envelopes that are safe to restore or overwrite."""

    if not isinstance(document, dict):
        return False
    profiles = document.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        return False
    for profile in profiles:
        if (
            not isinstance(profile, dict)
            or not isinstance(profile.get("id"), str)
            or not profile["id"].strip()
            or not isinstance(profile.get("snapshot"), dict)
        ):
            return False
    active_profile = document.get("activeProfile")
    if active_profile is not None and active_profile not in {
        profile["id"] for profile in profiles
    }:
        return False
    return True


def _shared_storage_lock(path: Path) -> asyncio.Lock:
    """Return one process-wide lock for every physical save file."""

    resolved = path.resolve()
    lock = _storage_locks.get(resolved)
    if lock is None:
        lock = asyncio.Lock()
        _storage_locks[resolved] = lock
    return lock


class JsonStorage:
    """Serialize writes so a progress update cannot corrupt the save file."""

    def __init__(
        self,
        data_dir: Path,
        import_candidates: tuple[Path, ...] = (),
    ) -> None:
        self.data_dir = data_dir
        self.file = data_dir / "animesoul-storage.json"
        self.import_candidates = import_candidates
        # The storage and Google Drive routers construct separate JsonStorage
        # objects for the same file. They must still serialize replacements.
        self._lock = _shared_storage_lock(self.file)

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
            await self._write_locked(document)

    async def backup(self, label: str = "backup") -> Path | None:
        """Create a point-in-time copy before an intentional replacement."""

        async with self._lock:
            return await self._backup_locked(label)

    async def replace_with_backup(
        self,
        document: dict[str, Any],
        label: str = "backup",
    ) -> Path | None:
        """Back up and replace as one operation under the shared file lock."""

        async with self._lock:
            backup = await self._backup_locked(label)
            await self._write_locked(document)
            return backup

    async def _write_locked(self, document: dict[str, Any]) -> None:
        await asyncio.to_thread(self.data_dir.mkdir, parents=True, exist_ok=True)
        serialized = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
        # A unique temporary path also protects against a second process or an
        # older service instance that does not share our in-memory lock.
        temp_file = self.data_dir / f".{self.file.name}.{uuid4().hex}.tmp"
        try:
            await asyncio.to_thread(temp_file.write_text, serialized, encoding="utf-8")
            await asyncio.to_thread(temp_file.replace, self.file)
        finally:
            if temp_file.exists():
                await asyncio.to_thread(temp_file.unlink, missing_ok=True)

    async def _backup_locked(self, label: str) -> Path | None:
        if not self.file.is_file():
            return None
        safe_label = "".join(
            character for character in label if character.isalnum() or character in "-_"
        ) or "backup"
        backup_file = self.data_dir / (
            f"{self.file.stem}.{safe_label}.{uuid4().hex[:12]}{self.file.suffix}"
        )
        await asyncio.to_thread(shutil.copy2, self.file, backup_file)
        return backup_file

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
