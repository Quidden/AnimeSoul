import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { z } from "zod";
import sharp from "sharp";
import {
  frameSearchLimits,
  frameSearchQuotaSchema,
  frameSearchResultSchema,
  normalizeSearchText,
  episodeLabel,
  tracePreviewUrl,
  type FrameSearchMatch,
  type FrameSearchQuota,
} from "@animesoul/contracts";
import { CONFIG, type Configuration } from "../config.js";
import { CatalogService } from "./catalog.service.js";

export const FRAME_SEARCH_FETCH = Symbol("FRAME_SEARCH_FETCH");
export function selectFrameEpisode(
  match: FrameSearchMatch,
  episodes: {
    id: string;
    season: string;
    number: string;
    duration: number | null;
    anime: { slug: string };
  }[],
): FrameSearchMatch["watch"] {
  if (!match.anime || !match.episode || !/^\d{1,6}(?:\.\d{1,3})?$/.test(match.episode)) return null;
  if (match.timestamp > 86400) return null;
  const local = episodes.filter((episode) => episode.anime.slug === match.anime!.slug);
  const numbered = local.filter(
    (episode) => episodeLabel(episode.number) === episodeLabel(match.episode!),
  );
  const seasons = new Set(local.map((episode) => episodeLabel(episode.season)));
  // Some separate season titles restart their provider's season number at 1.
  // For multi-season titles, require an exact season rather than guessing an offset.
  const candidates =
    match.season && seasons.size > 1
      ? numbered.filter((episode) => episodeLabel(episode.season) === episodeLabel(match.season!))
      : numbered;
  if (candidates.length !== 1) return null;
  const episode = candidates[0]!;
  if (episode.duration !== null && match.timestamp > episode.duration) return null;
  return { episodeId: episode.id, season: episode.season, episode: episode.number };
}
const titleSchema = z.string().max(500).nullable().optional();
const traceResult = z.object({
  error: z.string().max(2000).optional(),
  quota: z.number().int().positive().optional(),
  quotaUsed: z.number().int().nonnegative().optional(),
  result: z
    .array(
      z.object({
        anilist: z.union([
          z.number().int().positive(),
          z.object({
            id: z.number().int().positive(),
            title: z
              .object({ romaji: titleSchema, english: titleSchema, native: titleSchema })
              .optional(),
            synonyms: z.array(z.string().max(500)).max(100).optional(),
            isAdult: z.boolean().optional(),
          }),
        ]),
        episode: z
          .union([z.string().max(80), z.number().finite(), z.array(z.number().finite()).max(20)])
          .nullable()
          .optional(),
        episode_start: z.number().int().positive().max(999999).nullable().optional(),
        episode_end: z.number().int().positive().max(999999).nullable().optional(),
        from: z.number().finite().nonnegative(),
        to: z.number().finite().nonnegative(),
        at: z.number().finite().nonnegative().optional(),
        similarity: z.number().min(0).max(1),
        image: z.string().max(4096).optional(),
        video: z.string().max(4096).optional(),
      }),
    )
    .max(50),
});

