import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { searchSchema } from "@animesoul/contracts";
import { CatalogService } from "./catalog.service.js";
@Controller("api")
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}
  @Get("catalog")
  list(@Query("q") q: unknown) {
    const input = searchSchema.safeParse({ q });
    if (!input.success) throw new BadRequestException("Invalid search query.");
    return this.catalog.list(input.data.q);
  }
  @Get("anime/:slug")
  async anime(@Param("slug") slug: string) {
    if (!/^[a-z0-9-]{1,160}$/.test(slug)) throw new NotFoundException();
    const anime = await this.catalog.find(slug);
    if (!anime) throw new NotFoundException();
    return anime;
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
