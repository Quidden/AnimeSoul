"use client";
import { trackFeature } from "../lib/analytics-client";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  frameSearchAccept,
  type FrameSearchResult,
  type FrameSearchMatch,
} from "@animesoul/contracts";
import {
  frameFileError,
  frameTimestamp,
  frameWatchHref,
  searchByFrame,
} from "../lib/frame-search-client";
import { Icon } from "./Icon";
import {
  clearFrameSearchHistory,
  rememberFrameSearch,
  useFrameSearchHistory,
} from "./useFrameSearchHistory";
import { FrameSearchQuota, refreshFrameQuota, updateFrameQuota } from "./FrameSearchQuota";

function largePreview(value: string) {
  const url = new URL(value);
  if (url.hostname === "api.trace.moe") url.searchParams.set("size", "l");
  return url.href;
}

function FrameMatch({
  match,
  index,
  onNavigate,
}: {
  match: FrameSearchMatch;
  index: number;
  onNavigate?: (() => void) | undefined;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setImageFailed(false);
    setVideoFailed(false);
    setPlaying(false);
  }, [match.image, match.video, match.isAdult]);
  const season = match.season ?? match.watch?.season;
  const episode = match.watch?.episode ?? match.episode;
  const coordinates = [
    season ? `Сезон ${season}` : null,
    episode ? `Серия ${episode}` : null,
    frameTimestamp(match.timestamp),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="frame-match">
      <div className="frame-match-art">
        {playing && match.video && !match.isAdult && !videoFailed ? (
          <video
            src={largePreview(match.video)}
            poster={match.image && !imageFailed ? largePreview(match.image) : undefined}
            controls
            playsInline
            muted
            autoPlay
            preload="metadata"
            onError={() => setVideoFailed(true)}
          />
        ) : match.image && !imageFailed && !match.isAdult ? (
          <img
            src={largePreview(match.image)}
            alt={`Совпадение — ${match.title}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span>{match.isAdult ? "18+" : "Превью недоступно"}</span>
        )}
      </div>
      <div className="frame-match-body">
        <div className="frame-match-meta">
          <span
            className={match.similarity >= 0.9 ? "frame-similarity is-high" : "frame-similarity"}
          >
            {(match.similarity * 100).toFixed(1)}% сходства
          </span>
          {index === 0 && <span>Ближайший кадр</span>}
          {match.isAdult && <span>18+</span>}
        </div>
        <h3>{match.anime?.title ?? match.title}</h3>
        {match.anime && match.anime.title !== match.title && (
          <p className="frame-original-title">{match.title}</p>
        )}
        <p>
          {season ? `Сезон ${season}` : "Сезон не указан"} ·{" "}
          {episode ? `Серия ${episode}` : "Серия не указана"} · Кадр{" "}
          {frameTimestamp(match.timestamp)}
        </p>
        <div className="frame-match-actions">
          {match.anime ? (
            <Link
              className="primary frame-watch"
              href={frameWatchHref(match)!}
              title={match.watch ? `Смотреть: ${coordinates}` : "Открыть плеер и выбрать серию"}
              onClick={() => onNavigate?.()}
            >
              <span>Смотреть</span>
              <small>{coordinates}</small>
              {!match.watch && <small>Выбрать серию в плеере</small>}
            </Link>
          ) : (
            <Link
              className="outline"
              href={"/search?" + new URLSearchParams({ q: match.title.slice(0, 240) })}
              onClick={() => onNavigate?.()}
            >
              Найти в каталоге
            </Link>
          )}
          {match.video && !match.isAdult && !videoFailed && (
            <button type="button" className="outline" onClick={() => setPlaying((value) => !value)}>
              {playing ? "Показать кадр" : "Показать сцену"}
            </button>
          )}
        </div>
        {(imageFailed || videoFailed) && (
          <p className="frame-help">
            Превью истекло или недоступно. Название и ссылки остаются; для нового превью повторите
            поиск.
          </p>
        )}
      </div>
    </article>
  );
}

export function FrameSearch({
  compact = false,
  initialFile = null,
  onNavigate,
}: {
  compact?: boolean;
  initialFile?: File | null;
  onNavigate?: () => void;
}) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<FrameSearchResult | null>(null);
  const [fromHistory, setFromHistory] = useState(false);
  const history = useFrameSearchHistory();
  const request = useRef<AbortController | null>(null);
  const version = useRef(0);
  const resultElement = useRef<HTMLElement>(null);
  useEffect(() => {
    if (result) resultElement.current?.scrollIntoView({ block: "nearest" });
  }, [result]);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(
    () => () => {
      request.current?.abort();
      version.current++;
    },
    [],
  );
  const search = useCallback(async (next: File) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++version.current;
    setBusy(true);
    setError("");
    setResult(null);
    setFromHistory(false);
    try {
      const found = await searchByFrame(next, controller.signal);
      if (version.current === current) {
        setResult(found);
        trackFeature("search.frame");
        rememberFrameSearch(found);
        if (found.quota) updateFrameQuota(found.quota);
        else void refreshFrameQuota(true);
      }
    } catch (e) {
      if (version.current === current && !controller.signal.aborted) {
        setError(
          e instanceof Error && e.name !== "TimeoutError"
            ? e.message
            : "Поиск не ответил вовремя. Попробуйте позже.",
        );
        void refreshFrameQuota(true);
      }
    } finally {
      if (version.current === current) setBusy(false);
    }
  }, []);
  const choose = useCallback(
    (next: File) => {
      request.current?.abort();
      version.current++;
      setBusy(false);
      setResult(null);
      const invalid = frameFileError(next);
      setError(invalid ?? "");
      setFile(invalid ? null : next);
      setPreviewFailed(false);
      setFromHistory(false);
      if (!invalid) void search(next);
    },
    [search],
  );
  useEffect(() => {
    if (initialFile) choose(initialFile);
  }, [initialFile, choose]);
  useEffect(() => {
    if (compact) return;
    function paste(event: ClipboardEvent) {
      if (document.querySelector("dialog[open]")) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("textarea, input:not([type=file])"))
      )
        return;
      const image = Array.from(event.clipboardData?.files ?? []).find((item) =>
        item.type.startsWith("image/"),
      );
      if (image) {
        event.preventDefault();
        choose(image);
      }
    }
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, [choose, compact]);
  function clearFile() {
    request.current?.abort();
    version.current++;
    setBusy(false);
    setFile(null);
    setResult(null);
    setPreviewFailed(false);
    setError("");
    setFromHistory(false);
  }
  return (
    <div className="frame-search-tool" data-compact={compact} data-has-result={!!result}>
      <FrameSearchQuota />
      <div
        className="frame-upload"
        data-dragging={dragging}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragging(false);
          if (event.dataTransfer.files[0]) choose(event.dataTransfer.files[0]);
        }}
      >
        <div className="frame-upload-visual">
          {preview && !previewFailed ? (
            <img
              src={preview}
              alt="Выбранный кадр"
              onError={() => {
                setPreviewFailed(true);
                setError("Браузер не смог открыть кадр. Выберите другой файл.");
              }}
            />
          ) : (
            <>
              <Icon name="image" width={36} height={36} />
              <p>Перетащите сюда кадр</p>
              <span>или вставьте изображение из буфера · Ctrl + V</span>
            </>
          )}
        </div>
        <label htmlFor={id}>Выбрать изображение</label>
        <input
          id={id}
          type="file"
          accept={frameSearchAccept}
          aria-describedby={`${id}-help`}
          onChange={(event) => {
            const next = event.target.files?.[0];
            event.target.value = "";
            if (next) choose(next);
          }}
        />
        <p id={`${id}-help`} className="frame-help">
          JPEG, PNG, WebP или GIF · до 5 МБ, 4096 × 4096. Для GIF используется первый кадр.
        </p>
        {file && <p className="frame-filename">{file.name}</p>}
      </div>
      <div className="frame-submit-row">
        <button
          type="button"
          className="primary"
          disabled={!file || busy || previewFailed}
          onClick={() => {
            if (file) void search(file);
          }}
        >
          {busy ? "Ищем кадр…" : file ? "Повторить поиск" : "Найти аниме"}
        </button>
        {busy && (
          <button
            type="button"
            className="outline"
            onClick={() => {
              request.current?.abort();
              version.current++;
              setBusy(false);
              setError("Поиск отменён. Можно выбрать другой кадр или повторить.");
            }}
          >
            Отменить поиск
          </button>
        )}
        {file && !busy && (
          <button type="button" className="outline" onClick={clearFile}>
            Убрать кадр
          </button>
        )}
      </div>
      {!compact && (
        <p className="frame-help">
          Для точного результата используйте полный кадр без фильтров и обрезки.
        </p>
      )}
      {busy && (
        <p className="frame-status" role="status">
          Ищем совпадения…
        </p>
      )}
      {error && (
        <p className="frame-status is-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <section
          ref={resultElement}
          className="frame-results"
          aria-label="Результаты поиска по кадру"
        >
          <h2>{result.matches.length ? "Похожие кадры" : "Совпадений не найдено"}</h2>
          {fromHistory && (
            <p className="frame-help">
              Из истории поиска. Чтобы увидеть сцену, загрузите кадр снова.
            </p>
          )}
          {result.matches.length ? (
            <>
              <p role="status" className="frame-help">
                Найдено вариантов: {result.matches.length}. Сравните найденный кадр с вашим
                изображением.
              </p>
              {result.matches[0]!.similarity < 0.9 && (
                <p className="frame-status">
                  Сходство ниже 90% — результат может быть неверным. Попробуйте другой кадр той же
                  сцены.
                </p>
              )}
              <div className="frame-match-list">
                {result.matches.slice(0, 1).map((match, index) => (
                  <FrameMatch
                    key={`${match.anilistId}:${match.episode}:${match.timestamp}`}
                    match={match}
                    index={index}
                    onNavigate={onNavigate}
                  />
                ))}
                {result.matches.length > 1 && (
                  <details className="frame-alternatives">
                    <summary>Другие варианты · {result.matches.length - 1}</summary>
                    <div className="frame-match-list">
                      {result.matches.slice(1).map((match, index) => (
                        <FrameMatch
                          key={`${match.anilistId}:${match.episode}:${match.timestamp}`}
                          match={match}
                          index={index + 1}
                          onNavigate={onNavigate}
                        />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </>
          ) : (
            <p className="frame-help" role="status">
              Попробуйте другой кадр без обрезки и фильтров.
            </p>
          )}
        </section>
      )}
      {!!history.length && (
        <section className="frame-history" aria-label="История поиска по кадру">
          <div className="frame-history-heading">
            <h2>История поиска</h2>
            <button type="button" className="text-link" onClick={clearFrameSearchHistory}>
              Очистить историю кадров
            </button>
          </div>
          <div className="frame-history-list">
            {history.map((entry) => {
              const match = entry.result.matches[0]!;
              return (
                <button
                  type="button"
                  className="frame-history-item"
                  key={entry.id}
                  onClick={() => {
                    request.current?.abort();
                    version.current++;
                    setBusy(false);
                    setError("");
                    setFile(null);
                    setPreviewFailed(false);
                    setResult(entry.result);
                    setFromHistory(true);
                  }}
                >
                  <span>
                    <strong>{match.anime?.title ?? match.title}</strong>
                    <small>
                      {match.season ? `Сезон ${match.season} · ` : ""}
                      {match.episode ? `Серия ${match.episode} · ` : ""}
                      {frameTimestamp(match.timestamp)}
                    </small>
                  </span>
                  <time dateTime={new Date(entry.searchedAt).toISOString()}>
                    {new Date(entry.searchedAt).toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "short",
                    })}
                  </time>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
