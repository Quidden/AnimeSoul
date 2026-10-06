"use client";

import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function EpisodeHoverPreview({
  enabled,
  images,
  fallback,
  iframeUrl,
  duration = 1440,
  label,
  children,
}: {
  enabled: boolean;
  images: string[];
  fallback?: string;
  iframeUrl?: string;
  duration?: number;
  label: string;
  children: ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewPlayer = useRef<HTMLIFrameElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [frame, setFrame] = useState(0);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPosition(null);
    setFrame(0);
  };

  useEffect(() => cancel, []);
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled]);
  useEffect(() => {
    if (!position) return;
    const interval = setInterval(() => {
      if (iframeUrl) {
        const point = Math.max(30, Math.round(((frame + 1) % 4 + 1) * Math.max(120, duration) / 5));
        previewPlayer.current?.contentWindow?.postMessage(
          { key: "kodik_player_api", value: { method: "seek", seconds: point } },
          "*",
        );
        setFrame((value) => (value + 1) % 4);
      } else if (images.length > 1) {
        setFrame((value) => (value + 1) % images.length);
      }
    }, 1800);
    return () => clearInterval(interval);
  }, [position, images.length, iframeUrl, duration, frame]);

  const previewPosition = (x: number, y: number) => ({
    x: Math.max(8, Math.min(x, window.innerWidth - 310)),
    // Над верхними рядами места может не хватать — тогда карточка открывается под курсором.
    y: y > 210 ? y : y + 210,
  });

  const enter = (event: MouseEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const { clientX, clientY } = event;
    timer.current = setTimeout(() => {
      setPosition(previewPosition(clientX, clientY));
      timer.current = null;
    }, 500);
  };

  const move = (event: MouseEvent<HTMLDivElement>) => {
    if (position) setPosition(previewPosition(event.clientX, event.clientY));
  };

  // Обложку не выдаём за кадр серии: без точного кадра API миниатюра не открывается.
  const source = images[frame] ?? fallback;
  const normalizedIframe = iframeUrl?.startsWith("//") ? `https:${iframeUrl}` : iframeUrl;

  const initializePlayer = () => {
    const target = previewPlayer.current?.contentWindow;
    if (!target) return;
    target.postMessage({ key: "kodik_player_api", value: { method: "mute" } }, "*");
    target.postMessage(
      { key: "kodik_player_api", value: { method: "seek", seconds: Math.max(30, Math.round(duration / 5)) } },
      "*",
    );
  };

  return (
    <div className="episode-hover-anchor" onMouseEnter={enter} onMouseMove={move} onMouseLeave={cancel}>
      {children}
      {position && (normalizedIframe || source) && typeof document !== "undefined" && createPortal(
        <aside
          className="episode-hover-preview"
          style={{ left: position.x, top: position.y }}
          aria-hidden="true"
        >
          {normalizedIframe
            ? <iframe ref={previewPlayer} src={normalizedIframe} title="" tabIndex={-1} onLoad={initializePlayer} />
            : <img key={source} src={source} alt="" />}
          <span>{label}</span>
          {(normalizedIframe || images.length > 1) && <i>{frame + 1} / {normalizedIframe ? 4 : images.length}</i>}
        </aside>,
        document.body,
      )}
    </div>
  );
}
