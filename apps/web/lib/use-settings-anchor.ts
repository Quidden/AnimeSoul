"use client";

import { useEffect } from "react";

/** Restore a settings link when its target becomes available after account loading. */
export function useSettingsAnchor(anchors: string, fallback?: string) {
  useEffect(() => {
    if (!anchors) return;
    let frame = 0;
    function scrollToSetting() {
      const anchor = window.location.hash.slice(1);
      if (!anchors.split(" ").includes(anchor)) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const section = document.getElementById(fallback ?? anchor);
        if (!section || section.closest("[hidden]")) return;
        section.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
      });
    }
    scrollToSetting();
    window.addEventListener("hashchange", scrollToSetting);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", scrollToSetting);
    };
  }, [anchors, fallback]);
}
