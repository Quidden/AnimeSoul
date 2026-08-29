"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ConfigProfile, PlayerPrefs, Theme, ToolbarPosition } from "../lib/types";
import { DEFAULT_PLAYER_PREFS, STORAGE_KEYS as K, THEMES } from "../lib/settings";
import { readLocal as read, writeLocal as write } from "../lib/storage";
import { emitAppEvent, listenAppEvent } from "../lib/events";
import { DebugPanel } from "./DebugPanel";
import { ChangelogPanel } from "./ChangelogModal";
import { SettingsSearchContext } from "../features/settings/Setting";
import {
  matchesSettingsQuery,
  SETTINGS_SEARCH_TERMS,
  SETTINGS_TABS,
  type SettingsTab,
} from "../features/settings/settingsCatalog";
import { useGoogleDriveSettings } from "../features/settings/useGoogleDriveSettings";
import { CloudSettings } from "../features/settings/CloudSettings";
import { GoogleDriveInitialSyncModal } from "../features/settings/GoogleDriveInitialSyncModal";
import { AppearanceSettings } from "../features/settings/AppearanceSettings";
import { ProfileSettings } from "../features/settings/ProfileSettings";
import { OfflineSettings } from "../features/settings/OfflineSettings";
import { CredentialsSettings } from "../features/settings/CredentialsSettings";
import { PlaybackSettings } from "../features/settings/PlaybackSettings";
import { WatchPartySettings } from "../features/settings/WatchPartySettings";
import { IS_ANDROID_APP } from "../lib/platform";
import { useModalAccessibility } from "../lib/modalAccessibility";

type Props = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  playerPrefs: PlayerPrefs;
  setPlayerPrefs: (prefs: PlayerPrefs) => void;
  historyEnabled: boolean;
  onHistoryEnabledChange: (enabled: boolean) => void;
  profiles: ConfigProfile[];
  activeProfile: string;
  onSwitchProfile?: (id: string) => void;
  onExport?: () => void;
  onImport?: (file: File) => void;
  onStorageReload?: () => void;
};

const SETTINGS_CENTER_TABS = IS_ANDROID_APP
  ? SETTINGS_TABS.filter(tab => tab.id !== "party")
  : SETTINGS_TABS;

