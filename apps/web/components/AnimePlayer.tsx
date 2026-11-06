"use client";
import { useRouter } from "next/navigation";
import { seasonLabel } from "../lib/season-label";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  playbackRevisionSchema,
  reconcilePlayback,
  type Playback,
  type PlaybackSource,
  streamSchema,
  type Stream,
  episodeLabel,
  type AnimeFranchise,
  dubbingKey,
  playerStateSchema,
} from "@animesoul/contracts";
import { trackPlayerStart } from "../lib/analytics-client";
import { EmbeddedPlayer } from "./EmbeddedPlayer";
import { useSubscription } from "./useSubscription";
import { SubscriptionPreview } from "./SubscriptionPreview";
import { PlayerComparison } from "./PlayerComparison";
import { NativePlayer } from "./NativePlayer";
import { PlayerTopNavigation, type PlayerMenu } from "./PlayerMenus";
import { usePlaybackProgress } from "./usePlaybackProgress";
import {
  choosePlaybackSource,
  franchisePartOptions,
  playbackRouteAction,
} from "../lib/franchise-navigation";
import {
  adjacentPart,
  adjacentPlayback,
  playbackSequence,
  parsePlaybackIntent,
  playbackIntentKey,
  consumePlaybackIntent,
  type PlaybackIntent,
} from "../lib/episode-sequence";
import { playbackClient } from "../lib/playback-client";
import { preferredDubbing } from "../lib/player-preferences";
import { usePlayerPreferences } from "./usePlayerPreferences";
import { accountRequest } from "../lib/account-client";
import { reportClientError } from "../lib/diagnostics-client";
import type { PartFilter } from "./AnimePartSwitches";
import { mainStoryIds, partType, partTypes } from "../lib/franchise-graph";
import { PlayerLoadingHint } from "./PlayerLoadingHint";

function ordered(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
}
function choiceKey(source: PlaybackSource) {
  return source.variantId;
}
function previewImage(images: string[], episode: string, poster?: string | null) {
  return images.length
    ? images[(Math.max(1, Number(episode) || 1) - 1) % images.length]
    : (poster ?? undefined);
}

