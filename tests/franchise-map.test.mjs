import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { Buffer } from "node:buffer";

const moduleUrl = (name, replace = (source) => source) =>
  "data:text/javascript;base64," +
  Buffer.from(
    replace(
      stripTypeScriptTypes(readFileSync(`apps/web/lib/${name}.ts`, "utf8"), {
        mode: "transform",
        disableExperimentalWarning: true,
      }),
    ),
  ).toString("base64");
const graph = moduleUrl("franchise-graph");
const { franchiseMap } = await import(
  moduleUrl("franchise-map", (source) =>
    source.replace('"./franchise-graph"', JSON.stringify(graph)),
  )
);

const anime = (id, format, year) => ({ id, format, year, title: id, details: {} });
const franchise = {
  currentAnimeId: "s1",
  items: [
    anime("movie", "movie", 2024),
    anime("s2", "tv", 2026),
    anime("s1", "tv", 2023),
    anime("ova", "ova", 2025),
  ].map((item) => ({ anime: item, episodes: [] })),
  edges: [
    { sourceId: "s1", targetId: "s2", relation: "sequel" },
    { sourceId: "s2", targetId: "s1", relation: "prequel" },
    { sourceId: "s1", targetId: "movie", relation: "side_story" },
    { sourceId: "s1", targetId: "ova", relation: "side_story" },
  ],
};

test("the main story runs along the middle row and side parts branch above and below", () => {
  const map = franchiseMap(franchise);
  assert.deepEqual(
    map.nodes.map((node) => [node.anime.id, node.type]),
    [
      ["s1", "main"],
      ["movie", "movie"],
      ["ova", "ova"],
      ["s2", "main"],
    ],
  );
  const middle = map.nodes[0].y;
  assert.equal(map.nodes[3].y, middle);
  assert.ok(map.nodes[1].y < middle && map.nodes[2].y > middle);
  assert.ok(map.nodes.every((node, index) => index === 0 || node.x > map.nodes[index - 1].x));
});

test("each pair of parts is linked once and only sequels between main parts are main links", () => {
  const map = franchiseMap(franchise);
  assert.equal(map.edges.length, 3);
  const main = map.edges.filter((edge) => edge.main);
  assert.deepEqual(
    main.map((edge) => [edge.from.anime.id, edge.to.anime.id]),
    [["s1", "s2"]],
  );
});

test("hidden part types disappear together with their links", () => {
  const map = franchiseMap(franchise, new Set(["movie", "ova"]));
  assert.deepEqual(
    map.nodes.map((node) => node.anime.id),
    ["s1", "s2"],
  );
  assert.equal(map.edges.length, 1);
});
