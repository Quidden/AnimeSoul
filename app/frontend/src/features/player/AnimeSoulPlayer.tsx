import type Hls from "hls.js";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { IS_ANDROID_APP } from "../../lib/platform";
import {
  fetchKodikStream,
  hlsLevelForQuality,
  isSameEpisodeDubbingSwitch,
  kodikStreamEpisodeKey,
  kodikStreamRequestKey,
  lowestQualitySource,
  type KodikDirectSource,
  type KodikStreamInfo,
  type KodikStreamRequest,
} from "../../lib/kodikStream";

type SkipSegment = { time: number; length: number };
type HlsSubtitleOption = { index: number; label: string; language: string };
type PlayerMenuOption = { value: string; label: string; disabled?: boolean; warning?: string };
type BurnedSubtitleOption = { value: string; label: string; request: KodikStreamRequest };
type VideoFit = "contain" | "cover" | "ambient";
type PlayerMenu = {
  dubbings: PlayerMenuOption[];
  dubbing: string;
  onDubbingChange: (value: string) => void;
  dubbingFavorite: boolean;
  onDubbingFavoriteToggle: () => void;
  dubbingGloballyPreferred: boolean;
  onDubbingGloballyPreferredToggle: () => void;
  seasons: PlayerMenuOption[];
  season: string;
  onSeasonChange: (value: string) => void;
  episodes: PlayerMenuOption[];
  episode: string;
  onEpisodeChange: (value: string) => void;
  sources: PlayerMenuOption[];
  source: string;
  onSourceChange: (value: string) => void;
  subtitles: BurnedSubtitleOption[];
  externalToolbarVisible: boolean;
  onExternalToolbarVisibleChange: (value: boolean) => void;
};

