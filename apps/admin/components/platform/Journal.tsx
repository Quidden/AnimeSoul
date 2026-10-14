"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { JournalPage } from "@animesoul/contracts";
import { useData, query, date } from "./api";
import { Loading, Pagination } from "./Common";
export function Journal({
  category,
  subscriptions = false,
}: {
  category: "admin" | "user";
  subscriptions?: boolean;
}) {
  const search = useSearchParams();
  const [filters, setFilters] = useState({
    q: "",
    userId: search.get("userId") ?? "",
    actorId: "",
    action: subscriptions ? "subscription." : "",
    from: "",
    to: "",
    direction: "desc",
    page: 1,
    pageSize: 25,
  });
  const params = query({
      ...filters,
      category: filters.userId && category === "user" ? "all" : category,
    }),
    state = useData<JournalPage>("journal?" + params);
  const [selected, setSelected] = useState<string | null>(null);
  const change = (key: string, value: string) =>
    setFilters((v) => ({ ...v, [key]: value, page: 1 }));
  return (
    <>
      <div className="toolbar">
        <input
          aria-label="Поиск событий"
          placeholder="Действие, причина, объект…"
          value={filters.q}
          onChange={(e) => change("q", e.target.value)}
        />
        <input
          aria-label="ID пользователя"
          placeholder="ID пользователя"
          value={filters.userId}
          onChange={(e) => change("userId", e.target.value)}
        />
        <input
          aria-label="ID администратора"
          placeholder="ID автора действия"
          value={filters.actorId}
          onChange={(e) => change("actorId", e.target.value)}
        />
        <input
          aria-label="Действие"
          placeholder="Тип действия"
          value={filters.action}
          onChange={(e) => change("action", e.target.value)}
        />
        <label>
          С
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
        <select
          aria-label="Сортировка"
          value={filters.direction}
          onChange={(e) => change("direction", e.target.value)}
        >
          <option value="desc">Сначала новые</option>
          <option value="asc">Сначала старые</option>
        </select>
        <button onClick={state.reload}>Обновить</button>
        <a className="button" href={"/api/admin/platform/journal.csv?" + params}>
          CSV
        </a>
      </div>
      <Loading {...state} />
      <p className="muted">
        Журнал подтверждённых действий. Технические ошибки доступны в отдельном разделе. Пароли,
        токены и приватные тексты в журнал не записываются.
      </p>
      {state.data && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Действие</th>
                  <th>Пользователь / администратор</th>
                  <th>Объект</th>
                  <th>Причина</th>
                  <th>Результат</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((e) => (
                  <tr
                    key={e.id}
                    className={selected === e.id ? "selected" : ""}
                    onClick={() => setSelected(selected === e.id ? null : e.id)}
                  >
                    <td>{date(e.time)}</td>
                    <td>
                      <button
                        className="text-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected(selected === e.id ? null : e.id);
                        }}
                      >
                        {e.action}
                      </button>
                    </td>
                    <td>
                      {e.actorName ??
                        e.actorId ??
                        (e.action.startsWith("analytics.") ? "Гость" : "Система")}
                    </td>
                    <td className="mono">{e.objectId ?? "—"}</td>
                    <td>{e.reason ?? "—"}</td>
                    <td>Успешно</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...state.data} onChange={(page) => setFilters({ ...filters, page })} />
          {selected && (
            <section className="panel">
              <h2>Детали события</h2>
              <pre>
                {JSON.stringify(
                  state.data.items.find((e) => e.id === selected),
                  null,
                  2,
                )}
              </pre>
            </section>
          )}
        </>
      )}
    </>
  );
}
