import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import {
  animeFranchise,
  compareFranchiseAnime,
  franchiseGraphLimit,
  resolveFranchise,
} from "../apps/api/dist/catalog/franchise.js";
import { franchiseLimits, franchiseSchema } from "../packages/contracts/dist/index.js";
import { developmentAnime } from "../packages/database/dist/src/fixtures.js";

const identity = (number) => "00000000-0000-4000-8000-" + String(number).padStart(12, "0");
const row = (number, related = [], extra = {}) => ({
  id: identity(number),
  published: true,
  isDevelopment: false,
  metadataProvider: "kodik",
  details: { relatedAnimeIds: related.map(identity) },
  providers: [{ provider: "kodik-material", externalId: "shikimori:" + number }],
  ...extra,
});

test("franchise traverses saved links, reverse links and cycles identically from every part", () => {
  const records = [row(1, [2]), row(2, [3]), row(3, [1]), row(4)];
  for (const current of [1, 2, 3]) {
    const graph = resolveFranchise(records, identity(current));
    assert.equal(graph.currentAnimeId, identity(current));
    assert.deepEqual(graph.ids, [identity(1), identity(2), identity(3)]);
  }
  assert.deepEqual(resolveFranchise(records, identity(4)).ids, [identity(4)]);
  assert.deepEqual(resolveFranchise([row(1, [2]), row(2, [3]), row(3)], identity(3)).ids, [
    identity(1),
    identity(2),
    identity(3),
  ]);
});

test("franchise reconciles real Shikimori aliases with primary Kodik and transfers legacy UUID links", () => {
  const records = [
    row(1, [20]),
    row(2, [], { details: { relatedExternalIds: ["3"] } }),
    row(3),
    row(20, [4], {
      metadataProvider: "legacy",
      providers: [{ provider: "shikimori", externalId: "2" }],
    }),
    row(4),
    row(5, [], {
      metadataProvider: "legacy",
      providers: [{ provider: "shikimori", externalId: "5" }],
    }),
  ];
  const expected = [identity(1), identity(2), identity(3), identity(4)];
  for (const current of [1, 2, 3, 4, 20]) {
    const graph = resolveFranchise(records, identity(current));
    assert.deepEqual(graph.ids, expected);
    assert.equal(graph.currentAnimeId, identity(current === 20 ? 2 : current));
  }
  assert.equal(resolveFranchise(records, identity(5)), null);
});

test("a season absent from the local catalog does not sever the provider's sequel chain", () => {
  const relations = [
    { sourceId: "45576", targetId: "55818", relation: "sequel" },
    { sourceId: "55818", targetId: "51179", relation: "sequel" },
  ];
  const records = [row(45576, [], { details: { franchiseRelations: relations } }), row(51179)];
  for (const current of [45576, 51179]) {
    const graph = resolveFranchise(records, identity(current));
    assert.equal(graph.currentAnimeId, identity(current));
    assert.deepEqual(graph.ids, [identity(45576), identity(51179)]);
    assert.deepEqual(graph.edges, [
      { sourceId: identity(45576), targetId: identity(51179), relation: "sequel" },
    ]);
  }
});

test("an unavailable legacy season preserves chronology without becoming a playable part", () => {
  const records = [
    row(45576, [], {
      details: {
        franchiseRelations: [
          { sourceId: "45576", targetId: "55818", relation: "sequel" },
          { sourceId: "55818", targetId: "51179", relation: "sequel" },
        ],
      },
    }),
    row(55818, [], {
      metadataProvider: "legacy",
      providers: [{ provider: "shikimori", externalId: "55818" }],
    }),
    row(51179),
  ];
  for (const current of [45576, 51179]) {
    const graph = resolveFranchise(records, identity(current));
    assert.deepEqual(graph.ids, [identity(45576), identity(51179)]);
    assert.deepEqual(graph.edges, [
      { sourceId: identity(45576), targetId: identity(51179), relation: "sequel" },
    ]);
  }
  assert.equal(resolveFranchise(records, identity(55818)), null);
});

test("prequel metadata across a missing part still points from the earlier season to its sequel", () => {
  const records = [
    row(1),
    row(3, [], {
      details: {
        franchiseRelations: [
          { sourceId: "3", targetId: "2", relation: "prequel" },
          { sourceId: "2", targetId: "1", relation: "prequel" },
        ],
      },
    }),
  ];
  for (const current of [1, 3]) {
    const graph = resolveFranchise(records, identity(current));
    assert.deepEqual(graph.ids, [identity(1), identity(3)]);
    assert.deepEqual(graph.edges, [
      { sourceId: identity(1), targetId: identity(3), relation: "sequel" },
    ]);
  }
});