type AnimeSoulPlayerProps = {
  request: KodikStreamRequest;
  title: string;
  seasonLabel: string;
  episodeLabel: string;
  localPlayback?: boolean;
  menu: PlayerMenu;
  opening?: SkipSegment | null;
  ending?: SkipSegment | null;
  onLoadedMetadata?: () => void;
  onTimeUpdate?: (time: number, duration: number) => void;
  onBeforeTeardown?: (time: number, duration: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: (duration: number) => void;
  onStreamInfo?: (info: KodikStreamInfo) => void;
  onFallback?: () => void;
};

type AndroidPlaybackBridge = {
  updatePlayback?: (
    title: string,
    subtitle: string,
    playing: boolean,
    position: number,
    duration: number,
    active: boolean,
  ) => void;
  clearPlayback?: () => void;
  requestPictureInPicture?: (width: number, height: number) => void;
};

function androidPlaybackBridge() {
  if (typeof window === "undefined") return undefined;
  return (window as typeof window & { AnimeSoulPlayback?: AndroidPlaybackBridge }).AnimeSoulPlayback;
}

function clock(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function setForwardedRef(ref: ForwardedRef<HTMLVideoElement>, value: HTMLVideoElement | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function sourceForQuality(sources: KodikDirectSource[], quality: number) {
  return sources.find(source => source.quality === quality) ?? sources[0];
}

function streamRate(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)} Мбит/с`
    : `${Math.round(value / 1_000)} Кбит/с`;
}

export const AnimeSoulPlayer = forwardRef<HTMLVideoElement, AnimeSoulPlayerProps>(function AnimeSoulPlayer({
  request,
  title,
  seasonLabel,
  episodeLabel,
  localPlayback = false,
  menu,
  opening,
  ending,
  onLoadedMetadata,
  onTimeUpdate,
  onBeforeTeardown,
  onPlay,
  onPause,
  onEnded,
  onStreamInfo,
  onFallback,
}, forwardedRef) {
  const shell = useRef<HTMLDivElement>(null);
  const ambientCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ambientRequestKey = useRef("");
  const requestKey = kodikStreamRequestKey(request);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const burnedSubtitleVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioCarrierRefs = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null]);
  const hlsRef = useRef<Hls | null>(null);
  const burnedSubtitleHlsRef = useRef<Hls | null>(null);
  const audioCarrierHlsRefs = useRef<[Hls | null, Hls | null]>([null, null]);
  const continuity = useRef({ time: 0, playing: false });
  const episodeIdentity = useRef(kodikStreamEpisodeKey(request));
  const previousRequest = useRef(request);
  const streamRequestToken = useRef(0);
  const activeAudioSlot = useRef<number | null>(null);
  const pendingAudio = useRef<{ slot: number; token: number } | null>(null);
  const audioSwitchToken = useRef(0);
  const audioFadeFrame = useRef<number | null>(null);
  const audioRecoveryTimers = useRef<[ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null]>([null, null]);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localWaitingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ at: number; x: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressActive = useRef(false);
  const suppressNextTap = useRef(false);
  const gestureFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativePlaybackUpdatedAt = useRef(0);
  const nativePlaybackPlaying = useRef(false);
  const nativePlaybackActive = useRef(false);
  // Keep the progress callback paired with the media request which is
  // currently mounted. Parent callbacks close over an immutable episode
  // target, so replacing this ref during render would attribute the old
  // video's final timestamp to the newly selected episode.
  const latestTeardownCallback = useRef(onBeforeTeardown);
  const activeTeardownCallback = useRef(onBeforeTeardown);
  const activeTeardownRequestKey = useRef(requestKey);
  const teardownReported = useRef(false);
  const activeMediaRequestKey = useRef("");
  const endedMediaRequestKey = useRef("");
  const [stream, setStream] = useState<KodikStreamInfo | null>(null);
  const [hlsSubtitles, setHlsSubtitles] = useState<HlsSubtitleOption[]>([]);
  const [quality, setQuality] = useState(0);
  const [subtitle, setSubtitle] = useState("off");
  const [burnedSubtitleReady, setBurnedSubtitleReady] = useState(false);
  const [burnedSubtitleError, setBurnedSubtitleError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [videoFit, setVideoFit] = useState<VideoFit>(() => {
    if (typeof window === "undefined") return "contain";
    const stored = window.localStorage.getItem("animesoul:video-fit");
    if (stored === "contain" || stored === "cover" || stored === "ambient") return stored;
    return IS_ANDROID_APP ? "cover" : "contain";
  });
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickPickerOpen, setQuickPickerOpen] = useState(false);
  const [audioSwitching, setAudioSwitching] = useState(false);
  const [audioSwitchError, setAudioSwitchError] = useState("");
  const [activeLevel, setActiveLevel] = useState({ quality: 0, bitrate: 0 });
  const [streamReloadToken, setStreamReloadToken] = useState(0);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [nativePictureInPicture, setNativePictureInPicture] = useState(false);
  const [gestureFeedback, setGestureFeedback] = useState<{ side: "left" | "center" | "right"; text: string } | null>(null);

  latestTeardownCallback.current = onBeforeTeardown;

  const reportTeardown = useCallback((video: HTMLVideoElement | null) => {
    if (!video || teardownReported.current) return;
    const time = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (time <= 0) return;
    teardownReported.current = true;
    activeTeardownCallback.current?.(time, duration);
  }, []);

  const attachVideoRef = useCallback((value: HTMLVideoElement | null) => {
    const previous = videoRef.current;
    if (!value && previous) reportTeardown(previous);
    videoRef.current = value;
    if (value) teardownReported.current = false;
    setForwardedRef(forwardedRef, value);
  }, [forwardedRef, reportTeardown]);

  const rememberContinuity = () => {
    const video = videoRef.current;
    if (!video) return;
    continuity.current = {
      time: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      playing: !video.paused && !video.ended,
    };
  };

  const cancelAudioFade = () => {
    if (audioFadeFrame.current !== null) cancelAnimationFrame(audioFadeFrame.current);
    audioFadeFrame.current = null;
  };

  const clearAudioCarrier = (slot: number) => {
    if (audioRecoveryTimers.current[slot]) clearTimeout(audioRecoveryTimers.current[slot]!);
    audioRecoveryTimers.current[slot] = null;
    audioCarrierHlsRefs.current[slot]?.destroy();
    audioCarrierHlsRefs.current[slot] = null;
    const carrier = audioCarrierRefs.current[slot];
    if (!carrier) return;
    carrier.pause();
    carrier.muted = true;
    carrier.removeAttribute("src");
    carrier.load();
  };

  const applyAudioOutput = (nextMuted = muted, nextVolume = volume) => {
    const main = videoRef.current;
    const activeSlot = activeAudioSlot.current;
    if (main) {
      main.volume = nextVolume;
      main.muted = activeSlot === null ? nextMuted : true;
    }
    audioCarrierRefs.current.forEach((carrier, slot) => {
      if (!carrier) return;
      carrier.volume = nextVolume;
      carrier.muted = slot === activeSlot ? nextMuted : true;
    });
  };

  const resetAudioCarriers = () => {
    cancelAudioFade();
    audioSwitchToken.current += 1;
    pendingAudio.current = null;
    activeAudioSlot.current = null;
    clearAudioCarrier(0);
    clearAudioCarrier(1);
    setAudioSwitching(false);
    setAudioSwitchError("");
    const main = videoRef.current;
    if (main) {
      main.muted = muted;
      main.volume = volume;
    }
  };

  const syncAudioCarrier = (slot: number, force = false) => {
    const main = videoRef.current;
    const carrier = audioCarrierRefs.current[slot];
    if (!main || !carrier || carrier.readyState < 1) return;
    carrier.playbackRate = main.playbackRate;
    if (force || Math.abs(carrier.currentTime - main.currentTime) > .2) carrier.currentTime = main.currentTime;
  };

  const syncActiveAudio = (force = false) => {
    const main = videoRef.current;
    const slot = activeAudioSlot.current;
    if (!main || slot === null) return;
    const carrier = audioCarrierRefs.current[slot];
    if (!carrier) return;
    syncAudioCarrier(slot, force);
    if (main.paused || main.ended) carrier.pause();
    else void carrier.play().catch(() => undefined);
  };

  const failAudioSwitch = (slot: number, message = "Не удалось бесшовно подключить эту озвучку.") => {
    if (pendingAudio.current?.slot !== slot) return;
    pendingAudio.current = null;
    clearAudioCarrier(slot);
    setAudioSwitching(false);
    setAudioSwitchError(message);
  };

  const handleAudioCarrierFailure = (slot: number) => {
    if (pendingAudio.current?.slot === slot) {
      failAudioSwitch(slot);
      return;
    }
    if (activeAudioSlot.current !== slot) return;
    activeAudioSlot.current = null;
    clearAudioCarrier(slot);
    applyAudioOutput(muted, volume);
    setAudioSwitching(false);
    setAudioSwitchError("Аудиопоток прервался — временно возвращён звук исходной озвучки.");
  };

  const handleAudioCarrierEnded = (slot: number) => {
    const main = videoRef.current;
    if (activeAudioSlot.current !== slot || !main || main.ended || main.currentTime >= main.duration - 1) return;
    activeAudioSlot.current = null;
    clearAudioCarrier(slot);
    applyAudioOutput(muted, volume);
    setAudioSwitchError("Эта озвучка закончилась раньше видео — для оставшихся сцен возвращён исходный звук.");
  };

  const activateAudioCarrier = (slot: number) => {
    const pending = pendingAudio.current;
    const main = videoRef.current;
    const next = audioCarrierRefs.current[slot];
    if (!pending || pending.slot !== slot || pending.token !== audioSwitchToken.current || !main || !next) return;
    syncAudioCarrier(slot, true);
    const previousSlot = activeAudioSlot.current;
    const previous = previousSlot === null ? main : audioCarrierRefs.current[previousSlot];

    const finish = () => {
      activeAudioSlot.current = slot;
      pendingAudio.current = null;
      if (previousSlot === null) {
        main.muted = true;
        main.volume = volume;
      } else if (previousSlot !== slot) {
        clearAudioCarrier(previousSlot);
      }
      applyAudioOutput(muted, volume);
      setAudioSwitching(false);
      setAudioSwitchError("");
    };

    if (main.paused || main.ended) {
      next.pause();
      finish();
      return;
    }

    next.muted = true;
    next.volume = 0;
    void next.play().then(() => {
      if (pendingAudio.current?.token !== pending.token) return;
      if (muted || volume === 0 || !previous) {
        finish();
        return;
      }
      activeAudioSlot.current = slot;
      pendingAudio.current = null;
      next.muted = false;
      next.volume = 0;
      previous.muted = false;
      previous.volume = volume;
      const startedAt = performance.now();
      const fade = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / 180);
        next.volume = volume * progress;
        previous.volume = volume * (1 - progress);
        if (progress < 1) {
          audioFadeFrame.current = requestAnimationFrame(fade);
          return;
        }
        audioFadeFrame.current = null;
        previous.muted = true;
        previous.volume = volume;
        if (previousSlot !== null && previousSlot !== slot) clearAudioCarrier(previousSlot);
        applyAudioOutput(muted, volume);
        setAudioSwitching(false);
        setAudioSwitchError("");
      };
      cancelAudioFade();
      audioFadeFrame.current = requestAnimationFrame(fade);
    }).catch(() => failAudioSwitch(slot));
  };

  const prepareDubbingAudio = (info: KodikStreamInfo, token: number) => {
    const main = videoRef.current;
    if (!main || token !== audioSwitchToken.current) return;
    const slot = activeAudioSlot.current === 0 ? 1 : 0;
    const carrier = audioCarrierRefs.current[slot];
    const source = lowestQualitySource(info.sources);
    if (!carrier || !source) {
      setAudioSwitching(false);
      setAudioSwitchError("Kodik не предоставил аудиопоток для этой озвучки.");
      return;
    }
    clearAudioCarrier(slot);
    pendingAudio.current = { slot, token };
    carrier.muted = true;
    carrier.volume = 0;
    carrier.playbackRate = main.playbackRate;
    const isHls = source.type.includes("hls") || source.src.split("?", 1)[0].endsWith(".m3u8");
    const nativeHls = Boolean(carrier.canPlayType("application/vnd.apple.mpegurl"));
    if (isHls && !nativeHls) {
      void import("hls.js").then(({ default: HlsRuntime }) => {
        if (pendingAudio.current?.token !== token || !HlsRuntime.isSupported()) {
          failAudioSwitch(slot, "Браузер не смог подготовить аудиопоток Kodik.");
          return;
        }
        const hls = new HlsRuntime({
          enableWorker: true,
          backBufferLength: 20,
          startPosition: main.currentTime > 0 ? main.currentTime : -1,
        });
        let networkRecoveries = 0;
        let mediaRecoveries = 0;
        audioCarrierHlsRefs.current[slot] = hls;
        hls.attachMedia(carrier);
        hls.on(HlsRuntime.Events.MEDIA_ATTACHED, () => hls.loadSource(source.src));
        hls.on(HlsRuntime.Events.MANIFEST_PARSED, () => {
          const levelIndex = hlsLevelForQuality(hls.levels, source.quality);
          if (levelIndex >= 0 && hls.levels.length > 1) {
            hls.currentLevel = levelIndex;
            hls.nextLevel = levelIndex;
            hls.loadLevel = levelIndex;
          }
          syncAudioCarrier(slot, true);
        });
        hls.on(HlsRuntime.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === HlsRuntime.ErrorTypes.NETWORK_ERROR && networkRecoveries < 2) {
            networkRecoveries += 1;
            audioRecoveryTimers.current[slot] = setTimeout(
              () => hls.startLoad(),
              networkRecoveries * 450,
            );
          } else if (data.type === HlsRuntime.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
            mediaRecoveries += 1;
            audioRecoveryTimers.current[slot] = setTimeout(
              () => hls.recoverMediaError(),
              mediaRecoveries * 250,
            );
          } else handleAudioCarrierFailure(slot);
        });
      }).catch(() => failAudioSwitch(slot, "Не удалось загрузить модуль бесшовного переключения."));
      return;
    }
    carrier.src = source.src;
    carrier.load();
  };

  const syncBurnedSubtitle = (force = false) => {
    const video = videoRef.current;
    const subtitles = burnedSubtitleVideoRef.current;
    if (!video || !subtitles || !subtitle.startsWith("burned:")) return;
    subtitles.playbackRate = video.playbackRate;
    if (force || Math.abs(subtitles.currentTime - video.currentTime) > .22) {
      subtitles.currentTime = video.currentTime;
    }
    if (video.paused || video.ended) subtitles.pause();
    else void subtitles.play().catch(() => undefined);
  };

  const paintAmbientFrame = useCallback(() => {
    if (videoFit !== "ambient" || nativePictureInPicture || document.visibilityState === "hidden") return;
    const video = videoRef.current;
    const canvas = ambientCanvasRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return;

    // Only the two outer pixel columns are needed: CSS stretches the left
    // edge into the left field and the right edge into the right field. This
    // keeps the original picture out of the backdrop altogether.
    const width = 96;
    const height = 96;
    const halfWidth = width / 2;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    try {
      context.drawImage(video, 0, 0, 1, video.videoHeight, 0, 0, halfWidth, height);
      context.drawImage(video, video.videoWidth - 1, 0, 1, video.videoHeight, halfWidth, 0, halfWidth, height);
    } catch {
      // A provider may temporarily protect a frame while changing streams.
      // Playback must keep working even when that frame cannot light the UI.
    }
  }, [videoFit, nativePictureInPicture]);

  useEffect(() => {
    const canvas = ambientCanvasRef.current;
    if (ambientRequestKey.current !== requestKey) {
      ambientRequestKey.current = requestKey;
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (videoFit !== "ambient" || nativePictureInPicture) return;
    const video = videoRef.current;
    if (!video || !canvas) return;

    let stopped = false;
    let videoFrame = 0;
    let animationFrame = 0;
    const refresh = () => paintAmbientFrame();
    const schedule = () => {
      if (stopped || video.paused || video.ended || videoFrame || animationFrame) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        videoFrame = video.requestVideoFrameCallback(() => {
          videoFrame = 0;
          refresh();
          schedule();
        });
      } else {
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = 0;
          refresh();
          schedule();
        });
      }
    };
    const start = () => {
      refresh();
      schedule();
    };
    start();
    video.addEventListener("loadeddata", start);
    video.addEventListener("seeked", start);
    video.addEventListener("play", start);
    return () => {
      stopped = true;
      video.removeEventListener("loadeddata", start);
      video.removeEventListener("seeked", start);
      video.removeEventListener("play", start);
      if (videoFrame) video.cancelVideoFrameCallback(videoFrame);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [paintAmbientFrame, playing, requestKey, videoFit, nativePictureInPicture]);

  useEffect(() => {
    if (activeTeardownRequestKey.current !== requestKey) {
      // The component intentionally stays mounted so Android keeps the same
      // fullscreen owner. Flush the old media before clearing its src, then
      // bind teardown reporting to the new episode target.
      reportTeardown(videoRef.current);
      teardownReported.current = false;
      activeTeardownRequestKey.current = requestKey;
    }
    activeTeardownCallback.current = latestTeardownCallback.current;
    const controller = new AbortController();
    const requestToken = ++streamRequestToken.current;
    const nextEpisodeIdentity = kodikStreamEpisodeKey(request);
    // A seamless switch keeps the old video decoder running and starts a
    // second, hidden video solely for the new audio track. This is smooth on
    // desktop, but Android WebView cannot reliably decode two HLS videos at
    // once: it causes the active stream to stutter for the rest of playback.
    // On Android, reload the single visible stream instead; continuity below
    // restores the current position and playing state without overloading the
    // device decoder.
    const audioOnlySwitch = !IS_ANDROID_APP
      && Boolean(stream && videoRef.current?.currentSrc)
      && isSameEpisodeDubbingSwitch(previousRequest.current, request);
    previousRequest.current = request;
    if (audioOnlySwitch) {
      activeMediaRequestKey.current = requestKey;
      rememberContinuity();
      cancelAudioFade();
      applyAudioOutput(muted, volume);
      const token = ++audioSwitchToken.current;
      setAudioSwitching(true);
      setAudioSwitchError("");
      void fetchKodikStream(request, controller.signal).then(info => {
        if (controller.signal.aborted || token !== audioSwitchToken.current) return;
        onStreamInfo?.(info);
        prepareDubbingAudio(info, token);
      }).catch(reason => {
        if (controller.signal.aborted || token !== audioSwitchToken.current) return;
        setAudioSwitching(false);
        setAudioSwitchError(reason instanceof Error ? reason.message : "Не удалось подготовить эту озвучку.");
      });
      return () => controller.abort();
    }

    activeMediaRequestKey.current = "";
    endedMediaRequestKey.current = "";
    resetAudioCarriers();
    if (episodeIdentity.current === nextEpisodeIdentity) {
      rememberContinuity();
    } else {
      const video = videoRef.current;
      continuity.current = { time: 0, playing: Boolean(video && !video.paused && !video.ended) };
      episodeIdentity.current = nextEpisodeIdentity;
      setCurrentTime(0);
      setDuration(0);
      setBuffered(0);
    }
    // A full source switch must not leave the old media/HLS eligible to emit
    // metadata, ended or playback events while the new resolver request is in
    // flight. Desktop audio-only dubbing switches intentionally skip this.
    setStream(null);
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const visibleVideo = videoRef.current;
    if (visibleVideo) {
      visibleVideo.pause();
      visibleVideo.removeAttribute("src");
      visibleVideo.load();
    }
    setLoading(true);
    setError("");
    void fetchKodikStream(request, controller.signal).then(info => {
      if (controller.signal.aborted || requestToken !== streamRequestToken.current) return;
      const storedQuality = Number(localStorage.getItem("animesoul:stream-quality") || 0);
      const nextQuality = info.sources.some(source => source.quality === storedQuality)
        ? storedQuality
        : info.sources[0].quality;
      setStream(info);
      setQuality(nextQuality);
      setActiveLevel({ quality: nextQuality, bitrate: 0 });
      const defaultSubtitle = info.subtitles.findIndex(track => track.default);
      setSubtitle(value => value.startsWith("burned:") && menu.subtitles.some(option => `burned:${option.value}` === value)
        ? value
        : defaultSubtitle >= 0 ? `api:${defaultSubtitle}` : "off");
      onStreamInfo?.(info);
    }).catch(reason => {
      if (controller.signal.aborted || requestToken !== streamRequestToken.current) return;
      setLoading(false);
      setError(reason instanceof Error ? reason.message : "Не удалось открыть прямой поток Kodik.");
    });
    return () => controller.abort();
  }, [requestKey, streamReloadToken]);

  const selectedSource = useMemo(
    () => stream ? sourceForQuality(stream.sources, quality) : undefined,
    [stream, quality],
  );
  const selectedBurnedSubtitle = subtitle.startsWith("burned:")
    ? menu.subtitles.find(option => `burned:${option.value}` === subtitle)
    : undefined;
  const burnedSubtitleKey = selectedBurnedSubtitle
    ? `${selectedBurnedSubtitle.value}|${kodikStreamRequestKey(selectedBurnedSubtitle.request)}`
    : "";

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedSource) return;
    activeMediaRequestKey.current = requestKey;
    endedMediaRequestKey.current = "";
    let disposed = false;
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
    let networkRecoveries = 0;
    let mediaRecoveries = 0;
    const resume = continuity.current;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    setHlsSubtitles([]);
    setLoading(true);
    setActiveLevel({ quality: selectedSource.quality, bitrate: 0 });
    const isHls = selectedSource.type.includes("hls") || selectedSource.src.split("?", 1)[0].endsWith(".m3u8");
    const nativeHls = Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
    // Android's native WebView HLS implementation keeps only a very small
    // buffer, even when every segment is already on local flash. Managed HLS
    // can prefetch several minutes and avoids a visible pause at each local
    // six-second segment boundary.
    const managedHls = isHls && (!nativeHls || (IS_ANDROID_APP && localPlayback));
    if (managedHls) {
      void import("hls.js").then(({ default: HlsRuntime }) => {
        if (disposed) return;
        if (!HlsRuntime.isSupported()) {
          if (nativeHls) {
            video.src = selectedSource.src;
            video.load();
            return;
          }
          setLoading(false);
          setError("Этот браузер не поддерживает HLS-потоки Kodik.");
          return;
        }
        const hls = new HlsRuntime({
          enableWorker: true,
          backBufferLength: localPlayback ? 180 : 90,
          maxBufferLength: localPlayback ? 180 : 30,
          maxMaxBufferLength: 600,
          maxBufferSize: localPlayback ? 256 * 1024 * 1024 : 60 * 1024 * 1024,
          startFragPrefetch: localPlayback,
          startPosition: resume.time > 0 ? resume.time : -1,
        });
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.on(HlsRuntime.Events.MEDIA_ATTACHED, () => hls.loadSource(selectedSource.src));
        hls.on(HlsRuntime.Events.MANIFEST_PARSED, () => {
          const levelIndex = hlsLevelForQuality(hls.levels, selectedSource.quality);
          if (levelIndex < 0) return;
          const level = hls.levels[levelIndex];
          setActiveLevel({
            quality: Number(level?.height) || selectedSource.quality,
            bitrate: Number(level?.bitrate) || 0,
          });
          if (hls.levels.length > 1) {
            hls.currentLevel = levelIndex;
            hls.nextLevel = levelIndex;
            hls.loadLevel = levelIndex;
          }
        });
        hls.on(HlsRuntime.Events.LEVEL_SWITCHED, (_event, data) => {
          const level = hls.levels[data.level];
          setActiveLevel({
            quality: Number(level?.height) || selectedSource.quality,
            bitrate: Number(level?.bitrate) || 0,
          });
        });
        hls.on(HlsRuntime.Events.FRAG_LOADED, (_event, data) => {
          const bytes = data.payload.byteLength;
          const seconds = Number(data.frag.duration) || 0;
          if (bytes <= 0 || seconds <= 0) return;
          const measuredBitrate = Math.round(bytes * 8 / seconds);
          setActiveLevel(current => ({
            ...current,
            bitrate: current.bitrate || measuredBitrate,
          }));
        });
        hls.on(HlsRuntime.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
          setHlsSubtitles(data.subtitleTracks.map((track, index) => ({
            index,
            label: track.name || track.lang || `Субтитры ${index + 1}`,
            language: track.lang || "und",
          })));
        });
        hls.on(HlsRuntime.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === HlsRuntime.ErrorTypes.NETWORK_ERROR && networkRecoveries < 2) {
            networkRecoveries += 1;
            if (recoveryTimer) clearTimeout(recoveryTimer);
            recoveryTimer = setTimeout(() => {
              if (!disposed && hlsRef.current === hls) hls.startLoad();
            }, networkRecoveries * 500);
          } else if (data.type === HlsRuntime.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
            mediaRecoveries += 1;
            if (recoveryTimer) clearTimeout(recoveryTimer);
            recoveryTimer = setTimeout(() => {
              if (!disposed && hlsRef.current === hls) hls.recoverMediaError();
            }, mediaRecoveries * 250);
          } else {
            hls.stopLoad();
            setLoading(false);
            setError(localPlayback
              ? "Локальное видео повреждено или было удалено. Повторите загрузку серии."
              : "Поток Kodik прервался после нескольких попыток восстановления.");
          }
        });
      }).catch(() => {
        if (disposed) return;
        if (nativeHls) {
          video.src = selectedSource.src;
          video.load();
          return;
        }
        setLoading(false);
        setError("Не удалось загрузить модуль HLS-плеера.");
      });
    } else {
      video.src = selectedSource.src;
      video.load();
    }
    return () => {
      disposed = true;
      if (recoveryTimer) clearTimeout(recoveryTimer);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [selectedSource?.src, selectedSource?.quality, localPlayback]);

  useEffect(() => {
    const video = burnedSubtitleVideoRef.current;
    burnedSubtitleHlsRef.current?.destroy();
    burnedSubtitleHlsRef.current = null;
    setBurnedSubtitleReady(false);
    setBurnedSubtitleError("");
    if (!video || !selectedBurnedSubtitle) {
      if (video) {
        video.removeAttribute("src");
        video.load();
      }
      return;
    }

    const controller = new AbortController();
    let disposed = false;
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
    void fetchKodikStream(selectedBurnedSubtitle.request, controller.signal).then(info => {
      if (disposed) return;
      const source = sourceForQuality(info.sources, quality);
      if (!source) throw new Error("Kodik не предоставил поток с субтитрами.");
      const isHls = source.type.includes("hls") || source.src.split("?", 1)[0].endsWith(".m3u8");
      const nativeHls = Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
      if (isHls && !nativeHls) {
        return import("hls.js").then(({ default: HlsRuntime }) => {
          if (disposed || !HlsRuntime.isSupported()) return;
          const hls = new HlsRuntime({ enableWorker: true, backBufferLength: 45 });
          let networkRecoveries = 0;
          let mediaRecoveries = 0;
          burnedSubtitleHlsRef.current = hls;
          hls.attachMedia(video);
          hls.on(HlsRuntime.Events.MEDIA_ATTACHED, () => hls.loadSource(source.src));
          hls.on(HlsRuntime.Events.MANIFEST_PARSED, () => {
            const levelIndex = hlsLevelForQuality(hls.levels, source.quality);
            if (levelIndex >= 0 && hls.levels.length > 1) {
              hls.currentLevel = levelIndex;
              hls.nextLevel = levelIndex;
              hls.loadLevel = levelIndex;
            }
            syncBurnedSubtitle(true);
          });
          hls.on(HlsRuntime.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            if (data.type === HlsRuntime.ErrorTypes.NETWORK_ERROR && networkRecoveries < 2) {
              networkRecoveries += 1;
              if (recoveryTimer) clearTimeout(recoveryTimer);
              recoveryTimer = setTimeout(() => {
                if (!disposed && burnedSubtitleHlsRef.current === hls) hls.startLoad();
              }, networkRecoveries * 450);
            } else if (data.type === HlsRuntime.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
              mediaRecoveries += 1;
              if (recoveryTimer) clearTimeout(recoveryTimer);
              recoveryTimer = setTimeout(() => {
                if (!disposed && burnedSubtitleHlsRef.current === hls) hls.recoverMediaError();
              }, mediaRecoveries * 250);
            } else setBurnedSubtitleError("Не удалось синхронизировать поток субтитров Kodik.");
          });
        });
      }
      video.src = source.src;
      video.load();
    }).catch(reason => {
      if (controller.signal.aborted) return;
      setBurnedSubtitleError(reason instanceof Error ? reason.message : "Не удалось открыть субтитры Kodik.");
    });

    return () => {
      disposed = true;
      controller.abort();
      if (recoveryTimer) clearTimeout(recoveryTimer);
      burnedSubtitleHlsRef.current?.destroy();
      burnedSubtitleHlsRef.current = null;
    };
  }, [burnedSubtitleKey, quality]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const apiIndex = subtitle.startsWith("api:") ? Number(subtitle.slice(4)) : -1;
    for (let index = 0; index < video.textTracks.length; index += 1) {
      const track = video.textTracks[index];
      track.mode = index === apiIndex ? "showing" : "disabled";
    }
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = subtitle.startsWith("hls:") ? Number(subtitle.slice(4)) : -1;
    }
  }, [subtitle, stream, hlsSubtitles]);

  useEffect(() => () => {
    reportTeardown(videoRef.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (localWaitingTimer.current) clearTimeout(localWaitingTimer.current);
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (gestureFeedbackTimer.current) clearTimeout(gestureFeedbackTimer.current);
    cancelAudioFade();
    audioRecoveryTimers.current.forEach(timer => { if (timer) clearTimeout(timer); });
    hlsRef.current?.destroy();
    burnedSubtitleHlsRef.current?.destroy();
    audioCarrierHlsRefs.current.forEach(hls => hls?.destroy());
  }, [reportTeardown]);

  const showControls = (forceAutoHide = false) => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if ((playing || forceAutoHide) && !settingsOpen && !quickPickerOpen) {
      hideTimer.current = setTimeout(() => setControlsVisible(false), 2600);
    }
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      syncActiveAudio(true);
      void video.play().catch(() => undefined);
    }
    else video.pause();
  };

  const toggleFullscreen = () => {
    if (!shell.current) return;
    if (document.fullscreenElement === shell.current) void document.exitFullscreen();
    else void shell.current.requestFullscreen({ navigationUI: "hide" });
  };

  const togglePictureInPicture = () => {
    const video = videoRef.current;
    if (!video) return;
    if (IS_ANDROID_APP) {
      androidPlaybackBridge()?.requestPictureInPicture?.(video.videoWidth || 16, video.videoHeight || 9);
      return;
    }
    if (!("requestPictureInPicture" in video)) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void video.requestPictureInPicture().catch(() => undefined);
  };

  const applyPlaybackRate = (next: number) => {
    if (videoRef.current) videoRef.current.playbackRate = next;
    if (burnedSubtitleVideoRef.current) burnedSubtitleVideoRef.current.playbackRate = next;
    audioCarrierRefs.current.forEach(carrier => { if (carrier) carrier.playbackRate = next; });
  };

  const showGestureFeedback = (side: "left" | "center" | "right", text: string) => {
    setGestureFeedback({ side, text });
    if (gestureFeedbackTimer.current) clearTimeout(gestureFeedbackTimer.current);
    gestureFeedbackTimer.current = setTimeout(() => setGestureFeedback(null), 650);
  };

  const handleVideoTap = (event: MouseEvent<HTMLVideoElement>) => {
    if (suppressNextTap.current) {
      suppressNextTap.current = false;
      return;
    }
    const now = performance.now();
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const previous = lastTap.current;
    if (previous && now - previous.at < 300) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = null;
      lastTap.current = null;
      const video = videoRef.current;
      if (!video) return;
      const delta = x < bounds.width / 2 ? -5 : 5;
      video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + delta));
      showGestureFeedback(delta < 0 ? "left" : "right", delta < 0 ? "−5 сек" : "+5 сек");
      showControls(true);
      return;
    }
    lastTap.current = { at: now, x };
    if (!controlsVisible) {
      showControls(true);
      return;
    }
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      lastTap.current = null;
      togglePlayback();
    }, 300);
  };

  const finishLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    if (!longPressActive.current) return;
    longPressActive.current = false;
    applyPlaybackRate(rate);
    showGestureFeedback("center", `${rate}×`);
  };

  const handleVideoPointerDown = (event: ReactPointerEvent<HTMLVideoElement>) => {
    if (event.pointerType === "mouse" || videoRef.current?.paused) return;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressActive.current = true;
      suppressNextTap.current = true;
      applyPlaybackRate(2);
      showGestureFeedback("center", "2× · удерживайте");
    }, 420);
  };

  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (playing && !settingsOpen && !quickPickerOpen && controlsVisible) {
      hideTimer.current = setTimeout(() => setControlsVisible(false), 2600);
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [playing, settingsOpen, quickPickerOpen, controlsVisible]);

  useEffect(() => {
    const updateFullscreen = () => {
      const active = Boolean(document.fullscreenElement);
      setFullscreenActive(active);
      if (!active) {
        setSettingsOpen(false);
        setQuickPickerOpen(false);
      }
    };
    document.addEventListener("fullscreenchange", updateFullscreen);
    updateFullscreen();
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  useEffect(() => {
    if (!IS_ANDROID_APP) return;
    const mediaCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ command?: string; position?: number }>).detail;
      const video = videoRef.current;
      if (!video || !detail?.command) return;
      if (detail.command === "play") void video.play().catch(() => undefined);
      else if (detail.command === "pause") video.pause();
      else if (detail.command === "seek" && Number.isFinite(detail.position)) {
        video.currentTime = Math.max(0, Math.min(video.duration || Infinity, Number(detail.position)));
      } else if (detail.command === "rewind") {
        video.currentTime = Math.max(0, video.currentTime - 5);
      } else if (detail.command === "forward") {
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
      }
    };
    const pipChange = (event: Event) => {
      const active = Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active);
      setNativePictureInPicture(active);
      setControlsVisible(!active);
      setSettingsOpen(false);
      setQuickPickerOpen(false);
    };
    window.addEventListener("animesoul-media-command", mediaCommand);
    window.addEventListener("animesoul-pip-change", pipChange);
    return () => {
      window.removeEventListener("animesoul-media-command", mediaCommand);
      window.removeEventListener("animesoul-pip-change", pipChange);
    };
  }, []);

  useEffect(() => {
    if (!IS_ANDROID_APP) return;
    const now = performance.now();
    const active = Boolean(stream && !error);
    const stateChanged = nativePlaybackPlaying.current !== playing
      || nativePlaybackActive.current !== active;
    if (playing && !stateChanged && now - nativePlaybackUpdatedAt.current < 5_000) return;
    nativePlaybackUpdatedAt.current = now;
    nativePlaybackPlaying.current = playing;
    nativePlaybackActive.current = active;
    try {
      androidPlaybackBridge()?.updatePlayback?.(
        title,
        `${seasonLabel} · ${episodeLabel}`,
        playing,
        currentTime,
        duration,
        active,
      );
    } catch {
      // Older APKs intentionally continue with WebView-only playback.
    }
  }, [title, seasonLabel, episodeLabel, playing, currentTime, duration, stream, error]);

  useEffect(() => () => {
    if (!IS_ANDROID_APP) return;
    try { androidPlaybackBridge()?.clearPlayback?.(); } catch { /* no-op */ }
  }, []);

  useEffect(() => {
    const nativeBack = (event: Event) => {
      if (settingsOpen) {
        event.preventDefault();
        setSettingsOpen(false);
      } else if (quickPickerOpen) {
        event.preventDefault();
        setQuickPickerOpen(false);
      }
    };
    window.addEventListener("animesoul-native-back", nativeBack);
    return () => window.removeEventListener("animesoul-native-back", nativeBack);
  }, [settingsOpen, quickPickerOpen]);

  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const key = event.key.toLocaleLowerCase();
    if (key === "escape" && (settingsOpen || quickPickerOpen)) { setSettingsOpen(false); setQuickPickerOpen(false); return; }
    if (
      !video
      || (event.target instanceof Element
        && event.target.closest("button,input,select,textarea,[contenteditable=true]"))
    ) return;
    if ([" ", "k"].includes(key)) { event.preventDefault(); togglePlayback(); }
    else if (key === "arrowleft") video.currentTime = Math.max(0, video.currentTime - 10);
    else if (key === "arrowright") video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
    else if (key === "m") { const next = !muted; setMuted(next); applyAudioOutput(next, volume); }
    else if (key === "f") toggleFullscreen();
    else if (key === "c" && ((stream?.subtitles.length ?? 0) || hlsSubtitles.length || menu.subtitles.length)) {
      setSubtitle(value => value === "off"
        ? stream?.subtitles.length ? "api:0" : hlsSubtitles.length ? "hls:0" : `burned:${menu.subtitles[0].value}`
        : "off");
    }
  };

  const mergedOpening = stream?.skips?.opening ?? opening ?? undefined;
  const mergedEnding = stream?.skips?.ending ?? ending ?? undefined;
  const activeSkip = mergedOpening && currentTime >= mergedOpening.time && currentTime < mergedOpening.time + mergedOpening.length
    ? { label: "Пропустить опенинг", target: mergedOpening.time + mergedOpening.length }
    : mergedEnding && currentTime >= mergedEnding.time && currentTime < mergedEnding.time + mergedEnding.length
      ? { label: "Пропустить эндинг", target: mergedEnding.time + mergedEnding.length }
      : null;
  const progress = duration > 0 ? Math.min(100, currentTime / duration * 100) : 0;
  const bufferedProgress = duration > 0 ? Math.min(100, buffered / duration * 100) : 0;
  const activeQuality = activeLevel.quality || quality;
  const activeBitrate = streamRate(activeLevel.bitrate);
  const activeDubbingOption = menu.dubbings.find(option => option.value === menu.dubbing);
  const pictureInPictureSupported = IS_ANDROID_APP || (
    typeof document !== "undefined" && document.pictureInPictureEnabled
  );
  const settingsPanel = (
    <aside className="animesoul-player-settings" aria-label="Настройки плеера" onClick={(event: MouseEvent) => event.stopPropagation()}>
      <header>
        <div><strong>Настройки</strong><span>{seasonLabel} · {episodeLabel}</span></div>
        <button type="button" aria-label="Закрыть настройки" onClick={() => setSettingsOpen(false)}>×</button>
      </header>
      <div className="animesoul-player-settings-content">
        <label>
          <span>Озвучка</span>
          <select value={menu.dubbing} onChange={event => menu.onDubbingChange(event.target.value)}>
            {menu.dubbings.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
          </select>
        </label>
        <div className="animesoul-player-dubbing-actions">
          <button type="button" className={menu.dubbingFavorite ? "active" : ""} aria-pressed={menu.dubbingFavorite} onClick={menu.onDubbingFavoriteToggle}>★ <span>В избранном</span></button>
          <button type="button" className={menu.dubbingGloballyPreferred ? "active title" : ""} aria-pressed={menu.dubbingGloballyPreferred} onClick={menu.onDubbingGloballyPreferredToggle}>♥ <span>Любимая везде</span></button>
        </div>
        {activeDubbingOption?.warning && <div className="animesoul-player-duration-warning">⚠ {activeDubbingOption.warning}</div>}
        <label>
          <span>Сезон</span>
          <select value={menu.season} onChange={event => menu.onSeasonChange(event.target.value)}>
            {menu.seasons.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Серия</span>
          <select value={menu.episode} onChange={event => menu.onEpisodeChange(event.target.value)}>
            {menu.episodes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Источник</span>
          <select value={menu.source} onChange={event => menu.onSourceChange(event.target.value)}>
            {menu.sources.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="animesoul-player-fit-control">
          <span>Отображение видео</span>
          <select
            value={videoFit}
            onChange={event => {
              const next: VideoFit = event.target.value === "cover"
                ? "cover"
                : event.target.value === "ambient" ? "ambient" : "contain";
              setVideoFit(next);
              window.localStorage.setItem("animesoul:video-fit", next);
            }}
          >
            <option value="cover">Заполнить экран</option>
            <option value="contain">Показывать целиком</option>
            <option value="ambient">Погружение · динамический фон</option>
          </select>
        </label>
        <div className="animesoul-player-stream-state">
          <span>{localPlayback ? "Источник" : "Поток"}</span>
          <strong>{localPlayback ? `Локальный файл · ${activeQuality || quality}p` : `${activeQuality || quality}p${activeBitrate ? ` · ${activeBitrate}` : ""}`}</strong>
        </div>
        <label className="animesoul-player-toolbar-toggle">
          <input type="checkbox" checked={menu.externalToolbarVisible} onChange={event => menu.onExternalToolbarVisibleChange(event.target.checked)} />
          <span>Показывать внешнюю панель</span>
        </label>
        {onFallback && <button type="button" className="animesoul-player-kodik-fallback" onClick={onFallback}>Открыть обычный плеер Kodik</button>}
      </div>
    </aside>
  );

  return (
    <div
      ref={shell}
      className={`animesoul-player${localPlayback ? " is-local" : ""}${loading ? " is-loading" : ""}${loading && (!stream || localPlayback) ? " is-preparing" : ""}${controlsVisible || !playing || settingsOpen || quickPickerOpen ? " controls-visible" : ""}${settingsOpen ? " settings-open" : ""}${quickPickerOpen ? " quick-picker-open" : ""}${videoFit === "cover" ? " fit-cover" : ""}${videoFit === "ambient" && !nativePictureInPicture ? " ambient-light" : ""}${nativePictureInPicture ? " native-pip" : ""}`}
      tabIndex={0}
      onKeyDown={keyboard}
      onMouseMove={() => showControls()}
      onMouseLeave={() => playing && !settingsOpen && !quickPickerOpen && setControlsVisible(false)}
      aria-label={`Плеер AnimeSoul: ${title}${localPlayback ? ", локальное видео" : ""}`}
    >
      {videoFit === "ambient" && !nativePictureInPicture && (
        <canvas
          ref={ambientCanvasRef}
          className="animesoul-player-ambient"
          width={96}
          height={96}
          aria-hidden="true"
        />
      )}
      <video
        className="animesoul-player-video"
        ref={attachVideoRef}
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        onClick={handleVideoTap}
        onPointerDown={handleVideoPointerDown}
        onPointerUp={finishLongPress}
        onPointerCancel={finishLongPress}
        onPointerLeave={finishLongPress}
        onLoadedMetadata={() => {
          if (activeMediaRequestKey.current !== requestKey) return;
          const video = videoRef.current;
          if (!video) return;
          if (continuity.current.time > 0) video.currentTime = Math.min(continuity.current.time, Math.max(0, video.duration - .25));
          setDuration(Number.isFinite(video.duration) ? video.duration : 0);
          onLoadedMetadata?.();
        }}
        onCanPlay={() => {
          if (localWaitingTimer.current) clearTimeout(localWaitingTimer.current);
          localWaitingTimer.current = null;
          setLoading(false);
          setError("");
          applyAudioOutput(muted, volume);
          if (continuity.current.playing) void videoRef.current?.play().catch(() => undefined);
          syncBurnedSubtitle(true);
          syncActiveAudio(true);
        }}
        onWaiting={() => {
          if (!localPlayback) {
            setLoading(true);
            return;
          }
          if (localWaitingTimer.current) clearTimeout(localWaitingTimer.current);
          localWaitingTimer.current = setTimeout(() => setLoading(true), 450);
        }}
        onPlaying={() => {
          if (localWaitingTimer.current) clearTimeout(localWaitingTimer.current);
          localWaitingTimer.current = null;
          setLoading(false);
        }}
        onTimeUpdate={() => {
          if (activeMediaRequestKey.current !== requestKey) return;
          const video = videoRef.current;
          if (!video) return;
          const resolvedDuration = Number.isFinite(video.duration) ? video.duration : 0;
          setCurrentTime(video.currentTime);
          setDuration(resolvedDuration);
          syncBurnedSubtitle();
          syncActiveAudio();
          onTimeUpdate?.(video.currentTime, resolvedDuration);
        }}
        onSeeking={() => { syncBurnedSubtitle(true); syncActiveAudio(true); }}
        onDurationChange={() => {
          const video = videoRef.current;
          if (video) setDuration(Number.isFinite(video.duration) ? video.duration : 0);
        }}
        onProgress={() => {
          const video = videoRef.current;
          if (!video?.buffered.length) { setBuffered(0); return; }
          setBuffered(video.buffered.end(video.buffered.length - 1));
        }}
        onPlay={() => {
          if (activeMediaRequestKey.current !== requestKey) return;
          endedMediaRequestKey.current = "";
          setPlaying(true);
          showControls(true);
          syncBurnedSubtitle(true);
          syncActiveAudio(true);
          onPlay?.();
        }}
        onPause={() => { burnedSubtitleVideoRef.current?.pause(); audioCarrierRefs.current.forEach(carrier => carrier?.pause()); setPlaying(false); setControlsVisible(true); onPause?.(); }}
        onEnded={() => {
          if (activeMediaRequestKey.current !== requestKey || endedMediaRequestKey.current === requestKey) return;
          endedMediaRequestKey.current = requestKey;
          const resolvedDuration = Number.isFinite(videoRef.current?.duration) ? Number(videoRef.current?.duration) : duration;
          audioCarrierRefs.current.forEach(carrier => carrier?.pause());
          setPlaying(false);
          onEnded?.(resolvedDuration);
        }}
        onError={() => {
          if (hlsRef.current) return;
          setLoading(false);
          setError(localPlayback
            ? "Локальный файл повреждён, удалён или недоступен приложению."
            : "Браузер не смог воспроизвести полученный видеофайл.");
        }}
      >
        {stream?.subtitles.map(track => (
          <track
            key={`${track.language}:${track.src}`}
            kind="subtitles"
            src={track.src}
            srcLang={track.language}
            label={track.label}
            default={Boolean(track.default)}
          />
        ))}
      </video>
      <video
        ref={burnedSubtitleVideoRef}
        className={`animesoul-player-burned-subtitles${burnedSubtitleReady && selectedBurnedSubtitle ? " active" : ""}`}
        muted
        playsInline
        crossOrigin="anonymous"
        aria-hidden="true"
        tabIndex={-1}
        onLoadedMetadata={() => syncBurnedSubtitle(true)}
        onCanPlay={() => { setBurnedSubtitleReady(true); syncBurnedSubtitle(true); }}
      />
      {[0, 1].map(slot => (
        <video
          key={`audio-carrier-${slot}`}
          ref={value => { audioCarrierRefs.current[slot] = value; }}
          className="animesoul-player-audio-carrier"
          muted
          preload="auto"
          playsInline
          crossOrigin="anonymous"
          aria-hidden="true"
          tabIndex={-1}
          onLoadedMetadata={() => syncAudioCarrier(slot, true)}
          onCanPlay={() => activateAudioCarrier(slot)}
          onError={() => handleAudioCarrierFailure(slot)}
          onEnded={() => handleAudioCarrierEnded(slot)}
        />
      ))}

      {localPlayback && (
        <div className="animesoul-player-local-badge" role="status">
          <i aria-hidden="true" />
          <span>Локальное видео</span>
        </div>
      )}

      <div className="animesoul-player-top-navigation" onClick={(event: MouseEvent) => event.stopPropagation()}>
        <button
          type="button"
          className="animesoul-player-context"
          aria-label="Выбрать сезон и серию"
          aria-expanded={quickPickerOpen}
          onClick={() => {
            setSettingsOpen(false);
            setQuickPickerOpen(value => !value);
            setControlsVisible(true);
          }}
        >
          <span className="animesoul-player-context-copy">
            <strong>{seasonLabel} · {episodeLabel}</strong>
            <span>{title}</span>
          </span>
          <i aria-hidden="true">⌄</i>
        </button>
        <label className={`animesoul-player-voice-pill${activeDubbingOption?.warning ? " warning" : ""}`} title={activeDubbingOption?.warning || "Быстрый выбор озвучки"}>
          <span>Озвучка{activeDubbingOption?.warning && <b>⚠ возможна сокращённая версия</b>}</span>
          <select value={menu.dubbing} aria-label="Озвучка" onChange={event => menu.onDubbingChange(event.target.value)}>
            {menu.dubbings.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
          </select>
        </label>
      </div>
      {quickPickerOpen && (
        <div className="animesoul-player-quick-picker" aria-label="Выбор сезона и серии" onClick={(event: MouseEvent) => event.stopPropagation()}>
          <label>
            <span>Сезон</span>
            <select value={menu.season} onChange={event => menu.onSeasonChange(event.target.value)}>
              {menu.seasons.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>Серия</span>
            <select value={menu.episode} onChange={event => menu.onEpisodeChange(event.target.value)}>
              {menu.episodes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
      )}
      {loading && !error && <div className={`animesoul-player-loader${stream && !localPlayback ? " compact" : ""}`} aria-label="Буферизация"><i /><span>{localPlayback ? "Читаем локальный файл…" : stream ? "Буферизация без сброса таймкода" : "Подготавливаем поток"}</span></div>}
      {(audioSwitching || audioSwitchError) && (
        <div className={`animesoul-player-audio-status${audioSwitchError ? " error" : ""}`} role="status">
          {audioSwitchError || "Подключаем озвучку без смены кадра…"}
        </div>
      )}
      {selectedBurnedSubtitle && !burnedSubtitleReady && (
        <div className={`animesoul-player-subtitle-status${burnedSubtitleError ? " error" : ""}`} role="status">
          {burnedSubtitleError || "Синхронизируем субтитры Kodik…"}
        </div>
      )}
      {error && (
        <div className="animesoul-player-error" role="alert">
          <b>Не удалось открыть собственный плеер</b>
          <span>{error}</span>
          <button type="button" onClick={() => {
            rememberContinuity();
            setError("");
            setLoading(true);
            setStream(null);
            setStreamReloadToken(value => value + 1);
          }}>Повторить</button>
          {onFallback && <button type="button" onClick={onFallback}>Открыть плеер Kodik</button>}
        </div>
      )}

      {gestureFeedback && (
        <div className={`animesoul-player-gesture-feedback ${gestureFeedback.side}`} role="status">
          <span>{gestureFeedback.text}</span>
        </div>
      )}
      {!playing && !loading && !error && <button type="button" className="animesoul-player-center-play" aria-label="Воспроизвести" onClick={togglePlayback}>▶</button>}
      {activeSkip && <button type="button" className="animesoul-player-skip" onClick={() => { if (videoRef.current) videoRef.current.currentTime = activeSkip.target; }}>{activeSkip.label}<span>→</span></button>}

      <div className="animesoul-player-controls" onClick={(event: MouseEvent) => event.stopPropagation()}>
        <div
          className="animesoul-player-timeline"
          style={{
            "--player-progress": `${progress}%`,
            "--player-buffered": `${bufferedProgress}%`,
          } as React.CSSProperties}
        >
          <div className="animesoul-player-timeline-rail" aria-hidden="true">
            <span className="buffered" />
            <span className="played" />
            {duration > 0 && mergedOpening && <i className="opening-marker" style={{ left: `${mergedOpening.time / duration * 100}%`, width: `${mergedOpening.length / duration * 100}%` }} title="Опенинг" />}
            {duration > 0 && mergedEnding && <i className="ending-marker" style={{ left: `${mergedEnding.time / duration * 100}%`, width: `${mergedEnding.length / duration * 100}%` }} title="Эндинг" />}
            <b className="thumb" />
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={.1}
            value={Math.min(currentTime, duration || 0)}
            aria-label="Позиция видео"
            onInput={event => {
              const next = Number(event.currentTarget.value);
              setCurrentTime(next);
              if (videoRef.current) videoRef.current.currentTime = next;
            }}
          />
        </div>
        <div className="animesoul-player-control-row">
          <button type="button" aria-label={playing ? "Пауза" : "Воспроизвести"} onClick={togglePlayback}>{playing ? "Ⅱ" : "▶"}</button>
          <button type="button" aria-label={muted ? "Включить звук" : "Выключить звук"} onClick={() => {
            const next = !muted;
            setMuted(next);
            applyAudioOutput(next, volume);
          }}>{muted || volume === 0 ? "🔇" : "🔊"}</button>
          <input
            className="animesoul-player-volume"
            type="range"
            min={0}
            max={1}
            step={.05}
            value={volume}
            aria-label="Громкость"
            onChange={event => {
              const next = Number(event.target.value);
              setVolume(next);
              setMuted(next === 0);
              applyAudioOutput(next === 0, next);
            }}
          />
          <span className="animesoul-player-time">{clock(currentTime)} / {clock(duration)}</span>
          <span className="animesoul-player-spacer" />
          {(stream?.subtitles.length || hlsSubtitles.length || menu.subtitles.length) ? (
            <label className={subtitle !== "off" ? "subtitle-active" : ""} title={burnedSubtitleError || "Субтитры"}>
              <span>CC</span>
              <select value={subtitle} aria-label="Язык субтитров" onChange={event => setSubtitle(event.target.value)}>
                <option value="off">Субтитры выкл.</option>
                {stream?.subtitles.map((track, index) => <option key={`${track.language}:${track.src}`} value={`api:${index}`}>{track.label}</option>)}
                {hlsSubtitles.map(track => <option key={`hls:${track.index}:${track.language}`} value={`hls:${track.index}`}>{track.label}</option>)}
                {menu.subtitles.map(option => <option key={`burned:${option.value}`} value={`burned:${option.value}`}>{option.label} · Kodik</option>)}
              </select>
            </label>
          ) : <span className="animesoul-player-no-subs" title="У этой версии нет субтитров">CC</span>}
          <label title="Скорость">
            <select value={rate} aria-label="Скорость воспроизведения" onChange={event => {
              const next = Number(event.target.value);
              setRate(next);
              applyPlaybackRate(next);
            }}>
              {[.5, .75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}
            </select>
          </label>
          {stream && (
            <label title={`Выбрано ${quality}p${activeBitrate ? ` · фактически ${activeQuality}p, ${activeBitrate}` : ""}`}>
              <select value={quality} aria-label="Качество видео" onChange={event => {
                rememberContinuity();
                const next = Number(event.target.value);
                localStorage.setItem("animesoul:stream-quality", String(next));
                setQuality(next);
              }}>
                {Array.from(new Set(stream.sources.map(source => source.quality))).map(value => (
                  <option key={value} value={value}>
                    {value}p{value === quality && activeBitrate ? ` · ${activeBitrate}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {pictureInPictureSupported && (
            <button type="button" aria-label="Картинка в картинке" title="Картинка в картинке" onClick={togglePictureInPicture}>▣</button>
          )}
          <button
            type="button"
            className={`animesoul-player-settings-button${settingsOpen ? " active" : ""}`}
            aria-label="Настройки плеера"
            title="Настройки плеера"
            aria-expanded={settingsOpen}
            onClick={() => {
              setSettingsOpen(value => !value);
              setQuickPickerOpen(false);
              setControlsVisible(true);
            }}
          >⚙</button>
          <button type="button" aria-label="Полный экран" title="Полный экран" onClick={toggleFullscreen}>⛶</button>
        </div>
      </div>

      {settingsOpen && (IS_ANDROID_APP && !fullscreenActive && !nativePictureInPicture && typeof document !== "undefined"
        ? createPortal(
            <div className="animesoul-player-settings-layer" role="presentation" onClick={() => setSettingsOpen(false)}>
              {settingsPanel}
            </div>,
            document.body,
          )
        : settingsPanel)}
    </div>
  );
});
