import { cookies } from "next/headers";
import type { Anime } from "@animesoul/contracts";
import { getCatalog } from "../lib/api";
import { HomeLibrary } from "../components/HomeLibrary";
import { HomePopular } from "../components/HomePopular";
import { reportServerError } from "../lib/diagnostics-server";
export const dynamic = "force-dynamic";
export default async function HomePage() {
  let items: Anime[] | null = null;
  try {
    items = (await getCatalog("", { sort: "popular", pageSize: 18 })).items;
  } catch (error) {
    await reportServerError(error, "/", "request", (await cookies()).toString());
  }
  return (
    <HomeLibrary featured={items?.[0]}>
      <HomePopular initialItems={items} />
    </HomeLibrary>
  );
}
