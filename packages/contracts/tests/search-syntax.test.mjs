import test from "node:test";
import assert from "node:assert/strict";
import {
  createSearchScorer,
  getSearchCompletionContext,
  normalizeSearchText,
  parseGlobalSearch,
  scoreSearchText,
  searchFilterDefinitions,
} from "../dist/search-syntax.js";

test("global search extracts quoted genres and catalog filters without losing title text", () => {
  assert.deepEqual(
    parseGlobalSearch(
      ' АОТ tag:"Боевые искусства" status:онгоинг year:2020-2026 type:сериал rating:8+ ',
    ),
    {
      text: "АОТ",
      filters: {
        genre: "Боевые искусства",
        status: "ongoing",
        from: 2020,
        to: 2026,
        format: "tv",
        minRating: 8,
      },
      issues: [],
    },
  );
  assert.deepEqual(parseGlobalSearch('genre;"Психологическое" год:2024 оценка:8,5 фильм'), {
    text: "фильм",
    filters: { genre: "Психологическое", from: 2024, to: 2024, minRating: 8.5 },
    issues: [],
  });
  assert.equal(
    parseGlobalSearch("Re:Zero Cowboy Bebop unknown:value").text,
    "Re:Zero Cowboy Bebop unknown:value",
  );
  assert.equal(parseGlobalSearch("constructor:Наруто").text, "constructor:Наруто");
  assert.deepEqual(parseGlobalSearch("status:released type:movie year:2024").filters, {
    status: "released",
    format: "movie",
    from: 2024,
    to: 2024,
  });
});

test("unfinished search filters stay usable while values are being typed", () => {
  assert.deepEqual(parseGlobalSearch("Наруто tag:"), { text: "Наруто", filters: {}, issues: [] });
  assert.deepEqual(parseGlobalSearch('tag:"Боевые искусства'), {
    text: "",
    filters: { genre: "Боевые искусства" },
    issues: [],
  });
  assert.deepEqual(parseGlobalSearch("тег:'Идолы (Жен.)'"), {
    text: "",
    filters: { genre: "Идолы (Жен.)" },
    issues: [],
  });
  assert.deepEqual(parseGlobalSearch('tag:"Школа \\"звёзд\\""').filters, {
    genre: 'Школа "звёзд"',
  });
  assert.deepEqual(parseGlobalSearch('tag:"Драма" tag:"Комедия"').filters, { genre: "Комедия" });
});

test("invalid filters report useful errors without leaking out-of-range catalog values", () => {
  for (const query of [
    "year:1899",
    "year:2201",
    "year:2026-2020",
    "year:2024x",
    "rating:11",
    "rating:-1",
    "status:maybe",
    "status:constructor",
    "type:podcast",
    `tag:"${"а".repeat(101)}"`,
  ]) {
    const parsed = parseGlobalSearch(query);
    assert.equal(parsed.issues.length, 1, query);
    assert.deepEqual(parsed.filters, {}, query);
  }
  const longQuery = parseGlobalSearch("а".repeat(241));
  assert.match(longQuery.issues[0], /240/u);
  assert.equal(longQuery.text.length, 240);
  assert.equal(parseGlobalSearch("rating:0 year:1900").filters.minRating, 0);
  assert.equal(parseGlobalSearch("rating:10 year:2200").filters.to, 2200);
});

