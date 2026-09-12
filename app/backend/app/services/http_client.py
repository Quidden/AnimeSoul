"""Shared lifecycle for lazily-created HTTPX clients."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx


class LazyAsyncClient:
    """Create one HTTP client on demand and close it safely during shutdown."""

    def __init__(self, **options: Any) -> None:
        self._options = options
        self._client: httpx.AsyncClient | None = None
        self._lock = asyncio.Lock()

    async def get(self) -> httpx.AsyncClient:
        if self._client is not None:
            return self._client
        async with self._lock:
            if self._client is None:
                self._client = httpx.AsyncClient(**self._options)
        return self._client

    async def close(self) -> None:
        client, self._client = self._client, None
        if client is not None:
            await client.aclose()
