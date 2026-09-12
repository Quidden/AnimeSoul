import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  clearDebugEntries,
  getDebugEntries,
  subscribeDebugEntries,
  type DebugLevel,
} from "../lib/debugLog";

const LEVEL_LABELS: Record<DebugLevel, string> = {
  info: "Информация",
  success: "Успешно",
  warning: "Предупреждение",
  error: "Ошибка",
};

const INITIAL_VISIBLE_ENTRIES = 200;
const VISIBLE_ENTRIES_STEP = 200;

export function DebugPanel() {
  const entries = useSyncExternalStore(subscribeDebugEntries, getDebugEntries, () => []);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<DebugLevel | "all">("all");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ENTRIES);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    return entries.filter((entry) => {
      if (level !== "all" && entry.level !== level) return false;
      if (!normalized) return true;
      return `${entry.source} ${entry.action} ${entry.message} ${entry.details ?? ""} ${entry.functionName} ${entry.file} ${entry.line ?? ""}`
        .toLocaleLowerCase("ru")
        .includes(normalized);
    });
  }, [entries, level, query]);
  const visibleEntries = filtered.slice(0, visibleCount);

  useEffect(() => setVisibleCount(INITIAL_VISIBLE_ENTRIES), [level, query]);

  const copyLog = async () => {
    await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
  };

  const exportLog = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `animesoul-debug-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="debug-panel">
      <div className="debug-privacy">
        <b>Локальный журнал</b>
        <p>Хранит до 5000 последних событий только на этом устройстве. Записывает функцию, файл и строку вызова, сеть, плеер, действия и системные события. Содержимое полей, тела запросов, API-ключи и выбранные файлы не записываются.</p>
      </div>
      <div className="debug-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти событие, статус или ошибку…" />
        <select value={level} onChange={(event) => setLevel(event.target.value as DebugLevel | "all")}>
          <option value="all">Все уровни</option>
          {Object.entries(LEVEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="button" onClick={copyLog}>Копировать</button>
        <button type="button" onClick={exportLog}>Выгрузить JSON</button>
        <button type="button" className="danger" onClick={clearDebugEntries}>Очистить</button>
      </div>
      <div className="debug-summary">
        <span>Показано {visibleEntries.length} из {filtered.length} · всего {entries.length}</span>
        <span className="debug-live"><i /> журнал обновляется в реальном времени</span>
      </div>
      <div className="debug-events" role="log" aria-live="polite">
        {filtered.length === 0 && <div className="debug-empty">Подходящих событий пока нет.</div>}
        {visibleEntries.map((entry) => (
          <div
            key={entry.id}
            className={`debug-console-line ${entry.level}`}
            title={`${LEVEL_LABELS[entry.level]} · ${entry.source} · ${entry.action}`}
          >
            <i aria-hidden="true" />
            <time>{new Date(entry.timestamp).toLocaleTimeString("ru-RU")}</time>
            <span className="debug-console-text">
              <span><b>[{entry.source}]</b> {entry.action} — {entry.message}</span>
              <code className="debug-location">
                {entry.functionName} · {entry.file}{entry.line ? `:${entry.line}${entry.column ? `:${entry.column}` : ""}` : ""}
              </code>
              {entry.details && <small>{entry.details}</small>}
            </span>
          </div>
        ))}
      </div>
      {visibleEntries.length < filtered.length && (
        <button
          type="button"
          className="debug-show-more"
          onClick={() => setVisibleCount((current) => current + VISIBLE_ENTRIES_STEP)}
        >
          Показать ещё {Math.min(VISIBLE_ENTRIES_STEP, filtered.length - visibleEntries.length)}
        </button>
      )}
    </div>
  );
}
