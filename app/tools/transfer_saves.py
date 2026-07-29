"""Copy AnimeSoul saves between the main and legacy implementations.

The tool deliberately treats the save as an opaque JSON document. It validates
only the shared envelope and preserves every nested or future field byte-for-
byte at the data-model level, so a newer feature is never silently discarded.
"""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
MAIN_SAVE = REPOSITORY_ROOT / "app" / "data" / "animesoul-storage.json"
LEGACY_SAVE = (
    REPOSITORY_ROOT / "legacy-old-stack" / "data" / "animesoul-storage.json"
)


class InvalidSave(ValueError):
    """Raised when a file is JSON but is not an AnimeSoul storage document."""


def read_document(path: Path) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise InvalidSave("The save root must be a JSON object.")
    if not isinstance(document.get("profiles"), list):
        raise InvalidSave("The save must contain a profiles array.")
    if not isinstance(document.get("activeProfile"), str):
        raise InvalidSave("The save must contain an activeProfile string.")
    if not isinstance(document.get("schemaVersion"), int):
        raise InvalidSave("The save must contain an integer schemaVersion.")
    return document


def backup_file(target: Path) -> Path | None:
    if not target.exists():
        return None
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup = target.with_name(f"{target.stem}.backup-{timestamp}{target.suffix}")
    shutil.copy2(target, backup)
    return backup


def copy_document(source: Path, target: Path) -> tuple[Path, Path | None]:
    """Validate and atomically copy a full save, returning target and backup."""

    document = read_document(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    backup = backup_file(target)
    temporary = target.with_suffix(f"{target.suffix}.transfer.tmp")
    serialized = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    temporary.write_text(serialized, encoding="utf-8")
    temporary.replace(target)
    return target, backup


def paths_for(direction: str) -> tuple[Path, Path]:
    if direction == "to-main":
        return LEGACY_SAVE, MAIN_SAVE
    if direction == "to-legacy":
        return MAIN_SAVE, LEGACY_SAVE
    raise ValueError(f"Unsupported direction: {direction}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Transfer all AnimeSoul profiles, progress and settings.",
    )
    parser.add_argument(
        "direction",
        choices=("to-main", "to-legacy"),
        help="Destination implementation. The existing destination is backed up.",
    )
    args = parser.parse_args()
    source, target = paths_for(args.direction)
    if not source.is_file():
        raise SystemExit(f"Source save does not exist: {source}")
    try:
        written, backup = copy_document(source, target)
    except (OSError, json.JSONDecodeError, InvalidSave) as error:
        raise SystemExit(f"Save transfer failed: {error}") from error
    print(f"Save copied to: {written}")
    if backup:
        print(f"Previous destination backup: {backup}")


if __name__ == "__main__":
    main()
