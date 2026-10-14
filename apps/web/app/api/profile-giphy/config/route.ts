export const dynamic = "force-dynamic";

// GIPHY's web API key identifies the browser integration; it is intentionally public.
// Keep it out of static bundles so deployments can rotate it without rebuilding.
export function GET() {
  const apiKey = process.env.GIPHY_API_KEY || process.env.ANIMESOUL_GIPHY_API_KEY || "";
  return Response.json(
    { apiKey },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