test("sequel links preserve visible middle seasons and do not turn side stories into sequels", () => {
  const records = [
    row(1, [], {
      details: {
        franchiseRelations: [
          { sourceId: "1", targetId: "2", relation: "sequel" },
          { sourceId: "2", targetId: "3", relation: "sequel" },
          { sourceId: "3", targetId: "4", relation: "side_story" },
          { sourceId: "4", targetId: "5", relation: "sequel" },
        ],
      },
    }),
    row(2),
    row(3),
    row(5),
  ];
  const graph = resolveFranchise(records, identity(1));
  assert.deepEqual(graph.ids, [identity(1), identity(2), identity(3), identity(5)]);
  assert.deepEqual(graph.edges, [
    { sourceId: identity(1), targetId: identity(2), relation: "sequel" },
    { sourceId: identity(2), targetId: identity(3), relation: "sequel" },
  ]);
});

test("missing-part branches and cycles retain all seasons without merging character crossovers", () => {
  const records = [
    row(1, [], {
      details: {
        franchiseRelations: [
          { sourceId: "1", targetId: "2", relation: "sequel" },
          { sourceId: "2", targetId: "3", relation: "sequel" },
          { sourceId: "3", targetId: "2", relation: "sequel" },
          { sourceId: "3", targetId: "4", relation: "sequel" },
          { sourceId: "2", targetId: "5", relation: "sequel" },
          { sourceId: "2", targetId: "6", relation: "character" },
          { sourceId: "6", targetId: "7", relation: "sequel" },
        ],
      },
    }),
    row(4),
    row(5),
    row(6),
    row(7),
  ];
  for (const current of [1, 4, 5]) {
    const graph = resolveFranchise(records, identity(current));
    assert.deepEqual(graph.ids, [identity(1), identity(4), identity(5)]);
    assert.deepEqual(
      new Set(
        graph.edges.map(
          ({ sourceId, targetId, relation }) => `${sourceId}:${targetId}:${relation}`,
        ),
      ),
      new Set([`${identity(1)}:${identity(4)}:sequel`, `${identity(1)}:${identity(5)}:sequel`]),
    );
  }
  assert.deepEqual(resolveFranchise(records, identity(6)).ids, [identity(6), identity(7)]);
});

test("unpublished and production development parts remain barriers in typed provider graphs", () => {
  const relations = [
    { sourceId: "1", targetId: "2", relation: "sequel" },
    { sourceId: "2", targetId: "3", relation: "sequel" },
  ];
  for (const flags of [{ published: false }, { isDevelopment: true }]) {
    const records = [
      row(1, [], { details: { franchiseRelations: relations } }),
      row(2, [], flags),
      row(3),
    ];
    for (const current of [1, 3]) {
      const graph = resolveFranchise(records, identity(current), true);
      assert.deepEqual(graph.ids, [identity(current)]);
      assert.deepEqual(graph.edges, []);
    }
    assert.equal(resolveFranchise(records, identity(2), true), null);
    if (flags.isDevelopment)
      assert.deepEqual(resolveFranchise(records, identity(1)).ids, [
        identity(1),
        identity(2),
        identity(3),
      ]);
  }
});

test("unpublished or production-only development entries cannot bridge unrelated anime", () => {
  const records = [
    row(1, [2, 4]),
    row(2, [3], { published: false }),
    row(3),
    row(4, [5], { isDevelopment: true }),
    row(5),
  ];
  assert.deepEqual(resolveFranchise(records, identity(1), true).ids, [identity(1)]);
  assert.deepEqual(resolveFranchise(records, identity(1)).ids, [
    identity(1),
    identity(4),
    identity(5),
  ]);
  assert.deepEqual(resolveFranchise(records, identity(3)).ids, [identity(3)]);
  assert.equal(resolveFranchise(records, identity(2)), null);
  assert.equal(resolveFranchise(records, identity(4), true), null);
});

