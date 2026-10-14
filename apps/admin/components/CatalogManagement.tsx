"use client";
import { useEffect, useState, type FormEvent } from "react";
import { catalogAdminSchema, type CatalogAdmin } from "@animesoul/contracts";
const states: Record<string, string> = {
  enabled: "Включён",
  disabled: "Выключен",
  "environment-blocked": "Запрещён конфигурацией сервера",
  "missing-credentials": "Нет ключа",
  error: "Ошибка соединения",
  queued: "В очереди",
  running: "Импортируется",
  paused: "Приостановлен",
  completed: "Завершён",
  failed: "Ошибка",
  cancelled: "Отменён",
};
async function request(path: string, body?: unknown, csrf = "") {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-AnimeSoul-Request": "1",
      "X-CSRF-Token": csrf,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "Состояние изменилось или действие запрещено настройками сервера. Обновите список."
        : response.status === 401 || response.status === 403
          ? "Требуется действующая сессия администратора с MFA."
          : "Не удалось выполнить действие. Проверьте причину и доступность сервиса.",
    );
  return (await response.json()) as unknown;
}
export function CatalogManagement({ csrf, siteUrl }: { csrf: string; siteUrl: string }) {
  const [data, setData] = useState<CatalogAdmin | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const value = catalogAdminSchema.parse(await request("/api/admin/catalog?page=" + page));
        if (live) setData(value);
      } catch (error) {
        if (live) setNotice(error instanceof Error ? error.message : "Ошибка загрузки.");
      }
    }
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [page]);
  async function act(
    event: FormEvent<HTMLFormElement>,
    path: string,
    fields: Record<string, unknown>,
  ) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setNotice("");
    try {
      await request(
        path,
        {
          ...fields,
          reason: values.get("reason"),
          ...(values.has("username") ? { username: values.get("username") } : {}),
          ...(values.has("decision") ? { decision: values.get("decision") } : {}),
        },
        csrf,
      );
      form.reset();
      setData(catalogAdminSchema.parse(await request("/api/admin/catalog?page=" + page)));
      setNotice("Действие сохранено в аудите.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Ошибка операции.");
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <p role="status">{notice || "Загружаем каталог и провайдеры…"}</p>;
  const active = data.jobs.find(
    (job) => job.provider === "kodik" && ["queued", "running", "paused"].includes(job.status),
  );
  return (
    <div className="catalog-admin">
      <h2>Каталог и провайдеры</h2>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="provider-grid">
        {data.providers.map((provider) => (
          <section className="admin-panel" key={provider.name}>
            <h3>{provider.name === "yummy" ? "YummyAnime" : "Kodik"}</h3>
            <p>
              {provider.name === "kodik"
                ? "Основной каталог и просмотр"
                : "Глобальный резерв просмотра для всего сайта"}
            </p>
            <p>{states[provider.state]}</p>
            <p>
              Сервер разрешает: {provider.environmentAllows ? "да" : "нет"} · ключ:{" "}
              {provider.hasCredentials ? "настроен" : "не настроен"}
            </p>
            {(
              provider.name === "yummy" ? data.access.canSwitchReserve : data.access.canSwitchKodik
            ) ? (
              <form
                onSubmit={(event) =>
                  void act(event, "/api/admin/providers/switch", {
                    provider: provider.name,
                    enabled: !provider.enabled,
                  })
                }
              >
                <label>
                  Причина изменения
                  <input name="reason" required minLength={3} maxLength={500} />
                </label>
                <button
                  disabled={
                    busy ||
                    (!provider.enabled && (!provider.environmentAllows || !provider.hasCredentials))
                  }
                >
                  {provider.enabled ? "Выключить" : "Включить"}
                </button>
              </form>
            ) : (
              <p>Управлять этим переключателем может владелец или аккаунт с выданным правом.</p>
            )}
          </section>
        ))}
      </div>

      {data.access.canDelegateReserve && (
        <section className="admin-panel">
          <h3>Доступ к глобальному резерву просмотра</h3>
          <p>
            Владелец может выдать это право зарегистрированному аккаунту. Оно позволяет включать и
            выключать резерв для всего сайта. Остальные права администратора не выдаются. После
            изменения доступа потребуется заново войти в панель с MFA.
          </p>
          <form
            onSubmit={(event) => void act(event, "/api/admin/providers/access", { enabled: true })}
          >
            <label>
              Имя пользователя
              <input name="username" required minLength={2} maxLength={40} />
            </label>
            <label>
              Причина выдачи
              <input name="reason" required minLength={3} maxLength={500} />
            </label>
            <button disabled={busy}>Выдать право</button>
          </form>
          {!data.reserveManagers.length && <p>Право пока есть только у владельца.</p>}
          {data.reserveManagers.map((manager) => (
            <form
              key={manager.username}
              onSubmit={(event) =>
                void act(event, "/api/admin/providers/access", {
                  username: manager.username,
                  enabled: false,
                })
              }
            >
              <strong>{manager.username}</strong>
              <label>
                Причина отзыва
                <input name="reason" required minLength={3} maxLength={500} />
              </label>
              <button disabled={busy}>Отозвать право</button>
            </form>
          ))}
        </section>
      )}
      {data.access.canManageCatalog && (
        <>
          <section className="admin-panel">
            <h3>Фоновый импорт</h3>
            <p>
              Каталог обновляется из Kodik. Разные озвучки объединяются в один тайтл. Прогресс
              восстанавливается после перезапуска. Выключение Kodik приостанавливает импорт;
              выключение YummyAnime отключает только резерв просмотра.
            </p>
            <form onSubmit={(event) => void act(event, "/api/admin/catalog/import", {})}>
              <label>
                Причина запуска
                <input name="reason" required minLength={3} maxLength={500} />
              </label>
              <button disabled={busy || Boolean(active)}>Обновить весь каталог Kodik</button>
            </form>
            {data.jobs.map((job) => (
              <article className="import-job" key={job.id}>
                <strong>{states[job.status]}</strong> ·{" "}
                {job.provider === "kodik" ? "Kodik" : "YummyAnime (архив)"} · {job.imported}{" "}
                выпусков · {job.pages} страниц
                <p>
                  Пропущено: {job.rejected} · конфликтов ID: {job.conflicts} · позиция: {job.offset}
                  {job.upperBound
                    ? ` / ${job.upperBound} (${Math.min(100, Math.floor((job.offset * 100) / job.upperBound))}%)`
                    : ""}
                  {job.lastError ? ` · причина: ${job.lastError}` : ""}
                </p>
                {(["queued", "running", "paused"].includes(job.status) ||
                  (job.status === "failed" &&
                    job.provider === "kodik" &&
                    job.strategy === "kodik-cursor")) && (
                  <form
                    onSubmit={(event) =>
                      void act(event, "/api/admin/catalog/job", {
                        id: job.id,
                        action:
                          (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ??
                          "cancel",
                      })
                    }
                  >
                    <label>
                      Причина действия
                      <input name="reason" required minLength={3} maxLength={500} />
                    </label>
                    <div className="admin-actions">
                      {["paused", "failed"].includes(job.status) &&
                        job.provider === "kodik" &&
                        job.strategy === "kodik-cursor" && (
                          <button value="resume" disabled={busy}>
                            Продолжить
                          </button>
                        )}
                      <button value="cancel" disabled={busy}>
                        Отменить задание
                      </button>
                    </div>
                  </form>
                )}
              </article>
            ))}
          </section>
          <section className="admin-panel">
            <h3>Спорные соответствия ID · {data.totalConflicts}</h3>
            <p>
              Сверьте тайтлы и внешний ID перед решением. UUID, URL и библиотека пользователей
              сохраняются.
            </p>
            {!data.totalConflicts && <p>Открытых конфликтов нет.</p>}
            {data.conflicts.map((conflict) => (
              <article className="mapping-conflict" key={conflict.id + ":" + conflict.version}>
                <h4>
                  {conflict.provider} · ID {conflict.externalId}
                </h4>
                <p>
                  Из импорта:{" "}
                  <a
                    href={siteUrl + "/anime/" + conflict.incoming.slug}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {conflict.incoming.title}
                  </a>{" "}
                  ({conflict.incoming.year})<small>{conflict.incoming.id}</small>
                </p>
                <p>
                  Текущий владелец:{" "}
                  {conflict.existing
                    ? `${conflict.existing.title} (${conflict.existing.year})`
                    : "ID пока свободен"}
                  <small>{conflict.existing?.id}</small>
                </p>
                {conflict.previousExternalId && (
                  <p>
                    У тайтла из импорта уже есть ID этого источника: {conflict.previousExternalId}
                  </p>
                )}
                <form
                  onSubmit={(event) =>
                    void act(event, "/api/admin/catalog/resolve", {
                      id: conflict.id,
                      version: conflict.version,
                    })
                  }
                >
                  <label>
                    Решение
                    <select name="decision" required defaultValue="">
                      <option value="" disabled>
                        Выберите после проверки
                      </option>
                      <option value="keep-existing">Оставить текущее соответствие</option>
                      <option value="use-incoming">Назначить ID тайтлу из импорта</option>
                    </select>
                  </label>
                  <label>
                    Обоснование
                    <input name="reason" required minLength={3} maxLength={500} />
                  </label>
                  <button disabled={busy}>Сохранить решение</button>
                </form>
              </article>
            ))}
            {data.pages > 1 && (
              <nav className="admin-actions" aria-label="Страницы конфликтов">
                <button disabled={busy || data.page <= 1} onClick={() => setPage(data.page - 1)}>
                  ← Назад
                </button>
                <span>
                  {data.page} / {data.pages}
                </span>
                <button
                  disabled={busy || data.page >= data.pages}
                  onClick={() => setPage(data.page + 1)}
                >
                  Далее →
                </button>
              </nav>
            )}
          </section>
        </>
      )}
    </div>
  );
}
