import { useEffect, useRef, useState } from "react";
import type { Anime, AnimeProgress } from "../../lib/types";
import { isEpisodeWatched } from "../../lib/anime";
import { fetchAnimeDetails } from "../catalog/api";
import { readLocal, writeLocal } from "../../lib/storage";
import {
  cancelDownload,
  deleteOfflineAnime,
  deleteOfflineEpisodes,
  fetchOfflineLibrary,
  scanOfflineLibrary,
  type OfflineLibrary,
} from "../../lib/downloads";
import { useModalAccessibility } from "../../lib/modalAccessibility";
import { IS_ANDROID_APP } from "../../lib/platform";

type DownloadsPageProps = {
  onCatalog: () => void;
  onOpen: (anime: Anime) => void;
  progress: Record<number, AnimeProgress>;
};

type PendingDeletion = {
  id: number;
  title: string;
  detail: string;
  episodeIds?: string[];
};

const DELETE_CONFIRMATION_KEY = "animesoul:offline-delete-without-confirmation";

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13m-7 4v5m4-5v5" />
    </svg>
  );
}

function episodeCountLabel(count: number) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} серий`;
  if (mod10 === 1) return `${count} серия`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} серии`;
  return `${count} серий`;
}

function compactEpisodeNumbers(values: string[]) {
  const unique = [...new Set(values.map(value => value.trim()).filter(Boolean))];
  const integerValues = unique.filter(value => /^\d+$/.test(value)).map(Number).sort((left, right) => left - right);
  const customValues = unique.filter(value => !/^\d+$/.test(value)).sort((left, right) =>
    left.localeCompare(right, "ru", { numeric: true }),
  );
  const ranges: string[] = [];

  for (let index = 0; index < integerValues.length;) {
    const start = integerValues[index];
    let end = start;
    while (index + 1 < integerValues.length && integerValues[index + 1] === end + 1) {
      index += 1;
      end = integerValues[index];
    }
    ranges.push(start === end ? `${start}` : `${start}–${end}`);
    index += 1;
  }

  return [...ranges, ...customValues].join(", ");
}

function downloadedSeasonDetails(
  episodes: { id: string; season: number; seasonLabel?: string; episode: string; originAnimeId?: number; sizeBytes: number; dubbing: string; quality: number }[],
  saved?: AnimeProgress,
  originTitles: Record<number, string> = {},
) {
  const grouped = new Map<number, typeof episodes>();
  for (const episode of episodes) {
    grouped.set(episode.season, [...(grouped.get(episode.season) ?? []), episode]);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([season, seasonEpisodes]) => {
      const persistedLabel = seasonEpisodes.find(item => item.seasonLabel?.trim())?.seasonLabel?.trim();
      const progressLabel = saved?.season === season ? saved.seasonLabel?.trim() : "";
      const recoveredTitles = [...new Set(
        seasonEpisodes
          .map(item => originTitles[item.originAnimeId ?? 0]?.trim())
          .filter((value): value is string => Boolean(value)),
      )];
      return {
        season,
        label: persistedLabel || progressLabel || recoveredTitles.join(" / ") || `Сезон ${season}`,
        count: new Set(seasonEpisodes.map(item => item.episode)).size,
        watchedCount: new Set(
          seasonEpisodes
            .filter(item => isEpisodeWatched(saved?.episodes[`${season}:${item.episode}`]))
            .map(item => item.episode),
        ).size,
        episodes: compactEpisodeNumbers(seasonEpisodes.map(item => item.episode)),
        sizeBytes: seasonEpisodes.reduce((total, item) => total + (item.sizeBytes || 0), 0),
        items: [...seasonEpisodes].sort((left, right) => left.episode.localeCompare(right.episode, "ru", { numeric: true })),
      };
    });
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / 1024 ** exponent;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: exponent < 2 ? 0 : 1 }).format(amount)} ${units[exponent]}`;
}

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${minutes} мин`;
  return remainingMinutes ? `${hours} ч ${remainingMinutes} мин` : `${hours} ч`;
}

