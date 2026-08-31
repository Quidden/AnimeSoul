import assert from "node:assert/strict";
import test from "node:test";
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

test("player preferences follow manual override, global preferred voice, favourites, then provider", () => {
  const available = ["Kodik default", "AniLibria", "Dream Cast"];
  assert.equal(preferredDubbing(available, "Dream Cast", "AniLibria", [], "Kodik default"), "Dream Cast");
  assert.equal(preferredDubbing(available, "", "Dream Cast", ["AniLibria"], "Kodik default"), "Dream Cast");
  assert.equal(preferredDubbing(available, "", "Missing", ["AniLibria", "Dream Cast"], "Kodik default"), "AniLibria");
  assert.equal(preferredDubbing(available, "", "", ["Missing"], "Kodik default"), "Kodik default");
  assert.equal(preferredDubbing(available, "", "", [], ""), "Kodik default");
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
    "Fallback",
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

test("custom player keeps the picture when only the dubbing changes", () => {
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
