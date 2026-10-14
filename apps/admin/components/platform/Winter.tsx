"use client";
import { useState, type FormEvent } from "react";
import type { WinterSettings } from "@animesoul/contracts";
import { SaveTemplate } from "./TemplateTools";
import { api, useData, localDate } from "./api";
import { Loading, Notice } from "./Common";
type Config = { settings: WinterSettings; version: number };
export function Winter({ csrf }: { csrf: string }) {
  const state = useData<Config>("winter"),
    [draft, setDraft] = useState<WinterSettings | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [previewTheme, setPreviewTheme] = useState("dark");
  const settings = draft ?? state.data?.settings;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!settings || !state.data) return;
    setBusy(true);
    try {
      const value = await api<Config>(
        "winter",
        {
          settings,
          version: state.data.version,
          reason: new FormData(e.currentTarget).get("reason"),
          operationId: crypto.randomUUID(),
        },
        csrf,
      );
      state.setData(value);
      setDraft(null);
      setNotice("Настройки зимней темы сохранены.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }
  const change = (key: string, value: unknown) => setDraft({ ...settings!, [key]: value });
  return (
    <>
      <Loading {...state} />
      <Notice text={notice} />
      {settings && (
        <div className="two-columns">
          <form className="panel" onSubmit={(e) => void save(e)}>
            <fieldset disabled={busy}>
              <label>
                Режим
                <select value={settings.mode} onChange={(e) => change("mode", e.target.value)}>
                  <option value="off">Выключено</option>
                  <option value="on">Включено вручную</option>
                  <option value="schedule">По расписанию</option>
                </select>
              </label>
              {settings.mode === "schedule" && (
                <>
                  <label>
                    Начало
                    <input
                      type="datetime-local"
                      required
                      value={localDate(settings.startsAt)}
                      onChange={(e) =>
                        change(
                          "startsAt",
                          e.target.value ? new Date(e.target.value).toISOString() : null,
                        )
                      }
                    />
                  </label>
                  <label>
                    Конец
                    <input
                      type="datetime-local"
                      required
                      value={localDate(settings.endsAt)}
                      onChange={(e) =>
                        change(
                          "endsAt",
                          e.target.value ? new Date(e.target.value).toISOString() : null,
                        )
                      }
                    />
                  </label>
                </>
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.snow}
                  onChange={(e) => change("snow", e.target.checked)}
                />
                Снег
              </label>
              <label>
                Интенсивность · {settings.intensity}
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={settings.intensity}
                  onChange={(e) => change("intensity", Number(e.target.value))}
                />
              </label>
              <label>
                Скорость · {settings.speed}
                <input
                  type="range"
                  min={0.25}
                  max={3}
                  step={0.25}
                  value={settings.speed}
                  onChange={(e) => change("speed", Number(e.target.value))}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.garlands}
                  onChange={(e) => change("garlands", e.target.checked)}
                />
                Гирлянды
              </label>
              <label>
                Причина
                <input name="reason" minLength={3} maxLength={500} required />
              </label>
              <button>Сохранить оформление</button>
            </fieldset>
            <p className="muted">
              На телефонах количество снежинок уменьшается. При настройке «Уменьшение движения»
              анимация отключается. Посетитель может отключить эффекты.
            </p>
            <SaveTemplate kind="winter" payload={settings} csrf={csrf} />
          </form>
          <section>
            <div className="toolbar">
              <h2>Предпросмотр</h2>
              <select
                aria-label="Тема предпросмотра"
                value={previewTheme}
                onChange={(e) => setPreviewTheme(e.target.value)}
              >
                <option value="dark">Тёмная</option>
                <option value="light">Светлая</option>
              </select>
            </div>
            <div className={"winter-preview " + previewTheme}>
              {settings.garlands && <div className="garlands">● ● ● ● ● ● ● ● ● ● ● ●</div>}
              <strong>AnimeSoul</strong>
              <p>Каталог аниме</p>
              {settings.snow &&
                Array.from({ length: Math.round(settings.intensity / 3) }, (_, i) => (
                  <i
                    key={i}
                    className="snowflake"
                    style={{
                      left: ((i * 31) % 100) + "%",
                      animationDuration: 12 / settings.speed + "s",
                      animationDelay: -(i * 1.7) + "s",
                    }}
                  >
                    •
                  </i>
                ))}
              <div className="preview-posters">
                <div>Избранное</div>
                <div>Продолжить просмотр</div>
              </div>
            </div>
            <p className="muted">
              Предпросмотр показывает эффекты независимо от расписания. Основная тема сайта и личные
              настройки посетителей сохраняются.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
