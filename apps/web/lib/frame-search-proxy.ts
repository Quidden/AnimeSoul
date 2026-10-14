import "server-only";
import { frameSearchLimits, isTrustedRequestOrigin } from "@animesoul/contracts";

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
export async function proxyFrameQuota() {
  try {
    const response = await fetch(
      new URL("/api/search/frame/quota", process.env.API_URL ?? "http://127.0.0.1:8020"),
      { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) },
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: { ...headers, "Content-Type": "application/json" },
    });
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
        },
        body: bytes,
      },
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch {
    return Response.json(
      { message: "Поиск по кадру не ответил вовремя. Попробуйте позже." },
      { status: 503, headers },
    );
  }
}
