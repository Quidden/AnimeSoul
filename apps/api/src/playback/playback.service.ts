import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { playbackSchema, type ProviderPlaybackSource } from "@animesoul/contracts";
import { CatalogService } from "../catalog/catalog.service.js";
import { ProvidersService, ProviderUnavailable } from "../providers/providers.service.js";
import {
  normalizeYummyAnime,
  normalizeYummyVideos,
  normalizeKodikVideos,
  record,
  yummyRows,
} from "../providers/normalizers.js";
import { normalizeKodikAnime, sameMaterial } from "../providers/kodik-catalog.js";
import { EpisodeService } from "./episode.service.js";
@Injectable()
export class PlaybackService {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(ProvidersService) private readonly providers: ProvidersService,
    @Inject(EpisodeService) private readonly episodes: EpisodeService,
  ) {}
  async find(slug: string) {
    const anime = await this.catalog.find(slug);
    if (!anime) return undefined;
    const references = await this.catalog.providerReferences(anime.id);
    const canonical = references.find((ref) => ref.provider === "kodik-material")?.externalId;
    const shikimori = canonical?.startsWith("shikimori:")
      ? canonical.slice(10)
      : references.find((ref) => ref.provider === "shikimori")?.externalId;
    const kp = canonical?.startsWith("kinopoisk:")
      ? canonical.slice(10)
      : references.find((ref) => ref.provider === "kinopoisk")?.externalId;
    const revision = await this.providers.revision();
    const states = {
      kodik: await this.providers.state("kodik"),
      yummy: await this.providers.state("yummy"),
    };
    let sources: ProviderPlaybackSource[] = [];
    const usable = (items: ProviderPlaybackSource[]) =>
      items.filter((source) => !this.providers.hidesCredential(source.embedUrl));
    if (states.kodik === "enabled") {
      try {
        const lookup = canonical?.startsWith("release:")
          ? { id: canonical.slice(8) }
          : shikimori
            ? { shikimori_id: shikimori }
            : kp
              ? { kinopoisk_id: kp }
              : null;
        if (lookup) {
          const result = record(await this.providers.kodikVideos(lookup));
          const rows = Array.isArray(result.results)
            ? result.results.filter((raw) => {
                try {
                  const material = normalizeKodikAnime(raw);
                  return canonical
                    ? material.providers[0]?.externalId === canonical
                    : sameMaterial(anime, material.anime);
                } catch {
                  return false;
                }
              })
            : [];
          sources = usable(normalizeKodikVideos({ results: rows }));
        }
        states.kodik = await this.providers.state("kodik");
        if (states.kodik !== "enabled") sources = [];
      } catch (error) {
        states.kodik = error instanceof ProviderUnavailable ? error.state : "error";
      }
    }
    if (!sources.length && states.yummy === "enabled") {
      try {
        let id = references.find((ref) => ref.provider === "yummy")?.externalId;
        if (!id && (shikimori || kp)) {
          // Playback-only resolution: exact IDs and matching metadata, with no catalog writes.
          const matches = yummyRows(
            await this.providers.yummyPlaybackLookup({ q: anime.originalTitle || anime.title }),
          ).filter((raw) => {
            try {
              const candidate = normalizeYummyAnime(raw);
              return (
                sameMaterial(anime, candidate.anime) &&
                candidate.providers.some((ref) =>
                  shikimori
                    ? ref.provider === "shikimori" && ref.externalId === shikimori
                    : ref.provider === "kinopoisk" && ref.externalId === kp,
                )
              );
            } catch {
              return false;
            }
          });
          if (matches.length === 1) id = String(record(matches[0]).anime_id);
        }
        if (id) sources = usable(normalizeYummyVideos(await this.providers.yummyVideos(id)));
        states.yummy = await this.providers.state("yummy");
        if (states.yummy !== "enabled") sources = [];
      } catch (error) {
        states.yummy = error instanceof ProviderUnavailable ? error.state : "error";
      }
    }
    const finalStates = await Promise.all(
      (["kodik", "yummy"] as const).map(async (name) => ({
        name,
        state: states[name] === "enabled" ? await this.providers.state(name) : states[name],
      })),
    );
    const enabled = new Set(finalStates.filter((p) => p.state === "enabled").map((p) => p.name));
    const distinct = [
      ...new Map(
        sources
          .filter((source) => enabled.has(source.provider))
          .map((source) => [source.id, source]),
      ).values(),
    ].sort(
      (a, b) =>
        a.season.localeCompare(b.season, "ru", { numeric: true }) ||
        a.episode.localeCompare(b.episode, "ru", { numeric: true }) ||
        a.translation.localeCompare(b.translation, "ru"),
    );
    const episodeIds = await this.episodes.register(anime.id, distinct.slice(0, 20000));
    return playbackSchema.parse({
      animeId: anime.id,
      revision,
      sources: distinct.slice(0, 20000).map((source) => ({
        id: source.id,
        episodeId: episodeIds.get(source.provider + ":" + source.id),
        variantId: createHash("sha256")
          .update(source.provider + ":" + source.player + ":" + source.translation)
          .digest("hex")
          .slice(0, 24),
        translation: source.translation,
        season: source.season,
        episode: source.episode,
        embedUrl: source.embedUrl,
      })),
      state: distinct.length
        ? "ready"
        : finalStates.some((p) => p.state === "error")
          ? "unavailable"
          : finalStates.some((p) => p.state === "enabled")
            ? "empty"
            : "disabled",
    });
  }
}
