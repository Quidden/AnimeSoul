import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../dist/app.js";
import { readConfig } from "../dist/config.js";
import {
  animeCharactersSchema,
  characterDetailsSchema,
  characterSearchSchema,
  franchiseSchema,
  globalSearchResponseSchema,
} from "@animesoul/contracts";
import {
  characterPlainText,
  parseShikimoriCharacters,
  parseShikimoriCharacterDetails,
  refreshAnimeCharacters,
  storeShikimoriCharacterDetails,
} from "../dist/catalog/shikimori-characters.js";
import { searchCharacters, characterDetails } from "../dist/catalog/characters.js";
import { globalSearch } from "../dist/catalog/global-search.js";
import { developmentAnime } from "@animesoul/database/fixtures";

const summary = {
  id: 40882,
  name: "Eren Yeager",
  russian: "Эрен Йегер",
  image: { original: "/system/characters/original/40882.jpg" },
  url: "/characters/40882-eren-yeager",
};
const details = {
  ...summary,
  japanese: "エレン・イェーガー",
  altname: "Eren Jaeger; Эрен Егер",
  description: "[b]Кадет[/b]\n[character=40881]Микаса[/character] &amp; Армин.",
  seyu: [
    {
      id: 672,
      name: "Yuuki Kaji",
      russian: "Юки Кадзи",
      image: { original: "/system/people/original/672.jpg" },
      url: "/people/672-yuuki-kaji",
    },
  ],
  animes: [
    { id: 16498, roles: ["Main"] },
    { id: 25777, roles: ["Supporting"] },
  ],
};
const config = readConfig({ NODE_ENV: "test", DEMO_CATALOG: "false" });

test("Shikimori cast excludes staff and keeps the strongest season-specific role", () => {
  const cast = parseShikimoriCharacters([
    { roles: ["Director"], person: { id: 672 } },
    { roles: ["Supporting"], character: summary },
    { roles: ["Main"], character: summary },
    { roles: ["Background"], character: summary },
  ]);
  assert.equal(cast.length, 1);
  assert.equal(cast[0].role, "main");
  assert.equal(
    parseShikimoriCharacters([
      { roles: ["Supporting"], character: summary },
      { roles: ["Background"], character: summary },
    ])[0].role,
    "supporting",
  );
  assert.equal(cast[0].slug, "40882-eren-yeager");
  assert.equal(cast[0].image, "https://shikimori.one/system/characters/original/40882.jpg");
  assert.throws(() => parseShikimoriCharacters({ error: "busy" }));
  assert.throws(() =>
    parseShikimoriCharacters([{ roles: ["Main"], character: { ...summary, id: "not-an-id" } }]),
  );
});

test("character details normalize markup, names, actors and exact anime roles safely", () => {
  const result = parseShikimoriCharacterDetails(details, "40882");
  assert.equal(result.description, "Кадет\nМикаса & Армин.");
  assert.deepEqual(result.aliases, ["Eren Jaeger", "Эрен Егер"]);
  assert.deepEqual(result.appearances, [
    { externalId: "16498", role: "main" },
    { externalId: "25777", role: "supporting" },
  ]);
  assert.equal(result.voiceActors[0].name, "Юки Кадзи");
  assert.equal(result.voiceActors[0].sourceUrl, "https://shikimori.one/people/672-yuuki-kaji");
  assert.equal(
    characterPlainText(
      "<script>alert(1)</script><p>Текст<br>ещё &#33;</p>[img]https://invalid[/img]",
    ),
    "Текст\nещё !",
  );
  assert.throws(() => parseShikimoriCharacterDetails(details, "123"), /identity mismatch/);
  const unsafe = parseShikimoriCharacterDetails(
    { ...details, url: "https://evil.example/", image: { original: "javascript:alert(1)" } },
    "40882",
  );
  assert.equal(unsafe.image, null);
  assert.equal(unsafe.sourceUrl, "https://shikimori.one/characters/40882");
});

