"use client";
import { useState, type FormEvent } from "react";
import type { MaintenanceSettings } from "@animesoul/contracts";
import { api, useData, localDate } from "./api";
import { Loading, Notice, useConfirmation } from "./Common";
import { SaveTemplate } from "./TemplateTools";
type Config = { settings: MaintenanceSettings; version: number };
export function Maintenance({ csrf }: { csrf: string }) {
  const state = useData<Config>("maintenance"),
    [draft, setDraft] = useState<MaintenanceSettings | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const { ask, confirmation } = useConfirmation(),
    settings = draft ?? state.data?.settings;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!settings || !state.data) return;
    const reason = new FormData(e.currentTarget).get("reason");
    if (
      !(await ask(
        settings.enabled
          ? "Закрыть публичный сайт для обновления? Админка останется доступной."
          : "Открыть сайт для посетителей?",
      ))
    )
      return;
    setBusy(true);
    setNotice("");
    try {
      state.setData(
        await api<Config>(
          "maintenance",
          { settings, version: state.data.version, reason, operationId: crypto.randomUUID() },
          csrf,
        ),
      );
      setDraft(null);
      setNotice(settings.enabled ? "Режим обновления сохранён." : "Сайт открыт.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }
  const change = (key: string, value: unknown) => setDraft({ ...settings!, [key]: value });
  return (
    <>
      {confirmation}
      <Loading {...state} />
      <Notice text={notice} />
      {settings && (
        <div className="two-columns">
          <form className="panel" onSubmit={(e) => void save(e)}>
            <fieldset disabled={busy}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => change("enabled", e.target.checked)}
                />
                Закрыть сайт для обновления
              </label>
              <label>
                Заголовок
                <input
                  required
                  maxLength={160}
                  value={settings.title}
                  onChange={(e) => change("title", e.target.value)}
                />
              </label>
              <label>
                Текст для посетителей
                <textarea
                  required
                  rows={5}
                  maxLength={5000}
                  value={settings.body}
                  onChange={(e) => change("body", e.target.value)}
                />
              </label>
              <label>
                Открыть автоматически (необязательно)
                <input
                  type="datetime-local"
                  value={localDate(settings.endsAt)}
                  onChange={(e) =>
                    change("endsAt", e.target.value ? new Date(e.target.value).toISOString() : null)
                  }
                />
              </label>
              <p className="muted">
                Посетители увидят отдельную страницу обновления. Публичное API вернёт 503; вход в
                админку продолжит работать.
              </p>
              <label>
                Причина изменения
                <input name="reason" required minLength={3} maxLength={500} />
              </label>
              <div className="toolbar">
                <button type="submit">{busy ? "Сохраняем…" : "Сохранить"}</button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    state.reload();
                  }}
                >
                  Обновить
                </button>
              </div>
            </fieldset>
            <SaveTemplate kind="maintenance" payload={settings} csrf={csrf} />
          </form>
          <section className="panel">
            <h2>Предпросмотр страницы</h2>
            <div className="maintenance-preview">
              <span className="muted">ANIMESOUL · Обновление сайта</span>
              <h2>{settings.title}</h2>
              <p className="message-body">{settings.body}</p>
              <button disabled>Проверить доступность</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