test("character crossovers lead to separate franchises even with legacy reverse links", () => {
  const relations = [
    { sourceId: "1", targetId: "2", relation: "sequel" },
    { sourceId: "1", targetId: "3", relation: "character" },
    { sourceId: "4", targetId: "3", relation: "character" },
    { sourceId: "4", targetId: "5", relation: "sequel" },
    { sourceId: "3", targetId: "6", relation: "sequel" },
  ];
  const records = [
    row(1, [], {
      details: { relatedAnimeIds: [identity(2), identity(3)], franchiseRelations: relations },
    }),
    row(2),
    row(3, [1, 4, 6]),
    row(4, [3, 5]),
    row(5),
    row(6),
    row(20, [3], {
      metadataProvider: "legacy",
      providers: [{ provider: "shikimori", externalId: "1" }],
    }),
  ];
  for (const current of [1, 2, 20]) {
    const graph = resolveFranchise(records, identity(current));
    assert.deepEqual(graph.ids, [identity(1), identity(2)]);
    assert.deepEqual(graph.externalEdges, [
      { sourceId: identity(1), targetId: identity(3), relation: "character" },
    ]);
  }
  assert.deepEqual(resolveFranchise(records, identity(4)).ids, [identity(4), identity(5)]);
  const crossover = resolveFranchise(records, identity(3));
  assert.deepEqual(crossover.ids, [identity(3), identity(6)]);
  assert.deepEqual(
    new Set(crossover.externalEdges.map((link) => link.targetId)),
    new Set([identity(1), identity(4)]),
  );
});

test("complete story metadata prevents unknown incoming links from merging franchises", () => {
  const records = [
    row(1, [], {
      details: { franchiseRelations: [{ sourceId: "1", targetId: "2", relation: "sequel" }] },
    }),
    row(2),
    row(3, [2, 4]),
    row(4),
  ];
  assert.deepEqual(resolveFranchise(records, identity(1)).ids, [identity(1), identity(2)]);
  assert.deepEqual(resolveFranchise(records, identity(2)).externalEdges, [
    { sourceId: identity(2), targetId: identity(3), relation: "other" },
  ]);
  assert.deepEqual(resolveFranchise(records, identity(3)).ids, [identity(3), identity(4)]);
  // A direct typed relation also prevents an old untyped link from bypassing it.
  records[0].details = { relatedRelations: [{ sourceId: "1", targetId: "3", relation: "other" }] };
  assert.deepEqual(resolveFranchise(records, identity(1)).ids, [identity(1)]);
});

test("unsupported graph, franchise and episode sizes fail explicitly instead of cutting the component", async () => {
  assert.throws(
    () => resolveFranchise(Array(franchiseGraphLimit + 1).fill(row(1)), identity(1)),
    /catalog size/,
  );
  const chain = Array.from({ length: franchiseLimits.items + 1 }, (_, index) =>
    row(index + 1, index < franchiseLimits.items ? [index + 2] : []),
  );
  assert.throws(() => resolveFranchise(chain, identity(1)), /number of parts/);
  const anime = { ...developmentAnime[0], published: true, metadataProvider: "kodik" };
  const db = {
    anime: {
      async findFirst() {
        return { id: anime.id };
      },
      async findMany(input) {
        return input.select ? [row(1)] : [anime];
      },
    },
    episode: {
      async findMany() {
        return Array(franchiseLimits.episodes + 1).fill({});
      },
    },
  };
  await assert.rejects(
    animeFranchise(db, readConfig({ NODE_ENV: "test" }), anime.slug),
    /number of episodes/,
  );
});

test("a missing part cannot expand a supported provider graph into too many playable links", () => {
  const sources = Array.from({ length: 65 }, (_, index) => index + 1);
  const targets = Array.from({ length: 65 }, (_, index) => index + 66);
  const relations = [
    ...sources.map((number) => ({
      sourceId: String(number),
      targetId: "9999",
      relation: "sequel",
    })),
    ...targets.map((number) => ({
      sourceId: "9999",
      targetId: String(number),
      relation: "sequel",
    })),
  ];
  const records = [...sources, ...targets].map((number) =>
    row(number, [], number === 1 ? { details: { franchiseRelations: relations } } : {}),
  );
  assert.throws(() => resolveFranchise(records, identity(1)), /supported number of links/);
});

