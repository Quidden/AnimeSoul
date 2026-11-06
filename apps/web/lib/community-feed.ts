import type { ContentQuery } from "@animesoul/contracts";

export type CommunityFilters = {
  section: "posts" | "reviews" | "comments";
  sort: "new" | "discussed" | "top";
  tag?: string | undefined;
  q?: string | undefined;
  kind?: "text" | "episode" | "review" | undefined;
  animeId?: string | undefined;
};

export function communityFeedUrl(
  filters: CommunityFilters,
  cursor?: ContentQuery | null,
  pinned?: boolean,
) {
  const query = new URLSearchParams({ section: filters.section });
  if (filters.q) query.set("q", filters.q);
  if (filters.animeId) query.set("animeId", filters.animeId);
  if (filters.section === "comments") {
    if (filters.animeId) query.set("discussions", "all");
  } else {
    query.set("sort", filters.sort);
    if (filters.tag) query.set("tag", filters.tag);
    if (filters.kind) query.set("kind", filters.kind);
    if (pinned !== undefined) query.set("pinned", String(pinned));
  }
  if (cursor?.before && cursor.beforeId) {
    query.set("before", cursor.before);
    query.set("beforeId", cursor.beforeId);
    if (cursor.beforeActivity) query.set("beforeActivity", cursor.beforeActivity);
    if (cursor.beforeCount !== undefined) query.set("beforeCount", String(cursor.beforeCount));
  }
  return (
    "/api/account/content/" + (filters.section === "comments" ? "comments" : "posts") + "?" + query
  );
}

export function communityHref(filters: CommunityFilters) {
  const query = new URLSearchParams();
  if (filters.section !== "posts") query.set("tab", filters.section);
  if (filters.sort !== "new" && filters.section !== "comments") query.set("sort", filters.sort);
  if (filters.tag && filters.section !== "comments") query.set("tag", filters.tag);
  if (filters.kind && filters.section === "posts") query.set("kind", filters.kind);
  if (filters.q) query.set("q", filters.q);
  if (filters.animeId) query.set("animeId", filters.animeId);
  const text = query.toString();
  return "/community" + (text ? "?" + text : "");
}
