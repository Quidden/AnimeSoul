"use client";

import { useEffect, useRef, useState } from "react";
import type { Anime } from "../lib/types";

export function episodePreviewImages(anime?: Anime, episode?: string) {
  const shots = anime?.random_screenshots ?? [];
  const exact = episode ? shots.filter((item) => String(item.episode) === String(episode)) : [];
  // Не подставляем случайные кадры всего тайтла вместо запрошенной серии.
  const selected = episode ? exact : shots;
  const result: string[] = [];
  const seenUrls = new Set<string>();
  const seenTimes = new Set<number>();
  for (const item of selected) {
    const url = item.sizes?.full ?? item.sizes?.small;
    if (!url) continue;
    const normalizedUrl = url.split("?")[0].replace(/\.small(?=\.)/i, ".full");
    const timeBucket = typeof item.time === "number" ? Math.floor(item.time / 12) : undefined;
    if (seenUrls.has(normalizedUrl) || (timeBucket !== undefined && seenTimes.has(timeBucket))) continue;
    seenUrls.add(normalizedUrl);
    if (timeBucket !== undefined) seenTimes.add(timeBucket);
    result.push(url);
    if (result.length === 6) break;
  }
  return result;
}

export function EpisodeSlideshow({
  images,
  fallback,
  iframeUrl,
  label,
  sublabel,
  onClick,
  className = "",
  allowLowQuality = false,
}: {
  images: string[];
  fallback?: string;
  iframeUrl?: string;
  duration?: number;
  label: string;
  sublabel?: string;
  onClick: () => void;
  className?: string;
  allowLowQuality?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [iframeReady, setIframeReady] = useState(false);
  const previewPlayer = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    setIndex(0);
    if (images.length < 2) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % images.length), 2800);
    return () => clearInterval(timer);
  }, [images.join("|")]);
  useEffect(() => {
    setIframeReady(false);
    if (!iframeUrl) return;
    const ready = (event: MessageEvent) => {
      if (event.source !== previewPlayer.current?.contentWindow) return;
      let data = event.data;
      try {
        if (typeof data === "string") data = JSON.parse(data);
      } catch {
        return;
      }
      const key = data?.key ?? data?.type;
      const value = data?.value ?? data;
      const time = Number(value?.time ?? value?.currentTime ?? value);
      if (key === "kodik_player_time_update" && Number.isFinite(time) && time > 0) {
        previewPlayer.current?.contentWindow?.postMessage({ key: "kodik_player_api", value: { method: "mute" } }, "*");
        previewPlayer.current?.contentWindow?.postMessage({ key: "kodik_player_api", value: { method: "pause" } }, "*");
        setIframeReady(true);
      }
    };
    window.addEventListener("message", ready);
    return () => window.removeEventListener("message", ready);
  }, [iframeUrl]);
  const rawSource = images[index];
  const isTinyScreenshot = Boolean(rawSource && /\.small\.(?:webp|avif|jpe?g|png)(?:$|\?)/i.test(rawSource));
  const source = !allowLowQuality && isTinyScreenshot && fallback ? fallback : rawSource ?? fallback;
  const usingPoster = source === fallback && Boolean(rawSource);
  const normalizedIframe = iframeUrl?.startsWith("//") ? `https:${iframeUrl}` : iframeUrl;

  return (
    <button
      type="button"
      className={`episode-slideshow ${usingPoster ? "poster-preview" : ""} ${className}`}
      onClick={onClick}
      aria-label={`${label}${sublabel ? `, ${sublabel}` : ""}`}
    >
      {source && <img key={source} src={source} alt="" />}
      {normalizedIframe
        ? <iframe
            className={`preview-video-layer ${iframeReady ? "ready" : ""}`}
            ref={previewPlayer}
            src={normalizedIframe}
            title=""
            tabIndex={-1}
            onLoad={() => {
              previewPlayer.current?.contentWindow?.postMessage({ key: "kodik_player_api", value: { method: "mute" } }, "*");
              previewPlayer.current?.contentWindow?.postMessage({ key: "kodik_player_api", value: { method: "pause" } }, "*");
              window.setTimeout(() => setIframeReady(true), 900);
            }}
          />
        : !source && <span className="preview-placeholder">AnimeSoul</span>}
      <span className="episode-preview-shade" />
      <span className="episode-preview-copy">
        <b>{label}</b>
        {sublabel && <small>{sublabel}</small>}
        <em>▶</em>
      </span>
      {!normalizedIframe && images.length > 1 && !usingPoster && (
        <i className="preview-dots">
          {images.map((_, dot) => <u className={dot === index ? "active" : ""} key={dot} />)}
        </i>
      )}
    </button>
  );
}
