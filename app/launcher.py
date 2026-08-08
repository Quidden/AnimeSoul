"""Native WebView launcher for the packaged AnimeSoul application.

The launcher deliberately uses the same WebView2 engine as the desktop client.
This keeps the installer self-contained and avoids depending on a system
Python/Tk installation.  It owns only machine-local configuration and starts
the packaged runtime in browser or desktop mode.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any

import webview


APP_NAME = "AnimeSoul"
DEFAULT_PORT = 3001
API_DOCUMENTATION_URL = "https://api.yani.tv/swagger"


def bundled_asset(name: str) -> Path:
    """Return an asset path in source runs and frozen PyInstaller builds."""

    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS")) / "assets" / name
    return Path(__file__).resolve().parent / "packaging" / "assets" / name


def user_data_root() -> Path:
    """Return a writable location that survives application updates."""

    local_app_data = os.getenv("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / APP_NAME
    return Path.home() / f".{APP_NAME.lower()}"


def config_file() -> Path:
    return user_data_root() / "animesoul.python.json"


def default_settings() -> dict[str, object]:
    root = user_data_root()
    return {
        "port": DEFAULT_PORT,
        "yummy_public_token": "",
        "data_directory": str(root / "data"),
        "launch_mode": "browser",
    }


def load_settings() -> dict[str, object]:
    values = default_settings()
    try:
        payload = json.loads(config_file().read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            values.update(payload)
    except (FileNotFoundError, OSError, ValueError, json.JSONDecodeError):
        pass
    return values


def save_settings(port: int, token: str, launch_mode: str) -> None:
    root = user_data_root()
    root.mkdir(parents=True, exist_ok=True)
    payload = {
        "port": port,
        "yummy_public_token": token,
        "data_directory": str(root / "data"),
        "launch_mode": launch_mode,
    }
    config_file().write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def validate_public_token(token: str) -> tuple[bool, str]:
    """Validate the public token with one lightweight API request."""

    request = urllib.request.Request(
        "https://api.yani.tv/anime?limit=1",
        headers={
            "X-Application": token,
            "Lang": "ru",
            "Accept": "application/json",
            "User-Agent": "AnimeSoul-Launcher/0.2.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            if response.status < 400:
                return True, "Ключ API подтверждён."
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            return False, "API отклонил ключ. Проверь Public token."
        return False, f"API вернул ошибку HTTP {error.code}."
    except (urllib.error.URLError, TimeoutError):
        return False, "Не удалось связаться с API. Проверь интернет и повтори."
    return False, "Ключ не прошёл проверку."


def port_is_available(port: int) -> bool:
    """Return True when a fresh local server may bind the selected port."""

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def existing_animesoul(port: int) -> bool:
    """Allow launching a second client for an already running AnimeSoul."""

    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/health",
            timeout=1.5,
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return bool(
                response.status < 400
                and isinstance(payload, dict)
                and payload.get("ok") is True
                and payload.get("stack") == "FastAPI + React"
            )
    except (OSError, ValueError, urllib.error.URLError):
        return False


def runtime_command(mode: str) -> list[str]:
    """Build a command for source runs and installed runs."""

    if getattr(sys, "frozen", False):
        runtime = Path(sys.executable).resolve().parent / "runtime" / "AnimeSoul Runtime.exe"
        return [str(runtime), "--mode", mode, "--config", str(config_file())]
    return [
        sys.executable,
        str(Path(__file__).resolve().with_name("run.py")),
        "--mode",
        mode,
        "--config",
        str(config_file()),
    ]


class LauncherApi:
    """Small JavaScript bridge exposed only to the local launcher page."""

    def get_settings(self) -> dict[str, Any]:
        settings = load_settings()
        return {
            "port": int(settings.get("port", DEFAULT_PORT)),
            "token": str(settings.get("yummy_public_token", "")),
            "mode": str(settings.get("launch_mode", "browser")),
            "configPath": str(config_file()),
        }

    def open_documentation(self) -> None:
        webbrowser.open(API_DOCUMENTATION_URL)

    def save(self, port: object, token: object) -> dict[str, Any]:
        parsed = self._validate_fields(port, token)
        if isinstance(parsed, dict):
            return parsed
        parsed_port, parsed_token = parsed
        previous_mode = str(load_settings().get("launch_mode", "browser"))
        save_settings(parsed_port, parsed_token, previous_mode)
        return {
            "ok": True,
            "message": "Настройки сохранены.",
            "configPath": str(config_file()),
        }

    def launch(self, port: object, token: object, mode: object) -> dict[str, Any]:
        parsed = self._validate_fields(port, token)
        if isinstance(parsed, dict):
            return parsed
        parsed_port, parsed_token = parsed
        launch_mode = "desktop" if str(mode) == "desktop" else "browser"

        if not port_is_available(parsed_port) and not existing_animesoul(parsed_port):
            return {
                "ok": False,
                "message": f"Порт {parsed_port} занят другим приложением. Выбери другой порт.",
            }

        token_ok, token_message = validate_public_token(parsed_token)
        if not token_ok:
            return {"ok": False, "message": token_message}

        save_settings(parsed_port, parsed_token, launch_mode)
        command = runtime_command(launch_mode)
        if not Path(command[0]).exists():
            return {
                "ok": False,
                "message": "Runtime AnimeSoul не найден. Переустанови приложение.",
            }
        try:
            subprocess.Popen(
                command,
                cwd=str(Path(command[0]).resolve().parent),
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except OSError as error:
            return {"ok": False, "message": f"Не удалось запустить AnimeSoul: {error}"}
        return {"ok": True, "message": token_message, "close": True}

    def close(self) -> None:
        if webview.windows:
            webview.windows[0].destroy()

    @staticmethod
    def _validate_fields(
        port: object,
        token: object,
    ) -> tuple[int, str] | dict[str, Any]:
        try:
            parsed_port = int(str(port).strip())
        except ValueError:
            return {"ok": False, "message": "Порт должен быть целым числом."}
        if not 1024 <= parsed_port <= 65535:
            return {"ok": False, "message": "Выбери порт от 1024 до 65535."}
        parsed_token = str(token).strip()
        if not parsed_token:
            return {
                "ok": False,
                "message": "Введи личный Public token из документации YummyAnime API.",
            }
        return parsed_port, parsed_token


LAUNCHER_HTML = r"""
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AnimeSoul Launcher</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, "Segoe UI", system-ui, sans-serif; }
    * { box-sizing: border-box; }
    html, body { width: 100%; min-height: 100%; margin: 0; background: #09080e; color: #f8f5ff; }
    body { display: grid; place-items: center; padding: 24px; overflow: auto; }
    .card { width: min(680px, 100%); padding: 28px; border: 1px solid #554365; border-radius: 24px;
      background: linear-gradient(145deg, #191420 0%, #120f19 100%); box-shadow: 0 24px 80px #0008; }
    .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
    .logo { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 13px;
      background: linear-gradient(145deg, #a882ff, #7948ef); font-weight: 800; font-size: 20px; }
    h1 { margin: 0; font-size: 30px; letter-spacing: -.02em; }
    .subtitle, .muted, .help, .path { color: #a89fb5; }
    .subtitle { margin: 3px 0 20px 60px; }
    .thanks { margin: 0 0 10px; color: #d7cfdf; line-height: 1.45; }
    .muted { margin: 0 0 18px; line-height: 1.42; }
    label { display: block; margin: 15px 0 7px; font-weight: 700; }
    input { width: 100%; height: 46px; padding: 0 14px; border: 1px solid #514360; border-radius: 12px;
      outline: none; background: #211c2b; color: #fff; font: inherit; transition: border-color .15s, box-shadow .15s; }
    input:focus { border-color: #9d78ff; box-shadow: 0 0 0 3px #8f63ff26; }
    .token { position: relative; }
    .token input { padding-right: 104px; }
    .reveal { position: absolute; right: 7px; top: 7px; height: 32px; border: 0; border-radius: 8px;
      padding: 0 12px; background: #30283d; color: #e9e2f1; cursor: pointer; }
    .help { margin-top: 7px; font-size: 12px; line-height: 1.4; }
    .docs { margin-top: 10px; border: 1px solid #514360; border-radius: 10px; padding: 9px 13px;
      background: #211c2b; color: #eee8f7; cursor: pointer; }
    .status { display: flex; align-items: center; gap: 9px; min-height: 24px; margin: 18px 0 12px; color: #b79bff; }
    .status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 12px currentColor; }
    .status.error { color: #ff8296; }
    .status.success { color: #6de3a5; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    button.action { min-height: 48px; border: 1px solid #9d78ff; border-radius: 13px; background: #8f63ff;
      color: #fff; font: 700 15px inherit; cursor: pointer; transition: transform .15s, background .15s; }
    button.action:hover { transform: translateY(-1px); background: #a582ff; }
    button.action:disabled, .docs:disabled, .reveal:disabled { opacity: .55; cursor: wait; transform: none; }
    .save { grid-column: 1 / -1; background: #211c2b !important; border-color: #514360 !important; }
    .path { margin: 14px 0 0; font-size: 11px; overflow-wrap: anywhere; }
    @media (max-width: 560px) { body { padding: 12px; } .card { padding: 20px; } .actions { grid-template-columns: 1fr; }
      .save { grid-column: auto; } .subtitle { margin-left: 0; } }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand"><div class="logo">魂</div><h1>AnimeSoul</h1></div>
    <p class="subtitle">Локальная аниме-библиотека · Python + React</p>
    <p class="thanks">Огромное спасибо разработчикам YummyAnime за открытый API — благодаря их работе стало возможным создание AnimeSoul.</p>
    <p class="muted">Для запуска нужен личный Public token. Общий ключ не входит в open-source проект, чтобы не создавать лишнюю нагрузку на API.</p>

    <label for="port">Порт сайта</label>
    <input id="port" inputmode="numeric" autocomplete="off" value="3001">
    <div class="help">По умолчанию 3001 · допустимый диапазон: 1024–65535.</div>

    <label for="token">Public token YummyAnime API</label>
    <div class="token"><input id="token" type="password" autocomplete="off"><button class="reveal" id="reveal">Показать</button></div>
    <button class="docs" id="docs">Где получить Public token ↗</button>

    <div class="status" id="status">Загружаем настройки…</div>
    <div class="actions">
      <button class="action" data-mode="browser">Открыть сайт</button>
      <button class="action" data-mode="desktop">Открыть desktop</button>
      <button class="action save" id="save">Сохранить настройки</button>
    </div>
    <p class="path" id="path"></p>
  </main>
  <script>
    const port = document.querySelector('#port');
    const token = document.querySelector('#token');
    const status = document.querySelector('#status');
    const path = document.querySelector('#path');
    const buttons = [...document.querySelectorAll('button')];
    const setBusy = value => buttons.forEach(button => button.disabled = value);
    const showStatus = (message, kind = '') => { status.textContent = message; status.className = `status ${kind}`; };

    window.addEventListener('pywebviewready', async () => {
      const settings = await window.pywebview.api.get_settings();
      port.value = settings.port || 3001;
      token.value = settings.token || '';
      path.textContent = `Данные сохраняются в ${settings.configPath}`;
      showStatus('Готово к запуску');
    });

    document.querySelector('#reveal').addEventListener('click', () => {
      const visible = token.type === 'text';
      token.type = visible ? 'password' : 'text';
      document.querySelector('#reveal').textContent = visible ? 'Показать' : 'Скрыть';
    });
    document.querySelector('#docs').addEventListener('click', () => window.pywebview.api.open_documentation());
    document.querySelector('#save').addEventListener('click', async () => {
      setBusy(true); showStatus('Сохраняем…');
      const result = await window.pywebview.api.save(port.value, token.value);
      showStatus(result.message, result.ok ? 'success' : 'error');
      if (result.configPath) path.textContent = `Данные сохраняются в ${result.configPath}`;
      setBusy(false);
    });
    document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', async () => {
      setBusy(true); showStatus('Проверяем порт и ключ API…');
      const result = await window.pywebview.api.launch(port.value, token.value, button.dataset.mode);
      showStatus(result.message, result.ok ? 'success' : 'error');
      if (result.ok && result.close) {
        window.setTimeout(() => window.pywebview.api.close(), 180);
        return;
      }
      setBusy(false);
    }));
  </script>
</body>
</html>
"""


def main() -> None:
    """Open the native launcher window and block until it is closed."""

    webview.create_window(
        "AnimeSoul Launcher",
        html=LAUNCHER_HTML,
        js_api=LauncherApi(),
        width=760,
        height=780,
        min_size=(620, 640),
        background_color="#09080e",
    )
    webview.start(
        private_mode=False,
        icon=str(bundled_asset("animesoul.ico")),
    )


if __name__ == "__main__":
    main()
