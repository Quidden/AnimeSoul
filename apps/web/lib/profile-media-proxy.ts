import "server-only";
import {
  isTrustedRequestOrigin,
  profileMediaLimits,
  profileMediaTypes,
  uploadedProfileMediaPattern,
} from "@animesoul/contracts";

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
export async function proxyProfileMediaUpload(request: Request) {
  const url = new URL(request.url);
  const kind = /^\/api\/account\/profile\/media\/(avatar|banner)$/.exec(url.pathname)?.[1];
  if (!kind || request.method !== "POST")
    return Response.json({ message: "Not found" }, { status: 404, headers });
  const origin = new URL(process.env.SITE_URL ?? "http://localhost:8021").origin;
  if (
    !isTrustedRequestOrigin(request.headers.get("origin"), origin) ||
    request.headers.get("x-animesoul-request") !== "1"
  )
    return Response.json({ message: "Forbidden" }, { status: 403, headers });
  if (!/(?:^|;\s*)animesoul_web_session=[\w-]{43}(?:;|$)/.test(request.headers.get("cookie") ?? ""))
    return Response.json({ message: "Unauthorized" }, { status: 401, headers });
  if (request.headers.get("content-type") !== "application/octet-stream")
    return Response.json({ message: "Ожидается файл изображения." }, { status: 415, headers });
  const limit = profileMediaLimits[kind as "avatar" | "banner"];
  const tooLarge = () =>
    Response.json(
      { message: `Максимальный размер файла — ${limit / 1024 / 1024} МБ.` },
      { status: 413, headers },
    );
  if (Number(request.headers.get("content-length") ?? 0) > limit) return tooLarge();
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ message: "Выберите файл." }, { status: 400, headers });
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return tooLarge();
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const response = await fetch(
      new URL(url.pathname, process.env.API_URL ?? "http://127.0.0.1:8020"),
      {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          "Content-Type": "application/octet-stream",
          Origin: origin,
          "X-AnimeSoul-Request": "1",
          "X-CSRF-Token": request.headers.get("x-csrf-token") ?? "",
          Cookie: request.headers.get("cookie") ?? "",
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
      { message: "Сервис изображений временно недоступен. Повторите загрузку." },
      { status: 503, headers },
    );
  }
}
export async function proxyProfileMedia(request: Request) {
  const path = new URL(request.url).pathname;
  const imageHeaders = { ...headers, Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
  if (!uploadedProfileMediaPattern.test(path))
    return new Response(null, { status: 404, headers: imageHeaders });
  try {
    const response = await fetch(new URL(path, process.env.API_URL ?? "http://127.0.0.1:8020"), {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { Cookie: request.headers.get("cookie") ?? "" },
    });
    if (!response.ok) return new Response(null, { status: response.status, headers: imageHeaders });
    const type = response.headers.get("content-type");
    if (!profileMediaTypes.some((value) => value === type))
      throw new Error("Invalid image response.");
    return new Response(response.body, {
      headers: { ...imageHeaders, "Content-Type": type!, "Content-Disposition": "inline" },
    });
  } catch {
    return new Response(null, { status: 503, headers: imageHeaders });
  }
}
