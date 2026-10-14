import "server-only";
import { isTrustedRequestOrigin } from "@animesoul/contracts";
import { writeDiagnostic } from "@animesoul/diagnostics";
import { diagnosticError } from "@animesoul/diagnostics/sanitize";
const paths = new Set([
  "GET /api/subscription",
  "GET /api/search",
  "GET /api/characters/search",
  "GET /api/catalog/random",
  "GET /api/catalog",
  "GET /api/auth/me",
  "GET /api/auth/developer-access",
  "POST /api/auth/developer-access",
  "GET /api/auth/options",
  "POST /api/auth/google/start",
  "POST /api/auth/email/verify",
  "POST /api/auth/email/change",
  "POST /api/auth/email/confirm",
  "POST /api/auth/password/request-reset",
  "POST /api/auth/password/reset",
  "POST /api/auth/register",
  "POST /api/auth/claim",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "POST /api/auth/logout-all",
  "POST /api/auth/password",
  "POST /api/auth/mfa/begin",
  "POST /api/auth/mfa/confirm",
  "GET /api/account/profile",
  "POST /api/account/profile",
  "POST /api/account/profile/media",
  "GET /api/account/player",
  "POST /api/account/player/preferences",
  "POST /api/account/player/favorite",
  "POST /api/account/player/dubbing",
  "GET /api/account/library",
  "POST /api/account/library",
  "POST /api/account/ratings",
  "POST /api/account/folders",
  "POST /api/account/folders/delete",
  "POST /api/account/folders/entry",
  "POST /api/account/progress",
  "POST /api/account/playback/session",
  "POST /api/account/playback/progress",
  "GET /api/account/social",
  "POST /api/account/social",
  "GET /api/account/social/search",
  "GET /api/account/content/posts",
  "POST /api/account/content/posts",
  "POST /api/account/content/posts/delete",
  "GET /api/account/content/comments",
  "POST /api/account/content/comments",
  "POST /api/account/content/comments/delete",
  "POST /api/account/content/preferences",
]);
export async function proxyAccount(request: Request) {
  const requestUrl = new URL(request.url);
  const path = requestUrl.pathname;
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (
    !paths.has(request.method + " " + path) &&
    !(
      request.method === "GET" &&
      (/^\/api\/account\/playback\/[a-f0-9-]{36}$/.test(path) ||
        /^\/api\/anime\/[a-z0-9-]{1,160}\/characters$/.test(path) ||
        /^\/api\/characters\/[a-z0-9-]{1,160}$/.test(path) ||
        /^\/api\/account\/social\/[a-f0-9-]{36}$/.test(path) ||
        /^\/api\/account\/content\/posts\/[a-f0-9-]{36}$/.test(path) ||
        /^\/api\/account\/profiles\/[^/]+(?:\/friends)?$/.test(path))
    )
  )
    return Response.json({ message: "Not found" }, { status: 404, headers });
  const siteUrl = process.env.SITE_URL ?? "http://localhost:8021";
  if (
    request.method === "POST" &&
    (!isTrustedRequestOrigin(request.headers.get("origin"), siteUrl) ||
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
      new URL(path + requestUrl.search, process.env.API_URL ?? "http://127.0.0.1:8020"),
      {
        method: request.method,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          Origin: request.headers.get("origin") ?? "",
          "X-AnimeSoul-Request": request.headers.get("x-animesoul-request") ?? "",
          "X-CSRF-Token": request.headers.get("x-csrf-token") ?? "",
          Cookie: request.headers.get("cookie") ?? "",
        },
        ...(body !== undefined ? { body } : {}),
      },
    );
    const result = new Response(await response.text(), {
      status: response.status,
      headers: { ...headers, "Content-Type": "application/json" },
    });
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) result.headers.set("Retry-After", retryAfter);
    for (const cookie of response.headers.getSetCookie())
      result.headers.append("Set-Cookie", cookie);
    return result;
  } catch (error) {
    await writeDiagnostic({ ...diagnosticError(error), source: "web", kind: "request", path });
    return Response.json({ message: "Account service unavailable" }, { status: 503, headers });
  }
}
