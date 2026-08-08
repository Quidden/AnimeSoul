import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgeTrackedEpisode,
  compareTrackedByRelease,
  collectPlayableEpisodeDates,
  reconcileTrackedEpisodes,
} from "../src/lib/tracking.ts";
import {
  episodeResumePosition,
  latestResumePoint,
  toggleEpisodeWatched,
} from "../src/lib/anime.ts";
import {
  playbackChangedByUser,
  playbackReachedTarget,
} from "../src/lib/watchPartyLogic.ts";
import { kodikSerialIdentity, kodikSerialSource, playerDubbing, playerEpisode, playerTranslationId } from "../src/lib/kodik.ts";

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
