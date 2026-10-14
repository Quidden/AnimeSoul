import { Buffer } from "node:buffer";
import test from "node:test";
import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { getSearchCompletionContext, parseGlobalSearch } from "../packages/contracts/dist/index.js";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/search-completion.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const { completeSearchFilter, getSearchGhostSuffix, isSearchFilterUnclosed } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("inline completion appends a literal suffix and preserves what the user typed", () => {
  for (const [query, completed, expected] of [
    ["нар", "Наруто", "уто"],
    ["Re", "Re:Zero", ":Zero"],
    ["НАРУ", "Наруто", "то"],
    ["sora_", "Sora_NightTea", "NightTea"],
  ]) {
    const suffix = getSearchGhostSuffix(query, completed, query.length, query.length);
    assert.equal(suffix, expected);
    assert.equal((query + suffix).startsWith(query), true);
  }
});

test("filter completion preserves literal syntax and closes either quote style", () => {
  for (const [query, value, completion] of [
    ["tag:Псих", "Психологическое", "tag:Психологическое "],
    ["genre;псих", "Психологическое", "genre;психологическое "],
    ['тег : "Псих', "Психологическое", 'тег : "Психологическое" '],
    ["жанр;'Боевые ис", "Боевые искусства", "жанр;'Боевые искусства' "],
    ['tag:"Драма', "Драма", 'tag:"Драма" '],
  ]) {
    const context = getSearchCompletionContext(query);
    assert.notEqual(context, null, query);
    const result = completeSearchFilter(query, context, value);
    assert.equal(result.completion, completion);
    assert.equal(result.caret, completion.length);
    assert.equal(result.completion.startsWith(query), true);
    assert.notEqual(
      getSearchGhostSuffix(query, result.completion, query.length, query.length),
      null,
    );
    assert.equal(
      parseGlobalSearch(result.completion).filters.genre.toLocaleLowerCase("ru-RU"),
      value.toLocaleLowerCase("ru-RU"),
    );
    assert.deepEqual(parseGlobalSearch(result.completion).issues, []);
  }
});

test("filter completion replaces fuzzy values, quotes multiword input and preserves following filters", () => {
  for (const [query, caret, value, completion] of [
    ["АОТ genre;Психл year:2024", 14, "Психологическое", 'АОТ tag:"Психологическое" year:2024'],
    ["тег:Боевые", 10, "Боевые искусства", 'tag:"Боевые искусства" '],
    ['tag:"Псих"  status:онгоинг', 10, "Психологическое", 'tag:"Психологическое"  status:онгоинг'],
  ]) {
    const context = getSearchCompletionContext(query, caret);
    assert.notEqual(context, null, query);
    const result = completeSearchFilter(query, context, value);
    assert.equal(result.completion, completion);
    assert.deepEqual(parseGlobalSearch(result.completion).issues, []);
    assert.equal(parseGlobalSearch(result.completion).filters.genre, value);
    assert.equal(
      result.caret,
      completion.indexOf(" ", completion.indexOf(value) + value.length) + 1,
    );
  }
});

test("quote completion distinguishes a missing delimiter from escaped quotes and keeps values intact", () => {
  for (const [query, value] of [
    [String.raw`tag:"Школа \"звёз`, 'Школа "звёзд"'],
    [String.raw`genre;'Ведьма \'`, "Ведьма 'Кики'"],
    ['tag:"C:\\', "C:\\"],
  ]) {
    const context = getSearchCompletionContext(query);
    assert.notEqual(context, null, query);
    assert.equal(isSearchFilterUnclosed(query, context), true, query);
    const result = completeSearchFilter(query, context, value);
    assert.equal(parseGlobalSearch(result.completion).filters.genre, value);
    assert.deepEqual(parseGlobalSearch(result.completion).issues, []);
    const completedContext = getSearchCompletionContext(result.completion.trimEnd());
    assert.equal(isSearchFilterUnclosed(result.completion, completedContext), false);
  }
  for (const query of ['tag:"Драма"', "tag:'Драма'", "tag:Драма"]) {
    assert.equal(isSearchFilterUnclosed(query, getSearchCompletionContext(query)), false, query);
  }
});

test("filter suffixes keep existing quotes and accepted syntax intact", () => {
  for (const [query, completed, expectedGenre] of [
    ["tag:Псих", "tag:Психологическое", "Психологическое"],
    ['tag:"Псих', 'tag:"Психологическое"', "Психологическое"],
    ["genre;'Боевые ис", "genre;'Боевые искусства'", "Боевые искусства"],
    ['АОТ тег:"Боевые ис', 'АОТ тег:"Боевые искусства"', "Боевые искусства"],
  ]) {
    const suffix = getSearchGhostSuffix(query, completed, query.length, query.length);
    assert.notEqual(suffix, null, query);
    const accepted = parseGlobalSearch(query + suffix);
    assert.equal(accepted.filters.genre, expectedGenre);
    assert.deepEqual(accepted.issues, []);
  }
  assert.equal(getSearchGhostSuffix("tag:Псих", 'tag:"Психологическое"', 8, 8), null);
  assert.equal(getSearchGhostSuffix("tag:Боевые", 'tag:"Боевые искусства"', 10, 10), null);
});

test("inline completion stays hidden for selections, cursor edits and fuzzy replacements", () => {
  assert.equal(getSearchGhostSuffix("Нар", "Наруто", 1, 1), null);
  assert.equal(getSearchGhostSuffix("Нар", "Наруто", 0, 3), null);
  assert.equal(getSearchGhostSuffix("Нар", "Наруто", null, null), null);
  assert.equal(getSearchGhostSuffix("Нар", "Наруто", 4, 4), null);
  assert.equal(getSearchGhostSuffix("reze", "Re:Zero", 4, 4), null);
  assert.equal(getSearchGhostSuffix("Нра", "Наруто", 3, 3), null);
  assert.equal(getSearchGhostSuffix("АОТ", "Атака титанов", 3, 3), null);
  assert.equal(getSearchGhostSuffix("Наруто", "Наруто", 6, 6), null);
  assert.equal(getSearchGhostSuffix("Наруто", "Нар", 6, 6), null);
  assert.equal(getSearchGhostSuffix("", "Наруто", 0, 0), null);
  assert.equal(getSearchGhostSuffix(" ", " Наруто", 1, 1), null);
});
