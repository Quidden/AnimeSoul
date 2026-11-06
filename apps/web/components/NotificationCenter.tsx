"use client";
import { useEffect, useRef, useState } from "react";
import { episodeListSchema, resumeEpisodeHref } from "@animesoul/contracts";
import type { Account, Episode, PublicMessage } from "@animesoul/contracts";
import { accountRequest } from "../lib/account-client";
import { useCardLibrary } from "./CardLibrary";
import { alertsDismissedKey, newEpisodeAlerts, trackedSlugs } from "../lib/new-episodes";
type Inbox = {
  items: (PublicMessage & { read: boolean })[];
  unread: number;
  total: number;
  page: number;
  pageSize: number;
};
export function NotificationCenter({ account }: { account: Account }) {
  const root = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Inbox | null>(null),
    [open, setOpen] = useState(false),
    [error, setError] = useState("");
  // New episodes of titles you are watching come from your own library, not the inbox.
  const { library } = useCardLibrary();
  const [episodes, setEpisodes] = useState<Record<string, Episode[]>>({});
  const [dismissed, setDismissed] = useState<string[]>([]);
  const slugs = library ? trackedSlugs(library).join(",") : "";
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(alertsDismissedKey) ?? "[]");
      if (Array.isArray(saved))
        setDismissed(saved.filter((id): id is string => typeof id === "string"));
    } catch {
      /* Alerts simply reappear if storage is unavailable. */
    }
  }, []);
  useEffect(() => {
    if (!slugs) return setEpisodes({});
    const controller = new AbortController();
    const refresh = () =>
      void Promise.all(
        slugs.split(",").map(async (slug) => {
          try {
            const response = await fetch(`/api/anime/${slug}/episodes`, {
              cache: "no-store",
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
            });
            if (!response.ok) return null;
            return [slug, episodeListSchema.parse(await response.json()).episodes] as const;
          } catch {
            return null;
          }
        }),
      ).then((results) => {
        if (!controller.signal.aborted)
          setEpisodes(Object.fromEntries(results.filter((entry) => entry !== null)));
      });
    refresh();
    const timer = setInterval(refresh, 300000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [slugs]);
  const alerts = library ? newEpisodeAlerts(library, episodes, new Set(dismissed)) : [];
  function dismissAlert(episodeId: string) {
    const next = [episodeId, ...dismissed.filter((id) => id !== episodeId)].slice(0, 200);
    setDismissed(next);
    try {
      localStorage.setItem(alertsDismissedKey, JSON.stringify(next));
    } catch {
      /* Optional persistence. */
    }
  }
  const unread = (data?.unread ?? 0) + alerts.length;
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  async function load(page = 1) {
    try {
      setData((await accountRequest("/api/experience/inbox?page=" + page)) as Inbox);
      setError("");
    } catch {
      setError("Не удалось загрузить уведомления.");
    }
  }
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => clearInterval(timer);
  }, [account.id]);
  async function read(id: string, dismiss: boolean) {
    try {
      setData(
        (await accountRequest(
          "/api/experience/inbox/" + id,
          { dismiss },
          account.csrfToken,
          false,
        )) as Inbox,
      );
    } catch {
      setError("Не удалось обновить уведомление.");
    }
  }
  return (
    <div className="notification-center" ref={root}>
      <button
        className="notification-toggle"
        onClick={() => {
          setOpen(!open);
          if (!open) void load();
        }}
        aria-expanded={open}
        aria-label={`Уведомления${unread ? ": непрочитано " + unread : ""}`}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
          <path d="M10 21h4M12 2V1" />
        </svg>
        {unread > 0 && <b>{unread}</b>}
      </button>
      {open && (
        <section className="notification-panel" aria-label="Уведомления">
          <header>
            <strong>
              Уведомления
              {unread > 0 && <span className="notification-count">{unread}</span>}
            </strong>
            <button
              className="notification-close"
              onClick={() => setOpen(false)}
              aria-label="Закрыть уведомления"
            >
              ×
            </button>
          </header>
          {alerts.length > 0 && (
            <div className="notification-episodes">
              <h3>Новые серии</h3>
              {alerts.map((alert) => (
                <article key={alert.episode.id} className="notification-episode unread">
                  {alert.poster ? (
                    <img src={alert.poster} alt="" width={42} height={60} loading="lazy" />
                  ) : (
                    <span aria-hidden="true" />
                  )}
                  <div>
                    <strong>Доступна серия {alert.episode.number}</strong>
                    <p>{alert.title}</p>
                    <div>
                      <a
                        className="notification-watch"
                        href={resumeEpisodeHref(alert.slug, alert.episode.id)}
                        onClick={() => dismissAlert(alert.episode.id)}
                      >
                        Смотреть
                      </a>
                      <button onClick={() => dismissAlert(alert.episode.id)}>Убрать</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {error ? (
            <p role="alert">
              {error}
              <button onClick={() => void load()}>Повторить</button>
            </p>
          ) : !data ? (
            <p>Загружаем…</p>
          ) : data.items.length ? (
            data.items.map((m) => (
              <article key={m.id} className={`${m.read ? "read" : "unread"} message-${m.kind}`}>
                <strong>{m.title}</strong>
                <p>{m.body}</p>
                {m.link && (
                  <a href={m.link} onClick={() => void read(m.id, false)}>
                    Подробнее →
                  </a>
                )}
                <div>
                  {!m.read && <button onClick={() => void read(m.id, false)}>Прочитано</button>}
                  <button onClick={() => void read(m.id, true)}>Убрать</button>
                </div>
              </article>
            ))
          ) : alerts.length ? null : (
            <p>Уведомлений пока нет.</p>
          )}
          {data && data.total > data.pageSize && (
            <footer>
              <button disabled={data.page <= 1} onClick={() => void load(data.page - 1)}>
                ←
              </button>
              <span>{data.page}</span>
              <button
                disabled={data.page * data.pageSize >= data.total}
                onClick={() => void load(data.page + 1)}
              >
                →
              </button>
            </footer>
          )}
        </section>
      )}
    </div>
  );
}