test("franchise reads canonical episodes once, sorts by premiere and keeps films and specials distinct", async () => {
  const records = [
    {
      ...developmentAnime[0],
      title: "ТВ, часть 2",
      year: 2024,
      details: { airedAt: "2024-10-01" },
      format: "tv",
      published: true,
    },
    {
      ...developmentAnime[1],
      title: "ТВ, часть 1",
      year: 2024,
      details: { airedAt: "2024-01-01" },
      format: "tv",
      published: true,
    },
    {
      ...developmentAnime[2],
      title: "Фильм",
      year: 2024,
      details: { airedAt: "2024-06-01" },
      format: "movie",
      published: true,
    },
    {
      ...developmentAnime[3],
      title: "Спешл",
      year: 2024,
      details: { airedAt: "2024-12-01" },
      format: "special",
      published: true,
    },
  ].map((anime) => ({ ...anime, metadataProvider: "kodik", isDevelopment: false }));
  const graph = records.map((anime, index) => row(index + 1, index < 3 ? [index + 2] : []));
  const episodes = [
    { id: identity(101), animeId: records[0].id, season: "1", number: "10", duration: 1400 },
    { id: identity(102), animeId: records[0].id, season: "1", number: "2", duration: null },
    { id: identity(103), animeId: records[0].id, season: "2", number: "1", duration: null },
    { id: identity(104), animeId: records[2].id, season: "1", number: "1", duration: 6000 },
    {
      id: identity(105),
      animeId: records[3].id,
      season: "Specials",
      number: "OVA",
      duration: 1000,
    },
  ];
  let batchReads = 0;
  const db = {
    animeCharacter: {
      async findMany() {
        return [];
      },
    },
    anime: {
      async findFirst(input) {
        assert.equal(input.where.published, true);
        return { id: records.find((anime) => anime.slug === input.where.slug).id };
      },
      async findMany(input) {
        if (input.select) {
          assert.equal(input.take, franchiseGraphLimit + 1);
          assert.equal(input.where, undefined);
          return graph;
        }
        assert.deepEqual(input.where.metadataProvider, { not: "legacy" });
        return records;
      },
    },
    libraryItem: {
      async groupBy() {
        return [];
      },
    },
    episode: {
      async findMany(input) {
        batchReads++;
        assert.deepEqual(
          new Set(input.where.animeId.in),
          new Set(records.map((anime) => anime.id)),
        );
        assert.equal(input.take, franchiseLimits.episodes + 1);
        return [...episodes];
      },
    },
  };
  const result = await animeFranchise(db, readConfig({ NODE_ENV: "test" }), records[0].slug);
  assert.equal(batchReads, 1);
  assert.equal(result.currentAnimeId, records[0].id);
  assert.deepEqual(
    result.items.map((item) => item.anime.format),
    ["tv", "movie", "tv", "special"],
  );
  assert.deepEqual(
    result.items.map((item) => item.anime.id),
    [records[1].id, records[2].id, records[0].id, records[3].id],
  );
  assert.deepEqual(
    result.items[2].episodes.map(({ season, number }) => [season, number]),
    [
      ["1", "2"],
      ["1", "10"],
      ["2", "1"],
    ],
  );
  assert.deepEqual(
    result.items[3].episodes.map(({ season, number }) => [season, number]),
    [["Specials", "OVA"]],
  );
  assert.deepEqual(result.items[0].episodes, []);
  assert.equal(franchiseSchema.safeParse(result).success, true);
  assert.equal(
    franchiseSchema.safeParse({ ...result, currentAnimeId: identity(999) }).success,
    false,
  );
  assert.equal(
    franchiseSchema.safeParse({ ...result, items: [result.items[2], result.items[2]] }).success,
    false,
  );
  assert.equal(
    franchiseSchema.safeParse({
      ...result,
      items: [{ anime: result.items[2].anime, episodes: [episodes[3]] }],
    }).success,
    false,
  );
  assert.deepEqual(
    [...records].sort(compareFranchiseAnime).map((anime) => anime.id),
    result.items.map((item) => item.anime.id),
  );
});

test("franchise endpoint supports single-part demo titles, rejects missing titles and invalid slugs", async (t) => {
  const app = await createApplication(readConfig({ NODE_ENV: "test", DEMO_CATALOG: "true" }));
  t.after(() => app.close());
  const server = app.getHttpAdapter().getInstance();
  const result = await server.inject({
    method: "GET",
    url: "/api/anime/attack-on-titan/franchise",
  });
  assert.equal(result.statusCode, 200);
  const parsed = franchiseSchema.parse(result.json());
  assert.equal(parsed.currentAnimeId, developmentAnime[0].id);
  assert.equal(parsed.items.length, 1);
  assert.deepEqual(parsed.items[0].episodes, []);
  assert.equal(
    (await server.inject({ method: "GET", url: "/api/anime/missing/franchise" })).statusCode,
    404,
  );
  assert.equal(
    (await server.inject({ method: "GET", url: "/api/anime/invalid%21/franchise" })).statusCode,
    404,
  );
});
