import type { ReactNode } from "react";

import { ReleaseMark } from "../../components/ReleaseMark";
import type { Folder, Tracker } from "../../lib/types";
import { HomeLoadMore } from "./HomeCardList";
import { CardArtwork, CardMetric } from "./LibrarySections";
import { LibraryToolbar } from "./LibraryToolbar";
import type { HomePageActions, HomePageModel, HomePageProps } from "./types";
import { useHomeCardLimit } from "./useHomeCardLimit";

/** Tabs own visibility; the selected collection is always open. */
export function HomeDashboardPanels({ model, actions, view }: HomePageProps & {
  view?: "tracking" | "folders";
}) {
  return (
    <section className="home-dashboard-panels" aria-label="Библиотека и отслеживания">
      {view !== "folders" && <TrackingPanel model={model} actions={actions} />}
      {view !== "tracking" && <LibraryPanel model={model} actions={actions} />}
    </section>
  );
}

/** Kept as an alias for extensions importing the old component name. */
export const DashboardWidgets = HomeDashboardPanels;

function TrackingPanel({ model, actions }: HomePageProps) {
  const pagination = useHomeCardLimit(model.sortedTracked.length);

  return (
    <Panel id="home-tracking-panel" className="home-tracking-panel">
      <LibraryToolbar summary={`${model.tracked.length} подписок`}>
        <button type="button" className="home-action-button" onClick={() => actions.openCollection("tracking")}>
          Открыть все <span aria-hidden="true">↗</span>
        </button>
      </LibraryToolbar>
      <div id="home-tracking-list" className="home-media-card-list home-tracking-list">
        {model.sortedTracked.slice(0, pagination.visibleCount).map(tracker => (
          <TrackingRow key={tracker.animeId} tracker={tracker} model={model} actions={actions} />
        ))}
        {!model.tracked.length && (
          <EmptyPanelText>Подписок пока нет. Включить отслеживание можно на странице аниме.</EmptyPanelText>
        )}
      </div>
      <HomeLoadMore remaining={pagination.remaining} onLoadMore={pagination.loadMore} />
    </Panel>
  );
}

function LibraryPanel({ model, actions }: HomePageProps) {
  const totalCards = model.folders.length + 1;
  const pagination = useHomeCardLimit(totalCards);
  const visibleFolders = model.folders.slice(0, Math.max(0, pagination.visibleCount - 1));

  return (
    <Panel className="home-library-panel">
      <LibraryToolbar summary={`Подборок: ${totalCards}`}>
        <button type="button" className="home-action-button" onClick={() => actions.openCollection("folders")}>
          Открыть все <span aria-hidden="true">↗</span>
        </button>
        {model.lastDeletedFolder && (
          <button
            type="button"
            className="home-action-button"
            title={`Восстановить папку «${model.lastDeletedFolder.folder.name}»`}
            onClick={actions.restoreLastFolder}
          >
            ↶ Восстановить
          </button>
        )}
        <button type="button" className="home-action-button" onClick={actions.createFolder}>
          <span aria-hidden="true">＋</span> Создать папку
        </button>
      </LibraryToolbar>

      <div id="home-library-groups" className="home-media-card-list home-library-groups">
        <FavoritesGroup model={model} actions={actions} />
        {visibleFolders.map(folder => (
          <FolderRow key={folder.id} folder={folder} actions={actions} />
        ))}
      </div>
      <HomeLoadMore remaining={pagination.remaining} onLoadMore={pagination.loadMore} />
    </Panel>
  );
}

