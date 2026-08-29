import type { AnimeUserRatings, CommunityAnimeRating, CommunityRatings } from "../../lib/types";
import { requestJson } from "../../lib/http";

type CommunityRatingsPayload = {
  ratings?: Record<string, CommunityAnimeRating>;
  rating?: CommunityAnimeRating | null;
  detail?: string;
};

const CHUNK_SIZE = 100;

/** Load anonymous aggregate ratings from the current AnimeSoul server. */
export async function fetchCommunityRatings(animeIds: number[]): Promise<CommunityRatings> {
  const ids = [...new Set(animeIds.filter(Number.isFinite))];
  const chunks = Array.from(
    { length: Math.ceil(ids.length / CHUNK_SIZE) },
    (_, index) => ids.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
  );
  const pages = await Promise.all(chunks.map(async chunk => {
    const payload = await requestCommunityRatings(
      `/api/community-ratings?ids=${chunk.join(",")}`,
    );
    return payload.ratings ?? {};
  }));
  return Object.fromEntries(
    pages.flatMap(page => Object.entries(page).map(([animeId, rating]) => [Number(animeId), rating])),
  );
}

/** Publish the complete local rating tree as this browser's anonymous vote. */
export async function publishCommunityRating(
  animeId: number,
  ratings: AnimeUserRatings,
): Promise<CommunityAnimeRating | null> {
  const payload = await requestCommunityRatings(`/api/community-ratings/${animeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: ratings.title ?? "",
      anime: ratings.anime,
      seasons: ratings.seasons,
      episodes: ratings.episodes,
    }),
  });
  return payload.rating ?? null;
}

async function requestCommunityRatings(url: string, init?: RequestInit) {
  return requestJson<CommunityRatingsPayload>(url, {
    credentials: "include",
    ...init,
    errorMessage: status => `Community ratings request failed: ${status}`,
  });
}
