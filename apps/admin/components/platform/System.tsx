"use client";
import { useData } from "./api";
import { Loading } from "./Common";
type Health = {
  api: { status: string; uptimeSeconds: number; memoryMB: number };
  database: { status: string; latencyMs: number };
  providers: Record<string, string>;
  jobs: { status: string; count: number }[];
  events24h: number;
  errors: { total: number; retentionDays: number; dailyLimitMB: number };
  limits: {
    profileMedia: { avatar: number; banner: number };
    frameSearch: string;
    billingAvailable: boolean;
  };
  cache: string;
};
export function OperationalSummary() {
  const state = useData<Health>("system");
  return (
    <section className="panel">
      <Loading {...state} />
      {state.data && (
        <div className="toolbar">
          <span>
            API: <b>{state.data.api.status}</b>
          </span>
          <span>
            БД: <b>{state.data.database.status}</b> · {state.data.database.latencyMs} мс
          </span>
          <a href="/diagnostics">
            Ошибок за {state.data.errors.retentionDays} дней: <b>{state.data.errors.total}</b>
          </a>
          <a href="/system">Сервисы, очередь и лимиты →</a>
        </div>
      )}
    </section>
  );
}
export function System() {
  const state = useData<Health>("system");
  return (
    <>
      <button onClick={state.reload}>Обновить состояние</button>
      <Loading {...state} />
      {state.data && (
        <>
          <div className="stats-grid">
            <div className="stat">
              <span>API</span>
              <strong>{state.data.api.status}</strong>
              <small>
                {state.data.api.uptimeSeconds} сек. · {state.data.api.memoryMB} MB
              </small>
            </div>
            <div className="stat">
              <span>PostgreSQL</span>
              <strong>{state.data.database.status}</strong>
              <small>{state.data.database.latencyMs} мс</small>
            </div>
            <div className="stat">
              <span>Событий за 24 часа</span>
              <strong>{state.data.events24h}</strong>
            </div>
            <div className="stat">
              <span>Технические ошибки · {state.data.errors.retentionDays} дней</span>
              <strong>{state.data.errors.total}</strong>
              <small>Журнал ограничен {state.data.errors.dailyLimitMB} MB в сутки</small>
              <a href="/diagnostics">Открыть журнал →</a>
            </div>
          </div>
          <div className="two-columns">
            <section className="panel">
              <h2>Провайдеры</h2>
              <table>
                <tbody>
                  {Object.entries(state.data.providers).map(([name, status]) => (
                    <tr key={name}>
                      <th>{name}</th>
                      <td>{status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <a href="/catalog">Настройки и очередь импорта →</a>
              <p className="muted">
                Состояние конфигурации и доступа. Доступность внешних серверов фиксируется при
                реальных запросах.
              </p>
            </section>
            <section className="panel">
              <h2>Очередь задач</h2>
              <table>
                <tbody>
                  {state.data.jobs.map((j) => (
                    <tr key={j.status}>
                      <th>{j.status}</th>
                      <td>{j.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!state.data.jobs.length && <p>Задач нет.</p>}
            </section>
          </div>
          <section className="panel">
            <h2>Действующие ограничения</h2>
            <dl>
              <div>
                <dt>Аватар</dt>
                <dd>{state.data.limits.profileMedia.avatar / 1048576} MB</dd>
              </div>
              <div>
                <dt>Обложка</dt>
                <dd>{state.data.limits.profileMedia.banner / 1048576} MB</dd>
              </div>
              <div>
                <dt>Поиск по кадру</dt>
                <dd>{state.data.limits.frameSearch}</dd>
              </div>
              <div>
                <dt>Экспорт</dt>
                <dd>До 10 000 строк; доступ владельцу и администраторам</dd>
              </div>
              <div>
                <dt>Подписки</dt>
                <dd>Оплата отключена; действуют пробный период и ручная выдача доступа</dd>
              </div>
              <div>
                <dt>Кэш</dt>
                <dd>{state.data.cache}</dd>
              </div>
            </dl>
            <p className="muted">
              Лимитов запусков по тарифу в текущей бизнес-логике нет. Включение внешних провайдеров
              также зависит от разрешений окружения.
            </p>
          </section>
        </>
      )}
    </>
  );
}
