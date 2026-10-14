import { catalogIdsSchema } from "@animesoul/contracts";
import { getCatalogByIds } from "../../../../lib/api";
export async function GET(request: Request) {
  const parsed = catalogIdsSchema.safeParse(new URL(request.url).searchParams.get("ids") ?? "");
  if (!parsed.success) return Response.json({ message: "Invalid identities" }, { status: 400 });
  try {
    return Response.json(await getCatalogByIds(parsed.data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ message: "Catalog unavailable" }, { status: 503 });
  }
}
