import type Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import type { KodikDirectSource, KodikThumbnail } from "../../lib/kodikStream";
import { hlsLevelForQuality } from "../../lib/kodikStream";

type PlayerTimelinePreviewProps = {
  localPlayback: boolean;
  source?: KodikDirectSource;
  versionKey?: string;
  thumbnails?: KodikThumbnail[];
  suspended?: boolean;
  time: number;
  timeLabel: string;
  visible: boolean;
};

export function PlayerTimelinePreview({ source, versionKey = "", thumbnails, suspended = false, time, timeLabel, visible }: PlayerTimelinePreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const cache = useRef(new Map<number, string>());
  const target = Math.floor(time / 5) * 5;
  const current = useRef({ target, visible, suspended });
  current.current = { target, visible, suspended };
  const [frame, setFrame] = useState<{ time: number; image: string; source: string; version: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [badThumbnail, setBadThumbnail] = useState("");
  const seek = useRef<() => void>(() => undefined);
  const src = source?.src ?? "", type = source?.type ?? "";
  const providerFrame = thumbnails?.find(item => time >= item.start && time < item.end);
  const providerSrc = providerFrame?.src === badThumbnail ? undefined : providerFrame?.src;

  useEffect(() => {
    cache.current.clear(); setFrame(null); setFailed(false);
  }, [src, versionKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src || providerSrc || suspended || !visible) return;
    let disposed = false, busy = false;
    let capturing = -1;
    let hls: Hls | null = null;
    const capture = () => {
      if (disposed || video.readyState < 2 || video.seeking || capturing < 0) return;
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(240 / video.videoWidth, 320 / video.videoHeight);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL("image/jpeg", .7);
        cache.current.set(capturing, image);
        while (cache.current.size > 48 || Array.from(cache.current.values()).reduce((sum, item) => sum + item.length * 2, 0) > 4 * 1024 * 1024) cache.current.delete(cache.current.keys().next().value!);
        if (current.current.target === capturing) setFrame({ time: capturing, image, source: src, version: versionKey });
        setFailed(false);
      } catch { setFailed(true); }
      busy = false; hls?.stopLoad();
      if (current.current.target !== capturing) seek.current();
    };
    const onSeeked = () => {
      // A paused decoder has completed the seek; read the corresponding current frame.
      capture();
    };
    seek.current = () => {
      if (disposed || !current.current.visible || current.current.suspended) return;
      const cached = cache.current.get(current.current.target);
      if (cached) { setFrame({ time: current.current.target, image: cached, source: src, version: versionKey }); return; }
      if (busy || video.readyState < 1) return;
      capturing = current.current.target; busy = true;
      const next = Math.min(capturing, Number.isFinite(video.duration) ? Math.max(0, video.duration - .1) : capturing);
      hls?.startLoad(next);
      if (Math.abs(video.currentTime - next) < .04 && video.readyState >= 2) capture();
      else video.currentTime = next;
    };
    const onError = () => { if (!hls) { busy = false; setFailed(true); } };
    video.addEventListener("seeked", onSeeked);
    const loaded = () => { if (!busy) seek.current(); };
    video.addEventListener("loadeddata", loaded);
    video.addEventListener("loadedmetadata", loaded);
    video.addEventListener("error", onError);
    const attach = async () => {
      try {
        if (type.includes("hls") || src.split("?", 1)[0].endsWith(".m3u8")) {
          const { default: HlsRuntime } = await import("hls.js");
          if (disposed) return;
          if (HlsRuntime.isSupported()) {
            hls = new HlsRuntime({ autoStartLoad: false, enableWorker: true, backBufferLength: 0,
              maxBufferLength: 2, maxMaxBufferLength: 6, maxBufferSize: 4 * 1024 * 1024 });
            hlsRef.current = hls;
            hls.attachMedia(video);
            hls.on(HlsRuntime.Events.MEDIA_ATTACHED, () => hls?.loadSource(src));
            hls.on(HlsRuntime.Events.MANIFEST_PARSED, () => {
              if (disposed || !hls) return;
              const low = hlsLevelForQuality(hls.levels, 1);
              hls.currentLevel = low; hls.nextLevel = low; hls.loadLevel = low; hls.autoLevelCapping = low;
              hls.startLoad(current.current.target);
            });
            hls.on(HlsRuntime.Events.ERROR, (_event, data) => { if (data.fatal) { hls?.stopLoad(); busy = false; setFailed(true); } });
            return;
          }
        }
        video.src = src; video.load();
      } catch { if (!disposed) setFailed(true); }
    };
    void attach();
    return () => {
      disposed = true; seek.current = () => undefined;
      video.removeEventListener("loadeddata", loaded);
      video.removeEventListener("loadedmetadata", loaded);
      video.removeEventListener("seeked", onSeeked); video.removeEventListener("error", onError);
      hls?.destroy(); hlsRef.current = null;
      video.pause(); video.removeAttribute("src"); video.load();
    };
  }, [src, type, versionKey, providerSrc, suspended, visible]);

  useEffect(() => {
    if (!visible || suspended || providerSrc) return;
    const cached = cache.current.get(target);
    if (cached) { setFrame({ time: target, image: cached, source: src, version: versionKey }); return; }
    const timer = setTimeout(() => seek.current(), 85);
    return () => clearTimeout(timer);
  }, [target, visible, suspended, providerSrc, src, versionKey]);
  const image = providerSrc || (frame?.time === target && frame.source === src && frame.version === versionKey ? frame.image : "");
  return <div className={`animesoul-player-timeline-preview${visible ? " visible" : ""}${image ? " ready" : " seeking"}`} aria-hidden="true">
    <div className="animesoul-player-timeline-preview-frame">
      <video ref={videoRef} muted playsInline preload="metadata" crossOrigin="anonymous" style={{ display: "none" }} />
      {image ? <img src={image} onError={() => { if (providerSrc) setBadThumbnail(providerSrc); else setFailed(true); }} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ opacity: 1 }}>{suspended ? "Приоритет воспроизведению" : failed ? "Кадр недоступен" : "Загружаем кадр…"}</span>}
    </div><time>{timeLabel}</time>
  </div>;
}