export function SettingsCenter(props: Props) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("watching");
  const [searchQuery, setSearchQuery] = useState("");
  const [globalSearchTarget, setGlobalSearchTarget] = useState("");
  const [toolbar, setToolbarState] = useState<ToolbarPosition>(read(K.toolbar, "bottom"));
  const modalRef = useRef<HTMLElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const googleDrive = useGoogleDriveSettings({ onStorageReload: props.onStorageReload });
  const {
    syncing,
    initialChoiceModal,
    setInitialChoiceModal,
    loadGDriveStatus,
    syncNow: handleSyncNow,
  } = googleDrive;
  const activeTabDefinition = SETTINGS_CENTER_TABS.find(tab => tab.id === activeTab);

  useModalAccessibility(open, () => setOpen(false), modalRef);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) return;

    const matchingTab = SETTINGS_CENTER_TABS.find((tab) => {
      const searchableText = `${tab.label} ${tab.description} ${SETTINGS_SEARCH_TERMS[tab.id]}`;
      return matchesSettingsQuery(searchableText, query);
    });

    if (matchingTab && matchingTab.id !== activeTab) {
      setActiveTab(matchingTab.id);
    }
  }, [activeTab, searchQuery]);

  useEffect(() => {
    const handleChoiceEvent = () => {
      setOpen(true);
      setInitialChoiceModal(true);
      loadGDriveStatus();
    };
    return listenAppEvent("open-gdrive-choice", handleChoiceEvent);
  }, [loadGDriveStatus, setInitialChoiceModal]);

  useEffect(() => listenAppEvent("open-settings", ({ tab, targetTitle }) => {
    if (IS_ANDROID_APP && tab === "party") return;
    setActiveTab(tab);
    setSearchQuery("");
    setGlobalSearchTarget(targetTitle ?? "");
    setOpen(true);
  }), []);

  useEffect(() => listenAppEvent("close-settings", () => setOpen(false)), []);

  useEffect(() => {
    if (!open || !globalSearchTarget) return;

    let highlighted: HTMLElement | null = null;
    let clearTimer = 0;
    const frame = window.requestAnimationFrame(() => {
      const modal = modalRef.current;
      if (!modal) return;
      const target = globalSearchTarget.toLocaleLowerCase("ru");
      const candidates = modal.querySelectorAll<HTMLElement>(
        ".settings-item, .cloud-settings-card, .cloud-settings-field, .cloud-settings-details, .settings-group-title, .debug-privacy",
      );
      highlighted = Array.from(candidates).find(element => (
        element.textContent?.toLocaleLowerCase("ru").includes(target)
      )) ?? null;
      if (!highlighted) {
        setGlobalSearchTarget("");
        return;
      }

      highlighted.dataset.globalSearchTarget = "true";
      highlighted.scrollIntoView({ block: "center", behavior: "smooth" });
      clearTimer = window.setTimeout(() => {
        highlighted?.removeAttribute("data-global-search-target");
        setGlobalSearchTarget("");
      }, 2_400);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (clearTimer) window.clearTimeout(clearTimer);
      highlighted?.removeAttribute("data-global-search-target");
    };
  }, [activeTab, globalSearchTarget, open]);

  useEffect(() => {
    if (!open && globalSearchTarget) setGlobalSearchTarget("");
  }, [globalSearchTarget, open]);

  useEffect(() => {
    if (!open) return;
    loadGDriveStatus();
    const statusTimer = window.setInterval(loadGDriveStatus, 2_500);

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "GDRIVE_AUTH_SUCCESS") loadGDriveStatus();
    };
    const handleOAuthReturn = () => void loadGDriveStatus();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadGDriveStatus();
    };

    window.addEventListener("message", handleMessage);
    window.addEventListener("animesoul-oauth-return", handleOAuthReturn);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleOAuthReturn);
    return () => {
      window.clearInterval(statusTimer);
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("animesoul-oauth-return", handleOAuthReturn);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleOAuthReturn);
    };
  }, [loadGDriveStatus, open]);

  useEffect(() => {
    if (!open || !IS_ANDROID_APP) return;
    const tabList = tabListRef.current;
    const activeButton = tabList?.querySelector<HTMLButtonElement>('button[aria-selected="true"]');
    if (!tabList || !activeButton) return;
    const buttonLeft = activeButton.offsetLeft;
    const buttonRight = buttonLeft + activeButton.offsetWidth;
    const visibleLeft = tabList.scrollLeft;
    const visibleRight = visibleLeft + tabList.clientWidth;
    if (buttonLeft < visibleLeft) {
      tabList.scrollTo({ left: Math.max(0, buttonLeft - 10), behavior: "auto" });
    } else if (buttonRight > visibleRight) {
      tabList.scrollTo({ left: buttonRight - tabList.clientWidth + 10, behavior: "auto" });
    }
  }, [activeTab, open]);

  const setPrefs = (partial: Partial<PlayerPrefs>) => {
    const next = { ...DEFAULT_PLAYER_PREFS, ...props.playerPrefs, ...partial };
    props.setPlayerPrefs(next);
    write(K.playerPrefs, next);
    emitAppEvent("player-prefs", next);
  };

  const setToolbar = (value: ToolbarPosition) => {
    setToolbarState(value);
    write(K.toolbar, value);
    emitAppEvent("toolbar", value);
  };

  const resetSettings = () => {
    if (!confirm(
      "Сбросить оформление и настройки просмотра? Прогресс, папки, избранное и отслеживания останутся без изменений.",
    )) return;
    const nextPrefs = { ...DEFAULT_PLAYER_PREFS };
    props.setPlayerPrefs(nextPrefs);
    props.setTheme(THEMES[0]);
    setToolbarState("bottom");
    write(K.playerPrefs, nextPrefs);
    write(K.theme, THEMES[0]);
    write(K.toolbar, "bottom");
    emitAppEvent("player-prefs", nextPrefs);
    emitAppEvent("toolbar", "bottom");
  };

  return (
    <>
      <button
        type="button"
        className="settings-center-trigger"
        title="Открыть все настройки AnimeSoul"
        aria-label="Открыть настройки AnimeSoul"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        ⚙
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          className="settings-modal-backdrop"
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <section
            ref={modalRef}
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Настройки AnimeSoul"
            tabIndex={-1}
          >
            <header>
              <div>
                <span>ЦЕНТР УПРАВЛЕНИЯ</span>
                <h2>{IS_ANDROID_APP ? "Настройки" : "Настройки AnimeSoul"}</h2>
                <p>Все параметры сохраняются в активном профиле автоматически.</p>
              </div>
              <div className="settings-header-actions">
                <button
                  className="settings-reset"
                  onClick={resetSettings}
                  aria-label="Сбросить настройки"
                  title="Сбросить настройки"
                >
                  ↺ Сбросить
                </button>
                <button onClick={() => setOpen(false)} aria-label="Закрыть">×</button>
              </div>
            </header>
            <div className="settings-layout">
              <nav className="settings-tabs" aria-label="Разделы настроек">
                <label className="settings-search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder="Найти настройку…"
                    aria-label="Поиск по настройкам"
                  />
                  {searchQuery && (
                    <button type="button" onClick={() => setSearchQuery("")} aria-label="Очистить поиск">
                      ×
                    </button>
                  )}
                </label>
                <div ref={tabListRef} className="settings-tab-list" role="tablist">
                  {SETTINGS_CENTER_TABS.map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab.id}
                      className={activeTab === tab.id ? "active" : ""}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      <i aria-hidden="true">{tab.icon}</i>
                      <span>
                        <b>{tab.label}</b>
                        <small>{tab.description}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </nav>
              <main className="settings-workspace">
                <div className="settings-panel-heading">
                  <div>
                    <span>{activeTabDefinition?.icon}</span>
                    <div>
                      <h3>{activeTabDefinition?.label}</h3>
                      <p>{activeTabDefinition?.description}</p>
                    </div>
                  </div>
                  <small>
                    {searchQuery ? `Поиск: «${searchQuery}»` : "Изменения сохраняются автоматически"}
                  </small>
                </div>
                <SettingsSearchContext.Provider value={searchQuery}>
                  <div
                    className={`settings-scroll${searchQuery ? " is-searching" : ""}`}
                    data-active-tab={activeTab}
                  >
                    <PlaybackSettings
                      playerPrefs={props.playerPrefs}
                      toolbar={toolbar}
                      historyEnabled={props.historyEnabled}
                      updatePlayerPrefs={setPrefs}
                      updateToolbar={setToolbar}
                      onHistoryEnabledChange={props.onHistoryEnabledChange}
                    />
                    <AppearanceSettings
                      theme={props.theme}
                      playerPrefs={props.playerPrefs}
                      setTheme={props.setTheme}
                      updatePlayerPrefs={setPrefs}
                    />
                    <ProfileSettings
                      profiles={props.profiles}
                      activeProfile={props.activeProfile}
                      onSwitchProfile={props.onSwitchProfile}
                      onExport={props.onExport}
                      onImport={props.onImport}
                    />
                    <CredentialsSettings googleDrive={googleDrive} />
                    <OfflineSettings />
                    <CloudSettings state={googleDrive} />
                    {!IS_ANDROID_APP && (
                      <WatchPartySettings
                        playerPrefs={props.playerPrefs}
                        updatePlayerPrefs={setPrefs}
                      />
                    )}
                    {activeTab === "changelog" && (
                      <section
                        className="settings-group settings-changelog-group"
                        data-settings-tab="changelog"
                      >
                        <div className="settings-group-title">
                          <b>История изменений</b>
                          <span>Все релизы AnimeSoul, новые возможности и исправленные проблемы</span>
                        </div>
                        <ChangelogPanel />
                      </section>
                    )}
                    {activeTab === "debug" && (
                      <section
                        className="settings-group settings-debug-group"
                        data-settings-tab="debug"
                      >
                        <div className="settings-group-title">
                          <b>Журнал отладки</b>
                          <span>Все важные действия, статусы и ошибки текущего устройства</span>
                        </div>
                        <DebugPanel />
                      </section>
                    )}
                  </div>
                </SettingsSearchContext.Provider>
              </main>
            </div>
          </section>
        </div>,
        document.body,
      )}

      <GoogleDriveInitialSyncModal
        open={initialChoiceModal}
        syncing={syncing}
        onClose={() => setInitialChoiceModal(false)}
        onSync={mode => void handleSyncNow(mode, true)}
      />
    </>
  );
}
