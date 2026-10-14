import "server-only";
import { cookies } from "next/headers";
import { publicProfileSchema, usernameSchema } from "@animesoul/contracts";
import { getProfile } from "./api";
export function profileRouteUsername(value: string) {
  try {
    const name = decodeURIComponent(value);
    return usernameSchema.safeParse(name).success ? name : null;
  } catch {
    return null;
  }
}
export async function hasProfileSession() {
  return /^[\w-]{43}$/.test((await cookies()).get("animesoul_web_session")?.value ?? "");
}
export async function getViewerProfile(username: string) {
  const token = (await cookies()).get("animesoul_web_session")?.value;
  if (!token || !/^[\w-]{43}$/.test(token)) return getProfile(username);
  const response = await fetch(
    new URL(
      "/api/account/profiles/" + encodeURIComponent(username),
      process.env.API_URL ?? "http://127.0.0.1:8020",
    ),
    {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { Cookie: "animesoul_web_session=" + token },
    },
  );
  if (response.status === 401) return getProfile(username);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Profile service unavailable.");
  return publicProfileSchema.parse(await response.json());
}
