import type Hls from "hls.js";
import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  fetchKodikStream,
  hlsLevelForQuality,
  isSameEpisodeDubbingSwitch,
  lowestQualitySource,
  type KodikDirectSource,
  type KodikStreamInfo,
  type KodikStreamRequest,
} from "../../lib/kodikStream";

type SkipSegment = { time: number; length: number };
type HlsSubtitleOption = { index: number; label: string; language: string };
type PlayerMenuOption = { value: string; label: string; disabled?: boolean; warning?: string };
type BurnedSubtitleOption = { value: string; label: string; request: KodikStreamRequest };
type PlayerMenu = {
  dubbings: PlayerMenuOption[];
  dubbing: string;
  onDubbingChange: (value: string) => void;
  dubbingFavorite: boolean;
  onDubbingFavoriteToggle: () => void;
  dubbingPreferredForTitle: boolean;
  onDubbingPreferredForTitleToggle: () => void;
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
  downloadControls?: ReactNode;
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
  onTimeUpdate?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onStreamInfo?: (info: KodikStreamInfo) => void;
  onFallback?: () => void;
};

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
  onPlay,
  onPause,
  onEnded,
  onStreamInfo,
  onFallback,
}, forwardedRef) {
  const shell = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const burnedSubtitleVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioCarrierRefs = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null]);
  const hlsRef = useRef<Hls | null>(null);
  const burnedSubtitleHlsRef = useRef<Hls | null>(null);
  const audioCarrierHlsRefs = useRef<[Hls | null, Hls | null]>([null, null]);
  const continuity = useRef({ time: 0, playing: false });
  const episodeIdentity = useRef(`${request.season}:${request.episode}`);
  const previousRequest = useRef(request);
  const activeAudioSlot = useRef<number | null>(null);
  const pendingAudio = useRef<{ slot: number; token: number } | null>(null);
  const audioSwitchToken = useRef(0);
  const audioFadeFrame = useRef<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickPickerOpen, setQuickPickerOpen] = useState(false);
  const [audioSwitching, setAudioSwitching] = useState(false);
  const [audioSwitchError, setAudioSwitchError] = useState("");
  const [activeLevel, setActiveLevel] = useState({ quality: 0, bitrate: 0 });

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
          if (data.type === HlsRuntime.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === HlsRuntime.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else handleAudioCarrierFailure(slot);
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

  useEffect(() => {
    const controller = new AbortController();
    const nextEpisodeIdentity = `${request.season}:${request.episode}`;
    const audioOnlySwitch = isSameEpisodeDubbingSwitch(previousRequest.current, request);
    previousRequest.current = request;
    if (audioOnlySwitch) {
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
    setLoading(true);
    setError("");
    void fetchKodikStream(request, controller.signal).then(info => {
      if (controller.signal.aborted) return;
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
      if (controller.signal.aborted) return;
      setLoading(false);
      setError(reason instanceof Error ? reason.message : "Не удалось открыть прямой поток Kodik.");
    });
    return () => controller.abort();
  }, [request.videoId, request.season, request.episode, request.dubbing, request.translationId, request.iframeUrl]);

  const selectedSource = useMemo(
    () => stream ? sourceForQuality(stream.sources, quality) : undefined,
    [stream, quality],
  );
  const selectedBurnedSubtitle = subtitle.startsWith("burned:")
    ? menu.subtitles.find(option => `burned:${option.value}` === subtitle)
    : undefined;
  const burnedSubtitleKey = selectedBurnedSubtitle
    ? [
        selectedBurnedSubtitle.value,
        selectedBurnedSubtitle.request.videoId,
        selectedBurnedSubtitle.request.season,
        selectedBurnedSubtitle.request.episode,
        selectedBurnedSubtitle.request.translationId,
        selectedBurnedSubtitle.request.iframeUrl,
      ].join("|")
    : "";

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedSource) return;
    let disposed = false;
    const resume = continuity.current;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    setHlsSubtitles([]);
    setLoading(true);
    setActiveLevel({ quality: selectedSource.quality, bitrate: 0 });
    const isHls = selectedSource.type.includes("hls") || selectedSource.src.split("?", 1)[0].endsWith(".m3u8");
    const nativeHls = Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
    if (isHls && !nativeHls) {
      void import("hls.js").then(({ default: HlsRuntime }) => {
        if (disposed) return;
        if (!HlsRuntime.isSupported()) {
          setLoading(false);
          setError("Этот браузер не поддерживает HLS-потоки Kodik.");
          return;
        }
        const hls = new HlsRuntime({
          enableWorker: true,
          backBufferLength: 90,
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
          if (data.type === HlsRuntime.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === HlsRuntime.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else {
            setLoading(false);
            setError("Поток Kodik прервался. Можно повторить или открыть встроенный плеер.");
          }
        });
      }).catch(() => {
        if (disposed) return;
        setLoading(false);
        setError("Не удалось загрузить модуль HLS-плеера.");
      });
    } else {
      video.src = selectedSource.src;
      video.load();
    }
    return () => {
      disposed = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [selectedSource?.src, selectedSource?.quality]);

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
            if (data.type === HlsRuntime.ErrorTypes.NETWORK_ERROR) hls.startLoad();
            else if (data.type === HlsRuntime.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else setBurnedSubtitleError("Не удалось синхронизировать поток субтитров Kodik.");
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
    if (hideTimer.current) clearTimeout(hideTimer.current);
    cancelAudioFade();
    hlsRef.current?.destroy();
    burnedSubtitleHlsRef.current?.destroy();
    audioCarrierHlsRefs.current.forEach(hls => hls?.destroy());
  }, []);

  const showControls = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (playing && !settingsOpen && !quickPickerOpen) hideTimer.current = setTimeout(() => setControlsVisible(false), 2600);
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
    if (!video || !("requestPictureInPicture" in video)) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void video.requestPictureInPicture().catch(() => undefined);
  };

  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const key = event.key.toLocaleLowerCase();
    if (key === "escape" && (settingsOpen || quickPickerOpen)) { setSettingsOpen(false); setQuickPickerOpen(false); return; }
    if (!video || event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
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

  return (
    <div
      ref={shell}
      className={`animesoul-player${localPlayback ? " is-local" : ""}${controlsVisible || !playing || settingsOpen || quickPickerOpen ? " controls-visible" : ""}${settingsOpen ? " settings-open" : ""}${quickPickerOpen ? " quick-picker-open" : ""}`}
      tabIndex={0}
      onKeyDown={keyboard}
      onMouseMove={showControls}
      onMouseLeave={() => playing && !settingsOpen && !quickPickerOpen && setControlsVisible(false)}
      aria-label={`Плеер AnimeSoul: ${title}${localPlayback ? ", локальное видео" : ""}`}
    >
      <video
        className="animesoul-player-video"
        ref={value => {
          videoRef.current = value;
          setForwardedRef(forwardedRef, value);
        }}
        playsInline
        crossOrigin="anonymous"
        onClick={togglePlayback}
        onLoadedMetadata={() => {
          const video = videoRef.current;
          if (!video) return;
          if (continuity.current.time > 0) video.currentTime = Math.min(continuity.current.time, Math.max(0, video.duration - .25));
          setDuration(Number.isFinite(video.duration) ? video.duration : 0);
          onLoadedMetadata?.();
        }}
        onCanPlay={() => {
          setLoading(false);
          setError("");
          applyAudioOutput(muted, volume);
          if (continuity.current.playing) void videoRef.current?.play().catch(() => undefined);
          syncBurnedSubtitle(true);
          syncActiveAudio(true);
        }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onTimeUpdate={() => {
          const video = videoRef.current;
          if (!video) return;
          setCurrentTime(video.currentTime);
          setDuration(Number.isFinite(video.duration) ? video.duration : 0);
          syncBurnedSubtitle();
          syncActiveAudio();
          onTimeUpdate?.();
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
        onPlay={() => { setPlaying(true); showControls(); syncBurnedSubtitle(true); syncActiveAudio(true); onPlay?.(); }}
        onPause={() => { burnedSubtitleVideoRef.current?.pause(); audioCarrierRefs.current.forEach(carrier => carrier?.pause()); setPlaying(false); setControlsVisible(true); onPause?.(); }}
        onEnded={() => { audioCarrierRefs.current.forEach(carrier => carrier?.pause()); setPlaying(false); onEnded?.(); }}
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
      {loading && !error && <div className={`animesoul-player-loader${stream ? " compact" : ""}`} aria-label="Буферизация"><i /><span>{stream ? "Переключаем без сброса таймкода" : "Подготавливаем поток"}</span></div>}
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
          {onFallback && <button type="button" onClick={onFallback}>Открыть плеер Kodik</button>}
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
              if (videoRef.current) videoRef.current.playbackRate = next;
              if (burnedSubtitleVideoRef.current) burnedSubtitleVideoRef.current.playbackRate = next;
              audioCarrierRefs.current.forEach(carrier => { if (carrier) carrier.playbackRate = next; });
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
          <button type="button" aria-label="Картинка в картинке" title="Картинка в картинке" onClick={togglePictureInPicture}>▣</button>
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

      {settingsOpen && (
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
              <button type="button" className={menu.dubbingPreferredForTitle ? "active title" : ""} aria-pressed={menu.dubbingPreferredForTitle} onClick={menu.onDubbingPreferredForTitleToggle}>♥ <span>Для этого тайтла</span></button>
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
            <div className="animesoul-player-stream-state">
              <span>{localPlayback ? "Источник" : "Поток"}</span>
              <strong>{localPlayback ? `Локальный файл · ${activeQuality || quality}p` : `${activeQuality || quality}p${activeBitrate ? ` · ${activeBitrate}` : ""}`}</strong>
            </div>
            <label className="animesoul-player-toolbar-toggle">
              <input type="checkbox" checked={menu.externalToolbarVisible} onChange={event => menu.onExternalToolbarVisibleChange(event.target.checked)} />
              <span>Показывать внешнюю панель</span>
            </label>
            {menu.downloadControls && <div className="animesoul-player-downloads">{menu.downloadControls}</div>}
            {onFallback && <button type="button" className="animesoul-player-kodik-fallback" onClick={onFallback}>Открыть обычный плеер Kodik</button>}
          </div>
        </aside>
      )}
    </div>
  );
});