test("completion replaces the complete filter token and respects the cursor", () => {
  const query = 'АОТ genre:"Психо" year:2024';
  const context = getSearchCompletionContext(query, query.indexOf(" year:"));
  assert.deepEqual(context, { key: "tag", value: "Психо", start: 4, end: 17 });
  const completed = `${query.slice(0, context.start)}tag:"Психологическое"${query.slice(context.end)}`;
  assert.equal(completed, 'АОТ tag:"Психологическое" year:2024');
  assert.deepEqual(parseGlobalSearch(completed).filters, {
    genre: "Психологическое",
    from: 2024,
    to: 2024,
  });
  assert.deepEqual(getSearchCompletionContext("tag:"), { key: "tag", value: "", start: 0, end: 4 });
  assert.deepEqual(getSearchCompletionContext('тег;"Боевые ис'), {
    key: "tag",
    value: "Боевые ис",
    start: 0,
    end: 14,
  });
  assert.deepEqual(getSearchCompletionContext('tag:"Психо"', 8), {
    key: "tag",
    value: "Пси",
    start: 0,
    end: 11,
  });
  assert.equal(getSearchCompletionContext("Наруто"), null);
  assert.equal(getSearchCompletionContext("Re:Zero"), null);
  assert.equal(getSearchCompletionContext('tag:"Драма" Наруто'), null);
  assert.equal(getSearchCompletionContext('tag:"Драма"', 2), null);
});

test("every suggested filter value can be parsed and examples have no errors", () => {
  assert.deepEqual(
    searchFilterDefinitions.map((item) => item.key),
    ["tag", "status", "type", "year", "rating"],
  );
  for (const definition of searchFilterDefinitions) {
    assert.deepEqual(parseGlobalSearch(definition.example).issues, [], definition.example);
    for (const value of definition.values ?? []) {
      assert.deepEqual(
        parseGlobalSearch(`${definition.key}:"${value.value}"`).issues,
        [],
        value.label,
      );
    }
  }
});

test("search ranks aliases, Unicode, abbreviations and bounded typos above unrelated titles", () => {
  assert.equal(normalizeSearchText("  СЁНЭН — café / Hero's "), "сенэн cafe hero s");
  const exact = scoreSearchText("Наруто", "Наруто");
  const prefix = scoreSearchText("Наруто", "Наруто: Ураганные хроники");
  const substring = scoreSearchText("Наруто", "Фильм Наруто");
  const typo = scoreSearchText("Нарутo", "Наруто");
  assert.ok(exact > prefix && prefix > substring && substring > typo);
  assert.ok(typo > 0);
  assert.ok(scoreSearchText("наруто", "Нарто") > 0);
  assert.ok(scoreSearchText("психолгическое", "Психологическое") > 0);
  assert.ok(scoreSearchText("ghbdftn", "Привет") > 0);
  assert.ok(scoreSearchText("yfh enj", "Наруто") === 0);
  assert.ok(scoreSearchText("aot", "Attack on Titan") > 0);
  assert.ok(scoreSearchText("врата каменные", "Каменные врата") > 0);
  assert.ok(scoreSearchText("наруот", "Наруто") > 0);
  assert.equal(scoreSearchText("кот", "кит"), 0);
  assert.equal(scoreSearchText("музыка", "Настройки уведомлений"), 0);
  assert.equal(scoreSearchText("", "Наруто"), 0);
  assert.equal(scoreSearchText("а".repeat(241), "Наруто"), 0);
});

test("a prepared search scorer keeps the same ranking across repeated cached candidates", () => {
  const titles = [
    "Наруто",
    "Наруто: Ураганные хроники",
    "Attack on Titan",
    "Врата Штейна",
    "Violet Evergarden",
    "Кошка",
    "Колобок",
    "Боевые искусства",
  ];
  for (const query of [
    "Наруто",
    "наруот",
    "aot",
    "Viloet Evregarden",
    "кошка",
    "yfh enj",
    "",
    "а".repeat(241),
  ]) {
    const score = createSearchScorer(query);
    for (const title of titles) {
      assert.equal(score(title), scoreSearchText(query, title));
      assert.equal(score(normalizeSearchText(title), true), score(title));
    }
  }
  assert.ok(createSearchScorer("колобок")("колбоок") > 0);
  assert.ok(createSearchScorer("кошка")("кшка") > 0);
  assert.ok(createSearchScorer("𠮷田郎")("𠮷田太郎") > 0);
});
