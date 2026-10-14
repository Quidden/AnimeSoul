"use client";
import type { AnalyticsInput } from "@animesoul/contracts";
let memoryVisitor = "",
  memoryVisit = "",
  lastSeen = 0,
  lastPageKey = "",
  lastLaunchKey = "";
function identity() {
  const now = Date.now();
  let visitor = memoryVisitor || (memoryVisitor = crypto.randomUUID()),
    visit = memoryVisit && now - lastSeen < 30 * 60000 ? memoryVisit : crypto.randomUUID();
  try {
    visitor = localStorage.getItem("animesoul:analytics:visitor") || visitor;
    localStorage.setItem("animesoul:analytics:visitor", visitor);
    const stored = JSON.parse(sessionStorage.getItem("animesoul:analytics:visit") || "null") as {
      id: string;
      time: number;
    } | null;
    if (stored && now - stored.time < 30 * 60000) visit = stored.id;
    sessionStorage.setItem("animesoul:analytics:visit", JSON.stringify({ id: visit, time: now }));
  } catch {
    /* Storage or telemetry failure must not block the interface. */
  }
  memoryVisitor = visitor;
  memoryVisit = visit;
  lastSeen = now;
  return { visitorId: visitor, visitId: visit };
}
function send(input: AnalyticsInput, attempt = 0) {
  void fetch("/api/experience/event", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-AnimeSoul-Request": "1" },
    body: JSON.stringify(input),
    keepalive: true,
  })
    .then((response) => {
      if (response.status >= 500 && attempt < 2)
        setTimeout(() => send(input, attempt + 1), 1500 * (attempt + 1));
    })
    .catch(() => {
      if (attempt < 2) setTimeout(() => send(input, attempt + 1), 1500 * (attempt + 1));
    });
}
export function trackFeature(feature: "search.text" | "search.frame" | "media.giphy") {
  try {
    send({ id: crypto.randomUUID(), ...identity(), kind: "feature", feature });
  } catch {
    /* Storage or telemetry failure must not block the interface. */
  }
}
export function trackPage(pathname: string) {
  try {
    const path =
      pathname === "/"
        ? "/"
        : ((
            [
              "/catalog",
              "/anime",
              "/episode",
              "/users",
              "/account",
              "/search",
              "/subscription",
              "/posts",
            ] as const
          ).find((p) => pathname === p || pathname.startsWith(p + "/")) ?? "/other");
    const identities = identity();
    const key = identities.visitId + ":" + pathname;
    let stored = lastPageKey;
    try {
      stored = sessionStorage.getItem("animesoul:analytics:page") ?? stored;
    } catch {
      /* Memory fallback for private browsing. */
    }
    if (stored === key) return;
    lastPageKey = key;
    try {
      sessionStorage.setItem("animesoul:analytics:page", key);
    } catch {
      /* Memory fallback. */
    }
    send({ id: crypto.randomUUID(), ...identities, kind: "page_view", path });
  } catch {
    /* Storage or telemetry failure must not block the interface. */
  }
}
export function trackPlayerStart(data: {
  animeId: string;
  episodeId?: string;
  season: string;
  player: "native" | "kodik" | "yummy";
  episode: string;
}) {
  try {
    const identities = identity(),
      key = [
        identities.visitId,
        data.animeId,
        data.episodeId ?? data.season + ":" + data.episode,
      ].join(":");
    let old: {
      key: string;
      id: string;
    } | null = null;
    try {
      old = JSON.parse(sessionStorage.getItem("animesoul:analytics:launch") || "null");
    } catch {
      /* Memory fallback. */
    }
    if (old?.key === key || lastLaunchKey === key) return;
    const id = crypto.randomUUID();
    lastLaunchKey = key;
    try {
      sessionStorage.setItem("animesoul:analytics:launch", JSON.stringify({ key, id }));
    } catch {
      /* Memory fallback. */
    }
    send({
      id,
      ...identities,
      kind: "player_start",
      animeId: data.animeId,
      ...(data.episodeId ? { episodeId: data.episodeId } : {}),
      season: data.season,
      episode: data.episode,
      player: data.player,
    });
  } catch {
    /* Storage or telemetry failure must not block the interface. */
  }
}
