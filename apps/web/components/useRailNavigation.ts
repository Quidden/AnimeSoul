"use client";

import { useEffect, useState, type RefObject } from "react";

export function railImageCenter(track: HTMLElement, selector: string) {
  const image = track.querySelector<HTMLElement>(selector);
  const shell = track.parentElement;
  if (!image || !shell) return 0;
  const bounds = image.getBoundingClientRect();
  return bounds.top - shell.getBoundingClientRect().top + bounds.height / 2;
}

export function useRailNavigation(
  track: RefObject<HTMLDivElement | null>,
  imageSelector: string,
  count: number,
) {
  const [navigation, setNavigation] = useState({
    enabled: false,
    previous: false,
    next: false,
    center: 0,
  });
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const update = () =>
      setNavigation({
        enabled:
          Boolean(element.querySelector(imageSelector)) &&
          element.scrollWidth > element.clientWidth + 2,
        previous: element.scrollLeft > 2,
        next: element.scrollLeft + element.clientWidth < element.scrollWidth - 2,
        center: railImageCenter(element, imageSelector),
      });
    const resize = new ResizeObserver(update);
    resize.observe(element);
    const image = element.querySelector<HTMLElement>(imageSelector);
    if (image) resize.observe(image);
    element.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      resize.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [track, imageSelector, count]);
  return navigation;
}
