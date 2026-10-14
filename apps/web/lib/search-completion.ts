export function getSearchGhostSuffix(
  query: string,
  completedQuery: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): string | null {
  if (
    !query.trim() ||
    selectionStart !== query.length ||
    selectionEnd !== query.length ||
    completedQuery.length <= query.length ||
    completedQuery.slice(0, query.length).toLocaleLowerCase("ru-RU") !==
      query.toLocaleLowerCase("ru-RU")
  )
    return null;
  return completedQuery.slice(query.length);
}

type SearchFilterCompletionContext = { start: number; end: number; key: string };

function inspectFilterToken(query: string, context: SearchFilterCompletionContext) {
  const token = query.slice(context.start, context.end);
  const match = /^([\p{L}]+\s*[:;]\s*)(["']?)/u.exec(token);
  if (!match) return null;
  const prefix = match[1]!;
  const quote = match[2]!;
  const body = token.slice(prefix.length + quote.length);
  let end = body.length;
  let closed = false;
  if (quote) {
    for (let index = 0; index < body.length; index++) {
      if (body[index] === "\\" && index + 1 < body.length) index++;
      else if (body[index] === quote) {
        end = index;
        closed = true;
        break;
      }
    }
  }
  const rawValue = body.slice(0, end);
  return {
    prefix,
    quote,
    rawValue,
    value: rawValue.replace(/\\([\\"'])/gu, "$1"),
    closed,
  };
}

function escapeQuotedValue(value: string, quote: string) {
  return value
    .replace(/\\/gu, "\\\\")
    .split(quote)
    .join("\\" + quote);
}

function hasDanglingEscape(value: string) {
  let trailing = 0;
  for (let index = value.length - 1; index >= 0 && value[index] === "\\"; index--) trailing++;
  return trailing % 2 === 1;
}

export function isSearchFilterUnclosed(
  query: string,
  context: SearchFilterCompletionContext,
): boolean {
  const token = inspectFilterToken(query, context);
  return Boolean(token?.quote && !token.closed);
}

export function completeSearchFilter(
  query: string,
  context: SearchFilterCompletionContext,
  value: string,
): { completion: string; caret: number } {
  const token = inspectFilterToken(query, context);
  const literalPrefix =
    token && value.toLocaleLowerCase("ru-RU").startsWith(token.value.toLocaleLowerCase("ru-RU"));
  let replacement: string;
  if (token && literalPrefix && token.quote) {
    const suffix = escapeQuotedValue(value.slice(token.value.length), token.quote);
    const escapedTail = hasDanglingEscape(token.rawValue) ? "\\" : "";
    replacement = token.prefix + token.quote + token.rawValue + escapedTail + suffix + token.quote;
  } else if (token && literalPrefix && !/[\s"'\\]/u.test(value)) {
    replacement = token.prefix + token.rawValue + value.slice(token.value.length);
  } else {
    replacement = `${context.key}:${JSON.stringify(value)}`;
  }
  const tail = query.slice(context.end);
  const separator = /^\s/u.test(tail) ? "" : " ";
  return {
    completion: query.slice(0, context.start) + replacement + separator + tail,
    caret: context.start + replacement.length + 1,
  };
}
