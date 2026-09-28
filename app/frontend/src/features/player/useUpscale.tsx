import { useEffect, useRef, useState, type RefObject } from "react";
import { Anime4KRenderer } from "./anime4kRenderer";
import { outputSize, type UpscaleProfile, type UpscaleTarget } from "./upscale";
import "./upscale.css";

function activeCues(video: HTMLVideoElement) {
  return Array.from(video.textTracks)
    .flatMap(track => track.mode === "showing"
      ? Array.from(track.activeCues ?? []).map(cue => (cue as VTTCue).text.replace(/<[^>]*>/g, ""))
      : [])
    .join("\n");
}

export function useUpscale(
  videoRef: RefObject<HTMLVideoElement | null>,
  sourceKey: string,
  externallySuspended: boolean,
  _loading: boolean,
  identityKey = sourceKey,
) {
  const [browserPip, setBrowserPip] = useState(false);
  const suspended = externallySuspended || browserPip;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [target, setTarget] = useState<UpscaleTarget>(0);
  const [profile, setProfile] = useState<UpscaleProfile>("light");
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [info, setInfo] = useState("");
  const [cues, setCues] = useState("");
  const engineIdentity = useRef(identityKey);

  useEffect(() => {
    setNoticeVisible(Boolean(notice));
    const timer = setTimeout(() => setNoticeVisible(false), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const enter = () => {
      setBrowserPip(true);
      setNotice("PiP: показывается исходное видео без Anime4K.");
    };
    const leave = () => setBrowserPip(false);
    video.addEventListener("enterpictureinpicture", enter);
    video.addEventListener("leavepictureinpicture", leave);
    return () => {
      video.removeEventListener("enterpictureinpicture", enter);
      video.removeEventListener("leavepictureinpicture", leave);
    };
  }, [videoRef]);

  useEffect(() => {
    if (engineIdentity.current !== identityKey) {
      engineIdentity.current = identityKey;
      setReady(false);
      setInfo("");
      setCues("");
    }
  }, [identityKey]);

  const select = (next: UpscaleTarget) => {
    if (!next) {
      setTarget(0);
      setReady(false);
      setNotice("");
      return;
    }
    if (!("gpu" in navigator)) {
      setTarget(0);
      setReady(false);
      setNotice("Anime4K требует WebGPU. В этом браузере WebGPU недоступен, оставлено исходное видео.");
      return;
    }
    setNotice("");
    setTarget(next);
  };

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    setReady(false);
    setCues("");
    if (!target || !video || !canvas || suspended) return;

    if (!("gpu" in navigator)) {
      setTarget(0);
      setNotice("Anime4K требует WebGPU. В этом браузере WebGPU недоступен, оставлено исходное видео.");
      return;
    }

    let disposed = false;
    let renderer: Anime4KRenderer | undefined;
    let cueTimer = 0;
    const start = async () => {
      try {
        const loaded = await import("anime4k-webgpu");
        const anime4k = (loaded.default ?? loaded) as typeof loaded;
        if (disposed) return;
        if (!video.videoWidth || !video.videoHeight) {
          await new Promise<void>(resolve => video.addEventListener("loadedmetadata", () => resolve(), { once: true }));
          if (disposed) return;
        }

        const [width, height] = outputSize(video.videoWidth, video.videoHeight, target);
        canvas.width = width;
        canvas.height = height;

        renderer = await Anime4KRenderer.create({
          video,
          canvas,
          width,
          height,
          profile,
          anime4k,
          onError: error => {
            if (!disposed) {
              renderer?.dispose();
              setReady(false);
              setTarget(0);
              setNotice(`Anime4K WebGPU остановлен: ${error instanceof Error ? error.message : String(error)}. Оставлено исходное видео.`);
            }
          },
        });
        if (disposed) return;
        setReady(true);
        setInfo(`${video.videoWidth}×${video.videoHeight} → ${width}×${height} · Anime4K WebGPU · ${profile === "light" ? "лёгкий" : "продвинутый"}`);
        const refreshCues = () => setCues(activeCues(video));
        refreshCues();
        cueTimer = window.setInterval(refreshCues, 250);
      } catch (error) {
        if (disposed) return;
        renderer?.dispose();
        setReady(false);
        setTarget(0);
        setNotice(`Anime4K WebGPU недоступен: ${error instanceof Error ? error.message : String(error)}. Оставлено исходное видео.`);
      }
    };
    void start();

    return () => {
      disposed = true;
      renderer?.dispose();
      window.clearInterval(cueTimer);
    };
  }, [videoRef, target, profile, sourceKey, suspended]);

  const overlay = <>
    {noticeVisible && <div className="animesoul-version-notice" role="status">{notice}</div>}
    <canvas ref={canvasRef} className="animesoul-upscale-canvas" style={{ visibility: ready && !suspended ? "visible" : "hidden" }} aria-hidden="true" />
    {ready && !suspended && cues && <div className="animesoul-upscale-cues">{cues}</div>}
  </>;

  const settings = <div className="animesoul-upscale-settings">
    <p role="status">{suspended ? "PiP / Cast: используется исходное видео." : target ? info || "Подготовка Anime4K…" : "Исходное видео"}</p>
    {notice && <p role="status">{notice}</p>}
    <label>Профиль Anime4K <select value={profile} onChange={event => setProfile(event.target.value as UpscaleProfile)}><option value="light">Лёгкий · Mode A</option><option value="advanced">Продвинутый · Mode C</option></select></label>
    <button type="button" onClick={() => {
      setNotice("WebGPU " + (("gpu" in navigator) ? "доступен для Anime4K." : "недоступен в этом браузере."));
    }}>Проверить поддержку Anime4K</button>
  </div>;

  return { target, select, overlay, settings, ready: ready && !suspended };
}
