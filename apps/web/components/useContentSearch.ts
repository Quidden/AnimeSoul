"use client";
import { useEffect, useState } from "react";
import { globalSearchResponseSchema } from "@animesoul/contracts";

export type ContentSuggestion = {
  kind: "anime" | "character";
  id: string;
  slug: string;
  title: string;
  names: string[];
  image: string | null;
};

export function useContentSearch(query: string, enabled: boolean, revision = 0) {
  const [items, setItems] = useState<ContentSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setItems([]);
    setError("");
    const q = query.trim().slice(0, 100);
    if (!enabled || q.length < 2) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      void fetch("/api/search?" + new URLSearchParams({ q }), {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Подсказки временно недоступны.");
          return globalSearchResponseSchema.parse(await response.json());
        })
        .then((result) => {
          if (controller.signal.aborted) return;
          setItems([
            ...result.anime.slice(0, 4).map(
              (anime): ContentSuggestion => ({
                kind: "anime",
                id: anime.id,
                slug: anime.slug,
                title: anime.title,
                names: [anime.title, anime.originalTitle, ...anime.aliases],
                image: anime.poster,
              }),
            ),
            ...result.characters.slice(0, 4).map(
              (character): ContentSuggestion => ({
                kind: "character",
                id: character.id,
                slug: character.slug,
                title: character.name,
                names: [character.name, character.originalName, ...character.aliases],
                image: character.image,
              }),
            ),
          ]);
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setError("Не удалось загрузить подсказки. Можно продолжить писать.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, enabled, revision]);
  return { items, loading, error };
}
