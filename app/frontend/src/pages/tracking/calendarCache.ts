import type { Tracker } from "../../lib/types";
import { readDataCache, writeDataCache } from "../../lib/localDataCache";

export type CalendarEvent = { animeId: number; originId: number; episode: string; title: string; date: number; pending: boolean; future?: boolean };
const namespace = "animesoul:tracking-calendar:v1";

function trackerKey(tracker: Tracker) {
  return JSON.stringify([tracker.animeId, [...(tracker.animeIds ?? [])].sort((a, b) => a - b), [...(tracker.dubs ?? [])].sort()]);
}

export function cachedCalendarEvents(tracker: Tracker): CalendarEvent[] {
  const value = readDataCache(namespace, trackerKey(tracker));
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CalendarEvent => item && item.animeId === tracker.animeId
    && Number.isSafeInteger(item.originId) && item.originId > 0 && typeof item.episode === "string"
    && typeof item.title === "string" && Number.isFinite(item.date) && item.date > 0
    && (item.future === undefined || typeof item.future === "boolean"))
    .filter(item => !item.future || item.date > Date.now())
    .map(item => ({ ...item, title: tracker.title, pending: false }));
}

/** Keep history during partial outages; a successful schedule refresh replaces predictions. */
export function mergeCalendarEvents(cached: CalendarEvent[], fresh: CalendarEvent[], replaceFuture: boolean): CalendarEvent[] {
  const result = new Map<string, CalendarEvent>();
  for (const item of cached) {
    if (item.future && (replaceFuture || item.date <= Date.now())) continue;
    result.set(`${item.originId}:${item.episode}`, item);
  }
  for (const item of fresh) {
    if (!Number.isFinite(item.date) || item.date <= 0) continue;
    const key = `${item.originId}:${item.episode}`;
    if (item.future && result.has(key) && !result.get(key)?.future) continue;
    result.set(key, item);
  }
  return [...result.values()];
}

export function cacheCalendarEvents(tracker: Tracker, events: CalendarEvent[]) {
  writeDataCache(namespace, trackerKey(tracker), events, 100);
}
