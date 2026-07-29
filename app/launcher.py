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
from collections.abc import Callable
from pathlib import Path
from tkinter import (
    BooleanVar,
    Canvas,
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


def _draw_rounded_rectangle(
    canvas: Canvas,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    radius: float,
    *,
    fill: str,
    outline: str = "",
    width: int = 1,
    tags: tuple[str, ...] = (),
) -> int:
    """Draw a scalable rounded rectangle using a smooth canvas polygon."""

    radius = max(0.0, min(radius, (x2 - x1) / 2, (y2 - y1) / 2))
    points = (
        x1 + radius,
        y1,
        x2 - radius,
        y1,
        x2,
        y1,
        x2,
        y1 + radius,
        x2,
        y2 - radius,
        x2,
        y2,
        x2 - radius,
        y2,
        x1 + radius,
        y2,
        x1,
        y2,
        x1,
        y2 - radius,
        x1,
        y1 + radius,
        x1,
        y1,
    )
    return canvas.create_polygon(
        points,
        smooth=True,
        splinesteps=24,
        fill=fill,
        outline=outline,
        width=width,
        tags=tags,
    )


class RoundedPanel(Canvas):
    """Rounded container whose ``content`` frame hosts regular Tk widgets."""

    def __init__(
        self,
        parent: Frame,
        *,
        background: str,
        parent_background: str,
        border: str,
        radius: int = 18,
        padding: int = 18,
    ) -> None:
        super().__init__(
            parent,
            background=parent_background,
            highlightthickness=0,
            borderwidth=0,
        )
        self.panel_background = background
        self.border = border
        self.radius = radius
        self.padding = padding
        self.content = Frame(self, background=background)
        self.content_window = self.create_window(
            padding,
            padding,
            anchor="nw",
            window=self.content,
        )
        self.bind("<Configure>", self._redraw)

    def _redraw(self, event: object) -> None:
        width = max(1, event.width)
        height = max(1, event.height)
        self.delete("panel-shape")
        _draw_rounded_rectangle(
            self,
            1,
            1,
            width - 1,
            height - 1,
            self.radius,
            fill=self.panel_background,
            outline=self.border,
            tags=("panel-shape",),
        )
        self.tag_lower("panel-shape")
        self.coords(self.content_window, self.padding, self.padding)
        self.itemconfigure(
            self.content_window,
            width=max(1, width - self.padding * 2),
            height=max(1, height - self.padding * 2),
        )


class RoundedEntry(Frame):
    """Entry field with a real rounded canvas border."""

    def __init__(
        self,
        parent: Frame,
        variable: StringVar,
        *,
        show: str = "",
        height: int = 43,
    ) -> None:
        super().__init__(parent, background="#17131f", height=height)
        self.pack_propagate(False)
        self.canvas = Canvas(
            self,
            background="#17131f",
            highlightthickness=0,
            borderwidth=0,
            height=height,
        )
        self.canvas.pack(fill="both", expand=True)
        self.entry = Entry(
            self.canvas,
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
            highlightthickness=0,
            font=("Segoe UI", 11),
        )
        self.entry_window = self.canvas.create_window(
            13,
            height / 2,
            anchor="w",
            window=self.entry,
        )
        self.canvas.bind("<Configure>", self._redraw)
        self.entry.bind("<FocusIn>", lambda _event: self._redraw_border(True))
        self.entry.bind("<FocusOut>", lambda _event: self._redraw_border(False))

    def _redraw(self, event: object) -> None:
        self.canvas.delete("entry-shape")
        _draw_rounded_rectangle(
            self.canvas,
            1,
            1,
            max(2, event.width - 1),
            max(2, event.height - 1),
            11,
            fill="#211c2b",
            outline="#514360",
            tags=("entry-shape",),
        )
        self.canvas.tag_lower("entry-shape")
        self.canvas.coords(self.entry_window, 13, event.height / 2)
        self.canvas.itemconfigure(self.entry_window, width=max(1, event.width - 26))

    def _redraw_border(self, focused: bool) -> None:
        self.canvas.itemconfigure(
            "entry-shape",
            outline="#9d78ff" if focused else "#514360",
        )

    def configure(self, **kwargs: object) -> None:
        self.entry.configure(**kwargs)


class RoundedButton(Canvas):
    """Canvas button with rounded corners and a small Button-compatible API."""

    def __init__(
        self,
        parent: Frame,
        text: str,
        command: Callable[[], None],
        *,
        accent: bool,
        compact: bool,
    ) -> None:
        self.normal = "#8f63ff" if accent else "#211c2b"
        self.hover = "#a582ff" if accent else "#2c2538"
        self.disabled = "#392f49"
        self.border = "#9d78ff" if accent else "#514360"
        self.text_color = "#ffffff" if accent else "#e9e2f1"
        self.command = command
        self.state = "normal"
        self.label = text
        height = 35 if compact else 47
        super().__init__(
            parent,
            background=str(parent.cget("background")),
            highlightthickness=0,
            borderwidth=0,
            height=height,
            cursor="hand2",
        )
        self.font = ("Segoe UI Semibold", 9 if compact else 11)
        self.radius = 10 if compact else 13
        self.current_fill = self.normal
        self.bind("<Configure>", self._redraw)
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<Button-1>", self._on_click)

    def _redraw(self, _event: object | None = None) -> None:
        width = max(1, self.winfo_width())
        height = max(1, self.winfo_height())
        self.delete("all")
        _draw_rounded_rectangle(
            self,
            1,
            1,
            width - 1,
            height - 1,
            self.radius,
            fill=self.disabled if self.state == "disabled" else self.current_fill,
            outline=self.border,
        )
        self.create_text(
            width / 2,
            height / 2,
            text=self.label,
            fill="#81778c" if self.state == "disabled" else self.text_color,
            font=self.font,
        )

    def _on_enter(self, _event: object) -> None:
        if self.state != "disabled":
            self.current_fill = self.hover
            self._redraw()

    def _on_leave(self, _event: object) -> None:
        self.current_fill = self.normal
        self._redraw()

    def _on_click(self, _event: object) -> None:
        if self.state != "disabled":
            self.command()

    def configure(self, **kwargs: object) -> None:
        if "state" in kwargs:
            self.state = str(kwargs["state"])
        if "text" in kwargs:
            self.label = str(kwargs["text"])
        self._redraw()

    def cget(self, key: str) -> object:
        if key == "state":
            return self.state
        return super().cget(key)


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
        self.action_buttons: list[RoundedButton] = []

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
        card_panel = RoundedPanel(
            shell,
            background="#17131f",
            parent_background="#09080e",
            border="#514360",
            radius=22,
            padding=28,
        )
        card_panel.pack(fill="both", expand=True)
        card = card_panel.content

        brand = Frame(card, background="#17131f")
        brand.pack(fill="x", pady=(0, 4))
        logo = Canvas(
            brand,
            background="#17131f",
            highlightthickness=0,
            borderwidth=0,
            width=38,
            height=38,
        )
        logo.pack(side="left", padx=(0, 12))
        _draw_rounded_rectangle(
            logo,
            1,
            1,
            37,
            37,
            10,
            fill="#8f63ff",
        )
        logo.create_text(
            19,
            19,
            text="魂",
            fill="#ffffff",
            font=("Segoe UI Semibold", 17),
        )
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
        self.port_entry.pack(fill="x", pady=(6, 4))
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
        self.token_entry.pack(fill="x", pady=(6, 6))

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
    ) -> RoundedEntry:
        entry = RoundedEntry(parent, variable, show=show)
        self._bind_entry_shortcuts(entry.entry)
        return entry

    def _create_button(
        self,
        parent: Frame,
        text: str,
        command: Callable[[], None],
        *,
        accent: bool,
        compact: bool = False,
    ) -> RoundedButton:
        button = RoundedButton(
            parent,
            text,
            command,
            accent=accent,
            compact=compact,
        )
        self.action_buttons.append(button)
        return button

    def _bind_entry_shortcuts(self, entry: Entry) -> None:
        # Virtual-key codes stay stable when the active keyboard layout changes.
        entry.bind("<Control-KeyPress>", self._control_entry_shortcut)
        entry.bind("<Shift-Insert>", self._paste_entry)
        entry.bind("<Control-Insert>", self._copy_entry)
        entry.bind("<Button-3>", self._show_context_menu)

    def _control_entry_shortcut(self, event: object) -> str | None:
        """Handle edit shortcuts by physical Windows virtual-key code."""

        keycode = int(getattr(event, "keycode", 0))
        if keycode == 86:  # VK_V
            return self._paste_entry(event)
        if keycode == 67:  # VK_C
            return self._copy_entry(event)
        if keycode == 88:  # VK_X
            return self._cut_entry(event)
        if keycode == 65:  # VK_A
            return self._select_all_entry(event)
        return None

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
