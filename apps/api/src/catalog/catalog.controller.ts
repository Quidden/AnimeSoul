import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  Header,
  UnauthorizedException,
  Res,
} from "@nestjs/common";
import {
  catalogQuerySchema,
  catalogIdsSchema,
  randomCatalogQuerySchema,
  globalSearchQuerySchema,
} from "@animesoul/contracts";
import { CatalogService } from "./catalog.service.js";
import { AuthService, cookieToken, type AuthRequest } from "../auth/auth.service.js";
import { matchesEtag } from "./public-response-cache.js";
type PublicReply = {
  header: (name: string, value: string) => unknown;
  code: (status: number) => unknown;
};
@Controller("api")
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get("search")
  @Header("Cache-Control", "private, no-store")
  async search(@Query() query: unknown, @Req() request: AuthRequest) {
    const parsed = globalSearchQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid search query.");
    let userId: string | undefined;
    if (cookieToken(request, "web")) {
      try {
        userId = (await this.auth.requireSession(request)).userId;
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
      }
    }
    return this.catalog.search(parsed.data, userId);
  }
  @Get("catalog")
  @Header("Cache-Control", "private, no-store")
  async list(@Query() query: unknown, @Req() request: AuthRequest) {
    const input = catalogQuerySchema.safeParse(query);
    if (!input.success) throw new BadRequestException("Invalid search query.");
    const session =
      input.data.personalized === "1" || input.data.ratingSource === "mine"
        ? await this.auth.requireSession(request)
        : null;
    return this.catalog.list(input.data, session?.userId);
  }
  @Get("catalog/random")
  @Header("Cache-Control", "private, no-store")
  async random(@Query() query: unknown, @Req() request: AuthRequest) {
    const parsed = randomCatalogQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid random filters.");
    const { mode, ...filters } = parsed.data;
    const input = mode === "all" ? catalogQuerySchema.parse({}) : filters;
    const session =
      mode === "taste" || input.ratingSource === "mine" || input.personalized === "1"
        ? await this.auth.requireSession(request)
        : null;
    const anime = await this.catalog.random(input, mode, session?.userId);
    if (!anime) throw new NotFoundException("No matching anime.");
    return { slug: anime.slug, title: anime.title };
  }
  @Get("catalog/by-ids")
  byIds(@Query("ids") ids: unknown) {
    const input = catalogIdsSchema.safeParse(ids);
    if (!input.success) throw new BadRequestException("Invalid catalog identities.");
    return this.catalog.byIds(input.data);
  }
  @Get("anime/:slug")
  async anime(
    @Param("slug") slug: string,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: PublicReply,
  ) {
    if (!/^[a-z0-9-]{1,160}$/.test(slug)) throw new NotFoundException();
    return this.publicResponse("anime", slug, request, reply);
  }
  @Get("anime/:slug/related")
  async related(@Param("slug") slug: string) {
    if (!/^[a-z0-9-]{1,160}$/.test(slug)) throw new NotFoundException();
    const result = await this.catalog.related(slug);
    if (!result) throw new NotFoundException();
    return result;
  }
  @Get("anime/:slug/characters")
  async characters(@Param("slug") slug: string) {
    if (!/^[a-z0-9-]{1,160}$/.test(slug)) throw new NotFoundException();
    const result = await this.catalog.characters(slug);
    if (!result) throw new NotFoundException();
    return result;
  }
  @Get("characters/search")
  @Header("Cache-Control", "private, no-store")
  async characterSearch(@Query() query: unknown) {
    const parsed = globalSearchQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid search query.");
    return this.catalog.characterSearch(parsed.data);
  }
  @Get("characters/:slug")
  async character(@Param("slug") slug: string) {
    if (!/^[a-z0-9-]{1,160}$/.test(slug)) throw new NotFoundException();
    const result = await this.catalog.character(slug);
    if (!result) throw new NotFoundException();
    return result;
  }
  @Get("anime/:slug/franchise")
  async franchise(
    @Param("slug") slug: string,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: PublicReply,
  ) {
    if (!/^[a-z0-9-]{1,160}$/.test(slug)) throw new NotFoundException();
    return this.publicResponse("franchise", slug, request, reply);
  }
  private async publicResponse(
    kind: "anime" | "franchise",
    slug: string,
    request: AuthRequest,
    reply: PublicReply,
  ) {
    const result = await this.catalog.publicResponse(kind, slug);
    if (!result) throw new NotFoundException();
    reply.header("Cache-Control", "public, max-age=0, must-revalidate");
    reply.header("ETag", result.etag);
    if (matchesEtag(request.headers["if-none-match"], result.etag)) {
      reply.code(304);
      return;
    }
    reply.header("Content-Type", "application/json; charset=utf-8");
    return result.body;
  }
  @Get("profiles/:username")
  async profile(@Param("username") username: string) {
    if (username.length > 80) throw new NotFoundException();
    const profile = await this.catalog.profile(username);
    if (!profile) throw new NotFoundException();
    return profile;
  }
  @Get("sitemap/catalog")
  catalogMap() {
    return this.catalog.publicCatalog();
  }
  @Get("sitemap/profiles")
  profiles() {
    return this.catalog.publicProfiles();
  }
}
