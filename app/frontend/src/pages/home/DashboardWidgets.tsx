import { useState, type MouseEvent, type ReactNode } from "react";

import type { CollectionOverviewKind } from "../../components/CollectionOverview";
import { ReleaseMark } from "../../components/ReleaseMark";
import type { Folder, Tracker } from "../../lib/types";
import { readLocal, writeLocal } from "../../lib/storage";
import type { HomePageActions, HomePageModel, HomePageProps } from "./types";

const TRACKING_PANEL_EXPANDED_KEY = "animesoul:home-tracking-expanded";
const FOLDERS_PANEL_EXPANDED_KEY = "animesoul:home-folders-expanded";

/** Two equal panels directly below the cinematic hero. */
export function HomeDashboardPanels({ model, actions }: HomePageProps) {
  const [trackingExpanded, setTrackingExpanded] = useState(() =>
    readLocal(TRACKING_PANEL_EXPANDED_KEY, true),
  );
  const [foldersExpanded, setFoldersExpanded] = useState(() =>
    readLocal(FOLDERS_PANEL_EXPANDED_KEY, true),
  );

  const changeTrackingExpanded = (expanded: boolean) => {
    setTrackingExpanded(expanded);
    writeLocal(TRACKING_PANEL_EXPANDED_KEY, expanded);
  };
  const changeFoldersExpanded = (expanded: boolean) => {
    setFoldersExpanded(expanded);
    writeLocal(FOLDERS_PANEL_EXPANDED_KEY, expanded);
  };

  return (
    <section className="home-dashboard-panels" aria-label="Библиотека и отслеживания">
      <TrackingPanel
        model={model}
        actions={actions}
        expanded={trackingExpanded}
        onExpandedChange={changeTrackingExpanded}
      />
      <LibraryPanel
        model={model}
        actions={actions}
        expanded={foldersExpanded}
        onExpandedChange={changeFoldersExpanded}
      />
    </section>
  );
}

/** Kept as an alias for extensions importing the old component name. */
export const DashboardWidgets = HomeDashboardPanels;

function TrackingPanel({
  model,
  actions,
  expanded,
  onExpandedChange,
}: HomePageProps & { expanded: boolean; onExpandedChange: (expanded: boolean) => void }) {
  return (
    <Panel id="home-tracking-panel" kind="tracking" actions={actions} className="home-tracking-panel" expanded={expanded}>
      <PanelHeader
        title="Отслеживаю"
        count={model.tracked.length}
        badge={model.totalNewEpisodes > 0 ? `+${model.totalNewEpisodes}` : undefined}
        expanded={expanded}
        controls="home-tracking-list"
        onExpandedChange={onExpandedChange}
      />
      <div
        id="home-tracking-list"
        className="home-panel-scroll home-tracking-list"
        hidden={!expanded}
        inert={!expanded}
      >
        {model.sortedTracked.map(tracker => (
          <TrackingRow
            key={tracker.animeId}
            tracker={tracker}
            model={model}
            actions={actions}
          />
        ))}
        {!model.tracked.length && (
          <EmptyPanelText>Подписок пока нет. Включить отслеживание можно на странице аниме.</EmptyPanelText>
        )}
      </div>
    </Panel>
  );
}

function LibraryPanel({
  model,
  actions,
  expanded,
  onExpandedChange,
}: HomePageProps & { expanded: boolean; onExpandedChange: (expanded: boolean) => void }) {
  return (
    <Panel kind="folders" actions={actions} className="home-library-panel" expanded={expanded}>
      <PanelHeader
        title="Папки и избранное"
        count={model.folders.length + 1}
        expanded={expanded}
        controls="home-library-groups"
        onExpandedChange={onExpandedChange}
      >
        {model.lastDeletedFolder && (
          <button
            type="button"
            className="home-panel-icon-button"
            title={`Восстановить папку «${model.lastDeletedFolder.folder.name}»`}
            onClick={actions.restoreLastFolder}
          >
            ↶
          </button>
        )}
        <button
          type="button"
          className="home-panel-icon-button"
          title="Создать папку"
          onClick={actions.createFolder}
        >
          ＋
        </button>
      </PanelHeader>

      <div
        id="home-library-groups"
        className="home-panel-scroll home-library-groups"
        hidden={!expanded}
        inert={!expanded}
      >
        <FavoritesGroup model={model} actions={actions} />
        <div className="home-folder-list">
          {model.folders.map(folder => (
            <FolderRow key={folder.id} folder={folder} actions={actions} />
          ))}
          {!model.folders.length && (
            <EmptyPanelText>Создай папку и собери в ней свой список аниме.</EmptyPanelText>
          )}
        </div>
      </div>
    </Panel>
  );
}

function FavoritesGroup({ model, actions }: HomePageProps) {
  const stats = model.favoriteStats;

  return (
    <div className="home-library-item home-folder-item home-favorites-folder">
      <button
        type="button"
        className="home-library-item-main"
        onClick={() => actions.openCollection("favorites")}
      >
        <span>
          <b>♥ Избранное</b>
          <small>{model.favorites.length} тайтлов · {stats.watched}/{stats.total} серий</small>
        </span>
        <em>{stats.percent}%</em>
        <ProgressBar percent={stats.percent} />
      </button>
    </div>
  );
}

