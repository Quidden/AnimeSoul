import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { createServer } from "node:http";
import { URLSearchParams } from "node:url";
import { developmentAnime } from "../packages/database/dist/src/fixtures.js";

test("anime and episode SSR select the opened franchise part, preserve canonical URLs and validate timecodes", async () => {
  const anime = {
      ...developmentAnime[0],
      format: "tv",
      poster: "https://shikimori.io/system/animes/original/fixture.jpg",
      details: {
        duration: 24,
        trailerUrls: ["https://youtu.be/7IQM5EPf2Y0"],
        screenshots: ["https://shikimori.io/system/screenshots/original/fixture.jpg"],
      },
    },
    episode = {
      id: "11111111-1111-4111-8111-111111111111",
      animeId: anime.id,
      season: "1",
      number: "1",
      duration: 120,
    };
  const second = {
    ...anime,
    id: "22222222-2222-4222-8222-222222222222",
    slug: "attack-on-titan-season-two",
    title: "Атака титанов 2",
    year: 2017,
    format: "tv",
  };
  const third = {
    ...anime,
    id: "33333333-3333-4333-8333-333333333333",
    slug: "attack-on-titan-season-three",
    title: "Атака титанов 3",
    year: 2018,
    format: "tv",
  };
  const secondEpisode = {
    ...episode,
    id: "44444444-4444-4444-8444-444444444444",
    animeId: second.id,
  };
  const thirdEpisode = {
    ...episode,
    id: "55555555-5555-4555-8555-555555555555",
    animeId: third.id,
  };
  const items = [
    { anime, episodes: [episode] },
    { anime: second, episodes: [secondEpisode] },
    { anime: third, episodes: [thirdEpisode] },
  ];
  const fixtures = {
    [`/api/anime/${anime.slug}`]: anime,
    [`/api/anime/${anime.slug}/episodes/${episode.id}`]: episode,
    [`/api/anime/${anime.slug}/episodes`]: { episodes: [episode] },
    ...Object.fromEntries(
      items.flatMap((part) => [
        [`/api/anime/${part.anime.slug}`, part.anime],
        [
          `/api/anime/${part.anime.slug}/franchise`,
          {
            currentAnimeId: part.anime.id,
            items,
            edges: [
              { sourceId: anime.id, targetId: second.id, relation: "sequel" },
              { sourceId: second.id, targetId: third.id, relation: "sequel" },
            ],
          },
        ],
        [`/api/anime/${part.anime.slug}/episodes/${part.episodes[0].id}`, part.episodes[0]],
      ]),
    ),
  };
  const api = createServer((req, res) => {
    if (req.url === "/api/availability") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ active: false }));
      return;
    }

    const value = fixtures[req.url];
    res.writeHead(value ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value ?? {}));
  });
  await new Promise((resolve) => api.listen(18030, "127.0.0.1", resolve));
  const web = spawn(
    process.execPath,
    [
      path.resolve("apps/web/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "18031",
    ],
    {
      cwd: path.resolve("apps/web"),
      env: {
        ...process.env,
        NODE_ENV: "production",
        API_URL: "http://127.0.0.1:18030",
        SITE_URL: "http://localhost:18031",
        PUBLIC_INDEXING: "false",
        DEMO_CATALOG: "false",
      },
      stdio: "pipe",
      windowsHide: true,
    },
  );
  web.stdout.resume();
  web.stderr.resume();
  try {
    await waitFor("http://127.0.0.1:18031/robots.txt", web);
    const base = `http://127.0.0.1:18031/anime/${anime.slug}/episodes/${episode.id}`;
    const response = await fetch(base + "?t=42");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<h1[^>]*>.*Атака титанов.*серия.*1/);
    assert.match(html, /"@type":"TVEpisode"/);
    assert.match(html, /"@type":"TVSeries"/);
    assert.match(html, /"@type":"BreadcrumbList"/);
    assert.match(html, /<meta property="og:image"/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
    assert.equal(canonical?.[1], base.replace("127.0.0.1", "localhost"));
    assert.match(html, /noindex/);
    assert.equal(html.includes("watchedSeconds"), false);
    assert.equal(html.includes("csrfToken"), false);
    assert.ok(
      html.indexOf('aria-label="Разделы аниме"') < html.indexOf('class="watch-anime-hero"'),
    );
    assert.ok(html.indexOf('id="anime-screenshots"') < html.indexOf('id="anime-watch"'));
    assert.ok(html.indexOf('id="anime-episodes"') < html.indexOf('id="anime-comments"'));
    assert.match(html, /<iframe[^>]*src="https:\/\/www.youtube-nocookie.com\/embed\/7IQM5EPf2Y0"/);
    assert.match(html, /aria-label="Увеличить кадр 1"/);
    assert.equal(html.includes('id="profile-posts"'), false);
    assert.equal(html.includes('aria-label="Показывать части франшизы"'), false);
    const community = await fetch(`http://127.0.0.1:18031/anime/${anime.slug}/community`);
    assert.equal(community.status, 200);
    const discussion = await community.text();
    assert.match(discussion, /Публикации и обсуждения/);
    assert.ok(discussion.includes('id="profile-posts"'));
    assert.match(discussion, /aria-label="Разделы аниме"/);
    assert.ok(discussion.includes(`href="/anime/${anime.slug}#anime-watch"`));
    const map = await fetch(`http://127.0.0.1:18031/anime/${anime.slug}/franchise`);
    assert.equal(map.status, 200);
    const mapHtml = await map.text();
    assert.match(mapHtml, /Граф связей франшизы/);
    assert.match(mapHtml, /aria-label="Разделы аниме"/);
    assert.match(mapHtml, /Легенда и фильтры карты/);
    assert.match(mapHtml, /data-relation="sequel"/);
    assert.ok(mapHtml.includes(`href="/anime/${anime.slug}#anime-episodes"`));
    assert.match(html, new RegExp(`href="/anime/${second.slug}#anime-watch"`));
    assert.match(html, new RegExp(`href="/anime/${third.slug}#anime-watch"`));
    assert.match(
      html,
      new RegExp(
        `<a(?=[^>]*href="/anime/${anime.slug}/episodes/${episode.id}#anime-watch")(?=[^>]*aria-current="page")[^>]*>`,
      ),
    );
    for (const part of [second, third]) {
      const page = await fetch(`http://127.0.0.1:18031/anime/${part.slug}`);
      assert.equal(page.status, 200);
      const body = await page.text();
      assert.ok(body.includes(`<h1>${part.title}</h1>`));
      assert.match(
        body,
        new RegExp(
          `<a(?=[^>]*href="/anime/${part.slug}#anime-watch")(?=[^>]*aria-current="page")[^>]*>`,
        ),
      );
      for (const other of items)
        assert.ok(body.includes(`href="/anime/${other.anime.slug}#anime-watch"`));
      assert.match(
        body,
        new RegExp(`rel="canonical" href="http://localhost:18031/anime/${part.slug}"`),
      );
      const openedEpisode = items.find((item) => item.anime.id === part.id).episodes[0];
      const episodePage = await fetch(
        `http://127.0.0.1:18031/anime/${part.slug}/episodes/${openedEpisode.id}`,
      );
      assert.equal(episodePage.status, 200);
      const episodeBody = await episodePage.text();
      assert.match(episodeBody, new RegExp(`<title>${part.title} — серия 1`));
      assert.match(
        episodeBody,
        new RegExp(
          `<a(?=[^>]*href="/anime/${part.slug}#anime-watch")(?=[^>]*aria-current="page")[^>]*>`,
        ),
      );
    }
    for (const query of ["?t=-1", "?t=NaN", "?t=121", "?t=2&t=3"])
      assert.equal((await fetch(base + query)).status, 404, query);
    assert.equal((await fetch(base.replace(episode.id, "invalid"))).status, 404);
    assert.equal(
      (await fetch(base.replace(episode.id, "22222222-2222-4222-8222-222222222222"))).status,
      404,
    );
    const shard = await fetch("http://127.0.0.1:18031/episodes/sitemap/0.xml");
    assert.equal(shard.status, 200);
    assert.equal((await shard.text()).includes("<url>"), false);
    const index = await fetch("http://127.0.0.1:18031/episodes/sitemap-index.xml");
    assert.equal(index.status, 200);
    assert.equal((await index.text()).includes("<sitemap>"), false);
  } finally {
    web.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => web.once("exit", resolve)), setTimeout(2000)]);
    await new Promise((resolve) => api.close(resolve));
  }
});

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error("Preview service exited.");
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* Wait for startup. */
    }
    await setTimeout(200);
  }
  throw new Error("Preview service did not become ready.");
}

