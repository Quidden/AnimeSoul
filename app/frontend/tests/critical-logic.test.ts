import assert from "node:assert/strict";
import test from "node:test";
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
  latestResumePoint,
  matchesAnimeSearch,
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
  assert.equal(playerTranslationId({ translation: { id: 610 } }), "610");
  assert.equal(playerTranslationId({ value: { translation_id: "711" } }), "711");
  assert.equal(playerTranslationId('{"translation":{"id":812}}'), "812");
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
