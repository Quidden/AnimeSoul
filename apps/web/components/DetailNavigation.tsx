"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function DetailNavigation({
  base,
  sections,
  label,
  board = false,
  attached = false,
}: {
  base: string;
  sections: { href: string; label: string }[];
  label: string;
  board?: boolean;
  attached?: boolean;
}) {
  const pathname = usePathname();
  const separatePage = board || attached;
  const sectionIds = sections
    .filter((section) => section.href.startsWith("#"))
    .map((section) => section.href.slice(1))
    .join("|");
  const marker = useRef<HTMLDivElement>(null);
  const island = useRef<HTMLDivElement>(null);
  const [docked, setDocked] = useState(false);
  const [active, setActive] = useState("");
  useEffect(() => {
    let frame = 0;
    const glass = document.querySelector<HTMLElement>(".site-navigation-glass");
    const measure = () => {
      const bounds = island.current?.getBoundingClientRect();
      if (!bounds) return;
      document.documentElement.style.setProperty("--anime-navigation-height", `${bounds.height}px`);
      // The shared background retains its last geometry while collapsing after
      // navigation unmounts. A new page replaces these values on its first measure.
      glass?.style.setProperty("--anime-navigation-height", `${bounds.height}px`);
      glass?.style.setProperty("--anime-island-width", `${bounds.width}px`);
      glass?.style.setProperty("--anime-island-left", `${bounds.left}px`);
    };
    const update = () => {
      const header = document.querySelector(".app-header")?.getBoundingClientRect().height ?? 70;
      const value =
        separatePage || (marker.current?.getBoundingClientRect().top ?? Infinity) <= header;
      setDocked(value);
      document.documentElement.toggleAttribute("data-anime-docked", value);
      const positions = sectionIds
        .split("|")
        .map((id) => ({
          id,
          top: document.getElementById(id)?.getBoundingClientRect().top ?? Infinity,
        }))
        .filter(
          (p) => p.top <= header + (island.current?.getBoundingClientRect().height ?? 58) + 40,
        )
        .sort((a, b) => b.top - a.top);
      setActive(positions[0]?.id ?? "");
    };
    const scroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(measure);
    const viewportResize = () => {
      measure();
      scroll();
    };
    if (island.current) resize.observe(island.current);
    measure();
    update();
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", viewportResize);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", viewportResize);
      document.documentElement.removeAttribute("data-anime-docked");
      document.documentElement.style.removeProperty("--anime-navigation-height");
    };
  }, [base, sectionIds, separatePage]);
  return (
    <>
      <div
        ref={marker}
        className={`anime-navigation-marker${board ? " board" : attached ? " attached" : ""}`}
        aria-hidden="true"
      />
      <div
        ref={island}
        className={`anime-navigation-island${docked || separatePage ? " docked" : ""}${separatePage ? " attached" : ""}`}
      >
        <nav className="anime-detail-navigation" aria-label={label}>
          {sections.map(({ href, label }) => {
            const anchor = href.startsWith("#");
            const current = anchor ? !separatePage && active === href.slice(1) : pathname === href;
            return anchor && !separatePage ? (
              <a key={href} href={href} aria-current={current ? "location" : undefined}>
                {label}
              </a>
            ) : (
              <Link
                key={href}
                href={anchor ? base + href : href}
                prefetch={false}
                aria-current={current ? "page" : undefined}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
