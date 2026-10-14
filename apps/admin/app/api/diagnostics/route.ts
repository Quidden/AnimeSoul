import { readDiagnostics } from "@animesoul/diagnostics";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  try {
    // The admin root endpoint enforces a current owner/admin session and MFA.
    const access = await fetch(
      new URL("/api/admin", process.env.API_URL ?? "http://127.0.0.1:8020"),
      {
        headers: { Cookie: request.headers.get("cookie") ?? "" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!access.ok) return new Response(null, { status: access.status, headers });
    const identity: unknown = await access.json();
    if (
      !identity ||
      typeof identity !== "object" ||
      !("authenticated" in identity) ||
      identity.authenticated !== true ||
      !("mfaVerified" in identity) ||
      identity.mfaVerified !== true ||
      !("roles" in identity) ||
      !Array.isArray(identity.roles) ||
      !identity.roles.some((role) => ["owner", "admin"].includes(role))
    )
      return new Response(null, { status: 403, headers });
    const params = new URL(request.url).searchParams;
    return Response.json(
      await readDiagnostics({
        userId: params.get("userId") ?? "",
        source: params.get("source") ?? "",
        query: params.get("q") ?? "",
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
        page: Number(params.get("page") ?? 1),
        pageSize: 25,
      }),
      { headers },
    );
  } catch {
    return Response.json({ message: "Diagnostics unavailable" }, { status: 503, headers });
  }
}
