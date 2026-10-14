/** OAuth returns through the public origin so host-only cookies reach the right browser. */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const result = new URL("/account", process.env.SITE_URL ?? "http://localhost:8021");
  let upstream: Response | undefined;
  try {
    const state = query.get("state") ?? "",
      code = query.get("code") ?? "";
    if (query.has("error") || !/^[\w-]{43}$/.test(state) || !code || code.length > 4096) {
      result.searchParams.set("oauth", "cancelled");
    } else {
      const target = new URL(
        "/api/auth/google/callback",
        process.env.API_URL ?? "http://127.0.0.1:8020",
      );
      target.search = new URLSearchParams({ state, code }).toString();
      upstream = await fetch(target, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: { Cookie: request.headers.get("cookie") ?? "" },
      });
      result.searchParams.set("oauth", upstream.ok ? "done" : "error-" + upstream.status);
    }
  } catch {
    result.searchParams.set("oauth", "unavailable");
  }
  const response = new Response(null, {
    status: 303,
    headers: {
      Location: result.href,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
  for (const cookie of upstream?.headers.getSetCookie() ?? [])
    response.headers.append("Set-Cookie", cookie);
  if (!upstream?.ok)
    response.headers.append(
      "Set-Cookie",
      "animesoul_oauth=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0" +
        (process.env.NODE_ENV === "production" && new URL(result).protocol === "https:"
          ? "; Secure"
          : ""),
    );
  return response;
}
