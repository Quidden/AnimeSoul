"use client";
import { useEffect } from "react";

// A direct link to an episode should land on the player, not on the title description above it.
// An explicit #hash in the address keeps the reader where they asked to be.
export function ScrollToWatch() {
  useEffect(() => {
    if (window.location.hash) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById("anime-watch")?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, []);
  return null;
}
