"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { catalogSchema, type Anime } from "@animesoul/contracts";
import { reportClientError } from "../lib/diagnostics-client";
import { formatLabels } from "../lib/catalog-filters";
import { ratingNumber } from "../lib/ratings";

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
    <section
      className="home-popular"
      aria-labelledby="home-popular-title"
      data-compass="Популярное"
    >
      <div className="home-library-heading">
        <div>
          <h2 id="home-popular-title">Популярное</h2>
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
        <PopularRow items={items.slice(0, 10)} />
      )}
    </section>
  );
}

// Posters stand side by side; the one under the pointer or focus opens up. Nothing scrolls.
function PopularRow({ items }: { items: Anime[] }) {
  const [open, setOpen] = useState(0);
  const pointer = useRef("mouse");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <ol className="home-popular-row">
      {items.map((anime, index) => (
        <li key={anime.id} className={index === open ? "is-open" : undefined}>
          <Link
            href={`/anime/${anime.slug}`}
            aria-label={`${index + 1} место: ${anime.title}`}
            onPointerDown={(event) => {
              pointer.current = event.pointerType;
            }}
            onPointerEnter={(event) => {
              if (event.pointerType !== "mouse") return;
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setOpen(index), 70);
            }}
            onPointerLeave={() => clearTimeout(timer.current)}
            onFocus={() => setOpen(index)}
            onClick={(event) => {
              // A first tap on a closed poster opens it; the next one goes to the anime.
              if (index !== open && pointer.current !== "mouse") {
                event.preventDefault();
                setOpen(index);
              }
              pointer.current = "mouse";
            }}
          >
            {anime.poster ? (
              <img
                className="home-popular-poster"
                src={anime.poster}
                alt=""
                width={320}
                height={480}
                loading={index < 4 ? "eager" : "lazy"}
                draggable={false}
              />
            ) : (
              <span className="home-popular-poster is-empty" />
            )}
            <span className="home-popular-short" aria-hidden="true">
              {anime.title}
            </span>
            <span className="home-popular-info" aria-hidden={index !== open}>
              <span className="home-popular-meta">
                {[
                  anime.year || null,
                  formatLabels[anime.format ?? "unknown"],
                  anime.shikimoriScore ? `★ ${ratingNumber(anime.shikimoriScore)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <strong>{anime.title}</strong>
              {anime.description && (
                <span className="home-popular-description">{anime.description}</span>
              )}
              <span className="home-popular-open">▶ Открыть</span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
