import test from "node:test";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { parseShikimoriRelated } from "../apps/api/dist/catalog/shikimori-metadata.js";
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parseShikimoriFranchise } from "../apps/api/dist/catalog/shikimori-franchise.js";
import { resolveFranchise } from "../apps/api/dist/catalog/franchise.js";

async function helper(name) {
  const js = stripTypeScriptTypes(readFileSync(`apps/web/lib/${name}.ts`, "utf8"), {
    mode: "transform",
    disableExperimentalWarning: true,
  });
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}
const { extractPosterColors, parsePosterPalette, posterPaletteBootstrap, posterPaletteKey } =
  await helper("poster-palette");
const { episodeViewing } = await helper("episode-view");
const { trailerEmbed } = await helper("trailer");
const { layoutFranchise, mainStoryIds, franchiseFocus } = await helper("franchise-graph");
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");

test("poster sampling favors distinct poster colors and rejects background/transparent pixels", () => {
  const pixels = [
    ...Array(20).fill([255, 255, 255, 255]),
    ...Array(10).fill([10, 10, 10, 255]),
    ...Array(10).fill([220, 40, 60, 255]),
    ...Array(5).fill([40, 100, 220, 255]),
    [20, 255, 10, 0],
  ].flat();
  const colors = extractPosterColors(pixels);
  assert.deepEqual(colors.slice(0, 2), [
    [220, 40, 60],
    [40, 100, 220],
  ]);
  assert.equal(colors.length, 3);
  assert.ok(extractPosterColors([]).flat().every(Number.isFinite));
});

test("stored poster colors restore globally without modifying the chosen theme or accepting CSS injection", () => {
  const valid = {
    poster: "https://shikimori.io/poster.jpg",
    colors: [
      [220, 40, 60],
      [40, 100, 220],
      [130, 65, 200],
    ],
  };
  for (const stored of [
    valid,
    { ...valid, colors: ["url(evil)", [1, 2, 3], [4, 5, 6]] },
    {
      ...valid,
      colors: [
        [1, 2, 999],
        [1, 2, 3],
        [1, 2, 3],
      ],
    },
    null,
  ]) {
    const applied = new Map();
    runInNewContext(posterPaletteBootstrap, {
      localStorage: {
        getItem(key) {
          assert.equal(key, posterPaletteKey);
          return JSON.stringify(stored);
        },
      },
      document: {
        documentElement: {
          style: {
            setProperty(key, value) {
              applied.set(key, value);
            },
          },
          setAttribute(name) {
            assert.equal(name, "data-poster-ambient");
          },
        },
      },
    });
    assert.equal(applied.size, stored === valid ? 3 : 0);
    assert.equal(Boolean(parsePosterPalette(stored)), stored === valid);
  }
  assert.doesNotThrow(() =>
    runInNewContext(posterPaletteBootstrap, {
      get localStorage() {
        throw Error("denied");
      },
    }),
  );
});

test("episode indicators distinguish completed, partial and new episodes with bounded remaining time", () => {
  assert.deepEqual(episodeViewing(1440), {
    completed: false,
    percent: 0,
    started: false,
    remaining: 1440,
  });
  assert.deepEqual(episodeViewing(1440, { position: 600, duration: 1200, completed: false }), {
    completed: false,
    percent: 50,
    started: true,
    remaining: 600,
  });
  assert.deepEqual(episodeViewing(1440, { position: 600, duration: 1200, completed: true }), {
    completed: true,
    percent: 100,
    started: false,
    remaining: 0,
  });
  assert.equal(episodeViewing(null).remaining, null);
  assert.equal(episodeViewing(1200, { position: -100, duration: 0, completed: false }).percent, 0);
  assert.equal(
    episodeViewing(1200, { position: 9999, duration: 1200, completed: false }).remaining,
    0,
  );
});

test("trailers only embed supported video identities and omit missing or unsafe metadata", () => {
  assert.equal(
    trailerEmbed("https://youtu.be/7IQM5EPf2Y0"),
    "https://www.youtube-nocookie.com/embed/7IQM5EPf2Y0",
  );
  assert.equal(
    trailerEmbed("https://youtube.com/watch?v=7IQM5EPf2Y0"),
    "https://www.youtube-nocookie.com/embed/7IQM5EPf2Y0",
  );
  for (const value of [
    "",
    "javascript:alert(1)",
    "https://youtube.com.evil/embed/7IQM5EPf2Y0",
    "https://youtube.com/watch?v=bad",
  ])
    assert.equal(trailerEmbed(value), null);
});

test("direct Shikimori links retain crossover types and exclude manga and invalid identities", () => {
  assert.deepEqual(
    parseShikimoriRelated(
      [
        { relation: "Spin-off", anime: { id: 2 } },
        { relation: "Character", anime: { id: 3 } },
        { relation: "Side Story", anime: { id: 4 } },
        { relation: "Adaptation", manga: { id: 5 } },
        { relation: "Sequel", anime: { id: 1 } },
        { relation: "Sequel", anime: { id: "invalid" } },
      ],
      "1",
    ),
    [
      { sourceId: "1", targetId: "2", relation: "spin_off" },
      { sourceId: "1", targetId: "3", relation: "character" },
      { sourceId: "1", targetId: "4", relation: "side_story" },
    ],
  );
});

