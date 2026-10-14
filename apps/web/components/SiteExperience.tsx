"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { PublicMessage, WinterSettings } from "@animesoul/contracts";
import { trackPage } from "../lib/analytics-client";
type Experience = { announcements: PublicMessage[]; winter: WinterSettings };
export function Announcements({ messages }: { messages: PublicMessage[] }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    try {
      const value: unknown = JSON.parse(
        sessionStorage.getItem("animesoul:announcements:hidden") || "[]",
      );
      if (Array.isArray(value))
        setHidden(value.filter((id): id is string => typeof id === "string").slice(-100));
    } catch {
      /* Storage or telemetry failure must not block the interface. */
    }
    return () => clearInterval(timer);
  }, []);
  function hide(m: PublicMessage) {
    const id = m.id + ":" + m.updatedAt;
    setHidden((v) => {
      const next = [...v, id].slice(-100);
      try {
        sessionStorage.setItem("animesoul:announcements:hidden", JSON.stringify(next));
      } catch {
        /* Storage or telemetry failure must not block the interface. */
      }
      return next;
    });
  }
  return (
    <div className="site-announcements">
      {messages
        .filter(
          (m) =>
            !hidden.includes(m.id + ":" + m.updatedAt) &&
            (!m.expiresAt || new Date(m.expiresAt).getTime() > now),
        )
        .map((m) => (
          <article key={m.id} className={"site-announcement message-" + m.kind}>
            <div>
              <strong>{m.title}</strong>
              <p>{m.body}</p>
              {m.link && <a href={m.link}>Подробнее →</a>}
            </div>
            {m.dismissible && (
              <button onClick={() => hide(m)} aria-label={"Закрыть: " + m.title}>
                ×
              </button>
            )}
          </article>
        ))}
    </div>
  );
}
export function AnimeAnnouncements({ animeId }: { animeId: string }) {
  const [messages, setMessages] = useState<PublicMessage[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    let generation = 0;
    const load = () => {
      const current = ++generation;
      void fetch("/api/experience?animeId=" + animeId, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((value: Experience | null) => {
          if (value && current === generation) setMessages(value.announcements);
        })
        .catch(() => {});
    };
    const accountChanged = () => {
      setMessages([]);
      load();
    };
    load();
    const timer = setInterval(load, 60000);
    addEventListener("animesoul:account-changed", accountChanged);
    return () => {
      controller.abort();
      clearInterval(timer);
      removeEventListener("animesoul:account-changed", accountChanged);
    };
  }, [animeId]);
  return <Announcements messages={messages} />;
}
function Snow({ settings }: { settings: WinterSettings }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!settings.snow || !canvas.current) return;
    const target = canvas.current,
      context = target.getContext("2d");
    if (!context) return;
    let animation = 0,
      last = 0;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let particles: { x: number; y: number; r: number; speed: number }[] = [];
    function resize() {
      target.width = innerWidth;
      target.height = innerHeight;
      const count = Math.min(
        innerWidth < 760 ? 32 : 80,
        Math.round(settings.intensity * (innerWidth < 760 ? 0.3 : 0.7)),
      );
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * target.width,
        y: Math.random() * target.height,
        r: 1 + Math.random() * 2,
        speed: 0.3 + Math.random(),
      }));
    }
    function frame(time: number) {
      if (document.hidden || media.matches) {
        last = time;
        animation = requestAnimationFrame(frame);
        return;
      }
      if (time - last < 33) {
        animation = requestAnimationFrame(frame);
        return;
      }
      const delta = Math.min((time - last) / 16.7, 3);
      last = time;
      context!.clearRect(0, 0, target.width, target.height);
      context!.fillStyle = "rgba(170,195,223,.6)";
      for (const p of particles) {
        p.y += p.speed * settings.speed * delta;
        p.x += 0.15 * delta;
        if (p.y > target.height) p.y = -4;
        if (p.x > target.width) p.x = 0;
        context!.beginPath();
        context!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        context!.fill();
      }
      animation = requestAnimationFrame(frame);
    }
    resize();
    function motionChanged() {
      cancelAnimationFrame(animation);
      context!.clearRect(0, 0, target.width, target.height);
      if (!media.matches) animation = requestAnimationFrame(frame);
    }
    motionChanged();
    media.addEventListener("change", motionChanged);
    addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(animation);
      removeEventListener("resize", resize);
      media.removeEventListener("change", motionChanged);
    };
  }, [settings]);
  return <canvas ref={canvas} className="site-winter-snow" aria-hidden="true" />;
}
export function SiteExperience() {
  const pathname = usePathname(),
    [data, setData] = useState<Experience | null>(null),
    [disabled, setDisabled] = useState(false),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    trackPage(pathname);
  }, [pathname]);
  useEffect(() => {
    try {
      setDisabled(localStorage.getItem("animesoul:winter:disabled") === "1");
    } catch {
      /* Storage or telemetry failure must not block the interface. */
    }
    const controller = new AbortController();
    let generation = 0;
    const load = () => {
      const current = ++generation;
      void fetch("/api/experience", { cache: "no-store", signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((value) => {
          if (value && current === generation) setData(value as Experience);
          setNow(Date.now());
        })
        .catch(() => {});
    };
    const accountChanged = () => {
      setData(null);
      load();
    };
    load();
    const timer = setInterval(load, 60000);
    addEventListener("animesoul:account-changed", accountChanged);
    return () => {
      controller.abort();
      clearInterval(timer);
      removeEventListener("animesoul:account-changed", accountChanged);
    };
  }, []);
  const winter = data?.winter,
    active =
      winter &&
      (winter.mode === "on" ||
        (winter.mode === "schedule" &&
          winter.startsAt &&
          winter.endsAt &&
          new Date(winter.startsAt).getTime() <= now &&
          new Date(winter.endsAt).getTime() > now));
  function toggle() {
    setDisabled(!disabled);
    try {
      localStorage.setItem("animesoul:winter:disabled", disabled ? "0" : "1");
    } catch {
      /* Storage or telemetry failure must not block the interface. */
    }
  }
  return (
    <>
      {data && <Announcements messages={data.announcements} />}{" "}
      {active && (
        <>
          {!disabled && (
            <>
              {winter.garlands && (
                <div className="site-winter-garlands" aria-hidden="true">
                  {Array.from({ length: 16 }, (_, i) => (
                    <i key={i} />
                  ))}
                </div>
              )}
              <Snow settings={winter} />
            </>
          )}
          <button className="winter-toggle" onClick={toggle}>
            {disabled ? "Включить зимние эффекты" : "Отключить зимние эффекты"}
          </button>
        </>
      )}
    </>
  );
}
