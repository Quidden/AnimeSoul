"""Windows launcher UI for the packaged AnimeSoul application.

The launcher is intentionally separate from the runtime.  It owns only the
small setup window, persists machine-local settings and starts either the web
or desktop client.  FastAPI and React stay inside the runtime executable.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from tkinter import BooleanVar, StringVar, Tk, messagebox
from tkinter import ttk


APP_NAME = "AnimeSoul"
DEFAULT_PORT = 3001
API_DOCUMENTATION_URL = "https://api.yani.tv/swagger"


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
    path = config_file()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            values.update(payload)
    except FileNotFoundError:
        pass
    except (OSError, ValueError, json.JSONDecodeError):
        # The UI will let the user overwrite a damaged configuration.
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
            "User-Agent": "AnimeSoul-Launcher/0.1.9-beta.2",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=7) as response:
            if response.status < 400:
                return True, "Ключ API подтверждён."
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            return False, "Ключ отклонён API. Проверь Public token."
        return False, f"API вернул ошибку HTTP {error.code}."
    except (urllib.error.URLError, TimeoutError):
        return False, "Не удалось связаться с API. Проверь интернет и повтори."
    return False, "Ключ не прошёл проверку."


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


class LauncherWindow:
    """Compact launcher with mode selection and editable runtime settings."""

    def __init__(self) -> None:
        settings = load_settings()
        self.root = Tk()
        self.root.title("AnimeSoul Launcher")
        self.root.geometry("680x690")
        self.root.minsize(620, 620)
        self.root.configure(background="#0d0b12")

        self.port = StringVar(value=str(settings.get("port", DEFAULT_PORT)))
        self.token = StringVar(value=str(settings.get("yummy_public_token", "")))
        self.show_token = BooleanVar(value=False)
        self.status = StringVar(value="Готово к запуску")
        self.busy = False

        self._configure_styles()
        self._build()

    def _configure_styles(self) -> None:
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("Root.TFrame", background="#0d0b12")
        style.configure("Card.TFrame", background="#15121c")
        style.configure(
            "Title.TLabel",
            background="#15121c",
            foreground="#f7f3ff",
            font=("Segoe UI Semibold", 24),
        )
        style.configure(
            "Text.TLabel",
            background="#15121c",
            foreground="#b9b0c7",
            font=("Segoe UI", 10),
            wraplength=570,
        )
        style.configure(
            "Field.TLabel",
            background="#15121c",
            foreground="#f1ecf8",
            font=("Segoe UI Semibold", 10),
        )
        style.configure(
            "Status.TLabel",
            background="#15121c",
            foreground="#9a72ff",
            font=("Segoe UI Semibold", 10),
        )
        style.configure(
            "Accent.TButton",
            background="#8f63ff",
            foreground="#ffffff",
            bordercolor="#8f63ff",
            padding=(16, 12),
            font=("Segoe UI Semibold", 11),
        )
        style.map("Accent.TButton", background=[("active", "#a582ff"), ("disabled", "#514266")])
        style.configure(
            "Secondary.TButton",
            background="#211b2b",
            foreground="#f3eef9",
            bordercolor="#514360",
            padding=(14, 10),
            font=("Segoe UI Semibold", 10),
        )
        style.map("Secondary.TButton", background=[("active", "#2c2339")])
        style.configure(
            "TEntry",
            fieldbackground="#211b2b",
            foreground="#ffffff",
            insertcolor="#ffffff",
            bordercolor="#514360",
            padding=10,
        )
        style.configure(
            "TCheckbutton",
            background="#15121c",
            foreground="#b9b0c7",
            font=("Segoe UI", 9),
        )

    def _build(self) -> None:
        outer = ttk.Frame(self.root, style="Root.TFrame", padding=24)
        outer.pack(fill="both", expand=True)
        card = ttk.Frame(outer, style="Card.TFrame", padding=28)
        card.pack(fill="both", expand=True)

        ttk.Label(card, text="AnimeSoul", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            card,
            text="Локальная аниме-библиотека · Python + React",
            style="Text.TLabel",
        ).pack(anchor="w", pady=(2, 18))

        ttk.Label(
            card,
            text=(
                "Спасибо разработчикам YummyAnime за открытый API — благодаря их "
                "работе стало возможным создание AnimeSoul."
            ),
            style="Text.TLabel",
        ).pack(anchor="w", pady=(0, 12))
        ttk.Label(
            card,
            text=(
                "Нужен личный Public token. Мы не включаем общий ключ в open-source "
                "проект, потому что неизвестно, разрешено ли его распространять и "
                "как общая нагрузка повлияет на API."
            ),
            style="Text.TLabel",
        ).pack(anchor="w", pady=(0, 18))

        ttk.Label(card, text="Порт сайта", style="Field.TLabel").pack(anchor="w")
        ttk.Entry(card, textvariable=self.port).pack(fill="x", pady=(6, 6))
        ttk.Label(
            card,
            text="По умолчанию 3001. Используй свободный порт от 1024 до 65535.",
            style="Text.TLabel",
        ).pack(anchor="w", pady=(0, 14))

        ttk.Label(card, text="Public token YummyAnime API", style="Field.TLabel").pack(anchor="w")
        self.token_entry = ttk.Entry(card, textvariable=self.token, show="•")
        self.token_entry.pack(fill="x", pady=(6, 4))
        ttk.Checkbutton(
            card,
            text="Показать ключ",
            variable=self.show_token,
            command=self._toggle_token,
        ).pack(anchor="w")
        ttk.Button(
            card,
            text="Где получить Public token",
            style="Secondary.TButton",
            command=lambda: webbrowser.open(API_DOCUMENTATION_URL),
        ).pack(anchor="w", pady=(8, 18))

        ttk.Label(card, textvariable=self.status, style="Status.TLabel").pack(anchor="w", pady=(0, 12))

        actions = ttk.Frame(card, style="Card.TFrame")
        actions.pack(fill="x")
        self.browser_button = ttk.Button(
            actions,
            text="Открыть сайт",
            style="Accent.TButton",
            command=lambda: self._validate_and_run("browser"),
        )
        self.browser_button.pack(side="left", fill="x", expand=True, padx=(0, 6))
        self.desktop_button = ttk.Button(
            actions,
            text="Открыть десктоп",
            style="Accent.TButton",
            command=lambda: self._validate_and_run("desktop"),
        )
        self.desktop_button.pack(side="left", fill="x", expand=True, padx=(6, 0))
        ttk.Button(
            card,
            text="Только сохранить настройки",
            style="Secondary.TButton",
            command=self._save_without_launch,
        ).pack(fill="x", pady=(12, 0))

        ttk.Label(
            card,
            text=f"Настройки и сохранения: {user_data_root()}",
            style="Text.TLabel",
        ).pack(anchor="w", pady=(18, 0))

    def _toggle_token(self) -> None:
        self.token_entry.configure(show="" if self.show_token.get() else "•")

    def _validated_fields(self) -> tuple[int, str] | None:
        try:
            port = int(self.port.get().strip())
        except ValueError:
            messagebox.showerror("Некорректный порт", "Порт должен быть целым числом.")
            return None
        if not 1024 <= port <= 65535:
            messagebox.showerror("Некорректный порт", "Выбери порт от 1024 до 65535.")
            return None
        token = self.token.get().strip()
        if not token:
            messagebox.showerror(
                "Не указан ключ",
                "Введи личный Public token из документации YummyAnime API.",
            )
            return None
        return port, token

    def _set_busy(self, value: bool) -> None:
        self.busy = value
        state = "disabled" if value else "normal"
        self.browser_button.configure(state=state)
        self.desktop_button.configure(state=state)

    def _save_without_launch(self) -> None:
        fields = self._validated_fields()
        if fields is None:
            return
        port, token = fields
        save_settings(port, token, str(load_settings().get("launch_mode", "browser")))
        self.status.set(f"Сохранено: {config_file()}")

    def _validate_and_run(self, mode: str) -> None:
        if self.busy:
            return
        fields = self._validated_fields()
        if fields is None:
            return
        port, token = fields
        self._set_busy(True)
        self.status.set("Проверяем ключ API…")

        def worker() -> None:
            ok, result = validate_public_token(token)
            self.root.after(0, lambda: self._finish_validation(ok, result, port, token, mode))

        threading.Thread(target=worker, daemon=True).start()

    def _finish_validation(
        self,
        ok: bool,
        result: str,
        port: int,
        token: str,
        mode: str,
    ) -> None:
        self._set_busy(False)
        self.status.set(result)
        if not ok:
            return
        save_settings(port, token, mode)
        command = runtime_command(mode)
        if not Path(command[0]).exists():
            messagebox.showerror(
                "Runtime не найден",
                "Файлы AnimeSoul повреждены. Переустанови приложение.",
            )
            return
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            subprocess.Popen(
                command,
                cwd=str(Path(command[0]).resolve().parent),
                creationflags=creation_flags,
            )
        except OSError as error:
            messagebox.showerror("Ошибка запуска", f"Не удалось запустить AnimeSoul:\n{error}")
            return
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


def main() -> None:
    LauncherWindow().run()


if __name__ == "__main__":
    main()
