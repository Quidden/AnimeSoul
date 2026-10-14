export type GlobalSearchFilters = {
  genre?: string;
  status?: "ongoing" | "released" | "announced";
  format?: "tv" | "movie" | "ova" | "ona" | "special" | "music";
  from?: number;
  to?: number;
  minRating?: number;
};

export type SearchFilterKey = "tag" | "status" | "type" | "year" | "rating";

export type SearchFilterDefinition = {
  key: SearchFilterKey;
  label: string;
  description: string;
  example: string;
  values?: { label: string; value: string }[];
};

export const searchFilterDefinitions: SearchFilterDefinition[] = [
  {
    key: "tag",
    label: "Жанр",
    description: "Аниме выбранного жанра. Названия с пробелами заключите в кавычки.",
    example: 'tag:"Психологическое"',
  },
  {
    key: "status",
    label: "Статус",
    description: "Онгоинги, завершённые аниме или анонсы.",
    example: "status:онгоинг",
    values: [
      { label: "Онгоинг", value: "онгоинг" },
      { label: "Вышло", value: "вышло" },
      { label: "Анонс", value: "анонс" },
    ],
  },
  {
    key: "type",
    label: "Формат",
    description: "Сериалы, фильмы и другие форматы.",
    example: "type:фильм",
    values: [
      { label: "Сериал", value: "сериал" },
      { label: "Фильм", value: "фильм" },
      { label: "OVA", value: "ova" },
      { label: "ONA", value: "ona" },
      { label: "Спецвыпуск", value: "спецвыпуск" },
      { label: "Клип", value: "клип" },
    ],
  },
  {
    key: "year",
    label: "Год",
    description: "Год выхода или диапазон лет, например 2020–2026.",
    example: "year:2024",
  },
  {
    key: "rating",
    label: "Оценка",
    description: "Минимальная оценка от 0 до 10.",
    example: "rating:8+",
    values: [
      { label: "От 9", value: "9+" },
      { label: "От 8", value: "8+" },
      { label: "От 7", value: "7+" },
    ],
  },
];

const keyAliases: Record<string, SearchFilterKey> = {
  tag: "tag",
  genre: "tag",
  тег: "tag",
  жанр: "tag",
  status: "status",
  статус: "status",
  type: "type",
  format: "type",
  тип: "type",
  формат: "type",
  year: "year",
  год: "year",
  rating: "rating",
  оценка: "rating",
  рейтинг: "rating",
};

const statuses: Record<string, NonNullable<GlobalSearchFilters["status"]>> = {
  ongoing: "ongoing",
  онгоинг: "ongoing",
  онгоинги: "ongoing",
  released: "released",
  completed: "released",
  вышло: "released",
  завершено: "released",
  завершенные: "released",
  announced: "announced",
  анонс: "announced",
  анонсы: "announced",
};

const formats: Record<string, NonNullable<GlobalSearchFilters["format"]>> = {
  tv: "tv",
  series: "tv",
  сериал: "tv",
  сериалы: "tv",
  movie: "movie",
  film: "movie",
  фильм: "movie",
  фильмы: "movie",
  ova: "ova",
  ona: "ona",
  special: "special",
  спецвыпуск: "special",
  music: "music",
  клип: "music",
};

type FilterToken = {
  key: SearchFilterKey;
  value: string;
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
};

