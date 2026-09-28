import {useCallback, useEffect, useRef, useState} from "react";
import type {Anime} from "../../lib/types";
import {fetchCatalogPage} from "./api";

/** Independent cursor: general-catalog pages cannot exhaust the ongoing shelf. */
export function useOngoingCatalog(enabled: boolean) {
    const [items, setItems] = useState<Anime[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [hasMore, setHasMore] = useState(true);
    const cursor = useRef(0);
    const started = useRef(false);
    const inflight = useRef(false);
    const load = useCallback(async () => {
        if (inflight.current) return;
        inflight.current = true;
        started.current = true;
        setLoading(true);
        setError("");
        try {
            const page = await fetchCatalogPage({limit: 48, offset: cursor.current, status: "airing"});
            cursor.current += page.length;
            setItems(current => [...new Map([...current, ...page].map(anime => [anime.anime_id, anime])).values()]);
            setHasMore(page.length === 48);
        } catch {
            setError("Не удалось загрузить онгоинги. Проверьте подключение и доступ к YummyAnime.");
        } finally {
            inflight.current = false;
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        if (enabled && !started.current) void load();
    }, [enabled, load]);
    return {items, loading, error, hasMore, load};
}
