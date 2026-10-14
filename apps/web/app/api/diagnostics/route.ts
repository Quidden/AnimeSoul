import { writeDiagnostic } from "@animesoul/diagnostics";
import { isTrustedRequestOrigin } from "@animesoul/contracts";
import { normalizeDiagnostic } from "@animesoul/diagnostics/sanitize";
import { diagnosticUser } from "../../../lib/diagnostics-server";

export const runtime = "nodejs";
let started = 0;
let accepted = 0;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const origin = new URL(process.env.SITE_URL ?? "http://localhost:8021").origin;
  if (
    !isTrustedRequestOrigin(request.headers.get("origin"), origin) ||
    request.headers.get("x-animesoul-request") !== "1"
  )
    return new Response(null, { status: 403, headers });
  if (Date.now() - started > 60000) {
    started = Date.now();
    accepted = 0;
  }
  if (accepted++ >= 120) return new Response(null, { status: 429, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return new Response(null, { status: 415, headers });
  if (Number(request.headers.get("content-length") ?? 0) > 16384)
    return new Response(null, { status: 413, headers });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400, headers });
  let size = 0;
  let body = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        return new Response(null, { status: 413, headers });
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const input: unknown = JSON.parse(body);
    if (
      !input ||
      typeof input !== "object" ||
      !("message" in input) ||
      typeof input.message !== "string" ||
      !input.message.trim()
    )
      return new Response(null, { status: 400, headers });
    const event = normalizeDiagnostic(input);
    await writeDiagnostic({
      ...event,
      source: "browser",
      userId: await diagnosticUser(request.headers.get("cookie") ?? ""),
    });
    return new Response(null, { status: 204, headers });
  } catch {
    return new Response(null, { status: 400, headers });
  }
}
