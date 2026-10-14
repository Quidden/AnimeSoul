"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { DiagnosticEvent } from "@animesoul/diagnostics";
import { useSearchParams } from "next/navigation";
import { Pagination } from "./platform/Common";

export function UserDiagnostics() {
  const search = useSearchParams(),
    userId = search.get("userId") ?? "";
  const [items, setItems] = useState<DiagnosticEvent[]>([]);
  const [filters, setFilters] = useState(new URLSearchParams({ userId }).toString());
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/diagnostics?" + filters + "&page=" + page, {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error("Не удалось загрузить журнал. Проверь действующую сессию администратора.");
      const data = (await response.json()) as { items: DiagnosticEvent[]; total: number };
      setItems(data.items);
      setTotal(data.total);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Ошибка загрузки журнала.");
    } finally {
      setBusy(false);
    }
  }, [filters, page]);
  useEffect(() => {
    void load();
  }, [load]);
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPage(1);
    setFilters(
      new URLSearchParams({
        userId: String(form.get("userId") ?? ""),
        source: String(form.get("source") ?? ""),
        q: String(form.get("q") ?? ""),
        from: String(form.get("from") ?? ""),
        to: String(form.get("to") ?? ""),
      }).toString(),
    );
  }
  return (
    <section className="admin-panel user-diagnostics">
      <h2>Ошибки пользователей</h2>
      <p>
        События за 7 дней с серверной пагинацией. Время, страница, пользователь, код и переходы
        перед сбоем. Объём журнала ограничен 4 MB в сутки.
      </p>
      <form onSubmit={filter}>
        <label>
          Поиск по ошибке, странице или коду
          <input name="q" maxLength={200} />
        </label>
        <label>
          ID пользователя
          <input name="userId" maxLength={36} defaultValue={userId} />
        </label>
        <label>
          Источник
          <select name="source">
            <option value="">Все</option>
            <option value="browser">Браузер</option>
            <option value="web">Сайт</option>
            <option value="api">API</option>
          </select>
        </label>
        <div className="admin-actions">
          <label>
            С<input name="from" type="date" />
          </label>
          <label>
            По
            <input name="to" type="date" />
          </label>
          <button disabled={busy}>Найти</button>
          <button type="button" disabled={busy} onClick={() => void load()}>
            {busy ? "Загружаем…" : "Обновить"}
          </button>
        </div>
      </form>
      {notice ? (
        <p role="alert">{notice}</p>
      ) : !items.length && !busy ? (
        <p>Ошибок по этим условиям пока нет.</p>
      ) : null}
      {items.map((item) => (
        <details className="diagnostic-event" key={item.id}>
          <summary>
            <time dateTime={item.time}>{new Date(item.time).toLocaleString("ru")}</time> ·{" "}
            {item.source} · {item.path}
            <strong>{item.message}</strong>
          </summary>
          <p>Пользователь: {item.userId ?? "Гость / сессия не подтверждена"}</p>
          <p>
            Код: {item.digest || item.code || "—"} · Сессия: {item.sessionId || "—"}
          </p>
          <p>{item.browser}</p>
          {item.breadcrumbs.length > 0 && (
            <ol>
              {item.breadcrumbs.map((step, index) => (
                <li key={index}>
                  {step.kind === "navigation" ? "Переход" : "Запрос"}: {step.path}
                  {step.status ? ` · HTTP ${step.status}` : ""}
                </li>
              ))}
            </ol>
          )}
          {item.stack && <pre>{item.stack}</pre>}
        </details>
      ))}
      <Pagination page={page} pageSize={25} total={total} onChange={setPage} />
    </section>
  );
}
