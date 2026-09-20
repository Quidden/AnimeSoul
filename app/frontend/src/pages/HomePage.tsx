"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { FAQBlock } from "../components/FAQBlock";
import { HomeDashboardPanels } from "./home/DashboardWidgets";
import { HomeHero, PartyNow } from "./home/HomeHero";
import { LibrarySections } from "./home/LibrarySections";
import type { HomePageProps } from "./home/types";

export type {
  CollectionStats,
  DeletedFolder,
  HomePageActions,
  HomePageModel,
  HomePageProps,
} from "./home/types";

type LibraryView = "watching" | "tracking" | "folders" | "history";

/** Keep the cinema above one focused library surface. */
export function HomePage({ model, actions }: HomePageProps) {
  const [view, setView] = useState<LibraryView>("watching");
  const tabRefs = useRef<Partial<Record<LibraryView, HTMLButtonElement | null>>>({});
  const tabs: { id: LibraryView; label: string; count: number }[] = [
    { id: "watching", label: "Смотрю сейчас", count: model.watchingItems.length },
    { id: "tracking", label: "Отслеживаю", count: model.tracked.length },
    { id: "folders", label: "Папки и избранное", count: model.folders.length + 1 },
    { id: "history", label: "История", count: model.historyItems.length },
  ];

  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setView(tabs[next].id);
    tabRefs.current[tabs[next].id]?.focus();
  };

  return (
    <>
      <HomeHero model={model} actions={actions} />
      <main className="home-library-workspace" id="my-library">
        <PartyNow party={model.party} onOpen={actions.openAnime} />
        <div className="home-library-heading">
          <h1>Моя медиатека</h1>
          <LibraryUpdatesNotice model={model} onOpen={() => {
            setView("tracking");
            tabRefs.current.tracking?.focus({ preventScroll: true });
          }} />
        </div>
        <div className="home-library-tabs" role="tablist" aria-label="Медиатека">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={element => { tabRefs.current[tab.id] = element; }}
              type="button"
              role="tab"
              id={`home-tab-${tab.id}`}
              aria-selected={view === tab.id}
              aria-controls={`home-view-${tab.id}`}
              tabIndex={view === tab.id ? 0 : -1}
              onClick={() => setView(tab.id)}
              onKeyDown={event => navigateTabs(event, index)}
            >
              {tab.label}
              {tab.id === "tracking" && model.totalNewEpisodes > 0 && <i
                className="home-tracking-update-dot"
                role="img"
                aria-label="Есть новые серии"
                title="Есть новые серии"
              />}
              <span>{tab.count}</span>
            </button>
          ))}
        </div>
        {tabs.map(tab => (
          <div
            key={tab.id}
            id={`home-view-${tab.id}`}
            className="home-library-view"
            role="tabpanel"
            aria-labelledby={`home-tab-${tab.id}`}
            hidden={view !== tab.id}
            tabIndex={0}
          >
            {(tab.id === "tracking" || tab.id === "folders") ? (
              <HomeDashboardPanels model={model} actions={actions} view={tab.id} />
            ) : (
              <LibrarySections model={model} actions={actions} view={tab.id} />
            )}
          </div>
        ))}
        <FAQBlock />
      </main>
    </>
  );
}

function LibraryUpdatesNotice({ model, onOpen }: Pick<HomePageProps, "model"> & { onOpen: () => void }) {
  if (model.totalNewEpisodes <= 0) return null;

  const updatedTitles = model.tracked.filter(tracker => tracker.newEpisodes > 0).length;
  const episodeLabel = russianPlural(model.totalNewEpisodes, "новая серия", "новые серии", "новых серий");

  return (
      <button
        type="button"
        className="home-updates-link"
        aria-label={`Обновления медиатеки. ${model.totalNewEpisodes} ${episodeLabel}. Тайтлов с обновлениями: ${updatedTitles}. Перейти к отслеживаемым.`}
        onClick={onOpen}
      >
        <i aria-hidden="true" />
        <span>{model.totalNewEpisodes} {episodeLabel}</span>
        <span aria-hidden="true">↗</span>
      </button>
  );
}

function russianPlural(count: number, one: string, few: string, many: string) {
  const normalized = Math.abs(count) % 100;
  const last = normalized % 10;
  if (normalized > 10 && normalized < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
