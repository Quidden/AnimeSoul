import {useEffect, useState} from "react";

import {fetchAnimeDetails} from "../catalog/api";
import type {Anime, PartyState} from "../../lib/types";

/** Resolves the host's shared playback to a full catalog record when needed. */
export function usePartyHostPlayback(party: PartyState | null, catalog: Anime[]) {
    const [details, setDetails] = useState<Anime | null>(null);
    const host = party?.participants.find(participant => participant.role === "host");
    const playback = host?.playback;
    const playbackAnimeId = playback?.animeId;
    const catalogAnime = playbackAnimeId
        ? catalog.find(anime => anime.anime_id === playbackAnimeId)
        : undefined;

    useEffect(() => {
        if (!playbackAnimeId || catalogAnime) {
            setDetails(null);
            return;
        }

        let cancelled = false;
        fetchAnimeDetails([playbackAnimeId])
            .then(anime => {
                if (!cancelled) setDetails(anime[0] ?? null);
            })
            .catch(() => {
                if (!cancelled) setDetails(null);
            });
        return () => {
            cancelled = true;
        };
    }, [catalogAnime, playbackAnimeId]);

    const anime = playbackAnimeId
        ? catalogAnime ?? (details?.anime_id === playbackAnimeId ? details : null)
        : null;

    return {anime, host, playback};
}
