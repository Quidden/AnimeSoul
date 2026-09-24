"""Version-one LAN payloads, compatible with desktop and Android Pydantic."""
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, validator


class PairIdentity(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=80)

    @validator("id")
    def valid_id(cls, value):
        return str(UUID(value))


class ControlCommand(BaseModel):
    action: Literal["play", "pause", "seek", "open", "episode", "next", "previous"]
    animeId: int | None = Field(default=None, ge=1)
    season: int = Field(default=1, ge=1, le=99)
    episode: str = Field(default="1", min_length=1, max_length=40)
    dubbing: str = Field(default="", max_length=160)
    seconds: float = Field(default=0, ge=0, le=604800, allow_inf_nan=False)


class EpisodeMetadata(BaseModel):
    animeId: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=300)
    year: int | None = None
    season: int = Field(ge=1, le=99)
    seasonLabel: str | None = Field(default=None, max_length=300)
    episode: str = Field(min_length=1, max_length=40)
    originAnimeId: int | None = Field(default=None, ge=1)
    originEpisode: str | None = Field(default=None, max_length=40)
    dubbing: str = Field(min_length=1, max_length=160)
    translationId: int | str | None = None
    quality: int = Field(ge=144, le=2160)
    duration: float | None = Field(default=None, ge=0, le=604800, allow_inf_nan=False)
    skips: dict = Field(default_factory=dict)


class FileMetadata(BaseModel):
    size: int = Field(ge=1, le=50 * 1024**3)
    sha256: str = Field(min_length=64, max_length=64)

    @validator("sha256")
    def valid_hash(cls, value):
        if any(c not in "0123456789abcdef" for c in value):
            raise ValueError("Invalid SHA-256")
        return value


class EpisodeManifest(BaseModel):
    episode: EpisodeMetadata
    files: dict[str, FileMetadata]

    @validator("files")
    def valid_files(cls, value):
        if "media" not in value or set(value) - {"media", "poster", "preview"}:
            raise ValueError("Invalid episode file set")
        if any(f.size > 20 * 1024**2 for k, f in value.items() if k != "media"):
            raise ValueError("Artwork too large")
        return value
