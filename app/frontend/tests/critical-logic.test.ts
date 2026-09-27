import assert from "node:assert/strict";
import test from "node:test";
import {recommendAnime, pickRecommendation} from "../src/features/catalog/recommendations.ts";
import type {Anime, Progress} from "../src/lib/types.ts";

test("recommendations normalize genre count and respect an explicit preferred genre", () => {
  const make = (id: number, genres: string[]): Anime => ({anime_id: id, title: `Title ${id}`, genres: genres.map(title => ({title, alias: title}))});
  const titles = [make(1, ["Комедия"]), make(2, ["Комедия", "Драма", "Экшен"]), make(3, ["Драма"])];
  const counts: [string, number][] = [["Комедия", 20], ["Драма", 5], ["Экшен", 2]];
  const ranked = recommendAnime(titles, counts, {});
  assert.equal(ranked[0].anime.anime_id, 1);
  assert.ok(ranked[0].score > ranked[1].score);
  assert.deepEqual(recommendAnime(titles, counts, {}, "Комедия").map(item => item.anime.anime_id), [1, 2]);
  assert.deepEqual(recommendAnime(titles, counts, {}, "Фэнтези"), []);
});

test("ongoing catalog requests carry their own server filter and pagination cursor", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async input => {
    urls.push(String(input));
    return new Response(JSON.stringify({anime: []}), {status: 200});
  };
  try {
    const {fetchCatalogPage} = await import("../src/features/catalog/api.ts");
    await fetchCatalogPage({limit: 48, offset: 48, status: "airing"});
    const params = new URL(urls[0], "http://localhost").searchParams;
    assert.equal(params.get("status"), "airing");
    assert.equal(params.get("offset"), "48");
  } finally { globalThis.fetch = originalFetch; }
});

test("genre recommendations exclude watched franchises and planned titles, and need viewing evidence", () => {
  const make = (id: number, genre: string): Anime => ({anime_id: id, title: `Anime ${id}`, genres: [{title: genre, alias: genre}], anime_status: {alias: "released"}});
  const catalog = [make(1, "Драма"), make(2, "Комедия"), make(3, "Драма"), {...make(4, "Драма"), anime_status: {alias: "anons", title: "Запланировано"}}, {...make(5, "Драма"), franchiseEntries: [make(3, "Драма")]}, make(6, "Драма")];
  const progress: Progress = {3: {episode: "1", dub: "", episodes: {"1": {position: 10, duration: 100, percent: 10, updatedAt: 1}}}, 6: {episode: "1", dub: "", episodes: {}}};
  const result = recommendAnime(catalog, [["Драма", 10], ["Комедия", 2]], progress);
  assert.deepEqual(result.map(item => item.anime.anime_id), [1, 6, 2]);
  assert.equal(pickRecommendation(result, () => 0)?.anime_id, 1);
  assert.equal(pickRecommendation(result, () => .999)?.anime_id, 2);
  assert.deepEqual(recommendAnime(catalog, [["Драма", 0]], progress), []);
  assert.equal(pickRecommendation([]), undefined);
});
import { castMediaSource, castOwnsPlayback, EMPTY_CAST_STATE, registerCastControl, commandCastVideo } from "../src/lib/cast.ts";

test("Cast accepts only supported remote HTTPS video, never local media", () => {
  const hls = { quality: 720, src: "https://media.example/episode.m3u8?token=sample", type: "hls" };
  assert.deepEqual(castMediaSource(hls), { url: hls.src, type: "application/x-mpegURL" });
  assert.equal(castMediaSource(hls, true), null);
  for (const src of ["/api/downloads/media/1", "http://media.example/movie.mp4", "https://127.0.0.1/video.mp4", "https://localhost/video.mp4", "https://[::1]/video.mp4", "https://user:pass@media.example/video.mp4", "file:///movie.mp4", "content://movies/1", "blob:https://media.example/id"]) {
    assert.equal(castMediaSource({ ...hls, src }), null, src);
  }
  assert.equal(castMediaSource({ ...hls, src: "https://media.example/movie.mp4", type: "video/mp4" })?.type, "video/mp4");
  assert.equal(castMediaSource({ ...hls, src: "https://media.example/embed", type: "text/html" }), null);
});

test("Cast ignores stale receiver progress while another episode is loading", () => {
  const state = { ...EMPTY_CAST_STATE, id: "episode-1" };
  assert.equal(castOwnsPlayback(state, "episode-1"), true);
  assert.equal(castOwnsPlayback(state, "episode-2"), false);
  assert.equal(castOwnsPlayback({ ...state, pendingId: "episode-2" }, "episode-1"), false);
  assert.equal(castOwnsPlayback(EMPTY_CAST_STATE, ""), false);
});

test("Cast imperative transport detaches cleanly and preserves ordinary local playback", () => {
  const video = {} as HTMLVideoElement;
  const calls: unknown[] = [];
  assert.equal(commandCastVideo(video, "play"), false);
  const unregister = registerCastControl(video, (method, seconds) => { calls.push([method, seconds]); return true; });
  assert.equal(commandCastVideo(video, "seek", 42), true);
  assert.deepEqual(calls, [["seek", 42]]);
  unregister();
  assert.equal(commandCastVideo(video, "pause"), false);
});
import {
  acknowledgeTrackedEpisode,
  compareTrackedByRelease,
  collectPlayableEpisodeDates,
  reconcileTrackedEpisodes,
} from "../src/lib/tracking.ts";
import { fetchTrackingSnapshot } from "../src/features/tracking/api.ts";
import { animeMyAnimeListId, cachedEpisodeAirDates, episodeAddedDate, episodeAirDate, fetchEpisodeAirDates, formatAirDate } from "../src/lib/episodeDates.ts";
import { cacheCalendarEvents, cachedCalendarEvents, mergeCalendarEvents } from "../src/pages/tracking/calendarCache.ts";
import { writeDataCache } from "../src/lib/localDataCache.ts";