export function AnimePlayer({
  slug,
  title,
  previewImages = [],
  initialEpisodeId,
  initialTime,
  franchise,
  allowedPartIds,
  seasonRequest,
  episodeRequest,
  onSelectionChange,
  partFilters,
  resumeRequested = false,
}: {
  slug: string;
  title: string;
  previewImages?: string[];
  initialEpisodeId?: string;
  initialTime?: number;
  franchise?: AnimeFranchise;
  allowedPartIds?: string[];
  seasonRequest?: { season: string; revision: number };
  episodeRequest?: { episodeId: string; revision: number };
  onSelectionChange?: (selection: { season: string; episodeId: string }) => void;
  partFilters?: PartFilter[];
  resumeRequested?: boolean;
}) {
  const router = useRouter();
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (error) reportClientError(new Error("Playback could not load"), "player");
  }, [error]);
  const [validatingPolicy, setValidatingPolicy] = useState(false);
  const [reload, setReload] = useState(0);
  const [season, setSeason] = useState("");
  const [episode, setEpisode] = useState("");
  const [choice, setChoice] = useState("");
  const [started, setStarted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [stream, setStream] = useState<Stream | null>(null);
  const [streamFor, setStreamFor] = useState("");
  const [start, setStart] = useState(0);
  const [time, setTime] = useState(0);
  const subscription = useSubscription();
  const [engine, setEngine] = useState<"auto" | "native" | "kodik">("auto");
  const [engineReady, setEngineReady] = useState(false);
  const [streamRetry, setStreamRetry] = useState(0);
  const [embedReset, setEmbedReset] = useState(0);
  const unknownEmbedEvent = useRef("");
  const playingState = useRef(false);
  const nativeAutoplay = useRef(true);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  useEffect(() => {
    if (subscription.value?.nativeAccess) {
      setSubscriptionOpen(false);
      setComparisonOpen(false);
    }
  }, [subscription.value?.nativeAccess]);
  const wantsNative = Boolean(
    subscription.value?.nativeAccess && subscription.value.directEnabled && engine !== "kodik",
  );
  const nativeAllowed = useRef(wantsNative);
  nativeAllowed.current = wantsNative;
  useEffect(() => {
    try {
      if (sessionStorage.getItem("animesoul:player-engine") === "kodik") setEngine("kodik");
    } catch {
      /* Private storage can be unavailable. */
    }
    setEngineReady(true);
  }, []);
  const previousNative = useRef(false);
  useEffect(() => {
    if (previousNative.current !== wantsNative) {
      setStart(time);
      if (startedState.current) nativeAutoplay.current = playingState.current;
      refreshRequest.current?.abort();
    }
    previousNative.current = wantsNative;
  }, [wantsNative]);
  const [motion, setMotion] = useState("");
  const [transitionMessage, setTransitionMessage] = useState("");
  const [transitionPending, setTransitionPending] = useState(false);
  const [transitionOrigin, setTransitionOrigin] = useState<{
    image: string | undefined;
    caption: string;
    travel: number;
  }>();
  const requestedRoute = useRef({ episodeId: initialEpisodeId, time: initialTime });
  requestedRoute.current = { episodeId: initialEpisodeId, time: initialTime };
  const localSelection = useRef<string | undefined>(undefined);
  const selectedSource = useRef<PlaybackSource | undefined>(undefined);
  const startedState = useRef(started);
  startedState.current = started;
  const transitionBusy = useRef(false);
  const waitingForRoute = useRef<string | undefined>(undefined);
  const transitionViewportTop = useRef<number | undefined>(undefined);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const neighborRequest = useRef<AbortController | null>(null);
  const refreshRequest = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      clearTimeout(transitionTimer.current);
      neighborRequest.current?.abort();
      refreshRequest.current?.abort();
    },
    [],
  );
  const region = useRef<HTMLElement>(null);
  const [startPickerOpen, setStartPickerOpen] = useState(false);
  const restored = useRef("");
  const resumedEntry = useRef("");
  const loadedRequest = useRef<{ slug: string; reload: number } | undefined>(undefined);
  const playbackState = useRef<Playback | null>(null);
  const selectionState = useRef<{ episodeId: string | undefined; choice: string }>({
    episodeId: undefined,
    choice: "",
  });
  const explicitTime = useRef(initialTime);
  function finishTransition() {
    clearTimeout(transitionTimer.current);
    setMotion("");
    setTransitionOrigin(undefined);
    setTransitionPending(false);
    transitionBusy.current = false;
    waitingForRoute.current = undefined;
    transitionViewportTop.current = undefined;
  }
  function animateEntrance(intent: PlaybackIntent) {
    clearTimeout(transitionTimer.current);
    waitingForRoute.current = undefined;
    transitionViewportTop.current = intent.viewportTop;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishTransition();
      return;
    }
    const from = franchise?.items.find((part) => part.anime.id === intent.fromAnimeId)?.anime;
    const images = from?.slug === slug ? previewImages : (from?.details?.screenshots ?? []);
    setTransitionOrigin({
      image: previewImage(images, intent.fromEpisode ?? "1", from?.poster),
      caption: `Серия ${intent.fromEpisode ?? ""}${from ? ` · ${from.title}` : ""}`,
      travel: intent.direction * (intent.travel ?? 0.55),
    });
    transitionBusy.current = true;
    setTransitionPending(true);
    setMotion(intent.direction === 1 ? "enter-next" : "enter-previous");
  }
  useEffect(() => {
    if (!motion) return;
    // Re-arm after React's development effect replay, without replaying motion.
    const timer = setTimeout(finishTransition, 650);
    return () => clearTimeout(timer);
  }, [motion]);
  useLayoutEffect(() => {
    const top = transitionViewportTop.current;
    if (!motion || top === undefined) return;
    let interrupted = false;
    const align = () => {
      // Measure the stationary stage, not the frame being scaled by animation.
      const bounds = region.current?.querySelector(".episode-stage")?.getBoundingClientRect();
      if (!interrupted && bounds && Math.abs(bounds.top - top) > 0.5)
        window.scrollBy({ top: bounds.top - top, behavior: "instant" });
    };
    const interrupt = () => {
      interrupted = true;
    };
    align();
    let frame = 0;
    const follow = () => {
      align();
      if (!interrupted) frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    window.addEventListener("wheel", interrupt, { passive: true });
    window.addEventListener("touchstart", interrupt, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("wheel", interrupt);
      window.removeEventListener("touchstart", interrupt);
    };
  }, [motion]);
  useLayoutEffect(() => {
    // Restore against the reserved player frame before the first paint. Reading
    // the intent after playback loads would expose the episode list briefly.
    if (loadedRequest.current?.slug === slug) return;
    try {
      const intent = parsePlaybackIntent(
        JSON.parse(sessionStorage.getItem(playbackIntentKey) ?? "null"),
        slug,
        initialEpisodeId,
      );
      const bounds = region.current?.querySelector(".episode-center")?.getBoundingClientRect();
      if (intent?.viewportTop !== undefined && bounds)
        window.scrollBy({ top: bounds.top - intent.viewportTop, behavior: "instant" });
    } catch {
      /* Navigation works without storage. */
    }
  }, [slug, initialEpisodeId]);
  useLayoutEffect(() => {
    if (loadedRequest.current?.slug === slug && loadedRequest.current.reload === reload) return;
    const controller = new AbortController();
    setError(false);
    setValidatingPolicy(false);
    setPlayback(null);
    setStarted(false);
    setSaved(false);
    setStart(initialTime ?? 0);
    setTime(initialTime ?? 0);
    function apply(result: Playback) {
      if (controller.signal.aborted) return;
      const requested = requestedRoute.current;
      loadedRequest.current = { slug, reload };
      explicitTime.current = requested.time;
      setPlayback(result);
      window.dispatchEvent(new Event("animesoul:episodes-updated"));
      let previous: { season?: string; episode?: string; choice?: string; episodeId?: string } = {};
      try {
        const value: unknown = JSON.parse(
          localStorage.getItem("animesoul:playback:" + result.animeId) ?? "{}",
        );
        if (typeof value === "object" && value !== null) previous = value;
      } catch {
        /* Storage can be unavailable. */
      }
      let intent = null;
      try {
        intent = consumePlaybackIntent(sessionStorage, slug, requested.episodeId);
      } catch {
        /* Optional transition continuity. */
      }
      const source = intent
        ? (result.sources.find(
            (s) => s.episodeId === intent.episodeId && s.translation === intent.translation,
          ) ?? choosePlaybackSource(result.sources, intent.episodeId, {}))
        : choosePlaybackSource(result.sources, requested.episodeId, previous);
      if (
        requested.episodeId &&
        !result.sources.some((item) => item.episodeId === requested.episodeId)
      ) {
        setSeason("");
        setEpisode("");
        setChoice("");
        return;
      }
      if (source) {
        selectionState.current = { episodeId: source.episodeId, choice: choiceKey(source) };
        localSelection.current = undefined;
        setSeason(source.season);
        setEpisode(source.episode);
        setChoice(choiceKey(source));
        setSaved(
          !intent && source.episode === previous.episode && source.season === previous.season,
        );
        if (intent) {
          setStarted(intent.autoplay);
          setStart(0);
          setTime(0);
          animateEntrance(intent);
        } else {
          setStart(requested.time ?? 0);
          setTime(requested.time ?? 0);
        }
      }
    }
    // Apply the prepared episode list before paint on a route remount. The
    // source page stays visible until the router commits this destination.
    const prepared = reload === 0 ? playbackClient.peek(slug) : undefined;
    if (prepared) apply(prepared);
    else
      playbackClient
        .get(slug, reload > 0)
        .then(apply)
        .catch(() => {
          if (!controller.signal.aborted) setError(true);
        });
    return () => controller.abort();
  }, [slug, reload]);
  useLayoutEffect(() => {
    const loaded = playbackState.current;
    if (!loaded || loadedRequest.current?.slug !== slug || loadedRequest.current.reload !== reload)
      return;
    let intent = null;
    try {
      intent = consumePlaybackIntent(sessionStorage, slug, initialEpisodeId);
    } catch {
      /* Optional storage. */
    }
    const action = playbackRouteAction(
      selectionState.current.episodeId,
      initialEpisodeId,
      explicitTime.current,
      initialTime,
    );
    if (intent || action === "episode") {
      const source = intent
        ? (loaded.sources.find(
            (s) => s.episodeId === intent.episodeId && s.translation === intent.translation,
          ) ?? choosePlaybackSource(loaded.sources, intent.episodeId, {}))
        : choosePlaybackSource(loaded.sources, initialEpisodeId, {
            choice: selectionState.current.choice,
          });
      selectionState.current = {
        episodeId: source?.episodeId,
        choice: source ? choiceKey(source) : "",
      };
      setSeason(source?.season ?? "");
      setEpisode(source?.episode ?? "");
      setChoice(source ? choiceKey(source) : "");
      setStarted(Boolean(source && intent?.autoplay));
      setStream(null);
      setSaved(false);
      setStart(intent ? 0 : (initialTime ?? 0));
      setTime(intent ? 0 : (initialTime ?? 0));
      if (source && intent) animateEntrance(intent);
    } else if (action === "time" && initialTime !== undefined) {
      setStarted(false);
      setStart(initialTime);
      setTime(initialTime);
    }
    if (!intent && waitingForRoute.current === initialEpisodeId && initialEpisodeId)
      finishTransition();
    localSelection.current = undefined;
    explicitTime.current = initialTime;
  }, [slug, reload, initialEpisodeId, initialTime]);
  const sources = playback?.sources ?? [];
  const seasons = ordered(sources.map((source) => source.season));
  const seasonSources = sources.filter((source) => source.season === season);
  const episodes = ordered(seasonSources.map((source) => source.episode));
  const episodeSources = seasonSources.filter((source) => source.episode === episode);
  const selected =
    episodeSources.find((source) => choiceKey(source) === choice) ?? episodeSources[0];
  selectedSource.current = selected;
  playbackState.current = playback;
  selectionState.current = { episodeId: selected?.episodeId, choice };
  useEffect(() => {
    // A new route can render once with the previous local selection. Only a
    // user selection may request another route; never echo stale state back.
    if (
      initialEpisodeId &&
      selected?.episodeId !== initialEpisodeId &&
      localSelection.current !== selected?.episodeId
    )
      return;
    if (selected?.episodeId && selected.episodeId === selectionState.current.episodeId)
      onSelectionChange?.({ season: selected.season, episodeId: selected.episodeId });
  }, [selected?.season, selected?.episodeId, initialEpisodeId, onSelectionChange]);
  const progress = usePlaybackProgress(
    playback?.animeId,
    selected?.episodeId,
    started || stream?.mode === "embed",
    selected?.translation ?? "",
  );
  const resume = progress.saved.find(
    (item) => item.episodeId === selected?.episodeId && !item.completed,
  );
  const playerPreferences = usePlayerPreferences(
    playback?.animeId,
    progress.account,
    progress.status !== "loading",
  );
  useEffect(() => {
    if (started || motion || !playback || !playerPreferences.ready || progress.status === "loading")
      return;
    const key =
      playback.animeId +
      ":" +
      (initialEpisodeId ?? "latest") +
      ":" +
      (progress.accountId ?? "guest");
    const continuing = playerPreferences.preferences.resume;
    const previous = initialEpisodeId
      ? progress.saved.find((item) => item.episodeId === initialEpisodeId && !item.completed)
      : continuing
        ? progress.saved.find((item) => !item.completed && item.position > 0)
        : undefined;
    const episodeId =
      localSelection.current ?? initialEpisodeId ?? previous?.episodeId ?? selected?.episodeId;
    const next = preferredDubbing(
      playback.sources.filter((item) => item.episodeId === episodeId),
      playerPreferences.preferences,
      playerPreferences.manual,
      continuing ? previous?.dubbing : "",
      selected,
    );
    if (next) {
      setSeason(next.season);
      setEpisode(next.episode);
      setChoice(choiceKey(next));
      const position =
        initialTime !== undefined && !resumeRequested
          ? initialTime
          : continuing
            ? (previous?.position ?? 0)
            : 0;
      if (restored.current !== key) {
        restored.current = key;
        setStart(position);
        setTime(position);
        setSaved(Boolean(previous));
      }
      if (
        resumedEntry.current !== key &&
        (resumeRequested || (!initialEpisodeId && previous && continuing))
      ) {
        resumedEntry.current = key;
        requestAnimationFrame(() =>
          region.current?.scrollIntoView({
            block: "start",
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "instant"
              : "smooth",
          }),
        );
        if (playerPreferences.preferences.autoplay) {
          setStart(position);
          setTime(position);
          setStarted(true);
        }
      }
    }
  }, [
    playback,
    progress.saved,
    progress.accountId,
    progress.status,
    started,
    motion,
    initialEpisodeId,
    initialTime,
    resumeRequested,
    playerPreferences.ready,
    playerPreferences.manual,
    playerPreferences.preferences,
  ]);
  useEffect(() => {
    setStream(null);
    if (
      !selected ||
      !subscription.ready ||
      !engineReady ||
      !playerPreferences.ready ||
      progress.status === "loading"
    )
      return;
    if (!wantsNative) {
      setStream({ mode: "embed" });
      setStreamFor(selected.id + playback?.revision);
      return;
    }
    const controller = new AbortController();
    fetch("/api/anime/" + encodeURIComponent(slug) + "/stream?source=" + selected.id, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return streamSchema.parse(await response.json());
      })
      .then((value) => {
        if (!controller.signal.aborted) {
          setStream(value);
          setStreamFor(selected.id + playback?.revision);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStream({ mode: "embed" });
          setStreamFor(selected.id + playback?.revision);
        }
      });
    return () => controller.abort();
  }, [
    slug,
    selected,
    wantsNative,
    subscription.ready,
    engineReady,
    playerPreferences.ready,
    progress.status === "loading",
    playback?.revision,
    streamRetry,
  ]);
  const choices = [
    ...new Map(episodeSources.map((source) => [choiceKey(source), source])).values(),
  ];
  async function refreshStream() {
    const source = selectedSource.current;
    const revision = playbackState.current?.revision;
    if (!source || !startedState.current || !nativeAllowed.current) return false;
    refreshRequest.current?.abort();
    const controller = new AbortController();
    refreshRequest.current = controller;
    try {
      const response = await fetch(
        "/api/anime/" + encodeURIComponent(slug) + "/stream?source=" + source.id,
        {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        },
      );
      if (!response.ok) throw new Error();
      const value = streamSchema.parse(await response.json());
      if (
        controller.signal.aborted ||
        selectedSource.current?.id !== source.id ||
        playbackState.current?.revision !== revision ||
        !nativeAllowed.current
      )
        return true;
      if (value.mode !== "direct") return false;
      setStream(value);
      setStreamFor(source.id + revision);
      return true;
    } catch {
      return controller.signal.aborted;
    }
  }
  function select(next: PlaybackSource | undefined) {
    if (!next) return;
    nativeAutoplay.current = true;
    localSelection.current = next.episodeId;
    if (selected?.episodeId !== next.episodeId || selected?.id !== next.id) {
      const previous = progress.saved.find(
        (item) => item.episodeId === next.episodeId && !item.completed,
      );
      const nextTime = selected?.episodeId === next.episodeId ? time : (previous?.position ?? 0);
      setStart(nextTime);
      setTime(nextTime);
    }
    setSeason(next.season);
    setEpisode(next.episode);
    setChoice(choiceKey(next));
    setSaved(false);
    if (playback)
      try {
        localStorage.setItem(
          "animesoul:playback:" + playback.animeId,
          JSON.stringify({
            season: next.season,
            episode: next.episode,
            episodeId: next.episodeId,
            choice: choiceKey(next),
          }),
        );
      } catch {
        /* Playback remains available without storage. */
      }
  }
  useEffect(() => {
    if (!seasonRequest || !playback) return;
    select(playback.sources.find((source) => source.season === seasonRequest.season));
  }, [seasonRequest?.revision, playback?.animeId]);
  useEffect(() => {
    if (!episodeRequest || !playback) return;
    select(choosePlaybackSource(playback.sources, episodeRequest.episodeId, { choice }));
  }, [episodeRequest?.revision, playback?.animeId]);
  const revision = playback?.revision;
  useEffect(() => {
    if (!revision) return;
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      let policyChanged = false;
      try {
        const response = await fetch("/api/playback/revision", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok) throw new Error();
        const policy = playbackRevisionSchema.parse(await response.json());
        if (policy.revision === revision || controller.signal.aborted) return;
        policyChanged = true;
        setValidatingPolicy(true);
        const wasStarted = startedState.current;
        setStarted(false);
        setStream(null);
        const result = await playbackClient.get(slug, true);
        if (controller.signal.aborted) return;
        const next = reconcilePlayback(result.sources, selectedSource.current);
        setStarted(next.keepPlaying && wasStarted);
        setPlayback(result);
        setValidatingPolicy(false);
        setError(false);
        if (next.selected) {
          setSeason(next.selected.season);
          setEpisode(next.selected.episode);
          setChoice(choiceKey(next.selected));
        }
      } catch {
        // A failed background check is retried next time. A confirmed policy
        // change still stops playback until the new policy can be validated.
        if (!controller.signal.aborted && policyChanged) {
          setStarted(false);
          setPlayback(null);
          setValidatingPolicy(false);
          setError(true);
        }
      } finally {
        pending = false;
      }
    }
    const timer = setInterval(() => void refresh(), 5000);
    const foreground = () => void refresh();
    document.addEventListener("visibilitychange", foreground);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [revision, slug]);
  const parts = franchise ? franchisePartOptions(franchise) : [];
  const currentPart = parts.find((part) => part.anime.slug === slug);
  function neighbor(direction: -1 | 1) {
    if (!selected) return null;
    // A catalog part already represents a season. Other provider season labels
    // can be alternate editions of this part, so the boundary leads to the next
    // enabled catalog part instead of replaying a different provider edition.
    const source = adjacentPlayback(seasonSources, selected, direction);
    if (source) return { part: currentPart, source, crossPart: false, number: source.episode };
    const part =
      franchise &&
      currentPart &&
      adjacentPart(
        franchise,
        currentPart.anime.id,
        allowedPartIds ?? parts.map((p) => p.anime.id),
        direction,
      );
    if (!part) return null;
    const available = [...part.episodes].sort(
      (a, b) =>
        a.season.localeCompare(b.season, "ru", { numeric: true }) ||
        a.number.localeCompare(b.number, "ru", { numeric: true }),
    );
    const episode = direction === 1 ? available[0] : available.at(-1);
    return {
      part: parts.find((p) => p.anime.id === part.anime.id),
      source: undefined,
      crossPart: true,
      number:
        episode?.number ??
        (direction === 1
          ? "1"
          : String(
              part.anime.details?.episodesAired || part.anime.details?.episodesTotal || "последняя",
            )),
    };
  }
  const previousEpisode = neighbor(-1),
    nextEpisode = neighbor(1);
  async function navigateEpisode(direction: -1 | 1) {
    const next = neighbor(direction);
    if (!next || !selected || transitionBusy.current) return;
    transitionBusy.current = true;
    setTransitionPending(true);
    setTransitionMessage("");
    const bounds = region.current?.querySelector(".episode-center")?.getBoundingClientRect();
    const side = region.current
      ?.querySelector(
        `.episode-preview.${direction === 1 ? "next" : "previous"} .episode-preview-visual`,
      )
      ?.getBoundingClientRect();
    const travel =
      bounds && side
        ? Math.min(
            1,
            Math.abs(side.left + side.width / 2 - bounds.left - bounds.width / 2) / bounds.width,
          )
        : 0.55;
    let source = next.source;
    let destinationPlayback = playback;
    try {
      if (next.crossPart && next.part) {
        neighborRequest.current?.abort();
        const controller = new AbortController();
        neighborRequest.current = controller;
        const playback = await playbackClient.get(next.part.anime.slug);
        destinationPlayback = playback;
        if (controller.signal.aborted) return;
        const sequence = playbackSequence(playback.sources, selected);
        source = direction === 1 ? sequence[0] : sequence.at(-1);
        if (playback.state !== "ready" || !source?.episodeId) throw new Error();
        if (progress.account) {
          try {
            const state = playerStateSchema.parse(
              await accountRequest("/api/account/player?animeId=" + playback.animeId),
            );
            source = preferredDubbing(
              playback.sources.filter((item) => item.episodeId === source?.episodeId),
              state.preferences,
              state.dubbing,
              "",
              source,
            );
          } catch {
            /* The selected available voice remains a valid fallback. */
          }
        } else {
          let manual = null;
          try {
            manual = localStorage.getItem("animesoul:guest-dubbing:" + playback.animeId);
          } catch {
            /* Optional. */
          }
          source = preferredDubbing(
            playback.sources.filter((item) => item.episodeId === source?.episodeId),
            playerPreferences.preferences,
            manual,
            "",
            source,
          );
        }
        if (controller.signal.aborted) return;
      }
      if (!source) throw new Error();
      const target = source;
      const targetSlug = next.crossPart && next.part ? next.part.anime.slug : slug;
      const intent: PlaybackIntent = {
        slug: targetSlug,
        episodeId: target.episodeId ?? "",
        translation: target.translation,
        direction,
        autoplay: true,
        createdAt: Date.now(),
        ...(bounds ? { viewportTop: bounds.top } : {}),
        ...(playback ? { fromAnimeId: playback.animeId } : {}),
        fromEpisode: selected.episode,
        travel,
      };
      if (target.episodeId && next.crossPart) {
        if (destinationPlayback) playbackClient.carry(targetSlug, destinationPlayback);
        try {
          sessionStorage.setItem(playbackIntentKey, JSON.stringify(intent));
          if (destinationPlayback)
            localStorage.setItem(
              "animesoul:playback:" + destinationPlayback.animeId,
              JSON.stringify({
                season: target.season,
                episode: target.episode,
                episodeId: target.episodeId,
                choice: choiceKey(target),
              }),
            );
        } catch {
          /* The destination season remains available without storage. */
        }
        // Keep the current player intact while the server prepares the route.
        // Only the committed destination runs the complete, bounded carousel swap.
        waitingForRoute.current = target.episodeId;
        const href = `/anime/${encodeURIComponent(targetSlug)}#anime-watch`;
        router.push(href, { scroll: false });
        transitionTimer.current = setTimeout(() => {
          finishTransition();
          setTransitionMessage("Не удалось переключить серию. Попробуйте ещё раз.");
        }, 15000);
      } else {
        select(target);
        setStart(0);
        setTime(0);
        setStarted(true);
        animateEntrance(intent);
      }
    } catch {
      if (neighborRequest.current?.signal.aborted) return;
      setTransitionMessage("Эта часть сейчас недоступна. Попробуйте ещё раз или выберите другую.");
      setTransitionPending(false);
      transitionBusy.current = false;
    }
  }
  function changePart(value: string) {
    if (transitionBusy.current) return;
    const next = parts.find((part) => part.anime.id === value);
    if (!next || next.anime.slug === slug) return;
    setStarted(false);
    router.push(next.href, { scroll: false });
  }
  const playerMenu: PlayerMenu = {
    ...(playerPreferences.manual ? { onResetDubbing: () => playerPreferences.choose(null) } : {}),
    preferences: {
      resume: playerPreferences.preferences.resume,
      autoplay: playerPreferences.preferences.autoplay,
      onChange: playerPreferences.edit,
      notice: playerPreferences.notice,
    },
    ...(partFilters ? { filters: partFilters } : {}),
    parts: parts
      .filter(
        (part) =>
          part.anime.id === currentPart?.anime.id ||
          !allowedPartIds ||
          allowedPartIds.includes(part.anime.id),
      )
      .map((part) => ({
        value: part.anime.id,
        label: `${part.label} · ${part.anime.title}`,
        ...(franchise
          ? { color: partTypes[partType(part.anime, mainStoryIds(franchise))].color }
          : {}),
      })),
    part: currentPart?.anime.id ?? "",
    onPartChange: changePart,
    ...(currentPart ? { contextLabel: `${currentPart.label} · Серия ${episode}` } : {}),
    seasons: seasons.map((value) => ({ value, label: seasonLabel(value) })),
    season,
    onSeasonChange: (value) => select(sources.find((source) => source.season === value)),
    episodes: episodes.map((value) => ({ value, label: `Серия ${value}` })),
    episode,
    onEpisodeChange: (value) =>
      select(
        seasonSources.find((source) => source.episode === value && choiceKey(source) === choice) ??
          seasonSources.find((source) => source.episode === value),
      ),
    dubbings: choices.map((source) => ({
      value: choiceKey(source),
      favorite: playerPreferences.preferences.favoriteDubbings.some(
        (name) => dubbingKey(name) === dubbingKey(source.translation),
      ),
      label:
        source.translation +
        (choices.filter((item) => item.translation === source.translation).length > 1
          ? ` · Вариант ${choices.filter((item) => item.translation === source.translation).findIndex((item) => item.variantId === source.variantId) + 1}`
          : ""),
    })),
    dubbing: selected ? choiceKey(selected) : "",
    onDubbingChange: (value) => {
      const next = episodeSources.find((source) => choiceKey(source) === value);
      if (next) {
        playerPreferences.choose(next.translation);
        select(next);
      }
    },
    onFavoriteDubbing: (value, enabled) => {
      const source = episodeSources.find((item) => choiceKey(item) === value);
      if (source) playerPreferences.favorite(source.translation, enabled);
    },
  };
  const ready = !validatingPolicy && playback?.state === "ready" && selected;
  const preparingVideo =
    !playerPreferences.ready ||
    progress.status === "loading" ||
    !subscription.ready ||
    !engineReady ||
    !stream ||
    streamFor !== `${selected?.id}${playback?.revision}`;
  function onTime(position: number, duration: number, playing: boolean, ended = false) {
    if (ended && transitionBusy.current) return;
    if (playing && duration > 0 && selected && playback && !transitionBusy.current)
      trackPlayerStart({
        animeId: playback.animeId,
        ...(selected.episodeId ? { episodeId: selected.episodeId } : {}),
        season: selected.season,
        episode: selected.episode,
        player:
          stream?.mode === "direct" && wantsNative
            ? "native"
            : new URL(selected.embedUrl).hostname.includes("yummy")
              ? "yummy"
              : "kodik",
      });
    playingState.current = playing;
    if (playing && !started) setStarted(true);
    setTime(position);
    progress.update(position, duration, playing, ended);
    if (ended && nextEpisode) void navigateEpisode(1);
  }
  function preview(next: ReturnType<typeof neighbor>, direction: -1 | 1) {
    if (!next) return null;
    const images = next.crossPart ? (next.part?.anime.details?.screenshots ?? []) : previewImages;
    const image = previewImage(images, next.number, next.part?.anime.poster);
    return (
      <button
        type="button"
        className={`episode-preview ${direction === 1 ? "next" : "previous"}`}
        aria-label={`${direction === 1 ? "Следующая" : "Предыдущая"} серия: ${next.part?.anime.title ?? title}, серия ${next.number}`}
        disabled={transitionPending}
        onClick={() => void navigateEpisode(direction)}
      >
        <span className="episode-preview-visual" aria-hidden="true">
          {image && <img src={image} alt="" loading="lazy" />}
        </span>
        <span className="episode-preview-arrow" aria-hidden="true">
          {direction === 1 ? "›" : "‹"}
        </span>
        <span className="episode-preview-copy">
          <small>{direction === 1 ? "Далее" : "Назад"}</small>
          <strong>{next.crossPart ? next.part?.anime.title : `Серия ${next.number}`}</strong>
          <span>
            {next.crossPart
              ? `${next.part?.label} · Серия ${next.number}`
              : (next.part?.label ?? title)}
          </span>
        </span>
      </button>
    );
  }
  return (
    <section ref={region} className="anime-playback" id="player" aria-label="Просмотр аниме">
      <div className="playback-heading">
        <h2>Смотреть {title}</h2>
        {selected && (
          <span>
            {seasons.length > 1 ? `${seasonLabel(season)} · ` : ""}
            серия {selected.episode}
          </span>
        )}
        {saved && <span>Последняя выбранная серия</span>}
      </div>
      <div className="player-engines" role="group" aria-label="Выбор плеера">
        <div className="player-engine-switch">
          <button
            className="player-engine-native"
            aria-pressed={comparisonOpen || (wantsNative && stream?.mode === "direct")}
            aria-expanded={!subscription.value?.nativeAccess ? comparisonOpen : undefined}
            onClick={() => {
              if (!subscription.value?.nativeAccess) {
                progress.pause();
                setComparisonOpen(true);
                return;
              }
              if (wantsNative && stream?.mode === "direct") return;
              nativeAutoplay.current = playingState.current;
              progress.pause();
              setStart(time);
              setEngine("native");
              setStreamRetry((value) => value + 1);
              try {
                sessionStorage.removeItem("animesoul:player-engine");
              } catch {
                /* Optional preference. */
              }
            }}
          >
            AnimeSoul <span>PLUS</span>
          </button>
          <button
            aria-pressed={!comparisonOpen && (!wantsNative || stream?.mode === "embed")}
            onClick={() => {
              setComparisonOpen(false);
              if (!wantsNative || stream?.mode === "embed") {
                setEngine("kodik");
              } else {
                nativeAutoplay.current = playingState.current;
                progress.pause();
                setStart(time);
                setEngine("kodik");
              }
              try {
                sessionStorage.setItem("animesoul:player-engine", "kodik");
              } catch {
                /* Optional preference. */
              }
            }}
          >
            Kodik
          </button>
        </div>
        {subscription.error ? (
          <p role="status">
            Не удалось проверить доступ.{" "}
            <button className="text-link" onClick={() => void subscription.refresh()}>
              Повторить
            </button>
          </p>
        ) : subscription.value?.source === "trial" && subscription.value.nativeAccess ? (
          <p>
            Пробный доступ до {new Date(subscription.value.expiresAt!).toLocaleDateString("ru")}
          </p>
        ) : null}
        {subscription.value?.nativeAccess &&
          engine !== "kodik" &&
          (stream?.mode === "embed" || !subscription.value.directEnabled) && (
            <p role="status">Для этой серии сейчас доступен Kodik.</p>
          )}
      </div>
      {subscription.value && !subscription.value.nativeAccess && !comparisonOpen && (
        <p className="player-plus-hint">
          <span className="player-plus-tag">PLUS</span>
          <span>
            В плеере AnimeSoul: Anime4K, качество без потери момента и все озвучки в одном меню.
          </span>
          <button type="button" onClick={() => setComparisonOpen(true)}>
            Сравнить плееры
          </button>
        </p>
      )}
      {comparisonOpen && (
        <PlayerComparison
          onTrial={() => {
            setComparisonOpen(false);
            setSubscriptionOpen(true);
          }}
          onStay={() => setComparisonOpen(false)}
        />
      )}
      <SubscriptionPreview
        open={subscriptionOpen}
        onClose={() => setSubscriptionOpen(false)}
        subscription={subscription}
      />
      {!ready ? (
        <div className="episode-stage" aria-busy={validatingPolicy || (!error && !playback)}>
          <div className="episode-center">
            <div className="playback-screen">
              <div className="playback-start" role={error ? "alert" : "status"}>
                <p>
                  {error
                    ? "Не удалось загрузить серии. Попробуй ещё раз."
                    : !playback || validatingPolicy
                      ? "Загружаем доступные серии…"
                      : playback.state === "disabled"
                        ? "Просмотр сейчас недоступен."
                        : playback.state === "unavailable"
                          ? "Не удалось загрузить видео. Попробуй позднее."
                          : "Для этого аниме пока нет доступных серий."}
                </p>
                {(error || playback) && (
                  <button className="outline" onClick={() => setReload((value) => value + 1)}>
                    {error ? "Повторить" : "Проверить снова"}
                  </button>
                )}
              </div>
              <PlayerLoadingHint
                loading={!error && (!playback || validatingPolicy)}
                progressStatus={progress.status}
              />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            className="episode-stage"
            data-motion={motion || undefined}
            aria-busy={transitionPending}
            style={
              transitionOrigin
                ? ({
                    "--episode-travel": `${transitionOrigin.travel * 100}%`,
                  } as CSSProperties)
                : undefined
            }
          >
            {preview(previousEpisode, -1)}
            {transitionOrigin && (
              <div className="episode-outgoing" aria-hidden="true">
                {transitionOrigin.image && <img src={transitionOrigin.image} alt="" />}
                <span>{transitionOrigin.caption}</span>
              </div>
            )}
            <div
              className="episode-center"
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget && motion) finishTransition();
              }}
            >
              <div className="player-frame-glow" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="playback-screen">
                {preparingVideo ? (
                  <div className="playback-start episode-preparing" role="status">
                    <img
                      src={previewImage(previewImages, selected.episode, currentPart?.anime.poster)}
                      alt=""
                    />
                    <span>Подготавливаем видео…</span>
                  </div>
                ) : stream?.mode === "direct" && wantsNative && started ? (
                  <NativePlayer
                    key={selected.id + playback.revision}
                    stream={stream}
                    start={start}
                    autoplay={nativeAutoplay.current}
                    title={title}
                    poster={previewImage(
                      previewImages,
                      selected.episode,
                      currentPart?.anime.poster,
                    )}
                    menu={playerMenu}
                    onTime={onTime}
                    onRefresh={refreshStream}
                    progressStatus={progress.status}
                    onFallback={() => {
                      setStart(time);
                      setStream({ mode: "embed" });
                      setStreamFor(selected.id + playback.revision);
                    }}
                  />
                ) : stream?.mode !== "direct" || !wantsNative ? (
                  <EmbeddedPlayer
                    key={selected.id + embedReset}
                    url={selected.embedUrl}
                    title={`${title} — серия ${selected.episode}, ${selected.translation}`}
                    start={start}
                    paused={subscriptionOpen || comparisonOpen}
                    autoplay={
                      started && nativeAutoplay.current && playerPreferences.preferences.autoplay
                    }
                    onTime={onTime}
                    progressStatus={progress.status}
                    onEpisode={(number, reportedSeason, reportedTranslation) => {
                      if (transitionBusy.current) return false;
                      const matches = sources.filter(
                        (item) =>
                          episodeLabel(item.episode) === episodeLabel(number) &&
                          episodeLabel(item.season) ===
                            episodeLabel(reportedSeason ?? selected.season) &&
                          (!reportedTranslation ||
                            dubbingKey(item.translation) === dubbingKey(reportedTranslation)),
                      );
                      if (matches.some((item) => item.id === selected.id)) {
                        unknownEmbedEvent.current = "";
                        return true;
                      }
                      const next =
                        matches.find((item) => item.variantId === selected.variantId) ?? matches[0];
                      if (next) {
                        progress.pause();
                        if (reportedTranslation) playerPreferences.choose(next.translation);
                        select(next);
                        if (
                          next.episodeId !== selected.episodeId ||
                          next.episode !== selected.episode
                        ) {
                          setStart(0);
                          setTime(0);
                        }
                      } else {
                        progress.pause();
                        setTransitionMessage(
                          "Этой серии или озвучки пока нет в списке. Выбери доступный вариант.",
                        );
                        const signature = `${selected.id}:${number}:${reportedSeason ?? ""}:${reportedTranslation ?? ""}`;
                        if (unknownEmbedEvent.current !== signature) {
                          unknownEmbedEvent.current = signature;
                          setEmbedReset((value) => value + 1);
                        }
                      }
                      return false;
                    }}
                  />
                ) : (
                  <div className="animesoul-player controls-visible">
                    <PlayerTopNavigation
                      title={title}
                      menu={playerMenu}
                      open={startPickerOpen}
                      onToggle={() => setStartPickerOpen((value) => !value)}
                    />
                    <div className="playback-start">
                      <p className="player-idle-caption">
                        {resume && initialTime === undefined && playerPreferences.preferences.resume
                          ? `Продолжить с ${Math.floor(resume.position / 60)}:${String(Math.floor(resume.position % 60)).padStart(2, "0")}`
                          : `Серия ${selected.episode} · ${selected.translation}`}
                      </p>
                      <button
                        className="animesoul-player-center-play"
                        aria-label={
                          resume &&
                          initialTime === undefined &&
                          playerPreferences.preferences.resume
                            ? `Продолжить с ${Math.floor(resume.position / 60)}:${String(Math.floor(resume.position % 60)).padStart(2, "0")}`
                            : "Смотреть"
                        }
                        disabled={!playerPreferences.ready}
                        onClick={() => {
                          select(selected);
                          const position =
                            initialTime !== undefined && selected.episodeId === initialEpisodeId
                              ? initialTime
                              : playerPreferences.preferences.resume
                                ? (resume?.position ?? 0)
                                : 0;
                          setStart(position);
                          setTime(position);
                          setStarted(true);
                        }}
                      >
                        ▶
                      </button>
                    </div>
                  </div>
                )}
                <PlayerLoadingHint loading={preparingVideo} progressStatus={progress.status} />
              </div>
            </div>
            {preview(nextEpisode, 1)}
            {transitionPending && !motion && (
              <div className="episode-transition-status" role="status">
                Открываем серию…
              </div>
            )}
          </div>
          {transitionMessage && (
            <p className="playback-hint" role="alert">
              {transitionMessage}
            </p>
          )}
        </>
      )}
    </section>
  );
}
