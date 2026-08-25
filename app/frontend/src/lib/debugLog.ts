import { SourceMapConsumer, type RawSourceMap } from "source-map-js";

export type DebugLevel = "info" | "success" | "warning" | "error";

export type DebugLocation = {
  functionName: string;
  file: string;
  line?: number;
  column?: number;
};

export type DebugEntry = DebugLocation & {
  id: string;
  timestamp: number;
  level: DebugLevel;
  source: string;
  action: string;
  message: string;
  details?: string;
};

const DEBUG_STORAGE_KEY = "animesoul:debug-log:v1";
const MAX_DEBUG_ENTRIES = 5_000;
const subscribers = new Set<() => void>();
const sensitiveObjectKey = /^(?:access[_-]?token|refresh[_-]?token|token|authorization|client[_-]?secret|password|passwd|api[_-]?(?:key|token)|private[_-]?key|oauth[_-]?code)$/i;
const sensitiveQueryKey = /(?:token|secret|password|authorization|signature|credential|api[_-]?key|private[_-]?key|oauth|code|(?:^|_)sig(?:$|_))/i;
let installed = false;
let persistTimer: number | undefined;
let notifyTimer: number | undefined;
let requestSequence = 0;
const rawFetch = typeof window === "undefined" ? null : window.fetch.bind(window);
const sourceMapCache = new Map<string, Promise<SourceMapConsumer | null>>();

function redactText(value: string): string {
  return value
    .replace(/(bearer\s+)[\w.+\-/=]+/gi, "$1[скрыто]")
    .replace(/((?:access[_-]?token|refresh[_-]?token|client[_-]?secret|password|api[_-]?(?:key|token)|oauth[_-]?code)\s*[=:]\s*)[^\s&,;]+/gi, "$1[скрыто]");
}

export function sanitizeDebugUrl(value: string, stripQuery = false): string {
  try {
    const base = typeof location === "undefined" ? "http://animesoul.local" : location.origin;
    const url = new URL(value, base);
    url.username = "";
    url.password = "";
    if (stripQuery) {
      url.search = "";
    } else {
      for (const key of [...url.searchParams.keys()]) {
        if (sensitiveQueryKey.test(key)) url.searchParams.set(key, "[скрыто]");
      }
    }
    const sameOrigin = typeof location !== "undefined" && url.origin === location.origin;
    return redactText(sameOrigin ? `${url.pathname}${url.search}${url.hash}` : url.toString());
  } catch {
    return redactText(value).slice(0, 1_200);
  }
}

function sanitize(value: unknown): string {
  if (value instanceof Error) {
    return redactText(`${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`).slice(0, 4_000);
  }
  if (typeof value === "string") return redactText(value).slice(0, 4_000);
  try {
    return redactText(JSON.stringify(value, (key, nested) => {
      if (sensitiveObjectKey.test(key)) return "[скрыто]";
      if (nested instanceof URL) return sanitizeDebugUrl(nested.toString());
      if (nested instanceof Error) return `${nested.name}: ${nested.message}`;
      return nested;
    })).slice(0, 4_000);
  } catch {
    return redactText(String(value)).slice(0, 4_000);
  }
}