function unquoteValue(value: string) {
  return value.replace(/\\([\\"'])/g, "$1");
}

function filterTokens(query: string): FilterToken[] {
  const tokens: FilterToken[] = [];
  const keyPattern = /(^|\s)([\p{L}]+)\s*[:;]\s*/gu;
  let match: RegExpExecArray | null;
  while ((match = keyPattern.exec(query))) {
    const alias = match[2]!.toLowerCase();
    const key = Object.hasOwn(keyAliases, alias) ? keyAliases[alias] : undefined;
    if (!key) continue;
    const start = match.index + match[1]!.length;
    let valueStart = keyPattern.lastIndex;
    let end = valueStart;
    let valueEnd: number;
    const quote = query[valueStart];
    if (quote === '"' || quote === "'") {
      valueStart++;
      end = valueStart;
      while (end < query.length) {
        if (query[end] === "\\" && end + 1 < query.length) end += 2;
        else if (query[end] === quote) break;
        else end++;
      }
      valueEnd = end;
      if (query[end] === quote) end++;
    } else {
      while (end < query.length && !/\s/u.test(query[end]!)) end++;
      valueEnd = end;
    }
    tokens.push({
      key,
      value: unquoteValue(query.slice(valueStart, valueEnd)),
      start,
      end,
      valueStart,
      valueEnd,
    });
    keyPattern.lastIndex = end;
  }
  return tokens;
}

export function parseGlobalSearch(query: string): {
  text: string;
  filters: GlobalSearchFilters;
  issues: string[];
} {
  const filters: GlobalSearchFilters = {};
  const issues: string[] = [];
  if (query.length > 240) issues.push("Поисковый запрос должен быть не длиннее 240 символов.");
  const boundedQuery = query.slice(0, 240);
  const tokens = filterTokens(boundedQuery);
  const textParts: string[] = [];
  let cursor = 0;
  for (const token of tokens) {
    textParts.push(boundedQuery.slice(cursor, token.start));
    cursor = token.end;
    const value = token.value.trim();
    if (!value) continue;
    switch (token.key) {
      case "tag":
        if (value.length <= 100 && !/\p{Cc}/u.test(value)) filters.genre = value;
        else issues.push("Название жанра должно быть не длиннее 100 символов.");
        break;
      case "status": {
        const normalized = normalizeSearchText(value);
        const status = Object.hasOwn(statuses, normalized) ? statuses[normalized] : undefined;
        if (status) filters.status = status;
        else issues.push("Укажите статус: онгоинг, вышло или анонс.");
        break;
      }
      case "type": {
        const normalized = normalizeSearchText(value);
        const format = Object.hasOwn(formats, normalized) ? formats[normalized] : undefined;
        if (format) filters.format = format;
        else issues.push("Укажите формат: сериал, фильм, OVA, ONA, спецвыпуск или клип.");
        break;
      }
      case "year": {
        const years = /^(\d{4})(?:\s*[-–—]\s*(\d{4}))?$/u.exec(value);
        const from = Number(years?.[1]);
        const to = Number(years?.[2] ?? years?.[1]);
        if (years && from >= 1900 && to <= 2200 && from <= to) {
          filters.from = from;
          filters.to = to;
        } else issues.push("Укажите год от 1900 до 2200 или диапазон, например year:2020-2026.");
        break;
      }
      case "rating": {
        const rating = /^(\d{1,2}(?:[.,]\d{1,2})?)\+?$/u.exec(value);
        const minRating = Number(rating?.[1]?.replace(",", "."));
        if (rating && minRating >= 0 && minRating <= 10) filters.minRating = minRating;
        else issues.push("Укажите минимальную оценку от 0 до 10, например rating:8+.");
        break;
      }
    }
  }
  textParts.push(boundedQuery.slice(cursor));
  return {
    text: textParts.join(" ").replace(/\s+/gu, " ").trim(),
    filters,
    issues: [...new Set(issues)],
  };
}

export function getSearchCompletionContext(
  query: string,
  caret = query.length,
): { key: SearchFilterKey; value: string; start: number; end: number } | null {
  const position = Math.max(0, Math.min(query.length, caret));
  const token = filterTokens(query.slice(0, 240)).find(
    (item) => position >= item.valueStart && position <= item.end,
  );
  if (!token) return null;
  return {
    key: token.key,
    value: unquoteValue(query.slice(token.valueStart, Math.min(position, token.valueEnd))),
    start: token.start,
    end: token.end,
  };
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function boundedDistance(left: string, right: string, maximum: number): number {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let beforePrevious: number[] = [];
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      let distance = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        distance = Math.min(distance, beforePrevious[j - 2]! + 1);
      }
      current.push(distance);
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > maximum) return maximum + 1;
    beforePrevious = previous;
    previous = current;
  }
  return previous[right.length]!;
}

type PreparedSearchWord = { text: string; characters: Set<string>; maximum: number };
type PreparedSearchQuery = { text: string; compact: string; words: PreparedSearchWord[] };

function prepareSearchQuery(text: string): PreparedSearchQuery {
  return {
    text,
    compact: text.replace(/ /gu, ""),
    words: text
      .split(" ")
      .filter(Boolean)
      .map((word) => ({
        text: word,
        characters: new Set(word.split("")),
        maximum: word.length >= 6 ? 2 : 1,
      })),
  };
}

function couldBeTypo(query: PreparedSearchWord, candidate: string): boolean {
  if (Math.abs(query.text.length - candidate.length) > query.maximum) return false;
  const required = Math.max(query.text.length, candidate.length) - query.maximum;
  let common = 0;
  for (let index = 0; index < candidate.length; index++) {
    if (query.characters.has(candidate[index]!)) common++;
  }
  // This upper bound deliberately counts repeated characters: it can only reject impossible matches.
  return common >= required;
}

function scoreNormalized(query: PreparedSearchQuery, candidate: string): number {
  if (!query.text || !candidate) return 0;
  if (query.text === candidate) return 1000;
  if (candidate.startsWith(query.text))
    return 900 - Math.min(70, candidate.length - query.text.length);
  const position = candidate.indexOf(query.text);
  if (position >= 0) return (candidate[position - 1] === " " ? 800 : 700) - Math.min(60, position);
  const words = candidate.split(" ").filter(Boolean);
  if (query.compact.length >= 2 && words.length === query.compact.length) {
    const initials = words.map((word) => word[0]).join("");
    if (initials === query.compact) return 780;
  }
  const usedWords = query.words.length > 1 ? new Set<number>() : null;
  let total = 0;
  for (const queryWord of query.words) {
    let best = 0;
    let bestIndex = -1;
    for (let index = 0; index < words.length; index++) {
      if (usedWords?.has(index)) continue;
      const word = words[index]!;
      let score = 0;
      if (queryWord.text === word) score = 760;
      else if (word.startsWith(queryWord.text)) score = 680;
      else if (queryWord.text.length >= 4 && word.length <= 100 && couldBeTypo(queryWord, word)) {
        const distance = boundedDistance(queryWord.text, word, queryWord.maximum);
        if (distance <= queryWord.maximum) score = 550 - distance * 65;
      }
      if (score > best) {
        best = score;
        bestIndex = index;
      }
      if (best === 760) break;
    }
    if (!best) return 0;
    total += best;
    usedWords?.add(bestIndex);
  }
  return Math.round(total / query.words.length);
}

const latinKeyboard = "qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const russianKeyboard = "йцукенгшщзхъфывапролджэячсмитьбю";

function switchKeyboardLayout(value: string): string {
  const lower = value.toLowerCase();
  const letters = lower.replace(/[^\p{L}]/gu, "");
  if (!letters || !(/^[a-z]+$/u.test(letters) || /^[а-яё]+$/u.test(letters))) return value;
  const latin = /^[a-z]+$/u.test(letters);
  const from = latin ? latinKeyboard : russianKeyboard;
  const to = latin ? russianKeyboard : latinKeyboard;
  return [...lower].map((character) => to[from.indexOf(character)] ?? character).join("");
}

export function createSearchScorer(
  query: string,
): (candidate: string, alreadyNormalized?: boolean) => number {
  if (query.length > 240) return () => 0;
  const normalizedQuery = normalizeSearchText(query);
  const prepared = prepareSearchQuery(normalizedQuery);
  const alternateQuery = normalizeSearchText(switchKeyboardLayout(query));
  const alternatePrepared =
    alternateQuery === normalizedQuery ? null : prepareSearchQuery(alternateQuery);
  return (candidate, alreadyNormalized = false) => {
    const normalizedCandidate = alreadyNormalized
      ? candidate.slice(0, 1000)
      : normalizeSearchText(candidate.slice(0, 1000));
    const direct = scoreNormalized(prepared, normalizedCandidate);
    if (!alternatePrepared || direct >= 910) return direct;
    const alternate = scoreNormalized(alternatePrepared, normalizedCandidate);
    return Math.max(direct, alternate > 0 ? alternate - 90 : 0);
  };
}

export function scoreSearchText(query: string, candidate: string): number {
  return createSearchScorer(query)(candidate);
}
