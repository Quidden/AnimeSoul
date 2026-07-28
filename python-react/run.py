"""Build-free launcher for the packaged Python + React experiment.

The first launch asks for local settings. Secrets never enter frontend source
code and are written only to the ignored local JSON configuration file.
"""

from __future__ import annotations

import json
import socket
import threading
import time
import webbrowser
from pathlib import Path

import httpx
import uvicorn


ROOT = Path(__file__).resolve().parent
CONFIG_FILE = ROOT / "animesoul.python.json"


def port_is_available(port: int) -> bool:
    """Return False before starting when another process owns the port."""

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def validate_token(token: str) -> bool:
    """Perform a small real API request instead of accepting a broken key."""

    try:
        response = httpx.get(
            "https://api.yani.tv/anime",
            params={"limit": 1},
            headers={"X-Application": token, "Lang": "ru", "Accept": "application/json"},
            timeout=12,
        )
        return response.status_code < 400
    except httpx.HTTPError:
        return False


def ask_settings() -> dict[str, object]:
    print("\nAnimeSoul Python + React — first launch")
    print("Get a Public token in https://api.yani.tv/swagger (Introduction).")
    print("Only a public API token is required; never enter a private token here.\n")

    while True:
        raw_port = input("Site port [8000]: ").strip() or "8000"
        try:
            port = int(raw_port)
            if not 1024 <= port <= 65535 or not port_is_available(port):
                raise ValueError
            break
        except ValueError:
            print("This port is invalid or busy. Choose a free port from 1024 to 65535.")

    while True:
        token = input("YummyAnime Public token: ").strip()
        print("Checking token...")
        if token and validate_token(token):
            break
        print("The token did not pass the API check. Check the value and your internet.")

    result = {
        "port": port,
        "yummy_public_token": token,
        "data_directory": "data",
    }
    CONFIG_FILE.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def load_runtime_settings() -> dict[str, object]:
    if not CONFIG_FILE.exists():
        return ask_settings()
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        print(f"Configuration is damaged: {CONFIG_FILE}")
        print("Delete it to repeat setup, or correct the JSON manually.")
        raise SystemExit(2)


def open_when_ready(port: int) -> None:
    """Wait for Uvicorn before opening the browser to avoid a blank error page."""

    url = f"http://127.0.0.1:{port}"
    for _ in range(80):
        try:
            if httpx.get(f"{url}/api/health", timeout=0.5).is_success:
                webbrowser.open(url)
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.15)


def main() -> None:
    settings = load_runtime_settings()
    port = int(settings.get("port", 8000))
    if not port_is_available(port):
        print(f"Port {port} is busy. Change it in {CONFIG_FILE} while AnimeSoul is closed.")
        raise SystemExit(3)

    threading.Thread(target=open_when_ready, args=(port,), daemon=True).start()
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=port, reload=False)


if __name__ == "__main__":
    main()
