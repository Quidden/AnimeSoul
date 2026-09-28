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
    <article className="anime-card home-catalog-card">
      <div className="poster">
        {anime?.poster?.big ? <img src={anime.poster.big} alt="" loading="lazy" /> : <span className="home-catalog-poster-empty" aria-hidden="true">◆</span>}
        <span className="home-catalog-status">{anime ? <ReleaseMark anime={anime} status={model.cardMeta[entry.animeId]?.status} /> : "Недоступно"}</span>
        {anime && <button type="button" className="home-catalog-poster-action" aria-label={`Продолжить просмотр: ${anime.title}`} onClick={() => actions.openAnime(anime, true)}>▶</button>}
        <button
          type="button"
          className="home-watching-dismiss"
          title="Убрать из «Смотрю сейчас»"
          aria-label={`Убрать из «Смотрю сейчас»: ${anime?.title ?? `Аниме #${entry.animeId}`}`}
          onClick={event => {
            event.stopPropagation();
            actions.hideWatching(entry.animeId);
          }}
        ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
      </div>
      <h3>{anime?.title ?? `Аниме #${entry.animeId}`}</h3>
      <p className="home-catalog-meta">{anime?.year ?? "—"} · {anime?.type?.name ?? "Аниме"}{anime?.rating?.average ? ` · ★ ${anime.rating.average.toFixed(1)}` : ""}</p>
      <p className="home-catalog-episode">Сезон {entry.season} · серия {entry.episode} · {formatTime(entry.state.position)}</p>
      {anime?.genres?.length ? <div className="tagline">{anime.genres.slice(0, 2).map(genre => <span key={genre.alias}>{genre.title}</span>)}</div> : null}
      {!anime && <p className="home-catalog-unavailable">Данные об аниме сейчас недоступны. Прогресс сохранён.</p>}
      <div className="card-progress" aria-label={`Просмотрено ${wholeProgress}%`}><i style={{width: `${wholeProgress}%`}} /><small>{wholeProgress}% просмотра</small></div>
      <div className="home-catalog-card-actions">
        {anime ? <button type="button" className="primary" onClick={() => actions.openAnime(anime, true)}>▶ {entry.state.position > 0 ? "Продолжить" : "Начать просмотр"}</button> : <button type="button" onClick={() => actions.hideWatching(entry.animeId)}>Убрать из списка</button>}
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
