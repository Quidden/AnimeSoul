import type { ReactNode } from "react";
import { FAQBlock } from "../../components/FAQBlock";
import { ReleaseMark } from "../../components/ReleaseMark";
import { Toggle } from "../../components/Toggle";
import type { HistoryItem, WatchingItem } from "../../features/library/selectors";
import { formatTime, watchTimeProgress } from "../../lib/anime";
import type { HomePageActions, HomePageModel, HomePageProps } from "./types";

export function LibrarySections({ model, actions }: HomePageProps) {
  return (
    <section className="library home-library-flow" id="my-library">
      <WatchingSection model={model} actions={actions} />
      <HistorySection model={model} actions={actions} />
      <FAQBlock />
    </section>
  );
}

function WatchingSection({ model, actions }: HomePageProps) {
  return (
    <section className="watching-section">
      <CollapseControl
        title="Смотрю сейчас"
        expanded={model.watchingExpanded}
        onChange={actions.setWatchingExpanded}
      />
      <CollapseShell expanded={model.watchingExpanded}>
        <div className="section-inline-actions">
          <span>{model.watchingItems.length} тайтлов</span>
        </div>
        <div className="watching-list">
          {model.watchingItems.map(entry => (
            <WatchingRow
              key={entry.animeId}
              entry={entry}
              model={model}
              actions={actions}
            />
          ))}
          {!model.storageReady && (
            <div className="empty watching-empty" role="status" aria-live="polite">
              Загружаем сохранённый прогресс…
            </div>
          )}
          {model.storageReady && !model.watchingItems.length && (
            <div className="empty watching-empty">
              Здесь появятся аниме, просмотр которых ты начал. Пока можно выбрать новое в каталоге.
            </div>
          )}
        </div>
      </CollapseShell>
    </section>
  );
}

function WatchingRow({
  entry,
  model,
  actions,
}: {
  entry: WatchingItem;
  model: HomePageModel;
  actions: HomePageActions;
}) {
  const anime = actions.resolveAnime(entry.animeId);
  const wholeProgress = watchTimeProgress(entry.item);

  return (
    <article>
      {anime?.poster?.big && <img src={anime.poster.big} alt="" />}
      <button
        className="watching-main"
        onClick={() => anime && actions.openAnime(anime, true)}
      >
        <b>{anime?.title ?? `Аниме #${entry.animeId}`}</b>
        <ReleaseMark anime={anime} status={model.cardMeta[entry.animeId]?.status} />
        <small>
          Сезон {entry.season} · серия {entry.episode} · {formatTime(entry.state.position)}
        </small>
        <ProgressBar percent={wholeProgress} />
        <span>{wholeProgress}% просмотрено</span>
      </button>
      <div className="watching-actions">
        {anime && (
          <button className="primary" onClick={() => actions.openAnime(anime, true)}>
            ▶ Продолжить
          </button>
        )}
        <button
          className="watching-remove"
          title="Убрать из списка «Смотрю сейчас»"
          onClick={() => actions.hideWatching(entry.animeId)}
        >
          ×
        </button>
      </div>
    </article>
  );
}

function HistorySection({ model, actions }: HomePageProps) {
  return (
    <section className="history-collapsible">
      <div className="section-collapse-control history-collapse-control">
        <button
          className={`collapse-toggle ${model.historyExpanded ? "expanded" : ""}`}
          aria-expanded={model.historyExpanded}
          onClick={() => actions.setHistoryExpanded(!model.historyExpanded)}
        >
          <i>⌄</i>
          <span>История просмотра</span>
          <small>{model.historyEnabled ? "Просмотры сохраняются" : "История выключена"}</small>
        </button>
        <div className="history-enable-control" onClick={event => event.stopPropagation()}>
          <Toggle
            label="Сохранять историю"
            value={model.historyEnabled}
            onChange={actions.setHistoryEnabled}
          />
        </div>
      </div>
      <CollapseShell expanded={model.historyExpanded}>
        <div className="history-section">
          <div className="history-head-actions">
            <span>{model.historyItems.length} записей</span>
            <button
              className="outline danger"
              disabled={!model.historyItems.length}
              onClick={actions.clearHistory}
            >
              Очистить историю
            </button>
          </div>
          <div className="history-list">
            {model.historyItems.map(item => (
              <HistoryRow
                key={`${item.animeId}:${item.season}:${item.episode}`}
                item={item}
                model={model}
                actions={actions}
              />
            ))}
            {!model.storageReady && (
              <div className="empty history-empty" role="status" aria-live="polite">
                Загружаем историю просмотра…
              </div>
            )}
            {model.storageReady && !model.historyItems.length && (
              <div className="empty history-empty">
                {model.historyEnabled
                  ? "История очищена. Новые просмотры появятся здесь автоматически."
                  : "Сохранение истории выключено. Прогресс просмотра продолжает сохраняться."}
              </div>
            )}
          </div>
        </div>
      </CollapseShell>
    </section>
  );
}

function HistoryRow({
  item,
  model,
  actions,
}: {
  item: HistoryItem;
  model: HomePageModel;
  actions: HomePageActions;
}) {
  const anime = actions.resolveAnime(item.animeId);
  const date = new Date(item.state.updatedAt).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <article>
      <button onClick={() => actions.resumeHistory(item)}>
        {anime?.poster?.big && <img src={anime.poster.big} alt="" />}
        <span>
          <b>{anime?.title ?? `Аниме #${item.animeId}`}</b>
          <ReleaseMark anime={anime} status={model.cardMeta[item.animeId]?.status} />
          <small>
            Сезон {item.season} · серия {item.episode} · {formatTime(item.state.position)}
          </small>
        </span>
        <time>{date}</time>
        <em>▶ Продолжить</em>
      </button>
    </article>
  );
}

function CollapseControl({
  title,
  expanded,
  onChange,
}: {
  title: string;
  expanded: boolean;
  onChange: (expanded: boolean) => void;
}) {
  return (
    <div className="section-collapse-control">
      <button
        className={`collapse-toggle ${expanded ? "expanded" : ""}`}
        aria-expanded={expanded}
        onClick={() => onChange(!expanded)}
      >
        <i>⌄</i>
        <span>{title}</span>
      </button>
    </div>
  );
}

function CollapseShell({
  expanded,
  children,
}: {
  expanded: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`collapse-shell ${expanded ? "expanded" : ""}`}>
      <div className="collapse-inner" aria-hidden={!expanded} inert={!expanded}>{children}</div>
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="wide-progress">
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}
