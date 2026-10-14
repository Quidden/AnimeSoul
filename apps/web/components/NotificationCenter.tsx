"use client";
import { useEffect, useRef, useState } from "react";
import type { Account, PublicMessage } from "@animesoul/contracts";
import { accountRequest } from "../lib/account-client";
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
        aria-label={`Уведомления${data?.unread ? ": непрочитано " + data.unread : ""}`}
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
        {Boolean(data?.unread) && <b>{data!.unread}</b>}
      </button>
      {open && (
        <section className="notification-panel" aria-label="Уведомления">
          <header>
            <strong>Уведомления</strong>
            <button onClick={() => setOpen(false)} aria-label="Закрыть уведомления">
              ×
            </button>
          </header>
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
          ) : (
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
