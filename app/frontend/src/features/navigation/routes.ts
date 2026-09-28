import type { ApplicationView } from "../catalog/useCatalogController";

const viewPaths: Record<ApplicationView, string> = {
    home: "/",
    catalog: "/catalog",
    downloads: "/downloads",
    stats: "/statistics",
    ratings: "/ratings",
    tracking: "/tracking",
    library: "/library",
    history: "/history",
    remote: "/remote",
    notFound: "/404",
};

export function routeFromLocation(pathname = window.location.pathname): ApplicationView | "anime" | "animeMap" {
    if (/^\/anime\/\d+\/map\/?$/.test(pathname)) return "animeMap";
    if (/^\/anime\/\d+\/?$/.test(pathname)) return "anime";
    if (/^\/library\/[^/]+\/?$/.test(pathname)) return "library";
    const normalized = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
    return (Object.entries(viewPaths).find(([, path]) => path === normalized)?.[0] as ApplicationView | undefined)
        ?? "notFound";
}

export function animeMapRoute(animeId: number): string {
    return `/anime/${animeId}/map`;
}

export function routeForView(view: ApplicationView): string {
    return viewPaths[view];
}

export function navigateTo(url: string, replace = false): void {
    if (window.location.pathname + window.location.search === url) return;
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    window.dispatchEvent(new Event("animesoul:navigation"));
}

export function animeRoute(animeId: number, season?: number, episode?: string, scroll = false, originAnimeId?: number): string {
    const params = new URLSearchParams();
    if (season !== undefined) params.set("season", String(season));
    if (episode) params.set("episode", episode);
    if (scroll) params.set("play", "1");
    if (originAnimeId) params.set("origin", String(originAnimeId));
    const search = params.toString();
    return `/anime/${animeId}${search ? `?${search}` : ""}`;
}
