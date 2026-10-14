"use client";
import { useEffect, useId, useRef, useState } from "react";
import { episodeListSchema, type Episode } from "@animesoul/contracts";
import {
  contentEpisodeHref,
  contentTimeLabel,
  parseContentTime,
  type ContentLinkKind,
} from "../lib/content-links";
import { useContentSearch, type ContentSuggestion } from "./useContentSearch";

export type ContentReference = { label: string; href: string; kind: ContentLinkKind };
export type ContentEditorContext = {
  anime?: { id: string; slug: string; title: string };
  episodeId?: string;
};

export function ContentReferencePicker({
  initialAnime,
  initialEpisodeId,
  episodeMode = false,
  disabled,
  onSelect,
  onClose,
}: {
  initialAnime?: ContentSuggestion | undefined;
  initialEpisodeId?: string | undefined;
  episodeMode?: boolean;
  disabled: boolean;
  onSelect: (reference: ContentReference) => void;
  onClose: () => void;
}) {
  const [anime, setAnime] = useState(initialAnime ?? null);
  const [mode, setMode] = useState<"anime" | "episode">(episodeMode ? "episode" : "anime");
  const [query, setQuery] = useState("");
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [season, setSeason] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [time, setTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const fieldId = useId();
  const cache = useRef(new Map<string, Episode[]>());
  const search = useContentSearch(query, !anime, retry);
  useEffect(() => {
    if (!anime || mode !== "episode") return;
    const controller = new AbortController();
    setError("");
    setEpisodes([]);
    setLoading(true);
    const load = async () => {
      let items = cache.current.get(anime.slug);
      if (!items) {
        const response = await fetch(`/api/anime/${anime.slug}/episodes`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Не удалось загрузить серии.");
        items = episodeListSchema.parse(await response.json()).episodes;
        cache.current.set(anime.slug, items);
      }
      if (controller.signal.aborted) return;
      const selected = items.find((episode) => episode.id === initialEpisodeId) ?? items[0];
      setEpisodes(items);
      setSeason(selected?.season ?? "");
      setEpisodeId(selected?.id ?? "");
    };
    void load()
      .catch(() => {
        if (!controller.signal.aborted) setError("Не удалось загрузить серии. Попробуйте ещё раз.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [anime?.slug, mode, initialEpisodeId, retry]);
  const selected = episodes.find((episode) => episode.id === episodeId);
  const seasons = [...new Set(episodes.map((episode) => episode.season))].sort((a, b) =>
    a.localeCompare(b, "ru", { numeric: true }),
  );
  function insert() {
    if (!anime || disabled) return;
    if (mode === "anime") {
      onSelect({ label: anime.title, href: `/anime/${anime.slug}`, kind: "anime" });
      return;
    }
    if (!selected) return;
    const seconds = time.trim() ? parseContentTime(time) : null;
    if (time.trim() && seconds === null) {
      setError("Введите время в формате 12:34, 1:02:03 или число секунд.");
      return;
    }
    if (seconds !== null && selected.duration !== null && seconds > selected.duration) {
      setError("Таймкод находится за пределами этой серии.");
      return;
    }
    onSelect({
      kind: "episode",
      label:
        `${anime.title} · сезон ${selected.season}, серия ${selected.number}` +
        (seconds === null ? "" : ` · ${contentTimeLabel(seconds)}`),
      href: contentEpisodeHref(anime.slug, selected.id, seconds),
    });
  }
  return (
    <div
      className="content-reference-picker"
      role="group"
      aria-label="Ссылка на аниме, персонажа или серию"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          insert();
        }
      }}
    >
      <div className="content-reference-picker-heading">
        <strong>{anime ? anime.title : "На что сослаться?"}</strong>
        <button type="button" className="text-link" disabled={disabled} onClick={onClose}>
          Закрыть
        </button>
      </div>
      {!anime ? (
        <>
          <label>
            Аниме или персонаж
            <input
              autoFocus
              value={query}
              maxLength={100}
              disabled={disabled}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Начните вводить название или имя"
            />
          </label>
          {search.loading && <p role="status">Ищем…</p>}
          {search.error && (
            <p role="status">
              {search.error}{" "}
              <button
                type="button"
                className="text-link"
                onClick={() => setRetry((value) => value + 1)}
              >
                Повторить
              </button>
            </p>
          )}
          <div className="content-reference-results">
            {search.items.map((item) => (
              <button
                key={item.kind + item.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (item.kind === "character")
                    onSelect({
                      label: item.title,
                      href: `/characters/${item.slug}`,
                      kind: "character",
                    });
                  else setAnime(item);
                }}
              >
                <span>{item.title}</span>
                <small>{item.kind === "anime" ? "Аниме" : "Персонаж"}</small>
              </button>
            ))}
          </div>
          {query.trim().length >= 2 && !search.loading && !search.error && !search.items.length && (
            <p role="status">Ничего не найдено. Попробуйте другое название.</p>
          )}
        </>
      ) : (
        <>
          <div className="content-reference-modes" role="group" aria-label="Куда ведёт ссылка">
            <button
              type="button"
              aria-pressed={mode === "anime"}
              disabled={disabled}
              onClick={() => {
                setMode("anime");
                setError("");
              }}
            >
              На аниме
            </button>
            <button
              type="button"
              aria-pressed={mode === "episode"}
              disabled={disabled}
              onClick={() => {
                setMode("episode");
                setError("");
              }}
            >
              Серия и таймкод
            </button>
            <button
              type="button"
              className="text-link"
              disabled={disabled}
              onClick={() => {
                setAnime(null);
                setQuery("");
                setTime("");
                setError("");
              }}
            >
              Другое аниме
            </button>
          </div>
          {mode === "episode" && (
            <>
              {loading && <p role="status">Загружаем серии…</p>}
              {!loading && !episodes.length && !error && (
                <p role="status">
                  У этого аниме пока нет доступных серий. Можно оставить ссылку на аниме.
                </p>
              )}
              {!!episodes.length && (
                <div className="content-reference-fields">
                  <label>
                    Сезон
                    <select
                      value={season}
                      disabled={disabled || loading}
                      onChange={(event) => {
                        const value = event.target.value;
                        setSeason(value);
                        setEpisodeId(
                          episodes.find((episode) => episode.season === value)?.id ?? "",
                        );
                        setTime("");
                        setError("");
                      }}
                    >
                      {seasons.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Серия
                    <select
                      value={episodeId}
                      disabled={disabled || loading}
                      onChange={(event) => {
                        setEpisodeId(event.target.value);
                        setTime("");
                        setError("");
                      }}
                    >
                      {episodes
                        .filter((episode) => episode.season === season)
                        .map((episode) => (
                          <option key={episode.id} value={episode.id}>
                            {episode.number}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Таймкод <small>необязательно</small>
                    <input
                      id={fieldId}
                      value={time}
                      disabled={disabled}
                      onChange={(event) => {
                        setTime(event.target.value);
                        setError("");
                      }}
                      placeholder="12:34"
                      inputMode="text"
                      maxLength={8}
                      aria-describedby={fieldId + "-help"}
                    />
                  </label>
                </div>
              )}
              {!!episodes.length && (
                <p id={fieldId + "-help"} className="content-editor-help">
                  Без таймкода ссылка откроет выбранную серию.{" "}
                  {selected?.duration
                    ? `Длительность: ${contentTimeLabel(selected.duration)}.`
                    : ""}
                </p>
              )}
            </>
          )}
          {error && (
            <p className="content-editor-notice" role="alert">
              {error}
              {!episodes.length && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Повторить загрузку
                </button>
              )}
            </p>
          )}
          <button
            type="button"
            className="primary"
            disabled={disabled || loading || (mode === "episode" && !selected)}
            onClick={insert}
          >
            Вставить ссылку
          </button>
        </>
      )}
    </div>
  );
}