function formatDownloadedAt(timestamp: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(timestamp);
}

function progressPercent(progress: number) {
  return Math.round(Math.max(0, Math.min(1, progress)) * 100);
}

function progressLabel(progress: number) {
  return `${progressPercent(progress)}%`;
}

function jobStateLabel(status: string) {
  if (status === "queued") return "В очереди";
  if (status === "paused") return "Пауза";
  return "Скачивается";
}

function jobSelectionLabel(items: { season: number; seasonLabel?: string; episode: string }[] | undefined) {
  if (!items?.length) return "";
  const grouped = new Map<number, { label: string; episodes: string[] }>();
  for (const item of items) {
    const current = grouped.get(item.season) ?? {
      label: item.seasonLabel || `Сезон ${item.season}`,
      episodes: [],
    };
    current.episodes.push(item.episode);
    grouped.set(item.season, current);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, group]) => `${group.label}: ${compactEpisodeNumbers(group.episodes)}`)
    .join(" · ");
}

export function DownloadsPage({ onCatalog, onOpen, progress }: DownloadsPageProps) {
  const [library, setLibrary] = useState<OfflineLibrary | null>(null);
  const [error, setError] = useState("");
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const [skipDeletionConfirmation, setSkipDeletionConfirmation] = useState(() => readLocal(DELETE_CONFIRMATION_KEY, false));
  const [selectingAnimeId, setSelectingAnimeId] = useState<number | null>(null);
  const [selectedEpisodeIds, setSelectedEpisodeIds] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState("");
  const [legacyOriginTitles, setLegacyOriginTitles] = useState<Record<number, string>>({});
  const deletionDialogRef = useRef<HTMLElement>(null);

  useModalAccessibility(
    Boolean(pendingDeletion),
    () => setPendingDeletion(null),
    deletionDialogRef,
  );

  useEffect(() => {
    let stopped = false;
    const refresh = () => {
      fetchOfflineLibrary()
        .then((result) => {
          if (!stopped) {
            setLibrary(result);
            setError("");
          }
        })
        .catch((reason: unknown) => {
          if (!stopped) setError(reason instanceof Error ? reason.message : "Не удалось открыть библиотеку.");
        });
    };

    refresh();
    const interval = window.setInterval(refresh, 1200);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, []);

  const legacyOriginIds = [...new Set(
    (library?.anime ?? []).flatMap(item => item.episodes
      .filter(episode => !episode.seasonLabel?.trim() && episode.originAnimeId)
      .map(episode => Number(episode.originAnimeId))),
  )].sort((left, right) => left - right);
  const legacyOriginKey = legacyOriginIds.join(",");

  useEffect(() => {
    if (!legacyOriginKey) return;
    let stopped = false;
    void fetchAnimeDetails(legacyOriginIds)
      .then(items => {
        if (!stopped) {
          setLegacyOriginTitles(Object.fromEntries(items.map(item => [
            item.anime_id,
            item.title_ru || item.title,
          ])));
        }
      })
      .catch(() => undefined);
    return () => { stopped = true; };
  }, [legacyOriginKey]);

  const removeDownload = async (deletion: PendingDeletion) => {
    try {
      if (deletion.episodeIds?.length) await deleteOfflineEpisodes(deletion.episodeIds);
      else await deleteOfflineAnime(deletion.id);
      setSelectingAnimeId(null);
      setSelectedEpisodeIds(new Set());
      setLibrary(await fetchOfflineLibrary());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить аниме.");
    }
  };

  const requestDeletion = (deletion: PendingDeletion) => {
    if (skipDeletionConfirmation) {
      void removeDownload(deletion);
      return;
    }
    setPendingDeletion(deletion);
  };

  const confirmDeletion = async (skipFuture: boolean) => {
    const deletion = pendingDeletion;
    if (!deletion) return;
    if (skipFuture) {
      writeLocal(DELETE_CONFIRMATION_KEY, true);
      setSkipDeletionConfirmation(true);
    }
    setPendingDeletion(null);
    await removeDownload(deletion);
  };

  const scan = async () => {
    if (isScanning) return;
    try {
      setIsScanning(true);
      setScanNotice("Проверяем Movies/AnimeSoul…");
      const result = await scanOfflineLibrary();
      setLibrary(await fetchOfflineLibrary());
      setScanNotice(result.imported
        ? `Восстановлено: ${episodeCountLabel(result.imported)}.`
        : result.scanned
          ? "Все найденные серии уже есть в библиотеке."
          : "В папке Movies/AnimeSoul подходящих видео не найдено.");
    } catch (reason) {
      setScanNotice(reason instanceof Error ? reason.message : "Не удалось просканировать скачанные видео.");
    } finally {
      setIsScanning(false);
    }
  };

  const toggleEpisodeSelection = (episodeId: string) => setSelectedEpisodeIds(current => {
    const next = new Set(current);
    if (next.has(episodeId)) next.delete(episodeId);
    else next.add(episodeId);
    return next;
  });

  const setEpisodeSelection = (episodeIds: string[], enabled: boolean) => setSelectedEpisodeIds(current => {
    const next = new Set(current);
    for (const episodeId of episodeIds) {
      if (enabled) next.add(episodeId);
      else next.delete(episodeId);
    }
    return next;
  });

  const cancel = async (jobId: string) => {
    try {
      await cancelDownload(jobId);
      setLibrary(await fetchOfflineLibrary());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось отменить загрузку.");
    }
  };

  const activeJobs = (library?.jobs.filter((job) => ["queued", "downloading", "paused"].includes(job.status)) ?? [])
    .sort((left, right) => {
      const leftRank = left.status === "downloading" || left.status === "paused" ? 0 : 1;
      const rightRank = right.status === "downloading" || right.status === "paused" ? 0 : 1;
      return leftRank - rightRank || (left.queuePosition ?? 999) - (right.queuePosition ?? 999);
    });
  const failedJobs = library?.jobs.filter((job) => job.status === "error") ?? [];
  const downloadedAnime = library?.anime ?? [];
  const downloadedEpisodes = downloadedAnime.reduce((total, item) => total + item.episodes.length, 0);
  const isLibraryEmpty = Boolean(library && downloadedAnime.length === 0 && activeJobs.length === 0);

  return (
    <main className="downloads-page shell" aria-label="Скачанные аниме">
      <section className="downloads-hero">
        <div className="downloads-hero-copy">
          <p className="downloads-eyebrow">Офлайн-библиотека</p>
          <h1>Скачанные</h1>
          <p>Серии хранятся на вашем устройстве и доступны без интернета.</p>
        </div>
        <div className="downloads-hero-side">
          <div className="downloads-stats" aria-label="Статистика библиотеки">
            <div>
              <span>Тайтлов</span>
              <strong>{downloadedAnime.length}</strong>
            </div>
            <div>
              <span>Серий</span>
              <strong>{downloadedEpisodes}</strong>
            </div>
            <div>
              <span>Свободно</span>
              <strong>{library ? formatBytes(library.storage.freeBytes) : "—"}</strong>
            </div>
          </div>
          {IS_ANDROID_APP && (
            <button className="downloads-scan-button" type="button" disabled={isScanning} onClick={() => void scan()}>
              {isScanning ? "Сканируем…" : "Найти на устройстве"}
            </button>
          )}
          <button className="downloads-back-button" type="button" onClick={onCatalog}>← В каталог</button>
        </div>
      </section>

      {error && <p className="downloads-error" role="alert">{error}</p>}
      {scanNotice && <p className="downloads-scan-notice" role="status">{scanNotice}</p>}

      {activeJobs.length > 0 && (
        <section className="download-jobs" aria-label="Текущие загрузки">
          <div className="download-jobs-heading">
            <div>
              <p>Сейчас загружается</p>
              <h2>Очередь загрузок <span>{activeJobs.length}</span></h2>
            </div>
            <span className="download-jobs-refresh">Обновляется автоматически</span>
          </div>
          {activeJobs.map((job) => (
            <article className="download-job" key={job.id}>
              <div className="download-job-topline">
                <span>{job.title}</span>
                <div>
                  <em className={`download-job-state is-${job.status}`}>{jobStateLabel(job.status)}</em>
                  <strong>{progressLabel(job.progress)}</strong>
                </div>
              </div>
              <p>{job.status === "queued"
                ? `Ожидает начала${job.queuePosition ? ` · №${job.queuePosition} в очереди` : ""} · ${job.quality}p · ${episodeCountLabel(job.total)}`
                : job.status === "paused"
                  ? "Приостановлено: мобильная сеть запрещена. Подключите Wi‑Fi или измените настройку."
                  : job.current || `Качество ${job.quality}p`}</p>
              {job.items?.length ? <p className="download-job-selection">{jobSelectionLabel(job.items)}</p> : null}
              <div
                className="download-progress"
                role="progressbar"
                aria-label={`Загрузка «${job.title}»`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent(job.progress)}
              >
                <span style={{ width: `${progressPercent(job.progress)}%` }} />
              </div>
              <div className="download-job-footer">
                <span>{job.completed} из {job.total} готово · {job.quality}p</span>
                <button className="text-button" type="button" onClick={() => cancel(job.id)}>Отменить</button>
              </div>
            </article>
          ))}
        </section>
      )}

      {failedJobs.length > 0 && (
        <section className="download-jobs is-error" aria-label="Ошибки загрузок">
          <div className="download-jobs-heading">
            <div>
              <p>Нужна проверка</p>
              <h2>Не удалось скачать <span>{failedJobs.length}</span></h2>
            </div>
            <span className="download-jobs-refresh">Повторите загрузку из карточки аниме</span>
          </div>
          {failedJobs.map((job) => (
            <article className="download-job is-error" key={job.id} role="alert">
              <div className="download-job-topline">
                <span>{job.title}</span>
                <div>
                  <em className="download-job-state is-error">Ошибка</em>
                  <strong>{job.completed}/{job.total}</strong>
                </div>
              </div>
              <p>{job.error || "Загрузка прервалась. Проверьте подключение и повторите попытку."}</p>
              <div className="download-job-footer">
                <span>{job.completed} из {job.total} сохранено · {job.quality}p</span>
                <button className="text-button" type="button" onClick={onCatalog}>Открыть в каталоге</button>
              </div>
            </article>
          ))}
        </section>
      )}

      {!library && !error && <p className="downloads-empty">Загружаем библиотеку…</p>}

      {isLibraryEmpty && (
        <section className="downloads-empty-card">
          <div className="downloads-empty-icon" aria-hidden="true" />
          <div className="downloads-empty-copy">
            <p className="downloads-empty-kicker">Библиотека пуста</p>
            <h2>Скачайте серии для офлайн-просмотра</h2>
            <p>Откройте аниме в каталоге, выберите озвучку и качество — серии будут доступны даже без интернета.</p>
            <button className="downloads-primary-action" type="button" onClick={onCatalog}>
              Открыть каталог <span aria-hidden="true">→</span>
            </button>
            {IS_ANDROID_APP && (
              <button className="downloads-secondary-action" type="button" disabled={isScanning} onClick={() => void scan()}>
                {isScanning ? "Проверяем папку…" : "Восстановить скачанные файлы"}
              </button>
            )}
          </div>
          <ol className="downloads-empty-steps">
            <li><b>1</b><span>Выберите аниме</span></li>
            <li><b>2</b><span>Укажите серии и качество</span></li>
            <li><b>3</b><span>Смотрите без интернета</span></li>
          </ol>
        </section>
      )}

      {downloadedAnime.length > 0 && (
        <section className="downloads-library" aria-label="Скачанные тайтлы">
          <div className="downloads-library-heading">
            <div>
              <p>На устройстве</p>
              <h2>Моя библиотека</h2>
            </div>
            <span>{downloadedEpisodes} сер.</span>
          </div>
          <div className="downloaded-anime-list">
        {downloadedAnime.map((item) => {
          const episodeCount = item.episodes.length;
          const saved = progress[item.animeId];
          const seasonDetails = downloadedSeasonDetails(item.episodes, saved, legacyOriginTitles);
          const dubbings = [...new Set(item.episodes.map(episode => episode.dubbing).filter(Boolean))]
            .sort((left, right) => left.localeCompare(right, "ru"));
          const qualities = [...new Set(item.episodes.map(episode => episode.quality).filter(Boolean))]
            .sort((left, right) => right - left);
          const totalDuration = item.episodes.reduce((total, episode) => total + (episode.duration ?? 0), 0);
          const latestDownload = Math.max(...item.episodes.map(episode => episode.downloadedAt || 0));
          // A preview URL may be present even when the individual frame was
          // not persisted.  The downloaded poster is guaranteed by the
          // library entry and makes the left-hand artwork reliably visible.
          const artwork = item.posterUrl ?? item.episodes.find(episode => episode.previewUrl)?.previewUrl;
          const posterArtwork = item.posterUrl ?? artwork;
          const anime: Anime = {
            anime_id: item.animeId,
            title: item.title,
            year: item.year,
            poster: posterArtwork ? { big: posterArtwork, fullsize: posterArtwork } : undefined,
          };
          const selectionActive = selectingAnimeId === item.animeId;
          const selectedInAnime = item.episodes.filter(episode => selectedEpisodeIds.has(episode.id));
          return (
            <article className="downloaded-anime-card" key={item.animeId}>
              <div className="downloaded-anime-cover" aria-hidden="true">
                {artwork ? <img src={artwork} alt="" /> : <span className="downloaded-anime-placeholder">{item.title.slice(0, 1)}</span>}
              </div>
              <div className="downloaded-anime-body">
                <div className="downloaded-anime-heading">
                  <div>
                    <span className="downloaded-anime-state"><i aria-hidden="true" /> Скачано на устройство</span>
                    <h3 className="downloaded-anime-title">{item.title}</h3>
                    <p className="downloaded-anime-meta">
                      {item.year ? `${item.year} · ` : ""}{episodeCountLabel(episodeCount)} · {formatBytes(item.sizeBytes)}
                    </p>
                  </div>
                  <span className="downloaded-anime-count">{episodeCountLabel(episodeCount)}</span>
                </div>

                <dl className="downloaded-anime-details">
                  <div className="is-wide">
                    <dt>Серии</dt>
                    <dd>
                      {seasonDetails.map(season => (
                        <span key={season.season}>
                          {season.label}: {season.episodes}{" "}
                          <small>
                            ({episodeCountLabel(season.count)} · {formatBytes(season.sizeBytes)}
                            {season.watchedCount ? ` · ✓ просмотрено ${season.watchedCount}` : ""})
                          </small>
                        </span>
                      ))}
                    </dd>
                  </div>
                  <div className="is-wide downloaded-episode-sizes">
                    <dt>Место по сериям</dt>
                    <dd>
                      {seasonDetails.map(season => (
                        <details key={season.season}>
                          <summary>{season.label}<span>{formatBytes(season.sizeBytes)}</span></summary>
                          <div>
                            {selectionActive && (
                              <label className="downloaded-season-select-all">
                                <input
                                  type="checkbox"
                                  checked={season.items.every(episode => selectedEpisodeIds.has(episode.id))}
                                  ref={input => {
                                    if (input) {
                                      const count = season.items.filter(episode => selectedEpisodeIds.has(episode.id)).length;
                                      input.indeterminate = count > 0 && count < season.items.length;
                                    }
                                  }}
                                  onChange={event => setEpisodeSelection(season.items.map(episode => episode.id), event.target.checked)}
                                />
                                Выбрать весь сезон
                              </label>
                            )}
                            {season.items.map(episode => {
                              const watched = isEpisodeWatched(saved?.episodes[`${season.season}:${episode.episode}`]);
                              return (
                              <p className={`${selectionActive ? "is-selecting " : ""}${watched ? "is-watched" : ""}`.trim() || undefined} key={episode.id}>
                                {selectionActive && (
                                  <input
                                    type="checkbox"
                                    checked={selectedEpisodeIds.has(episode.id)}
                                    aria-label={`Выбрать серию ${episode.episode}, ${season.label}`}
                                    onChange={() => toggleEpisodeSelection(episode.id)}
                                  />
                                )}
                                <span>{watched && <i aria-hidden="true">✓</i>} Серия {episode.episode} · {episode.dubbing} · {episode.quality}p</span>
                                <b>{formatBytes(episode.sizeBytes)}</b>
                              </p>
                              );
                            })}
                          </div>
                        </details>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt>Озвучка</dt>
                    <dd>{dubbings.join(", ") || "Не указана"}</dd>
                  </div>
                  <div>
                    <dt>Качество</dt>
                    <dd>{qualities.length ? qualities.map(quality => `${quality}p`).join(", ") : "Не указано"}</dd>
                  </div>
                  {totalDuration > 0 && (
                    <div>
                      <dt>Хронометраж</dt>
                      <dd>{formatDuration(totalDuration)}</dd>
                    </div>
                  )}
                </dl>

                <div className="downloaded-anime-footer">
                  <span>{latestDownload > 0 ? `Обновлено ${formatDownloadedAt(latestDownload)}` : "Доступно без интернета"}</span>
                  <div className="downloaded-anime-actions">
                    <button
                      className="downloaded-anime-select"
                      type="button"
                      onClick={() => {
                        setSelectingAnimeId(selectionActive ? null : item.animeId);
                        setSelectedEpisodeIds(new Set());
                      }}
                    >
                      {selectionActive ? "Готово" : "Выбрать серии"}
                    </button>
                    {selectionActive && selectedInAnime.length > 0 && (
                      <button
                        className="downloaded-anime-delete-selected"
                        type="button"
                        onClick={() => requestDeletion({
                          id: item.animeId,
                          title: item.title,
                          detail: `Будут удалены выбранные серии (${episodeCountLabel(selectedInAnime.length)}).`,
                          episodeIds: selectedInAnime.map(episode => episode.id),
                        })}
                      >
                        <TrashIcon /> Удалить выбранные ({selectedInAnime.length})
                      </button>
                    )}
                    <button
                      className="downloaded-anime-delete"
                      type="button"
                      title="Удалить скачанные серии"
                      aria-label={`Удалить ${item.title}`}
                      onClick={() => requestDeletion({
                        id: item.animeId,
                        title: item.title,
                        detail: `Будут удалены все скачанные серии (${episodeCountLabel(episodeCount)}).`,
                      })}
                    >
                      <TrashIcon /> <span>Удалить всё</span>
                    </button>
                    <button className="downloaded-anime-open" type="button" onClick={() => onOpen(anime)} aria-label={`Смотреть ${item.title}`}>
                      <span aria-hidden="true">▶</span> Смотреть
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
          </div>
        </section>
      )}

      {pendingDeletion && (
        <div className="offline-delete-dialog-backdrop" role="presentation" onMouseDown={() => setPendingDeletion(null)}>
          <section
            ref={deletionDialogRef}
            className="offline-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="offline-delete-dialog-title"
            tabIndex={-1}
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="offline-delete-dialog-icon"><TrashIcon /></div>
            <p className="downloads-eyebrow">Удаление из устройства</p>
            <h2 id="offline-delete-dialog-title">Удалить «{pendingDeletion.title}»?</h2>
            <p>{pendingDeletion.detail}</p>
            <div className="offline-delete-dialog-actions">
              <button className="downloads-back-button" type="button" onClick={() => setPendingDeletion(null)}>Отмена</button>
              <button className="offline-delete-never-button" type="button" onClick={() => void confirmDeletion(true)}>Удалить и больше не спрашивать</button>
              <button className="offline-delete-confirm-button" type="button" onClick={() => void confirmDeletion(false)}>Удалить</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
