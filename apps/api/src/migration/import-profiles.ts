import { createHash } from "node:crypto";
import { z } from "zod";
import { privateVisibility } from "@animesoul/contracts";
import { catalogFields, type Database } from "@animesoul/database";
import { normalizeYummyAnime, record } from "../providers/normalizers.js";
import { digest } from "../auth/security.js";

const integerId = z.number().int().positive();
const scoreSchema = z.number().int().min(1).max(10);
const ratingsSchema = z
  .union([
    scoreSchema,
    z.object({
      anime: scoreSchema.optional(),
      seasons: z.record(z.string().max(100), scoreSchema).default({}),
      episodes: z.record(z.string().max(100), scoreSchema).default({}),
      title: z.string().optional(),
      updatedAt: z.number().optional(),
    }),
  ])
  .transform((value) =>
    typeof value === "number" ? { anime: value, seasons: {}, episodes: {} } : value,
  );
const episode = z
  .object({
    position: z.number().nonnegative().default(0),
    duration: z.number().nonnegative().default(0),
    watchedSeconds: z.number().nonnegative().default(0),
    completed: z.boolean().default(false),
  })
  .passthrough();
const progress = z
  .object({
    episode: z.string().max(80),
    dub: z.string().max(120).default(""),
    season: z.number().int().min(1).default(1),
    episodes: z.record(z.string().max(80), episode).default({}),
  })
  .passthrough();
const snapshot = z
  .object({
    favorites: z.array(integerId).default([]),
    folders: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          name: z.string().min(1).max(100),
          animeIds: z.array(integerId),
          notes: z.record(z.string(), z.string().max(2000)).default({}),
        }),
      )
      .default([]),
    progress: z.record(z.string().regex(/^\d+$/), progress).default({}),
    ratings: z.record(z.string().regex(/^\d+$/), ratingsSchema).default({}),
    tracked: z.array(z.object({ animeId: integerId }).passthrough()).default([]),
  })
  .passthrough();
const documentSchema = z.object({
  profiles: z
    .array(z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(100), snapshot }))
    .min(1)
    .max(100),
});

/** Stable migration IDs only; original UUIDs are retained verbatim. */
export function migrationId(value: string) {
  const hash = createHash("sha256")
    .update("animesoul:migration:" + value)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
function safeJson(value: unknown, depth = 0): Json {
  if (depth > 8) return null;
  if (typeof value === "boolean" || value === null) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string")
    return /(?:https?:|\/\/|\.m3u8\b|\.mp4\b)/i.test(value) ? null : value.slice(0, 2000);
  if (Array.isArray(value)) return value.slice(0, 10000).map((v) => safeJson(v, depth + 1));
  return Object.fromEntries(
    Object.entries(record(value))
      .slice(0, 10000)
      .filter(([key]) => !/(?:url|token|secret|password|embed|iframe|link)/i.test(key))
      .map(([key, v]) => [key, safeJson(v, depth + 1)]),
  );
}
function pick(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((key) => [key, safeJson(source[key])]),
  );
}
const progressKeys = [
  "title",
  "totalEpisodes",
  "totalDuration",
  "seasonLabel",
  "originAnimeId",
  "originEpisode",
  "resetAt",
];
const episodeKeys = [
  "percent",
  "originAnimeId",
  "originEpisode",
  "dub",
  "player",
  "completions",
  "completionHistory",
  "rewatchArmed",
  "manuallyCompleted",
  "manualPrevious",
];
const trackerKeys = [
  "title",
  "animeIds",
  "knownEpisodes",
  "knownEpisodeKeys",
  "episodeIdentityCheckedIds",
  "pendingEpisodeKeys",
  "newEpisodes",
  "knownAnyEpisodeKeys",
  "pendingOtherDubEpisodeKeys",
  "otherDubEpisodes",
  "dubs",
  "lastCheckedAt",
  "lastNewEpisodeAt",
];