function normalizeStackFile(value: string): string {
  const withoutQuery = value.replace(/[?#].*$/, "");
  try {
    const url = new URL(withoutQuery);
    const sourceIndex = url.pathname.lastIndexOf("/src/");
    if (sourceIndex >= 0) return url.pathname.slice(sourceIndex + 1);
    return `${url.host}${url.pathname}`;
  } catch {
    return withoutQuery.replace(/^.*?[\\/]app[\\/]frontend[\\/]/i, "").replaceAll("\\", "/");
  }
}

function normalizeOriginalSource(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const sourceIndex = normalized.lastIndexOf("/src/");
  if (sourceIndex >= 0) return normalized.slice(sourceIndex + 1);
  return normalized.replace(/^(?:\.\.\/)+/, "");
}

function inferFunctionName(source: string | null, line: number): string | undefined {
  if (!source) return undefined;
  const lines = source.split("\n");
  for (let index = Math.min(line - 1, lines.length - 1); index >= Math.max(0, line - 100); index--) {
    const text = lines[index];
    const declaration = text.match(/(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([\w$]+)/);
    if (declaration) return declaration[1];
    const assigned = text.match(/(?:const|let|var)\s+([\w$]+)(?:\s*:[^=]+)?\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/);
    if (assigned) return assigned[1];
    const method = text.match(/^\s*(?:async\s+)?([\w$]+)\s*\([^)]*\)\s*\{/);
    if (method && !["if", "for", "while", "switch", "catch"].includes(method[1])) return method[1];
  }
  return undefined;
}

async function sourceMapFor(file: string): Promise<SourceMapConsumer | null> {
  const assetIndex = file.indexOf("/assets/");
  if (assetIndex < 0 || !rawFetch || typeof location === "undefined") return null;
  const mapUrl = `${location.origin}${file.slice(assetIndex)}.map`;
  let pending = sourceMapCache.get(mapUrl);
  if (!pending) {
    pending = rawFetch(mapUrl, { cache: "force-cache" })
      .then(async (response) => response.ok
        ? new SourceMapConsumer(await response.json() as RawSourceMap)
        : null)
      .catch(() => null);
    sourceMapCache.set(mapUrl, pending);
  }
  return pending;
}

async function resolveOriginalLocation(entry: DebugEntry) {
  if (!entry.line || entry.column === undefined || !entry.file.includes("/assets/")) return;
  const consumer = await sourceMapFor(entry.file);
  if (!consumer) return;
  const original = consumer.originalPositionFor({
    line: entry.line,
    column: Math.max(0, entry.column - 1),
  });
  if (!original.source || !original.line) return;
  entry.file = normalizeOriginalSource(original.source);
  entry.line = original.line;
  entry.column = original.column === null ? undefined : original.column + 1;
  const source = consumer.sourceContentFor(original.source, true);
  entry.functionName = inferFunctionName(source, original.line) || original.name || entry.functionName;
  schedulePersist();
  scheduleNotify();
}

/** Parse Chrome, WebView and Firefox stack frames into fields shown in Debug. */
export function parseDebugStack(stack?: string, skipDebugInternals = true): DebugLocation {
  const lines = (stack ?? "").split("\n").slice(1);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (skipDebugInternals && /(?:recordDebugEvent|parseDebugStack|debugLog\.(?:ts|js)|window\.fetch|installFetchCapture|installXhrCapture)/.test(line)) continue;
    const chrome = line.match(/^at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    const firefox = line.match(/^(.*?)@(.+?):(\d+):(\d+)$/);
    const match = chrome ?? firefox;
    if (!match) continue;
    return {
      functionName: (match[1] || "anonymous").replace(/^async\s+/, ""),
      file: normalizeStackFile(match[2]),
      line: Number(match[3]),
      column: Number(match[4]),
    };
  }
  return { functionName: "unknown", file: "unknown" };
}

function safeRead(): DebugEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(DEBUG_STORAGE_KEY) || "[]") as Array<Partial<DebugEntry>>;
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_DEBUG_ENTRIES).map((entry, index) => ({
      id: typeof entry.id === "string" ? entry.id : `legacy-${index}`,
      timestamp: Number(entry.timestamp) || Date.now(),
      level: ["info", "success", "warning", "error"].includes(entry.level ?? "")
        ? entry.level as DebugLevel
        : "info",
      source: String(entry.source ?? "Старый журнал"),
      action: String(entry.action ?? "Событие"),
      message: String(entry.message ?? ""),
      details: typeof entry.details === "string" ? entry.details : undefined,
      functionName: String(entry.functionName ?? "legacyEntry"),
      file: String(entry.file ?? "legacy/debug-log-v1"),
      line: Number.isFinite(entry.line) ? Number(entry.line) : undefined,
      column: Number.isFinite(entry.column) ? Number(entry.column) : undefined,
    }));
  } catch {
    return [];
  }
}

let entries: DebugEntry[] = typeof window === "undefined" ? [] : safeRead();

function flushDebugStorage() {
  persistTimer = undefined;
  try {
    localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Diagnostics must never break playback in a restricted storage mode.
  }
}

function schedulePersist() {
  if (persistTimer !== undefined || typeof window === "undefined") return;
  // Rewriting thousands of diagnostics entries is synchronous in localStorage.
  // Let rapid taps and navigation settle before doing that work on a WebView.
  persistTimer = window.setTimeout(flushDebugStorage, 1_000);
}

function notify() {
  subscribers.forEach((subscriber) => subscriber());
}

function scheduleNotify() {
  if (!subscribers.size || notifyTimer !== undefined || typeof window === "undefined") return;
  notifyTimer = window.setTimeout(() => {
    notifyTimer = undefined;
    // useSyncExternalStore compares snapshots by identity.
    entries = [...entries];
    notify();
  }, 100);
}

export function recordDebugEvent(
  level: DebugLevel,
  source: string,
  action: string,
  message: string,
  details?: unknown,
  explicitLocation?: DebugLocation,
) {
  const debugLocation = explicitLocation ?? parseDebugStack(new Error().stack);
  const entry: DebugEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    level,
    source: source.slice(0, 80),
    action: action.slice(0, 120),
    message: redactText(message).slice(0, 1_000),
    details: details === undefined ? undefined : sanitize(details),
    ...debugLocation,
  };
  entries.unshift(entry);
  if (entries.length > MAX_DEBUG_ENTRIES) entries.length = MAX_DEBUG_ENTRIES;
  schedulePersist();
  scheduleNotify();
  void resolveOriginalLocation(entry);
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
  if (persistTimer !== undefined) window.clearTimeout(persistTimer);
  if (notifyTimer !== undefined) window.clearTimeout(notifyTimer);
  persistTimer = undefined;
  notifyTimer = undefined;
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
  return (explicit || visible || element.tagName.toLocaleLowerCase()).slice(0, 160);
}

