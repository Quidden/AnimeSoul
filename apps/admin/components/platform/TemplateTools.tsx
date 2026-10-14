"use client";
import Link from "next/link";
import { useState } from "react";
import type { TemplateKind } from "@animesoul/contracts";
import { api } from "./api";
import { Notice } from "./Common";
export const templateLabels: Record<TemplateKind, string> = {
  notification: "Уведомление",
  announcement: "Объявление",
  "anime-notice": "Уведомление аниме",
  winter: "Зимняя тема",
  maintenance: "Обновление сайта",
  plan: "Тариф",
  promotion: "Промоакция",
};
export function SaveTemplate({
  kind,
  payload,
  csrf,
}: {
  kind: TemplateKind;
  payload: object;
  csrf: string;
}) {
  const [name, setName] = useState(""),
    [pinned, setPinned] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function save(button: HTMLButtonElement) {
    setBusy(true);
    setNotice("");
    try {
      let cleaned = { ...payload } as Record<string, unknown>;
      if (kind === "plan" && button.closest("form")) {
        const form = new FormData(button.closest("form")!);
        if (form.has("price"))
          cleaned = {
            ...cleaned,
            id: form.get("id"),
            name: form.get("name"),
            description: form.get("description"),
            months: Number(form.get("months")),
            sortOrder: Number(form.get("sortOrder")),
            amountMinor:
              form.get("price") === "" ? null : Math.round(Number(form.get("price")) * 100),
            currency: form.get("currency"),
            permissions: form.has("native") ? ["player.native"] : [],
          };
      }
      const keys =
        kind === "winter"
          ? ["mode", "startsAt", "endsAt", "snow", "intensity", "speed", "garlands"]
          : kind === "maintenance"
            ? ["enabled", "title", "body", "endsAt"]
            : kind === "plan"
              ? [
                  "id",
                  "name",
                  "description",
                  "months",
                  "sortOrder",
                  "amountMinor",
                  "currency",
                  "permissions",
                ]
              : kind === "promotion"
                ? ["name", "description", "percent", "months", "planIds", "startsAt", "endsAt"]
                : [
                    "title",
                    "body",
                    "kind",
                    "audience",
                    "role",
                    "planId",
                    "userId",
                    "link",
                    "startsAt",
                    "endsAt",
                    ...(kind === "notification"
                      ? []
                      : ["scope", "animeId", "dismissible", "priority"]),
                  ];
      cleaned = Object.fromEntries(Object.entries(cleaned).filter(([key]) => keys.includes(key)));
      for (const key of ["version", "reason", "operationId", "create", "animeTitle", "readCount"])
        delete cleaned[key];
      if (kind !== "plan") delete cleaned.id;
      if (!["winter", "maintenance"].includes(kind)) delete cleaned.enabled;
      await api(
        "templates",
        {
          name,
          kind,
          pinned,
          payload: cleaned,
          version: 0,
          reason: "Создание шаблона из формы",
          operationId: crypto.randomUUID(),
        },
        csrf,
      );
      setNotice("Шаблон сохранён в библиотеке.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="template-save">
      <summary>Сохранить как шаблон</summary>
      <label>
        Название шаблона
        <input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
        Закрепить сверху
      </label>
      <div className="toolbar">
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={(e) => void save(e.currentTarget)}
        >
          {busy ? "Сохраняем…" : "Сохранить шаблон"}
        </button>
        <Link href={"/templates?kind=" + kind}>Открыть библиотеку</Link>
      </div>
      <Notice text={notice} />
    </details>
  );
}
