"use client";
import { useCardLibrary } from "./CardLibrary";
import { recentHomeProgress } from "../lib/home-viewing";

// The main button names where watching continues once the account history is known.
export function AnimeWatchStart({ animeId }: { animeId: string }) {
  const { library } = useCardLibrary();
  const latest = library
    ? recentHomeProgress(library.progress).find((progress) => progress.animeId === animeId)
    : undefined;
  const number = latest?.episode?.number;
  const label = !number
    ? "Смотреть"
    : latest?.completed
      ? `Смотреть дальше · после серии ${number}`
      : `Продолжить · серия ${number}`;
  return (
    <a className="primary watch-start" href="#anime-watch">
      <span aria-hidden="true">▶</span> {label}
    </a>
  );
}
