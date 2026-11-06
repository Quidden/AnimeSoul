import test from "node:test";
import assert from "node:assert/strict";
import { CatalogService } from "../apps/api/dist/catalog/catalog.service.js";
import { animeFranchise } from "../apps/api/dist/catalog/franchise.js";
import { animeCharacters } from "../apps/api/dist/catalog/characters.js";
import { readConfig } from "../apps/api/dist/config.js";
import { developmentAnime } from "../packages/database/dist/src/fixtures.js";

test(
  "season navigation returns stored title, franchise and cast while provider refreshes are pending",
  { timeout: 2000 },
  async () => {
    const anime = {
      ...developmentAnime[0],
      published: true,
      isDevelopment: false,
      metadataProvider: "kodik",
      details: {},
      providers: [],
    };
    const episode = {
      id: "11111111-1111-4111-8111-111111111111",
      animeId: anime.id,
      season: "1",
      number: "1",
      duration: 1200,
    };
    const releases = [];
    let refreshes = 0;
    const pending = (value) => {
      refreshes++;
      return new Promise((resolve) => releases.push(() => resolve(value)));
    };
    const db = {
      anime: {
        findFirst: async () => anime,
        findMany: async () => [anime],
        findUnique: () => pending(null),
      },
      animeProvider: { findMany: () => pending([]) },
      animeCharacter: { findMany: async () => [] },
      episode: { findMany: async () => [episode] },
      libraryItem: { groupBy: async () => [] },
    };
    const config = readConfig({ NODE_ENV: "development", DEMO_CATALOG: "false" });
    const catalog = new CatalogService(config);
    catalog.database = db;
    try {
      const [title, franchise, cast] = await Promise.all([
        catalog.find(anime.slug),
        animeFranchise(db, config, anime.slug),
        animeCharacters(db, config, anime.slug),
      ]);
      assert.equal(title.id, anime.id);
      assert.equal(franchise.currentAnimeId, anime.id);
      assert.deepEqual(franchise.items[0].episodes, [episode]);
      assert.deepEqual(cast.items, []);
      assert.equal(
        refreshes,
        3,
        "title, relationships and cast refresh independently of the response",
      );
    } finally {
      releases.forEach((release) => release());
    }
  },
);
