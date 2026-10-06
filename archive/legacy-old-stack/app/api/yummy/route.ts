import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const API = "https://api.yani.tv";

function normalize<T>(value: T): T {
  if (typeof value === "string" && value.startsWith("//")) return `https:${value}` as T;
  if (Array.isArray(value)) return value.map(normalize) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)])) as T;
  }
  return value;
}

export async function GET(request: Request) {
  const token = process.env.YUMMYANIME_TOKEN;
  if (!token) return NextResponse.json({ error: "Токен YummyAnime не настроен" }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const mode = params.get("mode") ?? "catalog";
  const headers = { "X-Application": token, Lang: "ru", Accept: "application/json" };

  try {
    if (mode === "ping") {
      const startedAt = performance.now();
      const upstream = new URL(`${API}/anime`);
      upstream.searchParams.set("limit", "1");
      upstream.searchParams.set("offset", "0");
      const response = await fetch(upstream, { headers, cache: "no-store" });
      if (!response.ok) throw new Error("ping");
      await response.arrayBuffer();
      return NextResponse.json({ ok: true, upstreamMs: Math.round(performance.now() - startedAt) });
    }

    if (mode === "details") {
      const ids = (params.get("ids") ?? "").split(",").filter(Boolean).slice(0, 50);
      const results = await Promise.all(ids.map(async (id) => {
        const response = await fetch(`${API}/anime/${encodeURIComponent(id)}`, { headers, cache: "no-store" });
        if (!response.ok) return null;
        const payload = await response.json() as { response?: unknown };
        return payload.response ?? null;
      }));
      return NextResponse.json(normalize({ anime: results.filter(Boolean) }));
    }

    if (mode === "videos") {
      const id = params.get("id");
      if (!id) return NextResponse.json({ error: "Не указан ID аниме" }, { status: 400 });
      const [detailResponse, videosResponse] = await Promise.all([
        fetch(`${API}/anime/${encodeURIComponent(id)}`, { headers, cache: "no-store" }),
        fetch(`${API}/anime/${encodeURIComponent(id)}/videos`, { headers, cache: "no-store" }),
      ]);
      if (!videosResponse.ok) throw new Error("videos");
      const videosPayload = await videosResponse.json() as { response?: unknown[] };
      const detailPayload = detailResponse.ok ? await detailResponse.json() as { response?: unknown } : {};
      return NextResponse.json(normalize({ anime: detailPayload.response, videos: videosPayload.response ?? [] }));
    }

    if (mode === "schedule") {
      const response = await fetch(`${API}/anime/schedule`, { headers, cache: "no-store" });
      if (!response.ok) throw new Error("schedule");
      const payload = await response.json() as { response?: unknown[] };
      return NextResponse.json(normalize({ schedule: payload.response ?? [] }));
    }

    const limit = Math.min(Math.max(Number(params.get("limit")) || 24, 1), 48);
    const offset = Math.max(Number(params.get("offset")) || 0, 0);
    const query = params.get("q")?.trim();
    const upstream = new URL(`${API}/anime`);
    upstream.searchParams.set("limit", String(limit));
    upstream.searchParams.set("offset", String(offset));
    if (query) upstream.searchParams.set("q", query);
    const response = await fetch(upstream, { headers, cache: "no-store" });
    if (!response.ok) throw new Error("catalog");
    const payload = await response.json() as { response?: unknown[] };
    return NextResponse.json(normalize({ anime: payload.response ?? [], hasMore: (payload.response?.length ?? 0) === limit }));
  } catch {
    return NextResponse.json({ error: "YummyAnime API временно недоступен" }, { status: 502 });
  }
}
