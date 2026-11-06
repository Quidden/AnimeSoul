import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/anime-releases.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const { animeReleases, parseReleaseDate, formatReleaseDate, releaseCountdown } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const now = Date.parse("2026-10-17T10:00:00Z");
const title = (id, status, details = {}, format = "tv") => ({
  id,
  slug: `anime-${id}`,
  title: `История: сезон ${id}`,
  status,
  format,
  details,
  year: 2027,
});
const franchise = (...titles) => ({
  currentAnimeId: titles[0].id,
  items: titles.map((anime) => ({ anime, episodes: [] })),
  externalLinks: [],
});

test("a completed season shows separate, named timers for the airing season and its announced sequel", () => {
  const old = title(1, "released", { nextEpisodeAt: "2027-10-20T10:00:00Z" });
  const airing = title(2, "ongoing", {
    nextEpisodeAt: "2026-10-18T10:00:00Z",
    episodesAired: 7,
    episodesTotal: 12,
  });
  const sequel = title(3, "announced", { airedAt: "2027-01-12" });
  const result = animeReleases(old, franchise(old, sequel, airing), now);
  assert.deepEqual(
    result.map((entry) => entry.animeId),
    [2, 3],
  );
  assert.equal(result[0].label, "Следующая серия актуального сезона");
  assert.equal(result[0].title, airing.title);
  assert.equal(result[0].episode, 8);
  assert.equal(result[0].date.value, airing.details.nextEpisodeAt);
  assert.equal(result[1].label, "Премьера нового сезона");
  assert.equal(result[1].title, sequel.title);
  assert.equal(result[1].episode, 1);
  assert.equal(result[1].date.precision, "day");
});

test("undated episodes and seasons stay planned without inventing a date or episode number", () => {
  const airing = title(1, "ongoing");
  const sequel = title(2, "announced");
  const result = animeReleases(airing, franchise(airing, sequel), now);
  assert.equal(result.length, 2);
  assert.equal(result[0].plannedLabel, "Новая серия запланирована");
  assert.equal(result[0].episode, null);
  assert.equal(result[1].plannedLabel, "Новый сезон запланирован");
  assert.ok(result.every((entry) => entry.date === null));
});

test("two airing seasons retain independent episode numbers and timestamps even on the same day", () => {
  const first = title(1, "ongoing", {
    episodesAired: 10,
    nextEpisodeAt: "2026-10-18T12:00:00+03:00",
  });
  const second = title(2, "ongoing", {
    episodesAired: 2,
    nextEpisodeAt: "2026-10-18T15:00:00+03:00",
  });
  const result = animeReleases(first, franchise(first, second), now);
  assert.deepEqual(
    result.map((entry) => entry.episode),
    [11, 3],
  );
  assert.equal(result[1].date.timestamp - result[0].date.timestamp, 3 * 3600000);
});

test("stale schedules do not count backwards or use an old premiere for an ongoing season", () => {
  const airing = title(1, "ongoing", {
    nextEpisodeAt: "2026-10-16T12:00:00Z",
    airedAt: "2026-10-01",
    episodesAired: 3,
  });
  const finished = title(2, "ongoing", { episodesAired: 12, episodesTotal: 12 });
  const delayed = title(3, "announced", { airedAt: "2026-10-01" });
  const result = animeReleases(airing, franchise(airing, finished, delayed), now);
  assert.deepEqual(
    result.map((entry) => entry.animeId),
    [1, 3],
  );
  assert.ok(result.every((entry) => entry.date === null));
  const date = parseReleaseDate("2026-10-17T10:00:01Z");
  assert.equal(releaseCountdown(date, now), "0 д 00 ч 00 мин 01 с");
  assert.equal(releaseCountdown(date, now + 1000), "Ожидаем подтверждения выхода");
  assert.equal(releaseCountdown(date, now + 100000), "Ожидаем подтверждения выхода");
});

test("calendar dates count calendar days in Kyiv across DST without claiming a broadcast time", () => {
  const date = parseReleaseDate("2026-10-26");
  assert.equal(releaseCountdown(date, Date.parse("2026-10-24T22:30:00Z")), "Через 1 дн.");
  assert.equal(releaseCountdown(date, Date.parse("2026-10-25T22:30:00Z")), "Сегодня");
  assert.equal(releaseCountdown(date, Date.parse("2026-10-26T21:59:59Z")), "Сегодня");
  assert.equal(
    releaseCountdown(date, Date.parse("2026-10-26T22:00:00Z")),
    "Ожидаем подтверждения выхода",
  );
  const today = title(1, "announced", { airedAt: "2026-10-17" });
  assert.ok(animeReleases(today, franchise(today), now)[0].date);
  assert.match(formatReleaseDate(date), /26 октября 2026/);
  assert.doesNotMatch(formatReleaseDate(date), /00:00|Киев/);
});

test("only valid full dates and zoned timestamps can start a countdown", () => {
  for (const value of [
    undefined,
    "",
    "2027",
    "2027-01",
    "2027-02-29",
    "2027-00-00",
    "2027-04-31",
    "2027-13-01",
    "2027-01-01T12:00:00",
    "2027-01-01T25:00:00Z",
    "2027-01-01junk",
  ])
    assert.equal(parseReleaseDate(value), null, String(value));
  const date = parseReleaseDate("2026-10-18T15:04:03+03:00");
  assert.equal(date.timestamp, Date.parse("2026-10-18T12:04:03Z"));
  assert.equal(releaseCountdown(date, now), "1 д 02 ч 04 мин 03 с");
  assert.match(formatReleaseDate(date), /15:04.*Киев/);
  const planned = title(1, "announced", { airedAt: "2027-04-31" });
  assert.equal(animeReleases(planned, franchise(planned), now)[0].date, null);
});

test("current metadata wins once per title and external crossover announcements are excluded", () => {
  const saved = title(1, "ongoing", { nextEpisodeAt: "2026-10-18T12:00:00Z" });
  const current = title(1, "ongoing", { nextEpisodeAt: "2026-10-19T12:00:00Z" });
  const graph = franchise(saved);
  graph.externalLinks.push({ anime: title(9, "announced") });
  const result = animeReleases(current, graph, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].date.value, current.details.nextEpisodeAt);
  const movie = title(2, "announced", {}, "movie");
  const filmRelease = animeReleases(movie, franchise(movie), now)[0];
  assert.equal(filmRelease.label, "Премьера фильма");
  assert.equal(filmRelease.plannedLabel, "Фильм запланирован");
  assert.equal(filmRelease.episode, null);
  assert.deepEqual(animeReleases(title(3, "released"), franchise(title(3, "released")), now), []);
});
