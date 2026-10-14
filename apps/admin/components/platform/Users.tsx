"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import type {
  Account,
  AdminUsersPage,
  AdminUserDetail,
  AnalyticsReport,
  SubscriptionAdmin,
} from "@animesoul/contracts";
import { useData, useStored, query, api, date, localDate } from "./api";
import { Loading, Pagination, Notice, useConfirmation } from "./Common";
const columns = [
  ["id", "ID"],
  ["username", "Имя"],
  ["email", "Почта"],
  ["roles", "Роли"],
  ["permissions", "Права"],
  ["subscription", "Доступ"],
  ["createdAt", "Регистрация"],
  ["lastActiveAt", "Активность"],
  ["launches", "Запуски за месяц"],
  ["disabledAt", "Состояние"],
] as const;
function UserDetail({
  id,
  account,
  close,
  onUpdate,
}: {
  id: string;
  account: Account;
  close: () => void;
  onUpdate: () => void;
}) {
  const { ask, confirmation } = useConfirmation();
  const state = useData<AdminUserDetail>("users/" + id),
    activity = useData<AnalyticsReport>("analytics?period=30&userId=" + id),
    plans = useData<SubscriptionAdmin>("/api/admin/subscriptions"),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const owner = account.roles.includes("owner"),
    self = account.id === id;
  async function edit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state.data) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setNotice("");
    try {
      const body = {
        username: form.get("username"),
        about: form.get("about"),
        disabled: form.has("disabled"),
        ...(owner ? { roles: form.getAll("roles"), permissions: form.getAll("permissions") } : {}),
      };
      if (
        !(await ask(
          "Сохранить изменения аккаунта? Изменение прав или блокировка завершит его текущие сеансы.",
        ))
      )
        return;
      state.setData(
        await api<AdminUserDetail>(
          "users/" + id,
          {
            ...body,
            reason: form.get("reason"),
            version: state.data.user.version,
            operationId: crypto.randomUUID(),
          },
          account.csrfToken,
        ),
      );
      onUpdate();
      setNotice("Аккаунт обновлён.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }
  async function access(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state.data) return;
    const form = new FormData(event.currentTarget),
      enabled = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") !== "revoke";
    if (
      !(await ask(
        enabled
          ? "Выдать доступ по выбранному тарифу до указанной даты?"
          : "Отозвать доступ, включая постоянное разрешение и оставшийся пробный период?",
      ))
    )
      return;
    setBusy(true);
    try {
      state.setData(
        await api<AdminUserDetail>(
          "users/" + id + "/access",
          {
            enabled,
            planId: enabled ? form.get("planId") : null,
            expiresAt: enabled ? new Date(String(form.get("expiresAt"))).toISOString() : null,
            reason: form.get("reason"),
            version: state.data.user.version,
            operationId: crypto.randomUUID(),
          },
          account.csrfToken,
        ),
      );
      onUpdate();
      setNotice("Доступ обновлён.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Ошибка изменения доступа");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel user-detail">
      <div className="section-heading">
        <h2>{state.data?.user.username ?? "Карточка пользователя"}</h2>
        <button onClick={close}>Закрыть</button>
      </div>
      <Loading {...state} />
      {confirmation}
      <Notice text={notice} />
      {state.data && (
        <>
          <div className="detail-meta">
            <span>
              ID: <code>{id}</code>
            </span>
            <span>MFA: {state.data.mfaEnabled ? "Включён" : "Не настроен"}</span>
            <span>Почта: {state.data.emailVerified ? "Подтверждена" : "Не подтверждена"}</span>
            <span>Библиотека: {state.data.counts.library}</span>
            <span>Публикации: {state.data.counts.posts}</span>
            <span>Комментарии: {state.data.counts.comments}</span>
            <span>Активные сеансы: {state.data.counts.activeSessions}</span>
          </div>
          <p>
            Действующие права:{" "}
            <b>{state.data.effectiveRights.join(", ") || "Обычный пользователь"}</b>
          </p>
          <p>
            Доступ: {state.data.user.subscription.status} ·{" "}
            {state.data.user.subscription.planName ?? state.data.user.subscription.source} · до{" "}
            {date(state.data.user.subscription.expiresAt)}
          </p>
          <div className="toolbar">
            <Link href={"/journal?userId=" + id}>Персональная история действий →</Link>
            <Link href={"/analytics?userId=" + id}>Статистика пользователя →</Link>
            <Link href={"/diagnostics?userId=" + id}>Технические ошибки →</Link>
          </div>
          <Loading {...activity} />
          {activity.data && (
            <p>
              За 30 дней: визитов {activity.data.current.visits} · страниц{" "}
              {activity.data.current.pageViews} · запусков {activity.data.current.launches} ·
              использований функций{" "}
              {activity.data.features.reduce((total, feature) => total + feature.total, 0)}
            </p>
          )}
          <div className="two-columns">
            <form key={state.data.user.version} onSubmit={(e) => void edit(e)}>
              <h3>Профиль, роли и состояние</h3>
              <fieldset
                disabled={
                  busy ||
                  self ||
                  (!owner && state.data.user.roles.some((r) => ["owner", "admin"].includes(r)))
                }
              >
                <label>
                  Имя
                  <input
                    name="username"
                    minLength={2}
                    maxLength={40}
                    required
                    defaultValue={state.data.user.username}
                  />
                </label>
                <label>
                  О себе
                  <textarea
                    name="about"
                    maxLength={2000}
                    rows={3}
                    defaultValue={state.data.about}
                  />
                </label>
                <label className="check">
                  <input
                    name="disabled"
                    type="checkbox"
                    defaultChecked={Boolean(state.data.user.disabledAt)}
                  />
                  Аккаунт заблокирован
                </label>
                {owner && (
                  <>
                    <div className="check-row">
                      {["owner", "admin"].map((role) => (
                        <label className="check" key={role}>
                          <input
                            type="checkbox"
                            name="roles"
                            value={role}
                            defaultChecked={state.data!.user.roles.includes(role)}
                          />
                          {role}
                        </label>
                      ))}
                    </div>
                    <div className="check-row">
                      {["player.native", "providers.yummy.manage"].map((permission) => (
                        <label className="check" key={permission}>
                          <input
                            type="checkbox"
                            name="permissions"
                            value={permission}
                            defaultChecked={state.data!.user.permissions.includes(permission)}
                          />
                          {permission}
                        </label>
                      ))}
                    </div>
                  </>
                )}
                <label>
                  Причина
                  <input name="reason" minLength={3} maxLength={500} required />
                </label>
                <button>Сохранить аккаунт</button>
              </fieldset>
              {self && (
                <p className="muted">Собственный аккаунт изменяется через настройки сайта.</p>
              )}
            </form>
            <form onSubmit={(e) => void access(e)}>
              <h3>Подписка и срок доступа</h3>
              <fieldset
                disabled={
                  busy ||
                  self ||
                  (!owner && state.data.user.roles.some((r) => ["owner", "admin"].includes(r)))
                }
              >
                <label>
                  Тариф
                  <select
                    name="planId"
                    required
                    defaultValue={state.data.user.subscription.planId ?? ""}
                  >
                    <option value="">Выберите тариф</option>
                    {plans.data?.plans
                      .filter((p) => p.enabled && p.permissions.includes("player.native"))
                      .map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Окончание
                  <input
                    name="expiresAt"
                    type="datetime-local"
                    defaultValue={localDate(state.data.user.subscription.expiresAt)}
                  />
                </label>
                <label>
                  Причина
                  <input name="reason" minLength={3} maxLength={500} required />
                </label>
                <div className="button-row">
                  <button value="grant">Назначить / продлить</button>
                  <button className="danger" value="revoke" formNoValidate>
                    Отозвать доступ
                  </button>
                </div>
              </fieldset>
              <p className="muted">
                Ручная выдача доступа не создаёт оплату. Тариф и цена сохраняются в истории выдачи.
              </p>
              {state.data.trial && (
                <p>
                  Пробный период: {date(state.data.trial.startedAt)} —{" "}
                  {date(state.data.trial.expiresAt)}
                  {state.data.trial.revokedAt && " · отозван"}
                </p>
              )}
            </form>
          </div>
          <details>
            <summary>История доступа · последние {state.data.accessHistory.length} записей</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Выдан</th>
                    <th>Тариф / источник</th>
                    <th>Срок</th>
                    <th>Отзыв</th>
                    <th>Цена при выдаче</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.accessHistory.map((e) => (
                    <tr key={e.id}>
                      <td>{date(e.createdAt)}</td>
                      <td>
                        {e.planId ?? "—"} · {e.source}
                      </td>
                      <td>{date(e.expiresAt)}</td>
                      <td>{date(e.revokedAt)}</td>
                      <td>
                        {e.amountMinor === null
                          ? "Не задана"
                          : `${e.amountMinor / 100} ${e.currency}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
export function Users({ account }: { account: Account }) {
  const { ask, confirmation } = useConfirmation();
  const search = useSearchParams(),
    [selected, setSelected] = useState(search.get("user")),
    [checked, setChecked] = useState<string[]>([]),
    [reason, setReason] = useState(""),
    [notice, setNotice] = useState("");
  const [filters, setFilters] = useStored("animesoul:admin:users:filters", {
    q: "",
    role: "",
    permission: "",
    plan: "",
    subscription: "",
    status: "",
    activity: "",
    from: "",
    to: "",
    month: new Date().toISOString().slice(0, 7),
    minLaunches: "",
    maxLaunches: "",
    sort: "createdAt",
    direction: "desc",
    page: 1,
    pageSize: 25,
  });
  const [visible, setVisible] = useStored<string[]>(
    "animesoul:admin:users:columns",
    columns.map(([key]) => key),
  );
  const params = query(filters),
    state = useData<AdminUsersPage>("users?" + params),
    plans = useData<SubscriptionAdmin>("/api/admin/subscriptions");
  useEffect(() => setSelected(search.get("user")), [search]);
  const change = (key: string, value: string) => {
    setFilters((v) => ({ ...v, [key]: value, page: 1 }));
    setChecked([]);
  };
  function reset() {
    setFilters({
      q: "",
      role: "",
      permission: "",
      plan: "",
      subscription: "",
      status: "",
      activity: "",
      from: "",
      to: "",
      month: new Date().toISOString().slice(0, 7),
      minLaunches: "",
      maxLaunches: "",
      sort: "createdAt",
      direction: "desc",
      page: 1,
      pageSize: 25,
    });
    setChecked([]);
  }
  async function bulk(disabled: boolean) {
    if (!checked.length || reason.trim().length < 3) {
      setNotice("Выберите аккаунты и укажите причину.");
      return;
    }
    if (
      !(await ask(`${disabled ? "Заблокировать" : "Разблокировать"} ${checked.length} аккаунтов?`))
    )
      return;
    try {
      await api(
        "users-bulk",
        { ids: checked, disabled, reason, operationId: crypto.randomUUID() },
        account.csrfToken,
      );
      setChecked([]);
      state.reload();
      setNotice("Состояние аккаунтов обновлено.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Ошибка операции");
    }
  }
  return (
    <>
      <div className="toolbar filters">
        <input
          className="wide-input"
          aria-label="Поиск пользователей"
          placeholder="ID / имя / почта"
          value={filters.q}
          onChange={(e) => change("q", e.target.value)}
        />
        <select
          aria-label="Роль"
          value={filters.role}
          onChange={(e) => change("role", e.target.value)}
        >
          <option value="">Все роли</option>
          <option value="owner">Владелец</option>
          <option value="admin">Администратор</option>
          <option value="member">Пользователь</option>
        </select>
        <select
          aria-label="Разрешение"
          value={filters.permission}
          onChange={(e) => change("permission", e.target.value)}
        >
          <option value="">Все права</option>
          <option>player.native</option>
          <option>providers.yummy.manage</option>
        </select>
        <select
          aria-label="Тариф"
          value={filters.plan}
          onChange={(e) => change("plan", e.target.value)}
        >
          <option value="">Все тарифы</option>
          {plans.data?.plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Подписка"
          value={filters.subscription}
          onChange={(e) => change("subscription", e.target.value)}
        >
          <option value="">Любой доступ</option>
          <option value="active">Действующий</option>
          <option value="trial">Пробный</option>
          <option value="expired">Истёк</option>
          <option value="none">Нет</option>
        </select>
        <select
          aria-label="Аккаунт"
          value={filters.status}
          onChange={(e) => change("status", e.target.value)}
        >
          <option value="">Все аккаунты</option>
          <option value="enabled">Активные</option>
          <option value="disabled">Заблокированные</option>
        </select>
        <select
          aria-label="Активность"
          value={filters.activity}
          onChange={(e) => change("activity", e.target.value)}
        >
          <option value="">Любая активность</option>
          <option value="day">За сутки</option>
          <option value="week">За неделю</option>
          <option value="month">За месяц</option>
          <option value="inactive">Нет за 30 дней</option>
        </select>
        <label>
          Регистрация с
          <input
            type="date"
            value={filters.from}
            onChange={(e) => change("from", e.target.value)}
          />
        </label>
        <label>
          По
          <input type="date" value={filters.to} onChange={(e) => change("to", e.target.value)} />
        </label>
        <label>
          Месяц запусков
          <input
            type="month"
            value={filters.month}
            onChange={(e) => change("month", e.target.value)}
          />
        </label>
        <input
          aria-label="Минимум запусков"
          type="number"
          min={0}
          placeholder="Запусков от"
          value={filters.minLaunches}
          onChange={(e) => change("minLaunches", e.target.value)}
        />
        <input
          aria-label="Максимум запусков"
          type="number"
          min={0}
          placeholder="До"
          value={filters.maxLaunches}
          onChange={(e) => change("maxLaunches", e.target.value)}
        />
        <select
          aria-label="Сортировать по"
          value={filters.sort}
          onChange={(e) => change("sort", e.target.value)}
        >
          {["createdAt", "username", "email", "lastActiveAt", "launches"].map((k) => (
            <option key={k} value={k}>
              {columns.find(([id]) => id === k)?.[1]}
            </option>
          ))}
        </select>
        <select
          aria-label="Направление"
          value={filters.direction}
          onChange={(e) => change("direction", e.target.value)}
        >
          <option value="desc">По убыванию</option>
          <option value="asc">По возрастанию</option>
        </select>
        <select
          aria-label="На странице"
          value={filters.pageSize}
          onChange={(e) => setFilters({ ...filters, pageSize: Number(e.target.value), page: 1 })}
        >
          {[10, 25, 50, 100].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <button onClick={state.reload}>Обновить</button>
        <button onClick={reset}>Сбросить фильтры</button>
        <a className="button" href={"/api/admin/platform/users.csv?" + params}>
          CSV
        </a>
        <details className="column-picker">
          <summary>Колонки</summary>
          {columns.map(([key, label]) => (
            <label className="check" key={key}>
              <input
                type="checkbox"
                checked={visible.includes(key)}
                onChange={() =>
                  setVisible((v) => (v.includes(key) ? v.filter((k) => k !== key) : [...v, key]))
                }
              />
              {label}
            </label>
          ))}
        </details>
      </div>
      {confirmation}
      <Notice text={notice} />
      {selected && (
        <UserDetail
          key={selected}
          id={selected}
          account={account}
          close={() => setSelected(null)}
          onUpdate={state.reload}
        />
      )}
      <Loading {...state} />
      {state.data && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Выбрать страницу"
                      checked={checked.length === state.data.items.length && checked.length > 0}
                      onChange={(e) =>
                        setChecked(
                          e.target.checked
                            ? state
                                .data!.items.filter((u) => u.id !== account.id)
                                .slice(0, 50)
                                .map((u) => u.id)
                            : [],
                        )
                      }
                    />
                  </th>
                  {columns
                    .filter(([k]) => visible.includes(k))
                    .map(([k, label]) => (
                      <th key={k}>{label}</th>
                    ))}
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((u) => (
                  <tr key={u.id} className={selected === u.id ? "selected" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={"Выбрать " + u.username}
                        disabled={
                          u.id === account.id || (!checked.includes(u.id) && checked.length >= 50)
                        }
                        checked={checked.includes(u.id)}
                        onChange={() =>
                          setChecked((v) =>
                            v.includes(u.id) ? v.filter((id) => id !== u.id) : [...v, u.id],
                          )
                        }
                      />
                    </td>
                    {columns
                      .filter(([k]) => visible.includes(k))
                      .map(([key]) => (
                        <td key={key}>
                          {key === "id" ? (
                            <code title={u.id}>{u.id.slice(0, 8)}</code>
                          ) : key === "roles" ? (
                            u.roles.join(", ") || "Пользователь"
                          ) : key === "permissions" ? (
                            u.permissions.join(", ") || "—"
                          ) : key === "subscription" ? (
                            <span>
                              {u.subscription.planName ?? u.subscription.status}
                              <small className="block muted">
                                {date(u.subscription.expiresAt)}
                              </small>
                            </span>
                          ) : key === "createdAt" || key === "lastActiveAt" ? (
                            date(u[key])
                          ) : key === "disabledAt" ? (
                            u.disabledAt ? (
                              "Заблокирован"
                            ) : (
                              "Активен"
                            )
                          ) : (
                            u[key]
                          )}
                        </td>
                      ))}
                    <td>
                      <button onClick={() => setSelected(u.id)}>Открыть</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...state.data} onChange={(page) => setFilters({ ...filters, page })} />
          {checked.length > 0 && (
            <div className="toolbar bulk-bar">
              <strong>Выбрано {checked.length}</strong>
              <input
                aria-label="Причина массового изменения"
                placeholder="Причина изменения"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={3}
                maxLength={500}
              />
              <button className="danger" onClick={() => void bulk(true)}>
                Заблокировать
              </button>
              <button onClick={() => void bulk(false)}>Разблокировать</button>
              <button onClick={() => setChecked([])}>Снять выбор</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
