import {releaseStatus} from "../../lib/anime";
import type {Anime, Progress} from "../../lib/types";

/** Use the same completed-episode genre counts shown in Statistics. */
export function recommendAnime(catalog: Anime[], genres: [string, number][], progress: Progress, preferredGenre = "") {
    const weights = new Map(genres.filter(([, count]) => count > 0));
    const started = new Set<number>();
    for (const [id, item] of Object.entries(progress)) {
        for (const episode of Object.values(item.episodes)) {
            if (episode.position > 0 || episode.percent > 0 || episode.completed || (episode.watchedSeconds ?? 0) > 0) {
                started.add(Number(id));
                if (episode.originAnimeId) started.add(episode.originAnimeId);
            }
        }
    }
    return catalog.filter(anime => releaseStatus(anime).kind !== "planned"
        && ![anime, ...(anime.franchiseEntries ?? [])].some(item => started.has(item.anime_id)))
        .filter(anime => !preferredGenre || anime.genres?.some(genre => genre.title === preferredGenre))
        .map(anime => {
            const titles = [...new Set(anime.genres?.map(genre => genre.title) ?? [])];
            // Normalize tag count: more assigned genres must not automatically win.
            // This is taste similarity, never a claimed measure of genre intensity.
            const score = titles.reduce((sum, genre) => sum + (weights.get(genre) ?? 0), 0) / Math.max(1, titles.length);
            return {anime, score};
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || (b.anime.rating?.average ?? 0) - (a.anime.rating?.average ?? 0));
}

export function pickRecommendation(items: ReturnType<typeof recommendAnime>, random = Math.random) {
    let target = random() * items.reduce((sum, item) => sum + item.score, 0);
    return items.find(item => (target -= item.score) < 0)?.anime;
}