export async function importProfiles(
  database: Database,
  document: unknown,
  identities: unknown = {},
) {
  const parsed = documentSchema.parse(document);
  if (new Set(parsed.profiles.map((p) => p.id)).size !== parsed.profiles.length)
    throw new Error("Duplicate legacy profile IDs.");
  const metadata = record(identities);
  const results = [];
  for (const profile of parsed.profiles) {
    const sourceHash = digest(JSON.stringify(profile));
    const result = await database.$transaction(
      async (tx) => {
        const previous = await tx.legacyProfile.findUnique({ where: { legacyId: profile.id } });
        if (previous) {
          if (previous.sourceHash !== sourceHash)
            throw new Error(
              "Legacy profile changed after import; merge requires an explicit reviewed migration.",
            );
          return {
            userId: previous.userId,
            preservedUuid: z.uuid().safeParse(profile.id).success,
            skipped: true,
          };
        }
        const userId = z.uuid().safeParse(profile.id).success
          ? profile.id
          : migrationId(profile.id);
        if (await tx.user.findUnique({ where: { id: userId } }))
          throw new Error("User UUID is already owned by another account.");
        const baseName = profile.name.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 30) || "profile";
        const username = `${baseName.length >= 2 ? baseName : "profile"}-${userId.slice(0, 8)}`;
        const preferences = pick(profile.snapshot, [
          "version",
          "name",
          "createdAt",
          "theme",
          "toolbar",
          "historyClearedAt",
          "historyEnabled",
          "watchingHidden",
          "animeTitles",
          "fieldUpdatedAt",
          "libraryExpanded",
          "watchingExpanded",
          "historyExpanded",
        ]);
        preferences.playerPrefs = safeJson(profile.snapshot.playerPrefs);
        await tx.user.create({
          data: {
            id: userId,
            profile: {
              create: {
                username,
                usernameKey: username.toLowerCase(),
                visibility: privateVisibility,
                content: {},
                preferences,
              },
            },
          },
        });
        const allIds = new Set<number>([
          ...profile.snapshot.favorites,
          ...profile.snapshot.folders.flatMap((f) => f.animeIds),
          ...Object.keys(profile.snapshot.progress).map(Number),
          ...Object.keys(profile.snapshot.ratings).map(Number),
          ...profile.snapshot.tracked.flatMap((t) => [
            t.animeId,
            ...(Array.isArray(t.animeIds)
              ? t.animeIds.filter(
                  (id): id is number =>
                    typeof id === "number" && Number.isSafeInteger(id) && id > 0,
                )
              : []),
          ]),
        ]);
        const mapped = new Map<number, string>();
        let placeholders = 0,
          episodes = 0;
        for (const externalId of allIds) {
          const existing = await tx.animeProvider.findUnique({
            where: { provider_externalId: { provider: "yummy", externalId: String(externalId) } },
          });
          let animeId = existing?.animeId;
          if (!animeId) {
            const identity = record(metadata[String(externalId)]);
            const title =
              typeof identity.title === "string" && identity.title
                ? identity.title
                : typeof record(profile.snapshot.animeTitles)[String(externalId)] === "string"
                  ? (record(profile.snapshot.animeTitles)[String(externalId)] as string)
                  : `Аниме ${externalId}`;
            const normalized = normalizeYummyAnime({ ...identity, anime_id: externalId, title });
            const anime = catalogFields(normalized.anime);
            animeId = normalized.anime.id;
            await tx.anime.create({
              data: {
                ...anime,
                published: false,
                providers: { create: { provider: "yummy", externalId: String(externalId) } },
              },
            });
            placeholders++;
          }
          mapped.set(externalId, animeId);
          const current = profile.snapshot.progress[String(externalId)];
          const tracker = profile.snapshot.tracked.find((t) => t.animeId === externalId);
          const ratings = profile.snapshot.ratings[String(externalId)];
          await tx.libraryItem.create({
            data: {
              userId,
              animeId,
              favorite: profile.snapshot.favorites.includes(externalId),
              score: ratings?.anime ?? null,
              lastEpisode: current?.episode ?? "",
              dubbing: current?.dub ?? "",
              season: current?.season ?? 1,
              progressDetails: current ? pick(current, progressKeys) : {},
              tracking: tracker ? pick(tracker, trackerKeys) : {},
            },
          });
          for (const [scope, values] of [
            ["season", ratings?.seasons ?? {}],
            ["episode", ratings?.episodes ?? {}],
          ] as const) {
            for (const [key, score] of Object.entries(values))
              await tx.libraryRating.create({ data: { userId, animeId, scope, key, score } });
          }
          for (const [episodeKey, state] of Object.entries(current?.episodes ?? {})) {
            await tx.episodeProgress.create({
              data: {
                userId,
                animeId,
                episodeKey,
                position: state.position,
                duration: state.duration,
                watchedSeconds: state.watchedSeconds,
                completed: state.completed,
                details: pick(state, episodeKeys),
                ...(typeof state.updatedAt === "number" &&
                state.updatedAt > 0 &&
                state.updatedAt < 8640000000000000
                  ? { updatedAt: new Date(state.updatedAt) }
                  : {}),
              },
            });
            episodes++;
          }
        }
        for (const folder of profile.snapshot.folders) {
          const id = migrationId(userId + ":folder:" + folder.id);
          await tx.libraryFolder.create({ data: { id, userId, name: folder.name } });
          await tx.folderEntry.createMany({
            data: [...new Set(folder.animeIds)].map((oldId) => ({
              folderId: id,
              userId,
              animeId: mapped.get(oldId)!,
              note: folder.notes[String(oldId)] ?? "",
            })),
          });
        }
        await tx.legacyProfile.create({ data: { legacyId: profile.id, userId, sourceHash } });
        await tx.auditEvent.create({
          data: {
            action: "migration.profile-imported",
            objectId: userId,
            reason: "Private local profile imported without credentials or privileges.",
          },
        });
        return {
          userId,
          preservedUuid: userId === profile.id,
          skipped: false,
          favorites: profile.snapshot.favorites.length,
          folders: profile.snapshot.folders.length,
          ratings: Object.keys(profile.snapshot.ratings).length,
          items: allIds.size,
          episodes,
          placeholders,
        };
      },
      { timeout: 60000 },
    );
    results.push(result);
  }
  return results;
}
