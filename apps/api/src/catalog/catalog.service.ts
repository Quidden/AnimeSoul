import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  animeSchema,
  publicProfile,
  visibilitySchema,
  type ProfileRecord,
} from "@animesoul/contracts";
import { createDatabase, type Database } from "@animesoul/database";
import { developmentAnime, developmentProfile } from "@animesoul/database/fixtures";
import { CONFIG, type Configuration } from "../config.js";
@Injectable()
export class CatalogService {
  private readonly database: Database | undefined;
  constructor(@Inject(CONFIG) private readonly config: Configuration) {
    this.database = config.DATABASE_URL ? createDatabase(config.DATABASE_URL) : undefined;
  }
  async list(query = "") {
    if (this.config.DEMO_CATALOG === "true") {
      const text = query.toLocaleLowerCase();
      return {
        source: "development" as const,
        items: developmentAnime.filter((a) =>
          [a.title, a.originalTitle, ...a.aliases].some((t) =>
            t.toLocaleLowerCase().includes(text),
          ),
        ),
      };
    }
    if (!this.database)
      throw new ServiceUnavailableException("Catalog database is not configured.");
    const items = await this.database.anime.findMany({
      where: {
        published: true,
        ...(this.config.NODE_ENV === "production" ? { isDevelopment: false } : {}),
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: "insensitive" as const } },
                { originalTitle: { contains: query, mode: "insensitive" as const } },
                { aliases: { has: query } },
              ],
            }
          : {}),
      },
      orderBy: { title: "asc" },
      take: 60,
    });
    return {
      source: "database" as const,
      items: items.map((a) => animeSchema.parse({ ...a, indexable: !a.isDevelopment })),
    };
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
    return anime ? animeSchema.parse({ ...anime, indexable: !anime.isDevelopment }) : undefined;
  }
  async profile(username: string) {
    if (this.config.DEMO_CATALOG === "true")
      return username === developmentProfile.username
        ? publicProfile(developmentProfile)
        : undefined;
    if (!this.database)
      throw new ServiceUnavailableException("Profile database is not configured.");
    const record = await this.database.userProfile.findFirst({
      where: {
        usernameKey: username.toLocaleLowerCase(),
        isPublic: true,
        user: { disabledAt: null },
      },
    });
    if (!record) return undefined;
    const content =
      typeof record.content === "object" &&
      record.content !== null &&
      !Array.isArray(record.content)
        ? record.content
        : {};
    return publicProfile({
      ...content,
      id: record.userId,
      username: record.username,
      indexable: record.indexable,
      avatar: record.avatar,
      banner: record.banner,
      badge: record.badge,
      presence: record.presence,
      about: record.about,
      visibility: visibilitySchema.parse(record.visibility),
    } as ProfileRecord);
  }
  async publicCatalog() {
    if (this.config.DEMO_CATALOG === "true") return [];
    if (!this.database)
      throw new ServiceUnavailableException("Catalog database is not configured.");
    return this.database.anime.findMany({
      where: { published: true, isDevelopment: false },
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
