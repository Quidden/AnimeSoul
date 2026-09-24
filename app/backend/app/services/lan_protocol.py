"""Small authenticated LAN protocol; no discovery broadcasts or cloud services."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import secrets
import time

import httpx


PORT = 48765
MAX_JSON = 8 * 1024 * 1024


def local_address(value: str) -> str:
    address = ipaddress.ip_address(value.strip())
    networks = ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16")
    if address.version != 4 or not any(address in ipaddress.ip_network(n) for n in networks):
        raise ValueError("Введите локальный IPv4-адрес устройства (например, 192.168.1.20).")
    return str(address)


def encode(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def signature(key: str, context: str, body: bytes) -> str:
    return hmac.new(key.encode(), context.encode() + b"\n" + body, hashlib.sha256).hexdigest()


class Challenges:
    def __init__(self):
        self.pending: dict[str, float] = {}

    def issue(self) -> str:
        now = time.monotonic()
        self.pending = {n: t for n, t in self.pending.items() if t > now}
        if len(self.pending) >= 256:
            raise ValueError("Слишком много запросов подключения. Повторите позже.")
        nonce = secrets.token_hex(24)
        self.pending[nonce] = now + 60
        return nonce

    def consume(self, nonce: str) -> bool:
        return self.pending.pop(nonce, 0) > time.monotonic()


async def limited_json(response: httpx.Response) -> bytes:
    chunks = bytearray()
    async for chunk in response.aiter_bytes():
        if len(chunks) + len(chunk) > MAX_JSON:
            raise ValueError("Ответ устройства слишком большой.")
        chunks.extend(chunk)
    if not response.is_success:
        try:
            detail = json.loads(chunks).get("detail")
        except (ValueError, AttributeError):
            detail = None
        if isinstance(detail, str):
            raise ValueError(detail)
        response.raise_for_status()
    return bytes(chunks)


class PeerClient:
    def __init__(self, device_id: str, peer: dict):
        self.device_id = device_id
        self.peer = peer
        self.base = f"http://{local_address(peer['host'])}:{int(peer.get('port', PORT))}"
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(30, connect=5), trust_env=False, follow_redirects=False)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        await self.client.aclose()

    async def headers(self, method: str, path: str, body: bytes = b"") -> dict[str, str]:
        async with self.client.stream("GET", self.base + "/challenge") as response:
            nonce = json.loads(await limited_json(response))["nonce"]
        if not isinstance(nonce, str) or len(nonce) != 48:
            raise ValueError("Несовместимый протокол устройства.")
        context = f"{method}\n{path}\n{self.device_id}\n{nonce}"
        return {"X-AS-Device": self.device_id, "X-AS-Nonce": nonce,
                "X-AS-Signature": signature(self.peer["key"], context, body), "Content-Type": "application/json"}

    async def json(self, method: str, path: str, value: object = None):
        body = encode(value) if value is not None else b""
        headers = await self.headers(method, path, body)
        async with self.client.stream(method, self.base + path, headers=headers, content=body,
                                      timeout=180 if path.startswith("/episode/") else 30) as response:
            raw = await limited_json(response)
            expected = signature(self.peer["key"], "response\n" + headers["X-AS-Nonce"], raw)
            if not hmac.compare_digest(response.headers.get("X-AS-Signature", ""), expected):
                raise ValueError("Подпись устройства не совпадает. Проверьте привязку.")
        return json.loads(raw)
