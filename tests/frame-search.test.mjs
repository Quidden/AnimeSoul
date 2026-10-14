import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { CatalogService } from "../apps/api/dist/catalog/catalog.service.js";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import {
  FrameSearchService,
  prepareSearchFrame,
  selectFrameEpisode,
} from "../apps/api/dist/catalog/frame-search.service.js";
import { frameSearchLimits, tracePreviewUrl } from "../packages/contracts/dist/index.js";

const requireApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { default: sharp } = await import(pathToFileURL(requireApi.resolve("sharp")));
const headers = {
  origin: "http://localhost:8021",
  "x-animesoul-request": "1",
  "content-type": "application/octet-stream",
};
const image = (format = "png", width = 24, height = 24) =>
  sharp({ create: { width, height, channels: 4, background: "#ad8ed1" } })
    .toFormat(format)
    .toBuffer();
const match = (id = 1, similarity = 0.95, title = "Sousou no Frieren") => ({
  anilist: {
    id,
    title: { romaji: title, english: null, native: null },
    synonyms: [],
    isAdult: false,
  },
  episode: 2,
  from: 62,
  to: 63,
  at: 62.5,
  similarity,
  image: "https://api.trace.moe/image/token",
  video: "https://api.trace.moe/video/token",
  filename: "private-provider-filename",
});
const provider = (result) => Response.json({ error: "", result });
const service = (fetcher, catalog = { matchFrameTitles: async () => [] }) =>
  new FrameSearchService(
    readConfig({ NODE_ENV: "test", TRACE_MOE_API_KEY: "test-private-key" }),
    fetcher,
    { matchFrameEpisodes: async () => [], ...catalog },
  );

test("frames are decoded, resized, stripped of metadata and converted to JPEG", async () => {
  for (const format of ["jpeg", "png", "webp", "gif"]) {
    const resized = await prepareSearchFrame(await image(format, 1280, 720));
    const metadata = await sharp(resized).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, 640);
    assert.equal(metadata.height, 360);
    assert.equal(metadata.exif, undefined);
  }
  const exif = await sharp(await image("jpeg"))
    .withExif({ IFD0: { Artist: "Private author" } })
    .toBuffer();
  assert.equal((await sharp(await prepareSearchFrame(exif)).metadata()).exif, undefined);
  const pixels = Buffer.alloc(8 * 16 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i + (i < 256 ? 0 : 2)] = 255;
    pixels[i + 3] = 255;
  }
  const gif = await sharp(pixels, { raw: { width: 8, height: 16, channels: 4, pageHeight: 8 } })
    .gif({ delay: [100, 100] })
    .toBuffer();
  assert.equal((await sharp(gif, { animated: true }).metadata()).pages, 2);
  const first = await sharp(await prepareSearchFrame(gif))
    .raw()
    .toBuffer();
  assert.ok(first[0] > 200 && first[2] < 30, "Only the first, red GIF frame is sent.");
});

test("invalid raster content, dimensions, size and SVG are rejected before the external request", async () => {
  let calls = 0;
  const search = service(async () => {
    calls++;
    return provider([]);
  });
  for (const invalid of [
    Buffer.alloc(0),
    Buffer.from("GIF89a bad"),
    Buffer.from("<svg/ >"),
    (await image()).subarray(0, 30),
    await image("png", 4097, 1),
  ])
    await assert.rejects(search.search(invalid), (error) => error.getStatus() === 400);
  await assert.rejects(
    search.search(Buffer.alloc(frameSearchLimits.bytes + 1)),
    (error) => error.getStatus() === 413,
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    (await search.search(await image())).matches,
    [],
    "Validation failure releases the active request slot.",
  );
});

