import { playbackRevisionSchema } from "@animesoul/contracts";
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const response = await fetch(
      new URL("/api/playback/revision", process.env.API_URL ?? "http://127.0.0.1:8020"),
      { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) throw new Error();
    return Response.json(playbackRevisionSchema.parse(await response.json()), { headers });
  } catch {
    return Response.json({ message: "Playback service unavailable" }, { status: 503, headers });
  }
}
