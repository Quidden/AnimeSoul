"""Stream and verify complete MP4 episodes before registering local downloads."""
from __future__ import annotations

import asyncio
import hashlib
import shutil
import tempfile
import time
import uuid
from pathlib import Path

from fastapi import HTTPException

from .lan_models import EpisodeManifest
from .lan_protocol import PeerClient
from .offline_library import _anime_folder_name, _is_android_runtime, _safe_name, _sanitize_skip_segments


def checksum(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


async def export_path(library, episode_id, kind):
    try:
        if kind == "poster":
            directory = await library._directory()
            index = await library._read_index(directory)
            row = next(row for row in index["episodes"] if row["id"] == episode_id)
            return await library.poster_path(row["animeId"])
        if kind not in {"media", "preview"}:
            raise KeyError(kind)
        path = await library.media_path(episode_id, kind)
        if kind == "media" and path.suffix.lower() != ".mp4":
            raise HTTPException(422, "Перенос старых HLS-пакетов не поддерживается. Скачайте серию в MP4.")
        return path
    except (KeyError, StopIteration) as error:
        raise HTTPException(404, "Файл серии не найден.") from error


async def export_episode(library, episode_id):
    directory = await library._directory()
    index = await library._read_index(directory)
    row = next((row for row in index["episodes"] if row["id"] == episode_id), None)
    if row is None:
        raise HTTPException(404, "Серия не найдена.")
    files = {}
    for kind in ("media", "poster", "preview"):
        try:
            path = await export_path(library, episode_id, kind)
        except HTTPException as error:
            if kind == "media" or error.status_code != 404:
                raise
            continue
        files[kind] = {"size": path.stat().st_size, "sha256": await asyncio.to_thread(checksum, path)}
    manifest = EpisodeManifest(episode=row, files=files)
    return manifest.model_dump() if hasattr(manifest, "model_dump") else manifest.dict()


async def register_episode(library, manifest, staged, directory):
    """Use the normal ID and MediaStore path; never accept paths from a peer."""
    meta = manifest.episode
    record = meta.model_dump() if hasattr(meta, "model_dump") else meta.dict()
    eid = hashlib.sha256(f"{meta.animeId}|{meta.season}|{meta.episode}|{meta.dubbing}|{meta.quality}".encode()).hexdigest()[:24]
    index = await library._read_index(directory)
    if any(r["id"] == eid and library._existing_episode(directory, r) for r in index["episodes"]):
        return eid
    folder = _anime_folder_name(record)
    season_folder = f"Сезон {meta.season:02d}"
    # Unique folder prevents an in-flight ordinary download from overwriting us.
    relative_dir = Path(folder) / season_folder / f"lan-{uuid.uuid4().hex[:12]}"
    target_dir = library._path_within(directory, str(relative_dir))
    await asyncio.to_thread(target_dir.mkdir, parents=True, exist_ok=True)
    media_name = _safe_name(f"{folder} — {meta.episode} — {meta.dubbing} — {meta.quality}p", eid) + ".mp4"
    published_uri = None
    committed = False
    try:
        for kind, source in staged.items():
            target = target_dir / (media_name if kind == "media" else kind + ".jpg")
            await asyncio.to_thread(source.replace, target)
        record.update(id=eid, file=str(relative_dir / media_name), mediaType="video/mp4",
                      downloadedAt=int(time.time() * 1000), sizeBytes=manifest.files["media"].size,
                      poster=str(relative_dir / "poster.jpg") if "poster" in staged else None,
                      preview=str(relative_dir / "preview.jpg") if "preview" in staged else None,
                      skips=_sanitize_skip_segments(meta.skips, meta.duration))
        if _is_android_runtime():
            published = await asyncio.to_thread(library._publish_android_video, target_dir / media_name,
                                                folder, season_folder, media_name)
            published_uri = str(published.get("uri") or "")
            external_path = str(published.get("path") or "")
            if not published_uri or not external_path:
                raise ValueError("Android не вернул путь к сохранённому MP4.")
            record.update(contentUri=published_uri, externalPath=external_path)
            await asyncio.to_thread((target_dir / media_name).unlink)
        await library._upsert_episode(directory, record)
        committed = True
        return eid
    finally:
        if not committed:
            if published_uri:
                await asyncio.to_thread(library._delete_android_content, published_uri)
            await asyncio.to_thread(shutil.rmtree, target_dir)


async def receive(service, transfer, episode_ids):
    library = service.library
    try:
        async with service.transfer_lock:
            transfer["status"] = "downloading"
            peer = service.peer(transfer["peerId"])
            if not peer["media"]:
                raise ValueError("Обмен видео с устройством отключён.")
            directory = await library._directory()
            async with PeerClient(service.config["id"], peer) as client:
                for episode_id in episode_ids:
                    service.peer(transfer["peerId"])
                    manifest = EpisodeManifest(**await client.json("GET", f"/episode/{episode_id}"))
                    transfer["title"] = f"{manifest.episode.title} · {manifest.episode.episode}"
                    transfer["bytes"] = 0
                    transfer["totalBytes"] = sum(f.size for f in manifest.files.values())
                    if shutil.disk_usage(directory).free < transfer["totalBytes"] * (2 if _is_android_runtime() else 1) + 64 * 1024**2:
                        raise ValueError("Недостаточно места для серии.")
                    with tempfile.TemporaryDirectory(prefix=".lan-", dir=directory) as temporary:
                        staged = {}
                        for kind, metadata in manifest.files.items():
                            path = f"/file/{episode_id}/{kind}"
                            headers = await client.headers("GET", path)
                            target = Path(temporary) / kind
                            digest, size = hashlib.sha256(), 0
                            async with client.client.stream("GET", client.base + path, headers=headers) as response:
                                response.raise_for_status()
                                with target.open("wb") as output:
                                    async for chunk in response.aiter_bytes(1024 * 1024):
                                        if not service.peer(transfer["peerId"])["media"]:
                                            raise ValueError("Обмен видео отключён.")
                                        size += len(chunk)
                                        if size > metadata.size:
                                            raise ValueError("Размер файла не совпадает с описанием.")
                                        digest.update(chunk)
                                        await asyncio.to_thread(output.write, chunk)
                                        transfer["bytes"] += len(chunk)
                            if size != metadata.size or digest.hexdigest() != metadata.sha256:
                                raise ValueError("Файл передан не полностью или повреждён. Повторите передачу.")
                            staged[kind] = target
                        # Finish publication/index commit even if cancellation arrives here.
                        commit = asyncio.create_task(register_episode(library, manifest, staged, directory))
                        try:
                            await asyncio.shield(commit)
                        except asyncio.CancelledError:
                            await commit
                            raise
                    transfer["completed"] += 1
            transfer["status"] = "completed"
    except asyncio.CancelledError:
        transfer["status"] = "cancelled"
    except Exception as error:
        transfer.update(status="error", error=str(error)[:300])
    finally:
        service.transfer_tasks.pop(transfer["id"], None)
