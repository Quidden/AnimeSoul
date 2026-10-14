import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  catalogQuerySchema,
  type CatalogQuery,
  type GlobalSearchQuery,
  publicProfile,
  readVisibility,
} from "@animesoul/contracts";
import { createDatabase, type Database } from "@animesoul/database";
import { developmentAnime, developmentProfile } from "@animesoul/database/fixtures";
import { CONFIG, type Configuration } from "../config.js";
import { readProfile } from "../account/profile-reader.js";
import { listCatalog, randomAnime, enrichAnime } from "./discovery.js";
import { refreshShikimoriMetadata } from "./shikimori-metadata.js";
import { profileFriends } from "../social/access.js";
import { globalSearch } from "./global-search.js";
import { animeFranchise } from "./franchise.js";
import { animeCharacters, characterDetails, searchCharacters } from "./characters.js";
@Injectable()
export class CatalogService {
  private readonly database: Database | undefined;
  constructor(@Inject(CONFIG) private readonly config: Configuration) {
    this.database = config.DATABASE_URL ? createDatabase(config.DATABASE_URL) : undefined;
  }

  async list(input: CatalogQuery = catalogQuerySchema.parse({}), userId?: string) {
    return listCatalog(this.database, this.config, input, userId);
  }
  async search(input: GlobalSearchQuery, userId?: string) {
    return globalSearch(this.database, this.config, input, userId);
  }
  async matchFrameTitles(titles: string[]) {
    if (this.config.DEMO_CATALOG === "true") return developmentAnime;
    if (!this.database || !titles.length) return [];
    return this.database.anime.findMany({
      where: {
        published: true,
        metadataProvider: { not: "legacy" },
        ...(this.config.NODE_ENV === "production" ? { isDevelopment: false } : {}),
        OR: [
          { title: { in: titles, mode: "insensitive" } },
          { originalTitle: { in: titles, mode: "insensitive" } },
          { aliases: { hasSome: titles } },
        ],
      },
      select: { slug: true, title: true, originalTitle: true, aliases: true },
      take: 50,
    });
  }
  async franchise(slug: string) {
    return animeFranchise(this.database, this.config, slug);
  }
  async characters(slug: string) {
    return animeCharacters(this.database, this.config, slug);
  }
  async character(slug: string) {
    return characterDetails(this.database, this.config, slug);
  }
  async characterSearch(input: GlobalSearchQuery) {
    return {
      items: await searchCharacters(this.database, this.config, input.q, { discover: true }),
    };
  }
  async matchFrameEpisodes(slugs: string[]) {
    if (this.config.DEMO_CATALOG === "true" || !this.database || !slugs.length) return [];
    const episodes = await this.database.episode.findMany({
      where: {
        anime: {
          slug: { in: slugs.slice(0, 5) },
          published: true,
          metadataProvider: { not: "legacy" },
          ...(this.config.NODE_ENV === "production" ? { isDevelopment: false } : {}),
        },
      },
      select: {
        id: true,
        season: true,
        number: true,
        duration: true,
        anime: { select: { slug: true } },
      },
      take: 20001,
    });
    // A partial list cannot establish whether an episode is unambiguous.
    return episodes.length > 20000 ? [] : episodes;
  }
  async random(input: CatalogQuery, mode: string, userId?: string) {
    return randomAnime(this.database, this.config, input, mode, userId);
  }
  async byIds(ids: string[]) {
    if (this.config.DEMO_CATALOG === "true")
      return { items: developmentAnime.filter((a) => ids.includes(a.id)) };
    if (!this.database)
      throw new ServiceUnavailableException("Catalog database is not configured.");
    const items = await this.database.anime.findMany({
      where: {
        id: { in: ids },
        published: true,
        ...(this.config.NODE_ENV === "production" ? { isDevelopment: false } : {}),
      },
      take: 100,
    });
    return { items: await enrichAnime(this.database, items) };
  }
  async find(slug: string) {
    if (this.config.DEMO_CATALOG === "true") return developmentAnime.find((a) => a.slug === slug);
    if (!this.database)
      throw new ServiceUnavailableException("Catalog database is not configured.");
    const anime = await this.database.anime.findFirst({
      where: {
        slug,
        published: true,
        ...(this.config.NODE_ENV === "production" ? { isDevelopment: false } : {}),
      },
    });
    if (!anime) return undefined;
    const enriched =
      this.config.NODE_ENV === "test"
        ? anime
        : await refreshShikimoriMetadata(this.database, anime);
    return (await enrichAnime(this.database, [enriched]))[0];
  }
  async profile(username: string) {
    if (this.config.DEMO_CATALOG === "true")
      return username === developmentProfile.username
        ? publicProfile(developmentProfile)
        : undefined;
    if (!this.database)
      throw new ServiceUnavailableException("Profile database is not configured.");
    return this.database.$transaction(
      async (tx) => {
        const record = await tx.userProfile.findFirst({
          where: {
            usernameKey: username.toLowerCase(),
            isPublic: true,
            user: { disabledAt: null },
          },
        });
        if (!record) return undefined;
        const v = readVisibility(record.visibility);
        const result = await readProfile(tx, record, {
          about: v.about === "public",
          favorites: v.favorites === "public",
          folders: v.folders === "public",
          ratings: v.ratings === "public",
          statistics: v.statistics === "public",
        });
        const friendList = v.friends === "public" ? await profileFriends(tx, record.userId) : null;
        return {
          ...result,
          contentSections: (["posts", "reviews", "comments"] as const).filter(
            (section) => v[section] === "public",
          ),
          ...(friendList ? { friends: friendList.items, friendsNext: friendList.next } : {}),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  async providerReferences(animeId: string) {
    if (this.config.DEMO_CATALOG === "true" || !this.database) return [];
    return this.database.animeProvider.findMany({
      where: { animeId },
      select: { provider: true, externalId: true },
    });
  }
  async related(slug: string) {
    const anime = await this.find(slug);
    if (!anime) return null;
    if (!this.database || this.config.DEMO_CATALOG === "true") return { items: [] };
    const ids = anime.details?.relatedAnimeIds ?? [];
    const references = ids.length
      ? await this.database.animeProvider.findMany({
          where: { animeId: { in: ids }, provider: "shikimori" },
          select: { animeId: true, externalId: true },
        })
      : [];
    const external = [
      ...new Set([
        ...(anime.details?.relatedExternalIds ?? []),
        ...references.map((r) => r.externalId),
      ]),
    ];
    if (!ids.length && !external.length) return { items: [] };
    const primary = external.length
      ? await this.database.animeProvider.findMany({
          where: {
            provider: "kodik-material",
            externalId: { in: external.map((id) => "shikimori:" + id) },
          },
          select: { animeId: true, externalId: true },
        })
      : [];
    const byExternal = new Map(primary.map((r) => [r.externalId.slice(10), r.animeId]));
    const replacements = new Map(
      references.map((r) => [r.animeId, byExternal.get(r.externalId) ?? r.animeId]),
    );
    const ordered = [
      ...new Set([
        ...ids.map((id) => replacements.get(id) ?? id),
        ...primary.map((r) => r.animeId),
      ]),
    ];
    const rows = await this.database.anime.findMany({
      where: {
        published: true,
        metadataProvider: { not: "legacy" },
        ...(this.config.NODE_ENV === "production" ? { isDevelopment: false } : {}),
        OR: [
          { id: { in: ordered } },
          { providers: { some: { provider: "shikimori", externalId: { in: external } } } },
        ],
      },
      take: 100,
    });
    const order = new Map(ordered.map((id, i) => [id, i]));
    rows.sort(
      (a, b) =>
        (order.get(a.id) ?? 100) - (order.get(b.id) ?? 100) ||
        a.year - b.year ||
        a.title.localeCompare(b.title),
    );
    return { items: await enrichAnime(this.database, rows) };
  }
  async publicCatalog() {
    if (this.config.DEMO_CATALOG === "true") return [];
    if (!this.database)
      throw new ServiceUnavailableException("Catalog database is not configured.");
    return this.database.anime.findMany({
      where: { published: true, isDevelopment: false, metadataProvider: { not: "legacy" } },
      select: { slug: true, updatedAt: true },
      take: 50000,
    });
  }
  async publicProfiles() {
    if (this.config.DEMO_CATALOG === "true") return [];
    if (!this.database)
      throw new ServiceUnavailableException("Profile database is not configured.");
    return this.database.userProfile.findMany({
      where: { isPublic: true, indexable: true, user: { disabledAt: null } },
      select: { username: true, updatedAt: true },
      take: 50000,
    });
  }
  async ready() {
    if (!this.database) return false;
    await this.database.$queryRaw`SELECT 1`;
    return true;
  }
  async onModuleDestroy() {
    await this.database?.$disconnect();
  }
}
