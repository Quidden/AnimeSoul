"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { Anime, ApiStatus, ConfigProfile, PlayerPrefs, SaveStatus, Theme } from "../lib/types";
import { readLocal as read } from "../lib/storage";
import { fetchGDriveAuthUrl, fetchGDriveStatus, syncGDrive, type GDriveStatus } from "../lib/gdrive";
import { SettingsCenter } from "./SettingsCenter";
import { recordDebugEvent } from "../lib/debugLog";
import { emitAppEvent, listenAppEvent } from "../lib/events";
import {
  searchSettings,
  SETTINGS_TABS,
  type SettingsSearchResult,
} from "../features/settings/settingsCatalog";
import { IS_ANDROID_APP } from "../lib/platform";

type HeaderProps = {
  query: string;
  setQuery: (value: string) => void;
  onSearch: () => void;
  onHome: () => void;
  onCatalog: () => void;
  onLibrary: () => void;
  onRatings: () => void;
  onDownloads: () => void;
  theme?: Theme;
  setTheme?: (theme: Theme) => void;
  playerPrefs?: PlayerPrefs;
  setPlayerPrefs?: (prefs: PlayerPrefs) => void;
  historyEnabled?: boolean;
  onHistoryEnabledChange?: (enabled: boolean) => void;
  compact?: boolean;
  suggestions?: Anime[];
  onSuggestion?: (anime: Anime) => void;
  profiles?: ConfigProfile[];
  activeProfile?: string;
  onSwitchProfile?: (id: string) => void;
  onExport?: () => void;
  onImport?: (file: File) => void;
  onStorageReload?: () => void;
  activeView: "home" | "catalog" | "stats" | "ratings" | "downloads";
};

type NavigationIcon = "home" | "catalog" | "downloads" | "stats" | "ratings" | "search" | "settings";