test("Unicode profile routes enforce viewer privacy without private metadata or JSON-LD", async () => {
  const username = "Тест_Юки",
    encoded = encodeURIComponent(username);
  const publicView = {
    id: "11111111-1111-4111-8111-111111111111",
    username,
    indexable: true,
    avatar: null,
    banner: null,
    badge: null,
    presence: "offline",
    about: "PUBLIC_PROFILE_ABOUT",
  };
  const api = createServer((req, res) => {
    if (req.url === "/api/availability") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ active: false }));
      return;
    }

    const publicPath = "/api/profiles/" + encoded,
      privatePath = "/api/account/profiles/" + encoded;
    const value =
      req.url === publicPath
        ? publicView
        : req.url === privatePath &&
            req.headers.cookie === "animesoul_web_session=" + "a".repeat(43)
          ? { ...publicView, about: "FRIEND_PRIVATE_ABOUT" }
          : undefined;
    res.writeHead(value ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value ?? {}));
  });
  await new Promise((resolve) => api.listen(18040, "127.0.0.1", resolve));
  const web = spawn(
    process.execPath,
    [
      path.resolve("apps/web/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "18041",
    ],
    {
      cwd: path.resolve("apps/web"),
      env: {
        ...process.env,
        NODE_ENV: "production",
        API_URL: "http://127.0.0.1:18040",
        SITE_URL: "https://anime.example",
        PUBLIC_INDEXING: "true",
        DEMO_CATALOG: "false",
      },
      stdio: "pipe",
      windowsHide: true,
    },
  );
  web.stdout.resume();
  web.stderr.resume();
  try {
    await waitFor("http://127.0.0.1:18041/robots.txt", web);
    const address = "http://127.0.0.1:18041/users/" + encoded;
    const guest = await fetch(address);
    assert.equal(guest.status, 200);
    const guestHtml = await guest.text();
    assert.match(guestHtml, /<h1[^>]*>Тест_Юки<\/h1>/);
    assert.equal(guestHtml.includes("FRIEND_PRIVATE_ABOUT"), false);
    assert.match(guestHtml, /"@type":"ProfilePage"/);
    const friend = await fetch(address, {
      headers: { Cookie: "animesoul_web_session=" + "a".repeat(43) },
    });
    assert.equal(friend.status, 200);
    const html = await friend.text();
    assert.equal(html.includes("FRIEND_PRIVATE_ABOUT"), true);
    assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
    for (const tag of html.match(/<meta[^>]*>/g) ?? [])
      assert.equal(tag.includes("FRIEND_PRIVATE_ABOUT"), false);
    for (const jsonld of html.match(/<script type="application\/ld\+json">.*?<\/script>/g) ?? []) {
      assert.equal(jsonld.includes("FRIEND_PRIVATE_ABOUT"), false);
      assert.equal(jsonld.includes("PUBLIC_PROFILE_ABOUT"), true);
    }
    const blocked = await fetch(address, {
      headers: { Cookie: "animesoul_web_session=" + "b".repeat(43) },
    });
    assert.equal(blocked.status, 404);
    assert.equal((await blocked.text()).includes("FRIEND_PRIVATE_ABOUT"), false);
    assert.equal((await fetch("http://127.0.0.1:18041/users/%252F")).status, 404);
  } finally {
    web.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => web.once("exit", resolve)), setTimeout(2000)]);
    await new Promise((resolve) => api.close(resolve));
  }
});
test("genre pages decode route names before filtering, validation and canonical URLs", async () => {
  const genres = [
    "Гонки",
    "Психологическое",
    "Боевые искусства",
    "Идолы (Жен.)",
    "CGDCT",
    "100% жанр",
  ];
  const requests = [];
  const api = createServer((req, res) => {
    if (req.url === "/api/availability") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ active: false }));
      return;
    }

    const url = new URL(req.url, "http://fixture");
    if (url.pathname !== "/api/catalog") {
      res.writeHead(404).end();
      return;
    }
    const genre = url.searchParams.get("genre");
    const page = Number(url.searchParams.get("page") ?? 1);
    requests.push({ genre, page });
    const matched = genres.includes(genre);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        items: matched ? [{ ...developmentAnime[0], genres: [genre] }] : [],
        source: "development",
        total: matched ? 61 : 0,
        page,
        pageSize: 60,
        pages: matched ? 2 : 1,
        genres,
      }),
    );
  });
  await new Promise((resolve) => api.listen(18050, "127.0.0.1", resolve));
  const web = spawn(
    process.execPath,
    [
      path.resolve("apps/web/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "18051",
    ],
    {
      cwd: path.resolve("apps/web"),
      env: {
        ...process.env,
        NODE_ENV: "production",
        API_URL: "http://127.0.0.1:18050",
        SITE_URL: "https://anime.example",
        PUBLIC_INDEXING: "true",
        DEMO_CATALOG: "false",
      },
      stdio: "pipe",
      windowsHide: true,
    },
  );
  web.stdout.resume();
  web.stderr.resume();
  try {
    const base = "http://127.0.0.1:18051";
    await waitFor(base + "/robots.txt", web);
    for (const genre of genres) {
      requests.length = 0;
      const route = "/catalog/genres/" + encodeURIComponent(genre);
      const response = await fetch(base + route);
      assert.equal(response.status, 200, genre);
      const html = await response.text();
      assert.ok(html.includes(`<h1>${genre}</h1>`), genre);
      assert.ok(
        html.includes(`<title>${genre} — аниме`),
        html.match(/<title>.*?<\/title>/)?.[0] ?? genre,
      );
      assert.match(html, /Найдено: 61/);
      assert.ok(html.includes(`href="/anime/${developmentAnime[0].slug}"`), genre);
      assert.ok(html.includes(`href="${route}"`), "Card genre link preserves encoding");
      assert.ok(html.includes(`action="${route}"`), "Filter form preserves encoding");
      assert.ok(html.includes(`<option selected="">${genre}</option>`), genre);
      const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
      assert.equal(canonical?.[1], "https://anime.example" + route, genre);
      const pagination = html.match(/<nav[^>]*class="catalog-pagination"[^>]*>(.*?)<\/nav>/s);
      const href = pagination?.[1].match(/href="([^"]+)"/)?.[1].replaceAll("&amp;", "&");
      assert.ok(href, "A second page is available");
      const nextPage = new URL(href, base);
      assert.equal(nextPage.pathname, route);
      assert.equal(nextPage.searchParams.get("genre"), genre);
      assert.equal(nextPage.searchParams.get("page"), "2");
      assert.equal((await fetch(nextPage)).status, 200);
      assert.deepEqual(requests, [
        { genre, page: 1 },
        { genre, page: 2 },
      ]);
    }
    const route = "/catalog/genres/" + encodeURIComponent("Гонки");
    const changed = await fetch(
      base +
        route +
        "?" +
        new URLSearchParams({ genre: "Боевые искусства", sort: "rating", from: "2000" }),
    );
    assert.equal(changed.status, 200);
    assert.equal(changed.redirected, true);
    const changedUrl = new URL(changed.url);
    assert.equal(changedUrl.pathname, "/catalog/genres/" + encodeURIComponent("Боевые искусства"));
    assert.equal(changedUrl.searchParams.get("sort"), "rating");
    assert.equal(changedUrl.searchParams.get("from"), "2000");
    assert.ok((await changed.text()).includes("<h1>Боевые искусства</h1>"));
    const cleared = await fetch(base + route + "?genre=&sort=rating");
    assert.equal(cleared.status, 200);
    assert.equal(cleared.url, base + "/catalog/all?sort=rating");
    for (const invalid of [" ", "я".repeat(101)])
      assert.equal(
        (await fetch(base + "/catalog/genres/" + encodeURIComponent(invalid))).status,
        404,
      );
  } finally {
    web.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => web.once("exit", resolve)), setTimeout(2000)]);
    await new Promise((resolve) => api.close(resolve));
  }
});

