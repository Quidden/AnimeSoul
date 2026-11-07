"use client";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

export type AnimeSection = { id: string; label: string; count?: number; content: ReactNode };

// Frames, trailer and characters share one row of tabs above the player. Every panel stays in the
// page so search engines and in-page links keep working; a link to an element inside a hidden tab
// (for example #anime-characters) opens that tab first.
export function AnimeSections({ sections }: { sections: AnimeSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const key = id
        ? document.getElementById(id)?.closest<HTMLElement>("[data-section]")?.dataset.section
        : undefined;
      if (!key) return;
      setActive(key);
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = sections[(index + step + sections.length) % sections.length];
    if (!next) return;
    setActive(next.id);
    document.getElementById("anime-tab-" + next.id)?.focus();
  }
  if (!sections.length) return null;
  return (
    <div className="anime-sections" id="anime-sections">
      <div className="anime-sections-tabs" role="tablist" aria-label="Кадры и персонажи">
        {sections.map((section, index) => (
          <button
            key={section.id}
            type="button"
            role="tab"
            id={"anime-tab-" + section.id}
            aria-selected={active === section.id}
            aria-controls={"anime-panel-" + section.id}
            tabIndex={active === section.id ? 0 : -1}
            onClick={() => setActive(section.id)}
            onKeyDown={(event) => move(event, index)}
          >
            {section.label}
            {!!section.count && <span>{section.count}</span>}
          </button>
        ))}
      </div>
      {sections.map((section) => (
        <div
          key={section.id}
          className="anime-sections-panel"
          role="tabpanel"
          id={"anime-panel-" + section.id}
          aria-labelledby={"anime-tab-" + section.id}
          data-section={section.id}
          hidden={active !== section.id}
        >
          {section.content}
        </div>
      ))}
    </div>
  );
}
