"use client";
import Link from "next/link";
import { useState } from "react";
import { catalogSchema, type Anime } from "@animesoul/contracts";
import { AnimeCard } from "./AnimeCard";
import { HomeRail } from "./HomeRail";
import { reportClientError } from "../lib/diagnostics-client";

export function HomePopular({ initialItems }: { initialItems: Anime[] | null }) {
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);
  async function retry() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/catalog?sort=popular&pageSize=18", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
      setItems(catalogSchema.parse(await response.json()).items);
    } catch (error) {
      reportClientError(error, "request");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="home-popular" aria-labelledby="home-popular-title">
      <div className="home-library-heading">
        <div>
          <h2 id="home-popular-title">Популярные аниме</h2>
          <p>Истории, к которым возвращаются.</p>
        </div>
        <Link className="home-section-link" href="/catalog/popular">
          Смотреть всё <span aria-hidden="true">↗</span>
        </Link>
      </div>
      {items === null ? (
        <div className="home-watching-empty" role="status">
          <p>Подборка временно недоступна. Попробуй загрузить её ещё раз.</p>
          <button
            className="home-section-link"
            type="button"
            disabled={busy}
            onClick={() => void retry()}
          >
            {busy ? "Загружаем…" : "Повторить ↗"}
          </button>
        </div>
      ) : (
        <HomeRail label="Популярные аниме" variant="popular">
          {items.map((anime) => (
            <AnimeCard key={anime.id} anime={anime} />
          ))}
        </HomeRail>
      )}
    </section>
  );
}