function NavIcon({ name }: { name: NavigationIcon }) {
  const paths: Record<NavigationIcon, ReactNode> = {
    home: <><path d="M3.5 10.5 12 3l8.5 7.5" /><path d="M5.5 9.5V21h13V9.5M9 21v-6h6v6" /></>,
    catalog: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    downloads: <><path d="M12 3v11" /><path d="m7.5 10 4.5 4.5 4.5-4.5" /><path d="M4 17.5V21h16v-3.5" /></>,
    stats: <><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7" /></>,
    ratings: <path d="m12 3 2.65 5.37 5.93.86-4.29 4.18 1.01 5.91L12 16.53l-5.3 2.79 1.01-5.91-4.29-4.18 5.93-.86L12 3Z" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.07A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.53-1H3v-4h.07A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.53V3h4v.07A1.7 1.7 0 0 0 15.06 4.6a1.7 1.7 0 0 0 1.88-.34L17 4.2 19.8 7l-.06.06A1.7 1.7 0 0 0 19.4 9c.24.58.8.97 1.43 1H21v4h-.07c-.63.03-1.19.42-1.53 1Z" /></>,
  };

  return (
    <span className={`nav-icon nav-icon-${name}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">{paths[name]}</svg>
    </span>
  );
}

type NetworkInformation = {
  downlink?: number;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

type StatusNotice = {
  tone: "loading" | "success" | "error";
  text: string;
};

export function Header({
  query,
  setQuery,
  onSearch,
  onHome,
  onCatalog,
  onLibrary,
  onRatings,
  onDownloads,
  theme,
  setTheme,
  playerPrefs,
  setPlayerPrefs,
  historyEnabled = true,
  onHistoryEnabledChange,
  compact = false,
  suggestions = [],
  onSuggestion,
  profiles = [],
  activeProfile = "default",
  onSwitchProfile,
  onExport,
  onImport,
  onStorageReload,
  activeView,
}: HeaderProps) {
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [diskStatus, setDiskStatus] = useState<SaveStatus>({ state: "loading" });
  const [apiStatus, setApiStatus] = useState<ApiStatus>({ state: "idle" });
  const [kodikApiStatus, setKodikApiStatus] = useState<ApiStatus>({ state: "idle" });
  const [partyPing, setPartyPing] = useState<{ state: "idle" | "connected" | "error"; ms?: number; roomId?: string }>({ state: "idle" });
  const [statusNotice, setStatusNotice] = useState<StatusNotice | null>(null);
  const [mobileSearchVisible, setMobileSearchVisible] = useState(true);
  const statusNoticeTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mobileSwipeStartY = useRef<number | null>(null);
  const settingsAvailable = Boolean(
    !compact && theme && setTheme && playerPrefs && setPlayerPrefs && onHistoryEnabledChange,
  );
  const settingsSuggestions = useMemo(() => (
    settingsAvailable
      ? searchSettings(query, { includeParty: !IS_ANDROID_APP, limit: 4 })
      : []
  ), [query, settingsAvailable]);
  const hasSuggestions = suggestions.length > 0 || settingsSuggestions.length > 0;

  useEffect(() => {
    if (!IS_ANDROID_APP || !mobileSearchVisible || suggestionsOpen || query.trim()) return;
    const timer = window.setTimeout(() => setMobileSearchVisible(false), 4_800);
    return () => window.clearTimeout(timer);
  }, [mobileSearchVisible, suggestionsOpen, query]);

  useEffect(() => {
    if (!IS_ANDROID_APP) return;
    const touchStart = (event: TouchEvent) => {
      mobileSwipeStartY.current = event.touches[0]?.clientY ?? null;
    };
    const touchEnd = (event: TouchEvent) => {
      const start = mobileSwipeStartY.current;
      const end = event.changedTouches[0]?.clientY;
      mobileSwipeStartY.current = null;
      if (start === null || end === undefined || start - end < 46) return;
      setMobileSearchVisible(true);
    };
    window.addEventListener("touchstart", touchStart, { passive: true });
    window.addEventListener("touchend", touchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", touchStart);
      window.removeEventListener("touchend", touchEnd);
    };
  }, []);

  const closeSearchSuggestions = () => {
    setSuggestionsOpen(false);
    searchInputRef.current?.blur();
  };

  const moveSuggestionFocus = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const options = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const current = options.indexOf(event.currentTarget);
    const next = event.key === "ArrowDown" ? current + 1 : current - 1;
    if (options[next]) options[next].focus();
    else if (event.key === "ArrowUp") searchInputRef.current?.focus();
  };

  const openSettingsSuggestion = (setting: SettingsSearchResult) => {
    closeSearchSuggestions();
    emitAppEvent("open-settings", {
      tab: setting.tab,
      targetTitle: setting.kind === "setting" ? setting.title : undefined,
    });
  };

  const submitGlobalSearch = () => {
    if (suggestions.length === 0 && settingsSuggestions[0]) {
      openSettingsSuggestion(settingsSuggestions[0]);
      return;
    }
    closeSearchSuggestions();
    onSearch();
  };

  const showStatusNotice = (notice: StatusNotice) => {
    setStatusNotice(notice);
    if (statusNoticeTimerRef.current) window.clearTimeout(statusNoticeTimerRef.current);
    statusNoticeTimerRef.current = window.setTimeout(() => setStatusNotice(null), 2_800);
  };

  useEffect(() => {
    setDiskStatus(read("animesoul:save-status", { state: "loading" }));
    setApiStatus(read("animesoul:api-status", { state: "idle" }));
    setKodikApiStatus(read("animesoul:kodik-api-status", { state: "idle" }));
    const diskListener = (next: SaveStatus) => {
      setDiskStatus(next);
      recordDebugEvent(next.state === "error" ? "error" : next.state === "saved" ? "success" : "info", "Сохранение", next.state, next.state === "error" ? "Локальное сохранение завершилось с ошибкой" : `Статус локального сохранения: ${next.state}`, undefined, { functionName: "diskListener", file: "src/components/Header.tsx" });
      if (next.state === "saving") showStatusNotice({ tone: "loading", text: "Сохраняем на ПК…" });
      if (next.state === "saved") showStatusNotice({ tone: "success", text: "Сохранено на ПК" });
      if (next.state === "error") showStatusNotice({ tone: "error", text: "Не удалось сохранить на ПК" });
    };
    const apiListener = (next: ApiStatus) => {
      setApiStatus(current => ({ ...current, ...next }));
      recordDebugEvent(next.state === "error" ? "error" : next.state === "updated" ? "success" : "info", "YummyAnime API", next.state, next.state === "error" ? "YummyAnime API временно недоступен — используется резерв Kodik" : `Статус YummyAnime API: ${next.state}`, undefined, { functionName: "apiListener", file: "src/components/Header.tsx" });
      if (next.state === "updating") showStatusNotice({ tone: "loading", text: "Обновляем данные каталога…" });
      if (next.state === "error") showStatusNotice({ tone: "error", text: "YummyAnime API недоступен — проверяем резерв Kodik" });
    };
    const kodikApiListener = (next: ApiStatus) => {
      setKodikApiStatus(current => ({ ...current, ...next }));
      recordDebugEvent(next.state === "error" ? "error" : next.state === "updated" ? "success" : "info", "Kodik API", next.state, next.state === "error" ? "Kodik временно недоступен — используется резерв YummyAnime" : `Статус Kodik API: ${next.state}`, undefined, { functionName: "kodikApiListener", file: "src/components/Header.tsx" });
    };
    const pingListener = (next: { state: "idle" | "connected" | "error"; ms?: number; roomId?: string }) => {
      setPartyPing(next);
      if (next.state !== "idle") recordDebugEvent(next.state === "error" ? "error" : "success", "Совместный просмотр", "Связь с комнатой", next.state === "connected" ? `Пинг: ${next.ms ?? "—"} мс` : "Нет связи с сервером комнаты", undefined, { functionName: "pingListener", file: "src/components/Header.tsx" });
      if (next.state === "error") showStatusNotice({ tone: "error", text: "Нет связи с комнатой" });
    };
    const stopSaveStatus = listenAppEvent("save-status", diskListener);
    const stopApiStatus = listenAppEvent("api-status", apiListener);
    const stopKodikApiStatus = listenAppEvent("kodik-api-status", kodikApiListener);
    const stopPartyPing = listenAppEvent("party-ping", pingListener);
    return () => {
      stopSaveStatus();
      stopApiStatus();
      stopKodikApiStatus();
      stopPartyPing();
      if (statusNoticeTimerRef.current) window.clearTimeout(statusNoticeTimerRef.current);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
    const readDownlink = () => {
      const value = connection?.downlink;
      return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
    };
    const measureYummy = async () => {
      const startedAt = performance.now();
      try {
        const response = await fetch("/api/yummy?mode=ping&silent=1", { cache: "no-store" });
        if (!response.ok) throw new Error("ping");
        if (!cancelled) setApiStatus(current => ({
          ...current,
          state: "updated",
          at: Date.now(),
          pingMs: Math.max(1, Math.round(performance.now() - startedAt)),
          downlinkMbps: readDownlink(),
        }));
      } catch {
        if (!cancelled) setApiStatus(current => ({ ...current, state: "error", pingMs: undefined, downlinkMbps: readDownlink() }));
      }
    };
    const measureKodik = async () => {
      const startedAt = performance.now();
      try {
        const response = await fetch("/api/kodik?mode=ping&silent=1", { cache: "no-store" });
        if (!response.ok) throw new Error("ping");
        if (!cancelled) setKodikApiStatus(current => ({
          ...current,
          state: "updated",
          at: Date.now(),
          pingMs: Math.max(1, Math.round(performance.now() - startedAt)),
        }));
      } catch {
        if (!cancelled) setKodikApiStatus(current => ({ ...current, state: "error", pingMs: undefined }));
      }
    };
    const measure = () => {
      void measureYummy();
      void measureKodik();
    };
    const updateDownlink = () => setApiStatus(current => ({ ...current, downlinkMbps: readDownlink() }));
    measure();
    const timer = window.setInterval(measure, 30_000);
    connection?.addEventListener?.("change", updateDownlink);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      connection?.removeEventListener?.("change", updateDownlink);
    };
  }, []);
  const [gdriveStatus, setGDriveStatus] = useState<GDriveStatus | null>(null);
  const [gdriveSyncing, setGDriveSyncing] = useState(false);
  const [gdriveError, setGDriveError] = useState<string>("");
  const cloudStatusLoadedRef = useRef(false);
  const lastCloudSyncRef = useRef(0);
  const cloudLifecycleSyncRef = useRef(false);
  const cloudLifecycleSyncAtRef = useRef(0);
  const cloudBackendSyncRunningRef = useRef(false);
  const initialCloudMergeRef = useRef(false);
  const onStorageReloadRef = useRef(onStorageReload);

  cloudBackendSyncRunningRef.current = Boolean(gdriveStatus?.sync_running);

  useEffect(() => {
    onStorageReloadRef.current = onStorageReload;
  }, [onStorageReload]);

  const refreshGDriveStatus = async () => {
    try {
      const status = await fetchGDriveStatus();
      setGDriveStatus(status);
    } catch {
      setGDriveStatus(null);
    }
  };

  useEffect(() => {
    refreshGDriveStatus();
    const timer = setInterval(refreshGDriveStatus, 2_500);
    const handleMsg = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "GDRIVE_AUTH_SUCCESS") {
        refreshGDriveStatus();
      }
    };
    window.addEventListener("message", handleMsg);
    return () => {
      clearInterval(timer);
      window.removeEventListener("message", handleMsg);
    };
  }, []);

  useEffect(() => {
    const syncedAt = Number(gdriveStatus?.last_sync_at || 0);
    if (!cloudStatusLoadedRef.current) {
      cloudStatusLoadedRef.current = true;
      lastCloudSyncRef.current = syncedAt;
      return;
    }
    if (syncedAt <= lastCloudSyncRef.current) return;
    lastCloudSyncRef.current = syncedAt;
    // A background Drive merge can replace the file behind React's in-memory
    // snapshot. Re-read it as soon as the backend confirms completion so the
    // home screen and resume button cannot stay on the previous device's item.
    void onStorageReloadRef.current?.();
    const time = new Date(syncedAt * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    showStatusNotice({ tone: "success", text: `Облако сохранено · ${time}` });
  }, [gdriveStatus?.last_sync_at]);

  useEffect(() => {
    if (!gdriveStatus?.connected) {
      initialCloudMergeRef.current = false;
      return;
    }
    if (gdriveStatus.choice_pending) return;
    const autoMode = read<"instant" | "interval" | "manual">("animesoul:gdrive-auto-sync-mode", "instant");
    if (autoMode === "manual") return;

    let cancelled = false;
    const mergeCloudState = async () => {
      const now = Date.now();
      if (
        cancelled
        || cloudLifecycleSyncRef.current
        || now - cloudLifecycleSyncAtRef.current < 15_000
      ) return;

      cloudLifecycleSyncAtRef.current = now;
      // A storage autosave already performs the same merge. Let it finish and
      // rely on last_sync_at above to refresh the UI instead of racing it with
      // a second explicit request.
      if (cloudBackendSyncRunningRef.current) return;

      cloudLifecycleSyncRef.current = true;
      setGDriveSyncing(true);
      setGDriveError("");
      try {
        const folderMode = read("animesoul:gdrive-folder-mode", "visible");
        const preferWatched = read("animesoul:gdrive-prefer-watched", true);
        await syncGDrive("merge", preferWatched, folderMode);
        if (cancelled) return;
        await onStorageReloadRef.current?.();
        await refreshGDriveStatus();
      } catch (error: unknown) {
        if (!cancelled) {
          setGDriveError(error instanceof Error ? error.message : "Ошибка синхронизации");
        }
      } finally {
        cloudLifecycleSyncRef.current = false;
        if (!cancelled) setGDriveSyncing(false);
      }
    };

    if (!initialCloudMergeRef.current) {
      initialCloudMergeRef.current = true;
      void mergeCloudState();
    }
    const handleForeground = () => {
      if (document.visibilityState === "visible") void mergeCloudState();
    };
    window.addEventListener("focus", handleForeground);
    document.addEventListener("visibilitychange", handleForeground);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleForeground);
      document.removeEventListener("visibilitychange", handleForeground);
    };
  }, [gdriveStatus?.connected, gdriveStatus?.choice_pending]);

  useEffect(() => {
    if (!gdriveStatus?.connected) return;

    const runIntervalSync = async () => {
      const mode = read<"instant" | "interval" | "manual">("animesoul:gdrive-auto-sync-mode", "instant");
      if (mode !== "interval") return;

      const folderMode = read("animesoul:gdrive-folder-mode", "visible");
      const preferWatched = read("animesoul:gdrive-prefer-watched", true);

      try {
        setGDriveSyncing(true);
        showStatusNotice({ tone: "loading", text: "Сохраняем в облако…" });
        await syncGDrive("merge", preferWatched, folderMode);
        onStorageReload?.();
        await refreshGDriveStatus();
      } catch {
        showStatusNotice({ tone: "error", text: "Не удалось сохранить в облако" });
      } finally {
        setGDriveSyncing(false);
      }
    };

    const minutes = read("animesoul:gdrive-auto-sync-interval", 15);
    const timer = setInterval(runIntervalSync, Math.max(1, minutes) * 60 * 1000);
    return () => clearInterval(timer);
  }, [gdriveStatus?.connected]);

  const needsChoice = Boolean(
    gdriveStatus?.connected &&
    (gdriveStatus.choice_pending ||
      (gdriveStatus.has_cloud_file && !read<boolean>("animesoul:gdrive-initial-choice-done", false)))
  );

  const handleGDriveClick = async () => {
    if (gdriveSyncing) return;

    if (!gdriveStatus?.connected) {
      try {
        const { url } = await fetchGDriveAuthUrl();
        window.open(url, "gdrive_auth", "width=600,height=700");
      } catch (err: any) {
        alert(err?.message || "Ошибка получения ссылки авторизации Google");
      }
      return;
    }

    if (needsChoice) {
      emitAppEvent("open-gdrive-choice");
      return;
    }

    setGDriveSyncing(true);
    setGDriveError("");
    showStatusNotice({ tone: "loading", text: "Сохраняем в облако…" });
    try {
      const folderMode = read("animesoul:gdrive-folder-mode", "visible");
      const preferWatched = read("animesoul:gdrive-prefer-watched", true);
      await syncGDrive("merge", preferWatched, folderMode);
      onStorageReload?.();
      await refreshGDriveStatus();
    } catch (err: any) {
      setGDriveError(err?.message || "Ошибка синхронизации");
      showStatusNotice({ tone: "error", text: "Не удалось сохранить в облако" });
    } finally {
      setGDriveSyncing(false);
    }
  };

  const statusText = diskStatus.state === "saving" ? "ПК · Сохраняем…" : diskStatus.state === "saved" ? `ПК · Сохранено${diskStatus.at ? ` ${new Date(diskStatus.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : ""}` : diskStatus.state === "error" ? "ПК · Только браузер" : "ПК · Подключаем…";
  const apiText = apiStatus.state === "updating" ? "Обновляем YummyAnime API…" : apiStatus.state === "updated" ? `YummyAnime API доступен${apiStatus.at ? ` · ${new Date(apiStatus.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : ""}` : apiStatus.state === "error" ? "YummyAnime API недоступен — данные берутся из Kodik" : "YummyAnime API ожидает";
  const apiDiagnostics = `${apiStatus.pingMs ? `${apiStatus.pingMs} мс` : "пинг —"} · ${apiStatus.downlinkMbps ? `≈ ${apiStatus.downlinkMbps.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} Мбит/с` : "скорость —"}`;
  const kodikApiText = kodikApiStatus.state === "updating" ? "Обновляем Kodik API…" : kodikApiStatus.state === "updated" ? `Kodik API доступен${kodikApiStatus.at ? ` · ${new Date(kodikApiStatus.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : ""}` : kodikApiStatus.state === "error" ? "Kodik API недоступен или публичный ключ не настроен — данные берутся из YummyAnime" : "Kodik API ожидает";
  const kodikApiDiagnostics = kodikApiStatus.pingMs ? `${kodikApiStatus.pingMs} мс` : kodikApiStatus.state === "error" ? "недоступен" : "пинг —";

  const cloudAutoMode = read<"instant" | "interval" | "manual">("animesoul:gdrive-auto-sync-mode", "instant");
  const cloudLastSyncMs = Number(gdriveStatus?.last_sync_at || 0) * 1000;
  const cloudSyncing = gdriveSyncing || gdriveStatus?.sync_state === "syncing";
  const cloudError = gdriveError || gdriveStatus?.last_sync_error || "";
  const cloudHasLocalChanges = Boolean(
    gdriveStatus?.connected &&
    diskStatus.state === "saved" &&
    diskStatus.at &&
    cloudLastSyncMs + 250 < diskStatus.at
  );
  const cloudIndicatorState = cloudSyncing
    ? "saving"
    : cloudError || needsChoice
    ? "error"
    : gdriveStatus?.connected && !cloudHasLocalChanges && cloudLastSyncMs
    ? "saved"
    : "idle";
  const cloudTime = cloudLastSyncMs
    ? new Date(cloudLastSyncMs).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : "";
  const cloudLabel = cloudSyncing
    ? "Облако · Сохраняем…"
    : needsChoice
    ? "Облако · Требуется выбор"
    : cloudError
    ? "Облако · Ошибка"
    : !gdriveStatus?.connected
    ? "Облако · Не подключено"
    : cloudHasLocalChanges && cloudAutoMode === "instant"
    ? "Облако · В очереди…"
    : cloudHasLocalChanges && cloudAutoMode === "interval"
    ? "Облако · Ждёт синхронизации"
    : cloudHasLocalChanges
    ? "Облако · Есть изменения"
    : cloudTime
    ? `Облако · Сохранено ${cloudTime}`
    : "Облако · Готово";

  const navigateFromBottomBar = (navigate: () => void) => {
    emitAppEvent("close-settings");
    navigate();
  };

  return <header className={`app-header${IS_ANDROID_APP && !mobileSearchVisible ? " search-hidden" : ""}`}>
    <Brand onClick={onHome} />
    <nav className="app-navigation" aria-label="Основная навигация">
      <button
        type="button"
        className={`mobile-nav-only${activeView === "home" ? " is-active" : ""}`}
        aria-label="Главная"
        aria-current={activeView === "home" ? "page" : undefined}
        onClick={() => navigateFromBottomBar(onHome)}
      >
        <NavIcon name="home" /><span className="nav-label" data-mobile-label="Главная" aria-hidden="true">Главная</span>
      </button>
      <button
        type="button"
        className={activeView === "catalog" ? "is-active" : undefined}
        aria-label="Каталог"
        aria-current={activeView === "catalog" ? "page" : undefined}
        onClick={() => navigateFromBottomBar(onCatalog)}
      >
        <NavIcon name="catalog" /><span className="nav-label" data-mobile-label="Каталог" aria-hidden="true">Каталог</span>
      </button>
      <button
        type="button"
        className={activeView === "downloads" ? "is-active" : undefined}
        aria-label="Скачанные"
        aria-current={activeView === "downloads" ? "page" : undefined}
        onClick={() => navigateFromBottomBar(onDownloads)}
      >
        <NavIcon name="downloads" /><span className="nav-label" data-mobile-label="Скачано" aria-hidden="true">Скачанные</span>
      </button>
      <button
        type="button"
        className={activeView === "stats" ? "is-active" : undefined}
        aria-label="Статистика"
        aria-current={activeView === "stats" ? "page" : undefined}
        onClick={() => navigateFromBottomBar(onLibrary)}
      >
        <NavIcon name="stats" /><span className="nav-label" data-mobile-label="Стат." aria-hidden="true">Статистика</span>
      </button>
      <button
        type="button"
        className={activeView === "ratings" ? "is-active" : undefined}
        aria-label="Оценки"
        aria-current={activeView === "ratings" ? "page" : undefined}
        onClick={() => navigateFromBottomBar(onRatings)}
      >
        <NavIcon name="ratings" /><span className="nav-label" data-mobile-label="Оценки" aria-hidden="true">Оценки</span>
      </button>
      {!compact && theme && setTheme && playerPrefs && setPlayerPrefs && onHistoryEnabledChange &&
        <span className="navigation-settings-slot">
          <SettingsCenter
            theme={theme}
            setTheme={setTheme}
            playerPrefs={playerPrefs}
            setPlayerPrefs={setPlayerPrefs}
            historyEnabled={historyEnabled}
            onHistoryEnabledChange={onHistoryEnabledChange}
            profiles={profiles}
            activeProfile={activeProfile}
            onSwitchProfile={onSwitchProfile}
            onExport={onExport}
            onImport={onImport}
            onStorageReload={onStorageReload}
          />
        </span>}
    </nav>
    {!compact && <div className="search-wrap" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setSuggestionsOpen(false);
    }}>
      <form className="header-search" onSubmit={event => { event.preventDefault(); submitGlobalSearch(); }}>
        <input ref={searchInputRef} value={query} onFocus={() => { setMobileSearchVisible(true); setSuggestionsOpen(true); }}
          role="combobox" aria-label="Поиск аниме и настроек" aria-autocomplete="list"
          aria-expanded={suggestionsOpen && hasSuggestions}
          aria-controls="header-search-suggestions" autoComplete="off"
          onKeyDown={event => {
            if (event.key === "Escape") closeSearchSuggestions();
            if (event.key === "ArrowDown") {
              const firstSuggestion = document.querySelector<HTMLButtonElement>("#header-search-suggestions button");
              if (firstSuggestion) {
                event.preventDefault();
                firstSuggestion.focus();
              }
            }
          }}
          onChange={event => { setMobileSearchVisible(true); setSuggestionsOpen(true); setQuery(event.target.value); }}
          placeholder="Аниме или настройка…" />
        <button type="submit" aria-label="Найти"><NavIcon name="search" /></button>
      </form>
      {suggestionsOpen && hasSuggestions && <div className="suggestions" id="header-search-suggestions" role="listbox" aria-label="Подсказки поиска">{suggestions.map(anime =>
        <button type="button" role="option" aria-selected="false" key={`anime-${anime.anime_id}`}
          onKeyDown={moveSuggestionFocus}
          onClick={() => { closeSearchSuggestions(); onSuggestion?.(anime); }}>
          {anime.poster?.big && <img src={anime.poster.big} alt="" />}
          <span>{anime.title}<small>{anime.year} · ★ {anime.rating?.average?.toFixed(1)}</small></span>
        </button>,
      )}{settingsSuggestions.map(setting => {
        const tab = SETTINGS_TABS.find(item => item.id === setting.tab);
        return <button
          type="button"
          role="option"
          aria-selected="false"
          className="setting-suggestion"
          key={`setting-${setting.id}`}
          onKeyDown={moveSuggestionFocus}
          onClick={() => openSettingsSuggestion(setting)}
        >
          <NavIcon name="settings" />
          <span className="suggestion-copy">
            <em>Настройка · {tab?.label ?? setting.tab}</em>
            {setting.title}
            <small>{setting.description}</small>
          </span>
        </button>;
      })}</div>}
    </div>}
    <div className="header-actions">
      <div className="header-statuses">
        {statusNotice && <div className={`status-popover ${statusNotice.tone}`} role="status" aria-live="polite"><i />{statusNotice.text}</div>}
        {partyPing.state !== "idle" && <div className={`save-indicator party-${partyPing.state}`} title={partyPing.state === "connected" ? `Задержка обмена с комнатой ${partyPing.roomId ?? ""}` : "Нет связи с сервером совместного просмотра"}><i />{partyPing.state === "connected" ? `Комната · ${partyPing.ms ?? "—"} мс` : "Комната недоступна"}</div>}
        <div className={`save-indicator ${apiStatus.state}`} title={`${apiText}. Пинг измеряется лёгким запросом раз в 30 секунд. Скорость — пассивная оценка браузера без отдельного speed-test.`}><i />Yummy · {apiDiagnostics}</div>
        <div className={`save-indicator ${kodikApiStatus.state}`} title={`${kodikApiText}. Пинг измеряется отдельным лёгким запросом раз в 30 секунд.`}><i />Kodik · {kodikApiDiagnostics}</div>
        <div className={`save-indicator ${diskStatus.state}`} title={diskStatus.state === "error" ? "Запусти AnimeSoul через батник, чтобы сохранять данные на диск" : "Автоматическое сохранение активного профиля на ПК"}><i />{statusText}</div>
        <button
          type="button"
          className={`save-indicator ${cloudIndicatorState}`}
          onClick={handleGDriveClick}
          aria-live="polite"
          aria-label={cloudLabel}
          title={
            cloudSyncing
              ? "Изменения загружаются в Google Drive…"
              : needsChoice
              ? "Нажмите, чтобы выбрать, какие настройки и сохранения использовать из облака"
              : cloudError
              ? `Ошибка облачного сохранения: ${cloudError}. Нажмите, чтобы повторить.`
              : gdriveStatus?.connected
              ? `${cloudLabel}. Аккаунт: ${gdriveStatus.user_email || "Google Drive"}. Нажмите для немедленной синхронизации.`
              : "Облачная копия не настроена. Нажмите, чтобы подключить Google Drive."
          }
        >
          <i />
          {cloudLabel}
        </button>
      </div>
    </div>
  </header>;
}

export function Brand({ onClick }: { onClick?: () => void }) {
  const activate = onClick ?? (() => window.scrollTo({ top: 0, behavior: "smooth" }));
  return <button type="button" className="brand" onClick={activate} aria-label="На главную">
    <img src="/animesoul-icon.png" alt="" aria-hidden="true" />
    AnimeSoul
  </button>;
}
