import "server-only";
import { isIP } from "node:net";
import { frameSearchLimits, isTrustedRequestOrigin } from "@animesoul/contracts";

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
// The API validates the session cookie itself, so forwarding it only enables the member's own quota.
// Retry-After travels back so the page can say how long to wait.
function relay(body: string, response: Response) {
  const result = new Response(body, {
    status: response.status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) result.headers.set("Retry-After", retryAfter);
  return result;
}
// Tells the API which visitor is asking so guests are counted per address instead of all sharing this
// server's. The headers are built here from scratch (never copied from the browser's request) and only
// when INTERNAL_PROXY_SECRET is set. The address is the last X-Forwarded-For entry, the one the ingress
// (Caddy) wrote itself; a single address with no port or zone, otherwise it is left out.
function visitorHeaders(request: Request): Record<string, string> {
  const secret = process.env.INTERNAL_PROXY_SECRET;
  if (!secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) return {};
  const ip = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (!ip || !isIP(ip)) return {};
  return { "X-AnimeSoul-Client-IP": ip, "X-AnimeSoul-Proxy-Secret": secret };
}
export async function proxyFrameQuota(request: Request) {
  try {
    const response = await fetch(
      new URL("/api/search/frame/quota", process.env.API_URL ?? "http://127.0.0.1:8020"),
      {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: { Cookie: request.headers.get("cookie") ?? "", ...visitorHeaders(request) },
      },
    );
    return relay(await response.text(), response);
  } catch {
    return Response.json(
      { message: "Остаток лимита временно недоступен." },
      { status: 503, headers },
    );
  }
}
export async function proxyFrameSearch(request: Request) {
  const origin = new URL(process.env.SITE_URL ?? "http://localhost:8021").origin;
  if (
    !isTrustedRequestOrigin(request.headers.get("origin"), origin) ||
    request.headers.get("x-animesoul-request") !== "1"
  )
    return Response.json({ message: "Запрос поиска отклонён." }, { status: 403, headers });
  if (request.headers.get("content-type") !== "application/octet-stream")
    return Response.json({ message: "Ожидается файл изображения." }, { status: 415, headers });
  const tooLarge = () =>
    Response.json({ message: "Размер кадра — не более 5 МБ." }, { status: 413, headers });
  if (Number(request.headers.get("content-length") ?? 0) > frameSearchLimits.bytes)
    return tooLarge();
  try {
    const reader = request.body?.getReader();
    if (!reader)
      return Response.json({ message: "Выберите изображение кадра." }, { status: 400, headers });
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > frameSearchLimits.bytes) {
        reader.releaseLock();
        return tooLarge();
      }
      chunks.push(chunk.value);
    }
    if (!length)
      return Response.json({ message: "Выберите изображение кадра." }, { status: 400, headers });
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const response = await fetch(
      new URL("/api/search/frame", process.env.API_URL ?? "http://127.0.0.1:8020"),
      {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(45000)]),
        headers: {
          "Content-Type": "application/octet-stream",
          Origin: origin,
          "X-AnimeSoul-Request": "1",
          Cookie: request.headers.get("cookie") ?? "",
          ...visitorHeaders(request),
        },
        body: bytes,
      },
    );
    return relay(await response.text(), response);
  } catch {
    return Response.json(
      { message: "Поиск по кадру не ответил вовремя. Попробуйте позже." },
      { status: 503, headers },
    );
  }
}