test("results are sorted and deduplicated, exact catalog links are safe and provider secrets stay private", async () => {
  let sent;
  const result = [
    match(1, 0.91),
    match(1, 0.97),
    match(2, 0.8, "Unknown anime"),
    {
      ...match(3, 0.7),
      episode: [1, 2],
      at: undefined,
      image: "https://attacker.invalid/image/token",
      video: "javascript:alert(1)",
    },
    { ...match(4, 0.6), anilist: 4, episode: null },
  ];
  const search = service(
    async (url, options) => {
      if (url.endsWith("/me")) return Response.json({ quota: 100, quotaUsed: 1 });
      sent = { url, options };
      return provider(result);
    },
    {
      matchFrameTitles: async () => [
        {
          slug: "frieren",
          title: "Провожающая в последний путь Фрирен",
          originalTitle: "Sousou no Frieren",
          aliases: [],
        },
      ],
      matchFrameEpisodes: async () => [
        {
          id: "00000000-0000-4000-8000-000000000001",
          season: "1",
          number: "2",
          duration: 1200,
          anime: { slug: "frieren" },
        },
      ],
    },
  );
  const found = await search.search(await image());
  assert.equal(sent.url, "https://api.trace.moe/search?anilistInfo&cutBorders=1");
  assert.equal(sent.options.headers["x-trace-key"], "test-private-key");
  assert.equal(sent.options.headers["Content-Type"], "image/jpeg");
  assert.equal(sent.options.headers.Cookie, undefined);
  assert.equal((await sharp(sent.options.body).metadata()).format, "jpeg");
  assert.deepEqual(
    found.matches.map((item) => item.anilistId),
    [1, 2, 3, 4],
  );
  assert.equal(found.matches[0].similarity, 0.97);
  assert.equal(found.matches[0].anime.slug, "frieren");
  assert.equal(found.matches[0].watch.episodeId, "00000000-0000-4000-8000-000000000001");
  assert.equal(found.matches[1].anime, null);
  assert.equal(found.matches[2].episode, "1, 2");
  assert.equal(found.matches[2].timestamp, 62);
  assert.equal(found.matches[2].image, null);
  assert.equal(found.matches[2].video, null);
  assert.equal(found.matches[3].title, "Аниме #4");
  assert.equal(found.matches[3].episode, null);
  assert.doesNotMatch(JSON.stringify(found), /test-private-key|private-provider-filename/);
  for (const bad of [
    "http://api.trace.moe/image/token",
    "https://api.trace.moe.attacker.invalid/image/token",
    "https://user@api.trace.moe/image/token",
    "https://api.trace.moe:444/image/token",
    "https://api.trace.moe/search",
  ])
    assert.equal(tracePreviewUrl(bad, "image"), null);
});

test("curated episode ranges take precedence over filename numbers and bundled episodes are not guessed", async () => {
  const episodeId = randomUUID();
  const catalog = {
    matchFrameTitles: async () => [
      { slug: "frieren", title: "Фрирен", originalTitle: "Sousou no Frieren", aliases: [] },
    ],
    matchFrameEpisodes: async () => [
      { id: episodeId, season: "1", number: "2", duration: 1200, anime: { slug: "frieren" } },
    ],
  };
  const found = await service(
    async () =>
      provider([
        { ...match(1), episode: 85, episode_start: 2, episode_end: 2 },
        { ...match(2), episode: 85, episode_start: 1, episode_end: 2 },
        { ...match(3), episode: null, episode_start: null, episode_end: null },
      ]),
    catalog,
  ).search(await image());
  assert.equal(found.matches[0].episode, "2");
  assert.equal(found.matches[0].watch.episodeId, episodeId);
  assert.equal(found.matches[1].episode, "1–2");
  assert.equal(found.matches[1].watch, null);
  assert.equal(found.matches[2].watch, null);
});

test("watch links resolve exact episodes without guessing offsets, seasons or out-of-range times", () => {
  const first = {
    id: randomUUID(),
    season: "1",
    number: "02",
    duration: 1200,
    anime: { slug: "frieren" },
  };
  const second = { ...first, id: randomUUID(), season: "2" };
  const frame = { anime: { slug: "frieren" }, episode: "2", season: null, timestamp: 62 };
  assert.equal(selectFrameEpisode(frame, [first]).episodeId, first.id);
  assert.equal(selectFrameEpisode({ ...frame, season: "4" }, [first]).episodeId, first.id);
  assert.equal(selectFrameEpisode(frame, [first, second]), null);
  assert.equal(selectFrameEpisode({ ...frame, season: "2" }, [first, second]).episodeId, second.id);
  assert.equal(selectFrameEpisode({ ...frame, season: "4" }, [first, second]), null);
  for (const update of [
    { episode: "85" },
    { episode: "1, 2" },
    { episode: null },
    { anime: null },
    { anime: { slug: "different-title" } },
    { timestamp: 1201 },
    { timestamp: 86401 },
  ])
    assert.equal(selectFrameEpisode({ ...frame, ...update }, [first]), null);
});

