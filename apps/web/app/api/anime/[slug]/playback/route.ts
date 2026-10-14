import { getPlayback } from "../../../../../lib/api";
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,160}$/.test(slug))
    return Response.json({ message: "Not found" }, { status: 404 });
  const provider = new URL(request.url).searchParams.get("provider") ?? "auto";
  if (provider !== "auto")
    return Response.json({ message: "Invalid playback provider" }, { status: 400 });
  try {
    const playback = await getPlayback(slug);
    return Response.json(playback ?? { message: "Not found" }, {
      status: playback ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { message: "Playback service unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
