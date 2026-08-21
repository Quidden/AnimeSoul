"""Persist the locally running AnimeSoul server identity.

The launcher and runtime are separate processes.  This small module gives
them a shared, machine-local state file so a later launcher window can safely
recognise and stop the server it started without touching an unrelated
process that happens to use the same port.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


RUNTIME_STATE_FILENAME = "animesoul.runtime.json"
RUNTIME_API_CAPABILITIES = frozenset({"kodik-direct-stream-v1"})


def runtime_api_is_compatible(payload: object) -> bool:
    """Return whether a running server supports this client's required API."""

    if not isinstance(payload, dict):
        return False
    capabilities = payload.get("capabilities")
    if not isinstance(capabilities, list):
        return False
    return RUNTIME_API_CAPABILITIES.issubset(
        capability for capability in capabilities if isinstance(capability, str)
    )


def find_available_port(
    preferred_port: int,
    is_available: Callable[[int], bool],
    *,
    max_attempts: int = 100,
) -> int | None:
    """Return the first free user port, starting with ``preferred_port``.

    The launcher must not terminate an unrelated process just because it owns
    the configured port.  Instead, both source and packaged builds use this
    helper to choose a nearby free port and remember it for the next launch.
    """

    start = max(1024, int(preferred_port))
    if start > 65535 or max_attempts <= 0:
        return None
    end = min(65535, start + max_attempts - 1)
    for port in range(start, end + 1):
        if is_available(port):
            return port
    return None


def runtime_state_file(config_path: Path) -> Path:
    """Return the state file selected by the launcher or config location."""

    explicit = os.getenv("ANIMESOUL_RUNTIME_STATE_FILE", "").strip()
    if explicit:
        return Path(explicit).expanduser().resolve()
    return config_path.expanduser().resolve().parent / RUNTIME_STATE_FILENAME


def read_runtime_state(config_path: Path) -> dict[str, Any] | None:
    """Read a well-formed runtime state, ignoring missing/stale files."""

    try:
        payload = json.loads(
            runtime_state_file(config_path).read_text(encoding="utf-8")
        )
    except (FileNotFoundError, OSError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def write_runtime_state(
    config_path: Path,
    *,
    instance_id: str,
    pid: int,
    port: int,
    mode: str,
) -> Path:
    """Atomically publish the process that currently owns AnimeSoul."""

    target = runtime_state_file(config_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "instance_id": instance_id,
        "pid": int(pid),
        "port": int(port),
        "mode": str(mode),
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, target)
    return target


def remove_runtime_state(config_path: Path, instance_id: str) -> None:
    """Remove the state only when it still belongs to this process."""

    current = read_runtime_state(config_path)
    if not current or current.get("instance_id") != instance_id:
        return
    try:
        runtime_state_file(config_path).unlink()
    except FileNotFoundError:
        pass
