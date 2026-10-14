import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/franchise-graph.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const {
  layoutFranchise,
  franchiseFocus,
  franchiseCast,
  mergeFranchiseCast,
  mergeFranchiseCharacter,
} = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const anime = (id, format, year, details = {}) => ({ id, format, year, title: id, details });
const franchise = {
  currentAnimeId: "second",
  items: [
    { anime: anime("second", "tv", 2024, { airedAt: "2024-10-01" }) },
    { anime: anime("first", "tv", 2024, { airedAt: "2024-01-01" }) },
    { anime: anime("movie", "movie", 2024, { airedAt: "2024-06-01" }) },
    { anime: anime("ova", "ova", 2025) },
  ],
  edges: [
    { sourceId: "first", targetId: "second", relation: "sequel" },
    { sourceId: "second", targetId: "movie", relation: "side_story" },
  ],
  characters: [
    {
      character: { id: "shared", name: "Ая", slug: "aya" },
      appearances: [
        { animeId: "first", role: "main" },
        { animeId: "second", role: "supporting" },
      ],
    },
    {
      character: { id: "lead", name: "Юки", slug: "yuki" },
      appearances: [{ animeId: "second", role: "main" }],
    },
    {
      character: { id: "film", name: "Ито", slug: "ito" },
      appearances: [{ animeId: "movie", role: "main" }],
    },
    {
      character: { id: "extra", name: "Аки", slug: "aki" },
      appearances: [{ animeId: "second", role: "background" }],
    },
  ],
};

test("poster graph keeps premiere order and enough room for poster labels across compact format lanes", () => {
  const { nodes, width, height } = layoutFranchise(franchise);
  assert.deepEqual(
    nodes.map((node) => node.anime.id),
    ["first", "movie", "second", "ova"],
  );
  assert.equal(nodes.find((node) => node.anime.id === "first").type, "main");
  assert.equal(nodes.find((node) => node.anime.id === "second").type, "main");
  for (const left of nodes) {
    assert.ok(left.x >= 70 && left.x + 70 <= width);
    assert.ok(left.y >= 75 && left.y + 150 <= height);
    for (const right of nodes) {
      if (left === right) continue;
      assert.ok(Math.abs(left.x - right.x) >= 150 || Math.abs(left.y - right.y) >= 220);
    }
  }
  assert.equal(new Set(nodes.map((node) => node.y)).size, 3);
});

test("cast uses the selected season's roles and retains all appearances for cross-season graph edges", () => {
  const cast = franchiseCast(franchise, "second");
  assert.deepEqual(
    cast.map((entry) => [entry.character.id, entry.role]),
    [
      ["lead", "main"],
      ["shared", "supporting"],
      ["extra", "background"],
    ],
  );
  assert.deepEqual(
    cast.find((entry) => entry.character.id === "shared").appearances,
    franchise.characters[0].appearances,
  );
  assert.deepEqual(
    franchiseCast(franchise, "first").map((entry) => [entry.character.id, entry.role]),
    [["shared", "main"]],
  );
  assert.deepEqual(franchiseCast(franchise, "ova"), []);
  assert.deepEqual(franchiseCast({ ...franchise, characters: undefined }, "second"), []);
});

test("poster selection and format switches preserve relationship filtering", () => {
  const selected = franchiseFocus(franchise, { kind: "point", id: "second" }, ["movie"]);
  assert.deepEqual([...selected.ids], ["first", "second"]);
  assert.equal(selected.edges.length, 1);
  const main = franchiseFocus(franchise, { kind: "type", type: "main" });
  assert.deepEqual([...main.ids], ["second", "first"]);
  assert.deepEqual(main.edges, [franchise.edges[0]]);
});

test("character selection highlights its appearances, respects hidden types and keeps unrelated anime dimmed", () => {
  const selected = franchiseFocus(franchise, { kind: "character", id: "shared" });
  assert.deepEqual([...selected.ids], ["first", "second"]);
  assert.deepEqual(selected.edges, []);
  assert.deepEqual(
    [...franchiseFocus(franchise, { kind: "character", id: "film" }, ["movie"]).ids],
    [],
  );
  assert.deepEqual([...franchiseFocus(franchise, { kind: "character", id: "missing" }).ids], []);
});

test("loaded character details extend links only inside the current franchise and update exact roles", () => {
  const snapshot = JSON.parse(JSON.stringify(franchise));
  const merged = mergeFranchiseCharacter(franchise, { id: "shared", name: "Ая", slug: "aya" }, [
    { animeId: "second", role: "main" },
    { animeId: "movie", role: "supporting" },
    { animeId: "outside", role: "main" },
  ]);
  assert.deepEqual(franchise, snapshot);
  assert.deepEqual(merged.characters.find((entry) => entry.character.id === "shared").appearances, [
    { animeId: "first", role: "main" },
    { animeId: "second", role: "main" },
    { animeId: "movie", role: "supporting" },
  ]);
  assert.deepEqual(
    [...franchiseFocus(merged, { kind: "character", id: "shared" }).ids],
    ["first", "second", "movie"],
  );
  assert.deepEqual(
    franchiseCast(merged, "movie").map((entry) => entry.character.id),
    ["film", "shared"],
  );
});

test("a fetched cast replaces exact season roles, preserves other seasons and introduces cold characters", () => {
  const snapshot = JSON.parse(JSON.stringify(franchise));
  const fetched = [
    { id: "shared", slug: "aya", name: "Обновлённая Ая", role: "main" },
    { id: "cold", slug: "new-hero", name: "Новый герой", role: "supporting" },
  ];
  const merged = mergeFranchiseCast(franchise, "second", fetched);
  assert.deepEqual(franchise, snapshot);
  assert.equal(merged.items, franchise.items);
  assert.equal(merged.edges, franchise.edges);
  assert.deepEqual(
    franchiseCast(merged, "second").map((entry) => [entry.character.id, entry.role]),
    [
      ["shared", "main"],
      ["cold", "supporting"],
    ],
  );
  assert.deepEqual(merged.characters.find((entry) => entry.character.id === "shared").appearances, [
    { animeId: "first", role: "main" },
    { animeId: "second", role: "main" },
  ]);
  assert.equal(
    merged.characters.find((entry) => entry.character.id === "shared").character.name,
    "Обновлённая Ая",
  );
  assert.deepEqual(
    franchiseCast(merged, "movie").map((entry) => entry.character.id),
    ["film"],
  );
  const refreshed = mergeFranchiseCast(merged, "second", []);
  assert.deepEqual(franchiseCast(refreshed, "second"), []);
  assert.deepEqual(
    franchiseCast(refreshed, "first").map((entry) => entry.character.id),
    ["shared"],
  );
  assert.equal(
    refreshed.characters.some((entry) => entry.character.id === "cold"),
    false,
  );
});
