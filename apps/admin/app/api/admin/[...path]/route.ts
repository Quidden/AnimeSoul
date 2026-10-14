import { isTrustedRequestOrigin } from "@animesoul/contracts";
const paths = new Set([
  "GET /api/admin/subscriptions",
  "GET /api/admin/subscriptions/access",
  "POST /api/admin/subscriptions/plan",
  "POST /api/admin/subscriptions/promotion",
  "POST /api/admin/subscriptions/access",
  "POST /api/admin/auth/login",
  "GET /api/admin/auth/me",
  "POST /api/admin/auth/logout",
  "GET /api/admin",
  "GET /api/admin/catalog",
  "POST /api/admin/providers/switch",
  "POST /api/admin/providers/access",
  "POST /api/admin/catalog/import",
  "POST /api/admin/catalog/job",
  "POST /api/admin/catalog/resolve",
]);
async function proxy(request: Request) {
  const path = new URL(request.url).pathname;
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  const platform =
    /^(?:GET \/api\/admin\/platform\/(?:users(?:\.csv)?|users\/[0-9a-f-]{36}|journal(?:\.csv)?|analytics(?:\.csv)?|announcements(?:\/[0-9a-f-]{36})?|notifications(?:\/[0-9a-f-]{36})?|winter|maintenance|templates(?:\/[0-9a-f-]{36}(?:\/preview)?)?|search|system)|POST \/api\/admin\/platform\/(?:users\/[0-9a-f-]{36}(?:\/access)?|users-bulk|announcements|notifications|winter|maintenance|templates(?:\/[0-9a-f-]{36}\/(?:copy|publish))?))$/i.test(
      request.method + " " + path,
    );
  if (!paths.has(request.method + " " + path) && !platform)
    return Response.json({ message: "Not found" }, { status: 404, headers });
  const origin = new URL(process.env.ADMIN_URL ?? "http://localhost:8022").origin;
  if (
    request.method === "POST" &&
    (!isTrustedRequestOrigin(request.headers.get("origin"), origin) ||
      request.headers.get("x-animesoul-request") !== "1")
  )
    return Response.json({ message: "Forbidden" }, { status: 403, headers });
  if (Number(request.headers.get("content-length") ?? 0) > 65536)
    return Response.json({ message: "Request too large" }, { status: 413, headers });
  try {
    const reader = request.body?.getReader();
    let body = request.method === "POST" ? "" : undefined;
    if (reader && request.method === "POST") {
      const decoder = new TextDecoder();
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 65536) {
          await reader.cancel();
          return Response.json({ message: "Request too large" }, { status: 413, headers });
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    }
    if (body && new TextEncoder().encode(body).length > 65536)
      return Response.json({ message: "Request too large" }, { status: 413, headers });
    const response = await fetch(
      new URL(path + new URL(request.url).search, process.env.API_URL ?? "http://127.0.0.1:8020"),
      {
        method: request.method,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          Cookie: request.headers.get("cookie") ?? "",
          Origin: request.headers.get("origin") ?? "",
          "X-AnimeSoul-Request": request.headers.get("x-animesoul-request") ?? "",
          "X-CSRF-Token": request.headers.get("x-csrf-token") ?? "",
        },
        ...(body !== undefined ? { body } : {}),
      },
    );
    const result = new Response(await response.text(), {
      status: response.status,
      headers: {
        ...headers,
        "Content-Type":
          path.endsWith(".csv") && response.ok ? "text/csv; charset=utf-8" : "application/json",
        ...(path.endsWith(".csv") && response.ok
          ? { "Content-Disposition": 'attachment; filename="animesoul-export.csv"' }
          : {}),
      },
    });
    for (const cookie of response.headers.getSetCookie())
      result.headers.append("Set-Cookie", cookie);
    return result;
  } catch {
    return Response.json({ message: "Service unavailable" }, { status: 503, headers });
  }
}
export const GET = proxy;
export const POST = proxy;
