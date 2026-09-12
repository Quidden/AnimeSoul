import type Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import type { KodikDirectSource } from "../../lib/kodikStream";
import { IS_ANDROID_APP } from "../../lib/platform";

type PlayerTimelinePreviewProps = {
  localPlayback: boolean;
  source?: KodikDirectSource;
  time: number;
  timeLabel: string;
  visible: boolean;
};

export function PlayerTimelinePreview({
  localPlayback,
  source,
  time,
  timeLabel,
  visible,
}: PlayerTimelinePreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsReadyRef = useRef(false);
  const lastSeekAtRef = useRef(0);
  const targetTimeRef = useRef(time);
  const visibleRef = useRef(visible);
  const seekTargetRef = useRef<(nextTime: number) => void>(() => undefined);
  const [frameReady, setFrameReady] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [failed, setFailed] = useState(false);

  targetTimeRef.current = time;
  visibleRef.current = visible;
  seekTargetRef.current = nextTime => {
    const video = videoRef.current;
    if (!video) return;
    if (hlsReadyRef.current) {
      setSeeking(true);
      hlsRef.current?.startLoad(nextTime);
    }
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const lastFrame = Number.isFinite(video.duration) ? Math.max(0, video.duration - .05) : nextTime;
    const target = Math.min(Math.max(0, nextTime), lastFrame);
    if (Math.abs(video.currentTime - target) <= .04 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      setFrameReady(true);
      setSeeking(false);
      return;
    }
    setSeeking(true);
    setFailed(false);
    video.currentTime = target;
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!source || !video) return;
    let disposed = false;

    hlsRef.current?.destroy();
    hlsRef.current = null;
    hlsReadyRef.current = false;
    video.pause();
    video.removeAttribute("src");
    video.load();
    setFrameReady(false);
    setSeeking(false);
    setFailed(false);

    const attachNativeSource = () => {
      if (disposed) return;
      video.src = source.src;
      video.load();
    };
    const isHls = source.type.includes("hls") || source.src.split("?", 1)[0].endsWith(".m3u8");
    const nativeHls = Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
    const managedHls = isHls && (!nativeHls || (IS_ANDROID_APP && localPlayback));

    if (!managedHls) {
      attachNativeSource();
      return () => {
        disposed = true;
        video.pause();
        video.removeAttribute("src");
        video.load();
      };
    }

    void import("hls.js").then(({ default: HlsRuntime }) => {
      if (disposed) return;
      if (!HlsRuntime.isSupported()) {
        if (nativeHls) attachNativeSource();
        else setFailed(true);
        return;
      }
      const hls = new HlsRuntime({
        autoStartLoad: false,
        backBufferLength: 24,
        enableWorker: true,
        maxBufferLength: 18,
        maxBufferSize: 24 * 1024 * 1024,
        maxMaxBufferLength: 30,
        startPosition: targetTimeRef.current,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(HlsRuntime.Events.MEDIA_ATTACHED, () => hls.loadSource(source.src));
      hls.on(HlsRuntime.Events.MANIFEST_PARSED, () => {
        hlsReadyRef.current = true;
        if (visibleRef.current) seekTargetRef.current(targetTimeRef.current);
      });
      hls.on(HlsRuntime.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        hls.stopLoad();
        setFrameReady(false);
        setSeeking(false);
        setFailed(true);
      });
    }).catch(() => {
      if (disposed) return;
      if (nativeHls) attachNativeSource();
      else setFailed(true);
    });

    return () => {
      disposed = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      hlsReadyRef.current = false;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [localPlayback, source]);

  useEffect(() => {
    if (!visible || !source) return;
    const elapsed = performance.now() - lastSeekAtRef.current;
    const timer = setTimeout(() => {
      lastSeekAtRef.current = performance.now();
      seekTargetRef.current(time);
    }, Math.max(0, 70 - elapsed));
    return () => clearTimeout(timer);
  }, [source, time, visible]);

  return (
    <div
      className={`animesoul-player-timeline-preview${visible ? " visible" : ""}${frameReady ? " ready" : ""}${seeking ? " seeking" : ""}${failed ? " failed" : ""}`}
      aria-hidden="true"
    >
      <div className="animesoul-player-timeline-preview-frame">
        <video
          ref={videoRef}
          muted
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          tabIndex={-1}
          onLoadedMetadata={() => {
            if (visibleRef.current) seekTargetRef.current(targetTimeRef.current);
          }}
          onLoadedData={() => {
            if (visibleRef.current) seekTargetRef.current(targetTimeRef.current);
          }}
          onSeeking={() => setSeeking(true)}
          onSeeked={() => {
            setFrameReady(true);
            setSeeking(false);
          }}
          onError={() => {
            if (hlsRef.current) return;
            setFrameReady(false);
            setSeeking(false);
            setFailed(true);
          }}
        />
        <span>{failed ? "Кадр недоступен" : "Загружаем кадр…"}</span>
      </div>
      <time>{timeLabel}</time>
    </div>
  );
}
