import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgeTrackedEpisode,
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
