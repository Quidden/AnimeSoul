import { useCallback, useEffect, useMemo, useState } from "react";

import { readLocal, writeLocal } from "../../lib/storage";
import type { AnimeUserRatings, CommunityRatings, UserRatings } from "../../lib/types";
import { fetchCommunityRatings, publishCommunityRating } from "./api";

const PUBLISHED_RATINGS_KEY = "animesoul:community-ratings-published-v1";
const RATING_REMOVALS_KEY = "animesoul:community-rating-removals-v1";
const RETRY_DELAY = 30_000;

/**
 * Bridges portable personal ratings and anonymous server-wide aggregates.
 * A missing/offline endpoint never blocks local profile persistence.
 */
export function useCommunityRatings({
  animeIds,
  personalRatings,
}: {
  animeIds: number[];
  personalRatings: UserRatings;
}) {
  const [communityRatings, setCommunityRatings] = useState<CommunityRatings>({});
  const [retryRevision, setRetryRevision] = useState(0);
  const normalizedIds = useMemo(
    () => [...new Set(animeIds.filter(Number.isFinite))].sort((left, right) => left - right),
    [animeIds.join(",")],
  );
  const idsKey = normalizedIds.join(",");

  const refresh = useCallback(async () => {
    if (!normalizedIds.length) return;
    const loaded = await fetchCommunityRatings(normalizedIds);
    setCommunityRatings(current => {
      const next = { ...current };
      normalizedIds.forEach(animeId => delete next[animeId]);
      return { ...next, ...loaded };
    });
  }, [idsKey]);

  const publishRating = useCallback(async (
    animeId: number,
    rating: AnimeUserRatings,
  ) => {
    const aggregate = await publishCommunityRating(animeId, rating);
    setCommunityRatings(current => {
      const next = { ...current };
      if (aggregate) next[animeId] = aggregate;
      else delete next[animeId];
      return next;
    });
    const published = readLocal<Record<number, number>>(PUBLISHED_RATINGS_KEY, {});
    published[animeId] = rating.updatedAt ?? Date.now();
    writeLocal(PUBLISHED_RATINGS_KEY, published);
    return aggregate;
  }, []);

  const queueRatingRemoval = useCallback((animeId: number, rating: AnimeUserRatings) => {
    const removals = readLocal<Record<number, AnimeUserRatings>>(RATING_REMOVALS_KEY, {});
    removals[animeId] = rating;
    writeLocal(RATING_REMOVALS_KEY, removals);
    setRetryRevision(value => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refresh().catch(() => {
      if (!cancelled) window.setTimeout(() => setRetryRevision(value => value + 1), RETRY_DELAY);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh, retryRevision]);

  useEffect(() => {
    const published = readLocal<Record<number, number>>(PUBLISHED_RATINGS_KEY, {});
    const removals = readLocal<Record<number, AnimeUserRatings>>(RATING_REMOVALS_KEY, {});
    let removalsChanged = false;
    Object.keys(removals).forEach(animeId => {
      // A score added again while an offline tombstone was queued wins.
      if (personalRatings[Number(animeId)]) {
        delete removals[Number(animeId)];
        removalsChanged = true;
      }
    });
    if (removalsChanged) writeLocal(RATING_REMOVALS_KEY, removals);
    const personalPending = Object.entries(personalRatings).filter(([animeId, rating]) => (
      published[Number(animeId)] === undefined
      || (rating.updatedAt ?? 0) > published[Number(animeId)]
    ));
    const pending = [
      ...personalPending.map(([animeId, rating]) => ({ animeId, rating, removal: false })),
      ...Object.entries(removals).map(([animeId, rating]) => ({ animeId, rating, removal: true })),
    ];
    if (!pending.length) return;

    let cancelled = false;
    let retryTimer: number | undefined;
    const timer = window.setTimeout(async () => {
      let failed = false;
      for (const item of pending) {
        if (cancelled) return;
        try {
          await publishRating(Number(item.animeId), item.rating);
          if (item.removal) {
            const queued = readLocal<Record<number, AnimeUserRatings>>(RATING_REMOVALS_KEY, {});
            delete queued[Number(item.animeId)];
            writeLocal(RATING_REMOVALS_KEY, queued);
          }
        } catch {
          failed = true;
        }
      }
      if (failed && !cancelled) {
        retryTimer = window.setTimeout(
          () => setRetryRevision(value => value + 1),
          RETRY_DELAY,
        );
      }
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [personalRatings, publishRating, retryRevision]);

  return {
    communityRatings,
    publishRating,
    queueRatingRemoval,
    refreshCommunityRatings: refresh,
  };
}