function FavoritesGroup({ model, actions }: HomePageProps) {
  const stats = model.favoriteStats;
  const featuredAnime = model.favorites.length ? actions.resolveAnime(model.favorites[0]) : undefined;

  return (
    <article className="home-media-card home-folder-card home-favorites-folder">
      <CardArtwork anime={featuredAnime} />
      <div className="home-media-card-body">
        <div className="home-card-status home-folder-status"><i /> Избранное</div>
        <button type="button" className="home-card-title" onClick={() => actions.openCollection("favorites")}>
          ♥ Избранное
        </button>
        <p className="home-card-subtitle">Все отмеченные тайтлы в одной подборке</p>
        <div className="home-card-metrics">
          <CardMetric label="Тайтлов" value={String(model.favorites.length)} />
          <CardMetric label="Просмотрено серий" value={`${stats.watched} из ${stats.total}`} />
        </div>
        <ProgressBar percent={stats.percent} />
        <div className="home-card-footer">
          <small>{stats.percent}% просмотрено</small>
          <div className="home-card-actions">
            <button type="button" className="home-action-button home-play-button" onClick={() => actions.openCollection("favorites")}>
              Открыть подборку
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function FolderRow({ folder, actions }: {
  folder: Folder;
  actions: HomePageActions;
}) {
  const stats = actions.folderStats(folder);
  const featuredAnime = folder.animeIds.length ? actions.resolveAnime(folder.animeIds[0]) : undefined;

  return (
    <article className="home-media-card home-folder-card">
      <CardArtwork anime={featuredAnime} />
      <div className="home-media-card-body">
        <div className="home-card-status home-folder-status"><i /> Папка</div>
        <button type="button" className="home-card-title" onClick={() => actions.openFolder(folder)}>{folder.name}</button>
        <p className="home-card-subtitle">Личная подборка</p>
        <div className="home-card-metrics">
          <CardMetric label="Тайтлов" value={String(folder.animeIds.length)} />
          <CardMetric label="Просмотрено серий" value={`${stats.watched} из ${stats.total}`} />
        </div>
        <ProgressBar percent={stats.percent} />
        <div className="home-card-footer">
          <small>{stats.percent}% просмотрено</small>
          <div className="home-card-actions">
            <button
              type="button"
              className="home-action-button home-action-danger"
              aria-label={`Удалить папку «${folder.name}»`}
              onClick={() => actions.deleteFolder(folder)}
            >
              Удалить
            </button>
            <button type="button" className="home-action-button home-play-button" onClick={() => actions.openFolder(folder)}>
              Открыть папку
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function TrackingRow({ tracker, model, actions }: {
  tracker: Tracker;
  model: HomePageModel;
  actions: HomePageActions;
}) {
  const anime = actions.resolveAnime(tracker.animeId);
  const otherDubEpisodes = tracker.otherDubEpisodes ?? 0;

  return (
    <article className="home-media-card home-tracking-card">
      <CardArtwork anime={anime} />
      <div className="home-media-card-body">
        <div className="home-card-status">
          <ReleaseMark anime={anime} status={model.cardMeta[tracker.animeId]?.status} />
          <TrackingStatus tracker={tracker} />
        </div>
        <button type="button" className="home-card-title" onClick={() => actions.openKnownAnime(tracker.animeId)}>
          {tracker.title}
        </button>
        <p className="home-card-subtitle">{tracker.dubs?.length ? tracker.dubs.join(", ") : "Все озвучки"}</p>
        <div className="home-card-metrics">
          <CardMetric label="Доступно серий" value={String(tracker.knownEpisodes)} />
          <CardMetric label="Новые серии" value={tracker.newEpisodes > 0 ? `+${tracker.newEpisodes}` : "Нет новых"} />
        </div>
        {otherDubEpisodes > 0 && tracker.newEpisodes === 0 && (
          <p className="home-other-dub-note">В другой озвучке доступно ещё {otherDubEpisodes}</p>
        )}
        <div className="home-card-footer">
          <small>{tracker.lastCheckedAt ? `Проверено ${formatCheckedAt(tracker.lastCheckedAt)}` : "Автоматическая проверка обновлений"}</small>
          <div className="home-card-actions">
            <button type="button" className="home-action-button home-action-danger" onClick={() => actions.untrack(tracker.animeId)}>
              Отписаться
            </button>
            {tracker.newEpisodes > 0 && (
              <button type="button" className="home-action-button home-play-button" onClick={() => actions.watchNewEpisode(tracker.animeId)}>
                <span aria-hidden="true">▶</span> Смотреть новую
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function TrackingStatus({ tracker }: { tracker: Tracker }) {
  if (tracker.newEpisodes > 0) return <em className="release-status new"><i />+{tracker.newEpisodes} новых</em>;
  if ((tracker.otherDubEpisodes ?? 0) > 0) return <em className="release-status other-dub"><i />Другая озвучка</em>;
  return <em className="release-status quiet">Нет новых</em>;
}

function Panel({ id, className, children }: { id?: string; className: string; children: ReactNode }) {
  return <section id={id} className={`home-dashboard-panel ${className}`}>{children}</section>;
}

function ProgressBar({ percent }: { percent: number }) {
  return <div className="home-card-progress" aria-label={`Просмотрено ${percent}%`}><i style={{ width: `${percent}%` }} /></div>;
}

function EmptyPanelText({ children }: { children: ReactNode }) {
  return <p className="home-panel-empty">{children}</p>;
}

function formatCheckedAt(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}
