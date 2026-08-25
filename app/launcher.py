"""Native WebView launcher for the packaged AnimeSoul application.

The launcher deliberately uses the same WebView2 engine as the desktop client.
This keeps the installer self-contained and avoids depending on a system
Python/Tk installation.  It owns only machine-local configuration and starts
the packaged runtime in browser or desktop mode.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
import webbrowser
from pathlib import Path
from typing import Any

import webview

from runtime_instance import (
    find_available_port,
    read_runtime_state,
    remove_runtime_state,
    runtime_api_is_compatible,
    runtime_state_file,
    write_runtime_state,
)


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
            "User-Agent": "AnimeSoul-Launcher/0.2.3",
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


def existing_animesoul_payload(port: int) -> dict[str, Any] | None:
    """Return health data only when the port belongs to AnimeSoul."""

    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/health",
            timeout=1.5,
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
            if (
                response.status < 400
                and isinstance(payload, dict)
                and payload.get("ok") is True
                and payload.get("stack") == "FastAPI + React"
                and runtime_api_is_compatible(payload)
            ):
                return payload
    except (OSError, ValueError, urllib.error.URLError):
        pass
    return None


def existing_animesoul(port: int) -> bool:
    """Allow launching a second client for an already running AnimeSoul."""

    return existing_animesoul_payload(port) is not None


def server_status_payload(port: int) -> dict[str, Any]:
    """Describe the selected port and whether this launcher may stop it."""

    if port_is_available(port):
        return {
            "state": "stopped",
            "running": False,
            "canStop": False,
            "message": f"Порт {port} свободен.",
        }

    health = existing_animesoul_payload(port)
    if health is None:
        return {
            "state": "occupied",
            "running": False,
            "canStop": False,
            "message": f"Порт {port} занят другим приложением.",
        }

    state = read_runtime_state(config_file()) or {}
    health_instance_id = str(health.get("runtimeInstanceId", "")).strip()
    state_instance_id = str(state.get("instance_id", "")).strip()
    try:
        state_port = int(state.get("port", 0))
        state_pid = int(state.get("pid", 0))
    except (TypeError, ValueError):
        state_port = 0
        state_pid = 0
    managed = bool(
        health_instance_id
        and health_instance_id == state_instance_id
        and state_port == port
        and state_pid > 0
    )
    return {
        "state": "running",
        "running": True,
        "canStop": managed,
        "message": (
            f"AnimeSoul работает на порту {port}."
            if managed
            else f"AnimeSoul уже работает на порту {port}; его можно открыть повторно."
        ),
    }


def stop_managed_server(port: int) -> dict[str, Any]:
    """Stop only the exact AnimeSoul process recorded by this launcher."""

    health = existing_animesoul_payload(port)
    state = read_runtime_state(config_file()) or {}
    health_instance_id = str((health or {}).get("runtimeInstanceId", "")).strip()
    state_instance_id = str(state.get("instance_id", "")).strip()
    try:
        state_port = int(state.get("port", 0))
        pid = int(state.get("pid", 0))
    except (TypeError, ValueError):
        state_port = 0
        pid = 0

    if not (
        health
        and health_instance_id
        and health_instance_id == state_instance_id
        and state_port == port
        and pid > 0
    ):
        return {
            "ok": False,
            "message": "Этот сервер не был запущен текущей версией лаунчера, поэтому безопасная остановка недоступна.",
            "status": server_status_payload(port),
        }

    try:
        if os.name == "nt":
            completed = subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                timeout=10,
                check=False,
            )
            if completed.returncode != 0 and not port_is_available(port):
                raise OSError("taskkill could not stop the process")
        else:
            os.kill(pid, signal.SIGTERM)
    except (OSError, subprocess.SubprocessError) as error:
        return {
            "ok": False,
            "message": f"Не удалось остановить сервер: {error}",
            "status": server_status_payload(port),
        }

    for _ in range(50):
        if port_is_available(port):
            break
        time.sleep(0.1)
    if not port_is_available(port):
        return {
            "ok": False,
            "message": "Процесс получил команду остановки, но порт пока ещё занят.",
            "status": server_status_payload(port),
        }
    remove_runtime_state(config_file(), state_instance_id)
    return {
        "ok": True,
        "message": "Сервер AnimeSoul остановлен, порт снова свободен.",
        "status": server_status_payload(port),
    }


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


    def get_server_status(self, port: object) -> dict[str, Any]:
        parsed_port = self._validate_port(port)
        if isinstance(parsed_port, dict):
            return parsed_port
        return {"ok": True, **server_status_payload(parsed_port)}

    def stop_server(self, port: object) -> dict[str, Any]:
        parsed_port = self._validate_port(port)
        if isinstance(parsed_port, dict):
            return parsed_port
        return stop_managed_server(parsed_port)

    def launch(self, port: object, token: object, mode: object) -> dict[str, Any]:
        parsed_port = self._validate_port(port)
        if isinstance(parsed_port, dict):
            return parsed_port
        launch_mode = "desktop" if str(mode) == "desktop" else "browser"

        available = port_is_available(parsed_port)
        running = existing_animesoul(parsed_port)
        port_message = ""
        if not available and not running:
            occupied_port = parsed_port
            available_port = find_available_port(
                parsed_port + 1,
                port_is_available,
            )
            if available_port is None:
                return {
                    "ok": False,
                    "message": (
                        f"Порт {occupied_port} занят другим приложением, "
                        "а рядом не найден свободный порт. Укажи другой порт."
                    ),
                }
            parsed_port = available_port
            port_message = (
                f"Порт {occupied_port} был занят — выбран свободный "
                f"порт {parsed_port}. "
            )

        if running:
            return self._open_running_server(parsed_port, launch_mode)

        parsed = self._validate_fields(parsed_port, token)
        if isinstance(parsed, dict):
            return parsed
        _, parsed_token = parsed
        token_ok, token_message = validate_public_token(parsed_token)
        if not token_ok:
            return {"ok": False, "message": token_message}

        save_settings(parsed_port, parsed_token, launch_mode)
        command = runtime_command(launch_mode)
        if not Path(command[0]).exists():
            return {
                "ok": False,
                "message": (
                    "Runtime AnimeSoul не найден. Переустанови приложение."
                ),
            }

        instance_id = uuid.uuid4().hex
        environment = os.environ.copy()
        environment["ANIMESOUL_INSTANCE_ID"] = instance_id
        environment["ANIMESOUL_RUNTIME_STATE_FILE"] = str(
            runtime_state_file(config_file())
        )
        try:
            process = subprocess.Popen(
                command,
                cwd=str(Path(command[0]).resolve().parent),
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                env=environment,
            )
        except OSError as error:
            return {
                "ok": False,
                "message": f"Не удалось запустить AnimeSoul: {error}",
            }

        write_runtime_state(
            config_file(),
            instance_id=instance_id,
            pid=process.pid,
            port=parsed_port,
            mode=launch_mode,
        )
        return {
            "ok": True,
            "message": (
                f"{port_message}{token_message} "
                f"Сервер запускается на порту {parsed_port}."
            ),
            "close": False,
        }

    @staticmethod
    def _open_running_server(port: int, mode: str) -> dict[str, Any]:
        if mode == "browser":
            webbrowser.open(f"http://127.0.0.1:{port}")
        else:
            command = runtime_command(mode)
            try:
                subprocess.Popen(
                    command,
                    cwd=str(Path(command[0]).resolve().parent),
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except OSError as error:
                return {
                    "ok": False,
                    "message": f"Не удалось открыть desktop-клиент: {error}",
                }
        return {
            "ok": True,
            "message": (
                f"AnimeSoul уже работает на порту {port}. "
                "Открываем ещё одно окно."
            ),
            "close": False,
            "status": server_status_payload(port),
        }

    @staticmethod
    def _validate_port(port: object) -> int | dict[str, Any]:
        try:
            parsed_port = int(str(port).strip())
        except ValueError:
            return {"ok": False, "message": "Порт должен быть целым числом."}
        if not 1024 <= parsed_port <= 65535:
            return {"ok": False, "message": "Выбери порт от 1024 до 65535."}
        return parsed_port


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
    .server-panel { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center;
      gap: 12px; margin-top: 12px; padding: 12px 14px; border: 1px solid #3e3549; border-radius: 14px;
      background: #15111c; transition: border-color .18s, background .18s; }
    .server-panel.running { border-color: #356b55; background: #111b18; }
    .server-panel.occupied { border-color: #75404b; background: #1d1217; }
    .server-dot { width: 9px; height: 9px; border-radius: 50%; background: #777080; box-shadow: 0 0 10px #777080; }
    .server-panel.running .server-dot { background: #6de3a5; box-shadow: 0 0 12px #6de3a5; }
    .server-panel.occupied .server-dot { background: #ff8296; box-shadow: 0 0 12px #ff8296; }
    .server-copy { min-width: 0; }
    .server-copy strong, .server-copy span { display: block; }
    .server-copy strong { font-size: 13px; }
    .server-copy span { margin-top: 3px; color: #a89fb5; font-size: 11px; overflow-wrap: anywhere; }
    .stop-server { min-height: 34px; padding: 0 12px; border: 1px solid #824150; border-radius: 9px;
      background: #25151b; color: #ff9aad; cursor: pointer; font: 600 12px inherit; }
    .stop-server:hover { background: #321a22; }
    .hidden { display: none !important; }
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
    <section class="server-panel" id="serverPanel" aria-live="polite">
      <span class="server-dot" aria-hidden="true"></span>
      <div class="server-copy">
        <strong id="serverTitle">Проверяем локальный сервер…</strong>
        <span id="serverMessage">Состояние выбранного порта появится здесь.</span>
      </div>
      <button class="stop-server hidden" id="stopServer" type="button">Остановить сервер</button>
    </section>
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
    const serverPanel = document.querySelector('#serverPanel');
    const serverTitle = document.querySelector('#serverTitle');
    const serverMessage = document.querySelector('#serverMessage');
    const stopServer = document.querySelector('#stopServer');
    const buttons = [...document.querySelectorAll('button')];
    let serverTimer = null;
    let portTimer = null;
    const setBusy = value => buttons.forEach(button => button.disabled = value);
    const showStatus = (message, kind = '') => { status.textContent = message; status.className = `status ${kind}`; };

    const renderServerStatus = value => {
      const state = value?.state || 'stopped';
      serverPanel.className = `server-panel ${state}`;
      serverTitle.textContent = state === 'running'
        ? 'Сервер AnimeSoul запущен'
        : state === 'occupied'
          ? 'Порт занят другим приложением'
          : 'Сервер AnimeSoul остановлен';
      serverMessage.textContent = value?.message || 'Порт свободен и готов к запуску.';
      stopServer.classList.toggle('hidden', !value?.canStop);
    };

    const refreshServerStatus = async () => {
      if (!window.pywebview?.api) return;
      const result = await window.pywebview.api.get_server_status(port.value);
      if (!result.ok) {
        renderServerStatus({ state: 'occupied', message: result.message, canStop: false });
        return;
      }
      renderServerStatus(result);
    };

    window.addEventListener('pywebviewready', async () => {
      const settings = await window.pywebview.api.get_settings();
      port.value = settings.port || 3001;
      token.value = settings.token || '';
      path.textContent = `Данные сохраняются в ${settings.configPath}`;
      showStatus('Готово к запуску');
      await refreshServerStatus();
      serverTimer = window.setInterval(refreshServerStatus, 2500);
    });

    port.addEventListener('input', () => {
      window.clearTimeout(portTimer);
      portTimer = window.setTimeout(refreshServerStatus, 350);
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
      await refreshServerStatus();
    });
    stopServer.addEventListener('click', async () => {
      setBusy(true);
      showStatus('Останавливаем локальный сервер…');
      const result = await window.pywebview.api.stop_server(port.value);
      showStatus(result.message, result.ok ? 'success' : 'error');
      setBusy(false);
      if (result.status) renderServerStatus(result.status);
      else await refreshServerStatus();
    });
    document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', async () => {
      setBusy(true); showStatus('Проверяем порт и ключ API…');
      const result = await window.pywebview.api.launch(port.value, token.value, button.dataset.mode);
      showStatus(result.message, result.ok ? 'success' : 'error');
      if (result.status) renderServerStatus(result.status);
      if (result.ok && result.close) {
        window.setTimeout(() => window.pywebview.api.close(), 180);
        return;
      }
      setBusy(false);
      window.setTimeout(refreshServerStatus, 800);
      window.setTimeout(refreshServerStatus, 2200);
    }));
    window.addEventListener('beforeunload', () => {
      window.clearInterval(serverTimer);
      window.clearTimeout(portTimer);
    });
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
        height=850,
        min_size=(620, 680),
        background_color="#09080e",
    )
    webview.start(
        private_mode=False,
        icon=str(bundled_asset("animesoul.ico")),
    )


if __name__ == "__main__":
    main()
