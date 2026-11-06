import { isTrustedRequestOrigin } from "@animesoul/contracts";
const allowed =
  /^(?:GET \/api\/experience(?:\/inbox)?|POST \/api\/experience\/(?:event|inbox\/[0-9a-f-]{36}))$/i;
async function proxy(request: Request) {
  const url = new URL(request.url),
    headers = { "Cache-Control": "private, no-store" };
  if (!allowed.test(request.method + " " + url.pathname))
    return Response.json({ message: "Not found" }, { status: 404, headers });
  if (
    request.method === "POST" &&
    (!isTrustedRequestOrigin(
      request.headers.get("origin"),
      process.env.SITE_URL ?? "http://localhost:8021",
    ) ||
      request.headers.get("x-animesoul-request") !== "1")
  )
    return Response.json({ message: "Forbidden" }, { status: 403, headers });
  try {
    let body: string | undefined;
    if (request.method === "POST") {
      const reader = request.body?.getReader();
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      if (reader)
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.length;
          if (bytes > 8192) {
            await reader.cancel();
            return Response.json({ message: "Too large" }, { status: 413, headers });
          }
          chunks.push(chunk.value);
        }
      body = new TextDecoder().decode(Uint8Array.from(chunks.flatMap((c) => Array.from(c))));
    }
    const cookie = (request.headers.get("cookie") ?? "")
      .split(";")
      .filter((c) => c.trim().startsWith("animesoul_web_session="))
      .join(";");
    const response = await fetch(
      new URL(url.pathname + url.search, process.env.API_URL ?? "http://127.0.0.1:8020"),
      {
        method: request.method,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: request.headers.get("origin") ?? "",
          "X-AnimeSoul-Request": request.headers.get("x-animesoul-request") ?? "",
          "X-CSRF-Token": request.headers.get("x-csrf-token") ?? "",
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
    return result;
  } catch {
    return Response.json({ message: "Service unavailable" }, { status: 503, headers });
  }
}
export const GET = proxy;
export const POST = proxy;
