import { HomeDashboardPanels } from "./home/DashboardWidgets";
import { LibrarySections } from "./home/LibrarySections";
import type { HomePageProps } from "./home/types";
import { TrackingCalendar } from "./tracking/TrackingCalendar";
import { animeRoute, navigateTo } from "../features/navigation/routes";

export function LibraryPage({ model, actions, kind }: HomePageProps & { kind: "tracking" | "library" | "history" }) {
  const title = kind === "tracking" ? "Отслеживание" : kind === "library" ? "Папки и избранное" : "История";
  return <main className="home-library-workspace routed-library-page">
    <div className="home-library-heading"><h1>{title}</h1></div>
    {kind === "tracking" && <>
      <TrackingCalendar tracked={model.tracked} onOpen={(animeId, originId, episode) => navigateTo(animeRoute(animeId, undefined, episode, true, originId))} />
      <HomeDashboardPanels model={model} actions={actions} view="tracking" />
    </>}
    {kind === "library" && <HomeDashboardPanels model={model} actions={actions} view="folders" />}
    {kind === "history" && <LibrarySections model={model} actions={actions} view="history" />}
  </main>;
}
