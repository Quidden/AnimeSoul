import { useRef } from "react";
import type { Anime, AnimeProgress, CardMeta, Folder, Progress, Tracker } from "../lib/types";
import { isEpisodeWatched, watchTimeProgress } from "../lib/anime";
import { useModalAccessibility } from "../lib/modalAccessibility";
import { ReleaseMark } from "./ReleaseMark";

export type CollectionOverviewKind = "favorites" | "folders" | "tracking";

type Props = {
  kind: CollectionOverviewKind;
  favorites: number[];
  folders: Folder[];
  tracked: Tracker[];
  progress: Progress;
  cardMeta: Record<number, CardMeta>;
  known: (id: number) => Anime | undefined;
  onClose: () => void;
  onOpenAnime: (anime: Anime, resume?: boolean) => void;
  onOpenFolder: (folder: Folder) => void;
  onRemoveFavorite: (id: number) => void;
  onDeleteFolder: (folder: Folder) => void;
  onWatchNew: (anime: Anime) => void;
  onUntrack: (tracker: Tracker) => void;
};

function animeCompletion(value?: AnimeProgress) {
  if (!value?.totalEpisodes) return 0;
  const watched = Object.values(value.episodes).filter(isEpisodeWatched).length;
  return Math.min(100, Math.round((watched / value.totalEpisodes) * 100));
}

function folderCompletion(folder: Folder, progress: Progress) {
  const total = folder.animeIds.reduce((sum, id) => sum + (progress[id]?.totalEpisodes ?? 0), 0);
  const watched = folder.animeIds.reduce(
    (sum, id) => sum + Object.values(progress[id]?.episodes ?? {}).filter(isEpisodeWatched).length,
    0,
  );
  return { total, watched, percent: total ? Math.min(100, Math.round((watched / total) * 100)) : 0 };
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" />
    </svg>
  );
}

export function CollectionOverview({
  kind,
  favorites,
  folders,
  tracked,
  progress,
  cardMeta,
  known,
  onClose,
  onOpenAnime,
  onOpenFolder,
  onRemoveFavorite,
  onDeleteFolder,
  onWatchNew,
  onUntrack,
}: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const title =
    kind === "favorites" ? "Избранное" : kind === "folders" ? "Папки" : "Отслеживание новых серий";
  const subtitle =
    kind === "favorites"
      ? `${favorites.length} тайтлов с прогрессом просмотра`
      : kind === "folders"
        ? `${folders.length} папок с общей статистикой`
        : `${tracked.length} активных подписок`;

  useModalAccessibility(true, onClose, dialogRef);

  return (
    <div className="modal-backdrop collection-overview-backdrop" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="modal collection-overview"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={event => event.stopPropagation()}
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <header>
          <span className="eyebrow">МОЯ БИБЛИОТЕКА</span>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </header>

        <div className="collection-overview-list">
          {kind === "favorites" &&
            favorites.map(id => {
              const anime = known(id);
              const value = progress[id];
              const percent = watchTimeProgress(value);
              return (
                <article
                  className="collection-overview-anime"
                  key={id}
                  role={anime ? "button" : undefined}
                  tabIndex={anime ? 0 : undefined}
                  onClick={() => anime && onOpenAnime(anime, Boolean(value))}
                  onKeyDown={event => {
                    if (anime && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onOpenAnime(anime, Boolean(value));
                    }
                  }}
                >
                  {anime?.poster?.big ? <img src={anime.poster.big} alt="" /> : <div className="overview-poster-empty" />}
                  <div>
                    <h3>{anime?.title ?? `Аниме #${id}`}</h3>
                    <ReleaseMark anime={anime} status={cardMeta[id]?.status} />
                    <span>
                      {animeCompletion(value)}% серий · {percent}% общего времени
                    </span>
                    <div className="wide-progress"><i style={{ width: `${percent}%` }} /></div>
                  </div>
                  <div className="collection-overview-actions">
                    {anime && <button className="primary" type="button" onClick={event => { event.stopPropagation(); onOpenAnime(anime, Boolean(value)); }}>{value ? "▶ Продолжить" : "Открыть"}</button>}
                    <button className="overview-remove" type="button" onClick={event => { event.stopPropagation(); onRemoveFavorite(id); }}>
                      <TrashIcon /> Удалить
                    </button>
                  </div>
                </article>
              );
            })}

          {kind === "folders" &&
            folders.map(folder => {
              const stats = folderCompletion(folder, progress);
              return (
                <article
                  className="collection-overview-folder"
                  key={folder.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenFolder(folder)}
                  onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenFolder(folder);
                    }
                  }}
                >
                  <div>
                    <h3>{folder.name}</h3>
                    <span>{folder.animeIds.length} тайтлов · {stats.watched} из {stats.total} серий</span>
                    <div className="wide-progress"><i style={{ width: `${stats.percent}%` }} /></div>
                  </div>
                  <b>{stats.percent}%</b>
                  <button className="overview-remove" type="button" onClick={event => { event.stopPropagation(); onDeleteFolder(folder); }}>
                    <TrashIcon /> Удалить
                  </button>
                </article>
              );
            })}

          {kind === "tracking" &&
            tracked.map(item => {
              const anime = known(item.animeId);
              return (
                <article
                  className="collection-overview-tracker"
                  key={item.animeId}
                  role={anime ? "button" : undefined}
                  tabIndex={anime ? 0 : undefined}
                  onClick={() => anime && onOpenAnime(anime)}
                  onKeyDown={event => {
                    if (anime && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onOpenAnime(anime);
                    }
                  }}
                >
                  {anime?.poster?.big ? <img src={anime.poster.big} alt="" /> : <div className="overview-poster-empty" />}
                  <div>
                    <h3>{item.title}</h3>
                    <ReleaseMark anime={anime} status={cardMeta[item.animeId]?.status} />
                    <span>{item.dubs?.length ? `Озвучки: ${item.dubs.join(", ")}` : "Все озвучки"}</span>
                    <small>{item.knownEpisodes} известных серий</small>
                  </div>
                  <div className="collection-overview-actions">
                    {item.newEpisodes > 0 && <em className="release-status new"><i />Новая серия · +{item.newEpisodes}</em>}
                    {(item.otherDubEpisodes ?? 0) > 0 && <em className="release-status other-dub" title="Серия доступна в другой озвучке, но ещё не появилась в отслеживаемой"><i />Есть в другой озвучке · +{item.otherDubEpisodes}</em>}
                    {item.newEpisodes <= 0 && (item.otherDubEpisodes ?? 0) <= 0 && <em className="release-status quiet"><i />Новых серий нет</em>}
                    {anime && item.newEpisodes > 0 && <button className="watch-new-button" type="button" onClick={event => { event.stopPropagation(); onWatchNew(anime); }}>▶ Смотреть новую серию</button>}
                    <button className="untrack-button" type="button" onClick={event => { event.stopPropagation(); onUntrack(item); }}>Отписаться</button>
                  </div>
                </article>
              );
            })}

          {((kind === "favorites" && !favorites.length) ||
            (kind === "folders" && !folders.length) ||
            (kind === "tracking" && !tracked.length)) && (
            <div className="collection-overview-empty">Здесь пока ничего нет.</div>
          )}
        </div>
      </section>
    </div>
  );
}
