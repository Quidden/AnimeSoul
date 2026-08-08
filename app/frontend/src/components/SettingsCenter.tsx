"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ConfigProfile, PlayerPrefs, Theme, ToolbarPosition } from "../lib/types";
import { DEFAULT_PLAYER_PREFS, STORAGE_KEYS as K, THEMES } from "../lib/settings";
import { readLocal as read, writeLocal as write } from "../lib/storage";
import { Toggle } from "./Toggle";
import { DebugPanel } from "./DebugPanel";
import {
  disconnectGDrive,
  fetchGDriveAuthUrl,
  fetchGDriveStatus,
  saveGDriveCredentials,
  syncGDrive,
  type GDriveFolderMode,
  type GDriveStatus,
  type GDriveSyncMode,
} from "../lib/gdrive";

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

type SettingsTab = "watching" | "player" | "appearance" | "cloud" | "party" | "profiles" | "debug";

const SettingsSearchContext = createContext("");

const SETTINGS_SEARCH_TERMS: Record<SettingsTab, string> = {
  watching: "просмотр продолжение автозапуск предпросмотр история сохранять прогресс серия момент переход прокрутка",
  player: "плеер автоскип пропуск опенинг эндинг автосерия карусель миниатюры наведение панель таймкод расположение",
  appearance: "интерфейс оформление тема готовые собственная цвет палитра шрифт размер обложка постер карточка фото",
  cloud: "облако google drive синхронизация автосохранение выгрузка интервал восстановление папка oauth перенос статус подключение приоритет просмотрено",
  party: "совместно комната hamachi tailscale участник хост озвучка пинг синхронизация имя адрес правило личный догонять положение",
  profiles: "профиль активный переключение перенос резервная копия импорт экспорт загрузить выгрузить json конфиг",
  debug: "дебаг отладка журнал лог событие действие статус успешно ошибка предупреждение api сохранение диагностика экспорт",
};

const SETTINGS_TABS: Array<{
  id: SettingsTab;
  icon: string;
  label: string;
  description: string;
}> = [
  {
    id: "watching",
    icon: "▶",
    label: "Просмотр",
    description: "Продолжение серии, предпросмотр и история",
  },
  {
    id: "player",
    icon: "▣",
    label: "Плеер",
    description: "Автопропуск, автосерия и расположение панели",
  },
  {
    id: "appearance",
    icon: "◐",
    label: "Интерфейс",
    description: "Темы, цвета и размеры элементов",
  },
  {
    id: "cloud",
    icon: "☁",
    label: "Облако",
    description: "Google Drive и восстановление сохранений",
  },
  {
    id: "party",
    icon: "◎",
    label: "Совместно",
    description: "Комнаты, синхронизация и режимы участников",
  },
  {
    id: "profiles",
    icon: "◇",
    label: "Профили",
    description: "Переключение, импорт и резервная копия",
  },
  {
    id: "debug",
    icon: "⌁",
    label: "Дебаг",
    description: "Действия, статусы и ошибки сайта",
  },
];

function matchesSettingsQuery(searchableText: string, rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase("ru");
  if (!query) return true;

  const text = searchableText.toLocaleLowerCase("ru");
  return query.split(/\s+/).every((token) => {
    if (text.includes(token)) return true;

    // A light-weight fallback for common Russian word endings: searches such as
    // "размер шрифта" should still match labels containing "шрифт".
    const stem = token.length >= 6 ? token.slice(0, -1) : token;
    return stem.length >= 4 && text.includes(stem);
  });
}

function Setting({
  title,
  description,
  example,
  searchTerms,
  children,
}: {
  title: string;
  description: string;
  example?: string;
  searchTerms?: string;
  children: ReactNode;
}) {
  const searchQuery = useContext(SettingsSearchContext);
  const searchableText = `${title} ${description} ${example ?? ""} ${searchTerms ?? ""}`;
  const matchesSearch = matchesSettingsQuery(searchableText, searchQuery);

  if (!matchesSearch) return null;

  return (
    <article className="settings-item">
      <div>
        <b>{title}</b>
        <p>{description}</p>
        {example && <small>Пример: {example}</small>}
      </div>
      <div>{children}</div>
    </article>
  );
}