function reactEventHandlerName(element: HTMLElement, eventProp: string): string {
  const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  const props = propsKey ? (element as unknown as Record<string, unknown>)[propsKey] : undefined;
  if (!props || typeof props !== "object") return eventProp;
  const handler = (props as Record<string, unknown>)[eventProp];
  return typeof handler === "function" && handler.name ? handler.name : eventProp;
}

function browserLocation(functionName: string, file = "src/lib/debugLog.ts"): DebugLocation {
  return { functionName, file };
}

function mediaDetails(media: HTMLMediaElement) {
  return {
    element: media.tagName.toLocaleLowerCase(),
    source: media.currentSrc ? sanitizeDebugUrl(media.currentSrc, true) : "",
    currentTime: Number.isFinite(media.currentTime) ? Number(media.currentTime.toFixed(2)) : null,
    duration: Number.isFinite(media.duration) ? Number(media.duration.toFixed(2)) : null,
    paused: media.paused,
    playbackRate: media.playbackRate,
    readyState: media.readyState,
    networkState: media.networkState,
    mediaError: media.error ? { code: media.error.code, message: media.error.message } : null,
  };
}

function installConsoleCapture() {
  const levels: Array<[keyof Pick<Console, "debug" | "info" | "log" | "warn" | "error">, DebugLevel]> = [
    ["debug", "info"], ["info", "info"], ["log", "info"], ["warn", "warning"], ["error", "error"],
  ];
  for (const [method, level] of levels) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      const debugLocation = parseDebugStack(new Error().stack);
      recordDebugEvent(
        level,
        "Console",
        `console.${method}`,
        args.length ? sanitize(args[0]) : "Вызов без аргументов",
        args.length > 1 ? args.slice(1) : undefined,
        debugLocation,
      );
    };
  }
}

function installFetchCapture() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const request = input instanceof Request ? input : null;
    const method = String(init?.method || request?.method || "GET").toUpperCase();
    const rawUrl = request?.url || String(input);
    const url = sanitizeDebugUrl(rawUrl);
    const requestId = `fetch-${++requestSequence}`;
    const startedAt = performance.now();
    const debugLocation = parseDebugStack(new Error().stack);
    recordDebugEvent("info", "Сеть", `${method} →`, url, { requestId }, debugLocation);
    try {
      const response = await nativeFetch(...args);
      recordDebugEvent(
        response.ok ? "success" : "warning",
        "Сеть",
        `${method} ← ${response.status}`,
        url,
        { requestId, status: response.status, durationMs: Math.round(performance.now() - startedAt) },
        debugLocation,
      );
      return response;
    } catch (error) {
      recordDebugEvent(
        "error",
        "Сеть",
        `${method} ×`,
        url,
        { requestId, durationMs: Math.round(performance.now() - startedAt), error },
        debugLocation,
      );
      throw error;
    }
  };
}

function installXhrCapture() {
  type XhrTrace = { method: string; url: string; requestId: string; startedAt: number; location: DebugLocation };
  const traces = new WeakMap<XMLHttpRequest, XhrTrace>();
  const prototype = XMLHttpRequest.prototype as unknown as {
    open: (...args: unknown[]) => void;
    send: (...args: unknown[]) => void;
  };
  const nativeOpen = prototype.open;
  const nativeSend = prototype.send;

  prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    const method = String(args[0] ?? "GET").toUpperCase();
    const url = sanitizeDebugUrl(String(args[1] ?? ""));
    traces.set(this, {
      method,
      url,
      requestId: `xhr-${++requestSequence}`,
      startedAt: 0,
      location: browserLocation("XMLHttpRequest.open", "browser:xhr"),
    });
    return nativeOpen.apply(this, args);
  };
  prototype.send = function (this: XMLHttpRequest, ...args: unknown[]) {
    const trace = traces.get(this);
    if (trace) {
      trace.startedAt = performance.now();
      trace.location = parseDebugStack(new Error().stack);
      recordDebugEvent("info", "Сеть XHR", `${trace.method} →`, trace.url, { requestId: trace.requestId }, trace.location);
      this.addEventListener("loadend", () => {
        const ok = this.status >= 200 && this.status < 400;
        recordDebugEvent(
          ok ? "success" : "warning",
          "Сеть XHR",
          `${trace.method} ← ${this.status || "нет ответа"}`,
          sanitizeDebugUrl(this.responseURL || trace.url),
          { requestId: trace.requestId, status: this.status, durationMs: Math.round(performance.now() - trace.startedAt) },
          trace.location,
        );
      }, { once: true });
      this.addEventListener("error", () => {
        recordDebugEvent("error", "Сеть XHR", `${trace.method} ×`, trace.url, { requestId: trace.requestId }, trace.location);
      }, { once: true });
    }
    return nativeSend.apply(this, args);
  };
}

