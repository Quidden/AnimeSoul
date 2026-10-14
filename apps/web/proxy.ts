import { NextResponse, type NextRequest } from "next/server";
import { maintenanceSettingsSchema } from "@animesoul/contracts";
import { maintenanceHtml } from "./lib/maintenance";
import { writeDiagnostic } from "@animesoul/diagnostics";
import { diagnosticError } from "@animesoul/diagnostics/sanitize";

export async function proxy(request: NextRequest) {
  try {
    const response = await fetch(
      new URL("/api/availability", process.env.API_URL ?? "http://127.0.0.1:8020"),
      { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000) },
    );
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      const retryAfter = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60;
      const settings = {
        title: "Слишком много запросов",
        body: `Попробуйте снова через ${retryAfter} сек.`,
        endsAt: null,
      };
      const headers = {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfter),
        "X-Robots-Tag": "noindex, nofollow",
      };
      if (request.nextUrl.pathname.startsWith("/api/"))
        return NextResponse.json({ message: settings.title }, { status: 429, headers });
      return new NextResponse(
        maintenanceHtml(settings, request.nextUrl.pathname + request.nextUrl.search),
        { status: 429, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } },
      );
    }
    if (!response.ok) throw new Error("Availability unavailable");
    const state: unknown = await response.json();
    if (
      !state ||
      typeof state !== "object" ||
      !("active" in state) ||
      typeof state.active !== "boolean"
    )
      throw new Error("Invalid availability");
    if (!state.active) return NextResponse.next();
    const data = state as { active: boolean; title: string; body: string; endsAt: string | null };
    const settings = maintenanceSettingsSchema.parse({
      enabled: true,
      title: data.title,
      body: data.body,
      endsAt: data.endsAt,
    });
    const headers = {
      "Cache-Control": "no-store",
      "Retry-After": "60",
      "X-Robots-Tag": "noindex, nofollow",
    };
    if (request.nextUrl.pathname.startsWith("/api/"))
      return NextResponse.json(
        { message: settings.title, maintenance: true },
        { status: 503, headers },
      );
    return new NextResponse(
      maintenanceHtml(settings, request.nextUrl.pathname + request.nextUrl.search),
      { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (error) {
    await writeDiagnostic({
      ...diagnosticError(error),
      source: "web",
      kind: "request",
      path: request.nextUrl.pathname,
    });
    if (request.nextUrl.pathname.startsWith("/api/"))
      return NextResponse.json(
        { message: "Сервис временно недоступен" },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    return new NextResponse(
      maintenanceHtml(
        {
          title: "AnimeSoul временно недоступен",
          body: "Попробуйте открыть страницу немного позже.",
          endsAt: null,
        },
        request.nextUrl.pathname,
      ),
      {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": "60",
          "X-Robots-Tag": "noindex, nofollow",
        },
      },
    );
  }
}
export const config = {
  matcher: [
    "/((?!api/health(?:/|$)|_next/|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|gif|svg|ico|woff2?|webm|mp4|css|js)$).*)",
  ],
};
