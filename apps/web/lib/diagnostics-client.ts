import {
  diagnosticError,
  diagnosticPath,
  normalizeDiagnostic,
  type Diagnostic,
} from "@animesoul/diagnostics/sanitize";

let sessionId = "";
const breadcrumbs: Diagnostic["breadcrumbs"] = [];
const recent = new Map<string, number>();
let windowStarted = 0;
let sent = 0;
function session() {
  if (sessionId) return sessionId;
  try {
    sessionId = sessionStorage.getItem("animesoul:diagnostic-session") ?? crypto.randomUUID();
    sessionStorage.setItem("animesoul:diagnostic-session", sessionId);
  } catch {
    sessionId = crypto.randomUUID();
  }
  return sessionId;
}
export function diagnosticBreadcrumb(item: Diagnostic["breadcrumbs"][number]) {
  breadcrumbs.push({ ...item, path: diagnosticPath(item.path) });
  if (breadcrumbs.length > 10) breadcrumbs.shift();
}
export function diagnosticNavigation(url: string) {
  diagnosticBreadcrumb({ kind: "navigation", path: diagnosticPath(url) });
}
export function reportClientError(
  error: unknown,
  kind: Diagnostic["kind"] = "runtime",
  path?: string,
) {
  try {
    const detail = diagnosticError(error);
    const route = diagnosticPath(path ?? window.location.pathname);
    const key = [kind, route, detail.message, detail.digest].join("|");
    const now = Date.now();
    if (now - (recent.get(key) ?? 0) < 5000) return;
    if (now - windowStarted > 60000) {
      windowStarted = now;
      sent = 0;
      recent.clear();
    }
    if (sent >= 20) return;
    recent.set(key, now);
    sent++;
    const body = normalizeDiagnostic({
      ...detail,
      source: "browser",
      kind,
      path: route,
      sessionId: session(),
      browser: navigator.userAgent,
      breadcrumbs,
    });
    void fetch("/api/diagnostics", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json", "X-AnimeSoul-Request": "1" },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch {
    /* Logging must not affect playback or navigation. */
  }
}

export function initializeClientDiagnostics() {
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    let path = "";
    try {
      const input = args[0];
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        window.location.href,
      );
      if (
        url.origin === window.location.origin &&
        url.pathname.startsWith("/api/") &&
        url.pathname !== "/api/diagnostics"
      )
        path = url.pathname;
    } catch {
      /* An invalid fetch will be handled by the caller. */
    }
    try {
      const response = await original(...args);
      if (path) {
        diagnosticBreadcrumb({ kind: "request", path, status: response.status });
        if (response.status >= 500 || response.status === 429)
          reportClientError(new Error(`HTTP ${response.status}: ${path}`), "request");
      }
      return response;
    } catch (error) {
      if (path && !(error instanceof Error && error.name === "AbortError")) {
        diagnosticBreadcrumb({ kind: "request", path });
        reportClientError(error, "request");
      }
      throw error;
    }
  };
  window.addEventListener("error", (event) => {
    if (event.error) reportClientError(event.error);
  });
  window.addEventListener("unhandledrejection", (event) =>
    reportClientError(event.reason, "rejection"),
  );
}
