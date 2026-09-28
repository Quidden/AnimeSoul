import "./tracking-calendar.css";
import { monthDays, dateKey } from "./calendarDates";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tracker } from "../../lib/types";
import { fetchTrackingSnapshot } from "../../features/tracking/api";
import { navigateTo } from "../../features/navigation/routes";
import { fetchAnimeDetails } from "../../features/catalog/api";
import { animeMyAnimeListId, fetchEpisodeAirDates, type EpisodeAirDates } from "../../lib/episodeDates";
import { trackUiAction } from "../../lib/uiAnalytics";
import { cachedCalendarEvents, cacheCalendarEvents, mergeCalendarEvents, type CalendarEvent } from "./calendarCache";

function monthFromUrl(): Date {
  const value = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("month");
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    const date = new Date(`${value}-01T12:00:00`);
    if (Number.isFinite(date.getTime())) return date;
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function moveMonth(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

export function TrackingCalendar({ tracked, onOpen }: { tracked: Tracker[]; onOpen: (animeId: number, originId: number, episode: string) => void }) {
  const [month, setMonth] = useState(monthFromUrl);
  const [monthMotion, setMonthMotion] = useState<{ from: Date; to: string; direction: "next" | "previous" } | null>(null);
  const motionLocked = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const wheelGesture = useRef({ delta: 0, last: 0, switched: false });
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>(() => tracked.flatMap(cachedCalendarEvents));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [partial, setPartial] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const sync = () => setMonth(monthFromUrl());
    window.addEventListener("popstate", sync);
    window.addEventListener("animesoul:navigation", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("animesoul:navigation", sync);
    };
  }, []);
  const requestKey = JSON.stringify(tracked.map(item => ({
    animeId: item.animeId, title: item.title, animeIds: [...(item.animeIds ?? [])].sort((a, b) => a - b),
    dubs: [...(item.dubs ?? [])].sort(), knownEpisodes: item.knownEpisodes,
    knownEpisodeKeys: [...(item.knownEpisodeKeys ?? [])].sort(),
  })).sort((a, b) => a.animeId - b.animeId));
  useEffect(() => {
    let cancelled = false;
    const requested = JSON.parse(requestKey) as Tracker[];
    if (!requested.length) { setEvents([]); setLoading(false); setError(false); setPartial(false); return; }
    setEvents(requested.flatMap(cachedCalendarEvents));
    setLoading(true);
    setError(false);
    setPartial(false);
    void Promise.allSettled(requested.map(async tracker => {
      const snapshot = await fetchTrackingSnapshot(tracker, () => cancelled);
      if (!snapshot || snapshot.successfulRequests === 0) throw new Error("tracking unavailable");
      const details = await fetchAnimeDetails(snapshot.animeIds).catch(() => []);
      const airDates = new Map<number, EpisodeAirDates>(await Promise.all(details.map(async anime => {
        const malId = animeMyAnimeListId(anime);
        return [anime.anime_id, malId ? await fetchEpisodeAirDates(malId) : {}] as const;
      })));
      const pending = new Set(tracker.pendingEpisodeKeys ?? []);
      return [...snapshot.episodeDates.keys()].map(key => ({
        animeId: tracker.animeId,
        originId: Number(key.split(":")[0]),
        episode: key.split(":").at(-1) ?? "1",
        title: tracker.title,
        date: (() => {
          const [animeId, episode] = key.split(":");
          const value = airDates.get(Number(animeId))?.[episode];
          return value ? new Date(`${value}T12:00:00`).getTime() : 0;
        })(),
        pending: pending.has(key),
      }));
    })).then(async results => {
      const available = results.filter((result): result is PromiseFulfilledResult<CalendarEvent[]> => result.status === "fulfilled");
      if (!available.length) throw new Error("tracking unavailable");
      const schedule = await fetch("/api/yummy?mode=schedule")
        .then(response => response.ok ? response.json() : null)
        .catch(() => null) as {schedule?: {anime_id: number; episodes?: {aired?: number; next_date?: number}}[]} | null;
      const scheduleAvailable = Array.isArray(schedule?.schedule);
      const upcoming = (schedule?.schedule ?? []).flatMap(row => {
        const tracker = requested.find(item => item.animeId === row.anime_id || item.animeIds?.includes(row.anime_id));
        const date = (row.episodes?.next_date ?? 0) * 1000;
        return tracker && date > Date.now() ? [{animeId: tracker.animeId, originId: row.anime_id, episode: String((row.episodes?.aired ?? 0) + 1), title: tracker.title, date, pending: false, future: true}] : [];
      });
      if (!cancelled) {
        const updated = requested.flatMap((tracker, index) => {
          const result = results[index];
          const fresh = [...(result.status === "fulfilled" ? result.value : []), ...upcoming.filter(item => item.animeId === tracker.animeId)];
          const merged = mergeCalendarEvents(cachedCalendarEvents(tracker), fresh, scheduleAvailable);
          cacheCalendarEvents(tracker, merged);
          return merged;
        });
        setEvents(updated);
        setPartial(available.length < results.length || !scheduleAvailable);
      }
    }).catch(() => {
      if (!cancelled) setError(true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [requestKey, retry]);

  const dated = useMemo(() => events.filter(item => Number.isFinite(item.date) && item.date > 0)
    .filter(item => tracked.some(tracker => tracker.animeId === item.animeId))
    .map(item => ({ ...item, pending: tracked.find(tracker => tracker.animeId === item.animeId)?.pendingEpisodeKeys?.includes(`${item.originId}:${item.episode}`) ?? false })), [events, tracked]);
  const byDay = useMemo(() => {
    const result = new Map<string, CalendarEvent[]>();
    for (const event of dated) {
      const key = dateKey(new Date(event.date));
      const items = result.get(key) ?? [];
      if (!items.some(item => item.animeId === event.animeId && item.originId === event.originId && item.episode === event.episode)) items.push(event);
      result.set(key, items);
    }
    return result;
  }, [dated]);
  const chooseMonth = useCallback((offset: number) => {
    if (motionLocked.current) return;
    const next = moveMonth(month, offset);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    motionLocked.current = !reducedMotion;
    setMonthMotion(reducedMotion ? null : { from: month, to: monthKey(next), direction: offset > 0 ? "next" : "previous" });
    setMonth(next);
    navigateTo(`/tracking?month=${monthKey(next)}`);
  }, [month]);
  useEffect(() => {
    if (!monthMotion) return;
    const timer = window.setTimeout(() => {
      setMonthMotion(null);
      motionLocked.current = false;
    }, 460);
    return () => window.clearTimeout(timer);
  }, [monthMotion]);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const now = performance.now();
      const gesture = wheelGesture.current;
      if (now - gesture.last > 180) { gesture.delta = 0; gesture.switched = false; }
      gesture.last = now;
      if (gesture.switched) return;
      gesture.delta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      if (Math.abs(gesture.delta) < 50) return;
      gesture.switched = true;
      chooseMonth(gesture.delta > 0 ? 1 : -1);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [chooseMonth]);
  const monthLabel = (date: Date) => date.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const today = dateKey(new Date());
  const monthGrid = (date: Date) => <div className="tracking-month-grid">
    {monthDays(date).map(day => {
      const key = dateKey(day);
      const items = byDay.get(key) ?? [];
      return <div className={`tracking-date-card${monthKey(day) !== monthKey(date) ? " is-outside" : ""}${key === today ? " is-today" : ""}${day.getDay() === 0 ? " is-sunday" : ""}${items.length ? " has-events" : ""}`} key={key}>
        <time dateTime={key} title={day.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })} aria-current={key === today ? "date" : undefined}>{day.getDate()}</time>
        <div className="tracking-date-events">{items.map(item =>
          <button key={`${item.animeId}:${item.originId}:${item.episode}`} type="button" disabled={item.future}
            title={`${item.title} · серия ${item.episode}`}
            onClick={() => { trackUiAction("calendar_episode_open", {animeId: item.animeId, originId: item.originId, episode: item.episode}); onOpen(item.animeId, item.originId, item.episode); }}>
            <span>{item.title}</span><small>Серия {item.episode}{item.future ? " · ожидается" : item.pending ? " · новая" : " · вышла"}</small>
          </button>)}</div>
      </div>;
    })}
  </div>;
  const hasMonthEvents = dated.some(item => monthKey(new Date(item.date)) === monthKey(month));
  return <section className="tracking-calendar calendar-month-stack" aria-label="Календарь выхода серий">
    <section className="tracking-month-current" aria-label={monthLabel(month)}>
      <div className="tracking-calendar-controls">
        <h2 aria-live="polite">{monthLabel(month)}</h2>
        <div className="tracking-month-arrows">
          <button type="button" onClick={() => chooseMonth(-1)} aria-label="Предыдущий месяц">▴</button>
          <button type="button" onClick={() => chooseMonth(1)} aria-label="Следующий месяц">▾</button>
        </div>
      </div>
      <div className="tracking-calendar-status" aria-live="polite">
        {loading ? "Обновляем даты серий…" : error ? <>Не удалось обновить даты. <button type="button" onClick={() => setRetry(value => value + 1)}>Повторить</button></> : partial ? <>Часть дат не загрузилась. <button type="button" onClick={() => setRetry(value => value + 1)}>Повторить</button></> : !tracked.length ? "Добавьте аниме в отслеживание — здесь появятся даты выхода серий." : !hasMonthEvents ? "На этот месяц пока нет запланированных серий." : ""}
      </div>
      <div className="tracking-month-scroller" ref={scroller} tabIndex={0} role="region" aria-label="Дни календаря. Прокрутка или Page Up и Page Down переключают месяцы."
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "PageUp" || event.key === "PageDown") { event.preventDefault(); chooseMonth(event.key === "PageUp" ? -1 : 1); }
        }}
        onTouchStart={event => { const touch = event.touches[0]; touchStart.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null; }}
        onTouchCancel={() => { touchStart.current = null; }}
        onTouchEnd={event => {
          const start = touchStart.current;
          touchStart.current = null;
          const touch = event.changedTouches[0];
          if (!start || !touch) return;
          const dy = start.y - touch.clientY;
          if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(start.x - touch.clientX)) chooseMonth(dy > 0 ? 1 : -1);
        }}>
        <div className="tracking-month-weekdays">{weekdays.map(label => <div className="tracking-week-label" key={label}>{label}</div>)}</div>
        <div className={`tracking-month-viewport${monthMotion && monthMotion.to === monthKey(month) ? ` is-moving move-${monthMotion.direction}` : ""}`}>
          {monthMotion && monthMotion.to === monthKey(month) && <div className="tracking-month-layer is-leaving" aria-hidden="true" inert>{monthGrid(monthMotion.from)}</div>}
          <div className="tracking-month-layer is-entering" key={monthKey(month)}>{monthGrid(month)}</div>
        </div>
      </div>
    </section>
  </section>;
}
