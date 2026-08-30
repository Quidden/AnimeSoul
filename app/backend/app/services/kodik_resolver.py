"""Kodik private API client used by offline downloads and direct playback."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import ipaddress
import json
import time
from typing import Any

import httpx

from .kodik_helpers import (
    CredentialVerificationUnavailable,
    OfflineLibraryError,
    _episode_link_from_results,
    _first_kodik_player_link,
    _kodik_player_candidates,
    _kodik_signature,
    _normalise_kodik_skips,
    _normalise_kodik_sources,
    _normalise_kodik_subtitles,
    _private_player_link,
    _search_identifier_name,
    _select_kodik_source,
)


USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AnimeSoul/0.2"
KODIK_VIDEO_LINKS_ENDPOINT = "https://kodikres.com/api/video-links"
KODIK_SEARCH_ENDPOINT = "https://kodik-api.com/search"
PUBLIC_IP_ENDPOINT = "https://api.ipify.org"


class KodikSourceResolver:
    """Resolve a Kodik player link through the account's private API."""

    def __init__(self) -> None:
        self._public_ip: str | None = None
        self._public_ip_expires_at = 0.0

    async def verify_public_key(self, public_key: str) -> dict[str, Any]:
        """Confirm a public token against Kodik and return test material."""

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(15.0, read=25.0),
                follow_redirects=True,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            ) as client:
                response = await client.post(KODIK_SEARCH_ENDPOINT, params={
                    "token": public_key,
                    "title": "Naruto",
                    "types": "anime,anime-serial",
                    "limit": 1,
                    "with_episodes_data": "true",
                })
        except httpx.HTTPError as error:
            raise CredentialVerificationUnavailable(
                "Kodik сейчас недоступен — Public key не удалось проверить."
            ) from error
        if not response.is_success:
            raise OfflineLibraryError(
                f"Kodik отклонил Public key (HTTP {response.status_code})."
            )
        try:
            payload = response.json()
        except json.JSONDecodeError as error:
            raise CredentialVerificationUnavailable(
                "Kodik вернул некорректный ответ при проверке Public key."
            ) from error
        if not isinstance(payload, dict):
            raise CredentialVerificationUnavailable(
                "Kodik вернул ответ неизвестного формата при проверке Public key."
            )
        if payload.get("error"):
            raise OfflineLibraryError(f"Kodik отклонил Public key: {payload['error']}")
        if not isinstance(payload.get("results"), list):
            raise CredentialVerificationUnavailable(
                "Kodik не подтвердил Public key ожидаемым ответом."
            )
        return payload

    async def verify_private_key(
        self,
        public_key: str,
        private_key: str,
        public_payload: dict[str, Any],
    ) -> None:
        """Sign a harmless test video request to confirm the private key pair."""

        link = _first_kodik_player_link(public_payload.get("results"))
        if not link:
            raise CredentialVerificationUnavailable(
                "Public key работает, но Kodik не дал тестовую серию для проверки Private key."
            )
        try:
            ip = await self._current_public_ipv4()
        except OfflineLibraryError as error:
            raise CredentialVerificationUnavailable(str(error)) from error
        deadline = (datetime.now(UTC) + timedelta(hours=6)).strftime("%Y%m%d%H")
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(25.0, read=45.0),
                follow_redirects=True,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            ) as client:
                response = await client.get(KODIK_VIDEO_LINKS_ENDPOINT, params={
                    "link": link,
                    "p": public_key,
                    "ip": ip,
                    "d": deadline,
                    "s": _kodik_signature(link, ip, deadline, private_key),
                    "auto_proxy": "true",
                    "skip_segments": "true",
                })
        except httpx.HTTPError as error:
            raise CredentialVerificationUnavailable(
                "Приватный API Kodik сейчас недоступен — Private key не удалось проверить."
            ) from error
        if not response.is_success:
            raise OfflineLibraryError(self._rejection_message(response))
        try:
            payload = response.json()
        except json.JSONDecodeError as error:
            raise CredentialVerificationUnavailable(
                "Приватный API Kodik вернул некорректный ответ."
            ) from error
        if not isinstance(payload, dict) or payload.get("error") or not payload.get("links"):
            raise OfflineLibraryError(
                "Kodik принял Public key, но не подтвердил Private key прямой ссылкой."
            )

    async def resolve_private_api(
        self,
        embed_url: str,
        quality: int,
        public_key: str,
        private_key: str,
        *,
        source_id: object = None,
        source_id_type: object = None,
        season: object = None,
        episode: object = None,
        translation_id: object = None,
        dubbing: object = None,
        source_title: object = None,
        source_original_title: object = None,
    ) -> tuple[str, int, dict[str, dict[str, float]]]:
        payload = await self._request_private_payload(
            embed_url,
            public_key,
            private_key,
            source_id=source_id,
            source_id_type=source_id_type,
            season=season,
            episode=episode,
            translation_id=translation_id,
            dubbing=dubbing,
            source_title=source_title,
            source_original_title=source_original_title,
        )
        requested_quality = max(144, min(int(quality or 720), 2160))
        source, actual_quality = _select_kodik_source(payload.get("links"), requested_quality)
        return source, actual_quality, _normalise_kodik_skips(payload)

    async def resolve_playback_api(
        self,
        embed_url: str,
        public_key: str,
        private_key: str,
        *,
        source_id: object = None,
        source_id_type: object = None,
        season: object = None,
        episode: object = None,
        translation_id: object = None,
        dubbing: object = None,
        source_title: object = None,
        source_original_title: object = None,
    ) -> dict[str, Any]:
        payload = await self._request_private_payload(
            embed_url,
            public_key,
            private_key,
            source_id=source_id,
            source_id_type=source_id_type,
            season=season,
            episode=episode,
            translation_id=translation_id,
            dubbing=dubbing,
            source_title=source_title,
            source_original_title=source_original_title,
        )
        subtitle_values = [
            value
            for key, value in payload.items()
            if isinstance(key, str) and key.casefold() in {"subtitles", "subtitle", "tracks"}
        ]
        links = payload.get("links")
        if isinstance(links, dict):
            for variants in links.values():
                for variant in (variants if isinstance(variants, list) else [variants]):
                    if not isinstance(variant, dict):
                        continue
                    subtitle_values.extend(
                        value
                        for key, value in variant.items()
                        if isinstance(key, str) and key.casefold() in {"subtitles", "subtitle", "tracks"}
                    )
        return {
            "sources": _normalise_kodik_sources(payload.get("links")),
            "subtitles": _normalise_kodik_subtitles(subtitle_values),
            "skips": _normalise_kodik_skips(payload),
        }

    async def _request_private_payload(
        self,
        embed_url: str,
        public_key: str,
        private_key: str,
        *,
        source_id: object = None,
        source_id_type: object = None,
        season: object = None,
        episode: object = None,
        translation_id: object = None,
        dubbing: object = None,
        source_title: object = None,
        source_original_title: object = None,
    ) -> dict[str, Any]:
        """Request a signed direct URL from Kodik's documented private API.

        Only the local backend receives the private key.  The browser gets
        neither the key nor the signature.
        """

        try:
            raw_link = _private_player_link(embed_url)
        except OfflineLibraryError:
            raw_link = None
        ip = await self._current_public_ipv4()
        deadline = (datetime.now(UTC) + timedelta(hours=6)).strftime("%Y%m%d%H")
        response: httpx.Response | None = None
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(25.0, read=45.0),
                follow_redirects=True,
                headers={"User-Agent": USER_AGENT},
            ) as client:
                # A serial/season embed is meant for an iframe and may be
                # rejected by /api/video-links.  Kodik's documented catalogue
                # endpoint can return the exact /seria link for this selection.
                official_link = await self._official_episode_link(
                    client,
                    public_key,
                    source_id,
                    source_id_type,
                    season,
                    episode,
                    translation_id,
                    dubbing,
                    source_title,
                    source_original_title,
                )
                candidate_links = _kodik_player_candidates(raw_link, official_link)
                if not candidate_links:
                    raise OfflineLibraryError("Не удалось определить ссылку Kodik для выбранной серии.")
                for candidate in candidate_links:
                    params = {
                        "link": candidate,
                        "p": public_key,
                        "ip": ip,
                        "d": deadline,
                        "s": _kodik_signature(candidate, ip, deadline, private_key),
                        "auto_proxy": "true",
                        "skip_segments": "true",
                    }
                    response = await client.get(KODIK_VIDEO_LINKS_ENDPOINT, params=params)
                    if response.is_success:
                        break
                    # A malformed player link can be corrected by dropping a
                    # player-only query string. Auth and permission responses
                    # cannot, so avoid sending an unnecessary second request.
                    if response.status_code not in {400, 404, 422}:
                        break
        except httpx.HTTPError as error:
            raise OfflineLibraryError("Не удалось подключиться к приватному API Kodik.") from error
        if response is None:
            raise OfflineLibraryError("Не удалось получить ответ от приватного API Kodik.")
        if not response.is_success:
            raise OfflineLibraryError(self._rejection_message(response))
        try:
            payload = response.json()
        except json.JSONDecodeError as error:
            raise OfflineLibraryError("Приватное API Kodik вернуло некорректный ответ.") from error
        if not isinstance(payload, dict):
            raise OfflineLibraryError("Приватное API Kodik вернуло ответ неверного формата.")
        if payload.get("error"):
            raise OfflineLibraryError("Kodik не выдал прямую ссылку на выбранную серию.")
        return payload

    @staticmethod
    async def _official_episode_link(
        client: httpx.AsyncClient,
        public_key: str,
        source_id: object,
        source_id_type: object,
        season: object,
        episode: object,
        translation_id: object,
        dubbing: object,
        source_title: object,
        source_original_title: object,
    ) -> str | None:
        """Look up a concrete episode link via Kodik's public catalogue API.

        Failure here deliberately falls back to the original embed URL.  This
        keeps the previous YummyAnime/Kodik embed behaviour as a reserve while
        preferring the supported per-episode API route whenever the app has a
        Shikimori or Kinopoisk id.
        """

        identifier_name = _search_identifier_name(source_id_type)
        identifier = str(source_id or "").strip()
        title = str(source_title or "").strip()
        original_title = str(source_original_title or "").strip()
        if season is None or episode is None:
            return None
        lookups: list[tuple[str, str]] = []
        if identifier_name and identifier:
            lookups.append((identifier_name, identifier))
        # YummyAnime does not provide remote ids for every franchise entry.
        # Kodik documents title search as a supported alternative, so use it
        # as a reliable fallback instead of signing a broad serial iframe.
        if title:
            lookups.append(("title", title))
        if not lookups:
            return None
        for parameter, value in dict.fromkeys(lookups):
            params = {
                "token": public_key,
                parameter: value,
                "with_episodes_data": "true",
            }
            try:
                response = await client.post(KODIK_SEARCH_ENDPOINT, params=params)
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, json.JSONDecodeError):
                continue
            if not isinstance(payload, dict):
                continue
            candidate = _episode_link_from_results(
                payload.get("results"),
                season,
                episode,
                translation_id,
                dubbing,
                title,
                original_title,
            )
            if not candidate:
                continue
            try:
                return _private_player_link(candidate)
            except OfflineLibraryError:
                continue
        return None

    @staticmethod
    def _rejection_message(response: httpx.Response) -> str:
        """Translate safe Kodik rejection hints without exposing a request URL."""

        details = response.text.casefold()
        if "ip" in details or "ipv4" in details:
            return (
                "Kodik отклонил IP в подписи. Отключите VPN/прокси либо подключитесь через IPv4 "
                "и повторите загрузку."
            )
        if "sign" in details or "signature" in details:
            return "Kodik отклонил подпись. Проверьте, что публичный и приватный ключи — одна пара из профиля Kodik."
        if "link" in details or "url" in details:
            return "Kodik не принял ссылку плеера для этой серии. Выберите серию заново и повторите загрузку."
        if response.status_code in {401, 403}:
            return "Kodik не подтвердил доступ к приватному API. Проверьте ключи и права аккаунта Kodik."
        return f"Kodik отклонил запрос прямой ссылки (HTTP {response.status_code})."

    async def _current_public_ipv4(self) -> str:
        if self._public_ip and time.monotonic() < self._public_ip_expires_at:
            return self._public_ip
        try:
            async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": USER_AGENT}) as client:
                response = await client.get(PUBLIC_IP_ENDPOINT)
                response.raise_for_status()
            address = str(ipaddress.ip_address(response.text.strip()))
        except (httpx.HTTPError, ValueError) as error:
            raise OfflineLibraryError(
                "Не удалось определить публичный IPv4 для подписи Kodik. Проверьте подключение и повторите попытку."
            ) from error
        if ":" in address:
            raise OfflineLibraryError("Kodik требует публичный IPv4 для выдачи прямой ссылки.")
        self._public_ip = address
        self._public_ip_expires_at = time.monotonic() + 300
        return address

