"use client";

import { useEffect, useRef, useState } from "react";
import type { Anime, ApiStatus, ConfigProfile, PlayerPrefs, SaveStatus, Theme } from "../lib/types";
import { readLocal as read } from "../lib/storage";
import { fetchGDriveAuthUrl, fetchGDriveStatus, syncGDrive, type GDriveStatus } from "../lib/gdrive";
import { SettingsCenter } from "./SettingsCenter";
import { ChangelogButton } from "./ChangelogModal";
import { recordDebugEvent } from "../lib/debugLog";
import { emitAppEvent, listenAppEvent } from "../lib/events";

type HeaderProps = {
  query: string;
  setQuery: (value: string) => void;
  onSearch: () => void;
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
};

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
}: HeaderProps) {
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [diskStatus, setDiskStatus] = useState<SaveStatus>({ state: "loading" });
  const [apiStatus, setApiStatus] = useState<ApiStatus>({ state: "idle" });
  const [kodikApiStatus, setKodikApiStatus] = useState<ApiStatus>({ state: "idle" });
  const [partyPing, setPartyPing] = useState<{ state: "idle" | "connected" | "error"; ms?: number; roomId?: string }>({ state: "idle" });
  const [statusNotice, setStatusNotice] = useState<StatusNotice | null>(null);
  const statusNoticeTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const closeSearchSuggestions = () => {
    setSuggestionsOpen(false);
    searchInputRef.current?.blur();
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
      recordDebugEvent(next.state === "error" ? "error" : next.state === "saved" ? "success" : "info", "Сохранение", next.state, next.state === "error" ? "Локальное сохранение завершилось с ошибкой" : `Статус локального сохранения: ${next.state}`);
      if (next.state === "saving") showStatusNotice({ tone: "loading", text: "Сохраняем на ПК…" });
      if (next.state === "saved") showStatusNotice({ tone: "success", text: "Сохранено на ПК" });
      if (next.state === "error") showStatusNotice({ tone: "error", text: "Не удалось сохранить на ПК" });
    };
    const apiListener = (next: ApiStatus) => {
      setApiStatus(current => ({ ...current, ...next }));
      recordDebugEvent(next.state === "error" ? "error" : next.state === "updated" ? "success" : "info", "YummyAnime API", next.state, next.state === "error" ? "YummyAnime API временно недоступен — используется резерв Kodik" : `Статус YummyAnime API: ${next.state}`);
      if (next.state === "updating") showStatusNotice({ tone: "loading", text: "Обновляем данные каталога…" });
      if (next.state === "error") showStatusNotice({ tone: "error", text: "YummyAnime API недоступен — проверяем резерв Kodik" });
    };
    const kodikApiListener = (next: ApiStatus) => {
      setKodikApiStatus(current => ({ ...current, ...next }));
      recordDebugEvent(next.state === "error" ? "error" : next.state === "updated" ? "success" : "info", "Kodik API", next.state, next.state === "error" ? "Kodik временно недоступен — используется резерв YummyAnime" : `Статус Kodik API: ${next.state}`);
    };
    const pingListener = (next: { state: "idle" | "connected" | "error"; ms?: number; roomId?: string }) => {
      setPartyPing(next);
      if (next.state !== "idle") recordDebugEvent(next.state === "error" ? "error" : "success", "Совместный просмотр", "Связь с комнатой", next.state === "connected" ? `Пинг: ${next.ms ?? "—"} мс` : "Нет связи с сервером комнаты");
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
    const time = new Date(syncedAt * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    showStatusNotice({ tone: "success", text: `Облако сохранено · ${time}` });
  }, [gdriveStatus?.last_sync_at]);

  useEffect(() => {
    if (!gdriveStatus?.connected) return;

    const runIntervalSync = async () => {
      const mode = read<"instant" | "interval" | "manual">("animesoul:gdrive-auto-sync-mode", "instant");
      if (mode !== "interval") return;

      const minutes = read("animesoul:gdrive-auto-sync-interval", 15);
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

  return <header>
    <Brand />
    <nav><button onClick={onCatalog}>Каталог</button><button onClick={onDownloads}>Скачанные</button><button onClick={onLibrary}>Статистика</button><button onClick={onRatings}>Оценки</button></nav>
    {!compact && <div className="search-wrap" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setSuggestionsOpen(false);
    }}>
      <form className="header-search" onSubmit={event => { event.preventDefault(); closeSearchSuggestions(); onSearch(); }}>
        <input ref={searchInputRef} value={query} onFocus={() => setSuggestionsOpen(true)}
          onKeyDown={event => { if (event.key === "Escape") closeSearchSuggestions(); }}
          onChange={event => { setSuggestionsOpen(true); setQuery(event.target.value); }}
          placeholder="Поиск…" />
        <button type="submit">⌕</button>
      </form>
      {suggestionsOpen && suggestions.length > 0 && <div className="suggestions">{suggestions.map(anime =>
        <button key={anime.anime_id} onClick={() => { closeSearchSuggestions(); onSuggestion?.(anime); }}>
          {anime.poster?.big && <img src={anime.poster.big} alt="" />}
          <span>{anime.title}<small>{anime.year} · ★ {anime.rating?.average?.toFixed(1)}</small></span>
        </button>,
      )}</div>}
    </div>}
    <div className="header-actions">
      <div className="header-statuses">
        {statusNotice && <div className={`status-popover ${statusNotice.tone}`} role="status" aria-live="polite"><i />{statusNotice.text}</div>}
        {partyPing.state !== "idle" && <div className={`save-indicator party-${partyPing.state}`} title={partyPing.state === "connected" ? `Задержка обмена с комнатой ${partyPing.roomId ?? ""}` : "Нет связи с сервером совместного просмотра"}><i />{partyPing.state === "connected" ? `Комната · ${partyPing.ms ?? "—"} мс` : "Комната недоступна"}</div>}
        <div className={`save-indicator ${apiStatus.state}`} title={`${apiText}. Пинг измеряется лёгким запросом раз в 30 секунд. Скорость — пассивная оценка браузера без отдельного speed-test.`}><i />Yummy · {apiDiagnostics}</div>
        <div className={`save-indicator ${kodikApiStatus.state}`} title={`${kodikApiText}. Пинг измеряется отдельным лёгким запросом раз в 30 секунд.`}><i />Kodik · {kodikApiDiagnostics}</div>
        <div className={`save-indicator ${diskStatus.state}`} title={diskStatus.state === "error" ? "Запусти AnimeSoul через батник, чтобы сохранять данные на диск" : "Автоматическое сохранение активного профиля на ПК"}><i />{statusText}</div>
        <div
          className={`save-indicator ${cloudIndicatorState}`}
          style={{ cursor: "pointer" }}
          onClick={handleGDriveClick}
          role="status"
          aria-live="polite"
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
        </div>
        <ChangelogButton />
      </div>
      {!compact && theme && setTheme && playerPrefs && setPlayerPrefs && onHistoryEnabledChange &&
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
        />}
    </div>
  </header>;
}

export function Brand() {
  return <button className="brand" onClick={() => { location.href = "/"; }}>
    <img src="/animesoul-icon.png" alt="" aria-hidden="true" />
    AnimeSoul
  </button>;
}
