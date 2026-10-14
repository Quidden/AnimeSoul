"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Anime4KRenderer } from "../lib/anime4k-renderer";
import { outputSize, type UpscaleProfile, type UpscaleTarget } from "../lib/upscale";
export function useUpscale(videoRef: RefObject<HTMLVideoElement | null>, sourceKey: string) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [target, setTarget] = useState<UpscaleTarget>(0),
    [profile, setProfile] = useState<UpscaleProfile>("light");
  const [ready, setReady] = useState(false),
    [notice, setNotice] = useState(""),
    [info, setInfo] = useState(""),
    [pip, setPip] = useState(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const enter = () => setPip(true),
      leave = () => setPip(false);
    video.addEventListener("enterpictureinpicture", enter);
    video.addEventListener("leavepictureinpicture", leave);
    return () => {
      video.removeEventListener("enterpictureinpicture", enter);
      video.removeEventListener("leavepictureinpicture", leave);
    };
  }, [videoRef, sourceKey]);
  useEffect(() => {
    const video = videoRef.current,
      surface = canvas.current;
    setReady(false);
    setInfo("");
    if (!target || !video || !surface || pip) return;
    let disposed = false,
      renderer: Anime4KRenderer | undefined,
      starting = false;
    const controller = new AbortController();
    const failed = (error?: unknown) => {
      if (disposed) return;
      renderer?.dispose();
      setReady(false);
      setTarget(0);
      if (process.env.NODE_ENV === "development")
        console.warn("Anime4K:", error instanceof Error ? error.message : "render failed");
      setNotice(
        "Anime4K недоступен на этом устройстве или для этого источника. Воспроизведение продолжается в исходном качестве.",
      );
    };
    const start = async () => {
      if (starting || disposed || video.readyState < 2 || !video.videoWidth || !video.videoHeight)
        return;
      starting = true;
      try {
        const loaded = await import("anime4k-webgpu");
        if (disposed) return;
        const [width, height] = outputSize(video.videoWidth, video.videoHeight, target);
        surface.width = width;
        surface.height = height;
        renderer = await Anime4KRenderer.create({
          signal: controller.signal,
          video,
          canvas: surface,
          width,
          height,
          profile,
          anime4k: loaded,
          onError: failed,
          onFrame: () => {
            if (!disposed) setReady(true);
          },
        });
        if (disposed) {
          renderer.dispose();
          return;
        }
        setInfo(`${video.videoWidth}×${video.videoHeight} → ${width}×${height} · Anime4K`);
      } catch (error) {
        failed(error);
      }
    };
    void start();
    video.addEventListener("loadeddata", start);
    return () => {
      disposed = true;
      controller.abort();
      video.removeEventListener("loadeddata", start);
      renderer?.dispose();
    };
  }, [videoRef, target, profile, sourceKey, pip]);
  function select(next: UpscaleTarget) {
    setNotice("");
    if (next && !("gpu" in navigator)) {
      setTarget(0);
      setNotice("Для Anime4K нужен браузер с поддержкой WebGPU. Оставлено исходное качество.");
      return;
    }
    setTarget(next);
  }
  return {
    target,
    profile,
    select,
    setProfile,
    ready: ready && !pip,
    notice,
    info: pip ? "В PiP используется исходное видео" : info,
    overlay: (
      <canvas
        ref={canvas}
        className="animesoul-upscale-canvas"
        data-upscale-state={ready ? "active" : target ? "preparing" : "off"}
        style={{ visibility: ready && !pip ? "visible" : "hidden" }}
        aria-hidden="true"
      />
    ),
  };
}
