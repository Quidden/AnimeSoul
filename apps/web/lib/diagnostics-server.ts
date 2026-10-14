import "server-only";
import { writeDiagnostic } from "@animesoul/diagnostics";
import { diagnosticError, type Diagnostic } from "@animesoul/diagnostics/sanitize";

export async function diagnosticUser(cookie: string) {
  if (!cookie.includes("animesoul_web_session=")) return null;
  try {
    const response = await fetch(
      new URL("/api/auth/me", process.env.API_URL ?? "http://127.0.0.1:8020"),
      {
        headers: { Cookie: cookie },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(1500),
      },
    );
    if (!response.ok) return null;
    const value: unknown = await response.json();
    return typeof value === "object" &&
      value !== null &&
      "id" in value &&
      typeof value.id === "string"
      ? value.id
      : null;
  } catch {
    return null;
  }
}
export async function reportServerError(
  error: unknown,
  path: string,
  kind: Diagnostic["kind"] = "request",
  cookie = "",
) {
  return writeDiagnostic({
    ...diagnosticError(error),
    source: "web",
    kind,
    path,
    userId: await diagnosticUser(cookie),
  });
}
