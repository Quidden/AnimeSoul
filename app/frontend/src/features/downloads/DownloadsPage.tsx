import { useEffect, useState } from "react";
import type { Anime } from "../../lib/types";
import { readLocal, writeLocal } from "../../lib/storage";
import {
  cancelDownload,
  deleteOfflineAnime,
  deleteOfflineEpisode,
  fetchOfflineLibrary,
  type OfflineLibrary,
} from "../../lib/downloads";

type DownloadsPageProps = {
  onHome: () => void;
  onOpen: (anime: Anime) => void;
};

type PendingDeletion = {
  kind: "anime" | "episode";
  id: number | string;
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

function episodeLabel(season: number, episode: string) {
  return `Сезон ${season} · серия ${episode}`;
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

  const removeEpisode = async (episodeId: string) => {
    try {
      await deleteOfflineEpisode(episodeId);
      setLibrary(await fetchOfflineLibrary());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить серию.");
    }
  };

  const requestDeletion = (deletion: PendingDeletion) => {
    if (skipDeletionConfirmation) {
      if (deletion.kind === "anime") void removeAnime(Number(deletion.id));
      else void removeEpisode(String(deletion.id));
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
    if (deletion.kind === "anime") await removeAnime(Number(deletion.id));
    else await removeEpisode(String(deletion.id));
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
          const anime: Anime = {
            anime_id: item.animeId,
            title: item.title,
            year: item.year,
            poster: item.posterUrl ? { big: item.posterUrl, fullsize: item.posterUrl } : undefined,
          };
          return (
            <article className="downloaded-anime-card" key={item.animeId}>
              <button className="downloaded-anime-cover" type="button" onClick={() => onOpen(anime)} aria-label={`Открыть ${item.title}`}>
                {item.posterUrl ? <img src={item.posterUrl} alt="" /> : <span>{item.title.slice(0, 1)}</span>}
              </button>
              <div className="downloaded-anime-body">
                <div className="downloaded-anime-title-row">
                  <button className="downloaded-anime-title" type="button" onClick={() => onOpen(anime)}>{item.title}</button>
                  <button
                    className="icon-delete-button"
                    type="button"
                    title="Удалить скачанные серии"
                    aria-label={`Удалить ${item.title}`}
                    onClick={() => requestDeletion({
                      kind: "anime",
                      id: item.animeId,
                      title: item.title,
                      detail: `Будут удалены все ${item.episodes.length} скачанные серии.`,
                    })}
                  ><TrashIcon /></button>
                </div>
                <p>{item.episodes.length} {item.episodes.length === 1 ? "серия" : "серий"} скачано</p>
                <div className="downloaded-episodes">
                  {item.episodes.map((episode) => (
                    <div className="downloaded-episode" key={episode.id}>
                      {episode.previewUrl && <img src={episode.previewUrl} alt="" />}
                      <div>
                        <strong>{episodeLabel(episode.season, episode.episode)}</strong>
                        <span>{episode.dubbing} · {episode.quality}p</span>
                      </div>
                      <button
                        className="episode-delete-button"
                        type="button"
                        title="Удалить серию"
                        aria-label={`Удалить ${episodeLabel(episode.season, episode.episode)}`}
                        onClick={() => requestDeletion({
                          kind: "episode",
                          id: episode.id,
                          title: episodeLabel(episode.season, episode.episode),
                          detail: `${episode.dubbing} · ${episode.quality}p будет удалена с устройства.`,
                        })}
                      ><TrashIcon /></button>
                    </div>
                  ))}
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
