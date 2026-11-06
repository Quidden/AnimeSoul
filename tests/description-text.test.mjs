import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { Buffer } from "node:buffer";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/description-text.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const { descriptionBlocks, plainDescription } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("headings, paragraphs and list items are separated", () => {
  const raw =
    "Киборг.\r\n\r\n[h3]Внешность[/h3]Светлые волосы.\r\n\r\n\r\n[*] Суперсила — крушит здания.\r\n[*] Суперскорость.";
  assert.deepEqual(descriptionBlocks(raw), [
    { kind: "text", text: "Киборг." },
    { kind: "heading", text: "Внешность" },
    { kind: "text", text: "Светлые волосы." },
    { kind: "item", text: "Суперсила — крушит здания." },
    { kind: "item", text: "Суперскорость." },
  ]);
});

test("known tags are removed but their text and ordinary brackets stay", () => {
  assert.deepEqual(
    descriptionBlocks(
      "[b]Жирный[/b] и [url=https://example.com]ссылка[/url], [character=1]Имя[/character] из [OVA]. [img]x.png[/img]",
    ),
    [{ kind: "text", text: "Жирный и ссылка, Имя из [OVA]." }],
  );
});

test("text without markup is returned as is and markup collapses to one line", () => {
  assert.equal(
    plainDescription("Просто описание.\nВторая строка."),
    "Просто описание.\nВторая строка.",
  );
  assert.equal(plainDescription("[h3]Сюжет[/h3]Начало.\n[*] Пункт"), "Сюжет Начало. Пункт");
});

test("an empty description yields no blocks", () => {
  assert.deepEqual(descriptionBlocks(""), []);
  assert.deepEqual(descriptionBlocks("[h3][/h3]"), []);
});
