export type DescriptionBlock = { kind: "text" | "heading" | "item"; text: string };

// Descriptions come from Shikimori with a small BBCode dialect. Only known tags are removed,
// so ordinary bracketed words such as "[OVA]" stay in the text. Nothing here produces HTML.
const knownTags =
  "b|i|u|s|h[1-6]|url|character|person|anime|manga|ranobe|entry|user|wall|comment|topic|message|contest|poll|club|collection|spoiler|spoiler_block|quote|div|size|color|center|right|left|list|code|replies|poster|image|video|source";
const tagPattern = new RegExp(`\\[/?(?:${knownTags})(?:[= ][^\\]]*)?\\]`, "gi");
const media = /\[(img|image|poster|video)(?:[= ][^\]]*)?\][\s\S]*?\[\/\1\]/gi;
const heading = /\[h[1-6]\]([\s\S]*?)\[\/h[1-6]\]/gi;
const marker = "\u0001";

function clean(value: string) {
  return value.replace(media, "").replace(tagPattern, "").replace(/\s+/g, " ").trim();
}

export function descriptionBlocks(raw: string): DescriptionBlock[] {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/\[br\]/gi, "\n")
    .replace(/\[hr\]/gi, "\n\n")
    .replace(heading, (_, title: string) => `\n\n${marker}${title.replace(/\s+/g, " ")}\n\n`);
  const blocks: DescriptionBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const value = clean(paragraph.join(" "));
    if (value) blocks.push({ kind: "text", text: value });
    paragraph = [];
  };
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) flush();
    else if (trimmed.startsWith(marker)) {
      flush();
      const value = clean(trimmed.slice(1));
      if (value) blocks.push({ kind: "heading", text: value });
    } else if (trimmed.startsWith("[*]")) {
      flush();
      const value = clean(trimmed.slice(3));
      if (value) blocks.push({ kind: "item", text: value });
    } else paragraph.push(trimmed);
  }
  flush();
  return blocks;
}

// A single line of text for synopses and previews; text without markup is returned untouched.
export function plainDescription(raw: string) {
  if (!raw.includes("[")) return raw;
  return descriptionBlocks(raw)
    .map((block) => block.text)
    .join(" ");
}

export type DescriptionGroup =
  | { kind: "text" | "heading"; text: string }
  | { kind: "list"; items: string[] };

// Consecutive list items become one list.
export function descriptionGroups(raw: string): DescriptionGroup[] {
  const groups: DescriptionGroup[] = [];
  for (const block of descriptionBlocks(raw)) {
    const last = groups.at(-1);
    if (block.kind === "item") {
      if (last?.kind === "list") last.items.push(block.text);
      else groups.push({ kind: "list", items: [block.text] });
    } else groups.push({ kind: block.kind, text: block.text });
  }
  return groups;
}
