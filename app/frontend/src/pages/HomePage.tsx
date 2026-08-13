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
      <main className="home-dashboard-flow">
        <HomeDashboardPanels model={model} actions={actions} />
        <PartyNow party={model.party} onOpen={actions.openAnime} />
      </main>
      <LibrarySections model={model} actions={actions} />
    </>
  );
}