test("compiled HTML contains SEO content and excludes hidden profile data", async () => {
  const root = process.cwd();
  const env = {
    ...process.env,
    API_PORT: "18020",
    API_HOST: "127.0.0.1",
    API_URL: "http://127.0.0.1:18020",
    SITE_URL: "http://localhost:18021",
    PUBLIC_INDEXING: "false",
    DEMO_CATALOG: "true",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  delete env.DATABASE_URL;
  const api = spawn(process.execPath, ["apps/api/dist/main.js"], {
    env: { ...env, NODE_ENV: "test" },
    stdio: "pipe",
  });
  const children = [api];
  const errors = [];
  api.stderr.on("data", (chunk) => errors.push(chunk.toString()));
  api.stdout.resume();
  try {
    await waitFor("http://127.0.0.1:18020/api/health", api);
    for (const [name, port] of [
      ["web", "18021"],
      ["admin", "18022"],
    ]) {
      const child = spawn(
        process.execPath,
        [
          path.resolve(root, "apps/" + name + "/node_modules/next/dist/bin/next"),
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          port,
        ],
        {
          cwd: path.join(root, "apps", name),
          env: { ...env, NODE_ENV: "production" },
          stdio: "pipe",
        },
      );
      children.push(child);
      child.stdout.resume();
      child.stderr.on("data", (chunk) => errors.push(chunk.toString()));
      await waitFor("http://127.0.0.1:" + port, child);
    }
    const home = await fetch("http://127.0.0.1:18021/");
    assert.equal(home.status, 200);
    const homeHtml = await home.text();
    assert.match(homeHtml, /<a[^>]*class="home-cinema-link"[^>]*>/);
    assert.match(homeHtml, /class="home-cinema-(?:poster|placeholder)"/);
    assert.match(homeHtml, /id="home-watching-title"/);
    assert.match(homeHtml, /id="home-popular-title"/);
    assert.ok(homeHtml.indexOf("home-cinema-hero") < homeHtml.indexOf("home-watching-title"));
    assert.ok(homeHtml.indexOf("home-watching-title") < homeHtml.indexOf("home-popular-title"));
    const response = await fetch("http://127.0.0.1:18021/anime/attack-on-titan");
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /<h1[^>]*>Атака титанов<\/h1>/);
    assert.match(html, /Shingeki no Kyojin/);
    assert.match(html, /rel="canonical"[^>]*attack-on-titan/);
    assert.match(html, /application\/ld\+json/);
    assert.match(html, /noindex/);
    const profile = await (await fetch("http://127.0.0.1:18021/users/soul")).text();
    assert.match(profile, /Любимое аниме/);
    assert.match(profile, /Не в сети/);
    assert.equal(profile.includes("На тихий вечер"), false);
    assert.equal(profile.includes("Личные оценки"), false);
    const profilePreview = await fetch("http://127.0.0.1:18021/api/profiles/soul");
    assert.equal(profilePreview.status, 200);
    assert.match(profilePreview.headers.get("cache-control"), /no-store/);
    assert.equal(profilePreview.headers.get("x-robots-tag"), "noindex, nofollow");
    const profilePreviewBody = await profilePreview.json();
    assert.equal(profilePreviewBody.username, "soul");
    assert.equal(profilePreviewBody.presence, "offline");
    assert.equal(profilePreviewBody.folders, undefined);
    assert.equal(profilePreviewBody.ratings, undefined);
    for (const username of ["invalid!", "does-not-exist"])
      assert.equal(
        (await fetch("http://127.0.0.1:18021/api/profiles/" + encodeURIComponent(username))).status,
        404,
      );
    const suggestions = await fetch("http://127.0.0.1:18021/api/search?q=AOT");
    assert.equal(suggestions.status, 200);
    assert.match(suggestions.headers.get("cache-control"), /no-store/);
    const suggestionsBody = await suggestions.json();
    assert.equal(suggestionsBody.anime[0]?.slug, "attack-on-titan");
    assert.equal(suggestionsBody.anime[0]?.watchProgress, null);
    assert.ok(suggestionsBody.anime[0]?.episodes);
    const search = await fetch("http://127.0.0.1:18021/search?q=AOT");
    assert.equal(search.status, 200);
    const searchHtml = await search.text();
    assert.match(searchHtml, /Результаты: AOT/);
    assert.match(searchHtml, /href="\/anime\/attack-on-titan"/);
    assert.match(searchHtml, /search-episode-count/);
    assert.match(searchHtml, /Число серий пока неизвестно/);
    assert.doesNotMatch(searchHtml, /Не смотрели/);
    assert.match(searchHtml, /<meta name="robots" content="noindex, nofollow"/);
    assert.match(searchHtml, /<link rel="canonical" href="http:\/\/localhost:18021\/search"/);
    const settingsHtml = await (
      await fetch("http://127.0.0.1:18021/search?" + new URLSearchParams({ q: "приватность" }))
    ).text();
    assert.match(settingsHtml, /href="\/account#privacy-settings"/);
    const robots = await (await fetch("http://127.0.0.1:18021/robots.txt")).text();
    assert.match(robots, /Disallow: \//);
    const sitemap = await (await fetch("http://127.0.0.1:18021/sitemap.xml")).text();
    assert.equal(sitemap.includes("<url>"), false);
    const callback = await fetch(
      "http://127.0.0.1:18021/api/auth/google/callback?state=invalid&code=invalid",
      { redirect: "manual" },
    );
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get("referrer-policy"), "no-referrer");
    assert.equal(
      callback.headers.get("location"),
      "http://localhost:18021/account?oauth=cancelled",
    );
    assert.match(callback.headers.get("set-cookie"), /animesoul_oauth=;.*Max-Age=0/);
    assert.equal((await fetch("http://127.0.0.1:18021/anime/does-not-exist")).status, 404);
    const admin = await fetch("http://127.0.0.1:18022");
    assert.equal(admin.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.match(await admin.text(), /Административный доступ закрыт/);
  } catch (error) {
    throw new Error(String(error) + "\n" + errors.join("\n"), { cause: error });
  } finally {
    for (const child of children) child.kill("SIGTERM");
    await Promise.all(
      children.map((child) =>
        child.exitCode !== null
          ? Promise.resolve()
          : new Promise((resolve) => child.once("exit", resolve)),
      ),
    );
  }
});