test("demo HTTP characters are linked from season, profile, search and franchise", async (t) => {
  const app = await createApplication(readConfig({ NODE_ENV: "test", DEMO_CATALOG: "true" }));
  t.after(() => app.close());
  const server = app.getHttpAdapter().getInstance();
  const castResponse = await server.inject({
    method: "GET",
    url: "/api/anime/attack-on-titan/characters",
  });
  assert.equal(castResponse.statusCode, 200);
  const cast = animeCharactersSchema.parse(castResponse.json());
  assert.equal(cast.items[0].name, "Эрен Йегер");
  assert.equal(cast.items[0].role, "main");
  const characterResponse = await server.inject({
    method: "GET",
    url: `/api/characters/${cast.items[0].slug}`,
  });
  assert.equal(characterResponse.statusCode, 200);
  const character = characterDetailsSchema.parse(characterResponse.json());
  assert.equal(character.appearances[0].anime.slug, "attack-on-titan");
  const search = await server.inject({
    method: "GET",
    url: "/api/search?q=" + encodeURIComponent("Эрен Егер"),
  });
  assert.equal(globalSearchResponseSchema.parse(search.json()).characters[0].id, character.id);
  const characterSearch = await server.inject({
    method: "GET",
    url: "/api/characters/search?q=" + encodeURIComponent("Эрен"),
  });
  assert.equal(characterSearch.statusCode, 200);
  assert.equal(characterSearchSchema.parse(characterSearch.json()).items[0].id, character.id);
  const graph = franchiseSchema.parse(
    (await server.inject({ method: "GET", url: "/api/anime/attack-on-titan/franchise" })).json(),
  );
  assert.equal(graph.characters[0].character.id, character.id);
  assert.equal(graph.characters[0].appearances[0].animeId, character.appearances[0].anime.id);
  assert.equal(
    (await server.inject({ method: "GET", url: "/api/characters/missing" })).statusCode,
    404,
  );
  assert.equal(
    (await server.inject({ method: "GET", url: "/api/anime/missing/characters" })).statusCode,
    404,
  );
  assert.equal(
    (await server.inject({ method: "GET", url: "/api/characters/invalid%21" })).statusCode,
    404,
  );
});

test("cast refresh persists roles atomically and keeps cache during a provider outage", async (t) => {
  let fetchedAt = null,
    calls = 0,
    writes = 0;
  const database = {
    anime: {
      async findUnique() {
        return {
          charactersFetchedAt: fetchedAt,
          providers: [{ provider: "kodik-material", externalId: "shikimori:16498" }],
        };
      },
    },
    async $transaction(task) {
      return task({
        character: {
          async upsert() {
            writes++;
          },
        },
        animeCharacter: {
          async upsert(input) {
            assert.equal(input.create.role, "main");
            writes++;
          },
          async deleteMany(input) {
            assert.deepEqual(input.where.characterId.notIn, ["40882"]);
            writes++;
          },
        },
        anime: {
          async update(input) {
            fetchedAt = input.data.charactersFetchedAt;
            writes++;
          },
        },
      });
    },
  };
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (url) => {
    calls++;
    assert.equal(String(url), "https://shikimori.one/api/animes/16498/roles");
    return new Response(JSON.stringify([{ roles: ["Main"], character: summary }]));
  };
  assert.equal(await refreshAnimeCharacters(database, "anime-id"), true);
  assert.equal(writes, 4);
  assert.equal(await refreshAnimeCharacters(database, "anime-id"), true);
  assert.equal(calls, 1);
  fetchedAt = new Date(0);
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Provider outage");
  };
  assert.equal(await refreshAnimeCharacters(database, "anime-id"), false);
  assert.equal(await refreshAnimeCharacters(database, "anime-id"), false);
  assert.equal(calls, 2);
  assert.equal(writes, 4);
  assert.equal(fetchedAt.getTime(), 0);
});

test("detailed appearances reconcile exact provider IDs with canonical local seasons", async () => {
  const saved = [],
    removed = [];
  const database = {
    async $transaction(task) {
      return task({
        character: {
          async upsert(input) {
            assert.deepEqual(input.create.appearanceExternalIds, ["16498", "25777"]);
            return input.create;
          },
        },
        animeProvider: {
          async findMany(input) {
            assert.deepEqual(input.where.OR[0].externalId.in, ["16498", "25777"]);
            return [
              { animeId: "legacy-a", provider: "shikimori", externalId: "16498" },
              { animeId: "canonical-a", provider: "kodik-material", externalId: "shikimori:16498" },
              { animeId: "canonical-b", provider: "shikimori", externalId: "25777" },
            ];
          },
        },
        animeCharacter: {
          async upsert(input) {
            saved.push(input.create);
          },
          async deleteMany(input) {
            removed.push(input.where);
          },
        },
      });
    },
  };
  const result = await storeShikimoriCharacterDetails(database, details, "40882");
  assert.equal(result.name, "Эрен Йегер");
  assert.deepEqual(
    saved.map(({ animeId, role }) => [animeId, role]),
    [
      ["canonical-a", "main"],
      ["canonical-b", "supporting"],
    ],
  );
  assert.deepEqual(removed[0], {
    characterId: "40882",
    animeId: { notIn: ["canonical-a", "canonical-b"] },
  });
});

test("cached character search rechecks publication and detail routes hide unavailable characters", async () => {
  let visible = true;
  const character = {
    ...parseShikimoriCharacterDetails(details, "40882"),
    detailsFetchedAt: new Date(),
  };
  const database = {
    character: {
      async findMany(input) {
        assert.equal(input.where.appearances.some.anime.published, true);
        assert.deepEqual(input.where.appearances.some.anime.metadataProvider, { not: "legacy" });
        return visible ? [character] : [];
      },
      async findFirst(input) {
        assert.equal(input.where.appearances.some.anime.published, true);
        return null;
      },
    },
  };
  assert.equal((await searchCharacters(database, config, "Eren Jaeger"))[0].id, "40882");
  visible = false;
  assert.deepEqual(await searchCharacters(database, config, "Eren Jaeger"), []);
  assert.equal(await characterDetails(database, config, character.slug), null);
});

