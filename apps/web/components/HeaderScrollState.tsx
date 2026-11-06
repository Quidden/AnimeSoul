"use client";
import { useEffect } from "react";

// The header is transparent while the page is at its top and gets its glass background
// once the page scrolls. The state is an attribute on <html> so CSS does all the drawing.
const threshold = 12;

export function HeaderScrollState() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      frame = 0;
      root.toggleAttribute("data-header-solid", window.scrollY > threshold);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      if (frame) cancelAnimationFrame(frame);
      root.removeAttribute("data-header-solid");
    };
  }, []);
  return null;
}
