"use client";

import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Anime, Tracker, Video } from "../lib/types";
import { STORAGE_KEYS as K } from "../lib/settings";
import { writeLocal as write } from "../lib/storage";
import { collectPlayableEpisodeDates, reconcileTrackedEpisodes } from "../lib/tracking";

export function useEpisodeTracking({
  tracked,
  setTracked,
  view,
  active,
}: {
  tracked: Tracker[];
  setTracked: Dispatch<SetStateAction<Tracker[]>>;
  view: string;
  active: Anime | null;
}) {
  const trackedRef = useRef(tracked);
  trackedRef.current = tracked;

  useEffect(() => {
    if (view !== "home" || active || !tracked.length) return;
    let cancelled = false;
    let checking = false;

    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        for (const item of trackedRef.current) {
          if (cancelled) return;
          if (item.lastCheckedAt && Date.now() - item.lastCheckedAt < 240_000) continue;

          const seeds = [...new Set(item.animeIds?.length ? item.animeIds : [item.animeId])];
          let animeIds = seeds;
          try {
            const response = await fetch(`/api/yummy?mode=details&ids=${seeds.join(",")}`);
            const payload = await response.json();
            if (response.ok) {
              const entries = (payload.anime ?? []) as Anime[];
              animeIds = [
                ...new Set([
                  ...seeds,
                  ...entries.flatMap((entry) => [
                    entry.anime_id,
                    ...(entry.viewing_order ?? []).map((related) => related.anime_id),
                  ]),
                ]),
              ].filter(Number.isFinite);
            }
          } catch {}

          const episodeDates = new Map<string, number>();
          let successfulRequests = 0;
          for (const animeId of animeIds) {
            if (cancelled) return;
            try {
              const response = await fetch(`/api/yummy?mode=videos&id=${animeId}`);
              const payload = await response.json();
              if (!response.ok) continue;
              successfulRequests++;
              const playableDates = collectPlayableEpisodeDates(
                animeId,
                (payload.videos ?? []) as Video[],
                item.dubs ?? [],
              );
              for (const [key, date] of playableDates) {
                episodeDates.set(key, Math.max(episodeDates.get(key) ?? 0, date));
              }
            } catch {}
            await new Promise((resolve) => setTimeout(resolve, 220));
          }

          // Частичный ответ API не должен становиться новой точкой отсчёта:
          // иначе временно пропавшие серии появятся как «новые» при следующем запросе.
          if (cancelled || successfulRequests !== animeIds.length) continue;
          const now = Date.now();
          setTracked((current) => {
            const target = current.find((entry) => entry.animeId === item.animeId);
            if (!target) return current;
            const nextItem = reconcileTrackedEpisodes(target, animeIds, episodeDates, now);
            const next = current.map((entry) =>
              entry.animeId === item.animeId ? nextItem : entry,
            );
            trackedRef.current = next;
            write(K.tracked, next);
            return next;
          });
        }
      } finally {
        checking = false;
      }
    };

    void check();
    const timer = setInterval(() => void check(), 300_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    tracked
      .map((item) => `${item.animeId}:${item.animeIds?.join(",")}:${item.dubs?.join(",")}`)
      .join("|"),
    view,
    active,
    setTracked,
  ]);
}
