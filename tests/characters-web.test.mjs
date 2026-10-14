import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { developmentAnime } from "../packages/database/dist/src/fixtures.js";

test(
  "character pages, anime cast and search preserve season roles and safely render provider text",
  { timeout: 60000 },
  async () => {
    const anime = { ...developmentAnime[0], format: "tv" };
    const second = {
      ...anime,
      id: "22222222-2222-4222-8222-222222222222",
      slug: "attack-on-titan-two",
      title: "Атака титанов 2",
      year: 2017,
    };
    const character = {
      id: "40882",
      slug: "40882-eren-yeager",
      name: "Эрен Йегер",
      originalName: "Eren Yeager",
      japaneseName: "エレン・イェーガー",
      aliases: ["Eren Jaeger"],
      image: "https://shikimori.io/system/characters/original/40882.jpg",
    };
    const detail = {
      ...character,
      description: "Биография героя.\n<script>character-xss</script>",
      sourceUrl: "https://shikimori.io/characters/40882-eren-yeager",
      voiceActors: [
        {
          id: "672",
          name: "Юки Кадзи",
          image: null,
          sourceUrl: "https://shikimori.io/people/672-yuuki-kaji",
        },
      ],
      appearances: [
        { anime, role: "main" },
        { anime: second, role: "supporting" },
      ],
    };
    const cast = [
      { ...character, role: "main" },
      ...Array.from({ length: 12 }, (_, index) => ({
        ...character,
        id: String(index + 100),
        slug: `${index + 100}-supporting-character`,
        name: `Персонаж ${index + 1}`,
        image: null,
        role: index === 11 ? "background" : "supporting",
      })),
    ];
    const fixtures = {
      "/api/availability": { active: false },
      [`/api/anime/${anime.slug}`]: anime,
      [`/api/anime/${anime.slug}/characters`]: { items: cast },
      [`/api/anime/${anime.slug}/franchise`]: {
        currentAnimeId: anime.id,
        items: [
          { anime, episodes: [] },
          { anime: second, episodes: [] },
        ],
        edges: [{ sourceId: anime.id, targetId: second.id, relation: "sequel" }],
        externalLinks: [{ sourceId: anime.id, anime: developmentAnime[1], relation: "character" }],
        characters: [
          {
            character,
            appearances: [
              { animeId: anime.id, role: "main" },
              { animeId: second.id, role: "supporting" },
            ],
          },
        ],
      },
      [`/api/characters/${character.slug}`]: detail,
      "/api/search?q=Eren": {
        query: "Eren",
        anime: [],
        characters: [character],
        people: [],
        genres: [],
        correction: null,
      },
      "/api/search?q=Eren+Yeager": {
        query: "Eren Yeager",
        anime: [{ ...anime, episodes: { total: 12, available: 12 }, watchProgress: null }],
        characters: [],
        people: [],
        genres: [],
        correction: null,
      },
      "/api/characters/search?q=Eren+Yeager": { items: [character] },
    };
    const api = createServer((request, response) => {
      const value = fixtures[request.url];
      response.writeHead(value ? 200 : 404, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value ?? {}));
    });
    await new Promise((resolve) => api.listen(18270, "127.0.0.1", resolve));
    const web = spawn(
      process.execPath,
      [
        path.resolve("apps/web/node_modules/next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "18271",
      ],
      {
        cwd: path.resolve("apps/web"),
        env: {
          ...process.env,
          NODE_ENV: "production",
          API_URL: "http://127.0.0.1:18270",
          SITE_URL: "http://localhost:18271",
          PUBLIC_INDEXING: "false",
          DEMO_CATALOG: "false",
        },
        stdio: "pipe",
        windowsHide: true,
      },
    );
    web.stdout.resume();
    let errors = "";
    web.stderr.on("data", (chunk) => {
      errors = (errors + chunk).slice(-4000);
    });
    const base = "http://127.0.0.1:18271";
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (web.exitCode !== null) throw new Error(`Website exited: ${errors}`);
        try {
          if ((await fetch(`${base}/robots.txt`)).ok) {
            ready = true;
            break;
          }
        } catch {
          /* Wait for the server to bind. */
        }
        await setTimeout(200);
      }
      assert.equal(ready, true, errors);

      const castPage = await fetch(`${base}/anime/${anime.slug}`);
      assert.equal(castPage.status, 200);
      const castHtml = await castPage.text();
      assert.match(castHtml, /id="anime-characters"/);
      assert.match(castHtml, /href="\/characters\/40882-eren-yeager"/);
      assert.match(castHtml, /Эрен Йегер/);
      assert.match(castHtml, /Главная роль/);
      assert.match(castHtml, /Второстепенная роль/);
      assert.match(castHtml, /Эпизодическая роль/);
      assert.match(castHtml, /aria-label="Персонажи: горизонтальная лента"/);
      assert.doesNotMatch(castHtml, /anime-characters-more/);
      assert.match(castHtml, /href="\/characters\/111-supporting-character"/);
      const graphPage = await fetch(`${base}/anime/${anime.slug}/franchise`);
      assert.equal(graphPage.status, 200);
      const graphHtml = await graphPage.text();
      assert.match(graphHtml, /aria-label="Другие франшизы"/);
      assert.ok(graphHtml.includes(`href="/anime/${developmentAnime[1].slug}/franchise"`));
      assert.match(graphHtml, /Общие персонажи/);

      const page = await fetch(`${base}/characters/${character.slug}`);
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.match(html, /<h1>Эрен Йегер<\/h1>/);
      assert.match(html, /Eren Yeager/);
      assert.match(html, /Eren Jaeger/);
      assert.match(html, /Юки Кадзи/);
      assert.match(html, /id="character-description"/);
      assert.doesNotMatch(html, /<details><summary>Читать описание/);
      assert.match(html, /aria-label="Разделы персонажа"/);
      assert.match(html, /href="#character-appearances"/);
      assert.match(html, /aria-label="Аниме с персонажем: горизонтальная лента"/);
      assert.match(html, /&lt;script&gt;character-xss&lt;\/script&gt;/);
      assert.equal(html.includes("<script>character-xss</script>"), false);
      assert.match(html, /href="\/anime\/attack-on-titan"/);
      assert.match(html, /href="\/anime\/attack-on-titan-two"/);
      assert.match(html, /href="\/anime\/attack-on-titan-two\/franchise"/);
      assert.match(html, /Главная роль/);
      assert.match(html, /Второстепенная роль/);
      assert.match(
        html,
        /rel="canonical" href="http:\/\/localhost:18271\/characters\/40882-eren-yeager"/,
      );
      assert.match(html, /<meta property="og:image"/);

      const results = await fetch(`${base}/search?q=Eren`);
      assert.equal(results.status, 200);
      const searchHtml = await results.text();
      assert.match(searchHtml, /aria-label="Персонажи"/);
      assert.match(searchHtml, /href="\/characters\/40882-eren-yeager"/);
      assert.equal(searchHtml.includes("Ничего не найдено."), false);
      const coldResults = await fetch(`${base}/search?q=Eren+Yeager`);
      assert.equal(coldResults.status, 200);
      assert.match(await coldResults.text(), /href="\/characters\/40882-eren-yeager"/);
      const castProxy = await fetch(`${base}/api/anime/${anime.slug}/characters`);
      assert.equal(castProxy.status, 200);
      assert.equal((await castProxy.json()).items.length, 13);
      const searchProxy = await fetch(`${base}/api/characters/search?q=Eren+Yeager`);
      assert.equal(searchProxy.status, 200);
      assert.equal((await searchProxy.json()).items[0].id, character.id);
      const profileProxy = await fetch(`${base}/api/characters/${character.slug}`);
      assert.equal(profileProxy.status, 200);
      assert.equal((await profileProxy.json()).id, character.id);
      const missing = await fetch(`${base}/characters/999-missing`);
      assert.equal(missing.status, 404);
      assert.match(await missing.text(), /Персонаж не найден/);
    } finally {
      web.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => web.once("exit", resolve)), setTimeout(2000)]);
      await new Promise((resolve) => api.close(resolve));
    }
  },
);
