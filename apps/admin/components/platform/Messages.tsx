"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import type { AdminMessage, SubscriptionAdmin } from "@animesoul/contracts";
import { SaveTemplate } from "./TemplateTools";
import Link from "next/link";
import { api, useData, query, date, localDate } from "./api";
import { Loading, Notice, Pagination, useConfirmation } from "./Common";
type Page = { items: AdminMessage[]; total: number; page: number; pageSize: number };
const kinds = {
  info: "Информация",
  warning: "Предупреждение",
  error: "Ошибка",
  important: "Важное",
};
function empty(section: string): Partial<AdminMessage> {
  return {
    title: "",
    body: "",
    kind: "info",
    audience: section === "notifications" ? "authenticated" : "all",
    role: null,
    planId: null,
    userId: null,
    link: null,
    enabled: false,
    startsAt: new Date().toISOString(),
    endsAt: null,
    version: 0,
    scope: section === "anime-notices" ? "season" : "global",
    animeId: null,
    priority: 0,
    dismissible: true,
  };
}
export function Messages({ section, csrf }: { section: string; csrf: string }) {
  const { ask, confirmation } = useConfirmation();
  const kind = section === "notifications" ? "notifications" : "announcements",
    scope = section === "anime-notices" ? "anime" : "global",
    search = useSearchParams();
  const [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [draft, setDraft] = useState<Partial<AdminMessage> | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [animeQuery, setAnimeQuery] = useState(""),
    [deepClosed, setDeepClosed] = useState(false);
  const state = useData<Page>(
      kind + "?" + query({ page, q, ...(kind === "announcements" ? { scope } : {}) }),
    ),
    plans = useData<SubscriptionAdmin>("/api/admin/subscriptions"),
    anime = useData<{ anime: { id: string; title: string; year: number }[] }>(
      animeQuery ? "search?" + query({ q: animeQuery }) : null,
    );
  const editId = search.get("edit"),
    deep = useData<AdminMessage | null>(editId ? kind + "/" + editId : null);
  useEffect(() => setDeepClosed(false), [editId]);
  const current =
    draft ?? (!deepClosed && editId && deep.data && "title" in deep.data ? deep.data : null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    setBusy(true);
    setNotice("");
    try {
      const data = {
        ...(current.id ? { id: current.id } : {}),
        title: current.title,
        body: current.body,
        kind: current.kind,
        audience: current.audience,
        role: current.audience === "role" ? current.role : null,
        planId: current.audience === "subscription" ? current.planId : null,
        userId: current.audience === "user" ? current.userId : null,
        link: current.link || null,
        enabled: current.enabled,
        startsAt: current.startsAt,
        endsAt: current.endsAt || null,
        version: current.version ?? 0,
        reason: new FormData(event.currentTarget).get("reason"),
        operationId: crypto.randomUUID(),
        ...(kind === "announcements"
          ? {
              scope: current.scope,
              animeId: current.scope === "global" ? null : current.animeId,
              dismissible: current.dismissible,
              priority: current.priority,
            }
          : {}),
      };
      if (
        current.enabled &&
        !(await ask("Опубликовать сообщение для выбранной аудитории и периода?"))
      )
        return;
      await api(kind, data, csrf);
      setDraft(null);
      setDeepClosed(true);
      state.reload();
      setNotice("Сообщение сохранено.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }
  const update = (key: string, value: unknown) => setDraft({ ...current, [key]: value });
  const status = (m: AdminMessage) =>
    !m.enabled
      ? "Отключено"
      : new Date(m.startsAt) > new Date()
        ? "Запланировано"
        : m.endsAt && new Date(m.endsAt) <= new Date()
          ? "Завершено"
          : "Опубликовано";
  return (
    <>
      {confirmation}
      <div className="toolbar">
        <input
          aria-label="Поиск сообщений"
          placeholder="Название или текст…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <button onClick={() => setDraft(empty(section))}>
          Создать {kind === "notifications" ? "уведомление" : "объявление"}
        </button>
        <button onClick={state.reload}>Обновить</button>
        <Link
          href={
            "/templates?kind=" +
            (kind === "notifications"
              ? "notification"
              : section === "anime-notices"
                ? "anime-notice"
                : "announcement")
          }
        >
          Шаблоны
        </Link>
      </div>
      <Notice text={notice} />
      {current && (
        <div className="panel">
          <div className="section-heading">
            <h2>{current.id ? "Редактирование" : "Новое сообщение"}</h2>
            <button
              onClick={() => {
                setDraft(null);
                setDeepClosed(true);
              }}
            >
              Закрыть
            </button>
          </div>
          <div className="two-columns">
            <form onSubmit={(e) => void save(e)}>
              <fieldset disabled={busy}>
                <label>
                  Заголовок
                  <input
                    required
                    maxLength={160}
                    value={current.title ?? ""}
                    onChange={(e) => update("title", e.target.value)}
                  />
                </label>
                <label>
                  Текст
                  <textarea
                    required
                    maxLength={5000}
                    rows={5}
                    value={current.body ?? ""}
                    onChange={(e) => update("body", e.target.value)}
                  />
                </label>
                <label>
                  Тип
                  <select value={current.kind} onChange={(e) => update("kind", e.target.value)}>
                    {Object.entries(kinds).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Аудитория
                  <select
                    value={current.audience}
                    onChange={(e) => update("audience", e.target.value)}
                  >
                    {kind === "announcements" && <option value="all">Все посетители</option>}
                    <option value="authenticated">Авторизованные</option>
                    <option value="role">По роли</option>
                    <option value="subscription">По тарифу</option>
                    {kind === "notifications" && (
                      <option value="user">Конкретный пользователь</option>
                    )}
                  </select>
                </label>
                {current.audience === "role" && (
                  <label>
                    Роль
                    <select
                      value={current.role ?? ""}
                      onChange={(e) => update("role", e.target.value)}
                      required
                    >
                      <option value="">Выберите роль</option>
                      <option>owner</option>
                      <option>admin</option>
                    </select>
                  </label>
                )}
                {current.audience === "subscription" && (
                  <label>
                    Тариф
                    <select
                      value={current.planId ?? ""}
                      onChange={(e) => update("planId", e.target.value)}
                      required
                    >
                      <option value="">Выберите тариф</option>
                      {plans.data?.plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {current.audience === "user" && (
                  <label>
                    ID пользователя
                    <input
                      required
                      value={current.userId ?? ""}
                      onChange={(e) => update("userId", e.target.value)}
                    />
                  </label>
                )}
                {kind === "announcements" && (
                  <>
                    <label>
                      Размещение
                      <select
                        value={current.scope}
                        onChange={(e) => update("scope", e.target.value)}
                      >
                        <option value="global">Весь сайт</option>
                        <option value="season">Выбранный сезон</option>
                        <option value="franchise">Вся франшиза</option>
                      </select>
                    </label>
                    {current.scope !== "global" && (
                      <>
                        <label>
                          Найти аниме
                          <input
                            value={animeQuery}
                            onChange={(e) => setAnimeQuery(e.target.value)}
                            placeholder="Название…"
                          />
                        </label>
                        <label>
                          Аниме
                          <select
                            value={current.animeId ?? ""}
                            onChange={(e) => update("animeId", e.target.value)}
                            required
                          >
                            <option value="">Выберите аниме</option>
                            {current.animeId &&
                              !anime.data?.anime.some((a) => a.id === current.animeId) && (
                                <option value={current.animeId}>
                                  {current.animeTitle ?? current.animeId}
                                </option>
                              )}
                            {anime.data?.anime.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.title} · {a.year}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="muted">
                          Франшиза определяется сохранёнными связями каталога. Режим сезона
                          применяется только к выбранному аниме.
                        </p>
                      </>
                    )}
                    <label>
                      Приоритет
                      <input
                        type="number"
                        min={-100}
                        max={100}
                        value={current.priority ?? 0}
                        onChange={(e) => update("priority", Number(e.target.value))}
                      />
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={current.dismissible ?? true}
                        onChange={(e) => update("dismissible", e.target.checked)}
                      />
                      Разрешить закрытие
                    </label>
                  </>
                )}
                <label>
                  Ссылка на сайте
                  <input
                    placeholder="/subscription"
                    value={current.link ?? ""}
                    onChange={(e) => update("link", e.target.value || null)}
                    maxLength={500}
                  />
                </label>
                <div className="two-columns">
                  <label>
                    Начало
                    <input
                      type="datetime-local"
                      value={localDate(current.startsAt)}
                      required
                      onChange={(e) =>
                        update(
                          "startsAt",
                          e.target.value ? new Date(e.target.value).toISOString() : "",
                        )
                      }
                    />
                  </label>
                  <label>
                    Окончание
                    <input
                      type="datetime-local"
                      value={localDate(current.endsAt)}
                      onChange={(e) =>
                        update(
                          "endsAt",
                          e.target.value ? new Date(e.target.value).toISOString() : null,
                        )
                      }
                    />
                  </label>
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={current.enabled ?? false}
                    onChange={(e) => update("enabled", e.target.checked)}
                  />
                  Включено
                </label>
                <label>
                  Причина
                  <input name="reason" minLength={3} maxLength={500} required />
                </label>
                <button>Сохранить</button>
              </fieldset>
              <SaveTemplate
                kind={
                  kind === "notifications"
                    ? "notification"
                    : current.scope === "global"
                      ? "announcement"
                      : "anime-notice"
                }
                payload={current}
                csrf={csrf}
              />
            </form>
            <div>
              <h3>Предпросмотр</h3>
              <article className={"message-preview message-" + current.kind}>
                <strong>{current.title || "Заголовок"}</strong>
                <p>{current.body || "Текст сообщения"}</p>
                {current.link && <span>Подробнее →</span>}
                {current.dismissible && <span className="preview-close">×</span>}
              </article>
              <dl>
                <div>
                  <dt>Аудитория</dt>
                  <dd>{current.audience}</dd>
                </div>
                <div>
                  <dt>Начало</dt>
                  <dd>{date(current.startsAt)}</dd>
                </div>
                <div>
                  <dt>Конец</dt>
                  <dd>{date(current.endsAt)}</dd>
                </div>
              </dl>
              <p className="muted">
                Уведомления появляются в личном центре уведомлений. Объявления показываются на
                страницах сайта.
              </p>
            </div>
          </div>
        </div>
      )}
      <Loading {...state} />
      {state.data && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Тип</th>
                  <th>Аудитория / размещение</th>
                  <th>Период</th>
                  <th>Статус</th>
                  <th>{kind === "notifications" ? "Прочитано" : "Приоритет"}</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((m) => (
                  <tr key={m.id}>
                    <td>{m.title}</td>
                    <td>{kinds[m.kind as keyof typeof kinds] ?? m.kind}</td>
                    <td>
                      {m.audience}
                      {m.planId && ` · ${m.planId}`}
                      {m.role && ` · ${m.role}`}
                      <small className="block muted">
                        {m.scope} {m.animeTitle}
                      </small>
                    </td>
                    <td>
                      {date(m.startsAt)}
                      <small className="block">{date(m.endsAt)}</small>
                    </td>
                    <td>{status(m)}</td>
                    <td>{kind === "notifications" ? m.readCount : m.priority}</td>
                    <td>
                      <button onClick={() => setDraft(m)}>Редактировать</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...state.data} onChange={setPage} />
        </>
      )}
    </>
  );
}
