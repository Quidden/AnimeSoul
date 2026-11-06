"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

type Mark = { element: HTMLElement; label: string; at: number; index: number };

const sigma = 2.6;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// A compass-like scale in place of the scrollbar. Ticks swell around the current position;
// sections marked with data-compass="Label" become the main points of the scale.
export function ScrollCompass() {
  const pathname = usePathname();
  const ruler = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scale = ruler.current;
    if (!scale) return;
    const root = document.documentElement;
    const desktop = window.matchMedia("(min-width: 901px) and (hover: hover) and (pointer: fine)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let ticks: HTMLElement[] = [];
    let marks: Mark[] = [];
    let frame = 0;
    let layout = 0;
    let scrub: { y: number; moved: boolean } | null = null;
    const range = () => Math.max(1, root.scrollHeight - window.innerHeight);
    const header = () =>
      parseFloat(getComputedStyle(root).getPropertyValue("--header-height")) || 70;

    function update() {
      frame = 0;
      if (!ticks.length) return;
      const peak = clamp(window.scrollY / range(), 0, 1) * (ticks.length - 1);
      ticks.forEach((tick, index) => {
        const distance = index - peak;
        tick.style.setProperty(
          "--a",
          Math.exp(-(distance * distance) / (2 * sigma * sigma)).toFixed(3),
        );
      });
      // The section in view is judged by the page, so short final sections still light up.
      const line = window.innerHeight * 0.4;
      let here = 0;
      marks.forEach((mark, index) => {
        if (mark.element.getBoundingClientRect().top <= line) here = index;
      });
      if (window.scrollY >= range() - 2) here = marks.length - 1;
      marks.forEach((mark, index) =>
        ticks[mark.index]?.classList.toggle("is-here", index === here),
      );
    }
    function place() {
      layout = 0;
      // A page that fits the window has nothing to scroll, so the scale would only be decoration.
      scale!.toggleAttribute(
        "data-empty",
        root.scrollHeight - window.innerHeight < Math.max(48, window.innerHeight * 0.6),
      );
      ticks.forEach((tick) => {
        tick.classList.remove("is-major", "is-here");
        delete tick.dataset.label;
      });
      const total = range(),
        offset = header();
      marks = [...document.querySelectorAll<HTMLElement>("main [data-compass]")]
        .filter((element) => element.getBoundingClientRect().height > 0)
        .map((element) => {
          const at = clamp(
            (element.getBoundingClientRect().top + window.scrollY - offset) / total,
            0,
            1,
          );
          return {
            element,
            label: element.dataset.compass ?? "",
            at,
            index: Math.round(at * (ticks.length - 1)),
          };
        })
        .sort((a, b) => a.at - b.at);
      // Sections that end the page share the last tick; spread them so each keeps a mark.
      for (let index = marks.length - 2; index >= 0; index--)
        marks[index]!.index = Math.min(marks[index]!.index, marks[index + 1]!.index - 1);
      for (let index = 1; index < marks.length; index++)
        marks[index]!.index = Math.max(marks[index]!.index, marks[index - 1]!.index + 1);
      marks = marks.filter((mark) => mark.index >= 0 && mark.index < ticks.length);
      for (const mark of marks) {
        const tick = ticks[mark.index]!;
        tick.classList.add("is-major");
        tick.dataset.label = mark.label;
      }
      update();
    }
    function build() {
      const count = clamp(Math.floor((window.innerHeight - 170) / 11), 18, 70);
      if (ticks.length !== count) {
        scale!.replaceChildren(...Array.from({ length: count }, () => document.createElement("i")));
        ticks = [...scale!.children] as HTMLElement[];
      }
      place();
    }
    const schedulePlace = () => {
      if (!layout) layout = requestAnimationFrame(place);
    };
    // The current section's label shows only while scrolling, so it never covers content at rest.
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
      root.setAttribute("data-compass-active", "");
      clearTimeout(quiet);
      quiet = setTimeout(() => root.removeAttribute("data-compass-active"), 1200);
    };
    const ratioAt = (y: number) => {
      const bounds = scale.getBoundingClientRect();
      return clamp((y - bounds.top) / bounds.height, 0, 1);
    };
    const onDown = (event: PointerEvent) => {
      scrub = { y: event.clientY, moved: false };
      scale.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!scrub) return;
      if (Math.abs(event.clientY - scrub.y) > 3) scrub.moved = true;
      if (scrub.moved)
        window.scrollTo({ top: ratioAt(event.clientY) * range(), behavior: "instant" });
    };
    const onUp = (event: PointerEvent) => {
      if (scrub && !scrub.moved) {
        const ratio = ratioAt(event.clientY);
        const near = marks.reduce<Mark | null>(
          (best, mark) =>
            !best || Math.abs(mark.at - ratio) < Math.abs(best.at - ratio) ? mark : best,
          null,
        );
        const top =
          near && Math.abs(near.at - ratio) < 0.05
            ? near.element.getBoundingClientRect().top + window.scrollY - header()
            : ratio * range();
        window.scrollTo({ top, behavior: motion.matches ? "instant" : "smooth" });
      }
      scrub = null;
    };
    const toggle = () => root.toggleAttribute("data-compass-on", desktop.matches);
    const observer = new ResizeObserver(schedulePlace);
    observer.observe(document.body);
    toggle();
    build();
    desktop.addEventListener("change", toggle);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", build);
    scale.addEventListener("pointerdown", onDown);
    scale.addEventListener("pointermove", onMove);
    scale.addEventListener("pointerup", onUp);
    scale.addEventListener("pointercancel", onUp);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(layout);
      clearTimeout(quiet);
      root.removeAttribute("data-compass-active");
      observer.disconnect();
      desktop.removeEventListener("change", toggle);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", build);
      scale.removeEventListener("pointerdown", onDown);
      scale.removeEventListener("pointermove", onMove);
      scale.removeEventListener("pointerup", onUp);
      scale.removeEventListener("pointercancel", onUp);
    };
  }, [pathname]);
  // A pointer shortcut only: keyboard and assistive technology keep native scrolling and page links.
  return <div ref={ruler} className="scroll-compass" aria-hidden="true" />;
}
