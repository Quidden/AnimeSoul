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
from tkinter import (
    BooleanVar,
    Button,
    Entry,
    Frame,
    Label,
    Menu,
    StringVar,
    TclError,
    Tk,
    messagebox,
)


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
        self.root.geometry("720x700")
        self.root.minsize(660, 650)
        self.root.configure(background="#09080e")

        self.port = StringVar(value=str(settings.get("port", DEFAULT_PORT)))
        self.token = StringVar(value=str(settings.get("yummy_public_token", "")))
        self.show_token = BooleanVar(value=False)
        self.status = StringVar(value="Готово к запуску")
        self.busy = False
        self.action_buttons: list[Button] = []

        self.context_menu = Menu(
            self.root,
            tearoff=False,
            background="#211c2b",
            foreground="#f7f3ff",
            activebackground="#8f63ff",
            activeforeground="#ffffff",
            borderwidth=0,
            font=("Segoe UI", 10),
        )
        self.context_menu.add_command(label="Вырезать", command=self._cut_active_entry)
        self.context_menu.add_command(label="Копировать", command=self._copy_active_entry)
        self.context_menu.add_command(label="Вставить", command=self._paste_active_entry)
        self.context_menu.add_separator()
        self.context_menu.add_command(label="Выделить всё", command=self._select_all_active_entry)
        self.active_entry: Entry | None = None

        self._build()

    def _build(self) -> None:
        shell = Frame(self.root, background="#09080e", padx=24, pady=22)
        shell.pack(fill="both", expand=True)
        card_border = Frame(
            shell,
            background="#17131f",
            highlightbackground="#3b3150",
            highlightcolor="#8f63ff",
            highlightthickness=1,
        )
        card_border.pack(fill="both", expand=True)
        card = Frame(card_border, background="#17131f", padx=30, pady=24)
        card.pack(fill="both", expand=True)

        brand = Frame(card, background="#17131f")
        brand.pack(fill="x", pady=(0, 4))
        Label(
            brand,
            text="魂",
            background="#8f63ff",
            foreground="#ffffff",
            font=("Segoe UI Semibold", 17),
            width=2,
            height=1,
        ).pack(side="left", padx=(0, 12))
        Label(
            brand,
            text="AnimeSoul",
            background="#17131f",
            foreground="#f8f5ff",
            font=("Segoe UI Semibold", 24),
        ).pack(side="left")
        Label(
            card,
            text="Локальная аниме-библиотека · Python + React",
            background="#17131f",
            foreground="#a89fb5",
            font=("Segoe UI", 10),
        ).pack(anchor="w", pady=(0, 16))

        Label(
            card,
            text=(
                "Огромное спасибо разработчикам YummyAnime за открытый API — "
                "благодаря им стало возможным создание AnimeSoul."
            ),
            background="#17131f",
            foreground="#c9c1d4",
            font=("Segoe UI", 10),
            justify="left",
            wraplength=620,
        ).pack(anchor="w", pady=(0, 8))
        Label(
            card,
            text=(
                "Для запуска нужен личный Public token. Общий ключ не входит в "
                "open-source проект, чтобы не создавать лишнюю нагрузку на API."
            ),
            background="#17131f",
            foreground="#a89fb5",
            font=("Segoe UI", 10),
            justify="left",
            wraplength=620,
        ).pack(anchor="w", pady=(0, 16))

        Label(
            card,
            text="Порт сайта",
            background="#17131f",
            foreground="#f3eef9",
            font=("Segoe UI Semibold", 10),
        ).pack(anchor="w")
        self.port_entry = self._create_entry(card, self.port)
        self.port_entry.pack(fill="x", pady=(6, 4), ipady=9)
        Label(
            card,
            text="По умолчанию 3001 · допустимый диапазон: 1024–65535",
            background="#17131f",
            foreground="#82798f",
            font=("Segoe UI", 9),
        ).pack(anchor="w", pady=(0, 12))

        Label(
            card,
            text="Public token YummyAnime API",
            background="#17131f",
            foreground="#f3eef9",
            font=("Segoe UI Semibold", 10),
        ).pack(anchor="w")
        self.token_entry = self._create_entry(card, self.token, show="•")
        self.token_entry.pack(fill="x", pady=(6, 6), ipady=9)

        token_actions = Frame(card, background="#17131f")
        token_actions.pack(fill="x", pady=(0, 14))
        self.show_token_button = self._create_button(
            token_actions,
            "Показать ключ",
            self._toggle_token,
            accent=False,
            compact=True,
        )
        self.show_token_button.pack(side="left")
        docs_button = self._create_button(
            token_actions,
            "Где получить ключ ↗",
            lambda: webbrowser.open(API_DOCUMENTATION_URL),
            accent=False,
            compact=True,
        )
        docs_button.pack(side="left", padx=(8, 0))

        status_row = Frame(card, background="#17131f")
        status_row.pack(fill="x", pady=(0, 12))
        Label(
            status_row,
            text="●",
            background="#17131f",
            foreground="#8f63ff",
            font=("Segoe UI", 9),
        ).pack(side="left", padx=(0, 7))
        Label(
            status_row,
            textvariable=self.status,
            background="#17131f",
            foreground="#aa8bff",
            font=("Segoe UI Semibold", 10),
        ).pack(side="left")

        actions = Frame(card, background="#17131f")
        actions.pack(fill="x")
        self.browser_button = self._create_button(
            actions,
            "Открыть сайт",
            lambda: self._validate_and_run("browser"),
            accent=True,
        )
        self.browser_button.pack(side="left", fill="x", expand=True, padx=(0, 6))
        self.desktop_button = self._create_button(
            actions,
            "Открыть десктоп",
            lambda: self._validate_and_run("desktop"),
            accent=True,
        )
        self.desktop_button.pack(side="left", fill="x", expand=True, padx=(6, 0))
        save_button = self._create_button(
            card,
            "Сохранить настройки",
            self._save_without_launch,
            accent=False,
        )
        save_button.pack(fill="x", pady=(10, 0))

        Label(
            card,
            text=f"Данные сохраняются в {user_data_root()}",
            background="#17131f",
            foreground="#71697c",
            font=("Segoe UI", 8),
        ).pack(anchor="w", pady=(12, 0))

    def _create_entry(
        self,
        parent: Frame,
        variable: StringVar,
        *,
        show: str = "",
    ) -> Entry:
        entry = Entry(
            parent,
            textvariable=variable,
            show=show,
            background="#211c2b",
            foreground="#ffffff",
            insertbackground="#ffffff",
            selectbackground="#8f63ff",
            selectforeground="#ffffff",
            disabledbackground="#211c2b",
            disabledforeground="#7d7488",
            relief="flat",
            borderwidth=0,
            highlightthickness=1,
            highlightbackground="#514360",
            highlightcolor="#9d78ff",
            font=("Segoe UI", 11),
        )
        self._bind_entry_shortcuts(entry)
        return entry

    def _create_button(
        self,
        parent: Frame,
        text: str,
        command: object,
        *,
        accent: bool,
        compact: bool = False,
    ) -> Button:
        normal = "#8f63ff" if accent else "#211c2b"
        hover = "#a582ff" if accent else "#2c2538"
        button = Button(
            parent,
            text=text,
            command=command,
            background=normal,
            foreground="#ffffff" if accent else "#e9e2f1",
            activebackground=hover,
            activeforeground="#ffffff",
            disabledforeground="#81778c",
            relief="flat",
            borderwidth=0,
            highlightthickness=1,
            highlightbackground="#8f63ff" if accent else "#514360",
            highlightcolor="#a582ff",
            cursor="hand2",
            font=("Segoe UI Semibold", 9 if compact else 11),
            padx=13 if compact else 16,
            pady=7 if compact else 11,
        )
        button.bind(
            "<Enter>",
            lambda _event: (
                button.configure(background=hover)
                if str(button.cget("state")) != "disabled"
                else None
            ),
        )
        button.bind(
            "<Leave>",
            lambda _event: (
                button.configure(background=normal)
                if str(button.cget("state")) != "disabled"
                else None
            ),
        )
        self.action_buttons.append(button)
        return button

    def _bind_entry_shortcuts(self, entry: Entry) -> None:
        entry.bind("<Control-v>", self._paste_entry)
        entry.bind("<Control-V>", self._paste_entry)
        entry.bind("<Shift-Insert>", self._paste_entry)
        entry.bind("<Control-c>", self._copy_entry)
        entry.bind("<Control-C>", self._copy_entry)
        entry.bind("<Control-x>", self._cut_entry)
        entry.bind("<Control-X>", self._cut_entry)
        entry.bind("<Control-a>", self._select_all_entry)
        entry.bind("<Control-A>", self._select_all_entry)
        entry.bind("<Button-3>", self._show_context_menu)

    def _show_context_menu(self, event: object) -> str:
        entry = event.widget
        self.active_entry = entry
        entry.focus_set()
        entry.icursor(f"@{event.x}")
        try:
            self.context_menu.tk_popup(event.x_root, event.y_root)
        finally:
            self.context_menu.grab_release()
        return "break"

    def _paste_entry(self, event: object) -> str:
        self._paste_into(event.widget)
        return "break"

    def _paste_into(self, entry: Entry) -> None:
        try:
            text = self.root.clipboard_get()
        except TclError:
            self.root.bell()
            return
        try:
            entry.delete("sel.first", "sel.last")
        except TclError:
            pass
        entry.insert("insert", text)

    def _copy_entry(self, event: object) -> str:
        self._copy_from(event.widget)
        return "break"

    def _copy_from(self, entry: Entry) -> None:
        try:
            text = entry.get()[entry.index("sel.first") : entry.index("sel.last")]
        except TclError:
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(text)

    def _cut_entry(self, event: object) -> str:
        self._copy_from(event.widget)
        try:
            event.widget.delete("sel.first", "sel.last")
        except TclError:
            pass
        return "break"

    def _select_all_entry(self, event: object) -> str:
        self._select_all(event.widget)
        return "break"

    @staticmethod
    def _select_all(entry: Entry) -> None:
        entry.selection_range(0, "end")
        entry.icursor("end")

    def _paste_active_entry(self) -> None:
        if self.active_entry is not None:
            self._paste_into(self.active_entry)

    def _copy_active_entry(self) -> None:
        if self.active_entry is not None:
            self._copy_from(self.active_entry)

    def _cut_active_entry(self) -> None:
        if self.active_entry is not None:
            self._copy_from(self.active_entry)
            try:
                self.active_entry.delete("sel.first", "sel.last")
            except TclError:
                pass

    def _select_all_active_entry(self) -> None:
        if self.active_entry is not None:
            self._select_all(self.active_entry)

    def _toggle_token(self) -> None:
        visible = not self.show_token.get()
        self.show_token.set(visible)
        self.token_entry.configure(show="" if visible else "•")
        self.show_token_button.configure(text="Скрыть ключ" if visible else "Показать ключ")

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
        for button in self.action_buttons:
            button.configure(state=state)

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
