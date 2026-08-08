import { useMemo, useState, useSyncExternalStore } from "react";
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

export function DebugPanel() {
  const entries = useSyncExternalStore(subscribeDebugEntries, getDebugEntries, () => []);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<DebugLevel | "all">("all");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    return entries.filter((entry) => {
      if (level !== "all" && entry.level !== level) return false;
      if (!normalized) return true;
      return `${entry.source} ${entry.action} ${entry.message} ${entry.details ?? ""}`
        .toLocaleLowerCase("ru")
        .includes(normalized);
    });
  }, [entries, level, query]);

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
        <p>Хранит до 500 последних событий только на этом устройстве. Содержимое полей, API-ключи и выбранные файлы не записываются.</p>
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
        <span>{filtered.length} из {entries.length} событий</span>
        <span className="debug-live"><i /> журнал обновляется в реальном времени</span>
      </div>
      <div className="debug-events" role="log" aria-live="polite">
        {filtered.length === 0 && <div className="debug-empty">Подходящих событий пока нет.</div>}
        {filtered.map((entry) => (
          <div
            key={entry.id}
            className={`debug-console-line ${entry.level}`}
            title={`${LEVEL_LABELS[entry.level]} · ${entry.source} · ${entry.action}`}
          >
            <i aria-hidden="true" />
            <time>{new Date(entry.timestamp).toLocaleTimeString("ru-RU")}</time>
            <span className="debug-console-text">
              <b>[{entry.source}]</b> {entry.action} — {entry.message}
              {entry.details && <small> · {entry.details}</small>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
