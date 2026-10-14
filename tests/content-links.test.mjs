import { Buffer } from "node:buffer";
import test from "node:test";
import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { postInputSchema, commentInputSchema } from "../packages/contracts/dist/content.js";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/content-links.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const {
  normalizeContentHref,
  contentSegments,
  contentMention,
  contentMentionRange,
  contentDocument,
  serializeContentDocument,
  parseContentTime,
  contentTimeLabel,
  contentEpisodeHref,
} = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const episodeId = "14bd8c7e-ce2c-5f2a-a882-2f8cd58df418";
const episodePath = `/anime/naruto/episodes/${episodeId}`;
const origin = "http://localhost:8021";

test("post and comment contracts preserve references in the existing stored body", () => {
  const body = `[Наруто](/anime/naruto) и [момент 12:34](${episodePath}?t=754#anime-watch)`;
  const post = postInputSchema.parse({
    kind: "text",
    title: "Обсуждаем сцену",
    body,
    audience: "public",
    tags: [],
    labels: [],
  });
  const comment = commentInputSchema.parse({ body, labels: [], episodeId });
  assert.equal(post.body, body);
  assert.equal(comment.body, body);
  assert.equal(serializeContentDocument(contentDocument(comment.body)), body);
});

test("catalog references accept internal targets and same-origin episode URLs, including explicit zero", () => {
  assert.equal(normalizeContentHref("/anime/naruto"), "/anime/naruto");
  assert.equal(
    normalizeContentHref("/characters/17-naruto-uzumaki"),
    "/characters/17-naruto-uzumaki",
  );
  assert.equal(
    normalizeContentHref(origin + episodePath + "?t=125", origin),
    episodePath + "?t=125#anime-watch",
  );
  assert.equal(normalizeContentHref(episodePath + "?t=0"), episodePath + "?t=0#anime-watch");
  assert.equal(contentEpisodeHref("naruto", episodeId, 0), episodePath + "?t=0#anime-watch");
  assert.equal(contentEpisodeHref("naruto", episodeId, null), episodePath + "#anime-watch");
});

test("unsafe schemes, external origins, invalid times and non-catalog routes remain unlinked", () => {
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//evil.example/anime/naruto",
    "https://evil.example/anime/naruto",
    "http://user:pass@localhost:8021/anime/naruto",
    "/account",
    "/anime/naruto?redirect=evil",
    "/anime/naruto\\bad",
    episodePath + "?t=-1",
    episodePath + "?t=86401",
    episodePath + "?t=1&t=2",
    episodePath + "?t=NaN",
    "/anime/naruto/episodes/not-an-id",
  ]) {
    assert.equal(normalizeContentHref(href, origin), null, href);
  }
  for (const body of [
    "[нажми](javascript:alert(1))",
    "<img src=x onerror=alert(1)>",
    "https://evil.example/anime/naruto",
    "javascript:/anime/naruto",
  ]) {
    assert.deepEqual(contentSegments(body, origin), [{ kind: "text", text: body }]);
  }
});

test("references render alongside literal text and retain trailing punctuation and spoilers' body", () => {
  assert.deepEqual(contentSegments("Люблю [Наруто](/anime/naruto), особенно эту сцену."), [
    { kind: "text", text: "Люблю " },
    { kind: "link", text: "Наруто", href: "/anime/naruto", linkKind: "anime" },
    { kind: "text", text: ", особенно эту сцену." },
  ]);
  const parts = contentSegments(`Сцена: ${origin}${episodePath}?t=754.`, origin);
  assert.equal(parts[1].href, episodePath + "?t=754#anime-watch");
  assert.equal(parts[2].text, ".");
  assert.deepEqual(contentSegments("Обычный старый комментарий\nВторая строка"), [
    { kind: "text", text: "Обычный старый комментарий\nВторая строка" },
  ]);
});

test("editor round-trips links and multiline text without HTML storage", () => {
  const body =
    "Первый абзац\n[Наруто](/anime/naruto) и [Наруто Узумаки](/characters/17-naruto-uzumaki)\n\n<img src=x onerror=alert(1)>";
  assert.equal(serializeContentDocument(contentDocument(body)), body);
  assert.equal(
    serializeContentDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Нару",
              marks: [{ type: "link", attrs: { href: "/anime/naruto" } }],
            },
            {
              type: "text",
              text: "то",
              marks: [{ type: "link", attrs: { href: "/anime/naruto" } }],
            },
          ],
        },
      ],
    }),
    "[Наруто](/anime/naruto)",
  );
});

test("typing suggestions replace only the name, support multiple words and explicit @", () => {
  const text = "Я смотрю Атака тит";
  const mention = contentMention(text, text.length);
  assert.equal(mention.query, "тит");
  assert.deepEqual(contentMentionRange(text, mention, ["Атака титанов", "Attack on Titan"]), {
    from: 9,
    to: text.length,
  });
  const name = "Мне нравится Нару";
  assert.deepEqual(
    contentMentionRange(name, contentMention(name, name.length), ["Наруто Узумаки"]),
    { from: 13, to: name.length },
  );
  const explicit = "Обсудим @Атака титанов";
  assert.equal(contentMention(explicit, explicit.length).query, "Атака титанов");
  assert.deepEqual(
    contentMentionRange(explicit, contentMention(explicit, explicit.length), ["Атака титанов"]),
    { from: 8, to: explicit.length },
  );
  for (const value of [
    "Н",
    "Наруто ",
    "https://example.com/naruto",
    "mail@naruto",
    "[Наруто](/anime/naruto",
    "12:34",
  ])
    assert.equal(contentMention(value, value.length), null, value);
});

test("timecodes validate seconds, minute and hour formats with day bounds", () => {
  for (const [input, seconds] of [
    ["0", 0],
    ["0:00", 0],
    ["2:05", 125],
    ["12:34", 754],
    ["1:02:03", 3723],
    ["24:00:00", 86400],
    [" 125 ", 125],
  ])
    assert.equal(parseContentTime(input), seconds, input);
  for (const input of [
    "",
    "-1",
    "Infinity",
    "1:99",
    "1:2",
    "24:00:01",
    "100000",
    "1:02:99",
    "1.5",
    "text",
  ])
    assert.equal(parseContentTime(input), null, input);
  assert.equal(contentTimeLabel(3723), "1:02:03");
});
