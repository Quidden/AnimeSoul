export type ContentLinkKind = "anime" | "character" | "episode";
export type ContentSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string; linkKind: ContentLinkKind };

const episodePath =
  /^\/anime\/([a-z0-9-]{1,160})\/episodes\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i;

/** Only catalog references become links. HTML and arbitrary URL schemes remain literal text. */
export function normalizeContentHref(value: string, origin?: string): string | null {
  if (!value || /[\s\\]/u.test(value) || value.startsWith("//")) return null;
  const absolute = /^https?:\/\//i.test(value);
  if (!absolute && !value.startsWith("/")) return null;
  try {
    const url = new URL(value, origin || "https://content.invalid");
    if (url.username || url.password || (absolute && (!origin || url.origin !== origin)))
      return null;
    if (/^\/(?:anime|characters)\/[a-z0-9-]{1,160}$/.test(url.pathname)) {
      return url.search || url.hash ? null : url.pathname;
    }
    if (!episodePath.test(url.pathname)) return null;
    if ([...url.searchParams.keys()].some((key) => key !== "t" && key !== "resume")) return null;
    if (url.searchParams.getAll("t").length > 1) return null;
    const time = url.searchParams.get("t");
    if (time !== null && (!/^\d{1,5}(?:\.\d{1,3})?$/.test(time) || Number(time) > 86400))
      return null;
    return url.pathname + (time === null ? "" : `?t=${Math.floor(Number(time))}`) + "#anime-watch";
  } catch {
    return null;
  }
}

export function contentLinkKind(href: string): ContentLinkKind {
  return href.startsWith("/characters/")
    ? "character"
    : href.includes("/episodes/")
      ? "episode"
      : "anime";
}

export function contentReference(label: string, href: string): string {
  return `[${label.replace(/[\\[\]\r\n]/g, " ").trim()}](${href})`;
}

export function contentSegments(body: string, origin?: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const pattern =
    /\[([^\]\n]{1,500})\]\(([^)\s]{1,1024})\)|https?:\/\/[^\s<>()]{1,1024}|\/(?:anime|characters)\/[^\s<>()]{1,1024}/gu;
  let end = 0;
  for (const match of body.matchAll(pattern)) {
    const markdown = match[1] !== undefined;
    if (!markdown && match.index > 0 && /[\p{L}\p{N}_/:@]/u.test(body[match.index - 1]!)) continue;
    const raw = markdown ? match[2]! : match[0].replace(/[.,!?:;}\]]+$/, "");
    const href = normalizeContentHref(raw, origin);
    if (!href) continue;
    if (match.index > end) segments.push({ kind: "text", text: body.slice(end, match.index) });
    segments.push({
      kind: "link",
      text: markdown ? match[1]! : raw,
      href,
      linkKind: contentLinkKind(href),
    });
    end = match.index + (markdown ? match[0].length : raw.length);
  }
  if (end < body.length) segments.push({ kind: "text", text: body.slice(end) });
  return segments;
}

export function parseContentTime(value: string): number | null {
  const input = value.trim();
  if (!/^\d{1,5}(?::\d{2}){0,2}$/.test(input)) return null;
  const parts = input.split(":").map(Number);
  if (parts.length > 1 && parts.slice(1).some((part) => part > 59)) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds <= 86400 ? seconds : null;
}

export function contentTimeLabel(seconds: number): string {
  const time = Math.floor(seconds);
  const minutes = Math.floor(time / 60);
  const remainder = String(time % 60).padStart(2, "0");
  return time >= 3600
    ? `${Math.floor(time / 3600)}:${String(minutes % 60).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`;
}

export function contentEpisodeHref(slug: string, episodeId: string, seconds: number | null) {
  return (
    `/anime/${slug}/episodes/${episodeId}` +
    (seconds === null ? "" : `?t=${seconds}`) +
    "#anime-watch"
  );
}

export type ContentDocumentNode = {
  type: string;
  text?: string;
  marks?: { type: string; attrs?: { href?: string } }[];
  content?: ContentDocumentNode[];
};

export function contentDocument(body: string, origin?: string): ContentDocumentNode {
  return {
    type: "doc",
    content: body.split("\n").map((line) => ({
      type: "paragraph",
      content: contentSegments(line, origin)
        .filter((part) => part.text)
        .map((part) => ({
          type: "text",
          text: part.text,
          ...(part.kind === "link"
            ? { marks: [{ type: "link", attrs: { href: part.href } }] }
            : {}),
        })),
    })),
  };
}

/** Persist readable text and references in the existing body column, without storing executable HTML. */
export function serializeContentDocument(document: ContentDocumentNode, origin?: string): string {
  return (document.content ?? [])
    .map((paragraph) => {
      let result = "",
        label = "",
        previousHref: string | null = null;
      const flush = () => {
        result += previousHref ? contentReference(label, previousHref) : label;
        label = "";
      };
      for (const node of paragraph.content ?? []) {
        const rawHref = node.marks?.find((mark) => mark.type === "link")?.attrs?.href;
        const href = rawHref ? normalizeContentHref(rawHref, origin) : null;
        if (href !== previousHref) {
          flush();
          previousHref = href;
        }
        label += node.type === "hardBreak" ? "\n" : (node.text ?? "");
      }
      flush();
      return result;
    })
    .join("\n");
}

export type ContentMention = {
  start: number;
  end: number;
  caret: number;
  query: string;
  explicit: boolean;
};
const nameText = (value: string) =>
  value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function contentMention(text: string, caret: number): ContentMention | null {
  const prefix = text.slice(0, caret);
  const explicit = /(?:^|\s)@([\p{L}\p{N}_'-]+(?: [\p{L}\p{N}_'-]+){0,5})$/u.exec(prefix);
  if (explicit && explicit[1]!.length >= 2 && explicit[1]!.length <= 100) {
    const start = explicit.index + explicit[0].indexOf("@");
    return { start, end: caret, caret, query: explicit[1]!, explicit: true };
  }
  const word = /[\p{L}][\p{L}\p{N}_'-]{1,49}$/u.exec(prefix);
  if (!word || /[\p{L}\p{N}_/@]/u.test(text[word.index - 1] ?? "")) return null;
  const token = prefix.slice(prefix.lastIndexOf(" ") + 1);
  if (
    token.includes("/") ||
    token.includes("@") ||
    prefix.lastIndexOf("](") > prefix.lastIndexOf(")")
  )
    return null;
  const suffix = /^[\p{L}\p{N}_'-]*/u.exec(text.slice(caret))?.[0] ?? "";
  return { start: word.index, end: caret + suffix.length, caret, query: word[0], explicit: false };
}

/** Replace the typed name, including preceding words of a multiword title, without consuming the sentence. */
export function contentMentionRange(text: string, mention: ContentMention, names: string[]) {
  if (mention.explicit) return { from: mention.start, to: mention.end };
  const words = [...text.slice(0, mention.caret).matchAll(/[\p{L}\p{N}_'-]+/gu)].slice(-6);
  const normalized = names.map(nameText);
  let start = mention.start;
  for (const word of words) {
    const typed = nameText(text.slice(word.index, mention.caret));
    if (typed && normalized.some((name) => name.startsWith(typed) || name.endsWith(" " + typed))) {
      start = word.index;
      break;
    }
  }
  return { from: start, to: mention.end };
}
