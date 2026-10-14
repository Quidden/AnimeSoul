"use client";
import { trackFeature } from "../lib/analytics-client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ProfileMediaKind } from "@animesoul/contracts";
import { giphyMediaUrl, giphyRendition, searchGiphy, type GiphyGif } from "../lib/profile-giphy";

export function ProfileGiphyPicker({
  kind,
  busy,
  save,
  close,
  preview,
}: {
  kind: ProfileMediaKind;
  busy: boolean;
  save: (kind: ProfileMediaKind, value: string) => Promise<boolean>;
  close: () => void;
  preview?: (value: string | null) => void;
}) {
  const [items, setItems] = useState<GiphyGif[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<GiphyGif | null>(null);
  const [query, setQuery] = useState("anime");
  const [search, setSearch] = useState("anime");
  const searchId = useId();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: "start" });
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    void searchGiphy(search, offset, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) {
          setItems((previous) =>
            offset
              ? [...new Map([...previous, ...result.items].map((gif) => [gif.id, gif])).values()]
              : result.items,
          );
          setNextOffset(result.nextOffset);
        }
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "GIPHY недоступен. Повторите позже.");
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [search, offset, revision]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = query.trim();
    if (!next || next.length > 50) {
      setError("Введите запрос длиной от 1 до 50 символов.");
      return;
    }
    setSelected(null);
    preview?.(null);
    setItems([]);
    setNextOffset(null);
    setError("");
    setLoading(true);
    setOffset(0);
    setSearch(next);
    setRevision((value) => value + 1);
  }
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="profile-giphy-picker"
      aria-label={`GIF из GIPHY — ${kind === "avatar" ? "аватар" : "обложка"}`}
      aria-busy={loading || busy}
    >
      <div className="profile-giphy-heading">
        <h3>{kind === "avatar" ? "GIF для аватара" : "GIF для обложки"}</h3>
        <a
          href="https://giphy.com"
          target="_blank"
          rel="noopener noreferrer"
          className="giphy-attribution"
        >
          Powered by <b>GIPHY</b>
        </a>
        <button type="button" className="outline" disabled={busy} onClick={close}>
          Закрыть
        </button>
      </div>
      <form className="profile-giphy-search" onSubmit={submit}>
        <label htmlFor={searchId}>Поиск в GIPHY</label>
        <div>
          <input
            id={searchId}
            name="giphy-query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={50}
            required
            placeholder="Аниме, персонаж или настроение"
            autoComplete="off"
            disabled={busy}
          />
          <button className="primary" disabled={busy}>
            Найти GIF
          </button>
        </div>
      </form>
      <p className="profile-media-help">
        Результаты по запросу «{search}». Выбери GIF и сохрани{" "}
        {kind === "avatar" ? "аватар" : "обложку"}.
      </p>
      <div className="profile-giphy-grid">
        {items.map((gif) => {
          const src = giphyMediaUrl(gif.images.fixed_width_small?.url) ?? giphyRendition(gif);
          return (
            <button
              type="button"
              key={gif.id}
              disabled={busy || loading || !src}
              aria-label={`Выбрать GIF: ${gif.title}`}
              aria-pressed={selected?.id === gif.id}
              onClick={() => {
                setSelected(gif);
                preview?.("giphy:" + gif.id);
              }}
            >
              {src ? (
                <img src={src} alt={gif.title} loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <span>GIF недоступна</span>
              )}
            </button>
          );
        })}
      </div>
      {loading && <p role="status">Загружаем GIF из GIPHY…</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-link"
            disabled={loading}
            onClick={() => setRevision((v) => v + 1)}
          >
            Повторить
          </button>
        </p>
      )}
      {!loading && !error && !items.length && (
        <p className="profile-giphy-empty" role="status">
          По запросу «{search}» ничего не найдено. Попробуй другое имя или загрузи свой GIF.
        </p>
      )}
      {!loading && !error && nextOffset !== null && (
        <button
          type="button"
          className="outline"
          disabled={busy}
          onClick={() => setOffset(nextOffset)}
        >
          Ещё GIF
        </button>
      )}
      {selected && (
        <div className="profile-giphy-selection">
          <img
            src={giphyRendition(selected, kind === "banner") ?? undefined}
            alt={`Предпросмотр — ${selected.title}`}
            referrerPolicy="no-referrer"
          />
          <button
            type="button"
            className="primary"
            disabled={busy || !giphyRendition(selected, kind === "banner")}
            onClick={() => {
              void save(kind, "giphy:" + selected.id).then((saved) => {
                if (saved) {
                  trackFeature("media.giphy");
                  close();
                }
              });
            }}
          >
            {busy
              ? "Сохраняем…"
              : kind === "avatar"
                ? "Сохранить аватар из GIPHY"
                : "Сохранить обложку из GIPHY"}
          </button>
        </div>
      )}
    </section>
  );
}
