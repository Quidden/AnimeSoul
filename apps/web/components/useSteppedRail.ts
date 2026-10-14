"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { homeRailStops, nearestRailStop, nextRailStop } from "../lib/home-rail";
import { wholeCardRailLayout } from "../lib/card-rail";
import { railImageCenter } from "./useRailNavigation";

export function useSteppedRail(
  track: RefObject<HTMLDivElement | null>,
  imageSelector: string,
  count: number,
  wholeCards = false,
) {
  const move = useRef<(direction: number) => boolean>(() => false);
  const [navigation, setNavigation] = useState({
    enabled: false,
    previous: false,
    next: false,
    center: 0,
  });

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let stops = [0];
    let target: number | null = null;
    let center = 0;
    const update = () => {
      const position = target ?? element.scrollLeft;
      setNavigation({
        enabled: stops.length > 1 && Boolean(element.querySelector(imageSelector)),
        previous: position > 1,
        next: position < (stops.at(-1) ?? 0) - 1,
        center,
      });
    };
    const measure = () => {
      const previousIndex = nearestRailStop(stops, target ?? element.scrollLeft);
      const cards = Array.from(element.children) as HTMLElement[];
      if (wholeCards && cards[0] && element.parentElement) {
        const shell = element.parentElement;
        const shellStyle = getComputedStyle(shell);
        const available =
          shell.clientWidth -
          parseFloat(shellStyle.paddingLeft) -
          parseFloat(shellStyle.paddingRight);
        // Measure the preferred CSS size again after a breakpoint or container resize.
        element.style.removeProperty("--card-rail-card-width");
        const layout = wholeCardRailLayout(
          available,
          cards[0].getBoundingClientRect().width,
          parseFloat(getComputedStyle(element).columnGap) || 0,
          cards.length,
        );
        element.style.setProperty("--card-rail-card-width", `${layout.cardWidth}px`);
        element.style.setProperty("--card-rail-width", `${layout.width}px`);
      }
      const first = cards[0]?.offsetLeft ?? 0;
      stops = homeRailStops(
        cards.map((card) => card.offsetLeft - first),
        element.scrollWidth - element.clientWidth,
      );
      target = null;
      center = railImageCenter(element, imageSelector);
      element.scrollTo({
        left: stops[Math.min(previousIndex, stops.length - 1)] ?? 0,
        behavior: "instant",
      });
      update();
    };
    move.current = (direction) => {
      const position = target ?? element.scrollLeft;
      const next = nextRailStop(stops, position, direction);
      if (Math.abs(next - position) < 1) return false;
      target = next;
      element.scrollTo({ left: next, behavior: preference.matches ? "instant" : "smooth" });
      update();
      return true;
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.cancelable || stops.length < 2) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      const direction = Math.sign(delta);
      const position = target ?? element.scrollLeft;
      const canMove = Math.abs(nextRailStop(stops, position, direction) - position) >= 1;
      if (!canMove) return;
      event.preventDefault();
      // Queue each notch against the destination so fast ticks still advance one card each.
      move.current(direction);
    };
    const scroll = () => {
      if (target !== null && Math.abs(element.scrollLeft - target) < 1) target = null;
      update();
    };
    const release = () => {
      target = null;
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    if (wholeCards && element.parentElement) resize.observe(element.parentElement);
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("scroll", scroll, { passive: true });
    element.addEventListener("pointerdown", release, { passive: true });
    return () => {
      resize.disconnect();
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("scroll", scroll);
      element.removeEventListener("pointerdown", release);
      move.current = () => false;
      if (wholeCards) {
        element.style.removeProperty("--card-rail-card-width");
        element.style.removeProperty("--card-rail-width");
      }
    };
  }, [track, count, imageSelector, wholeCards]);

  return { ...navigation, move: (direction: number) => move.current(direction) };
}