/** Only a decoded, resized first frame is sent out; metadata and the original file are discarded. */
export async function prepareSearchFrame(bytes: unknown) {
  if (!Buffer.isBuffer(bytes) || !bytes.length)
    throw new BadRequestException("Выберите изображение кадра.");
  if (bytes.length > frameSearchLimits.bytes)
    throw new HttpException("Размер кадра — не более 5 МБ.", 413);
  const signature = bytes.subarray(0, 12);
  const raster =
    signature.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
    signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    ["GIF87a", "GIF89a"].includes(signature.subarray(0, 6).toString("ascii")) ||
    (signature.subarray(0, 4).toString("ascii") === "RIFF" &&
      signature.subarray(8, 12).toString("ascii") === "WEBP");
  if (!raster) throw new BadRequestException("Поддерживаются JPEG, PNG, WebP и GIF.");
  try {
    const image = sharp(bytes, { limitInputPixels: frameSearchLimits.pixels, failOn: "warning" });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > frameSearchLimits.dimension ||
      metadata.height > frameSearchLimits.dimension ||
      !["jpeg", "png", "webp", "gif"].includes(metadata.format ?? "")
    )
      throw new Error("Invalid frame.");
    return await image
      .timeout({ seconds: 10 })
      .rotate()
      .resize({ width: 640, height: 360, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#000000" })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    throw new BadRequestException("Кадр повреждён или превышает 4096 × 4096 пикселей.");
  }
}

@Injectable()
export class FrameSearchService {
  private active = false;
  private quota: { value: FrameSearchQuota; at: number } | null = null;
  private quotaRequest: Promise<FrameSearchQuota> | null = null;
  private quotaVersion = 0;
  constructor(
    @Inject(CONFIG) private readonly config: Configuration,
    @Inject(FRAME_SEARCH_FETCH) private readonly request: typeof fetch,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}
  private rememberQuota(total: number, used: number) {
    const value = frameSearchQuotaSchema.parse({
      total,
      used,
      remaining: Math.max(0, total - used),
    });
    this.quota = { value, at: Date.now() };
    this.quotaVersion++;
    return value;
  }
  async getQuota() {
    if (this.quota && Date.now() - this.quota.at < 30000) return this.quota.value;
    if (this.quotaRequest) return this.quotaRequest;
    const version = this.quotaVersion;
    this.quotaRequest = (async () => {
      try {
        const response = await this.request("https://api.trace.moe/me", {
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          headers: this.config.TRACE_MOE_API_KEY
            ? { "x-trace-key": this.config.TRACE_MOE_API_KEY }
            : {},
        });
        if (!response.ok) throw new Error("Quota unavailable.");
        // Only numeric limits are exposed; the provider's IP/account identifier stays private.
        const data = z
          .object({
            quota: z.number().int().positive().max(10_000_000),
            quotaUsed: z.number().int().nonnegative(),
          })
          .parse(await response.json());
        if (version !== this.quotaVersion) {
          if (this.quota) return this.quota.value;
          throw new Error("Stale quota.");
        }
        return this.rememberQuota(data.quota, data.quotaUsed);
      } catch {
        throw new ServiceUnavailableException("Остаток лимита временно недоступен.");
      }
    })();
    try {
      return await this.quotaRequest;
    } finally {
      this.quotaRequest = null;
    }
  }
  async search(bytes: unknown, reserve?: () => Promise<void>) {
    if (this.active)
      throw new HttpException(
        {
          message: "Поиск по кадру занят. Повторите через несколько секунд.",
          retryAfter: 2,
          limitScope: "concurrency",
        },
        429,
      );
    this.active = true;
    try {
      const image = await prepareSearchFrame(bytes);
      await reserve?.();
      let response: Response;
      try {
        response = await this.request("https://api.trace.moe/search?anilistInfo&cutBorders=1", {
          method: "POST",
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(30000),
          headers: {
            "Content-Type": "image/jpeg",
            ...(this.config.TRACE_MOE_API_KEY
              ? { "x-trace-key": this.config.TRACE_MOE_API_KEY }
              : {}),
          },
          body: new Uint8Array(image),
        });
      } catch {
        throw new ServiceUnavailableException("trace.moe не ответил вовремя. Попробуйте позже.");
      }
      if ([402, 429].includes(response.status)) {
        this.quota = null;
        this.quotaVersion++;
        throw new HttpException(
          {
            message: "Лимит trace.moe исчерпан или сервис занят. Попробуйте позже.",
            retryAfter: Math.max(
              1,
              Math.min(86400, Number(response.headers.get("retry-after")) || 60),
            ),
            limitScope: "provider",
          },
          429,
        );
      }
      if (!response.ok)
        throw new ServiceUnavailableException(
          "Поиск trace.moe временно недоступен. Попробуйте позже.",
        );
      let result: z.infer<typeof traceResult>;
      try {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty response.");
        let length = 0;
        let text = "";
        const decoder = new TextDecoder();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 512 * 1024) {
            await reader.cancel();
            throw new Error("Response too large.");
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        result = traceResult.parse(JSON.parse(text + decoder.decode()));
        if (result.error) throw new Error("Provider error.");
      } catch {
        throw new ServiceUnavailableException(
          "trace.moe вернул некорректный ответ. Попробуйте позже.",
        );
      }
      const matches: FrameSearchMatch[] = [];
      // Search counters can precede the just-completed request. /me is authoritative.
      this.quota = null;
      this.quotaVersion++;
      const seen = new Set<string>();
      const names = new Map<number, string[]>();
      for (const item of [...result.result].sort((a, b) => b.similarity - a.similarity)) {
        const info = typeof item.anilist === "number" ? null : item.anilist;
        const anilistId = info?.id ?? (item.anilist as number);
        // The provider's curated range is relative to this title; legacy episode
        // numbers are extracted from filenames and can use absolute numbering.
        const episodeValue =
          item.episode_start && item.episode_end && item.episode_end >= item.episode_start
            ? item.episode_start === item.episode_end
              ? String(item.episode_start)
              : `${item.episode_start}–${item.episode_end}`
            : item.episode === null || item.episode === undefined
              ? null
              : Array.isArray(item.episode)
                ? item.episode.join(", ")
                : String(item.episode);
        const episode = episodeValue?.slice(0, 100) ?? null;
        const key = anilistId + ":" + episode;
        if (seen.has(key)) continue;
        seen.add(key);
        const titles = [
          info?.title?.romaji,
          info?.title?.english,
          info?.title?.native,
          ...(info?.synonyms ?? []),
        ].filter((value): value is string => !!value?.trim());
        const title = titles[0] ?? `Аниме #${anilistId}`;
        names.set(anilistId, titles.slice(0, 10));
        matches.push({
          anilistId,
          title,
          episode,
          season:
            titles
              .map((name) =>
                /\b(?:season\s+(\d{1,3})|(\d{1,3})(?:st|nd|rd|th)?\s+season)\b/i.exec(name),
              )
              .find(Boolean)
              ?.slice(1)
              .find(Boolean) ?? null,
          timestamp: item.at ?? item.from,
          similarity: item.similarity,
          isAdult: info?.isAdult ?? false,
          image: tracePreviewUrl(item.image, "image"),
          video: tracePreviewUrl(item.video, "video"),
          anime: null,
          watch: null,
        });
        if (matches.length === 5) break;
      }
      if (matches.length) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            (async () => {
              const catalog = await this.catalog.matchFrameTitles([
                ...new Set([...names.values()].flat()),
              ]);
              for (const match of matches) {
                const normalized = new Set(
                  (names.get(match.anilistId) ?? []).map(normalizeSearchText),
                );
                const found = catalog.filter((entry) =>
                  [entry.title, entry.originalTitle, ...entry.aliases].some((name) =>
                    normalized.has(normalizeSearchText(name)),
                  ),
                );
                if (found.length === 1)
                  match.anime = { slug: found[0]!.slug, title: found[0]!.title.slice(0, 500) };
              }
              const episodes = await this.catalog.matchFrameEpisodes([
                ...new Set(matches.flatMap((match) => (match.anime ? [match.anime.slug] : []))),
              ]);
              for (const match of matches) match.watch = selectFrameEpisode(match, episodes);
            })(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("Catalog timeout.")), 1500);
            }),
          ]);
        } catch {
          /* Recognition remains available if the local catalog is unavailable. */
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      let quotaTimer: ReturnType<typeof setTimeout> | undefined;
      let quota: FrameSearchQuota | undefined;
      try {
        quota = await Promise.race([
          this.getQuota().catch(() => undefined),
          new Promise<undefined>((resolve) => {
            quotaTimer = setTimeout(() => resolve(undefined), 1000);
          }),
        ]);
      } finally {
        if (quotaTimer) clearTimeout(quotaTimer);
      }
      return frameSearchResultSchema.parse({
        provider: "trace.moe",
        matches,
        quota,
      });
    } finally {
      this.active = false;
    }
  }
}
