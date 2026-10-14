import { Inject, Injectable, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { episodeLabel, episodeSchema, type ProviderPlaybackSource } from "@animesoul/contracts";
import { AuthService } from "../auth/auth.service.js";
import { CatalogService } from "../catalog/catalog.service.js";
function episodeId(animeId: string, season: string, number: string) {
  const hex = createHash("sha256")
    .update(JSON.stringify(["animesoul:episode:v1", animeId, season, number]))
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
@Injectable()
export class EpisodeService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}
  async register(animeId: string, sources: ProviderPlaybackSource[]) {
    const result = new Map<string, string>();
    if (!sources.length || this.auth.config.DEMO_CATALOG === "true") return result;
    const episodes = [
      ...new Map(
        sources.map((source) => {
          const season = episodeLabel(source.season),
            number = episodeLabel(source.episode);
          return [
            JSON.stringify([season, number]),
            { id: episodeId(animeId, season, number), animeId, season, number },
          ];
        }),
      ).values(),
    ];
    await this.auth.db.$transaction(
      async (tx) => {
        for (let offset = 0; offset < episodes.length; offset += 1000)
          await tx.episode.createMany({
            data: episodes.slice(offset, offset + 1000),
            skipDuplicates: true,
          });
        const stored = await tx.episode.findMany({
          where: { animeId },
          select: { id: true, season: true, number: true },
        });
        const ids = new Map(
          stored.map((row) => [JSON.stringify([row.season, row.number]), row.id]),
        );
        const mappings = sources.map((source) => ({
          provider: source.provider,
          animeId,
          externalId: source.id,
          episodeId: ids.get(
            JSON.stringify([episodeLabel(source.season), episodeLabel(source.episode)]),
          )!,
        }));
        for (let offset = 0; offset < mappings.length; offset += 1000)
          await tx.episodeProvider.createMany({
            data: mappings.slice(offset, offset + 1000),
            skipDuplicates: true,
          });
        const assigned = await tx.episodeProvider.findMany({
          where: { animeId, externalId: { in: sources.map((source) => source.id) } },
        });
        const actual = new Map(
          assigned.map((row) => [row.provider + ":" + row.externalId, row.episodeId]),
        );
        for (const mapping of mappings) {
          const key = mapping.provider + ":" + mapping.externalId;
          if (actual.get(key) !== mapping.episodeId)
            throw new ConflictException("Episode mapping needs review.");
          result.set(key, mapping.episodeId);
        }
      },
      { timeout: 20000 },
    );
    return result;
  }
  async list(slug: string) {
    const anime = await this.catalog.find(slug);
    if (!anime) return undefined;
    if (this.auth.config.DEMO_CATALOG === "true") return { episodes: [] };
    const rows = await this.auth.db.episode.findMany({ where: { animeId: anime.id }, take: 20000 });
    rows.sort(
      (a, b) =>
        a.season.localeCompare(b.season, "ru", { numeric: true }) ||
        a.number.localeCompare(b.number, "ru", { numeric: true }) ||
        a.id.localeCompare(b.id),
    );
    return { episodes: rows.map((row) => episodeSchema.parse(row)) };
  }
  async find(slug: string, id: string) {
    const anime = await this.catalog.find(slug);
    if (!anime || this.auth.config.DEMO_CATALOG === "true") return undefined;
    const row = await this.auth.db.episode.findFirst({ where: { id, animeId: anime.id } });
    return row ? episodeSchema.parse(row) : undefined;
  }
  async sitemap(bucket: number) {
    if (this.auth.config.DEMO_CATALOG === "true") return [];
    const lower = bucket.toString(16).padStart(2, "0") + "000000-0000-0000-0000-000000000000";
    const upper = (bucket + 1).toString(16).padStart(2, "0") + "000000-0000-0000-0000-000000000000";
    const rows = await this.auth.db.episode.findMany({
      where: {
        id: { gte: lower, ...(bucket < 255 ? { lt: upper } : {}) },
        anime: { published: true, isDevelopment: false },
      },
      select: { id: true, anime: { select: { slug: true } } },
      orderBy: { id: "asc" },
      take: 50001,
    });
    if (rows.length > 50000)
      throw new ServiceUnavailableException("Episode sitemap needs further sharding.");
    return rows.map((row) => ({ id: row.id, slug: row.anime.slug }));
  }
}
