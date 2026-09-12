import { useState } from "react";

import { FAQBlock } from "../../components/FAQBlock";
import { ReleaseMark } from "../../components/ReleaseMark";
import { Toggle } from "../../components/Toggle";
import type { HistoryItem, WatchingItem } from "../../features/library/selectors";
import { formatTime, watchTimeProgress } from "../../lib/anime";
import type { Anime } from "../../lib/types";
import { HomeLoadMore } from "./HomeCardList";
import { LibraryToolbar } from "./LibraryToolbar";
import type { HomePageActions, HomePageModel, HomePageProps } from "./types";
import { useHomeCardLimit } from "./useHomeCardLimit";

export function LibrarySections({ model, actions, view }: HomePageProps & { view?: "watching" | "history" }) {
  return (
    <section className="library home-library-flow">
      {view !== "history" && <WatchingSection model={model} actions={actions} />}
      {view !== "watching" && <HistorySection model={model} actions={actions} />}
      {!view && <FAQBlock />}
    </section>
  );
}

function WatchingSection({ model, actions }: HomePageProps) {
  const pagination = useHomeCardLimit(model.watchingItems.length);

  return (
    <section className="watching-section">
      <LibraryToolbar summary={`${model.watchingItems.length} тайтлов · по последнему просмотру`} />
      <div className="home-media-card-list watching-list">
        {model.watchingItems.slice(0, pagination.visibleCount).map(entry => (
          <WatchingRow key={entry.animeId} entry={entry} model={model} actions={actions} />
        ))}
        {!model.storageReady && (
          <div className="empty watching-empty" role="status" aria-live="polite">
            Загружаем сохранённый прогресс…
          </div>
        )}
        {model.storageReady && !model.watchingItems.length && (
          <div className="empty watching-empty">
            <b>Начни свою следующую историю</b>
            <span>Здесь появятся аниме, которые ты смотришь.</span>
            <button type="button" className="home-action-button" onClick={actions.chooseCatalog}>
              Выбрать в каталоге <span aria-hidden="true">↗</span>
            </button>
          </div>
        )}
      </div>
      <HomeLoadMore remaining={pagination.remaining} onLoadMore={pagination.loadMore} />
    </section>
  );
}

function WatchingRow({ entry, model, actions }: {
  entry: WatchingItem;
  model: HomePageModel;
  actions: HomePageActions;
}) {
  const anime = actions.resolveAnime(entry.animeId);
  const wholeProgress = watchTimeProgress(entry.item);

  return (
    <article className="home-media-card home-watching-card">
      <CardArtwork anime={anime} />
      <div className="home-media-card-body">
        <div className="home-card-status"><ReleaseMark anime={anime} status={model.cardMeta[entry.animeId]?.status} /></div>
        <button type="button" className="home-card-title" onClick={() => anime && actions.openAnime(anime, true)}>
          {anime?.title ?? `Аниме #${entry.animeId}`}
        </button>
        <p className="home-card-subtitle">Сезон {entry.season} · серия {entry.episode} · {formatTime(entry.state.position)}</p>
        <div className="home-card-metrics">
          <CardMetric label="Просмотрено" value={`${wholeProgress}%`} />
          <CardMetric label="Последний просмотр" value={formatUpdatedAt(entry.updatedAt)} />
        </div>
        <div className="home-card-progress" aria-label={`Просмотрено ${wholeProgress}%`}>
          <i style={{ width: `${wholeProgress}%` }} />
        </div>
        <div className="home-card-footer">
          <small>{entry.item.totalEpisodes ? `Всего серий: ${entry.item.totalEpisodes}` : "Прогресс сохранён"}</small>
          <div className="home-card-actions">
            <button type="button" className="home-action-button home-action-danger" onClick={() => actions.hideWatching(entry.animeId)}>
              Убрать
            </button>
            {anime && (
              <button type="button" className="home-action-button home-play-button" onClick={() => actions.openAnime(anime, true)}>
                <span aria-hidden="true">▶</span> Продолжить
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function HistorySection({ model, actions }: HomePageProps) {
  const pagination = useHomeCardLimit(model.historyItems.length);

  return (
    <section className="home-history-section">
      <LibraryToolbar summary={`${model.historyItems.length} записей`}>
        <div className="history-enable-control">
          <Toggle label="Сохранять историю" value={model.historyEnabled} onChange={actions.setHistoryEnabled} />
        </div>
        <button type="button" className="home-action-button home-action-danger" disabled={!model.historyItems.length} onClick={actions.clearHistory}>
          Очистить историю
        </button>
      </LibraryToolbar>
      <div className="home-media-card-list history-list">
        {model.historyItems.slice(0, pagination.visibleCount).map(item => (
          <HistoryRow key={`${item.animeId}:${item.season}:${item.episode}`} item={item} model={model} actions={actions} />
        ))}
        {!model.storageReady && (
          <div className="empty history-empty" role="status" aria-live="polite">Загружаем историю просмотра…</div>
        )}
        {model.storageReady && !model.historyItems.length && (
          <div className="empty history-empty">
            {model.historyEnabled
              ? "История очищена. Новые просмотры появятся здесь автоматически."
              : "Сохранение истории выключено. Прогресс просмотра продолжает сохраняться."}
          </div>
        )}
      </div>
      <HomeLoadMore remaining={pagination.remaining} onLoadMore={pagination.loadMore} />
    </section>
  );
}

function HistoryRow({ item, model, actions }: {
  item: HistoryItem;
  model: HomePageModel;
  actions: HomePageActions;
}) {
  const anime = actions.resolveAnime(item.animeId);
  const progress = Math.min(100, Math.round(item.state.percent || 0));

  return (
    <article className="home-media-card home-history-card">
      <CardArtwork anime={anime} />
      <div className="home-media-card-body">
        <div className="home-card-status"><ReleaseMark anime={anime} status={model.cardMeta[item.animeId]?.status} /></div>
        <button type="button" className="home-card-title" onClick={() => actions.resumeHistory(item)}>
          {anime?.title ?? `Аниме #${item.animeId}`}
        </button>
        <p className="home-card-subtitle">Сезон {item.season} · серия {item.episode}</p>
        <div className="home-card-metrics">
          <CardMetric label="Остановились на" value={formatTime(item.state.position)} />
          <CardMetric label="Дата просмотра" value={formatUpdatedAt(item.state.updatedAt)} />
        </div>
        <div className="home-card-progress" aria-label={`Эпизод просмотрен на ${progress}%`}>
          <i style={{ width: `${progress}%` }} />
        </div>
        <div className="home-card-footer">
          <small>{progress}% эпизода</small>
          <div className="home-card-actions">
            <button type="button" className="home-action-button home-play-button" onClick={() => actions.resumeHistory(item)}>
              <span aria-hidden="true">▶</span> Продолжить
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function CardArtwork({ anime }: { anime?: Anime }) {
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const candidates = Array.from(new Set([
    anime?.poster?.fullsize,
    anime?.poster?.big,
  ].filter((value): value is string => Boolean(value))));
  const image = candidates.find(candidate => !failedImages.includes(candidate));

  return (
    <div className={`home-card-artwork${image ? "" : " is-empty"}`} aria-hidden="true">
      {image && (
        <img
          src={image}
          alt=""
          loading="lazy"
          onError={() => setFailedImages(current => current.includes(image) ? current : [...current, image])}
        />
      )}
    </div>
  );
}

export function CardMetric({ label, value }: { label: string; value: string }) {
  return <span className="home-card-metric"><small>{label}</small><b>{value}</b></span>;
}

function formatUpdatedAt(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
