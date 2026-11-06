"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { greetingFontsHref, greetingQuery, greetingSeenKey, greetingWords } from "../lib/greeting";

type Phase = "writing" | "fading" | "final" | "closing";

// A one-time "hello" in three languages before the home page, as on a new phone.
// It can be skipped at any moment and turned off in Settings → Appearance.
export function FirstVisitGreeting() {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState(0);
  const [phase, setPhase] = useState<Phase>("writing");
  const skip = useRef<HTMLButtonElement>(null);
  const start = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute("data-greeting") !== "pending") return;
    root.setAttribute("data-greeting", "showing");
    if (!document.querySelector(`link[href="${greetingFontsHref}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = greetingFontsHref;
      document.head.append(link);
    }
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open || phase === "final" || phase === "closing") return;
    const quick = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fade = setTimeout(() => setPhase("fading"), quick ? 1300 : 2500);
    const next = setTimeout(
      () => {
        if (word + 1 < greetingWords.length) {
          setWord(word + 1);
          setPhase("writing");
        } else setPhase("final");
      },
      quick ? 1800 : 3100,
    );
    return () => {
      clearTimeout(fade);
      clearTimeout(next);
    };
  }, [open, word, phase]);

  useEffect(() => {
    if (!open) return;
    (phase === "final" ? start : skip).current?.focus();
  }, [open, phase]);

  function close() {
    try {
      localStorage.setItem(greetingSeenKey, "1");
    } catch {
      /* The greeting simply returns on the next first visit. */
    }
    setPhase("closing");
    // Releasing the attribute starts the home page's own entrance under the fading greeting.
    document.documentElement.removeAttribute("data-greeting");
    const url = new URL(window.location.href);
    if (url.searchParams.has(greetingQuery)) {
      url.searchParams.delete(greetingQuery);
      window.history.replaceState(window.history.state, "", url);
    }
    setTimeout(() => setOpen(false), 1000);
  }

  if (!open) return null;
  const current = greetingWords[word]!;
  return createPortal(
    <div
      className={`first-greeting is-${phase}`}
      role="dialog"
      aria-modal="true"
      aria-label="Приветствие AnimeSoul"
      style={{ "--greeting-hue": current.hue } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      {phase !== "final" && phase !== "closing" && (
        <svg className="first-greeting-word" viewBox="0 0 1000 300" aria-hidden="true" key={word}>
          <defs>
            <linearGradient id="first-greeting-ink" x1="0" x2="1">
              <stop offset="0" stopColor="var(--ink)" />
              <stop offset="0.55" stopColor="var(--accent-soft)" />
              <stop offset="1" stopColor="hsl(calc(var(--greeting-hue) + 40) 80% 75%)" />
            </linearGradient>
          </defs>
          <text x="500" y="205" textAnchor="middle" style={{ fontFamily: current.font }}>
            {current.text}
          </text>
        </svg>
      )}
      {(phase === "final" || phase === "closing") && (
        <div className="first-greeting-final">
          <img src="/animesoul-icon.png" alt="" width="56" height="56" />
          <h2>Добро пожаловать в AnimeSoul</h2>
          <p>Здесь ваши аниме, прогресс по сериям и друзья с похожим вкусом.</p>
          <button ref={start} className="primary" type="button" onClick={close}>
            Начать
          </button>
          <p className="first-greeting-note">
            Приветствие можно выключить в настройках: Внешний вид.
          </p>
        </div>
      )}
      <span className="first-greeting-announce" aria-live="polite">
        {phase === "final" ? "Добро пожаловать в AnimeSoul" : current.text}
      </span>
      <button ref={skip} className="first-greeting-skip" type="button" onClick={close}>
        Пропустить
      </button>
    </div>,
    document.body,
  );
}
