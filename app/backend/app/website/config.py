"""Deployment settings; never derive security decisions from request headers."""

from dataclasses import dataclass
import os
from urllib.parse import urlsplit

from ..config import settings as local_settings  # noqa: F401 -- load optional .env


@dataclass(frozen=True)
class WebsiteSettings:
    database_url: str = ""
    origin: str = "http://localhost:5173"
    development: bool = False
    google_client_id: str = ""
    google_client_secret: str = ""
    owner_email: str = ""
    giphy_api_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_tls: bool = True

    @property
    def secure(self) -> bool:
        return not self.development

    @property
    def cookie(self) -> str:
        return "__Host-animesoul_session" if self.secure else "animesoul_session_dev"

    @property
    def csrf_cookie(self) -> str:
        return "__Host-animesoul_csrf" if self.secure else "animesoul_csrf"

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def mail_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_from)

    def validate(self) -> None:
        parsed = urlsplit(self.origin)
        if not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username:
            raise RuntimeError("ANIMESOUL_PUBLIC_ORIGIN must be an origin without a path")
        if self.development:
            if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"localhost", "127.0.0.1"}:
                raise RuntimeError("Website development mode is restricted to loopback origins")
        elif parsed.scheme != "https" or not self.database_url.startswith("postgresql+psycopg://"):
            raise RuntimeError("Hosted production requires HTTPS and PostgreSQL (psycopg)")
        if not self.database_url:
            raise RuntimeError("ANIMESOUL_DATABASE_URL is required in website mode")
        if bool(self.google_client_id) != bool(self.google_client_secret):
            raise RuntimeError("Configure both website Google OAuth credentials")
        if not self.development and self.mail_enabled and not self.smtp_tls:
            raise RuntimeError("Production SMTP requires TLS")


def load_website_settings() -> WebsiteSettings:
    return WebsiteSettings(
        database_url=os.getenv("ANIMESOUL_DATABASE_URL", ""),
        origin=os.getenv("ANIMESOUL_PUBLIC_ORIGIN", "http://localhost:5173").rstrip("/"),
        development=os.getenv("ANIMESOUL_WEBSITE_DEVELOPMENT", "0") == "1",
        google_client_id=os.getenv("ANIMESOUL_AUTH_GOOGLE_CLIENT_ID", ""),
        google_client_secret=os.getenv("ANIMESOUL_AUTH_GOOGLE_CLIENT_SECRET", ""),
        owner_email=os.getenv("ANIMESOUL_OWNER_EMAIL", "").strip().lower(),
        giphy_api_key=os.getenv("ANIMESOUL_GIPHY_API_KEY", "").strip(),
        smtp_host=os.getenv("ANIMESOUL_SMTP_HOST", ""),
        smtp_port=int(os.getenv("ANIMESOUL_SMTP_PORT", "587")),
        smtp_user=os.getenv("ANIMESOUL_SMTP_USER", ""),
        smtp_password=os.getenv("ANIMESOUL_SMTP_PASSWORD", ""),
        smtp_from=os.getenv("ANIMESOUL_SMTP_FROM", ""),
        smtp_tls=os.getenv("ANIMESOUL_SMTP_TLS", "1") == "1",
    )
