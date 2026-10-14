"use client";
import { getImageProps } from "next/image";
import { useEffect } from "react";
import { extractPosterColors, parsePosterPalette, posterPaletteKey } from "../lib/poster-palette";

export function PosterAmbient({ poster }: { poster: string | null }) {
  useEffect(() => {
    if (!poster) return;
    const apply = (colors: [number, number, number][]) => {
      colors.forEach((c, i) =>
        document.documentElement.style.setProperty(`--poster-color-${i}`, c.join(" ")),
      );
      document.documentElement.setAttribute("data-poster-ambient", "");
    };
    try {
      const saved = parsePosterPalette(
        JSON.parse(localStorage.getItem(posterPaletteKey) ?? "null"),
      );
      if (saved?.poster === poster) {
        apply(saved.colors);
        return;
      }
    } catch {
      /* Storage denial does not prevent palette extraction. */
    }
    let active = true;
    const image = new Image();
    const supported =
      /^https:\/\/(?:shikimori\.io|shikimori\.one|nyaa\.shikimori\.one|static\.yani\.tv|st\.kp\.yandex\.net|i\.mydramalist\.com)\//.test(
        poster,
      );
    if (!supported) image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!active) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 48;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, 32, 48);
        const colors = extractPosterColors(context.getImageData(0, 0, 32, 48).data);
        apply(colors);
        try {
          localStorage.setItem(posterPaletteKey, JSON.stringify({ poster, colors }));
        } catch {
          /* Optional persistence. */
        }
      } catch {
        /* An unavailable cross-origin poster leaves the last palette intact. */
      }
    };
    // The standard Next image optimizer provides a cached same-origin sample.
    image.src = supported
      ? getImageProps({ src: poster, width: 64, height: 96, alt: "", quality: 75 }).props.src
      : poster;
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [poster]);
  return null;
}
