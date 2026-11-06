"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

// Section tabs live under the page title; once they reach the header they move into it,
// and the search field there shrinks to an icon. Separate pages show them in the header.
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
  const bar = useRef<HTMLDivElement>(null);
  const headerNav = useRef<HTMLElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [docked, setDocked] = useState(separatePage);
  const [active, setActive] = useState("");
  const [pill, setPill] = useState<CSSProperties>({ opacity: 0 });
  const [edgeClass, setEdgeClass] = useState("");

  useEffect(() => setSlot(document.getElementById("header-context")), []);

  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    // The tabs no longer add height under the header, so offsets elsewhere drop to zero.
    root.style.setProperty("--anime-navigation-height", "0px");
    const update = () => {
      frame = 0;
      const header = document.querySelector(".app-header")?.getBoundingClientRect().height ?? 70;
      const value =
        separatePage || (bar.current?.getBoundingClientRect().top ?? Infinity) <= header - 1;
      setDocked(value);
      root.toggleAttribute("data-header-tabs", value);
      const positions = sectionIds
        .split("|")
        .map((id) => ({
          id,
          top: document.getElementById(id)?.getBoundingClientRect().top ?? Infinity,
        }))
        .filter((position) => position.top <= header + 48)
        .sort((a, b) => b.top - a.top);
      setActive(positions[0]?.id ?? "");
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      root.removeAttribute("data-header-tabs");
      root.style.removeProperty("--anime-navigation-height");
    };
  }, [base, sectionIds, separatePage]);

  // A pill slides under the current tab in the header copy, which keeps that tab in view.
  useLayoutEffect(() => {
    const nav = headerNav.current;
    const current = nav?.querySelector<HTMLElement>("[aria-current]");
    setPill(
      current
        ? { width: current.offsetWidth, transform: `translateX(${current.offsetLeft}px)` }
        : { opacity: 0 },
    );
    if (nav && current && docked)
      nav.scrollTo({
        left: current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }, [active, pathname, docked, slot]);

  useEffect(() => {
    const nav = headerNav.current;
    if (!nav) return;
    const edges = () => {
      const overflow = nav.scrollWidth > nav.clientWidth + 2;
      const next = [
        overflow ? " is-overflowing" : "",
        overflow && nav.scrollLeft > 2 ? " is-scrolled" : "",
        overflow && nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2 ? " is-end" : "",
      ].join("");
      setEdgeClass((previous) => (previous === next ? previous : next));
    };
    const resize = new ResizeObserver(edges);
    resize.observe(nav);
    nav.addEventListener("scroll", edges, { passive: true });
    edges();
    return () => {
      resize.disconnect();
      nav.removeEventListener("scroll", edges);
    };
  }, [slot]);

  const links = (inHeader: boolean) =>
    sections.map(({ href, label: name }, index) => {
      const anchor = href.startsWith("#");
      const current = anchor ? !separatePage && active === href.slice(1) : pathname === href;
      const style = inHeader ? ({ "--tab-index": index } as CSSProperties) : undefined;
      return anchor && !separatePage ? (
        <a key={href} href={href} style={style} aria-current={current ? "location" : undefined}>
          {name}
        </a>
      ) : (
        <Link
          key={href}
          href={anchor ? base + href : href}
          prefetch={false}
          style={style}
          aria-current={current ? "page" : undefined}
        >
          {name}
        </Link>
      );
    });

  return (
    <>
      {/* Server-rendered for every page; separate pages keep it collapsed and use the header copy. */}
      <div
        ref={bar}
        className={`anime-navigation-island${docked ? " docked" : ""}${separatePage ? " is-separate" : ""}`}
        inert={docked}
      >
        <nav className="anime-detail-navigation" aria-label={label}>
          {links(false)}
        </nav>
      </div>
      {slot &&
        createPortal(
          <nav
            ref={headerNav}
            className={`header-tabs${docked ? " is-shown" : ""}${edgeClass}`}
            aria-label={label}
            inert={!docked}
          >
            <span className="header-tabs-pill" style={pill} aria-hidden="true" />
            {links(true)}
          </nav>,
          slot,
        )}
    </>
  );
}
