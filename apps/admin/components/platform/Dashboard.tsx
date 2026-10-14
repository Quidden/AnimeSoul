"use client";
import { useSearchParams } from "next/navigation";
import { OperationalSummary } from "./System";
import { useState } from "react";
import type { AnalyticsReport, AnalyticsBucket, AnalyticsSummary } from "@animesoul/contracts";
import { useData, query, date } from "./api";
import { Loading } from "./Common";
const metrics: [keyof AnalyticsSummary, string][] = [
  ["totalUsers", "Всего пользователей"],
  ["registrations", "Регистрации"],
  ["dau", "DAU"],
  ["wau", "WAU"],
  ["mau", "MAU"],
  ["visits", "Визиты"],
  ["pageViews", "Просмотры страниц"],
  ["visitors", "Уникальные посетители"],
  ["launches", "Запуски видео"],
  ["launchUsers", "Уникальные зрители"],
  ["averageLaunches", "Запусков на зрителя"],
  ["activeSubscribers", "Доступ по подписке"],
  ["trials", "Пробный доступ"],
  ["nativePermissions", "Постоянный доступ"],
];
const series: [keyof AnalyticsBucket, string, string][] = [
  ["pageViews", "Просмотры страниц", "#9683ff"],
  ["visits", "Визиты", "#36b89a"],
  ["visitors", "Посетители", "#e1a251"],
  ["activeUsers", "Активные аккаунты", "#5eabef"],
  ["launches", "Запуски видео", "#ef7a98"],
  ["launchUsers", "Зрители", "#ad9b5c"],
  ["registrations", "Регистрации", "#34b6d5"],
  ["features", "Использование функций", "#af83d8"],
];
function delta(value: number, previous: number) {
  return previous
    ? `${value >= previous ? "+" : ""}${(((value - previous) / previous) * 100).toFixed(1)}%`
    : value
      ? "Новый показатель"
      : "0%";
}
function Chart({
  data,
  previous,
  initial,
  definitions = series,
  allowComparison = true,
}: {
  data: AnalyticsBucket[];
  previous: AnalyticsBucket[];
  initial: string[];
  definitions?: typeof series;
  allowComparison?: boolean;
}) {
  const [visible, setVisible] = useState(initial),
    [compare, setCompare] = useState(false),
    [selected, setSelected] = useState<number | null>(null);
  const maximum = Math.max(
    1,
    ...data.flatMap((b) =>
      definitions.filter(([k]) => visible.includes(k)).map(([k]) => Number(b[k])),
    ),
    ...(compare
      ? previous.flatMap((b) =>
          definitions.filter(([k]) => visible.includes(k)).map(([k]) => Number(b[k])),
        )
      : []),
  );
  const length = Math.max(data.length, compare ? previous.length : 0);
  const x = (i: number) => 48 + (length <= 1 ? 420 : (i / (length - 1)) * 900),
    y = (value: number) => 240 - (value / maximum) * 210;
  const points = (rows: AnalyticsBucket[], key: keyof AnalyticsBucket) =>
    rows.map((b, i) => `${x(i)},${y(Number(b[key]))}`).join(" ");
  return (
    <div className="panel chart-panel">
      <div className="chart-legend">
        {definitions.map(([key, label, color]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={visible.includes(key)}
              onChange={() =>
                setVisible((v) => (v.includes(key) ? v.filter((k) => k !== key) : [...v, key]))
              }
            />
            <i style={{ background: color }} />
            {label}
          </label>
        ))}
        {allowComparison && (
          <label>
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />
            Предыдущий период
          </label>
        )}
      </div>
      <div className="chart-scroll">
        <svg
          viewBox="0 0 980 290"
          role="img"
          aria-label="Динамика показателей. Выберите дату для точных значений."
        >
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line
                x1="48"
                x2="948"
                y1={y(maximum * t)}
                y2={y(maximum * t)}
                className="chart-grid"
              />
              <text x="38" y={y(maximum * t) + 4} textAnchor="end">
                {Math.round(maximum * t).toLocaleString("ru-RU")}
              </text>
            </g>
          ))}
          {definitions
            .filter(([key]) => visible.includes(key))
            .map(([key, label, color]) => (
              <g key={key}>
                {compare && (
                  <polyline
                    points={points(previous, key)}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    strokeDasharray="5 5"
                    opacity=".45"
                  />
                )}
                <polyline points={points(data, key)} fill="none" stroke={color} strokeWidth="2.5" />
                {data.map((b, i) => (
                  <circle
                    key={b.date}
                    cx={x(i)}
                    cy={y(Number(b[key]))}
                    r={selected === i ? 5 : 3}
                    fill={color}
                    tabIndex={0}
                    onFocus={() => setSelected(i)}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => setSelected(i)}
                    aria-label={`${b.date}: ${label} ${b[key]}`}
                  >
                    <title>
                      {b.date} · {label}: {b[key]}
                    </title>
                  </circle>
                ))}
              </g>
            ))}
          {data
            .filter(
              (_, i) =>
                i === 0 ||
                i === data.length - 1 ||
                i % Math.max(1, Math.floor(data.length / 6)) === 0,
            )
            .map((b) => (
              <text key={b.date} x={x(data.indexOf(b))} y="270" textAnchor="middle">
                {b.date}
              </text>
            ))}
        </svg>
      </div>
      {selected !== null && data[selected] && (
        <div className="chart-tooltip" role="status">
          <strong>{data[selected].date}</strong>
          {definitions
            .filter(([key]) => visible.includes(key))
            .map(([key, label]) => (
              <span key={key}>
                {label}: <b>{data[selected]![key]}</b>
                {compare &&
                  previous[selected] &&
                  ` · ранее ${previous[selected]![key]} (${previous[selected]!.date})`}
              </span>
            ))}
        </div>
      )}
      <details>
        <summary>Данные графика</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                {definitions
                  .filter(([k]) => visible.includes(k))
                  .map(([k, l]) => (
                    <th key={k}>{l}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.date}>
                  <td>{b.date}</td>
                  {definitions
                    .filter(([k]) => visible.includes(k))
                    .map(([k]) => (
                      <td key={k}>{b[k]}</td>
                    ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
export function Dashboard({ mode }: { mode: string }) {
  const search = useSearchParams();
  const [featureName, setFeatureName] = useState("");
  const [filters, setFilters] = useState({
    period: "30",
    group: "day",
    timezone: "Europe/Kyiv",
    from: "",
    to: "",
    userId: search.get("userId") ?? "",
    animeId: search.get("animeId") ?? "",
  });
  const params = query({
    ...filters,
    ...(filters.period !== "custom" ? { from: undefined, to: undefined } : {}),
  });
  const state = useData<AnalyticsReport>("analytics?" + params);
  return (
    <>
      {!mode && <OperationalSummary />}
      <div className="toolbar">
        <label>
          Период
          <select
            value={filters.period}
            onChange={(e) => setFilters({ ...filters, period: e.target.value })}
          >
            <option value="today">Сегодня</option>
            <option value="7">7 дней</option>
            <option value="30">30 дней</option>
            <option value="90">90 дней</option>
            <option value="custom">Свой период</option>
          </select>
        </label>
        {filters.period === "custom" && (
          <>
            <label>
              С
              <input
                type="date"
                value={filters.from}
                onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              />
            </label>
            <label>
              По
              <input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              />
            </label>
          </>
        )}
        <label>
          Группировка
          <select
            value={filters.group}
            onChange={(e) => setFilters({ ...filters, group: e.target.value })}
          >
            <option value="day">Дни</option>
            <option value="week">Недели</option>
            <option value="month">Месяцы</option>
          </select>
        </label>
        <label>
          Часовой пояс
          <select
            value={filters.timezone}
            onChange={(e) => setFilters({ ...filters, timezone: e.target.value })}
          >
            <option value="Europe/Kyiv">Киев</option>
            <option value="UTC">UTC</option>
          </select>
        </label>
        <input
          aria-label="ID пользователя для статистики"
          placeholder="ID пользователя"
          value={filters.userId}
          onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
        />
        <input
          aria-label="ID аниме для статистики"
          placeholder="ID аниме"
          value={filters.animeId}
          onChange={(e) => setFilters({ ...filters, animeId: e.target.value })}
        />
        <button onClick={state.reload}>Обновить</button>
        <a className="button" href={"/api/admin/platform/analytics.csv?" + params}>
          CSV
        </a>
      </div>
      <Loading {...state} />
      {state.data && (
        <>
          <p className="muted">
            {state.data.from} — {state.data.to} · сравнение с предыдущим равным периодом. Посещения
            и запуски собираются с {date(state.data.collectedSince)}. DAU/WAU/MAU — активные
            авторизованные аккаунты за 1/7/30 дней до конца периода.
          </p>
          <div className="stats-grid">
            {metrics
              .filter(([k]) =>
                mode === "activity"
                  ? ["dau", "wau", "mau", "launches", "launchUsers", "averageLaunches"].includes(k)
                  : mode === "features"
                    ? ["pageViews", "visitors", "launches"].includes(k)
                    : true,
              )
              .map(([key, label]) => (
                <div className="stat" key={key}>
                  <span>{label}</span>
                  <strong>
                    {state.data!.current[key].toLocaleString("ru-RU", { maximumFractionDigits: 2 })}
                  </strong>
                  <small>
                    {["activeSubscribers", "trials", "nativePermissions"].includes(key) ? (
                      "Текущее состояние"
                    ) : (
                      <>
                        {delta(state.data!.current[key], state.data!.previous[key])}
                        <span className="muted">
                          {" "}
                          · ранее{" "}
                          {state.data!.previous[key].toLocaleString("ru-RU", {
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </>
                    )}
                  </small>
                </div>
              ))}
          </div>
          <Chart
            key={mode}
            data={state.data.buckets}
            previous={state.data.previousBuckets}
            initial={
              mode === "activity"
                ? ["activeUsers", "launches"]
                : mode === "features"
                  ? ["features"]
                  : ["pageViews", "launches", "registrations"]
            }
          />
          {featureName && state.data.features.find((f) => f.name === featureName) && (
            <section>
              <div className="section-heading">
                <h2>{featureName}</h2>
                <button onClick={() => setFeatureName("")}>Закрыть график</button>
              </div>
              <Chart
                key={featureName}
                data={state.data.buckets.map((b) => ({
                  ...b,
                  features:
                    state
                      .data!.features.find((f) => f.name === featureName)!
                      .buckets.find((v) => v.date === b.date)?.value ?? 0,
                }))}
                previous={state.data.previousBuckets.map((b) => ({
                  ...b,
                  features:
                    state
                      .data!.features.find((f) => f.name === featureName)!
                      .previousBuckets.find((v) => v.date === b.date)?.value ?? 0,
                }))}
                initial={["features"]}
                definitions={[["features", featureName, "#9683ff"]]}
              />
            </section>
          )}
          <section className="panel">
            <h2>Использование серверной квоты trace.moe</h2>
            {state.data.quotaHistory.length ? (
              <>
                <p className="muted">
                  Последнее наблюдение каждого интервала. Квота относится ко всему серверу; период
                  сброса определяется сервисом.
                </p>
                <Chart
                  data={state.data.quotaHistory.map((v) => ({
                    date: v.date,
                    features: v.used,
                    pageViews: 0,
                    visits: 0,
                    visitors: 0,
                    activeUsers: 0,
                    launches: 0,
                    launchUsers: 0,
                    registrations: 0,
                  }))}
                  previous={[]}
                  initial={["features"]}
                  definitions={[["features", "Использовано запросов", "#36b89a"]]}
                  allowComparison={false}
                />
                <table>
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Использовано</th>
                      <th>Лимит</th>
                      <th>Осталось</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.quotaHistory.map((v) => (
                      <tr key={v.date}>
                        <td>{v.date}</td>
                        <td>{v.used}</td>
                        <td>{v.total}</td>
                        <td>{Math.max(0, v.total - v.used)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="muted">
                Наблюдений за выбранный период пока нет. Квота сохраняется при запросах поиска по
                кадру и проверки его лимита.
              </p>
            )}
          </section>
          <div className="two-columns">
            <section className="panel">
              <h2>Использование функций</h2>
              <table>
                <thead>
                  <tr>
                    <th>Функция</th>
                    <th>Сейчас</th>
                    <th>Ранее</th>
                    <th>Изменение</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.features.map((f) => (
                    <tr key={f.name}>
                      <td>
                        <button className="text-button" onClick={() => setFeatureName(f.name)}>
                          {f.name}
                        </button>
                      </td>
                      <td>{f.total}</td>
                      <td>{f.previous}</td>
                      <td>{delta(f.total, f.previous)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!state.data.features.length && <p>В выбранном периоде событий ещё нет.</p>}
            </section>
            <section className="panel">
              <h2>Действующие тарифы</h2>
              <table>
                <thead>
                  <tr>
                    <th>Тариф</th>
                    <th>Пользователей</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.subscriptions.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>
                        <span
                          className="subscription-bar"
                          style={{
                            width:
                              (Math.max(...state.data!.subscriptions.map((v) => v.users), 1)
                                ? (p.users /
                                    Math.max(...state.data!.subscriptions.map((v) => v.users), 1)) *
                                  100
                                : 0) + "%",
                          }}
                          title={String(p.users)}
                        />
                        {p.users}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">
                Текущее состояние. Пробный и постоянный доступ учитываются отдельно.
              </p>
            </section>
          </div>
        </>
      )}
    </>
  );
}
