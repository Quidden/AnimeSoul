"""Start the bundled AnimeSoul FastAPI runtime inside the Android process."""

from __future__ import annotations

import os
from pathlib import Path
import socket
import threading


_server_thread: threading.Thread | None = None


def _install_android_dns_fallback() -> None:
    """Use Android's resolver when CPython DNS is unavailable in background.

    OAuth returns through an external browser while AnimeSoul is backgrounded.
    On a few Android builds Chaquopy's libc resolver then raises EAI_NODATA even
    though Android itself still resolves the host.  Java's InetAddress uses the
    active Android network directly, so keep it as a narrow fallback.
    """

    original_getaddrinfo = socket.getaddrinfo

    def android_getaddrinfo(
        host: str | bytes | None,
        port: int | str | None,
        family: int = 0,
        socktype: int = 0,
        proto: int = 0,
        flags: int = 0,
    ) -> list[tuple[int, int, int, str, tuple]]:
        try:
            return original_getaddrinfo(host, port, family, socktype, proto, flags)
        except socket.gaierror as original_error:
            if not host or isinstance(host, bytes):
                raise
            try:
                from java.net import InetAddress

                resolved: list[tuple[int, int, int, str, tuple]] = []
                requested_type = socktype or socket.SOCK_STREAM
                requested_proto = proto or (
                    socket.IPPROTO_UDP if requested_type == socket.SOCK_DGRAM else socket.IPPROTO_TCP
                )
                for address in InetAddress.getAllByName(str(host)):
                    value = str(address.getHostAddress())
                    address_family = socket.AF_INET6 if ":" in value else socket.AF_INET
                    if family not in (0, socket.AF_UNSPEC, address_family):
                        continue
                    socket_address: tuple = (
                        (value, port, 0, 0) if address_family == socket.AF_INET6 else (value, port)
                    )
                    resolved.append(
                        (address_family, requested_type, requested_proto, "", socket_address)
                    )
                if resolved:
                    return resolved
            except Exception:
                pass
            raise original_error

    socket.getaddrinfo = android_getaddrinfo


def start(
    data_directory: str,
    frontend_directory: str,
    port: int,
    yummy_public_token: str = "",
    google_client_id: str = "",
    google_client_secret: str = "",
) -> None:
    """Configure Android-owned paths and start Uvicorn exactly once."""

    global _server_thread
    if _server_thread and _server_thread.is_alive():
        return

    data_path = Path(data_directory).resolve()
    frontend_path = Path(frontend_directory).resolve()
    data_path.mkdir(parents=True, exist_ok=True)

    os.environ["ANIMESOUL_MOBILE"] = "android"
    os.environ["ANIMESOUL_DATA_DIR"] = str(data_path)
    os.environ["ANIMESOUL_FRONTEND_DIST"] = str(frontend_path)
    os.environ["ANIMESOUL_PYTHON_PORT"] = str(port)
    os.environ["YUMMYANIME_TOKEN"] = yummy_public_token.strip()
    os.environ["GOOGLE_CLIENT_ID"] = google_client_id.strip()
    os.environ["GOOGLE_CLIENT_SECRET"] = google_client_secret.strip()
    _install_android_dns_fallback()

    def run_server() -> None:
        import uvicorn

        uvicorn.run(
            "backend.app.main:app",
            host="127.0.0.1",
            port=int(port),
            log_level="warning",
            access_log=False,
            loop="asyncio",
        )

    _server_thread = threading.Thread(
        target=run_server,
        name="AnimeSoulLocalServer",
        daemon=True,
    )
    _server_thread.start()