test("Shikimori graph checks source identity and reconciles directed provider relationships without duplicates", () => {
  const upstream = {
    current_id: 2,
    nodes: [{ id: 1 }, { id: 2 }, { id: 3 }],
    links: [
      { source_id: 2, target_id: 1, relation: "prequel" },
      { source_id: 1, target_id: 2, relation: "sequel" },
      { source_id: 2, target_id: 3, relation: "side_story" },
      { source_id: 99, target_id: 2, relation: "sequel" },
    ],
  };
  const relations = parseShikimoriFranchise(upstream, "2");
  assert.equal(relations.length, 3);
  assert.throws(() => parseShikimoriFranchise(upstream, "9"), /Invalid franchise/);
  const rows = [1, 2, 3].map((n) => ({
    id: id(n),
    published: true,
    isDevelopment: false,
    metadataProvider: "kodik",
    providers: [{ provider: "kodik-material", externalId: `shikimori:${n}` }],
    details: n === 2 ? { franchiseRelations: relations } : {},
  }));
  const graph = resolveFranchise(rows, id(2));
  assert.deepEqual(graph.ids, [id(1), id(2), id(3)]);
  assert.deepEqual(graph.edges, [
    { sourceId: id(1), targetId: id(2), relation: "sequel" },
    { sourceId: id(2), targetId: id(3), relation: "side_story" },
  ]);
  rows[2].published = false;
  assert.equal(resolveFranchise(rows, id(2)).edges.length, 1);
});

test("graph places sequels on the main line and dated side stories on separate chronological branches", () => {
  const anime = (n, year, format = "tv", airedAt) => ({
    id: id(n),
    title: `Аниме ${n}`,
    year,
    format,
    details: airedAt ? { airedAt } : {},
  });
  const franchise = {
    currentAnimeId: id(2),
    items: [
      { anime: anime(2, 2020, "tv", "2020-09-01") },
      { anime: anime(4, 2019) },
      { anime: anime(1, 2018) },
      { anime: anime(3, 2020, "movie", "2020-02-01") },
    ],
    edges: [
      { sourceId: id(1), targetId: id(2), relation: "sequel" },
      { sourceId: id(2), targetId: id(3), relation: "side_story" },
      { sourceId: id(1), targetId: id(4), relation: "spin_off" },
    ],
  };
  assert.deepEqual([...mainStoryIds(franchise)].sort(), [id(1), id(2)]);
  const { nodes } = layoutFranchise(franchise);
  assert.deepEqual(
    nodes.map((n) => n.anime.id),
    [id(1), id(4), id(3), id(2)],
  );
  assert.equal(nodes[0].y, nodes[3].y);
  assert.notEqual(nodes[2].y, nodes[3].y);
  assert.equal(mainStoryIds({ ...franchise, edges: [] }).size, 0);
});

test("franchise focus distinguishes immediate neighbours from the complete storyline and excludes filtered endpoints", () => {
  const franchise = {
    currentAnimeId: id(2),
    items: [1, 2, 3, 4, 5].map((n) => ({
      anime: { id: id(n), format: n === 4 ? "movie" : n === 5 ? "ova" : "tv" },
    })),
    edges: [
      { sourceId: id(1), targetId: id(2), relation: "sequel" },
      { sourceId: id(2), targetId: id(3), relation: "sequel" },
      { sourceId: id(2), targetId: id(4), relation: "side_story" },
      { sourceId: id(4), targetId: id(5), relation: "side_story" },
    ],
  };
  const point = franchiseFocus(franchise, { kind: "point", id: id(2) });
  assert.deepEqual([...point.ids].sort(), [id(1), id(2), id(3), id(4)]);
  assert.equal(point.edges.length, 3);
  const main = franchiseFocus(franchise, { kind: "type", type: "main" });
  assert.deepEqual([...main.ids].sort(), [id(1), id(2), id(3)]);
  assert.equal(main.edges.length, 2);
  const filtered = franchiseFocus(franchise, { kind: "point", id: id(2) }, ["movie"]);
  assert.equal(filtered.ids.has(id(4)), false);
  assert.equal(filtered.ids.has(id(5)), false);
  assert.equal(filtered.edges.length, 2);
  const noMain = franchiseFocus(franchise, { kind: "all" }, ["main"]);
  assert.deepEqual([...noMain.ids].sort(), [id(4), id(5)]);
  assert.equal(noMain.edges.length, 1);
  assert.equal(franchiseFocus(franchise, { kind: "all" }, ["main", "movie", "ova"]).ids.size, 0);
});
