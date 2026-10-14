import { getViewerProfile, profileRouteUsername } from "../../../../lib/profile-viewer";

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const username = profileRouteUsername((await params).username);
  if (!username) return Response.json({ error: "Profile not found" }, { status: 404, headers });
  try {
    const profile = await getViewerProfile(username);
    return profile
      ? Response.json(profile, { headers })
      : Response.json({ error: "Profile not found" }, { status: 404, headers });
  } catch {
    return Response.json({ error: "Profile unavailable" }, { status: 503, headers });
  }
}
