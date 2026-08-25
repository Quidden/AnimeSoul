"use client";

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

/** Home dashboard composition. Feature modules own the individual sections. */
export function HomePage({ model, actions }: HomePageProps) {
  return (
    <>
      <HomeHero model={model} actions={actions} />
      <LibraryUpdatesNotice model={model} />
      <main className="home-dashboard-flow">
        <HomeDashboardPanels model={model} actions={actions} />
        <PartyNow party={model.party} onOpen={actions.openAnime} />
      </main>
      <LibrarySections model={model} actions={actions} />
    </>
  );
}

function LibraryUpdatesNotice({ model }: Pick<HomePageProps, "model">) {
  if (model.totalNewEpisodes <= 0) return null;

  const updatedTitles = model.tracked.filter(tracker => tracker.newEpisodes > 0).length;
  const episodeLabel = russianPlural(model.totalNewEpisodes, "новая серия", "новые серии", "новых серий");

  return (
    <section className="home-library-updates-wrap" aria-label="Обновления медиатеки">
      <button
        type="button"
        className="home-library-updates"
        aria-label={`Обновления медиатеки. ${model.totalNewEpisodes} ${episodeLabel}. Тайтлов с обновлениями: ${updatedTitles}. Перейти к отслеживаемым.`}
        onClick={() => document
          .getElementById("home-tracking-panel")
          ?.scrollIntoView({ behavior: "smooth", block: "center" })}
      >
        <span className="home-library-updates-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7" />
          </svg>
        </span>
        <span className="home-library-updates-copy">
          <small>ОБНОВЛЕНИЯ МЕДИАТЕКИ</small>
          <b>Новые серии в отслеживаемых тайтлах</b>
          <span>Тайтлов с обновлениями: {updatedTitles}</span>
        </span>
        <strong className="home-library-updates-count">
          <b>+{model.totalNewEpisodes}</b>
          <small>{episodeLabel}</small>
        </strong>
        <span className="home-library-updates-arrow" aria-hidden="true">→</span>
      </button>
    </section>
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
