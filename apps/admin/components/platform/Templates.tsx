"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  winterSettingsSchema,
  maintenanceSettingsSchema,
  type AdminTemplate,
  type TemplateKind,
  type SubscriptionAdmin,
} from "@animesoul/contracts";
import { api, useData, query, date, localDate } from "./api";
import { Loading, Notice, Pagination, useConfirmation } from "./Common";
import { templateLabels } from "./TemplateTools";
type Page = { items: AdminTemplate[]; total: number; page: number; pageSize: number };
type Draft = Omit<AdminTemplate, "id" | "updatedAt"> & { id?: string };
type Preview = { template: AdminTemplate; targetVersion: number; current: unknown };
function Summary({ value }: { value: Record<string, unknown> }) {
  const labels: Record<string, string> = {
    audience: "Аудитория",
    role: "Роль",
    planId: "Тариф",
    userId: "Получатель",
    scope: "Размещение",
    animeId: "Аниме",
    link: "Ссылка",
    dismissible: "Можно закрыть",
    priority: "Приоритет",
    enabled: "Включено",
    mode: "Режим",
    snow: "Снег",
    intensity: "Интенсивность",
    speed: "Скорость",
    garlands: "Гирлянды",
    id: "ID тарифа",
    name: "Название",
    description: "Описание",
    months: "Месяцев",
    amountMinor: "Цена в минимальных единицах",
    currency: "Валюта",
    permissions: "Привилегии",
    sortOrder: "Порядок",
    percent: "Скидка, %",
    planIds: "Тарифы акции",
    endsAt: "Конец",
  };
  return (
    <dl>
      {Object.entries(value)
        .filter(([key, v]) => labels[key] && v !== null)
        .map(([key, v]) => (
          <div key={key}>
            <dt>{labels[key]}</dt>
            <dd>
              {typeof v === "boolean"
                ? v
                  ? "Да"
                  : "Нет"
                : Array.isArray(v)
                  ? v.join(", ") || "Все"
                  : String(v)}
            </dd>
          </div>
        ))}
    </dl>
  );
}
function initial(kind: TemplateKind): Record<string, unknown> {
  const startsAt = new Date().toISOString();
  if (kind === "winter") return winterSettingsSchema.parse({});
  if (kind === "maintenance") return maintenanceSettingsSchema.parse({ enabled: true });
  if (kind === "plan")
    return {
      id: "",
      name: "",
      description: "",
      sortOrder: 0,
      permissions: ["player.native"],
      months: 1,
      amountMinor: null,
      currency: "UAH",
    };
  if (kind === "promotion")
    return {
      name: "",
      description: "",
      percent: 10,
      months: [],
      planIds: [],
      startsAt,
      endsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    };
  const common = {
    title: "",
    body: "",
    kind: "info",
    audience: kind === "notification" ? "authenticated" : "all",
    role: null,
    planId: null,
    userId: null,
    link: null,
    startsAt,
    endsAt: null,
  };
  return kind === "notification"
    ? common
    : {
        ...common,
        scope: kind === "anime-notice" ? "season" : "global",
        animeId: null,
        dismissible: true,
        priority: 0,
      };
}
function Fields({
  kind,
  payload,
  setPayload,
}: {
  kind: TemplateKind;
  payload: Record<string, unknown>;
  setPayload: (p: Record<string, unknown>) => void;
}) {
  const plans = useData<SubscriptionAdmin>("/api/admin/subscriptions"),
    [animeQ, setAnimeQ] = useState("");
  const anime = useData<{ anime: { id: string; title: string; year: number }[] }>(
    animeQ ? "search?" + query({ q: animeQ }) : null,
  );
  const change = (key: string, v: unknown) => setPayload({ ...payload, [key]: v }),
    str = (key: string) => String(payload[key] ?? "");
  const text = (key: string, label: string, max = 160, required = true) => (
    <label key={key}>
      {label}
      <input
        required={required}
        maxLength={max}
        value={str(key)}
        onChange={(e) => change(key, e.target.value || (!required ? null : ""))}
      />
    </label>
  );
  const number = (key: string, label: string, min: number, max: number) => (
    <label key={key}>
      {label}
      <input
        type="number"
        required
        min={min}
        max={max}
        value={Number(payload[key] ?? min)}
        onChange={(e) => change(key, Number(e.target.value))}
      />
    </label>
  );
  const check = (key: string, label: string) => (
    <label key={key} className="check">
      <input
        type="checkbox"
        checked={Boolean(payload[key])}
        onChange={(e) => change(key, e.target.checked)}
      />
      {label}
    </label>
  );
  const time = (key: string, label: string, required = false) => (
    <label key={key}>
      {label}
      <input
        type="datetime-local"
        required={required}
        value={localDate(str(key) || null)}
        onChange={(e) =>
          change(key, e.target.value ? new Date(e.target.value).toISOString() : null)
        }
      />
    </label>
  );
  const body = (
    <label>
      Текст
      <textarea
        required
        maxLength={5000}
        rows={5}
        value={str("body")}
        onChange={(e) => change("body", e.target.value)}
      />
    </label>
  );
  if (kind === "maintenance")
    return (
      <>
        {check("enabled", "Закрыть сайт при применении")}
        {text("title", "Заголовок")}
        {body}
        {time("endsAt", "Автоматическое открытие (необязательно)")}
      </>
    );
  if (kind === "winter")
    return (
      <>
        <label>
          Режим
          <select value={str("mode")} onChange={(e) => change("mode", e.target.value)}>
            <option value="off">Выключено</option>
            <option value="on">Включено</option>
            <option value="schedule">По расписанию</option>
          </select>
        </label>
        {str("mode") === "schedule" && (
          <>
            {time("startsAt", "Начало", true)}
            {time("endsAt", "Конец", true)}
          </>
        )}
        {check("snow", "Снег")}
        {number("intensity", "Интенсивность", 5, 100)}
        <label>
          Скорость
          <input
            type="number"
            min={0.25}
            max={3}
            step={0.25}
            value={Number(payload.speed)}
            onChange={(e) => change("speed", Number(e.target.value))}
          />
        </label>
        {check("garlands", "Гирлянды")}
      </>
    );
  if (kind === "plan" || kind === "promotion")
    return (
      <>
        {kind === "plan" && text("id", "Идентификатор тарифа (латиница, цифры, дефис)", 40)}
        {text("name", kind === "plan" ? "Название тарифа" : "Название акции", 80)}
        <label>
          Описание
          <textarea
            maxLength={1000}
            value={str("description")}
            onChange={(e) => change("description", e.target.value)}
          />
        </label>
        {kind === "plan" ? (
          <>
            {number("months", "Месяцев", 1, 24)}
            <label>
              Цена (необязательно)
              <input
                type="number"
                min={0.01}
                max={100000}
                step={0.01}
                value={payload.amountMinor === null ? "" : Number(payload.amountMinor) / 100}
                onChange={(e) =>
                  change(
                    "amountMinor",
                    e.target.value ? Math.round(Number(e.target.value) * 100) : null,
                  )
                }
              />
            </label>
            <label>
              Валюта
              <select value={str("currency")} onChange={(e) => change("currency", e.target.value)}>
                {["UAH", "USD", "EUR"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {number("sortOrder", "Порядок", 0, 10000)}
            <p className="muted">
              Предоставляет доступ к плееру AnimeSoul. Оплата подключается позже.
            </p>
          </>
        ) : (
          <>
            {number("percent", "Скидка, %", 1, 100)}
            <label>
              Сроки тарифов (месяцы через запятую; пусто — все)
              <input
                defaultValue={(payload.months as number[]).join(", ")}
                onBlur={(e) =>
                  change(
                    "months",
                    e.target.value
                      .split(",")
                      .filter((v) => v.trim())
                      .map(Number),
                  )
                }
              />
            </label>
            <label>
              Тарифы (пусто — все)
              <select
                multiple
                value={payload.planIds as string[]}
                onChange={(e) =>
                  change(
                    "planIds",
                    Array.from(e.target.selectedOptions, (o) => o.value),
                  )
                }
              >
                {plans.data?.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {time("startsAt", "Начало", true)}
            {time("endsAt", "Конец", true)}
          </>
        )}
      </>
    );
  return (
    <>
      {text("title", "Заголовок")}
      {body}
      <label>
        Тип
        <select value={str("kind")} onChange={(e) => change("kind", e.target.value)}>
          {Object.entries({
            info: "Информация",
            warning: "Предупреждение",
            error: "Ошибка",
            important: "Важное",
          }).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Аудитория
        <select
          value={str("audience")}
          onChange={(e) =>
            setPayload({
              ...payload,
              audience: e.target.value,
              role: null,
              planId: null,
              userId: null,
            })
          }
        >
          {kind !== "notification" && <option value="all">Все посетители</option>}
          <option value="authenticated">Авторизованные</option>
          <option value="role">По роли</option>
          <option value="subscription">По тарифу</option>
          {kind === "notification" && <option value="user">Конкретный пользователь</option>}
        </select>
      </label>
      {str("audience") === "role" && (
        <label>
          Роль
          <select required value={str("role")} onChange={(e) => change("role", e.target.value)}>
            <option value="">Выберите</option>
            <option>owner</option>
            <option>admin</option>
          </select>
        </label>
      )}
      {str("audience") === "subscription" && (
        <label>
          Тариф
          <select required value={str("planId")} onChange={(e) => change("planId", e.target.value)}>
            <option value="">Выберите тариф</option>
            {plans.data?.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {str("audience") === "user" && text("userId", "ID пользователя", 36)}
      {text("link", "Ссылка внутри сайта (необязательно)", 500, false)}
      {kind === "anime-notice" && (
        <>
          <label>
            Размещение
            <select value={str("scope")} onChange={(e) => change("scope", e.target.value)}>
              <option value="season">Сезон</option>
              <option value="franchise">Франшиза</option>
            </select>
          </label>
          <label>
            Найти аниме
            <input value={animeQ} onChange={(e) => setAnimeQ(e.target.value)} />
          </label>
          <label>
            ID аниме
            <input
              required
              value={str("animeId")}
              onChange={(e) => change("animeId", e.target.value)}
            />
          </label>
          {anime.data?.anime.map((a) => (
            <button type="button" key={a.id} onClick={() => change("animeId", a.id)}>
              {a.title} · {a.year}
            </button>
          ))}
        </>
      )}
      {kind !== "notification" && (
        <>
          {check("dismissible", "Посетитель может закрыть")}
          {number("priority", "Приоритет", -100, 100)}
        </>
      )}
      {time("endsAt", "Конец публикации по умолчанию (необязательно)")}
    </>
  );
}
export function Templates({ csrf }: { csrf: string }) {
  const params = useSearchParams(),
    [kind, setKind] = useState(
      Object.hasOwn(templateLabels, params.get("kind") ?? "") ? params.get("kind")! : "",
    ),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [draft, setDraft] = useState<Draft | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [result, setResult] = useState<{ route: string; targetId: string } | null>(null);
  const state = useData<Page>("templates?" + query({ page, q, kind })),
    { ask, confirmation } = useConfirmation();
  const [startsAt, setStartsAt] = useState(new Date().toISOString()),
    [endsAt, setEndsAt] = useState<string | null>(null);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await task();
      state.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Ошибка операции");
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft) return;
    const reason = new FormData(e.currentTarget).get("reason");
    await run(async () => {
      await api("templates", { ...draft, reason, operationId: crypto.randomUUID() }, csrf);
      setDraft(null);
      setNotice("Шаблон сохранён. Теперь его можно опубликовать из списка.");
    });
  }
  async function publish(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!preview) return;
    const reason = new FormData(e.currentTarget).get("reason"),
      t = preview.template;
    if (
      !(await ask(
        t.kind === "maintenance"
          ? "Применить шаблон доступности сайта? Это изменит доступ посетителей."
          : "Опубликовать или применить этот шаблон?",
      ))
    )
      return;
    await run(async () => {
      const out = await api<{ route: string; targetId: string }>(
        "templates/" + t.id + "/publish",
        {
          version: t.version,
          targetVersion: preview.targetVersion,
          targetExists: preview.current !== null,
          reason,
          operationId: crypto.randomUUID(),
          ...(["notification", "announcement", "anime-notice", "promotion"].includes(t.kind)
            ? { startsAt, endsAt }
            : {}),
        },
        csrf,
      );
      setResult(out);
      setPreview(null);
      setNotice("Шаблон опубликован / применён.");
    });
  }
  return (
    <>
      {confirmation}
      <p className="muted">
        Заготовки можно копировать и изменять. Публикация сообщения создаёт новую запись; применение
        настроек обновляет соответствующий раздел.
      </p>
      <div className="toolbar">
        <input
          placeholder="Найти шаблон…"
          aria-label="Поиск шаблонов"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Тип шаблона"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Все типы</option>
          {Object.entries(templateLabels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            const k = (kind || "notification") as TemplateKind;
            setDraft({ name: "", kind: k, pinned: false, payload: initial(k), version: 0 });
            setPreview(null);
          }}
        >
          Создать шаблон
        </button>
        <button onClick={state.reload}>Обновить</button>
      </div>
      <Notice text={notice} />
      {result && (
        <p>
          <Link
            href={
              "/" +
              result.route +
              (["notifications", "announcements", "anime-notices"].includes(result.route)
                ? "?edit=" + result.targetId
                : "")
            }
          >
            Открыть результат публикации
          </Link>
        </p>
      )}
      {draft && (
        <form className="panel" onSubmit={(e) => void save(e)}>
          <div className="section-heading">
            <h2>{draft.id ? "Редактирование шаблона" : "Новый шаблон"}</h2>
            <button type="button" onClick={() => setDraft(null)}>
              Закрыть
            </button>
          </div>
          <fieldset disabled={busy}>
            <label>
              Название шаблона
              <input
                required
                maxLength={160}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            {!draft.id && (
              <label>
                Тип
                <select
                  value={draft.kind}
                  onChange={(e) => {
                    const k = e.target.value as TemplateKind;
                    setDraft({ ...draft, kind: k, payload: initial(k) });
                  }}
                >
                  {Object.entries(templateLabels).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={draft.pinned}
                onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
              />
              Закрепить сверху
            </label>
            <div className="form-grid">
              <Fields
                key={draft.kind}
                kind={draft.kind}
                payload={draft.payload}
                setPayload={(p) => setDraft({ ...draft, payload: p })}
              />
            </div>
            <label>
              Причина
              <input
                name="reason"
                required
                minLength={3}
                maxLength={500}
                defaultValue="Редактирование шаблона"
              />
            </label>
            <button type="submit">{busy ? "Сохраняем…" : "Сохранить шаблон"}</button>
          </fieldset>
        </form>
      )}
      {preview && (
        <form className="panel" onSubmit={(e) => void publish(e)}>
          <div className="section-heading">
            <h2>Публикация: {preview.template.name}</h2>
            <button type="button" onClick={() => setPreview(null)}>
              Закрыть
            </button>
          </div>
          <fieldset disabled={busy}>
            <p>
              {templateLabels[preview.template.kind]} ·{" "}
              {String(
                preview.template.payload.title ??
                  preview.template.payload.name ??
                  preview.template.payload.mode ??
                  "",
              )}
            </p>
            {typeof preview.template.payload.body === "string" && (
              <p className="message-body">{preview.template.payload.body}</p>
            )}
            <Summary value={preview.template.payload} />
            {preview.current !== null && typeof preview.current === "object" && (
              <details>
                <summary>Текущие параметры перед применением</summary>
                <Summary value={preview.current as Record<string, unknown>} />
              </details>
            )}
            {preview.current !== null && (
              <p className="muted">
                Изменит текущую конфигурацию. Версия {preview.targetVersion}. При параллельном
                изменении публикация будет отклонена.
              </p>
            )}
            {["notification", "announcement", "anime-notice", "promotion"].includes(
              preview.template.kind,
            ) && (
              <div className="form-grid">
                <label>
                  Начало
                  <input
                    type="datetime-local"
                    required
                    value={localDate(startsAt)}
                    onChange={(e) =>
                      setStartsAt(e.target.value ? new Date(e.target.value).toISOString() : "")
                    }
                  />
                </label>
                <label>
                  Конец
                  <input
                    type="datetime-local"
                    required={preview.template.kind === "promotion"}
                    value={localDate(endsAt)}
                    onChange={(e) =>
                      setEndsAt(e.target.value ? new Date(e.target.value).toISOString() : null)
                    }
                  />
                </label>
              </div>
            )}
            <label>
              Причина публикации
              <input
                name="reason"
                required
                minLength={3}
                maxLength={500}
                defaultValue="Публикация из библиотеки шаблонов"
              />
            </label>
            <button type="submit">
              {busy ? "Публикуем…" : "Подтвердить публикацию / применение"}
            </button>
          </fieldset>
        </form>
      )}
      <Loading {...state} />
      {state.data && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Шаблон</th>
                  <th>Тип</th>
                  <th>Изменён</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.pinned && <span title="Закреплён">★ </span>}
                      {t.name}
                    </td>
                    <td>{templateLabels[t.kind]}</td>
                    <td>{date(t.updatedAt)}</td>
                    <td>
                      <div className="toolbar">
                        <button
                          disabled={busy}
                          onClick={() => {
                            const { updatedAt: _date, ...edit } = t;
                            void _date;
                            setDraft(edit);
                            setPreview(null);
                          }}
                        >
                          Редактировать
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const copy = await api<AdminTemplate>(
                                "templates/" + t.id + "/copy",
                                {
                                  version: t.version,
                                  reason: "Копирование шаблона",
                                  operationId: crypto.randomUUID(),
                                },
                                csrf,
                              );
                              const { updatedAt: _date, ...edit } = copy;
                              void _date;
                              setDraft(edit);
                              setNotice("Копия создана. Измените её и сохраните.");
                            })
                          }
                        >
                          Копировать
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const { updatedAt: _date, ...edit } = t;
                              void _date;
                              await api(
                                "templates",
                                {
                                  ...edit,
                                  pinned: !t.pinned,
                                  reason: t.pinned ? "Открепление шаблона" : "Закрепление шаблона",
                                  operationId: crypto.randomUUID(),
                                },
                                csrf,
                              );
                            })
                          }
                        >
                          {t.pinned ? "Открепить" : "Закрепить"}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const p = await api<Preview>("templates/" + t.id + "/preview");
                              setPreview(p);
                              setDraft(null);
                              setStartsAt(new Date().toISOString());
                              setEndsAt(
                                typeof p.template.payload.endsAt === "string"
                                  ? p.template.payload.endsAt
                                  : null,
                              );
                            })
                          }
                        >
                          {["winter", "maintenance", "plan"].includes(t.kind)
                            ? "Применить"
                            : "Опубликовать"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!state.data.items.length && (
              <p className="empty">
                Шаблонов пока нет. Создайте заготовку или сохраните её из формы.
              </p>
            )}
          </div>
          <Pagination {...state.data} onChange={setPage} />
        </>
      )}
    </>
  );
}
