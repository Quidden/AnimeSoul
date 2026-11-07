"use client";
import { useEffect, useRef } from "react";

// A frame of the anime pinned behind the top of the page. While the page scrolls it turns blurry
// and fades into the background. The blur is a second, pre-blurred copy of the frame: scrolling
// only changes opacities (through --backdrop-scroll), so nothing is re-rendered on every frame.
export function AnimeBackdrop({ src }: { src: string }) {
  const backdrop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = backdrop.current;
    if (!node) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const progress = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 1.2)));
      node.style.setProperty("--backdrop-scroll", progress.toFixed(3));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div className="anime-backdrop" aria-hidden="true" ref={backdrop}>
      <img src={src} alt="" />
      <img className="anime-backdrop-blur" src={src} alt="" />
    </div>
  );
}
