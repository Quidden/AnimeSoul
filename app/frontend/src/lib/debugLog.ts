export type DebugLevel = "info" | "success" | "warning" | "error";

export type DebugEntry = {
  id: string;
  timestamp: number;
  level: DebugLevel;
  source: string;
  action: string;
  message: string;
  details?: string;
};

const DEBUG_STORAGE_KEY = "animesoul:debug-log:v1";
const MAX_DEBUG_ENTRIES = 500;
const subscribers = new Set<() => void>();
let installed = false;

function safeRead(): DebugEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(DEBUG_STORAGE_KEY) || "[]") as DebugEntry[];
    return Array.isArray(value) ? value.slice(0, MAX_DEBUG_ENTRIES) : [];
  } catch {
    return [];
  }
}

let entries: DebugEntry[] = typeof window === "undefined" ? [] : safeRead();

function notify() {
  subscribers.forEach((subscriber) => subscriber());
}

function sanitize(value: unknown) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value.slice(0, 1200);
  try {
    return JSON.stringify(value).slice(0, 1200);
  } catch {
    return String(value).slice(0, 1200);
  }
}

export function recordDebugEvent(
  level: DebugLevel,
  source: string,
  action: string,
  message: string,
  details?: unknown,
) {
  const entry: DebugEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    level,
    source: source.slice(0, 80),
    action: action.slice(0, 120),
    message: message.slice(0, 500),
    details: details === undefined ? undefined : sanitize(details),
  };
  entries = [entry, ...entries].slice(0, MAX_DEBUG_ENTRIES);
  try {
    localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Debug logging must never break the application if storage is unavailable.
  }
  notify();
}

export function getDebugEntries() {
  return entries;
}

export function subscribeDebugEntries(callback: () => void) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function clearDebugEntries() {
  entries = [];
  try {
    localStorage.removeItem(DEBUG_STORAGE_KEY);
  } catch {
    // Ignore restricted storage modes.
  }
  notify();
}

function controlLabel(element: HTMLElement) {
  const explicit = element.getAttribute("aria-label") || element.getAttribute("title");
  const visible = element.innerText?.replace(/\s+/g, " ").trim();
  return (explicit || visible || element.tagName.toLocaleLowerCase()).slice(0, 120);
}

export function installDebugCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    recordDebugEvent("error", "Интерфейс", "Ошибка JavaScript", event.message, event.error);
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordDebugEvent("error", "Интерфейс", "Необработанный запрос", "Операция завершилась с ошибкой", event.reason);
  });
  window.addEventListener("hashchange", () => {
    recordDebugEvent("info", "Навигация", "Изменён адрес", location.hash || "/");
  });
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>("button, a, [role='button'], summary")
        : null;
      if (!target || target.dataset.debugIgnore === "true") return;
      recordDebugEvent("info", "Действие", "Нажатие", controlLabel(target));
    },
    true,
  );

  recordDebugEvent("success", "Система", "Запуск интерфейса", "AnimeSoul готов к работе");
}