export function SettingsCenter(props: Props) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("watching");
  const [searchQuery, setSearchQuery] = useState("");
  const [toolbar, setToolbarState] = useState<ToolbarPosition>(read(K.toolbar, "bottom"));
  const modalRef = useRef<HTMLElement>(null);

  // Google Drive state
  const [gdriveStatus, setGDriveStatus] = useState<GDriveStatus | null>(null);
  const [folderMode, setFolderMode] = useState<GDriveFolderMode>(() => read("animesoul:gdrive-folder-mode", "visible"));
  const [preferWatched, setPreferWatched] = useState<boolean>(() => read("animesoul:gdrive-prefer-watched", true));
  const [autoSyncMode, setAutoSyncMode] = useState<"instant" | "interval" | "manual">(() => read("animesoul:gdrive-auto-sync-mode", "instant"));
  const [autoSyncInterval, setAutoSyncInterval] = useState<number>(() => read("animesoul:gdrive-auto-sync-interval", 15));
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [showCredsInput, setShowCredsInput] = useState(false);
  const [clientIdInput, setClientIdInput] = useState("");
  const [clientSecretInput, setClientSecretInput] = useState("");
  const [initialChoiceModal, setInitialChoiceModal] = useState(false);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) return;

    const matchingTab = SETTINGS_TABS.find((tab) => {
      const searchableText = `${tab.label} ${tab.description} ${SETTINGS_SEARCH_TERMS[tab.id]}`;
      return matchesSettingsQuery(searchableText, query);
    });

    if (matchingTab && matchingTab.id !== activeTab) {
      setActiveTab(matchingTab.id);
    }
  }, [activeTab, searchQuery]);

  const loadGDriveStatus = async () => {
    try {
      const status = await fetchGDriveStatus();
      setGDriveStatus(status);
      write("animesoul:gdrive-has-cloud-file", status.has_cloud_file ?? false);

      if (status.connected) {
        if (status.choice_pending) {
          write("animesoul:gdrive-initial-choice-done", false);
          setInitialChoiceModal(true);
        } else if (!status.has_cloud_file) {
          write("animesoul:gdrive-initial-choice-done", true);
        } else {
          const choiceDone = read("animesoul:gdrive-initial-choice-done", false);
          if (!choiceDone) {
            setInitialChoiceModal(true);
          }
        }
      }

      setClientIdInput(status.client_id || "");
    } catch {
      setGDriveStatus(null);
    }
  };

  useEffect(() => {
    const handleChoiceEvent = () => {
      setOpen(true);
      setInitialChoiceModal(true);
      loadGDriveStatus();
    };
    window.addEventListener("animesoul:open-gdrive-choice", handleChoiceEvent);
    return () => window.removeEventListener("animesoul:open-gdrive-choice", handleChoiceEvent);
  }, []);

  useEffect(() => {
    if (!open) return;
    loadGDriveStatus();
    const statusTimer = window.setInterval(loadGDriveStatus, 2_500);

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "GDRIVE_AUTH_SUCCESS") {
        loadGDriveStatus();
      }
    };

    window.addEventListener("message", handleMessage);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !modalRef.current?.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", close);
    document.addEventListener("pointerdown", closeOutside, true);
    return () => {
      window.clearInterval(statusTimer);
      window.removeEventListener("message", handleMessage);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", closeOutside, true);
    };
  }, [open]);

  const handleConnectGDrive = async () => {
    setSyncMessage("");
    try {
      const { url } = await fetchGDriveAuthUrl();
      window.open(url, "gdrive_auth", "width=600,height=700");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка получения URL авторизации";
      setSyncMessage(msg);
      setShowCredsInput(true);
    }
  };

  const handleDisconnectGDrive = async () => {
    if (!confirm("Отключить синхронизацию с Google Диском?")) return;
    try {
      await disconnectGDrive();
      setGDriveStatus(null);
      write("animesoul:gdrive-initial-choice-done", false);
      write("animesoul:gdrive-has-cloud-file", false);
      setSyncMessage("Google Диск отключен");
    } catch (err: unknown) {
      setSyncMessage(err instanceof Error ? err.message : "Ошибка отключения");
    }
  };

  const handleSaveCredentials = async () => {
    if (!clientIdInput.trim()) {
      alert("Введите Google OAuth Client ID");
      return;
    }
    try {
      await saveGDriveCredentials(clientIdInput.trim(), clientSecretInput.trim());
      await loadGDriveStatus();
      setShowCredsInput(false);
      setSyncMessage("Ключи сохранены!");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Ошибка сохранения ключей");
    }
  };

  const handleSyncNow = async (mode: GDriveSyncMode = "auto") => {
    if (mode === "cloud" && !confirm("Вы уверены? Все текущие локальные настройки и прогресс на этом ПК БУДУТ СТЁРТЫ и заменены данными из Google Диска!")) {
      return;
    }
    if (mode === "local" && !confirm("Вы уверены? Облачный файл на Google Диске БУДЕТ ПЕРЕЗАПИСАН локальными данными и настройками с этого ПК!")) {
      return;
    }
    setSyncing(true);
    setSyncMessage("Синхронизация...");
    try {
      const res = await syncGDrive(mode, preferWatched, folderMode);
      write("animesoul:gdrive-initial-choice-done", true);
      setSyncMessage(
        mode === "anime_only"
          ? "Аниме и статистика синхронизированы без изменения настроек!"
          : res.status === "merged"
          ? "Сохранения и настройки успешно объединены!"
          : res.status === "uploaded"
          ? "Локальные настройки выгружены на Диск!"
          : "Сохранения и настройки загружены из облака!"
      );
      props.onStorageReload?.();
    } catch (err: unknown) {
      setSyncMessage(err instanceof Error ? err.message : "Ошибка синхронизации");
    } finally {
      setSyncing(false);
      setInitialChoiceModal(false);
    }
  };

  const setPrefs = (partial: Partial<PlayerPrefs>) => {
    const next = { ...DEFAULT_PLAYER_PREFS, ...props.playerPrefs, ...partial };
    props.setPlayerPrefs(next);
    write(K.playerPrefs, next);
    window.dispatchEvent(new CustomEvent("animesoul:player-prefs", { detail: next }));
  };

  const setToolbar = (value: ToolbarPosition) => {
    setToolbarState(value);
    write(K.toolbar, value);
    window.dispatchEvent(new CustomEvent("animesoul:toolbar", { detail: value }));
  };

  const resetSettings = () => {
    if (
      !confirm(
        "Сбросить оформление и настройки просмотра? Прогресс, папки, избранное и отслеживания останутся без изменений."
      )
    )
      return;
    const nextPrefs = { ...DEFAULT_PLAYER_PREFS };
    props.setPlayerPrefs(nextPrefs);
    props.setTheme(THEMES[0]);
    setToolbarState("bottom");
    write(K.playerPrefs, nextPrefs);
    write(K.theme, THEMES[0]);
    write(K.toolbar, "bottom");
    window.dispatchEvent(new CustomEvent("animesoul:player-prefs", { detail: nextPrefs }));
    window.dispatchEvent(new CustomEvent("animesoul:toolbar", { detail: "bottom" }));
  };

  const cloudSyncing = syncing || gdriveStatus?.sync_state === "syncing";
  const cloudError = gdriveStatus?.last_sync_error || "";
  const cloudLastSync = gdriveStatus?.last_sync_at
    ? new Date(gdriveStatus.last_sync_at * 1000).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const cloudState = !gdriveStatus?.connected
    ? "disconnected"
    : cloudSyncing
    ? "syncing"
    : cloudError
    ? "error"
    : gdriveStatus.last_sync_at
    ? "synced"
    : "ready";
  const cloudTitle = cloudState === "disconnected"
    ? "Не подключено"
    : cloudState === "syncing"
    ? "Сохраняем…"
    : cloudState === "error"
    ? "Ошибка синхронизации"
    : cloudState === "synced"
    ? "Сохранено"
    : "Готово";
  const cloudDetail = cloudState === "disconnected"
    ? "Подключите аккаунт ниже, чтобы прогресс, папки и настройки дублировались в облаке."
    : cloudState === "syncing"
    ? "Локальная копия уже сохранена. Можно продолжать пользоваться сайтом — загрузка идёт в фоне."
    : cloudState === "error"
    ? `${cloudError}. Локальная копия сохранена — можно повторить загрузку позже.`
    : cloudLastSync
    ? `Последняя подтверждённая синхронизация: ${cloudLastSync}.`
    : "После первого изменения здесь появится время подтверждённой загрузки.";

  return (
    <>
      <button
        className="settings-center-trigger"
        title="Открыть все настройки AnimeSoul"
        onClick={() => setOpen(true)}
      >
        ⚙
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="settings-modal-backdrop"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              }
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          >
            <section
              ref={modalRef}
              className="settings-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Настройки AnimeSoul"
            >
              <header>
                <div>
                  <span>ЦЕНТР УПРАВЛЕНИЯ</span>
                  <h2>Настройки AnimeSoul</h2>
                  <p>Все параметры сохраняются в активном профиле автоматически.</p>
                </div>
                <div className="settings-header-actions">
                  <button className="settings-reset" onClick={resetSettings}>
                    ↺ Сбросить
                  </button>
                  <button onClick={() => setOpen(false)} aria-label="Закрыть">
                    ×
                  </button>
                </div>
              </header>
              <div className="settings-layout">
                <nav className="settings-tabs" aria-label="Разделы настроек">
                  <label className="settings-search">
                    <span aria-hidden="true">⌕</span>
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Найти настройку…"
                      aria-label="Поиск по настройкам"
                    />
                    {searchQuery && (
                      <button type="button" onClick={() => setSearchQuery("")} aria-label="Очистить поиск">
                        ×
                      </button>
                    )}
                  </label>
                  <div className="settings-tab-list" role="tablist">
                    {SETTINGS_TABS.map((tab) => (
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
                      <span>{SETTINGS_TABS.find((tab) => tab.id === activeTab)?.icon}</span>
                      <div>
                        <h3>{SETTINGS_TABS.find((tab) => tab.id === activeTab)?.label}</h3>
                        <p>{SETTINGS_TABS.find((tab) => tab.id === activeTab)?.description}</p>
                      </div>
                    </div>
                    <small>{searchQuery ? `Поиск: «${searchQuery}»` : "Изменения сохраняются автоматически"}</small>
                  </div>
                  <SettingsSearchContext.Provider value={searchQuery}>
                  <div
                    className={`settings-scroll${searchQuery ? " is-searching" : ""}`}
                    data-active-tab={activeTab}
                  >
                <aside className="settings-known-issues" data-settings-tab="player">
                  <b>Возможные ограничения источников</b>
                  <p>
                    Часть функций зависит от данных API и видеоплеера. У некоторых аниме или серий могут
                    отсутствовать кадры, точные таймкоды опенинга и эндинга, отдельные озвучки либо
                    подтверждённая дата следующей серии. Кадры иногда бывают низкого качества, повторяются
                    или не полностью соответствуют серии — AnimeSoul показывает только то, что вернул источник.
                  </p>
                </aside>

                <section className="settings-group" data-settings-tab="watching">
                  <div className="settings-group-title">
                    <b>Просмотр и продолжение</b>
                    <span>Поведение сайта при открытии и переключении серий</span>
                  </div>
                  <Setting
                    title="Автозапуск продолжения"
                    description="После нажатия «Продолжить» плеер сам запускает серию с сохранённого момента."
                    example="Остановились на 12:40 — серия откроется и начнёт играть с 12:40."
                  >
                    <Toggle
                      label="Включён"
                      value={props.playerPrefs.autoPlayResume}
                      onChange={(value) => setPrefs({ autoPlayResume: value })}
                    />
                  </Setting>
                  <Setting
                    title="Предпросмотр на главной"
                    description="Показывает визуальный предпросмотр последней серии вместо обычной кнопки продолжения."
                    example="На главной появится широкая карточка текущей серии."
                  >
                    <Toggle
                      label="Включён"
                      value={props.playerPrefs.homeEpisodePreview}
                      onChange={(value) => setPrefs({ homeEpisodePreview: value })}
                    />
                  </Setting>
                  <Setting
                    title="Источник предпросмотра"
                    description="HD-картинка использует постер, а кадры серии — беззвучный видеопредпросмотр, если его отдаёт источник. Не для всех серий доступны кадры; иногда они имеют низкое качество, повторяются или относятся не к той части тайтла."
                    example="Для стабильного качества и экономии трафика выбери HD-картинку."
                  >
                    <div className="settings-segmented">
                      <button
                        disabled={!props.playerPrefs.homeEpisodePreview}
                        className={props.playerPrefs.homePreviewMode === "poster" ? "active" : ""}
                        onClick={() => setPrefs({ homePreviewMode: "poster" })}
                      >
                        HD-картинка
                      </button>
                      <button
                        disabled={!props.playerPrefs.homeEpisodePreview}
                        className={props.playerPrefs.homePreviewMode === "screenshots" ? "active" : ""}
                        onClick={() => setPrefs({ homePreviewMode: "screenshots" })}
                      >
                        Кадры серии
                      </button>
                    </div>
                  </Setting>
                  <Setting
                    title="Переход к плееру"
                    description="При ручном выборе серии страница плавно прокручивается к плееру. Автопереключение экран не двигает."
                    example="Нажатие на серию 8 сразу покажет плеер."
                  >
                    <Toggle
                      label="Включён"
                      value={props.playerPrefs.autoScrollPlayer}
                      onChange={(value) => setPrefs({ autoScrollPlayer: value })}
                    />
                  </Setting>
                </section>

                <section className="settings-group" data-settings-tab="player">
                  <div className="settings-group-title">
                    <b>Плеер</b>
                    <span>Автоматизация и расположение элементов просмотра</span>
                  </div>
                  <Setting
                    title="Автоскип опенинга"
                    description="Автоматически перематывает опенинг, когда источник передал точный таймкод. Если таймкод отсутствует или ошибочен, кнопка и автопропуск могут быть недоступны."
                    example="Плеер перескочит с 0:45 на 2:15."
                  >
                    <Toggle
                      label="Включён"
                      value={props.playerPrefs.autoSkipOpening}
                      onChange={(value) => setPrefs({ autoSkipOpening: value })}
                    />
                  </Setting>
                  <Setting
                    title="Автоскип эндинга"
                    description="Отмечает серию просмотренной и перематывает эндинг по таймкоду источника. Для серий без корректного таймкода завершение определяется по общей длительности."
                    example="На 22:40 плеер перейдёт к концу серии."
                  >
                    <Toggle
                      label="Включён"
                      value={props.playerPrefs.autoSkipEnding}
                      onChange={(value) => setPrefs({ autoSkipEnding: value })}
                    />
                  </Setting>
                  <Setting
                    title="Автосерия"
                    description="После завершения текущей серии автоматически открывает и запускает следующую."
                    example="После серии 4 сразу начнётся серия 5."
                  >
                    <Toggle
                      label="Включён"
                      value={props.playerPrefs.autoNext}
                      onChange={(value) => setPrefs({ autoNext: value })}
                    />
                  </Setting>
                  <Setting
                    title="Карусель серий"
                    description="Показывает предыдущую и следующую серии по бокам плеера для быстрого переключения."
                    example="Нажми на правую карточку, чтобы перейти к следующей серии."
                  >
                    <Toggle
                      label="Включена"
                      value={props.playerPrefs.playerEpisodeCarousel}
                      onChange={(value) => setPrefs({ playerEpisodeCarousel: value })}
                    />
                  </Setting>
                  <Setting
                    title="Миниатюры при наведении"
                    description="Через полсекунды показывает доступные кадры конкретной серии над её карточкой. Если API не вернул уникальные кадры этой серии, миниатюра не показывается; это предотвращает подмену кадрами другого сезона."
                    example="Наведи курсор на серию 3, чтобы увидеть её кадры."
                  >
                    <Toggle
                      label="Включены"
                      value={props.playerPrefs.episodeHoverPreview}
                      onChange={(value) => setPrefs({ episodeHoverPreview: value })}
                    />
                  </Setting>
                  <Setting
                    title="Панель управления"
                    description="Определяет, с какой стороны плеера располагаются озвучка, серия, источник и настройки."
                    example="На широком мониторе удобно расположение справа."
                  >
                    <select
                      value={toolbar}
                      onChange={(event) => setToolbar(event.target.value as ToolbarPosition)}
                    >
                      <option value="bottom">Снизу</option>
                      <option value="top">Сверху</option>
                      <option value="left">Слева</option>
                      <option value="right">Справа</option>
                    </select>
                  </Setting>
                </section>

                <section className="settings-group" data-settings-tab="watching">
                  <div className="settings-group-title">
                    <b>История</b>
                    <span>Отдельная лента недавних просмотров</span>
                  </div>
                  <Setting
                    title="Сохранять историю"
                    description="Добавляет просмотренные серии в раздел истории. Прогресс просмотра сохраняется независимо от этой настройки."
                    example="Можно отключить историю, не потеряв момент остановки."
                  >
                    <Toggle
                      label="Включена"
                      value={props.historyEnabled}
                      onChange={props.onHistoryEnabledChange}
                    />
                  </Setting>
                </section>

                <section className="settings-group" data-settings-tab="appearance">
                  <div className="settings-group-title">
                    <b>Оформление</b>
                    <span>Готовые темы и собственные цвета</span>
                  </div>
                  <Setting
                    title="Собственная палитра"
                    description="Основной цвет меняет фон интерфейса, акцентный — кнопки, индикаторы и выделения."
                  >
                    <div className="settings-colors">
                      <label>
                        Фон
                        <input
                          type="color"
                          value={props.theme.background}
                          onChange={(event) =>
                            props.setTheme({
                              ...props.theme,
                              name: "Своя",
                              background: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Акцент
                        <input
                          type="color"
                          value={props.theme.accent}
                          onChange={(event) =>
                            props.setTheme({
                              ...props.theme,
                              name: "Своя",
                              accent: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                  </Setting>
                  <Setting
                    title="Готовые темы"
                    description="Мгновенно применяет заранее подобранную пару основного и акцентного цветов."
                  >
                    <div className="settings-themes">
                      {THEMES.map((theme) => (
                        <button
                          key={theme.name}
                          className={props.theme.name === theme.name ? "active" : ""}
                          onClick={() => props.setTheme(theme)}
                        >
                          <i
                            style={{
                              background: `linear-gradient(135deg,${theme.background} 50%,${theme.accent} 50%)`,
                            }}
                          />
                          {theme.name}
                        </button>
                      ))}
                    </div>
                  </Setting>
                </section>

                <section className="settings-group" data-settings-tab="profiles">
                  <div className="settings-group-title">
                    <b>Профили и перенос данных</b>
                    <span>Папки, прогресс, отслеживание, темы и настройки</span>
                  </div>
                  <Setting
                    title="Активный профиль"
                    description="Переключает полностью независимый набор сохранений и настроек."
                    example="Создай отдельные профили для себя и друга."
                  >
                    <select
                      value={props.activeProfile}
                      onChange={(event) => props.onSwitchProfile?.(event.target.value)}
                    >
                      <option value="default">Основной</option>
                      {props.profiles
                        .filter((profile) => profile.id !== "default")
                        .map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name}
                          </option>
                        ))}
                    </select>
                  </Setting>
                  <Setting
                    title="Резервная копия профиля"
                    description="Выгрузка сохраняет профиль в JSON-файл, загрузка создаёт из выбранного файла новый профиль."
                    example="Перенеси JSON на другой ПК и загрузи его здесь."
                  >
                    <div className="settings-profile-actions">
                      <button onClick={props.onExport}>⇩ Выгрузить профиль</button>
                      <label>
                        ⇧ Загрузить профиль
                        <input
                          type="file"
                          accept=".json,application/json"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) props.onImport?.(file);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </Setting>
                </section>

                {/* GOOGLE DRIVE SYNC SECTION */}
                <section className="settings-group google-drive-settings" data-settings-tab="cloud">
                  <div className="settings-group-title">
                    <b>Облачная копия</b>
                    <span>Google Drive</span>
                  </div>
                  <div className={`cloud-settings-card ${cloudState}`} role="status" aria-live="polite">
                    <div className="cloud-settings-icon" aria-hidden="true">☁</div>
                    <div className="cloud-settings-copy">
                      <div className="cloud-settings-heading">
                        <b>{gdriveStatus?.connected ? (gdriveStatus.user_email || gdriveStatus.user_name || "Google Drive подключён") : "Сохранения на Google Drive"}</b>
                        <span className="cloud-settings-state"><i />{cloudTitle}</span>
                      </div>
                      <p>
                        {gdriveStatus?.connected
                          ? cloudDetail
                          : "Подключите свой аккаунт, чтобы хранить резервную копию прогресса, папок и настроек."}
                      </p>
                    </div>
                    <div className="cloud-settings-main-actions">
                      {gdriveStatus?.connected ? (
                        <button className="primary" onClick={() => handleSyncNow("merge")} disabled={cloudSyncing}>
                          {cloudSyncing ? "Сохраняем…" : cloudError ? "Повторить" : "Сохранить сейчас"}
                        </button>
                      ) : (
                        <button className="primary" onClick={handleConnectGDrive}>Подключить Google Drive</button>
                      )}
                    </div>
                  </div>

                  {gdriveStatus?.connected && (
                    <div className="cloud-settings-quick-options">
                      <label>
                        <span>
                          <b>Автосохранение</b>
                          <small>Локальная копия сохраняется всегда; здесь выбирается только момент отправки на Google Drive</small>
                        </span>
                        <select
                          value={autoSyncMode}
                          onChange={(event) => {
                            const value = event.target.value as "instant" | "interval" | "manual";
                            setAutoSyncMode(value);
                            write("animesoul:gdrive-auto-sync-mode", value);
                          }}
                        >
                          <option value="instant">Сразу после изменений</option>
                          <option value="interval">По расписанию</option>
                          <option value="manual">Только вручную</option>
                        </select>
                      </label>
                      {autoSyncMode === "interval" && (
                        <label>
                          <span>
                            <b>Интервал</b>
                            <small>Как часто отправлять накопившиеся локальные изменения в облако</small>
                          </span>
                          <select
                            value={autoSyncInterval}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              setAutoSyncInterval(value);
                              write("animesoul:gdrive-auto-sync-interval", value);
                            }}
                          >
                            <option value={1}>1 минута</option>
                            <option value={5}>5 минут</option>
                            <option value={15}>15 минут</option>
                            <option value={30}>30 минут</option>
                            <option value={60}>1 час</option>
                          </select>
                        </label>
                      )}
                    </div>
                  )}

                  {syncMessage && <div className="cloud-settings-message">{syncMessage}</div>}

                  {gdriveStatus?.connected ? (
                    <>
                      <details className="cloud-settings-details">
                        <summary>Перенос и восстановление</summary>
                        <div className="cloud-settings-details-body">
                          <p>
                            Обычное сохранение безопасно объединяет прогресс, избранное и папки. Кнопки ниже
                            нужны только для частичного переноса или полной замены одной из копий.
                          </p>
                          <div className="cloud-settings-action-grid">
                            <button onClick={() => handleSyncNow("anime_only")} disabled={cloudSyncing}>
                              <b>Только аниме и статистика</b>
                              <small>Перенести прогресс, папки и статистику, не меняя тему и настройки плеера</small>
                            </button>
                            <button onClick={() => handleSyncNow("cloud")} disabled={cloudSyncing}>
                              <b>Восстановить этот ПК</b>
                              <small>Полностью заменить локальный профиль последней облачной копией</small>
                            </button>
                            <button onClick={() => handleSyncNow("local")} disabled={cloudSyncing}>
                              <b>Перезаписать облако</b>
                              <small>Полностью заменить облачную копию текущими данными этого ПК</small>
                            </button>
                          </div>
                        </div>
                      </details>
                      <details className="cloud-settings-details">
                        <summary>Дополнительные настройки</summary>
                        <div className="cloud-settings-details-body">
                          <label className="cloud-settings-field">
                            <span>
                              <b>Папка на Google Drive</b>
                              <small>Видимую папку легко скопировать вручную; скрытое хранилище не засоряет корень Диска</small>
                            </span>
                            <select
                              value={folderMode}
                              onChange={(event) => {
                                const value = event.target.value as GDriveFolderMode;
                                setFolderMode(value);
                                write("animesoul:gdrive-folder-mode", value);
                              }}
                            >
                              <option value="visible">Видимая папка «AnimeSoul»</option>
                              <option value="appdata">Скрытое хранилище приложения</option>
                            </select>
                          </label>
                          <label className="cloud-settings-field">
                            <span>
                              <b>Приоритет отметки «просмотрено»</b>
                              <small>Если серия просмотрена хотя бы на одном устройстве, объединение не откатит её статус</small>
                            </span>
                            <Toggle
                              label="Включено"
                              value={preferWatched}
                              onChange={(value) => {
                                setPreferWatched(value);
                                write("animesoul:gdrive-prefer-watched", value);
                              }}
                            />
                          </label>
                          <button className="cloud-settings-disconnect" onClick={handleDisconnectGDrive}>Отключить Google Drive</button>
                        </div>
                      </details>
                    </>
                  ) : (
                    <details className="cloud-settings-details">
                      <summary>Не получается подключиться?</summary>
                      <div className="cloud-settings-details-body">
                        <p>Обычно достаточно кнопки выше. Собственные OAuth-ключи нужны только если стандартное подключение недоступно.</p>
                        <button className="cloud-settings-text-button" onClick={() => setShowCredsInput(!showCredsInput)}>
                          {showCredsInput ? "Скрыть OAuth-поля" : "Настроить собственный OAuth Client ID"}
                        </button>
                        {showCredsInput && (
                          <div className="cloud-settings-credentials">
                            <label><span>Client ID</span><input className="settings-text-input" value={clientIdInput} onChange={(event) => setClientIdInput(event.target.value)} placeholder="xxx.apps.googleusercontent.com" /></label>
                            <label><span>Client Secret (необязательно)</span><input type="password" className="settings-text-input" value={clientSecretInput} onChange={(event) => setClientSecretInput(event.target.value)} placeholder="GOCSPX-…" /></label>
                            <button onClick={handleSaveCredentials}>Сохранить OAuth-ключи</button>
                          </div>
                        )}
                      </div>
                    </details>
                  )}

                  {false && (<>
                  <div className={`cloud-sync-card ${cloudState}`} role="status" aria-live="polite">
                    <i />
                    <div>
                      <b>{cloudTitle}</b>
                      <span>{cloudDetail}</span>
                      <small>Сначала AnimeSoul сохраняет данные на этом ПК, затем подтверждает отдельную облачную копию.</small>
                    </div>
                  </div>
                  <Setting
                    title="Статус подключения"
                    description={
                      gdriveStatus?.connected
                        ? `Аккаунт: ${gdriveStatus?.user_email || gdriveStatus?.user_name || "Google"}`
                        : "Подключите ваш аккаунт Google, чтобы сохранения автоматически дублировались на Google Диск."
                    }
                    example="Основная кнопка объединяет файлы без удаления данных."
                  >
                    <div className="settings-profile-actions">
                      {gdriveStatus?.connected ? (
                        <>
                          <button
                            onClick={() => handleSyncNow("merge")}
                            disabled={syncing}
                            style={{ background: "var(--accent)", color: "#fff", fontWeight: 600 }}
                          >
                            {syncing ? "Синхронизация..." : "🔄 Синхронизировать сейчас (Объединить)"}
                          </button>
                          <button
                            onClick={() => handleSyncNow("anime_only")}
                            disabled={syncing}
                            style={{ background: "#2e1e3b", borderColor: "#8b5cf6" }}
                            title="Синхронизировать серии и папки без затрагивания темы оформления и настроек плеера"
                          >
                            🎬 Только аниме и статистика
                          </button>
                          <button onClick={handleDisconnectGDrive} style={{ background: "#3b1e22" }}>
                            Отключить
                          </button>
                        </>
                      ) : (
                        <button onClick={handleConnectGDrive}>
                          🌐 Подключить Google Диск
                        </button>
                      )}
                    </div>
                  </Setting>

                  {gdriveStatus?.connected && (
                    <details
                      style={{
                        margin: "8px 0 14px",
                        padding: "12px 14px",
                        background: "#161220",
                        border: "1px solid #2e243b",
                        borderRadius: "10px",
                        fontSize: "12px",
                      }}
                    >
                      <summary style={{ cursor: "pointer", color: "#a78bfa", fontWeight: 600 }}>
                        ⚙️ Принудительная перезапись (для нового ПК или сброса облака)
                      </summary>
                      <div style={{ marginTop: "12px", display: "grid", gap: "12px" }}>
                        <div style={{ background: "#1c1828", padding: "10px 12px", borderRadius: "8px", border: "1px solid #332747" }}>
                          <b style={{ color: "#60a5fa", display: "block", marginBottom: "4px" }}>
                            ☁ Взять ВСЁ из облака (Облако → ПК)
                          </b>
                          <p style={{ margin: "0 0 8px", color: "#94a3b8", fontSize: "11px", lineHeight: "1.4" }}>
                            Загружает темы, настройки плеера и просмотренные серии с Google Диска, <b>заменяя</b> несинхронизированные данные на этом ПК.
                          </p>
                          <button
                            onClick={() => handleSyncNow("cloud")}
                            disabled={syncing}
                            style={{ background: "#1e293b", borderColor: "#3b82f6", padding: "6px 12px", fontSize: "11px" }}
                          >
                            Загрузить данные из облака на этот ПК
                          </button>
                        </div>

                        <div style={{ background: "#1c1828", padding: "10px 12px", borderRadius: "8px", border: "1px solid #332747" }}>
                          <b style={{ color: "#4ade80", display: "block", marginBottom: "4px" }}>
                            💻 Перезаписать облако с этого ПК (ПК → Облако)
                          </b>
                          <p style={{ margin: "0 0 8px", color: "#94a3b8", fontSize: "11px", lineHeight: "1.4" }}>
                            Отправляет текущие настройки, стили и серии с этого ПК в облако, <b>перезаписывая</b> файл на Google Диске.
                          </p>
                          <button
                            onClick={() => handleSyncNow("local")}
                            disabled={syncing}
                            style={{ background: "#1c261e", borderColor: "#22c55e", padding: "6px 12px", fontSize: "11px" }}
                          >
                            Выгрузить данные с этого ПК в облако
                          </button>
                        </div>
                      </div>
                    </details>
                  )}

                  <div
                    style={{
                      background: "#191424",
                      border: "1px solid #332742",
                      borderRadius: "10px",
                      padding: "14px 16px",
                      margin: "10px 0 16px",
                      fontSize: "12px",
                      lineHeight: "1.5",
                      color: "#c4b5fd",
                    }}
                  >
                    <b style={{ color: "#a78bfa", display: "block", marginBottom: "4px" }}>
                      💡 Как работает обычное «Объединение» (Приоритеты):
                    </b>
                    • <b>Аниме и серии:</b> ОБЪЕДИНЯЮТСЯ (приоритет у просмотренного — просмотренные серии сохранятся с обоих устройств).<br />
                    • <b>Избранное и папки:</b> ОБЪЕДИНЯЮТСЯ (списки суммируются без потерь).<br />
                    • <b>Настройки и стили:</b> Сохраняются настройки <b>текущего ПК</b> (чтобы цвета темы не сбрасывались неожиданно при каждом сохранении).<br />
                    <span style={{ color: "#94a3b8", display: "block", marginTop: "6px" }}>
                      <i>Зачем нужны 2 принудительные кнопки выше? Они используются только тогда, когда вы хотите полностью скопировать профиль на новый ПК (Облако → ПК) или затереть облако с текущего ПК (ПК → Облако).</i>
                    </span>
                  </div>

                  {gdriveStatus?.connected && (
                    <>
                      <Setting
                        title="Режим автоматической выгрузки"
                        description="Выберите, когда выгружаются сохранения на Google Диск."
                        example="«Мгновенно» дублирует файлы при каждом изменении, «По расписанию» — каждые N минут."
                      >
                        <select
                          value={autoSyncMode}
                          onChange={(e) => {
                            const val = e.target.value as "instant" | "interval" | "manual";
                            setAutoSyncMode(val);
                            write("animesoul:gdrive-auto-sync-mode", val);
                          }}
                        >
                          <option value="instant">Мгновенно (при каждом изменении локально)</option>
                          <option value="interval">По расписанию (интервал)</option>
                          <option value="manual">Только вручную (по кнопке)</option>
                        </select>
                      </Setting>

                      {autoSyncMode === "interval" && (
                        <Setting
                          title="Интервал автосинхронизации"
                          description="Частота автоматической фоновой выгрузки сохранений в облако."
                          example="При значении «15 минут» приложение синхронизирует прогресс 4 раза в час."
                        >
                          <select
                            value={autoSyncInterval}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setAutoSyncInterval(val);
                              write("animesoul:gdrive-auto-sync-interval", val);
                            }}
                          >
                            <option value={1}>Каждую 1 минуту</option>
                            <option value={5}>Каждые 5 минут</option>
                            <option value={15}>Каждые 15 минут</option>
                            <option value={30}>Каждые 30 минут</option>
                            <option value={60}>Каждый 1 час</option>
                          </select>
                        </Setting>
                      )}

                      <Setting
                        title="Место хранения на Диске"
                        description="Выбор между обычной пользовательской папкой в корне Google Диска и скрытым хранилищем приложений."
                        example="Папка «AnimeSoul» видна на Диске и удобна для ручного копирования."
                      >
                        <select
                          value={folderMode}
                          onChange={(e) => {
                            const val = e.target.value as GDriveFolderMode;
                            setFolderMode(val);
                            write("animesoul:gdrive-folder-mode", val);
                          }}
                        >
                          <option value="visible">Обычная папка «AnimeSoul» (в корне)</option>
                          <option value="appdata">Скрытая папка приложений (appDataFolder)</option>
                        </select>
                      </Setting>

                      <Setting
                        title="Приоритет просмотренного при синхронизации"
                        description="Если аниме или серия помечены просмотренными в облаке или локально, при объединении статус останется просмотренным."
                        example="Просмотренные в облаке серии сохранят свой статус даже при чистом локальном сохранении."
                      >
                        <Toggle
                          label="Включён"
                          value={preferWatched}
                          onChange={(val) => {
                            setPreferWatched(val);
                            write("animesoul:gdrive-prefer-watched", val);
                          }}
                        />
                      </Setting>
                    </>
                  )}

                  {syncMessage && (
                    <div
                      style={{
                        padding: "10px 14px",
                        margin: "10px 0",
                        borderRadius: "8px",
                        background: "#1c1825",
                        border: "1px solid var(--accent)",
                        color: "#dcd4ed",
                        fontSize: "12px",
                      }}
                    >
                      {syncMessage}
                    </div>
                  )}

                  {/* CUSTOM OAUTH CREDENTIALS SETTING */}
                  <div style={{ marginTop: "12px" }}>
                    <button
                      onClick={() => setShowCredsInput(!showCredsInput)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#9a78ff",
                        cursor: "pointer",
                        fontSize: "11px",
                        padding: 0,
                      }}
                    >
                      {showCredsInput ? "▲ Скрыть настройки OAuth Client ID" : "▼ Настройка собственных OAuth ключей (Client ID)"}
                    </button>

                    {showCredsInput && (
                      <div
                        style={{
                          marginTop: "10px",
                          padding: "14px",
                          borderRadius: "10px",
                          background: "#14111a",
                          border: "1px solid #31283e",
                          display: "grid",
                          gap: "10px",
                        }}
                      >
                        <p style={{ margin: 0, fontSize: "11px", color: "#a59cb0" }}>
                          Введите ваш Google OAuth 2.0 Client ID и Secret из Google Cloud Console (тип авторизации: Desktop/Web application).
                        </p>
                        <div>
                          <label style={{ fontSize: "11px", color: "#ccc" }}>Client ID:</label>
                          <input
                            className="settings-text-input"
                            style={{ width: "100%", marginTop: "4px" }}
                            value={clientIdInput}
                            onChange={(e) => setClientIdInput(e.target.value)}
                            placeholder="xxx.apps.googleusercontent.com"
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: "11px", color: "#ccc" }}>Client Secret (опционально):</label>
                          <input
                            type="password"
                            className="settings-text-input"
                            style={{ width: "100%", marginTop: "4px" }}
                            value={clientSecretInput}
                            onChange={(e) => setClientSecretInput(e.target.value)}
                            placeholder="GOCSPX-..."
                          />
                        </div>
                        <button
                          onClick={handleSaveCredentials}
                          style={{
                            padding: "8px 14px",
                            borderRadius: "6px",
                            background: "var(--accent)",
                            color: "#fff",
                            border: "none",
                            cursor: "pointer",
                            fontWeight: 600,
                            justifySelf: "start",
                          }}
                        >
                          Сохранить ключи
                        </button>
                      </div>
                    )}
                  </div>
                  </>)}
                </section>

                <section className="settings-group" data-settings-tab="appearance">
                  <div className="settings-group-title">
                    <b>Персонализация интерфейса</b>
                    <span>Размеры элементов и цвет просмотренных серий</span>
                  </div>
                  <Setting
                    title="Цвет просмотренной серии"
                    description="Меняет рамку, фон и номер серии, которая уже была просмотрена."
                  >
                    <div className="settings-color-value">
                      <input
                        type="color"
                        value={props.playerPrefs.watchedEpisodeColor}
                        onChange={(event) => setPrefs({ watchedEpisodeColor: event.target.value })}
                      />
                      <code>{props.playerPrefs.watchedEpisodeColor}</code>
                    </div>
                  </Setting>
                  <Setting
                    title="Размер обычного текста"
                    description="Масштабирует подписи карточек, метаданные, кнопки и вспомогательный текст."
                    searchTerms={"\u0448\u0440\u0438\u0444\u0442 \u0448\u0440\u0438\u0444\u0442\u0430 \u043c\u0430\u0441\u0448\u0442\u0430\u0431 \u0442\u0435\u043a\u0441\u0442\u0430"}
                  >
                    <label className="settings-range">
                      <input
                        type="range"
                        min="85"
                        max="125"
                        step="5"
                        value={Math.round(props.playerPrefs.interfaceFontScale * 100)}
                        onChange={(event) =>
                          setPrefs({ interfaceFontScale: Number(event.target.value) / 100 })
                        }
                      />
                      <b>{Math.round(props.playerPrefs.interfaceFontScale * 100)}%</b>
                    </label>
                  </Setting>
                  <Setting
                    title="Размер заголовков"
                    description="Отдельно изменяет крупные названия страниц, аниме и разделов."
                  >
                    <label className="settings-range">
                      <input
                        type="range"
                        min="80"
                        max="125"
                        step="5"
                        value={Math.round(props.playerPrefs.headingFontScale * 100)}
                        onChange={(event) =>
                          setPrefs({ headingFontScale: Number(event.target.value) / 100 })
                        }
                      />
                      <b>{Math.round(props.playerPrefs.headingFontScale * 100)}%</b>
                    </label>
                  </Setting>
                  <Setting
                    title="Размер обложек"
                    description="Меняет высоту постеров в каталоге, не нарушая сетку карточек."
                  >
                    <label className="settings-range">
                      <input
                        type="range"
                        min="80"
                        max="130"
                        step="5"
                        value={Math.round(props.playerPrefs.posterScale * 100)}
                        onChange={(event) =>
                          setPrefs({ posterScale: Number(event.target.value) / 100 })
                        }
                      />
                      <b>{Math.round(props.playerPrefs.posterScale * 100)}%</b>
                    </label>
                  </Setting>
                  <Setting
                    title="Размер предпросмотра"
                    description="Меняет карточку продолжения просмотра на главной странице."
                  >
                    <label className="settings-range">
                      <input
                        type="range"
                        min="80"
                        max="130"
                        step="5"
                        value={Math.round(props.playerPrefs.previewScale * 100)}
                        onChange={(event) =>
                          setPrefs({ previewScale: Number(event.target.value) / 100 })
                        }
                      />
                      <b>{Math.round(props.playerPrefs.previewScale * 100)}%</b>
                    </label>
                  </Setting>
                </section>

                <section className="settings-group" data-settings-tab="party">
                  <div className="settings-group-title">
                    <b>Совместный просмотр</b>
                    <span>Комнаты через Hamachi, Tailscale или домашнюю сеть</span>
                  </div>
                  <Setting
                    title="Разрешить совместный режим"
                    description="Добавляет в настройки плеера создание комнаты, подключение по коду и список участников. Видео загружается отдельно у каждого человека."
                  >
                    <Toggle
                      label="Включён"
                      value={props.playerPrefs.watchPartyEnabled}
                      onChange={(value) => setPrefs({ watchPartyEnabled: value })}
                    />
                  </Setting>
                  <Setting
                    title="Имя участника"
                    description="Это имя увидят остальные люди в комнате."
                  >
                    <input
                      className="settings-text-input"
                      value={props.playerPrefs.watchPartyName}
                      maxLength={32}
                      onChange={(event) => setPrefs({ watchPartyName: event.target.value })}
                    />
                  </Setting>
                  <Setting
                    title="Адрес комнаты"
                    description="Хост оставляет локальный адрес. Участник вводит IP компьютера хоста в Hamachi или Tailscale и порт 3002."
                    example="http://25.10.20.30:3002"
                  >
                    <input
                      className="settings-text-input"
                      value={props.playerPrefs.watchPartyServer}
                      onChange={(event) => setPrefs({ watchPartyServer: event.target.value })}
                    />
                  </Setting>
                  <Setting
                    title="Правило комнаты"
                    description="Выбирается хостом. В первом режиме только хост управляет синхронизированными участниками. Во втором любой синхронизированный участник может поставить паузу, запустить, перемотать или сменить серию у всех."
                    example="Перед началом просмотра хост выбирает: «Все следуют за хостом» или «Все управляют на равных»."
                  >
                    <select
                      value={props.playerPrefs.watchPartyRoomMode}
                      onChange={(event) =>
                        setPrefs({
                          watchPartyRoomMode: event.target.value as "host" | "shared",
                        })
                      }
                    >
                      <option value="host">Все следуют за хостом</option>
                      <option value="shared">Все управляют на равных</option>
                    </select>
                  </Setting>
                  <Setting
                    title="Мой личный режим"
                    description="Синхронизированный режим подчиняется правилу комнаты. Свободный просмотр доступен каждому участнику в любой момент и временно отделяет только его плеер от общих команд."
                    example="При медленном интернете включи свободный режим, дождись загрузки и затем нажми «Перейти к общему таймкоду»."
                  >
                    <select
                      value={props.playerPrefs.watchPartyMode}
                      onChange={(event) =>
                        setPrefs({
                          watchPartyMode: event.target.value as "follow" | "free",
                        })
                      }
                    >
                      <option value="follow">Следовать за хостом</option>
                      <option value="free">Свободный просмотр / Режим медленного интернета</option>
                    </select>
                  </Setting>
                  <Setting
                    title="Озвучка в комнате"
                    description="Своя озвучка не меняется. Режим предложения показывает выбор при смене озвучки хостом. Полное следование переключает её автоматически, если такая озвучка доступна у участника."
                    example="Хост выбрал AniLibria — можно переключиться одним нажатием или оставить свою озвучку."
                  >
                    <select
                      value={props.playerPrefs.watchPartyDubMode}
                      onChange={(event) =>
                        setPrefs({
                          watchPartyDubMode: event.target.value as "own" | "suggest" | "follow",
                        })
                      }
                    >
                      <option value="own">Своя у каждого</option>
                      <option value="suggest">Предлагать озвучку хоста</option>
                      <option value="follow">Следовать за озвучкой хоста</option>
                    </select>
                  </Setting>
                  <Setting
                    title="Автоматически догонять хоста"
                    description="При расхождении больше пяти секунд плеер перематывается на позицию хоста. При выключении доступна ручная кнопка «Догнать»."
                  >
                    <Toggle
                      label="Включено"
                      value={props.playerPrefs.watchPartyAutoCatchUp}
                      onChange={(value) => setPrefs({ watchPartyAutoCatchUp: value })}
                    />
                  </Setting>
                  <Setting
                    title="Положение участников"
                    description="Определяет, где рядом с плеером показывается состояние комнаты."
                  >
                    <select
                      value={props.playerPrefs.watchPartyPanelPosition}
                      onChange={(event) =>
                        setPrefs({
                          watchPartyPanelPosition: event.target.value as "top" | "bottom" | "overlay",
                        })
                      }
                    >
                      <option value="top">Над плеером</option>
                      <option value="bottom">Под плеером</option>
                      <option value="overlay">Поверх плеера</option>
                    </select>
                  </Setting>
                  <details className="watch-party-guide">
                    <summary>
                      <span>
                        <b>Как запустить совместный просмотр</b>
                        <small>Инструкция для хоста и участников · решение проблем</small>
                      </span>
                      <i>⌄</i>
                    </summary>
                    <div className="watch-party-guide-content">
                      <section>
                        <h3>Что понадобится</h3>
                        <ol>
                          <li>У каждого участника должна быть установлена и запущена AnimeSoul.</li>
                          <li>
                            Все должны находиться в одной виртуальной сети либо в одной домашней сети.
                            Скачать: <a href="https://vpn.net/" target="_blank" rel="noreferrer">Hamachi</a> или{" "}
                            <a href="https://tailscale.com/download/windows" target="_blank" rel="noreferrer">
                              Tailscale
                            </a>
                            .
                          </li>
                          <li>
                            На компьютере хоста локальный сервер AnimeSoul должен быть доступен на порту{" "}
                            <code>3002</code>.
                          </li>
                          <li>
                            Одинаковые файлы сохранений не нужны: видео и прогресс у каждого загружаются
                            независимо.
                          </li>
                        </ol>
                      </section>
                      <section>
                        <h3>Хост: создание комнаты</h3>
                        <ol>
                          <li>Запусти AnimeSoul через штатный BAT-файл или десктопное приложение.</li>
                          <li>
                            Оставь адрес комнаты <code>http://127.0.0.1:3002</code>.
                          </li>
                          <li>Открой нужное аниме, включи «Совместный режим» в настройках плеера.</li>
                          <li>Выбери правило комнаты: управление только хостом или равноправное управление.</li>
                          <li>Нажми «Создать комнату» и отправь появившийся код друзьям.</li>
                          <li>
                            При необходимости роль хоста можно передать любому подключённому участнику прямо
                            в списке комнаты.
                          </li>
                        </ol>
                      </section>
                      <section>
                        <h3>Участник: подключение</h3>
                        <ol>
                          <li>
                            Узнай виртуальный IP хоста в Hamachi/Tailscale, например <code>25.10.20.30</code>.
                          </li>
                          <li>
                            В поле «Адрес комнаты» укажи <code>http://25.10.20.30:3002</code>.
                          </li>
                          <li>Открой то же аниме, включи совместный режим и введи полученный код комнаты.</li>
                          <li>
                            Выбери личный режим. «Свободный просмотр / Режим медленного интернета» доступен
                            всегда, независимо от правила комнаты.
                          </li>
                        </ol>
                      </section>
                      <section>
                        <h3>Как работают режимы</h3>
                        <dl>
                          <div>
                            <dt>Все следуют за хостом</dt>
                            <dd>
                              Только хост управляет общим запуском, паузой, серией и таймкодом. Остальные
                              синхронизированные участники повторяют его действия.
                            </dd>
                          </div>
                          <div>
                            <dt>Все управляют на равных</dt>
                            <dd>
                              Любой участник в синхронизированном режиме может поставить видео на паузу,
                              продолжить, перемотать или выбрать серию — команда применяется у всех
                              синхронизированных участников.
                            </dd>
                          </div>
                          <div>
                            <dt>Свободный просмотр / медленный интернет</dt>
                            <dd>
                              Это не правило комнаты, а личный режим. Он доступен всем, включая хоста, в любой
                              момент. Общие команды не двигают твой плеер, а твои действия не мешают остальным.
                              Таймкоды участников остаются видны, вернуться можно кнопкой «Перейти к общему
                              таймкоду».
                            </dd>
                          </div>
                          <div>
                            <dt>Передача хоста</dt>
                            <dd>
                              Текущий хост нажимает «Передать хоста» рядом с именем участника. Новый хост сразу
                              получает право менять правило комнаты; при выходе хоста роль автоматически
                              передаётся одному из оставшихся участников.
                            </dd>
                          </div>
                          <div>
                            <dt>Своя озвучка</dt>
                            <dd>
                              У каждого остаётся выбранная им озвучка. Серия синхронизируется, но голосовая
                              дорожка не меняется.
                            </dd>
                          </div>
                          <div>
                            <dt>Предлагать озвучку хоста</dt>
                            <dd>
                              При смене озвучки появляется предложение «Переключиться» или «Оставить мою». Без
                              подтверждения AnimeSoul ничего не меняет.
                            </dd>
                          </div>
                          <div>
                            <dt>Следовать за озвучкой хоста</dt>
                            <dd>
                              Озвучка меняется автоматически, если она доступна для этой серии. При отсутствии
                              AnimeSoul оставляет доступную локальную озвучку и показывает предупреждение.
                            </dd>
                          </div>
                        </dl>
                      </section>
                      <section>
                        <h3>Совместимость видеоплееров</h3>
                        <dl>
                          <div>
                            <dt>Kodik</dt>
                            <dd>
                              Поддерживает полную синхронизацию AnimeSoul: серия, озвучка, запуск, пауза,
                              перемотка и точный таймкод.
                            </dd>
                          </div>
                          <div>
                            <dt>Другие источники</dt>
                            <dd>
                              Выбор серии и озвучки синхронизируется нашей оболочкой. Пауза, запуск, перемотка
                              и точный таймкод работают только тогда, когда встроенный плеер отдаёт совместимые
                              события управления.
                            </dd>
                          </div>
                          <div>
                            <dt>Почему у участников может быть разный результат</dt>
                            <dd>
                              Набор озвучек и источников иногда отличается между сериями. Для предсказуемого
                              совместного просмотра всем участникам рекомендуется выбрать Kodik.
                            </dd>
                          </div>
                        </dl>
                      </section>
                      <section className="watch-party-troubleshooting">
                        <h3>Проблемы и решения</h3>
                        <dl>
                          <div>
                            <dt>«Сервер комнаты недоступен» или Not found</dt>
                            <dd>
                              Полностью перезапусти AnimeSoul. Убедись, что адрес заканчивается на{" "}
                              <code>:3002</code>, а не на порт сайта <code>:3001</code>.
                            </dd>
                          </div>
                          <div>
                            <dt>Друг не подключается</dt>
                            <dd>
                              Проверь, что вы видите друг друга в Hamachi/Tailscale. Разреши Node.js/AnimeSoul в
                              брандмауэре Windows для частных сетей и открой TCP-порт 3002.
                            </dd>
                          </div>
                          <div>
                            <dt>Высокий пинг</dt>
                            <dd>
                              Переключись в свободный режим. Пинг комнаты показан в верхнем баре; он относится
                              к командам синхронизации, а не к скорости загрузки видео.
                            </dd>
                          </div>
                          <div>
                            <dt>Видео у друга загружается медленнее</dt>
                            <dd>
                              Это не останавливает остальных: каждый получает видео от источника отдельно.
                              </dd>
                          </div>
                        </dl>
                      </section>
                    </div>
                  </details>
                </section>
                <section className="settings-group settings-debug-group" data-settings-tab="debug">
                  <div className="settings-group-title">
                    <b>Журнал отладки</b>
                    <span>Все важные действия, статусы и ошибки текущего устройства</span>
                  </div>
                  <DebugPanel />
                </section>
                  </div>
                  </SettingsSearchContext.Provider>
                </main>
              </div>
            </section>
          </div>,
          document.body
        )}

      {/* INITIAL SYNC SOURCE SELECTION MODAL */}
      {initialChoiceModal &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 100000,
              background: "rgba(8, 6, 14, 0.85)",
              backdropFilter: "blur(10px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                background: "#181422",
                border: "1px solid #382c48",
                borderRadius: "20px",
                padding: "24px 28px",
                maxWidth: "560px",
                maxHeight: "90vh",
                overflowY: "auto",
                width: "100%",
                textAlign: "left",
                boxShadow: "0 25px 60px rgba(0,0,0,0.85)",
                color: "#e2e8f0",
                boxSizing: "border-box",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <h3 style={{ margin: 0, color: "#a78bfa", fontSize: "20px", fontWeight: 700 }}>
                  🌐 Подключение Google Диска
                </h3>
                <button
                  onClick={() => setInitialChoiceModal(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#94a3b8",
                    fontSize: "20px",
                    cursor: "pointer",
                    padding: "4px 8px",
                  }}
                >
                  ✕
                </button>
              </div>
              <p style={{ color: "#94a3b8", fontSize: "12px", lineHeight: "1.5", margin: "0 0 16px" }}>
                На вашем Google Диске найдены ранее сохранённые данные! Выберите один из режимов синхронизации:
              </p>
              <div style={{ display: "grid", gap: "10px" }}>
                <button
                  onClick={() => handleSyncNow("merge")}
                  disabled={syncing}
                  className="sync-choice-btn sync-choice-btn-primary"
                >
                  <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px" }}>
                    🔄 Умное объединение (Рекомендуется)
                  </div>
                  <div style={{ fontSize: "11px", opacity: 0.95, lineHeight: "1.4" }}>
                    • <b>Настройки и темы:</b> Объединяются параметры ПК и облака.<br />
                    • <b>Прогресс аниме:</b> Просмотренные серии с обоих устройств сохранятся (приоритет просмотренного).
                  </div>
                </button>

                <button
                  onClick={() => handleSyncNow("anime_only")}
                  disabled={syncing}
                  className="sync-choice-btn sync-choice-btn-purple"
                >
                  <div style={{ fontWeight: 700, fontSize: "14px", color: "#c4b5fd", marginBottom: "4px" }}>
                    🎬 Синхронизировать ТОЛЬКО аниме и статистику (Игнорировать темы)
                  </div>
                  <div style={{ fontSize: "11px", color: "#cbd5e1", lineHeight: "1.4" }}>
                    • <b>Прогресс аниме:</b> Серии, избранное и папки объединятся.<br />
                    • <b>Настройки и темы:</b> Темы и плеер на этом ПК останутся на 100% нетронутыми!
                  </div>
                </button>

                <button
                  onClick={() => handleSyncNow("cloud")}
                  disabled={syncing}
                  className="sync-choice-btn sync-choice-btn-blue"
                >
                  <div style={{ fontWeight: 700, fontSize: "14px", color: "#60a5fa", marginBottom: "4px" }}>
                    ☁ Взять ВСЕ настройки и прогресс из облака (Облако → ПК)
                  </div>
                  <div style={{ fontSize: "11px", color: "#cbd5e1", lineHeight: "1.4" }}>
                    • <b>Настройки и темы:</b> Темы, цвета и плеер заменятся на настройки из Google Диска.<br />
                    • <b>Прогресс аниме:</b> Все просмотренные серии и списки загрузятся из облака.<br />
                    <strong style={{ color: "#f87171" }}>⚠️ Внимание:</strong> Локальные данные на этом ПК будут заменены файлом из облака.
                  </div>
                </button>

                <button
                  onClick={() => handleSyncNow("local")}
                  disabled={syncing}
                  className="sync-choice-btn sync-choice-btn-green"
                >
                  <div style={{ fontWeight: 700, fontSize: "14px", color: "#4ade80", marginBottom: "4px" }}>
                    💻 Оставить локальные настройки и прогресс (ПК → Облако)
                  </div>
                  <div style={{ fontSize: "11px", color: "#cbd5e1", lineHeight: "1.4" }}>
                    • <b>Настройки и темы:</b> Текущая тема, цвета и параметры с этого ПК выгрузятся в облако.<br />
                    • <b>Прогресс аниме:</b> Текущий локальный список аниме и серии выгрузятся на Google Диск.<br />
                    <strong style={{ color: "#fbbf24" }}>⚠️ Внимание:</strong> Файл на Google Диске перезапишется данными с этого ПК.
                  </div>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
