"use client";

import { useState } from "react";
import {
  completeGDriveAuth,
  disconnectGDrive,
  fetchGDriveAuthUrl,
  fetchGDriveStatus,
  saveGDriveCredentials,
  syncGDrive,
  type GDriveFolderMode,
  type GDriveStatus,
  type GDriveSyncMode,
} from "../../lib/gdrive";
import { readLocal as read, writeLocal as write } from "../../lib/storage";

type Options = {
  onStorageReload?: () => void;
};

/**
 * Owns Google Drive settings, connection state and explicit sync commands.
 *
 * Keeping this lifecycle outside the settings modal makes the UI component a
 * coordinator instead of mixing OAuth, persistence and presentation logic.
 */
export function useGoogleDriveSettings({ onStorageReload }: Options) {
  const [gdriveStatus, setGDriveStatus] = useState<GDriveStatus | null>(null);
  const [folderMode, setFolderMode] = useState<GDriveFolderMode>(() =>
    read("animesoul:gdrive-folder-mode", "visible"),
  );
  const [preferWatched, setPreferWatched] = useState<boolean>(() =>
    read("animesoul:gdrive-prefer-watched", true),
  );
  const [autoSyncMode, setAutoSyncMode] = useState<"instant" | "interval" | "manual">(() =>
    read("animesoul:gdrive-auto-sync-mode", "instant"),
  );
  const [autoSyncInterval, setAutoSyncInterval] = useState<number>(() =>
    read("animesoul:gdrive-auto-sync-interval", 15),
  );
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [showCredsInput, setShowCredsInput] = useState(false);
  const [clientIdInput, setClientIdInput] = useState("");
  const [clientSecretInput, setClientSecretInput] = useState("");
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  const [credentialsMessage, setCredentialsMessage] = useState("");
  const [credentialsTone, setCredentialsTone] = useState<"success" | "error">("success");
  const [initialChoiceModal, setInitialChoiceModal] = useState(false);

  const loadGDriveStatus = async () => {
    try {
      let status = await fetchGDriveStatus();
      if (status.oauth_pending) {
        setSyncMessage("Завершаем подключение Google Drive…");
        const completed = await completeGDriveAuth();
        status = await fetchGDriveStatus();
        if (completed.connected) {
          setSyncMessage(`Google Drive подключён${completed.user_email ? `: ${completed.user_email}` : ""}.`);
        }
      }
      setGDriveStatus(status);
      write("animesoul:gdrive-has-cloud-file", status.has_cloud_file ?? false);
      if (!status.has_credentials) {
        setShowCredsInput(true);
      }

      if (status.connected) {
        if (status.choice_pending) {
          write("animesoul:gdrive-initial-choice-done", false);
          setInitialChoiceModal(true);
        } else if (!status.has_cloud_file) {
          write("animesoul:gdrive-initial-choice-done", true);
        } else if (!read("animesoul:gdrive-initial-choice-done", false)) {
          setInitialChoiceModal(true);
        }
      }

      setClientIdInput(status.client_id || "");
    } catch (error: unknown) {
      setSyncMessage(error instanceof Error ? error.message : "Не удалось проверить Google Drive");
    }
  };

  const connect = async () => {
    setSyncMessage("");
    try {
      const { url } = await fetchGDriveAuthUrl();
      window.open(url, "gdrive_auth", "width=600,height=700");
    } catch (error: unknown) {
      setSyncMessage(error instanceof Error ? error.message : "Ошибка получения URL авторизации");
      setShowCredsInput(true);
    }
  };

  const disconnect = async () => {
    if (!confirm("Отключить синхронизацию с Google Диском?")) return;
    try {
      await disconnectGDrive();
      setGDriveStatus(null);
      write("animesoul:gdrive-initial-choice-done", false);
      write("animesoul:gdrive-has-cloud-file", false);
      setSyncMessage("Google Диск отключен");
    } catch (error: unknown) {
      setSyncMessage(error instanceof Error ? error.message : "Ошибка отключения");
    }
  };

  const saveCredentials = async () => {
    if (!clientIdInput.trim()) {
      setCredentialsTone("error");
      setCredentialsMessage("Введите Google OAuth Client ID.");
      return;
    }
    setCredentialsSaving(true);
    setCredentialsMessage("");
    try {
      await saveGDriveCredentials(clientIdInput.trim(), clientSecretInput.trim());
      await loadGDriveStatus();
      setShowCredsInput(false);
      setClientSecretInput("");
      setCredentialsTone("success");
      setCredentialsMessage("Google OAuth сохранён на этом устройстве. Теперь можно подключить аккаунт.");
      setSyncMessage("Google OAuth сохранён.");
    } catch (error: unknown) {
      setCredentialsTone("error");
      setCredentialsMessage(error instanceof Error ? error.message : "Ошибка сохранения Google OAuth.");
    } finally {
      setCredentialsSaving(false);
    }
  };

  const syncNow = async (
    mode: GDriveSyncMode = "auto",
    resolveInitialChoice = false,
  ) => {
    if (gdriveStatus?.choice_pending && !resolveInitialChoice) {
      setInitialChoiceModal(true);
      setSyncMessage("Выберите, как объединить найденное облачное сохранение.");
      return;
    }
    if (
      mode === "cloud" &&
      !confirm(
        "Вы уверены? Все текущие локальные настройки и прогресс на этом ПК БУДУТ СТЁРТЫ и заменены данными из Google Диска!",
      )
    ) {
      return;
    }
    if (
      mode === "local" &&
      !confirm(
        "Вы уверены? Облачный файл на Google Диске БУДЕТ ПЕРЕЗАПИСАН локальными данными и настройками с этого ПК!",
      )
    ) {
      return;
    }

    setSyncing(true);
    setSyncMessage("Синхронизация...");
    try {
      const result = await syncGDrive(
        mode,
        preferWatched,
        folderMode,
        resolveInitialChoice,
      );
      write("animesoul:gdrive-initial-choice-done", true);
      setGDriveStatus(current => current ? {
        ...current,
        choice_pending: false,
        has_cloud_file: true,
      } : current);
      setSyncMessage(
        mode === "anime_only"
          ? "Аниме и статистика синхронизированы без изменения настроек!"
          : result.status === "merged"
            ? "Сохранения и настройки успешно объединены!"
            : result.status === "uploaded"
              ? "Локальные настройки выгружены на Диск!"
              : "Сохранения и настройки загружены из облака!",
      );
      onStorageReload?.();
      setInitialChoiceModal(false);
    } catch (error: unknown) {
      setSyncMessage(error instanceof Error ? error.message : "Ошибка синхронизации");
    } finally {
      setSyncing(false);
    }
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
  const cloudTitle =
    cloudState === "disconnected"
      ? "Не подключено"
      : cloudState === "syncing"
        ? "Сохраняем…"
        : cloudState === "error"
          ? "Ошибка синхронизации"
          : cloudState === "synced"
            ? "Сохранено"
            : "Готово";
  const cloudDetail =
    cloudState === "disconnected"
      ? "Подключите аккаунт ниже, чтобы прогресс, папки и настройки дублировались в облаке."
      : cloudState === "syncing"
        ? "Локальная копия уже сохранена. Можно продолжать пользоваться сайтом — загрузка идёт в фоне."
        : cloudState === "error"
          ? `${cloudError}. Локальная копия сохранена — можно повторить загрузку позже.`
          : cloudLastSync
            ? `Последняя подтверждённая синхронизация: ${cloudLastSync}.`
            : "После первого изменения здесь появится время подтверждённой загрузки.";

  return {
    gdriveStatus,
    folderMode,
    setFolderMode,
    preferWatched,
    setPreferWatched,
    autoSyncMode,
    setAutoSyncMode,
    autoSyncInterval,
    setAutoSyncInterval,
    syncing,
    syncMessage,
    showCredsInput,
    setShowCredsInput,
    clientIdInput,
    setClientIdInput,
    clientSecretInput,
    setClientSecretInput,
    credentialsSaving,
    credentialsMessage,
    credentialsTone,
    initialChoiceModal,
    setInitialChoiceModal,
    loadGDriveStatus,
    connect,
    disconnect,
    saveCredentials,
    syncNow,
    cloudSyncing,
    cloudError,
    cloudState,
    cloudTitle,
    cloudDetail,
  };
}

export type GoogleDriveSettingsState = ReturnType<typeof useGoogleDriveSettings>;
