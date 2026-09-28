"""Read public GitHub release metadata without requiring a user token."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from backend.app.version import APP_VERSION

RELEASES_URL = "https://github.com/Quidden/AnimeSoul/releases"
LATEST_RELEASE_API = "https://api.github.com/repos/Quidden/AnimeSoul/releases/latest"


def stable_version(tag: object) -> tuple[int, int, int]:
    """Compare numeric release components, never lexicographic tag strings."""

    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", str(tag))
    if not match:
        raise ValueError("Unsupported release version")
    return tuple(int(part) for part in match.groups())


def check_for_updates() -> dict[str, object]:
    """Report unavailable separately from up-to-date, including offline runs."""

    result: dict[str, object] = {"currentVersion": APP_VERSION, "state": "unavailable"}
    request = urllib.request.Request(
        LATEST_RELEASE_API,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": f"AnimeSoul-Launcher/{APP_VERSION}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.load(response)
        if not isinstance(payload, dict) or payload.get("draft") or payload.get("prerelease"):
            raise ValueError("Not a stable release")
        latest = stable_version(payload.get("tag_name"))
        newer = latest > stable_version(APP_VERSION)
        version = ".".join(map(str, latest))
        result.update(
            state="available" if newer else "current",
            latestVersion=version,
            message=f"Доступна новая версия {version}." if newer else "Установлена актуальная версия.",
        )
    except urllib.error.HTTPError as error:
        result["message"] = (
            "Опубликованных стабильных релизов пока нет или репозиторий недоступен."
            if error.code == 404
            else "GitHub временно недоступен или ограничил запросы. Повтори проверку позже."
        )
    except (OSError, ValueError):
        result["message"] = "Не удалось проверить обновления. Проверь интернет и повтори."
    return result
