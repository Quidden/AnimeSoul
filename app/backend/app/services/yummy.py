"""Typed gateway to the public YummyAnime API."""

from __future__ import annotations

from typing import Any

import httpx


class YummyAnimeGateway:
    """Hide upstream URL, headers, normalization and timeout policy."""

    base_url = "https://api.yani.tv"

    def __init__(self, token: str) -> None:
        self.token = token

    @property
    def headers(self) -> dict[str, str]:
        return {"X-Application": self.token, "Lang": "ru", "Accept": "application/json"}

    async def request(self, path: str, params: dict[str, Any] | None = None) -> Any:
        if not self.token:
            raise RuntimeError("YummyAnime token is not configured")
        async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
            response = await client.get(f"{self.base_url}{path}", params=params, headers=self.headers)
            response.raise_for_status()
            return self._normalize(response.json().get("response"))

    def _normalize(self, value: Any) -> Any:
        """Convert protocol-relative media URLs recursively."""

        if isinstance(value, str) and value.startswith("//"):
            return f"https:{value}"
        if isinstance(value, list):
            return [self._normalize(item) for item in value]
        if isinstance(value, dict):
            return {key: self._normalize(item) for key, item in value.items()}
        return value
