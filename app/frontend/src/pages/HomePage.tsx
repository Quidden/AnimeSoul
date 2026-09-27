import { HomeHero } from "./home/HomeHero";
import { LibrarySections } from "./home/LibrarySections";
import type { HomePageProps } from "./home/types";

export type {
  CollectionStats,
  DeletedFolder,
  HomePageActions,
  HomePageModel,
  HomePageProps,
} from "./home/types";

/** The landing route has one clear continuation path. */
export function HomePage({ model, actions }: HomePageProps) {
  return (
    <>
      <HomeHero model={model} actions={actions} />
      <main className="home-library-workspace" id="my-library">
        <div className="home-library-heading"><h1>Смотрю сейчас</h1></div>
        <LibrarySections model={model} actions={actions} view="watching" />
      </main>
    </>
  );
}
