export function diagnosticPath(value) {
  try {
    const url = new URL(String(value), "http://diagnostics.invalid");
    return url.pathname
      .replace(/\/auth\/google\/callback.*/, "/auth/google/callback")
      .slice(0, 500);
  } catch {
    return "/";
  }
}

export function diagnosticText(value, limit = 2000) {
  return (
    String(value ?? "")
      // Strip terminal colors before saving messages produced by development tools.
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9;]*m/g, "")
      .replace(/(?:https?|postgres(?:ql)?):\/\/[^\s<>"')]+/gi, (url) => {
        try {
          const parsed = new URL(url);
          if (parsed.protocol.startsWith("postgres")) return "[database]";
          return parsed.origin + diagnosticPath(url);
        } catch {
          return "[url]";
        }
      })
      .replace(/([?&][\w-]+=)[^\s&#"')]+/g, "$1[redacted]")
      .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[email]")
      .replace(/\b(?:Bearer\s+)?[\w-]{32,}(?:\.[\w-]+){0,2}\b/g, "[token]")
      .replace(
        /((?:password|secret|token|cookie|authorization|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi,
        "$1[redacted]",
      )
      .slice(0, limit)
  );
}

export function diagnosticError(error) {
  const object = error && typeof error === "object" ? error : {};
  let cause = object;
  let code = object.code;
  for (let depth = 0; depth < 5 && cause.cause && typeof cause.cause === "object"; depth++) {
    cause = cause.cause;
    code ??= cause.code;
  }
  return {
    message: diagnosticText(object.message ?? error, 1000),
    stack: diagnosticText(object.stack, 4000),
    digest: diagnosticText(object.digest, 100),
    code: diagnosticText(code ?? object.name, 100),
  };
}

export function normalizeDiagnostic(input) {
  const value = input && typeof input === "object" ? input : {};
  return {
    source: ["browser", "web", "api"].includes(value.source) ? value.source : "browser",
    kind: ["runtime", "rejection", "boundary", "request", "player"].includes(value.kind)
      ? value.kind
      : "runtime",
    severity: value.severity === "warning" ? "warning" : "error",
    path: diagnosticPath(value.path ?? "/"),
    message: diagnosticText(value.message, 1000),
    stack: diagnosticText(value.stack, 4000),
    digest: diagnosticText(value.digest, 100),
    code: diagnosticText(value.code, 100),
    sessionId: /^[a-f0-9-]{36}$/i.test(value.sessionId ?? "") ? value.sessionId : "",
    userId: /^[a-f0-9-]{36}$/i.test(value.userId ?? "") ? value.userId : null,
    browser: diagnosticText(value.browser, 200),
    breadcrumbs: Array.isArray(value.breadcrumbs)
      ? value.breadcrumbs.slice(-10).map((item) => ({
          kind: item?.kind === "navigation" ? "navigation" : "request",
          path: diagnosticPath(item?.path ?? "/"),
          ...(Number.isInteger(item?.status) && item.status >= 100 && item.status <= 599
            ? { status: item.status }
            : {}),
        }))
      : [],
  };
}