function FolderRow({
  folder,
  actions,
}: {
  folder: Folder;
  actions: HomePageActions;
}) {
  const stats = actions.folderStats(folder);

  return (
    <div className="home-library-item home-folder-item">
      <button
        type="button"
        className="home-library-item-main"
        onClick={() => actions.openFolder(folder)}
      >
        <span><b>{folder.name}</b><small>{folder.animeIds.length} тайтлов · {stats.watched}/{stats.total} серий</small></span>
        <em>{stats.percent}%</em>
        <ProgressBar percent={stats.percent} />
      </button>
      <DeleteButton
        title={`Удалить папку «${folder.name}»`}
        onClick={() => actions.deleteFolder(folder)}
      />
    </div>
  );
}

function TrackingRow({
  tracker,
  model,
  actions,
}: {
  tracker: Tracker;
  model: HomePageModel;
  actions: HomePageActions;
}) {
  const anime = actions.resolveAnime(tracker.animeId);
  const otherDubEpisodes = tracker.otherDubEpisodes ?? 0;

  return (
    <article className="home-tracking-row">
      <button
        type="button"
        className="home-tracking-main"
        onClick={() => actions.openKnownAnime(tracker.animeId)}
      >
        <span className="home-tracking-copy">
          <b>{tracker.title}</b>
          <small>{tracker.dubs?.length ? tracker.dubs.join(", ") : "Все озвучки"}</small>
          <ReleaseMark anime={anime} status={model.cardMeta[tracker.animeId]?.status} />
        </span>
        <span className="home-tracking-meta">
          <small>{tracker.knownEpisodes} серий</small>
          <TrackingStatus tracker={tracker} />
        </span>
      </button>
      <div className="home-tracking-actions">
        {tracker.newEpisodes > 0 && (
          <button
            type="button"
            className="watch-new-button"
            onClick={() => actions.watchNewEpisode(tracker.animeId)}
          >
            ▶ Смотреть новую
          </button>
        )}
        <button
          type="button"
          className="untrack-button"
          onClick={() => actions.untrack(tracker.animeId)}
        >
          Отписаться
        </button>
        {otherDubEpisodes > 0 && tracker.newEpisodes === 0 && (
          <small className="home-other-dub-note">Есть в другой озвучке · +{otherDubEpisodes}</small>
        )}
      </div>
    </article>
  );
}

function TrackingStatus({ tracker }: { tracker: Tracker }) {
  if (tracker.newEpisodes > 0) {
    return <em className="release-status new"><i />Новая серия · +{tracker.newEpisodes}</em>;
  }
  if ((tracker.otherDubEpisodes ?? 0) > 0) {
    return <em className="release-status other-dub"><i />Другая озвучка</em>;
  }
  return <em className="release-status quiet"><i />Новых серий нет</em>;
}

function Panel({
  id,
  kind,
  actions,
  className,
  expanded,
  children,
}: {
  id?: string;
  kind: CollectionOverviewKind;
  actions: HomePageActions;
  className: string;
  expanded: boolean;
  children: ReactNode;
}) {
  const openPanel = (event: MouseEvent<HTMLElement>) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("button, a, input, select, textarea")) return;
    actions.openCollection(kind);
  };

  return (
    <article
      id={id}
      className={`home-dashboard-panel ${className}${expanded ? "" : " collapsed"}`}
      onClick={openPanel}
    >
      {children}
    </article>
  );
}

function PanelHeader({
  title,
  count,
  badge,
  expanded,
  controls,
  onExpandedChange,
  children,
}: {
  title: string;
  count: number;
  badge?: string;
  expanded: boolean;
  controls: string;
  onExpandedChange: (expanded: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <header className="home-panel-header">
      <h2>{title}</h2>
      <div className="home-panel-header-actions">
        {badge && <em className="home-panel-badge">{badge}</em>}
        <span>{count}</span>
        {children}
        <button
          type="button"
          className="home-panel-collapse-button"
          aria-expanded={expanded}
          aria-controls={controls}
          aria-label={expanded ? `Свернуть «${title}»` : `Развернуть «${title}»`}
          title={expanded ? "Свернуть панель" : "Развернуть панель"}
          onClick={() => onExpandedChange(!expanded)}
        >
          <i aria-hidden="true">⌄</i>
        </button>
      </div>
    </header>
  );
}

function DeleteButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button type="button" className="home-item-delete" title={title} aria-label={title} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm3 2v7h2v-7H9Zm4 0v7h2v-7h-2Z" />
      </svg>
    </button>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return <i className="home-panel-progress"><b style={{ width: `${percent}%` }} /></i>;
}

function EmptyPanelText({ children }: { children: ReactNode }) {
  return <p className="home-panel-empty">{children}</p>;
}
