import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  embeddedPlayerEvent,
  episodeLabel,
  episodeHref,
  timestampSchema,
  publicMediaUrl,
} from "../dist/index.js";
test("canonical episode links preserve identity and constrain timestamps", () => {
  const id = randomUUID();
  assert.equal(episodeLabel(" 001 "), "1");
  assert.equal(episodeLabel("OVA"), "ova");
  assert.equal(episodeLabel("01.5"), "1.5");
  assert.equal(episodeHref("anime", id, 125.8), `/anime/anime/episodes/${id}?t=125`);
  for (const value of [-1, "-1", "NaN", "1e2", "999999", ["10"], "2;alert(1)"])
    assert.equal(timestampSchema.safeParse(value).success, false);
  assert.equal(timestampSchema.parse("86400"), 86400);
  assert.equal(timestampSchema.parse("125.5"), 125.5);
});
test("iframe events accept only bounded known events from the exact player origin", () => {
  const url = "https://kodik.info/seria/1/hash/720p",
    event = { key: "kodik_player_time_update", value: { time: 42, duration: 120 } };
  assert.deepEqual(embeddedPlayerEvent(event, "https://kodik.info", url), {
    kind: "time",
    position: 42,
    duration: 120,
  });
  assert.equal(embeddedPlayerEvent(event, "https://kodik.info.attacker.com", url), null);
  assert.deepEqual(
    embeddedPlayerEvent(
      {
        key: "kodik_player_current_episode",
        value: { episode: 3, season: 2, translation: { id: 7, title: "Мега-Аниме" } },
      },
      "https://kodik.info",
      url,
    ),
    { kind: "episode", number: "3", season: "2", translation: "Мега-Аниме" },
  );
  for (const key of ["kodik_player_seek", "kodik_player_time"]) {
    assert.deepEqual(embeddedPlayerEvent({ key, value: 30 }, "https://kodik.info", url), {
      kind: "seek",
      position: 30,
    });
    assert.equal(embeddedPlayerEvent({ key, value: -1 }, "https://kodik.info", url), null);
    assert.equal(embeddedPlayerEvent({ key, value: 86401 }, "https://kodik.info", url), null);
    assert.equal(embeddedPlayerEvent({ key, value: 30 }, "https://attacker.com", url), null);
  }
  assert.equal(embeddedPlayerEvent({ ...event, value: Infinity }, "https://kodik.info", url), null);
  assert.equal(
    embeddedPlayerEvent({ ...event, value: { time: 100, duration: 5 } }, "https://kodik.info", url),
    null,
  );
  assert.equal(embeddedPlayerEvent("x".repeat(16385), "https://kodik.info", url), null);
  assert.equal(
    embeddedPlayerEvent(
      { key: "navigate", value: "https://attacker.com" },
      "https://kodik.info",
      url,
    ),
    null,
  );
  assert.equal(publicMediaUrl("https://media.example.com/v.m3u8"), true);
  assert.equal(publicMediaUrl("https://[::1]/v"), false);
});
