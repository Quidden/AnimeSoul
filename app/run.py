"""AnimeSoul launcher for the main Python + React application.

The launcher owns only local bootstrap concerns: first-run configuration,
port validation, server startup and the choice between a browser or a native
WebView window. Application behavior remains in React and FastAPI.
"""

from __future__ import annotations

import argparse
import json
import socket
import threading
import time
import webbrowser
from pathlib import Path
from typing import Literal

import httpx
import uvicorn


ROOT = Path(__file__).resolve().parent
CONFIG_FILE = ROOT / "animesoul.python.json"
LaunchMode = Literal["browser", "desktop"]


def port_is_available(port: int) -> bool:
    """Return False before startup when another process owns the port."""

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


def ask_launch_mode(default: LaunchMode = "browser") -> LaunchMode:
    prompt = "Режим запуска: 1 — браузер, 2 — desktop"
    suffix = " [1]: " if default == "browser" else " [2]: "
    raw = input(prompt + suffix).strip()
    if not raw:
        return default
    return "desktop" if raw == "2" else "browser"


def ask_settings(previous: dict[str, object] | None = None) -> dict[str, object]:
    """Collect settings without ever embedding a user's token in source code."""

    previous = previous or {}
    print("\nПервоначальная настройка AnimeSoul")
    print("Нужен только Public token: https://api.yani.tv/swagger")
    print("Открой раздел Introduction, авторизуйся и создай приложение.")
    print("Private token сюда вводить нельзя.\n")

    default_port = int(previous.get("port", 8000))
    while True:
        raw_port = input(f"Порт сайта [{default_port}]: ").strip() or str(default_port)
        try:
            port = int(raw_port)
            if not 1024 <= port <= 65535 or not port_is_available(port):
                raise ValueError
            break
        except ValueError:
            print("Порт некорректен или занят. Выбери свободный порт 1024–65535.")

    previous_token = str(previous.get("yummy_public_token", "")).strip()
    while True:
        token_prompt = "Public token YummyAnime"
        if previous_token:
            token_prompt += " [Enter — оставить текущий]"
        token = input(token_prompt + ": ").strip() or previous_token
        print("Проверяем ключ…")
        if token and validate_token(token):
            break
        print("Ключ не прошёл проверку. Проверь значение, API и интернет.")

    default_mode = str(previous.get("launch_mode", "browser"))
    mode = ask_launch_mode("desktop" if default_mode == "desktop" else "browser")
    result: dict[str, object] = {
        "port": port,
        "yummy_public_token": token,
        "data_directory": str(previous.get("data_directory", "data")),
        "launch_mode": mode,
    }
    CONFIG_FILE.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Настройки сохранены: {CONFIG_FILE}")
    return result


def load_runtime_settings(reconfigure: bool = False) -> dict[str, object]:
    """Load local settings or run the first-launch wizard."""

    if not CONFIG_FILE.exists():
        return ask_settings()
    try:
        current = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        if not isinstance(current, dict):
            raise ValueError("configuration root must be an object")
    except (OSError, ValueError, json.JSONDecodeError):
        print(f"Файл настроек повреждён: {CONFIG_FILE}")
        print("Исправь JSON вручную или удали файл и повтори запуск.")
        raise SystemExit(2)
    return ask_settings(current) if reconfigure else current


def wait_until_ready(port: int, attempts: int = 100) -> bool:
    """Wait for FastAPI so the selected client never opens an error page."""

    health_url = f"http://127.0.0.1:{port}/api/health"
    for _ in range(attempts):
        try:
            if httpx.get(health_url, timeout=0.5).is_success:
                return True
        except httpx.HTTPError:
            pass
        time.sleep(0.12)
    return False


def animesoul_is_running(port: int) -> bool:
    """Recognize an already running AnimeSoul instance on the configured port."""

    try:
        response = httpx.get(
            f"http://127.0.0.1:{port}/api/health",
            timeout=1.5,
        )
        payload = response.json()
        return bool(
            response.is_success
            and isinstance(payload, dict)
            and payload.get("ok") is True
            and payload.get("stack") == "FastAPI + React"
        )
    except (httpx.HTTPError, ValueError):
        return False


def open_existing_client(port: int, mode: LaunchMode) -> None:
    """Open an existing local server instead of failing on a second launch."""

    url = f"http://127.0.0.1:{port}"
    print(f"AnimeSoul уже запущен на {url}. Открываем приложение.")
    if mode == "browser":
        webbrowser.open(url)
        return

    try:
        import webview
    except ImportError as error:
        print("Desktop-компонент не установлен. Запусти bat-файл ещё раз.")
        raise SystemExit(4) from error
    webview.create_window(
        "AnimeSoul",
        url,
        width=1440,
        height=900,
        min_size=(960, 640),
    )
    webview.start(private_mode=False)


def run_browser(port: int) -> None:
    """Open the system browser when FastAPI is ready, then serve in foreground."""

    url = f"http://127.0.0.1:{port}"

    def open_client() -> None:
        if wait_until_ready(port):
            webbrowser.open(url)
        else:
            print(f"Сайт не ответил по адресу {url}")

    threading.Thread(target=open_client, daemon=True).start()
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=port, reload=False)


def run_desktop(port: int) -> None:
    """Host FastAPI in-process and display it in a native WebView2 window."""

    try:
        import webview
    except ImportError as error:
        print("Desktop-компонент не установлен. Запусти bat-файл ещё раз.")
        raise SystemExit(4) from error

    config = uvicorn.Config(
        "backend.app.main:app",
        host="127.0.0.1",
        port=port,
        reload=False,
        log_level="warning",
    )
    server = uvicorn.Server(config)
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()
    if not wait_until_ready(port):
        print(f"FastAPI не ответил на порту {port}.")
        server.should_exit = True
        raise SystemExit(5)

    window = webview.create_window(
        "AnimeSoul",
        f"http://127.0.0.1:{port}",
        width=1440,
        height=900,
        min_size=(960, 640),
    )
    try:
        # WebView2 keeps familiar Ctrl+/Ctrl- page zoom behavior on Windows.
        webview.start(private_mode=False)
    finally:
        server.should_exit = True
        server_thread.join(timeout=5)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch AnimeSoul.")
    parser.add_argument(
        "--mode",
        choices=("browser", "desktop"),
        help="Override the saved launch mode for this run.",
    )
    parser.add_argument(
        "--configure",
        action="store_true",
        help="Open the port, API token and launch mode setup again.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_arguments()
    runtime = load_runtime_settings(args.configure)
    port = int(runtime.get("port", 8000))
    mode: LaunchMode = args.mode or (
        "desktop" if runtime.get("launch_mode") == "desktop" else "browser"
    )
    if not port_is_available(port):
        if animesoul_is_running(port):
            open_existing_client(port, mode)
            return
        print(f"Порт {port} занят другим приложением.")
        print(f"Измени его командой run.py --configure или в {CONFIG_FILE}.")
        raise SystemExit(3)

    if mode == "desktop":
        run_desktop(port)
    else:
        run_browser(port)


if __name__ == "__main__":
    main()
