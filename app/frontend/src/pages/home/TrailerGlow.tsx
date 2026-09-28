import { useEffect, useRef, type RefObject } from "react";

/** Display a blurred frame, without reading/exporting cross-origin pixel data. */
export function TrailerGlow({ videoRef, poster, source, enabled }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  poster?: string;
  source: string;
  enabled: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas || !videoRef.current) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    canvas.dataset.live = "false";
    context.clearRect(0, 0, canvas.width, canvas.height);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    let failed = false;
    let initialized = false;
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; });
    observer.observe(canvas);
    const tick = () => {
      if (motion.matches) { canvas.dataset.live = "false"; return; }
      const video = videoRef.current;
      if (failed || !visible || document.hidden || !video || video.paused || video.readyState < 2) return;
      try {
        context.globalAlpha = initialized ? .22 : 1;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        initialized = true;
        canvas.dataset.live = "true";
      } catch {
        failed = true;
        canvas.dataset.live = "false";
      }
    };
    const timer = window.setInterval(tick, 200);
    return () => { window.clearInterval(timer); observer.disconnect(); };
  }, [enabled, source, videoRef]);
  if (!enabled) return null;
  return <div className="hero-trailer-glow" aria-hidden="true">
    <canvas ref={canvasRef} width={32} height={18} />
    {poster && <img src={poster} alt="" decoding="async" />}
  </div>;
}