export function installDebugCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  installConsoleCapture();
  installFetchCapture();
  installXhrCapture();

  window.addEventListener("error", (event) => {
    const parsed = event.filename
      ? { functionName: event.error?.name || "window.onerror", file: normalizeStackFile(event.filename), line: event.lineno, column: event.colno }
      : parseDebugStack(event.error?.stack, false);
    recordDebugEvent("error", "Интерфейс", "Ошибка JavaScript", event.message, event.error, parsed);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    recordDebugEvent(
      "error",
      "Интерфейс",
      "Необработанный Promise",
      reason instanceof Error ? reason.message : "Операция завершилась с ошибкой",
      reason,
      parseDebugStack(reason instanceof Error ? reason.stack : undefined, false),
    );
  });
  const navigation = (action: string) => recordDebugEvent(
    "info", "Навигация", action, `${location.pathname}${location.search}${location.hash}`,
    undefined, browserLocation(`history.${action}`, "browser:history"),
  );
  window.addEventListener("hashchange", () => navigation("hashchange"));
  window.addEventListener("popstate", () => navigation("popstate"));
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history) as (
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ) => void;
    history[method] = ((data: unknown, unused: string, url?: string | URL | null) => {
      const result = original(data, unused, url);
      navigation(method);
      return result;
    }) as History[typeof method];
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("button, a, [role='button'], summary")
      : null;
    if (!target || target.dataset.debugIgnore === "true") return;
    recordDebugEvent(
      "info",
      "Действие",
      "Нажатие",
      controlLabel(target),
      { element: target.tagName.toLocaleLowerCase(), id: target.id || undefined, className: target.className || undefined },
      browserLocation(reactEventHandlerName(target, "onClick"), "browser:react-dom"),
    );
  }, true);
  document.addEventListener("change", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || target.matches("input[type='password']")) return;
    recordDebugEvent(
      "info", "Действие", "Изменение поля", controlLabel(target),
      { element: target.tagName.toLocaleLowerCase(), name: target.getAttribute("name") || undefined },
      browserLocation(reactEventHandlerName(target, "onChange"), "browser:react-dom"),
    );
  }, true);
  document.addEventListener("submit", (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    recordDebugEvent(
      "info", "Действие", "Отправка формы", form.getAttribute("aria-label") || form.className || "form",
      undefined, browserLocation(reactEventHandlerName(form, "onSubmit"), "browser:react-dom"),
    );
  }, true);

  const mediaEvents = [
    "loadstart", "loadedmetadata", "canplay", "play", "playing", "pause", "waiting", "stalled",
    "suspend", "seeking", "seeked", "ratechange", "volumechange", "ended", "error",
    "enterpictureinpicture", "leavepictureinpicture",
  ];
  for (const eventName of mediaEvents) {
    document.addEventListener(eventName, (event) => {
      if (!(event.target instanceof HTMLMediaElement)) return;
      const level: DebugLevel = eventName === "error" ? "error" : ["waiting", "stalled"].includes(eventName) ? "warning" : "info";
      recordDebugEvent(
        level, "Медиа", eventName, event.target.currentSrc ? sanitizeDebugUrl(event.target.currentSrc, true) : event.target.tagName,
        mediaDetails(event.target), browserLocation(`HTMLMediaElement.${eventName}`, "browser:media"),
      );
    }, true);
  }

  const lifecycle = (action: string, message: string) => recordDebugEvent(
    "info", "Система", action, message, undefined, browserLocation(`window.${action}`, "browser:lifecycle"),
  );
  window.addEventListener("focus", () => lifecycle("focus", "Приложение получило фокус"));
  window.addEventListener("blur", () => lifecycle("blur", "Приложение потеряло фокус"));
  window.addEventListener("online", () => lifecycle("online", "Сеть доступна"));
  window.addEventListener("offline", () => lifecycle("offline", "Сеть недоступна"));
  window.addEventListener("pagehide", flushDebugStorage);
  document.addEventListener("visibilitychange", () => lifecycle(
    "visibilitychange", `Документ: ${document.visibilityState}`,
  ));

  recordDebugEvent(
    "success", "Система", "Запуск интерфейса", "AnimeSoul готов к работе",
    { path: location.pathname, userAgent: navigator.userAgent }, browserLocation("installDebugCapture", "src/main.tsx"),
  );
}
