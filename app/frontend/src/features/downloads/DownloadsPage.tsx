import { useEffect, useState } from "react";
import type { Anime } from "../../lib/types";
import { readLocal, writeLocal } from "../../lib/storage";
import {
  cancelDownload,
  deleteOfflineAnime,
  fetchOfflineLibrary,
  type OfflineLibrary,
} from "../../lib/downloads";

type DownloadsPageProps = {
  onHome: () => void;
  onOpen: (anime: Anime) => void;
};

type PendingDeletion = {
  id: number;
  title: string;
  detail: string;
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

function downloadedSeasonsLabel(episodes: { season: number; episode: string }[]) {
  const grouped = new Map<number, number>();
  for (const episode of episodes) {
    grouped.set(episode.season, (grouped.get(episode.season) ?? 0) + 1);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([season, count]) => `Сезон ${season} · ${episodeCountLabel(count)}`)
    .join(" · ");
}

function progressLabel(progress: number) {
  return `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
}

function jobStateLabel(status: string) {
  return status === "queued" ? "В очереди" : "Скачивается";
}

export function DownloadsPage({ onHome, onOpen }: DownloadsPageProps) {
  const [library, setLibrary] = useState<OfflineLibrary | null>(null);
  const [error, setError] = useState("");
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const [skipDeletionConfirmation, setSkipDeletionConfirmation] = useState(() => readLocal(DELETE_CONFIRMATION_KEY, false));

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

  const removeAnime = async (animeId: number) => {
    try {
      await deleteOfflineAnime(animeId);
      setLibrary(await fetchOfflineLibrary());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить аниме.");
    }
  };

  const requestDeletion = (deletion: PendingDeletion) => {
    if (skipDeletionConfirmation) {
      void removeAnime(deletion.id);
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
    await removeAnime(deletion.id);
  };

  const cancel = async (jobId: string) => {
    try {
      await cancelDownload(jobId);
      setLibrary(await fetchOfflineLibrary());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось отменить загрузку.");
    }
  };

  const activeJobs = library?.jobs.filter((job) => job.status === "queued" || job.status === "downloading") ?? [];
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
          </div>
          <button className="downloads-back-button" type="button" onClick={onHome}>← В каталог</button>
        </div>
      </section>

      {error && <p className="downloads-error" role="alert">{error}</p>}

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
              <p>{job.status === "queued" ? `Ожидает начала · качество ${job.quality}p` : job.current || `Качество ${job.quality}p`}</p>
              <div className="download-progress" aria-label={progressLabel(job.progress)}>
                <span style={{ width: `${Math.round(job.progress * 100)}%` }} />
              </div>
              <button className="text-button" type="button" onClick={() => cancel(job.id)}>Отменить</button>
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
            <button className="downloads-primary-action" type="button" onClick={onHome}>
              Открыть каталог <span aria-hidden="true">→</span>
            </button>
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
          const seasonsLabel = downloadedSeasonsLabel(item.episodes);
          const artwork = item.posterUrl ?? item.episodes.find(episode => episode.previewUrl)?.previewUrl;
          const anime: Anime = {
            anime_id: item.animeId,
            title: item.title,
            year: item.year,
            poster: artwork ? { big: artwork, fullsize: artwork } : undefined,
          };
          return (
            <article className="downloaded-anime-card" key={item.animeId}>
              <button className="downloaded-anime-open" type="button" onClick={() => onOpen(anime)} aria-label={`Открыть ${item.title}`}>
                <span className="downloaded-anime-cover">
                  {artwork ? <img src={artwork} alt="" /> : <span className="downloaded-anime-placeholder">{item.title.slice(0, 1)}</span>}
                  <span className="downloaded-anime-count">{episodeCountLabel(episodeCount)}</span>
                  <span className="downloaded-anime-play" aria-hidden="true">▶</span>
                </span>
                <span className="downloaded-anime-body">
                  <strong className="downloaded-anime-title">{item.title}</strong>
                  <span className="downloaded-anime-meta">
                    {item.year ? `${item.year} · ` : ""}На устройстве
                  </span>
                  <span className="downloaded-anime-summary" title={seasonsLabel}>{seasonsLabel}</span>
                </span>
              </button>
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
              ><TrashIcon /></button>
            </article>
          );
        })}
          </div>
        </section>
      )}

      {pendingDeletion && (
        <div className="offline-delete-dialog-backdrop" role="presentation" onMouseDown={() => setPendingDeletion(null)}>
          <section
            className="offline-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="offline-delete-dialog-title"
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
