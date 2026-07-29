"use client";

import { useEffect, useState } from "react";
import type { Anime, ApiStatus, ConfigProfile, PlayerPrefs, SaveStatus, Theme } from "../lib/types";
import { readLocal as read } from "../lib/storage";
import { SettingsCenter } from "./SettingsCenter";

type HeaderProps = {
  query: string;
  setQuery: (value: string) => void;
  onSearch: () => void;
  onCatalog: () => void;
  onLibrary: () => void;
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
};

type NetworkInformation = {
  downlink?: number;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

export function Header({
  query,
  setQuery,
  onSearch,
  onCatalog,
  onLibrary,
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
}: HeaderProps) {
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [diskStatus, setDiskStatus] = useState<SaveStatus>({ state: "loading" });
  const [apiStatus, setApiStatus] = useState<ApiStatus>({ state: "idle" });
  const [partyPing, setPartyPing] = useState<{ state: "idle" | "connected" | "error"; ms?: number; roomId?: string }>({ state: "idle" });
  useEffect(() => {
    setDiskStatus(read("animesoul:save-status", { state: "loading" }));
    setApiStatus(read("animesoul:api-status", { state: "idle" }));
    const diskListener = (event: Event) => setDiskStatus((event as CustomEvent<SaveStatus>).detail);
    const apiListener = (event: Event) => setApiStatus(current => ({ ...current, ...(event as CustomEvent<ApiStatus>).detail }));
    const pingListener = (event: Event) => setPartyPing((event as CustomEvent<{ state: "idle" | "connected" | "error"; ms?: number; roomId?: string }>).detail);
    window.addEventListener("animesoul:save-status", diskListener);
    window.addEventListener("animesoul:api-status", apiListener);
    window.addEventListener("animesoul:party-ping", pingListener);
    return () => {
      window.removeEventListener("animesoul:save-status", diskListener);
      window.removeEventListener("animesoul:api-status", apiListener);
      window.removeEventListener("animesoul:party-ping", pingListener);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
    const readDownlink = () => {
      const value = connection?.downlink;
      return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
    };
    const measure = async () => {
      const startedAt = performance.now();
      try {
        const response = await fetch("/api/yummy?mode=ping&silent=1", { cache: "no-store" });
        if (!response.ok) throw new Error("ping");
        if (!cancelled) setApiStatus(current => ({
          ...current,
          pingMs: Math.max(1, Math.round(performance.now() - startedAt)),
          downlinkMbps: readDownlink(),
        }));
      } catch {
        if (!cancelled) setApiStatus(current => ({ ...current, pingMs: undefined, downlinkMbps: readDownlink() }));
      }
    };
    const updateDownlink = () => setApiStatus(current => ({ ...current, downlinkMbps: readDownlink() }));
    void measure();
    const timer = window.setInterval(measure, 30_000);
    connection?.addEventListener?.("change", updateDownlink);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      connection?.removeEventListener?.("change", updateDownlink);
    };
  }, []);
  const statusText = diskStatus.state === "saving" ? "Сохраняем…" : diskStatus.state === "saved" ? `Сохранено${diskStatus.at ? ` · ${new Date(diskStatus.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : ""}` : diskStatus.state === "error" ? "Только в браузере" : "Подключаем хранилище…";
  const apiText = apiStatus.state === "updating" ? "Обновляем API…" : apiStatus.state === "updated" ? `API обновлено${apiStatus.at ? ` · ${new Date(apiStatus.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : ""}` : apiStatus.state === "error" ? "Ошибка API" : "API ожидает";
  const apiDiagnostics = `${apiStatus.pingMs ? `${apiStatus.pingMs} мс` : "пинг —"} · ${apiStatus.downlinkMbps ? `≈ ${apiStatus.downlinkMbps.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} Мбит/с` : "скорость —"}`;

  return <header>
    <Brand />
    <nav><button onClick={onCatalog}>Каталог</button><button onClick={onLibrary}>Статистика</button></nav>
    {!compact && <div className="search-wrap">
      <form className="header-search" onSubmit={event => { event.preventDefault(); setSuggestionsOpen(false); onSearch(); }}>
        <input value={query} onFocus={() => setSuggestionsOpen(true)} onChange={event => { setSuggestionsOpen(true); setQuery(event.target.value); }} placeholder="Поиск…" />
        <button type="submit">⌕</button>
      </form>
      {suggestionsOpen && suggestions.length > 0 && <div className="suggestions">{suggestions.map(anime =>
        <button key={anime.anime_id} onClick={() => { setSuggestionsOpen(false); onSuggestion?.(anime); }}>
          {anime.poster?.big && <img src={anime.poster.big} alt="" />}
          <span>{anime.title}<small>{anime.year} · ★ {anime.rating?.average?.toFixed(1)}</small></span>
        </button>,
      )}</div>}
    </div>}
    <div className="header-actions">
      <div className="header-statuses">
        {partyPing.state !== "idle" && <div className={`save-indicator party-${partyPing.state}`} title={partyPing.state === "connected" ? `Задержка обмена с комнатой ${partyPing.roomId ?? ""}` : "Нет связи с сервером совместного просмотра"}><i />{partyPing.state === "connected" ? `Комната · ${partyPing.ms ?? "—"} мс` : "Комната недоступна"}</div>}
        <div className={`save-indicator ${apiStatus.state}`} title={`${apiText}. Пинг измеряется лёгким запросом раз в 30 секунд. Скорость — пассивная оценка браузера без отдельного speed-test.`}><i />API · {apiDiagnostics}</div>
        <div className={`save-indicator ${diskStatus.state}`} title={diskStatus.state === "error" ? "Запусти AnimeSoul через батник, чтобы сохранять данные на диск" : "Автоматическое сохранение активного профиля на ПК"}><i />{statusText}</div>
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
        />}
    </div>
  </header>;
}

export function Brand() {
  return <button className="brand" onClick={() => { location.href = "/"; }}><span>魂</span> AnimeSoul</button>;
}
