import { getStream } from "../../../../../lib/api";
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params,
    source = new URL(request.url).searchParams.get("source") ?? "";
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (!/^[a-z0-9-]{1,160}$/.test(slug) || !/^[a-f0-9]{24}$/.test(source))
    return Response.json({ message: "Invalid selection" }, { status: 400, headers });
  try {
    return Response.json((await getStream(slug, source)) ?? { mode: "embed" }, { headers });
  } catch {
    return Response.json({ mode: "embed" }, { headers });
  }
}
