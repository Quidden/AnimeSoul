import { getEpisodes } from "../../../../../lib/api";
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,160}$/.test(slug))
    return Response.json({ message: "Not found" }, { status: 404 });
  try {
    const result = await getEpisodes(slug);
    return Response.json(result ?? { episodes: [] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ message: "Episode service unavailable" }, { status: 503 });
  }
}