test("known characters remain searchable beyond the bounded fuzzy index", async () => {
  const character = parseShikimoriCharacterDetails(details, "40882");
  const index = Array.from({ length: 20000 }, (_, position) => ({
    ...character,
    id: String(position + 100000),
    slug: `${position + 100000}-other`,
    name: "Другой герой",
    originalName: "Other hero",
    japaneseName: "",
    aliases: [],
  }));
  const database = {
    character: {
      async findMany(input) {
        if (input.where.OR) return [character];
        if (input.where.id) return [character];
        return index;
      },
    },
  };
  const result = await searchCharacters(database, config, "Eren Yeager", { discover: false });
  assert.deepEqual(
    result.map((entry) => entry.id),
    ["40882"],
  );
});

test("cold character lookup refuses profiles with only hidden appearances", async (t) => {
  let calls = 0,
    writes = 0;
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (url) => {
    calls++;
    return new Response(JSON.stringify(String(url).includes("/search?") ? [summary] : details));
  };
  const database = {
    character: {
      async findMany() {
        return [];
      },
      async findUnique() {
        return null;
      },
    },
    anime: {
      async findFirst(input) {
        assert.equal(input.where.published, true);
        assert.equal(input.where.isDevelopment, false);
        assert.deepEqual(input.where.providers.some.OR[0].externalId.in, ["16498", "25777"]);
        return null;
      },
    },
    async $transaction() {
      writes++;
      throw new Error("Hidden character must not be persisted");
    },
  };
  // Production rules are used directly; the config parser separately requires production credentials.
  const production = { ...config, NODE_ENV: "production" };
  assert.deepEqual(await searchCharacters(database, production, "Eren"), []);
  assert.equal(calls, 2);
  assert.equal(writes, 0);
  assert.deepEqual(await searchCharacters(database, production, "Eren"), []);
  assert.equal(calls, 2);
});

test("existing anime search remains local when character index has no matching hero", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => {
    throw new Error("Anime search must remain local");
  };
  const anime = {
    ...developmentAnime[0],
    published: true,
    isDevelopment: false,
    metadataProvider: "kodik",
  };
  const database = {
    anime: {
      async findMany() {
        return [anime];
      },
    },
    userProfile: {
      async findMany() {
        return [];
      },
    },
    character: {
      async findMany() {
        return [];
      },
    },
    libraryItem: {
      async groupBy() {
        return [];
      },
    },
    episode: {
      async groupBy() {
        return [];
      },
    },
    async $queryRaw() {
      return [];
    },
  };
  const response = await globalSearch(
    database,
    { ...config, NODE_ENV: "development" },
    { q: "Атака титанов" },
  );
  assert.equal(response.anime[0].slug, "attack-on-titan");
  assert.deepEqual(response.characters, []);
});

test("cold character search keeps provider relevance ahead of alphabetical namesakes", async (t) => {
  let calls = 0,
    saved = null;
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (url) => {
    calls++;
    const first = { ...summary, id: 100, name: "Eren", russian: "Эрен" };
    const namesake = { ...summary, id: 101, name: "Eren Alpha", russian: "Эрен Альфа" };
    if (String(url).includes("/search?"))
      return new Response(JSON.stringify([first, summary, namesake]));
    if (String(url).endsWith("/characters/100"))
      return new Response(JSON.stringify({ ...first, animes: [] }));
    assert.equal(String(url), "https://shikimori.one/api/characters/40882");
    return new Response(JSON.stringify(details));
  };
  const database = {
    character: {
      async findMany() {
        return saved ? [saved] : [];
      },
      async findUnique() {
        return null;
      },
    },
    anime: {
      async findFirst() {
        return { id: "canonical-a" };
      },
    },
    async $transaction(task) {
      return task({
        character: {
          async upsert(input) {
            saved = input.create;
            return saved;
          },
        },
        animeProvider: {
          async findMany() {
            return [
              { animeId: "canonical-a", provider: "kodik-material", externalId: "shikimori:16498" },
            ];
          },
        },
        animeCharacter: {
          async upsert(input) {
            assert.equal(input.create.animeId, "canonical-a");
          },
          async deleteMany() {},
        },
      });
    },
  };
  const response = await searchCharacters(database, { ...config, NODE_ENV: "development" }, "Eren");
  assert.equal(response[0].slug, "40882-eren-yeager");
  assert.equal(calls, 3);
  assert.equal(saved.detailsFetchedAt instanceof Date, true);
});