test("persistent dates appear before API completion and survive partial refresh failures", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalFetch = globalThis.fetch;
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  } });
  try {
    writeDataCache("animesoul:episode-air-dates:v1", "98766", { "1": "2026-01-01", "101": "2026-01-08", "2": "invalid" });
    let finish: ((value: Response) => void) | undefined;
    globalThis.fetch = async input => String(input).endsWith("page=1")
      ? new Promise<Response>(resolve => { finish = resolve; }) : new Response("{}", { status: 503 });
    const refresh = fetchEpisodeAirDates(98766);
    assert.deepEqual(cachedEpisodeAirDates(98766), { "1": "2026-01-01", "101": "2026-01-08" });
    assert.ok(finish);
    finish(new Response(JSON.stringify({ dates: { "1": "2026-01-02", "3": "2026-01-15" }, hasNextPage: true })));
    const updated = await refresh;
    assert.deepEqual(updated, { "1": "2026-01-02", "3": "2026-01-15", "101": "2026-01-08" });
    assert.deepEqual(cachedEpisodeAirDates(98766), updated);
    stored.set("animesoul:episode-air-dates:v1", "broken JSON");
    assert.deepEqual(cachedEpisodeAirDates(98766), {});
  } finally {
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("calendar cache keeps history, isolates dubbings and replaces stale predictions", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  } });
  try {
    const tracker = { animeId: 1, title: "Test", knownEpisodes: 1, dubs: ["A"] };
    const past = { animeId: 1, originId: 1, episode: "1", title: "Test", date: 1000, pending: false };
    const future = { ...past, episode: "2", date: Date.now() + 86400000, future: true };
    cacheCalendarEvents(tracker, [past, future]);
    assert.deepEqual(cachedCalendarEvents(tracker), [past, future]);
    assert.deepEqual(cachedCalendarEvents({ ...tracker, dubs: ["B"] }), []);
    assert.deepEqual(mergeCalendarEvents([past, future], [], false), [past, future]);
    assert.deepEqual(mergeCalendarEvents([past, future], [], true), [past]);
    const corrected = { ...past, date: 2000 };
    assert.deepEqual(mergeCalendarEvents([past], [corrected], true), [corrected]);
    const unknown = { ...past, date: 0 };
    assert.deepEqual(mergeCalendarEvents([past], [unknown], false), [past]);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("episode air dates use original part numbering and never provider update timestamps", () => {
  const video = { video_id: 1, number: "13", originNumber: "1", date: 1788537229,
    iframe_url: "https://player/1", data: { dubbing: "A", player: "Kodik" } };
  assert.equal(episodeAirDate(video, { "1": "2021-07-06", "13": "2026-09-04" }), "2021-07-06");
  assert.equal(formatAirDate("2021-07-06"), "06.07.2021");
  assert.equal(episodeAirDate(video, { "1": "2026-02-30" }), undefined);
  assert.equal(episodeAirDate(video), undefined);
  assert.equal(episodeAddedDate(video), undefined);
  assert.equal(episodeAddedDate({ ...video, episode_added_at: 1788537229 }), "2026-09-04");
  assert.equal(animeMyAnimeListId({ anime_id: 1, title: "Test", remote_ids: { myanimelist_id: "77" } }), 77);
  assert.equal(animeMyAnimeListId({ anime_id: 1, title: "Test", remote_ids: { kp_id: 77 } }), undefined);
});

test("episode dates load later pages, reuse requests and keep earlier pages on an outage", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async input => {
      const url = String(input);
      calls.push(url);
      const page = Number(new URL(url, "http://localhost").searchParams.get("page"));
      if (page === 3) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({ dates: { [page === 1 ? "1" : "101"]: "2026-09-04" }, hasNextPage: true }));
    };
    const [left, right] = await Promise.all([fetchEpisodeAirDates(98765), fetchEpisodeAirDates(98765)]);
    assert.deepEqual(left, { "1": "2026-09-04", "101": "2026-09-04" });
    assert.deepEqual(right, left);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
import {
  animeSearchQueryVariants,
  animeSearchScore,
  episodeResumePosition,
  fetchFamily,
  latestResumePoint,
  matchesAnimeSearch,
  resolveResumeAnime,
  shikimoriAnimeUrl,
  toggleEpisodeWatched,
} from "../src/lib/anime.ts";
import {
  playbackChangedByUser,
  playbackReachedTarget,
} from "../src/lib/watchPartyLogic.ts";
import { kodikSerialIdentity, kodikSerialSource, playerDubbing, playerEpisode, playerTranslationId } from "../src/lib/kodik.ts";
import { fetchAnimeTrailers, fetchCatalogPage, prefetchCatalogSearch } from "../src/features/catalog/api.ts";
import { homeTrailerEmbedUrl } from "../src/lib/trailer.ts";
import {
  animeApiRatings,
  animeSeasonsAverage,
  ratingForSource,
  seasonCombinedAverage,
  seasonEpisodeAverage,
  setUserRating,
} from "../src/lib/ratings.ts";
import {
  dubbingDurationDeficit,
  dubbingHasEpisode,
  isSubtitleTranslation,
  preferredDubbing,
  preferredDubbingForEpisode,
  preferredOfflineVideo,
  preferredPlayer,
  playbackAnimeForVideo,
  subtitleTranslationLabel,
} from "../src/lib/playerPreferences.ts";
import {
  fetchKodikStream,
  hlsLevelForQuality,
  isSameEpisodeDubbingSwitch,
  kodikStreamEpisodeKey,
  kodikStreamRequestKey,
  lowestQualitySource,
} from "../src/lib/kodikStream.ts";
import { hasKodikSecretAccess } from "../src/lib/downloads.ts";
import {
  activePlaybackSelection,
  createPlaybackProgressTarget,
  nextEpisodeInSeason,
  recordPlaybackObservation,
} from "../src/lib/playerProgress.ts";
import {
  backfillFieldRevisions,
  changedFieldRevisions,
  isStorageDocumentShape,
} from "../src/lib/storageSafety.ts";
import { searchSettings } from "../src/features/settings/settingsCatalog.ts";
import { parseDebugStack, sanitizeDebugUrl } from "../src/lib/debugLog.ts";
import {
  CREDENTIAL_JSON_EXAMPLE,
  CREDENTIAL_TEXT_EXAMPLE,
  mergePolledClientId,
  parseCredentialImport,
} from "../src/features/settings/credentialImport.ts";
import { videoSourceIssues } from "../src/lib/sourceDiagnostics.ts";
import { ApiRequestError, requestJson } from "../src/lib/http.ts";

test("JSON transport preserves backend error details, status and code", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ detail: "Точная ошибка backend", code: "CONFLICT" }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  );
  try {
    await assert.rejects(
      requestJson("https://example.invalid/api", { errorMessage: "Запасная ошибка" }),
      (error: unknown) => {
        assert.ok(error instanceof ApiRequestError);
        assert.equal(error.message, "Точная ошибка backend");
        assert.equal(error.status, 409);
        assert.equal(error.code, "CONFLICT");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shikimori links prefer a remote id and keep a title-search fallback", () => {
  assert.equal(
    shikimoriAnimeUrl({ anime_id: 10, title: "Тест", remote_ids: { shikimori_id: "51105" } }),
    "https://shikimori.one/animes/51105",
  );
  assert.equal(
    shikimoriAnimeUrl({ anime_id: -18229, title: "Гатчамен" }),
    "https://shikimori.one/animes/18229",
  );
  assert.equal(
    shikimoriAnimeUrl({ anime_id: 10, title: "Re:Zero / Жизнь с нуля" }),
    "https://shikimori.one/animes?search=Re%3AZero%20%2F%20%D0%96%D0%B8%D0%B7%D0%BD%D1%8C%20%D1%81%20%D0%BD%D1%83%D0%BB%D1%8F",
  );
});

test("credential import accepts flat JSON without exposing or renaming values", () => {
  assert.deepEqual(parseCredentialImport(JSON.stringify({
    yummyPublicToken: "yummy-value",
    kodikPublicKey: "kodik-public",
    kodikPrivateKey: "kodik-private",
    googleClientId: "desktop.apps.googleusercontent.com",
    googleClientSecret: "GOCSPX-secret",
  })), {
    yummyPublicToken: "yummy-value",
    kodikPublicKey: "kodik-public",
    kodikPrivateKey: "kodik-private",
    googleClientId: "desktop.apps.googleusercontent.com",
    googleClientSecret: "GOCSPX-secret",
  });
});

test("credential examples shown in settings remain valid import files", () => {
  const expected = {
    yummyPublicToken: "ВАШ_YUMMY_PUBLIC_TOKEN",
    kodikPublicKey: "ВАШ_KODIK_PUBLIC_KEY",
    kodikPrivateKey: "ВАШ_KODIK_PRIVATE_KEY",
    googleClientId: "ВАШ_GOOGLE_CLIENT_ID",
    googleClientSecret: "ВАШ_GOOGLE_CLIENT_SECRET",
  };
  assert.deepEqual(parseCredentialImport(CREDENTIAL_JSON_EXAMPLE), expected);
  assert.deepEqual(parseCredentialImport(CREDENTIAL_TEXT_EXAMPLE), expected);
});

test("credential import accepts TXT aliases and downloaded Google OAuth JSON", () => {
  assert.deepEqual(parseCredentialImport([
    "YUMMY_PUBLIC_TOKEN = yummy-value",
    "KODIK_PUBLIC_KEY: kodik-public",
    "KODIK_PRIVATE_KEY='kodik-private'",
  ].join("\n")), {
    yummyPublicToken: "yummy-value",
    kodikPublicKey: "kodik-public",
    kodikPrivateKey: "kodik-private",
  });
  assert.deepEqual(parseCredentialImport(JSON.stringify({
    installed: {
      client_id: "desktop.apps.googleusercontent.com",
      client_secret: "GOCSPX-secret",
      redirect_uris: ["http://localhost"],
    },
  })), {
    googleClientId: "desktop.apps.googleusercontent.com",
    googleClientSecret: "GOCSPX-secret",
  });
});

test("Google status polling never overwrites a dirty OAuth draft", () => {
  assert.equal(mergePolledClientId("saved-id", "", true), "");
  assert.equal(mergePolledClientId("saved-id", "draft-id", true), "draft-id");
  assert.equal(mergePolledClientId("saved-id", "stale-id", false), "saved-id");
});

test("global search finds settings by title, description and keywords", () => {
  assert.equal(searchSettings("автоскип опенинга")[0]?.id, "player-opening");
  assert.equal(searchSettings("автосерия")[0]?.id, "player-next");
  assert.equal(searchSettings("client secret")[0]?.id, "credentials-google");
  assert.equal(searchSettings("постер карточка").some((item) => item.tab === "appearance"), true);
  assert.equal(searchSettings("google drive").some((item) => item.tab === "cloud"), true);
  assert.equal(searchSettings("настройки")[0]?.id, "section-settings");
  assert.equal(searchSettings("история версий")[0]?.tab, "changelog");
});

test("debug diagnostics keep function and source file locations", () => {
  const chrome = parseDebugStack([
    "Error",
    "    at recordDebugEvent (http://127.0.0.1:5173/src/lib/debugLog.ts:150:20)",
    "    at saveProgress (http://127.0.0.1:5173/src/features/storage/useProfileStorage.ts?t=123:625:5)",
  ].join("\n"));
  assert.deepEqual(chrome, {
    functionName: "saveProgress",
    file: "src/features/storage/useProfileStorage.ts",
    line: 625,
    column: 5,
  });

  const firefox = parseDebugStack("Error\nloadVideos@http://127.0.0.1:5173/src/components/Player.tsx:444:9");
  assert.equal(firefox.functionName, "loadVideos");
  assert.equal(firefox.file, "src/components/Player.tsx");
});

test("debug URLs redact credentials before persistence", () => {
  const sanitized = new URL(sanitizeDebugUrl("https://example.test/api?token=secret&episode=3"));
  assert.equal(sanitized.searchParams.get("token"), "[скрыто]");
  assert.equal(sanitized.searchParams.get("episode"), "3");
});

test("global settings search can omit desktop-only watch party controls", () => {
  assert.equal(searchSettings("hamachi", { includeParty: false }).length, 0);
  assert.equal(searchSettings("hamachi", { includeParty: true })[0]?.tab, "party");
});

test("global settings search ignores empty and one-character queries", () => {
  assert.deepEqual(searchSettings(""), []);
  assert.deepEqual(searchSettings(" а "), []);
});

test("storage hydration rejects malformed success payloads", () => {
  assert.equal(isStorageDocumentShape({}), false);
  assert.equal(isStorageDocumentShape({ profiles: [] }), false);
  assert.equal(isStorageDocumentShape({ profiles: [{ id: "p1", snapshot: [] }] }), false);
  assert.equal(isStorageDocumentShape({
    activeProfile: "p1",
    profiles: [{ id: "p1", name: "Main", snapshot: {} }],
  }), true);
});

test("storage field revisions preserve old fields and advance only real edits", () => {
  const initial = backfillFieldRevisions(undefined, 100);
  const previous = {
    favorites: [1], folders: [], progress: {}, ratings: {}, tracked: [],
    theme: {}, toolbar: "bottom", playerPrefs: {}, historyClearedAt: 0,
    historyEnabled: true, libraryExpanded: true, watchingExpanded: true,
    historyExpanded: true, watchingHidden: [],
  };
  const revised = changedFieldRevisions(
    previous,
    { ...previous, progress: { 1: { episodes: {} } } },
    initial,
    200,
  );
  assert.equal(revised.progress, 200);
  assert.equal(revised.favorites, 100);
  assert.equal(revised.playerPrefs, 100);
});

test("custom player and downloads require the complete Kodik secret access pair", () => {
  assert.equal(hasKodikSecretAccess({ kodikPublicKeyConfigured: true, kodikPrivateKeyConfigured: true }), true);
  assert.equal(hasKodikSecretAccess({ kodikPublicKeyConfigured: true, kodikPrivateKeyConfigured: false }), false);
  assert.equal(hasKodikSecretAccess({ kodikPublicKeyConfigured: false, kodikPrivateKeyConfigured: true }), false);
});

test("player preferences follow manual override, global preferred voice, favourites, then first available", () => {
  const available = ["Kodik default", "AniLibria", "Dream Cast"];
  assert.equal(preferredDubbing(available, "Dream Cast", "AniLibria", [], "Kodik default"), "Dream Cast");
  assert.equal(preferredDubbing(available, "", "Dream Cast", ["AniLibria"], "Kodik default"), "Dream Cast");
  assert.equal(preferredDubbing(available, "", "Missing", ["AniLibria", "Dream Cast"], "Kodik default"), "AniLibria");
  assert.equal(preferredDubbing(available, "", "", ["Missing"], "Kodik default"), "Kodik default");
  assert.equal(preferredDubbing(available, "", "", [], ""), "Kodik default");
  assert.equal(preferredDubbing(["First", "Provider"], "Missing", "Missing", ["Missing"], "Provider"), "First");
  assert.equal(preferredDubbing(["First", "Favourite"], "Missing", "Missing", ["Missing", "Favourite"]), "Favourite");
});

test("dubbing switches never substitute another episode", () => {
  const videos = [
    { number: "5", data: { dubbing: "Voice A" } },
    { number: "6", data: { dubbing: "Voice B" } },
  ];
  assert.equal(dubbingHasEpisode(videos, "Voice A", "5"), true);
  assert.equal(dubbingHasEpisode(videos, "Voice B", "5"), false);
});

test("franchise playback resolves metadata from the video's own anime entry", () => {
  const root = { anime_id: 100, title: "Season 1", remote_ids: { shikimori_id: 39535 } };
  const seasonThree = { anime_id: 300, title: "Season 3", remote_ids: { shikimori_id: 59193 } };

  assert.equal(
    playbackAnimeForVideo(root, [root, seasonThree], {}, seasonThree.anime_id),
    seasonThree,
  );
  assert.equal(
    playbackAnimeForVideo(root, [root], { [seasonThree.anime_id]: seasonThree }, seasonThree.anime_id),
    seasonThree,
  );
  assert.equal(playbackAnimeForVideo(root, [root], {}, seasonThree.anime_id), undefined);
});

test("episode selection applies global voices before an old resume voice", () => {
  const videos = [
    { number: "1", data: { dubbing: "Favourite" } },
    { number: "3", data: { dubbing: "Resume voice" } },
    { number: "3", data: { dubbing: "Fallback" } },
  ];
  assert.equal(
    preferredDubbingForEpisode(videos, "3", "", "Favourite", ["Favourite"], "Resume voice", "Fallback"),
    "Resume voice",
  );
  assert.equal(
    preferredDubbingForEpisode(videos, "3", "", "Favourite", ["Favourite"], "Missing", "Fallback"),
    "Resume voice",
  );
  assert.equal(
    preferredDubbingForEpisode(videos, "3", "Fallback", "Favourite", [], "Resume voice", ""),
    "Fallback",
  );
});

test("downloaded video has priority and returns when its dubbing is selected again", () => {
  const videos = [
    { number: "3", data: { dubbing: "Voice A" }, offline: { quality: 480 }, source: "local-480" },
    { number: "3", data: { dubbing: "Voice A" }, offline: { quality: 720 }, source: "local-720" },
    { number: "3", data: { dubbing: "Voice A" }, source: "online" },
    { number: "3", data: { dubbing: "Voice B" }, source: "online-b" },
  ];
  assert.equal(preferredOfflineVideo(videos, "Voice A", "3", 480)?.source, "local-480");
  assert.equal(preferredOfflineVideo(videos, "Voice A", "3", 1080)?.source, "local-720");
  assert.equal(preferredOfflineVideo(videos, "Voice B", "3", 720), undefined);
});

test("player flags a materially shorter Kodik dubbing without calling it censorship", () => {
  const videos = [
    { number: "6", duration: 1_421, data: { dubbing: "Full", player: "Kodik" } },
    { number: "6", duration: 1_100, data: { dubbing: "Short", player: "Kodik" } },
    { number: "6", duration: 1_420, data: { dubbing: "Short", player: "Alloha" } },
  ];
  assert.equal(dubbingDurationDeficit(videos, "Short", "6"), 321);
  assert.equal(dubbingDurationDeficit(videos, "Full", "6"), 0);
  assert.equal(dubbingDurationDeficit([
    ...videos,
    {
      number: "6",
      duration: 1_100,
      data: { dubbing: "Short", player: "Локальный файл · 720p" },
      offline: { quality: 720 },
    },
  ], "Short", "6"), 0);
});

test("video source diagnostics say which provider and data failed", () => {
  const issues = videoSourceIssues({
    animeId: 77,
    title: "Re:Zero",
    seasonLabel: "Сезон 1",
    sources: { yummy: "ok", kodik: "error" },
    loadedVideos: 12,
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.sourceLabel, "Kodik");
  assert.match(issues[0]?.unavailableData ?? "", /озвучки/);
  assert.match(issues[0]?.context ?? "", /Re:Zero/);
});

test("Kodik subtitle translations are separated from voice dubbings", () => {
  assert.equal(isSubtitleTranslation("Субтитры Crunchyroll"), true);
  assert.equal(isSubtitleTranslation("Crunchyroll.Subtitles", "subtitles"), true);
  assert.equal(isSubtitleTranslation("ТО Дубляжная", "voice"), false);
  assert.equal(subtitleTranslationLabel("Субтитры Crunchyroll"), "Crunchyroll");
  assert.equal(subtitleTranslationLabel("Crunchyroll.Subtitles"), "Crunchyroll");
});

test("AnimeSoul is the default Kodik provider but a title choice wins", () => {
  const available = ["AnimeSoul", "Kodik", "YummyAnime"];
  assert.equal(preferredPlayer(available, "Kodik", true, "YummyAnime"), "Kodik");
  assert.equal(preferredPlayer(available, "", true, "YummyAnime"), "AnimeSoul");
  assert.equal(preferredPlayer(["YummyAnime"], "", false, "YummyAnime"), "YummyAnime");
});

test("custom player explains when the running backend predates direct streams", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ detail: "Method Not Allowed" }),
    { status: 405, headers: { "content-type": "application/json" } },
  );

  try {
    await assert.rejects(
      fetchKodikStream({
        videoId: "stale-backend-probe",
        season: 1,
        episode: "1",
        dubbing: "Test",
        iframeUrl: "https://kodik.example/player",
      }),
      /старая версия сервера AnimeSoul/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("custom player pins HLS to the requested quality instead of auto ABR", () => {
  const levels = [{ height: 360 }, { height: 480 }, { height: 720 }, { height: 1080 }];
  assert.equal(hlsLevelForQuality(levels, 720), 2);
  assert.equal(hlsLevelForQuality(levels, 900), 2);
  assert.equal(hlsLevelForQuality(levels, 240), 0);
});

test("custom player identifies dubbing changes without treating them as edit compatibility", () => {
  const previous = {
    videoId: 1,
    season: 3,
    episode: "5",
    dubbing: "Voice A",
    translationId: 101,
    iframeUrl: "https://kodik.example/a",
  };
  assert.equal(isSameEpisodeDubbingSwitch(previous, {
    ...previous,
    videoId: 2,
    dubbing: "Voice B",
    translationId: 202,
    iframeUrl: "https://kodik.example/b",
  }), true);
  assert.equal(isSameEpisodeDubbingSwitch(previous, {
    ...previous,
    videoId: 3,
    episode: "6",
    dubbing: "Voice B",
  }), false);
  assert.equal(isSameEpisodeDubbingSwitch(previous, {
    ...previous,
    videoId: 4,
    iframeUrl: "https://kodik.example/another-source",
  }), false);
  assert.equal(isSameEpisodeDubbingSwitch(previous, {
    ...previous,
    videoId: 5,
    dubbing: "ТО Дубляжная",
    translationId: 3084,
    originEpisode: "9",
    sourceId: "59193",
  }), false);

  const unresolvedFamily = {
    ...previous,
    originAnimeId: 300,
    originEpisode: "5",
    sourceId: "39535",
    sourceIdType: "shikimori" as const,
    sourceTitle: "Season 1",
  };
  const resolvedFamily = {
    ...unresolvedFamily,
    videoId: 6,
    dubbing: "Voice B",
    translationId: 202,
    sourceId: "59193",
    sourceTitle: "Season 3",
  };
  assert.equal(kodikStreamEpisodeKey(unresolvedFamily), kodikStreamEpisodeKey(resolvedFamily));
  assert.notEqual(kodikStreamRequestKey(unresolvedFamily), kodikStreamRequestKey(resolvedFamily));
  assert.equal(isSameEpisodeDubbingSwitch(unresolvedFamily, resolvedFamily), true);
});

test("Kodik stream identity changes when late family resolver metadata is corrected", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push(body);
    return new Response(JSON.stringify({
      sources: [{
        quality: 720,
        src: `https://cdn.example/${body.sourceId}.m3u8`,
        type: "hls",
      }],
      subtitles: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const wrongRootIdentity = {
    videoId: "to-episode-9-cache-regression",
    season: 3,
    episode: "9",
    originAnimeId: 300,
    originEpisode: "9",
    dubbing: "ТО Дубляжная",
    translationId: 3084,
    iframeUrl: "https://kodik.example/seria/episode-9/hash/720p",
    sourceId: "39535",
    sourceIdType: "shikimori" as const,
    sourceTitle: "Season 1",
  };
  const exactSeasonIdentity = {
    ...wrongRootIdentity,
    sourceId: "59193",
    sourceTitle: "Season 3",
  };

  try {
    assert.notEqual(
      kodikStreamRequestKey(wrongRootIdentity),
      kodikStreamRequestKey(exactSeasonIdentity),
    );
    const wrong = await fetchKodikStream(wrongRootIdentity);
    const exact = await fetchKodikStream(exactSeasonIdentity);
    assert.equal(wrong.sources[0].src, "https://cdn.example/39535.m3u8");
    assert.equal(exact.sources[0].src, "https://cdn.example/59193.m3u8");
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("online Kodik playback resolves a fresh temporary URL for every launch", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    assert.equal(init?.cache, "no-store");
    return new Response(JSON.stringify({
      sources: [{ quality: 720, src: `https://cdn.example/fresh-${calls}.m3u8`, type: "hls" }],
      subtitles: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const request = {
    videoId: "fresh-link-regression",
    season: 1,
    episode: "3",
    dubbing: "Test",
    iframeUrl: "https://kodik.example/seria/3/hash/720p",
  };

  try {
    const first = await fetchKodikStream(request);
    const second = await fetchKodikStream(request);
    assert.equal(calls, 2);
    assert.equal(first.sources[0].src, "https://cdn.example/fresh-1.m3u8");
    assert.equal(second.sources[0].src, "https://cdn.example/fresh-2.m3u8");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloaded episodes use a direct local stream without calling Kodik", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 500 });
  };

  try {
    const directStream = {
      sources: [{ quality: 720, src: "/api/downloads/media/local-episode", type: "video/mp4" }],
      subtitles: [],
    };
    const resolved = await fetchKodikStream({
      videoId: "offline:local-episode",
      season: 3,
      episode: "5",
      dubbing: "Voice A",
      iframeUrl: "/api/downloads/media/local-episode",
      directStream,
    });
    assert.equal(calls, 0);
    assert.deepEqual(resolved, directStream);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("late media updates stay attached to their immutable episode", () => {
  const first = createPlaybackProgressTarget({
    season: 1,
    episode: "1",
    dub: "Voice A",
    player: "AnimeSoul",
    originAnimeId: 101,
    originEpisode: "1",
  });
  const second = createPlaybackProgressTarget({
    season: 1,
    episode: "2",
    dub: "Voice A",
    player: "AnimeSoul",
    originAnimeId: 101,
    originEpisode: "2",
  });

  const afterFirst = recordPlaybackObservation(undefined, first, {
    time: 40,
    duration: 1_400,
    updatedAt: 1,
  }).value;
  const afterSecond = recordPlaybackObservation(afterFirst, second, {
    time: 12,
    duration: 1_400,
    updatedAt: 2,
  }).value;
  const afterLateFirstEvent = recordPlaybackObservation(afterSecond, first, {
    time: 43,
    // Teardown can race metadata reset. It must keep the valid duration that
    // the same immutable episode recorded earlier.
    duration: 0,
    updatedAt: 3,
  }).value;

  assert.equal(Object.isFrozen(first), true);
  assert.equal(afterLateFirstEvent.episodes["1:1"].position, 43);
  assert.equal(afterLateFirstEvent.episodes["1:1"].duration, 1_400);
  assert.equal(afterLateFirstEvent.episodes["1:2"].position, 12);
});

test("auto-next stays inside the active season and never enters an alternate cut", () => {
  const episodes = [
    { season: 1, number: "24" },
    { season: 1, number: "25" },
    { season: 8, number: "1" },
  ];
  assert.deepEqual(nextEpisodeInSeason(episodes, 1, "24"), episodes[1]);
  assert.equal(nextEpisodeInSeason(episodes, 1, "25"), undefined);
  assert.equal(nextEpisodeInSeason(episodes, 7, "25"), undefined);
});

test("fullscreen AnimeSoul playback advances repeatedly after the first auto-next", () => {
  const episodes = [
    { season: 1, number: "1" },
    { season: 1, number: "2" },
    { season: 1, number: "3" },
  ];
  const staleFullscreenCursor = { season: 1, episode: "1" };
  const uiAfterFirstTransition = { season: 1, episode: "2" };

  const animeSoulSelection = activePlaybackSelection(
    uiAfterFirstTransition,
    staleFullscreenCursor,
    true,
    false,
  );
  assert.deepEqual(
    nextEpisodeInSeason(episodes, animeSoulSelection.season, animeSoulSelection.episode),
    episodes[2],
  );

  // A cross-origin iframe still needs its player-reported fullscreen cursor,
  // because React intentionally waits until fullscreen closes before syncing.
  assert.equal(
    activePlaybackSelection(uiAfterFirstTransition, staleFullscreenCursor, true, true),
    staleFullscreenCursor,
  );
});

test("obsolete franchise discovery is aborted instead of retrying in the background", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });

  try {
    const pending = fetchFamily({ anime_id: 77, title: "Demo" }, "Demo", controller.signal);
    controller.abort();
    await assert.rejects(pending, error => error instanceof DOMException && error.name === "AbortError");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hidden dubbing audio uses the lightest available rendition", () => {
  assert.equal(lowestQualitySource([
    { quality: 720, src: "720.m3u8", type: "hls" },
    { quality: 360, src: "360.m3u8", type: "hls" },
    { quality: 480, src: "480.m3u8", type: "hls" },
  ])?.quality, 360);
});

test("home trailer URL removes playlist controls and keeps muted autoplay", () => {
  const url = new URL(homeTrailerEmbedUrl(
    "https://www.youtube-nocookie.com/embed/demo123?loop=1&playlist=demo123&controls=1",
    17.8,
    "http://127.0.0.1:3003",
  ));

  assert.equal(url.searchParams.has("playlist"), false);
  assert.equal(url.searchParams.has("loop"), false);
  assert.equal(url.searchParams.get("autoplay"), "1");
  assert.equal(url.searchParams.get("mute"), "1");
  assert.equal(url.searchParams.get("controls"), "0");
  assert.equal(url.searchParams.get("autohide"), "1");
  assert.equal(url.searchParams.get("start"), "17");
  assert.equal(url.searchParams.get("origin"), "http://127.0.0.1:3003");
});

test("user ratings roll up from episodes to seasons and anime", () => {
  let ratings = setUserRating(undefined, "Demo", { scope: "anime" }, 9);
  ratings = setUserRating(ratings, "Demo", { scope: "season", season: 1 }, 8);
  ratings = setUserRating(ratings, "Demo", { scope: "episode", season: 1, episode: "1" }, 10);
  ratings = setUserRating(ratings, "Demo", { scope: "episode", season: 1, episode: "2" }, 6);
  ratings = setUserRating(ratings, "Demo", { scope: "episode", season: 2, episode: "1" }, 10);

  assert.equal(seasonEpisodeAverage(ratings, 1), 8);
  assert.equal(seasonCombinedAverage(ratings, 1), 8);
  assert.equal(animeSeasonsAverage(ratings), 9);
  assert.equal(ratings.anime, 9);
});

test("all positive API rating sources are normalized for display", () => {
  const sources = animeApiRatings({
    anime_id: 1,
    title: "Demo",
    rating: {
      average: 8.4,
      kp_rating: 7.9,
      imdb_rating: 8.1,
      future_rating: 9.2,
      anidub_rating: 0,
    },
  });
  assert.deepEqual(sources.map(source => source.key), [
    "average",
    "kp_rating",
    "imdb_rating",
    "future_rating",
  ]);
});

test("AnimeSoul rating source reads the public server aggregate", () => {
  const anime = { anime_id: 1, title: "Demo" };
  const value = ratingForSource(anime, undefined, "animesoul", {
    animeId: 1,
    anime: { average: 8.75, count: 12 },
    seasons: {},
    episodes: {},
  });

  assert.equal(value, 8.75);
});

test("YouTube trailers are normalized with an immediate preview image", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    trailers: [{ iframe_url: "https://youtube.com/embed/v4Uj7RJprQE?enablejsapi=1" }],
  }), { headers: { "content-type": "application/json" } });

  try {
    const [trailer] = await fetchAnimeTrailers(1589);
    assert.equal(trailer.url, "https://www.youtube-nocookie.com/embed/v4Uj7RJprQE");
    assert.equal(trailer.poster, "https://i.ytimg.com/vi/v4Uj7RJprQE/maxresdefault.jpg");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("anime search understands layouts, acronyms, aliases and alternate languages", () => {
  const naruto = { anime_id: 1, title: "Naruto: Shippuden", other_titles: ["Наруто: Ураганные хроники"] };
  const attack = { anime_id: 2, title: "Attack on Titan", original: "Shingeki no Kyojin" };
  const jujutsu = { anime_id: 3, title: "Jujutsu Kaisen", other_titles: ["Магическая битва"] };
  const onePiece = { anime_id: 4, title: "One Piece" };

  assert.equal(matchesAnimeSearch(naruto, "yfhenj"), true);
  assert.equal(matchesAnimeSearch(attack, "aot"), true);
  assert.equal(matchesAnimeSearch(attack, "аот"), true);
  assert.equal(matchesAnimeSearch(jujutsu, "магичка"), true);
  assert.equal(matchesAnimeSearch(onePiece, "ванпис"), true);
  assert.ok(animeSearchQueryVariants("аот").includes("attack on titan"));
  assert.ok(animeSearchScore(attack, "attack on titan") > animeSearchScore(attack, "аот"));
});

test("catalog search submit reuses a prefetched in-flight request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return new Response(JSON.stringify({ anime: [{ anime_id: 9, title: "Attack on Titan" }] }), {
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const query = `cache-probe-${Date.now()}`;
    const [prefetched, submitted] = await Promise.all([
      prefetchCatalogSearch(query),
      fetchCatalogPage({ limit: 24, offset: 0, query }),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(prefetched, submitted);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Kodik single episode URL becomes one stable serial player", () => {
  const first = "//kodik.example/season/abc?episode=1&only_episode=true&only_season=true&translations=false";
  const second = "//kodik.example/season/abc?episode=2&only_episode=true&only_season=true&translations=false";
  const source = new URL(kodikSerialSource(first, "5", 42));
  assert.equal(source.searchParams.get("episode"), "5");
  assert.equal(source.searchParams.get("start_from"), "42");
  assert.equal(source.searchParams.has("only_episode"), false);
  assert.equal(source.searchParams.has("only_season"), false);
  assert.equal(source.searchParams.has("translations"), false);
  assert.equal(kodikSerialIdentity(first), kodikSerialIdentity(second));
});

test("Kodik event payload helpers accept common player formats", () => {
  assert.equal(playerEpisode({ current_episode: 7 }), "7");
  assert.equal(playerEpisode({ episode: "3" }), "3");
  assert.equal(playerDubbing({ translation: { title: "AniLibria" } }), "AniLibria");
  assert.equal(playerDubbing({ value: { translation: { name: "Dream Cast" } } }), "Dream Cast");
  assert.equal(playerDubbing('{"translation":{"title":"AniDUB"}}'), "AniDUB");
  assert.equal(playerDubbing("{неполный payload"), "{неполный payload");
  assert.equal(playerTranslationId({ translation: { id: 610 } }), "610");
  assert.equal(playerTranslationId({ value: { translation_id: "711" } }), "711");
  assert.equal(playerTranslationId('{"translation":{"id":812}}'), "812");
  assert.equal(playerTranslationId("812"), "");
});

test("tracking keeps a monotonic baseline and acknowledges an exact episode", () => {
  const baseline = {
    animeId: 10,
    animeIds: [10],
    title: "Test",
    knownEpisodes: 3,
    knownEpisodeKeys: ["10:1", "10:2", "10:3"],
    pendingEpisodeKeys: [],
    newEpisodes: 0,
    lastCheckedAt: 100,
  };
  const partial = reconcileTrackedEpisodes(
    baseline,
    [10],
    new Map([["10:1", 1], ["10:2", 2]]),
    200,
  );
  const recovered = reconcileTrackedEpisodes(
    partial,
    [10],
    new Map([["10:1", 1], ["10:2", 2], ["10:3", 3], ["10:4", 4]]),
    300,
  );
  assert.deepEqual(recovered.knownEpisodeKeys, ["10:1", "10:2", "10:3", "10:4"]);
  assert.deepEqual(recovered.pendingEpisodeKeys, ["10:4"]);
  assert.equal(acknowledgeTrackedEpisode(recovered, "10:4").newEpisodes, 0);
});

test("tracking filters unavailable videos and non-selected dubbings", () => {
  const dates = collectPlayableEpisodeDates(
    7,
    [
      { video_id: 1, number: "1", iframe_url: "https://player/1", date: 1, data: { dubbing: "A", player: "Kodik" } },
      { video_id: 2, number: "2", iframe_url: "", date: 2, data: { dubbing: "A", player: "Kodik" } },
      { video_id: 3, number: "3", iframe_url: "https://player/3", date: 3, data: { dubbing: "B", player: "Kodik" } },
    ],
    ["A"],
  );
  assert.deepEqual([...dates.keys()], ["7:1"]);
});

test("tracking repairs phantom baselines once and detects the real release later", () => {
  const legacy = {
    animeId: 15066, animeIds: [15066, 25629, 30021], title: "Slime", dubs: ["A"],
    knownEpisodes: 4, knownEpisodeKeys: ["15066:21", "25629:1", "25629:2", "30021:25"],
    knownAnyEpisodeKeys: ["15066:21", "25629:1", "25629:2", "30021:25"],
    pendingEpisodeKeys: ["25629:1"], newEpisodes: 1,
    pendingOtherDubEpisodeKeys: ["25629:2"], otherDubEpisodes: 1, lastCheckedAt: 100,
  };
  const current = new Map([["15066:21", 1]]);
  const repaired = reconcileTrackedEpisodes(legacy, legacy.animeIds, current, 200, current, [15066, 25629]);
  assert.deepEqual(repaired.knownEpisodeKeys, ["15066:21", "30021:25"]);
  assert.deepEqual(repaired.knownAnyEpisodeKeys, ["15066:21", "30021:25"]);
  assert.equal(repaired.newEpisodes, 0);
  assert.equal(repaired.otherDubEpisodes, 0);
  assert.deepEqual(repaired.episodeIdentityCheckedIds, [15066, 25629]);
  // Unavailable titles keep their history; subsequent partial results keep
  // the repaired baseline monotonic even with a healthy-source marker.
  const partial = reconcileTrackedEpisodes(repaired, legacy.animeIds, new Map(), 300, new Map(), [15066, 25629]);
  assert.deepEqual(partial.knownEpisodeKeys, repaired.knownEpisodeKeys);
  const otherVoice = new Map([...current, ["25629:1", 2] as const]);
  const released = reconcileTrackedEpisodes(partial, legacy.animeIds, current, 400, otherVoice, [15066, 25629]);
  assert.equal(released.newEpisodes, 0);
  assert.equal(released.otherDubEpisodes, 1);
  const dubbed = reconcileTrackedEpisodes(released, legacy.animeIds, otherVoice, 500, otherVoice, [15066, 25629]);
  assert.deepEqual(dubbed.pendingEpisodeKeys, ["25629:1"]);
  assert.equal(dubbed.otherDubEpisodes, 0);
});

test("tracking repairs only snapshots from the corrected backend with both sources available", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async input => {
      const url = String(input);
      if (url.includes("mode=details")) return new Response(JSON.stringify({ anime: [] }));
      const id = Number(new URL(url, "http://localhost").searchParams.get("id"));
      return new Response(JSON.stringify({
        videos: id === 4 ? null : [], episode_identity_version: id === 3 ? undefined : 1,
        _sources: { yummy: "ok", kodik: id === 2 ? "error" : "ok" },
      }));
    };
    const snapshot = await fetchTrackingSnapshot({
      animeId: 1, animeIds: [1, 2, 3, 4], title: "Test", knownEpisodes: 1, newEpisodes: 0,
    });
    assert.equal(snapshot?.successfulRequests, 3);
    assert.deepEqual(snapshot?.identityCheckedAnimeIds, [1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tracking keeps baseline quiet and orders pending releases newest first", () => {
  const baseline = reconcileTrackedEpisodes(
    {
      animeId: 1,
      animeIds: [1],
      title: "First",
      knownEpisodes: 0,
      newEpisodes: 0,
    },
    [1],
    new Map([["1:1", 1_000]]),
    100,
  );
  assert.equal(baseline.newEpisodes, 0);

  const olderRelease = reconcileTrackedEpisodes(
    baseline,
    [1],
    new Map([["1:1", 1_000], ["1:2", 2_000]]),
    200,
  );
  const newerRelease = reconcileTrackedEpisodes(
    {
      animeId: 2,
      animeIds: [2],
      title: "Second",
      knownEpisodes: 1,
      knownEpisodeKeys: ["2:1"],
      pendingEpisodeKeys: [],
      newEpisodes: 0,
      lastCheckedAt: 100,
    },
    [2],
    new Map([["2:1", 1_000], ["2:2", 3_000]]),
    300,
  );
  const quiet = { ...baseline, animeId: 3, title: "Quiet" };

  const sorted = [olderRelease, quiet, newerRelease].sort(compareTrackedByRelease);
  assert.deepEqual(sorted.map((tracker) => tracker.animeId), [2, 1, 3]);
  assert.equal(olderRelease.lastNewEpisodeAt, 200);
  assert.equal(newerRelease.lastNewEpisodeAt, 300);
});

test("tracking marks an episode that is available only in another dubbing", () => {
  const selectedDub = new Map([["7:1", 1_000]]);
  const baseline = reconcileTrackedEpisodes(
    {
      animeId: 7,
      animeIds: [7],
      title: "Dub test",
      knownEpisodes: 1,
      knownEpisodeKeys: ["7:1"],
      pendingEpisodeKeys: [],
      newEpisodes: 0,
      lastCheckedAt: 100,
    },
    [7],
    selectedDub,
    200,
    selectedDub,
  );
  assert.equal(baseline.otherDubEpisodes, 0);

  const anotherDubReleased = reconcileTrackedEpisodes(
    baseline,
    [7],
    selectedDub,
    300,
    new Map([["7:1", 1_000], ["7:2", 2_000]]),
  );
  assert.equal(anotherDubReleased.newEpisodes, 0);
  assert.equal(anotherDubReleased.otherDubEpisodes, 1);
  assert.deepEqual(anotherDubReleased.pendingOtherDubEpisodeKeys, ["7:2"]);

  const selectedDubReleased = reconcileTrackedEpisodes(
    anotherDubReleased,
    [7],
    new Map([["7:1", 1_000], ["7:2", 2_000]]),
    400,
    new Map([["7:1", 1_000], ["7:2", 2_000]]),
  );
  assert.equal(selectedDubReleased.newEpisodes, 1);
  assert.equal(selectedDubReleased.otherDubEpisodes, 0);
  assert.deepEqual(selectedDubReleased.pendingOtherDubEpisodeKeys, []);
});

test("watch-party helpers distinguish remote settling from a user command", () => {
  const target = {
    animeId: 7,
    season: 2,
    episode: "4",
    dub: "AniLibria",
    player: "Kodik",
    position: 80,
    duration: 1440,
    playing: false,
    updatedAt: 10_000,
  };
  assert.equal(
    playbackReachedTarget(target, { ...target, position: 81, updatedAt: 11_000 }),
    true,
  );
  assert.equal(
    playbackChangedByUser(target, { ...target, playing: true, updatedAt: 10_100 }),
    true,
  );
  assert.equal(
    playbackReachedTarget(target, { ...target, dub: "Dream Cast" }),
    false,
  );
});

test("manual watched mark never prevents replaying an episode", () => {
  const marked = toggleEpisodeWatched(
    {
      position: 380,
      duration: 1_440,
      percent: 26,
      updatedAt: 1,
    },
    1_440,
    2,
  );
  assert.equal(marked.completed, true);
  assert.equal(marked.manuallyCompleted, true);
  assert.equal(episodeResumePosition(marked), 0);
  assert.equal(
    episodeResumePosition({
      position: 380,
      duration: 1_440,
      percent: 26,
      updatedAt: 1,
    }),
    380,
  );
});

test("continue watching uses the newest real playback position", () => {
  const point = latestResumePoint({
    season: 2,
    episode: "2",
    dub: "AniLibria",
    episodes: {
      "2:2": { position: 0, duration: 1_440, percent: 0, updatedAt: 10 },
      "3:1": { position: 92, duration: 1_440, percent: 6, updatedAt: 20 },
      "4:1": {
        position: 1_440,
        duration: 1_440,
        percent: 100,
        updatedAt: 30,
        completed: true,
        manuallyCompleted: true,
      },
    },
  });
  assert.equal(point?.key, "3:1");
  assert.equal(point?.season, 3);
  assert.equal(point?.episode, "1");
  assert.equal(episodeResumePosition(point?.state), 92);
});

test("continue watching follows viewing time after returning to an earlier season", () => {
  for (const position of [2, 380, 1_440]) {
    const point = latestResumePoint({
      season: 1,
      episode: "3",
      dub: "AniLibria",
      episodes: {
        "1:3": {
          position, duration: 1_440, percent: Math.round(position / 1_440 * 100),
          completed: position === 1_440, updatedAt: 30,
        },
        "1:9": { position: 500, duration: 1_440, percent: 35, updatedAt: 10 },
        "2:1": { position: 92, duration: 1_440, percent: 6, updatedAt: 20 },
        "2:2": { position: 0, duration: 1_440, percent: 0, updatedAt: 40 },
      },
    });
    assert.equal(point?.key, "1:3", `latest position: ${position}`);
    assert.equal(point?.season, 1);
    assert.equal(point?.episode, "3");
    assert.equal(episodeResumePosition(point?.state), position === 1_440 ? 0 : position);
  }
});

test("continue watching resumes an unfinished rewatch", () => {
  const state = {
    position: 92,
    duration: 1_396,
    percent: 7,
    completed: true,
    completions: 1,
    rewatchArmed: true,
    updatedAt: 30,
  };
  const point = latestResumePoint({
    season: 2,
    episode: "2",
    dub: "AniDUB",
    episodes: { "2:2": state },
  });

  assert.equal(episodeResumePosition(state), 92);
  assert.equal(point?.key, "2:2");
  assert.equal(point?.state.position, 92);
});

test("continue watching resolves a persisted local title before the remote catalog", () => {
  const local = resolveResumeAnime([], 1248, "Локально сохранённое аниме");
  assert.deepEqual(local, {
    anime_id: 1248,
    title: "Локально сохранённое аниме",
  });
  assert.equal(
    resolveResumeAnime([{ anime_id: 1248, title: "Полная карточка" }], 1248, "Локальная")?.title,
    "Полная карточка",
  );
  assert.equal(resolveResumeAnime([], 1248, undefined), undefined);
});


import { outputSize, replacementPosition } from "../src/features/player/upscale.ts";
test("upscale fits the target rectangle, preserves aspect and never downsamples", () => {
  assert.deepEqual(outputSize(1280, 720, 1080), [1920, 1080]);
  assert.deepEqual(outputSize(1440, 1080, 2160), [2880, 2160]);
  assert.deepEqual(outputSize(1080, 1920, 1080), [1080, 1920]);
  assert.deepEqual(outputSize(3840, 2160, 1080), [3840, 2160]);
  assert.deepEqual(outputSize(0, 720, 1080), [0, 0]);
});
test("version replacement rewinds five seconds without inferring scene offsets", () => {
  assert.deepEqual(replacementPosition(60, 120), { time: 55, outside: false });
  assert.deepEqual(replacementPosition(3, 120), { time: 0, outside: false });
  assert.deepEqual(replacementPosition(121, 120), { time: 116, outside: true });
  assert.deepEqual(replacementPosition(180, 120), { time: 119, outside: true });
  assert.deepEqual(replacementPosition(60, NaN), { time: 55, outside: false });
});

import { animeMapRoute, animeRoute, routeFromLocation, routeForView } from "../src/features/navigation/routes.ts";
import { episodeNotifications } from "../src/lib/notifications.ts";

test("beta routes preserve distinct pages and episode deep links", () => {
  assert.equal(routeFromLocation("/tracking"), "tracking");
  assert.equal(routeFromLocation("/library/personal"), "library");
  assert.equal(routeFromLocation("/anime/1248"), "anime");
  assert.equal(routeFromLocation("/anime/1248/map"), "animeMap");
  assert.equal(animeMapRoute(1248), "/anime/1248/map");
  assert.equal(routeFromLocation("/missing"), "notFound");
  assert.equal(routeForView("history"), "/history");
  assert.equal(animeRoute(1248, 2, "13", true, 987), "/anime/1248?season=2&episode=13&play=1&origin=987");
});

test("new episode notification records keep read state and a target link", () => {
  const trackers = [{ animeId: 1248, title: "Аниме", knownEpisodes: 3, newEpisodes: 1,
    pendingEpisodeKeys: ["987:13"], lastNewEpisodeAt: 42 }];
  const unread = episodeNotifications(trackers, []);
  assert.equal(unread.length, 1);
  assert.equal(unread[0].read, false);
  assert.equal(unread[0].href, "/anime/1248?episode=13&play=1&origin=987");
  assert.equal(episodeNotifications(trackers, [unread[0].id])[0].read, true);
});


import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnimeFacts } from "../src/features/player/AnimeFacts.tsx";
import { AnimeTrailer } from "../src/features/player/AnimeTrailer.tsx";
import { ReleaseSchedule } from "../src/features/player/ReleaseSchedule.tsx";

test("release schedule is collapsed and only includes upcoming unaired episodes", () => {
  const entry = { anime_id: 1, title: "Test" };
  const group = { number: 1, entries: [entry] };
  const now = Math.floor(Date.now() / 1000);
  const html = renderToStaticMarkup(createElement(ReleaseSchedule, {
    showCountdown: false,
    rows: [
      { group, entry, item: { anime_id: 1, episodes: { aired: 2, count: 12, prev_date: now - 100, next_date: now + 3600 } } },
      { group, entry, item: { anime_id: 1, episodes: { aired: 1, count: 12, next_date: now + 1800 } } },
      { group, entry, item: { anime_id: 1, episodes: { aired: 2, next_date: now + 3600 } } },
      { group, entry: { ...entry, anime_id: 2 }, item: { anime_id: 2, episodes: { aired: 0, next_date: now - 1 } } },
      { group, entry: { ...entry, anime_id: 3 }, item: { anime_id: 3, episodes: { next_date: Infinity } } },
    ],
  }));
  assert.equal((html.match(/<article/g) ?? []).length, 1);
  assert.match(html, /<details class="release-schedule"><summary>/);
  assert.match(html, /Серия 3/);
  assert.doesNotMatch(html, /Серия 1|Серия 2|open=""|role="timer"/);
  assert.equal(renderToStaticMarkup(createElement(ReleaseSchedule, {
    rows: [], nextRelease: { anime: entry, timestamp: now - 1, episode: 4 },
  })), "");
});

test("anime facts show status without a schedule and a timer with a known release", () => {
  const anime = { anime_id: 1, title: "Test" };
  const released = renderToStaticMarkup(createElement(AnimeFacts, { anime, rows: [], metadata: { status: "released" } }));
  assert.match(released, /Вышло/);
  assert.doesNotMatch(released, /role="timer"|ГРАФИК ВЫХОДА/);
  const announced = renderToStaticMarkup(createElement(AnimeFacts, { anime, rows: [], metadata: { status: "anons", next_episode_at: new Date(Date.now() + 3600000).toISOString() } }));
  assert.match(announced, /Запланировано/);
  assert.match(announced, /role="timer"/);
});

test("anime trailer renders only a YouTube embed and removes an empty panel", () => {
  assert.equal(renderToStaticMarkup(createElement(AnimeTrailer, { animeId: 1, videos: [] })), "");
  assert.equal(renderToStaticMarkup(createElement(AnimeTrailer, { animeId: 1, videos: [{ url: "https://example.com/video.mp4" }] })), "");
  const trailer = renderToStaticMarkup(createElement(AnimeTrailer, { animeId: 1, videos: [{ url: "https://www.youtube.com/watch?v=abcdefghijk" }] }));
  assert.match(trailer, /<iframe/);
  assert.match(trailer, /https:\/\/www.youtube-nocookie.com\/embed\/abcdefghijk/);
});


test("anime information links use catalog filter values and a single premiere year", () => {
  const anime = { anime_id: 1, title: "Test", year: 2024, type: { name: "TV Сериал" }, anime_status: { title: "Выходит" } };
  const html = renderToStaticMarkup(createElement(AnimeFacts, { anime, rows: [] }));
  assert.match(html, /href="\/catalog\?format=series"/);
  assert.match(html, /href="\/catalog\?status=airing"/);
  assert.match(html, /href="\/catalog\?yearFrom=2024&amp;yearTo=2024"/);
  assert.match(html, /anime-facts-inline/);
  const detailed = renderToStaticMarkup(createElement(AnimeFacts, { anime, rows: [], metadata: { kind: "movie", status: "anons", aired_on: "2027-03-01", duration: 90 } }));
  assert.match(detailed, /href="\/catalog\?format=movie"/);
  assert.match(detailed, /href="\/catalog\?status=planned"/);
  assert.match(detailed, /yearFrom=2027&amp;yearTo=2027/);
  assert.doesNotMatch(detailed, /anime-facts-inline/);
});


import { animeCatalogFilters, animeFormat } from "../src/lib/catalogFilters.ts";

test("format links distinguish specials and OVA from TV series", () => {
  const anime = { anime_id: 1, title: "Test", type: { name: "OVA" } };
  assert.equal(animeFormat(anime), "ova");
  assert.equal(animeCatalogFilters(anime).format, "ova");
  assert.equal(animeFormat(anime, "tv_special"), "special");
  assert.equal(animeFormat(anime, "tv"), "series");
});


import { fetchTitleTrailers, metadataTrailers, preferredTrailerGroup } from "../src/features/player/franchiseTrailers.ts";

test("franchise trailers prefer the current season, any closest previous, then next", () => {
  assert.equal(preferredTrailerGroup([0, 2, 4], 2), 2);
  assert.equal(preferredTrailerGroup([0, 2, 4], 3), 2);
  assert.equal(preferredTrailerGroup([0, 4], 3), 0);
  assert.equal(preferredTrailerGroup([2, 4], 0), 2);
  assert.equal(preferredTrailerGroup([], 0), undefined);
});

test("franchise trailers exclude openings and duplicates and never retain autoplay", () => {
  const videos = metadataTrailers([
    { kind: "pv", url: "https://www.youtube.com/watch?v=abcdefghijk&autoplay=1" },
    { kind: "cm", url: "https://youtu.be/abcdefghijk" },
    { kind: "op", url: "https://youtu.be/zyxwvutsrqp" },
  ]);
  assert.equal(videos.length, 1);
  assert.equal(videos[0].url, "https://www.youtube-nocookie.com/embed/abcdefghijk");
});

test("franchise trailer loading merges providers and caches requests", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input);
    calls.push(url);
    return new Response(JSON.stringify(url.includes("mode=shikimori")
      ? { metadata: { videos: [{ kind: "pv", url: "https://youtu.be/abcdefghijk" }, { kind: "pv", url: "https://youtu.be/zyxwvutsrqp" }] } }
      : { trailers: [{ url: "https://youtu.be/abcdefghijk" }] }), { status: 200 });
  };
  try {
    const anime = { anime_id: 991234, title: "Season 2", remote_ids: { shikimori_id: 991235 } };
    const trailers = await fetchTitleTrailers(anime);
    assert.equal(trailers.length, 2);
    assert.deepEqual(await fetchTitleTrailers(anime), trailers);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});


import { AmbientBackdrop } from "../src/components/AmbientBackdrop.tsx";

test("shared ambient respects its title identity and the global off switch", () => {
  const anime = { anime_id: 123, title: "Last watched", poster: { big: "/poster-123.jpg" } };
  assert.match(renderToStaticMarkup(createElement(AmbientBackdrop, { anime })), /src="\/poster-123.jpg"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(AmbientBackdrop, { anime, animeId: 456 })), /<img/);
  assert.equal(renderToStaticMarkup(createElement(AmbientBackdrop, { anime, enabled: false })), "");
  assert.doesNotMatch(renderToStaticMarkup(createElement(AmbientBackdrop, {})), /<img/);
});


import { monthDays, dateKey } from "../src/pages/tracking/calendarDates.ts";

test("calendar always has six full weeks, Monday first, including leap years", () => {
  const leap = monthDays(new Date(2024, 1, 1));
  assert.equal(leap.length, 42);
  assert.equal(leap.filter(day => day.getMonth() === 1).length, 29);
  assert.equal(dateKey(leap[0]), "2024-01-29");
  assert.equal(dateKey(leap[41]), "2024-03-10");
  assert.equal(dateKey(leap[3]!), "2024-02-01");
  const feb = monthDays(new Date(2026, 1, 1));
  assert.equal(feb.length, 42);
  assert.equal(feb.filter(day => day.getMonth() === 1).length, 28);
  assert.equal(dateKey(feb[6]!), "2026-02-01");
  const january = monthDays(new Date(2027, 0, 1));
  assert.equal(dateKey(january[4]!), "2027-01-01");
  assert.equal(january.filter(day => day.getMonth() === 0).length, 31);
  assert.equal(dateKey(january[0]), "2026-12-28");
  assert.equal(dateKey(january[41]), "2027-02-07");
  for (const days of [leap, feb, january, monthDays(new Date(2026, 2, 1))]) {
    assert.equal(days[0].getDay(), 1);
    for (let i = 1; i < days.length; i++) {
      const next = new Date(days[i - 1]);
      next.setDate(next.getDate() + 1);
      assert.equal(dateKey(days[i]), dateKey(next));
    }
  }
});
