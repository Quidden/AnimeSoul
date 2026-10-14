import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createDatabase, type Database } from "@animesoul/database";
import { providerDecision, type ProviderDecision } from "@animesoul/contracts";
import { CONFIG, type Configuration } from "../config.js";
import {
  ProviderHttp,
  ProviderHttpError,
  UPSTREAM_FETCH,
  type UpstreamFetch,
} from "./provider-http.js";
import { createHash } from "node:crypto";
type Provider = "yummy" | "kodik";
export class ProviderUnavailable extends Error {
  constructor(
    readonly state: ProviderDecision | "error",
    readonly code = "upstream-unavailable",
    readonly retryMs = 0,
  ) {
    super("Provider is unavailable.");
  }
}
@Injectable()
export class ProvidersService {
  private readonly database: Database | undefined;
  private readonly http: ProviderHttp;
  constructor(
    @Inject(CONFIG) private readonly config: Configuration,
    @Inject(UPSTREAM_FETCH) request: UpstreamFetch,
  ) {
    this.database = config.DATABASE_URL ? createDatabase(config.DATABASE_URL) : undefined;
    this.http = new ProviderHttp(request);
  }
  async state(provider: Provider): Promise<ProviderDecision | "error"> {
    const environmentAllows =
      (provider === "yummy" ? this.config.ALLOW_YUMMY : this.config.ALLOW_KODIK) === "true";
    if (!environmentAllows) {
      this.http.clear(provider);
      return "environment-blocked";
    }
    try {
      const setting = await this.database?.providerSetting.findUnique({ where: { key: provider } });
      const state = providerDecision({
        environmentAllows,
        settingEnabled: setting?.enabled ?? false,
        hasCredentials: Boolean(this.token(provider)),
      });
      if (state !== "enabled") this.http.clear(provider);
      return state;
    } catch {
      this.http.clear(provider);
      return "error";
    }
  }
  async revision() {
    try {
      const settings = await this.database?.providerSetting.findMany({
        where: { key: { in: ["kodik", "yummy"] } },
        orderBy: { key: "asc" },
        select: { key: true, enabled: true, updatedAt: true },
      });
      return createHash("sha256")
        .update(
          JSON.stringify([
            settings ?? [],
            this.config.ALLOW_KODIK,
            this.config.ALLOW_YUMMY,
            Boolean(this.token("kodik")),
            Boolean(this.token("yummy")),
            this.config.ALLOW_KODIK_DIRECT,
            Boolean(this.config.KODIK_PRIVATE_KEY),
            this.config.KODIK_MEDIA_HOSTS,
          ]),
        )
        .digest("hex");
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  private token(provider: Provider) {
    return provider === "yummy" ? this.config.YUMMY_TOKEN : this.config.KODIK_TOKEN;
  }
  private async request(provider: Provider, route: string, params: Record<string, string> = {}) {
    const state = await this.state(provider);
    if (state !== "enabled") throw new ProviderUnavailable(state);
    try {
      const value = await this.http.get(provider, route, params, this.token(provider));
      const after = await this.state(provider);
      if (after !== "enabled") throw new ProviderUnavailable(after);
      return value;
    } catch (error) {
      if (error instanceof ProviderUnavailable) throw error;
      throw new ProviderUnavailable(
        "error",
        error instanceof ProviderHttpError ? error.code : "upstream-unavailable",
        error instanceof ProviderHttpError ? error.retryMs : 0,
      );
    }
  }
  catalog(cursor: string | null) {
    return this.request("kodik", "/list", {
      limit: "100",
      sort: "id",
      order: "asc",
      types: "anime,anime-serial",
      with_material_data: "true",
      ...(cursor ? { next: cursor } : {}),
    });
  }
  yummyVideos(id: string) {
    return this.request("yummy", "/anime/" + encodeURIComponent(id) + "/videos");
  }
  yummyPlaybackLookup(lookup: Record<string, string>) {
    return this.request("yummy", "/anime", {
      ...lookup,
      limit: "20",
    });
  }
  kodikVideos(lookup: Record<string, string>) {
    return this.request("kodik", "/search", {
      ...lookup,
      limit: "100",
      types: "anime,anime-serial",
      with_material_data: "true",
      with_episodes_data: "true",
    });
  }
  hidesCredential(url: string) {
    return [this.config.YUMMY_TOKEN, this.config.KODIK_TOKEN].some(
      (token) => token.length > 0 && url.includes(token),
    );
  }
  async onModuleDestroy() {
    this.http.clear("yummy");
    this.http.clear("kodik");
    await this.database?.$disconnect();
  }
}
