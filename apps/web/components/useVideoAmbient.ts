"use client";
import { useEffect, type RefObject } from "react";
import { videoEdgeColors } from "../lib/video-ambient";

export function useVideoAmbient(video: RefObject<HTMLVideoElement | null>, sourceKey = "") {
  useEffect(() => {
    const element = video.current;
    const surface = element?.closest<HTMLElement>(".episode-center");
    if (!element || !surface || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 14;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    let visible = true,
      readable = true;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
    });
    observer.observe(element);
    const sample = () => {
      if (!readable || !visible || document.hidden || element.readyState < 2) return;
      try {
        context.drawImage(element, 0, 0, canvas.width, canvas.height);
        videoEdgeColors(
          context.getImageData(0, 0, canvas.width, canvas.height).data,
          canvas.width,
          canvas.height,
        ).forEach((color, side) =>
          surface.style.setProperty(`--video-color-${side}`, color.join(" ")),
        );
        surface.dataset.ambientSource = "video";
      } catch {
        // A provider without CORS permission keeps the poster glow; never bypass it.
        readable = false;
      }
    };
    const timer = setInterval(() => {
      if (!element.paused && !element.ended) sample();
    }, 300);
    element.addEventListener("loadeddata", sample);
    element.addEventListener("seeked", sample);
    return () => {
      clearInterval(timer);
      observer.disconnect();
      element.removeEventListener("loadeddata", sample);
      element.removeEventListener("seeked", sample);
      for (let side = 0; side < 4; side++) surface.style.removeProperty(`--video-color-${side}`);
      delete surface.dataset.ambientSource;
    };
  }, [video, sourceKey]);
}