test("ambiguous titles and unavailable catalog never produce a guessed catalog link", async () => {
  const row = {
    slug: "one",
    title: "Sousou no Frieren",
    originalTitle: "Sousou no Frieren",
    aliases: [],
  };
  for (const catalog of [
    { matchFrameTitles: async () => [row, { ...row, slug: "two" }] },
    {
      matchFrameTitles: async () => {
        throw new Error("DB private detail");
      },
    },
  ]) {
    const found = await service(async () => provider([match()]), catalog).search(await image());
    assert.equal(found.matches[0].anime, null);
    assert.equal(found.matches[0].title, "Sousou no Frieren");
  }
});

test("upstream quota, outages and malformed responses have stable errors and release the request slot", async () => {
  const failures = [
    [() => new Response("private error", { status: 402 }), 429],
    [() => new Response("private error", { status: 429 }), 429],
    [() => new Response("private error", { status: 503 }), 503],
    [() => Response.json({ error: "private error", result: [] }), 503],
    [() => Response.json({ result: [{ ...match(), similarity: 2 }] }), 503],
    [() => new Response("x".repeat(512 * 1024 + 1)), 503],
    [
      () => {
        throw new Error("private key in transport error");
      },
      503,
    ],
  ];
  const payload = await image();
  for (const [failure, status] of failures) {
    let fail = true;
    const search = service(async () => (fail ? failure() : provider([])));
    await assert.rejects(search.search(payload), (error) => {
      assert.equal(error.getStatus(), status);
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
    fail = false;
    assert.deepEqual((await search.search(payload)).matches, []);
  }
});

test("one external search runs at a time", async () => {
  let release, started;
  const waiting = new Promise((resolve) => {
    started = resolve;
  });
  const search = service(async (url) => {
    if (url.endsWith("/me")) return Response.json({ quota: 100, quotaUsed: 1 });
    started();
    return new Promise((resolve) => {
      release = () => resolve(provider([]));
    });
  });
  const payload = await image();
  const first = search.search(payload);
  await waiting;
  await assert.rejects(search.search(payload), (error) => error.getStatus() === 429);
  release();
  await first;
});
test("server quota is cached, refreshed by search and never exposes the provider IP or account", async () => {
  let quotaCalls = 0;
  let used = 7;
  const search = service(async (url, options) => {
    assert.equal(options.headers["x-trace-key"], "test-private-key");
    if (url.endsWith("/me")) {
      quotaCalls++;
      return Response.json({
        id: "private-provider-ip",
        quota: 100,
        quotaUsed: used,
        concurrency: 1,
      });
    }
    used = 8;
    return Response.json({
      error: "",
      quota: 100,
      quotaUsed: 7,
      result: [match(1, 0.95, "Anime 2nd Season")],
    });
  });
  const [first, second] = await Promise.all([search.getQuota(), search.getQuota()]);
  assert.deepEqual(first, { total: 100, used: 7, remaining: 93 });
  assert.deepEqual(second, first);
  assert.equal(quotaCalls, 1);
  const found = await search.search(await image());
  assert.equal(found.matches[0].season, "2");
  assert.deepEqual(found.quota, { total: 100, used: 8, remaining: 92 });
  assert.deepEqual(await search.getQuota(), found.quota);
  assert.equal(quotaCalls, 2);
  assert.doesNotMatch(JSON.stringify(found), /private-provider-ip|test-private-key/);
  const bad = service(async () => Response.json({ id: "private", quota: "bad", quotaUsed: 0 }));
  await assert.rejects(
    bad.getQuota(),
    (error) => error.getStatus() === 503 && !error.message.includes("private"),
  );
});

test("guest API requires same-origin headers, limits uploads and links an exact catalog match", async () => {
  let calls = 0;
  const app = await createApplication(
    readConfig({ NODE_ENV: "test", DEMO_CATALOG: "true" }),
    fetch,
    {
      frameFetch: async () => {
        calls++;
        return provider([match()]);
      },
    },
  );
  const server = app.getHttpAdapter().getInstance();
  const payload = await image();
  try {
    for (const extra of [{ origin: "https://attacker.invalid" }, { "x-animesoul-request": "" }]) {
      const response = await server.inject({
        method: "POST",
        url: "/api/search/frame",
        headers: { ...headers, ...extra },
        payload,
      });
      assert.equal(response.statusCode, 403, response.body);
    }
    const wrongType = await server.inject({
      method: "POST",
      url: "/api/search/frame",
      headers: { ...headers, "content-type": "image/png" },
      payload,
    });
    assert.equal(wrongType.statusCode, 415, wrongType.body);
    const oversized = await server.inject({
      method: "POST",
      url: "/api/search/frame",
      headers,
      payload: Buffer.alloc(frameSearchLimits.bytes + 1),
    });
    assert.equal(oversized.statusCode, 413, oversized.body);
    assert.equal(calls, 0);
    const response = await server.inject({
      method: "POST",
      url: "/api/search/frame",
      headers,
      payload,
      remoteAddress: "127.0.0.2",
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.json().matches[0].anime.slug, "frieren");
    const ordinary = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { padding: "x".repeat(65536) },
    });
    assert.equal(ordinary.statusCode, 413);
  } finally {
    await app.close();
  }
});

test("frame API limits searches to five per minute", async () => {
  const app = await createApplication(readConfig({ NODE_ENV: "test" }), fetch, {
    frameFetch: async () => provider([]),
  });
  try {
    const payload = await image();
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ method: "POST", url: "/api/search/frame", headers, payload });
      assert.equal(response.statusCode, attempt < 5 ? 200 : 429, response.body);
    }
  } finally {
    await app.close();
  }
});
test(
  "frame matches exclude unpublished, legacy and development titles in production",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const target = new URL(process.env.TEST_DATABASE_URL);
    assert.match(target.pathname, /_test$/);
    const db = createDatabase(target.href);
    const catalog = new CatalogService(
      readConfig({
        NODE_ENV: "production",
        DATABASE_URL: target.href,
        SITE_URL: "https://animesoul.test",
        ADMIN_URL: "https://admin.animesoul.test",
        MFA_ENCRYPTION_KEY: "8".repeat(64),
      }),
    );
    const prefix = "Frame search " + randomUUID();
    const records = [
      { published: true, metadataProvider: "kodik" },
      { published: false, metadataProvider: "kodik" },
      { published: true, metadataProvider: "legacy" },
      { published: true, metadataProvider: "kodik", isDevelopment: true },
    ].map((flags, index) => ({
      id: randomUUID(),
      slug: "frame-" + randomUUID(),
      title: prefix + " " + index,
      originalTitle: prefix + " Original " + index,
      aliases: [prefix + " Alias " + index],
      description: "Frame recognition test",
      year: 2024,
      status: "released",
      genres: [],
      ...flags,
    }));
    try {
      await db.anime.createMany({ data: records });
      const episodes = records.map((record) => ({
        id: randomUUID(),
        animeId: record.id,
        season: "1",
        number: "2",
        duration: 1200,
      }));
      await db.episode.createMany({ data: episodes });
      const found = await catalog.matchFrameTitles(
        records.flatMap((record) => [record.title, record.originalTitle, ...record.aliases]),
      );
      assert.deepEqual(
        found.map((record) => record.slug),
        [records[0].slug],
      );
      assert.equal(
        (await catalog.matchFrameTitles([records[0].originalTitle.toLowerCase()]))[0].slug,
        records[0].slug,
      );
      assert.equal((await catalog.matchFrameTitles(records[0].aliases))[0].slug, records[0].slug);
      assert.deepEqual(
        (await catalog.matchFrameEpisodes(records.map((record) => record.slug))).map(
          (row) => row.id,
        ),
        [episodes[0].id],
      );
    } finally {
      await db.episode.deleteMany({
        where: { animeId: { in: records.map((record) => record.id) } },
      });
      await db.anime.deleteMany({ where: { id: { in: records.map((record) => record.id) } } });
      await catalog.onModuleDestroy();
      await db.$disconnect();
    }
  },
);
