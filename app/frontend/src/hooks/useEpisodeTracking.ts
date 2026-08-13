"use client";

import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Tracker } from "../lib/types";
import { fetchTrackingSnapshot } from "../features/tracking/api";
import { STORAGE_KEYS as K } from "../lib/settings";
import { writeLocal as write } from "../lib/storage";
import { reconcileTrackedEpisodes } from "../lib/tracking";

export function useEpisodeTracking({
  tracked,
  setTracked,
}: {
  tracked: Tracker[];
  setTracked: Dispatch<SetStateAction<Tracker[]>>;
}) {
  const trackedRef = useRef(tracked);
  trackedRef.current = tracked;

  useEffect(() => {
    if (!tracked.length) return;
    let cancelled = false;
    let checking = false;

    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        for (const item of trackedRef.current) {
          if (cancelled) return;
          if (item.lastCheckedAt && Date.now() - item.lastCheckedAt < 240_000) continue;
          const snapshot = await fetchTrackingSnapshot(item, () => cancelled);
          if (cancelled || !snapshot || snapshot.successfulRequests === 0) continue;

          const now = Date.now();
          setTracked((current) => {
            const target = current.find((entry) => entry.animeId === item.animeId);
            if (!target) return current;
            const nextItem = reconcileTrackedEpisodes(
              target,
              snapshot.animeIds,
              snapshot.episodeDates,
              now,
              snapshot.allDubEpisodeDates,
            );
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
    setTracked,
  ]);
}
