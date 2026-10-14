import {
  catalogFields,
  type Database,
  type DatabaseTransaction,
  type Prisma,
} from "@animesoul/database";
import { normalizeYummyAnime } from "./normalizers.js";
export async function saveNormalizedAnime(
  tx: DatabaseTransaction,
  normalized: ReturnType<typeof normalizeYummyAnime>,
  metadataProvider: "legacy" | "kodik" = "legacy",
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(731006, 3)`;
  let conflicts = 0;
  const reference = normalized.providers[0]!;
  const existing = await tx.animeProvider.findUnique({ where: { provider_externalId: reference } });
  const { id: proposedId, slug: proposedSlug, ...fields } = catalogFields(normalized.anime);
  const id = existing?.animeId ?? proposedId!;
  const previousMetadata = await tx.anime.findUnique({
    where: { id },
    select: { details: true, translations: true, year: true },
  });
  const previousDetails = (previousMetadata?.details ?? {}) as Record<string, unknown>;
  const freshDirect =
    typeof previousDetails.shikimoriFetchedAt === "string" &&
    Date.parse(previousDetails.shikimoriFetchedAt) > Date.now() - 86400000;
  if (freshDirect) {
    delete fields.shikimoriScore;
    delete fields.format;
    fields.year = previousMetadata!.year;
  }
  const details = normalized.anime.details
    ? ({
        ...(freshDirect ? normalized.anime.details : previousDetails),
        ...(freshDirect ? previousDetails : normalized.anime.details),
      } as Prisma.InputJsonObject)
    : undefined;
  const translations = normalized.anime.translations
    ? [
        ...new Set([...(previousMetadata?.translations ?? []), ...normalized.anime.translations]),
      ].slice(0, 200)
    : undefined;
  await tx.anime.upsert({
    where: { id },
    create: {
      ...fields,
      ...(details ? { details } : {}),
      ...(translations ? { translations } : {}),
      id,
      slug: proposedSlug!,
      published: true,
      metadataProvider,
    },
    update: {
      ...fields,
      ...(details ? { details } : {}),
      ...(translations ? { translations } : {}),
      published: true,
      metadataProvider,
    },
  });
  for (const mapping of normalized.providers) {
    const policy = await tx.providerMappingOverride.findUnique({
      where: { provider_externalId: mapping },
    });
    if (policy && (policy.ignored ? policy.animeId === id : policy.animeId !== id)) continue;
    const owner = await tx.animeProvider.findUnique({ where: { provider_externalId: mapping } });
    const previous = await tx.animeProvider.findUnique({
      where: { animeId_provider: { animeId: id, provider: mapping.provider } },
    });
    if (
      (owner && owner.animeId !== id) ||
      (previous && previous.externalId !== mapping.externalId)
    ) {
      conflicts++;
      const where = { provider_externalId_incomingAnimeId: { ...mapping, incomingAnimeId: id } };
      const seen = await tx.providerMappingConflict.findUnique({ where });
      const snapshot = {
        existingAnimeId: owner?.animeId ?? null,
        previousExternalId: previous?.externalId ?? null,
      };
      const changed =
        seen &&
        (seen.existingAnimeId !== snapshot.existingAnimeId ||
          seen.previousExternalId !== snapshot.previousExternalId);
      await tx.providerMappingConflict.upsert({
        where,
        create: { ...mapping, incomingAnimeId: id, ...snapshot },
        update: {
          lastSeenAt: new Date(),
          ...(changed
            ? {
                ...snapshot,
                version: { increment: 1 },
                status: "open",
                decision: null,
                reason: null,
                resolvedAt: null,
                resolvedBy: null,
              }
            : {}),
        },
      });
      continue;
    }
    await tx.animeProvider.upsert({
      where: { provider_externalId: mapping },
      create: { ...mapping, animeId: id },
      update: {},
    });
  }
  return { id, conflicts };
}
/** Repeatable import: provider changes cannot replace existing internal identities. */
export async function saveImportedAnime(database: Database, raw: unknown) {
  const normalized = normalizeYummyAnime(raw);
  return database.$transaction((tx) => saveNormalizedAnime(tx, normalized));
}
