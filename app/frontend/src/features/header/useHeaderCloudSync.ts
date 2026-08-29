import { useCallback, useEffect, useRef, useState } from "react";

import { fetchGDriveAuthUrl, fetchGDriveStatus, syncGDrive, type GDriveStatus } from "../../lib/gdrive";
import { emitAppEvent } from "../../lib/events";
import { readLocal as read } from "../../lib/storage";
import type { SaveStatus } from "../../lib/types";

type StatusNotice = {
  tone: "loading" | "success" | "error";
  text: string;
};

type Options = {
  diskStatus: SaveStatus;
  onStorageReload?: () => void;
  showStatusNotice: (notice: StatusNotice) => void;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useHeaderCloudSync({ diskStatus, onStorageReload, showStatusNotice }: Options) {
  const [gdriveStatus, setGDriveStatus] = useState<GDriveStatus | null>(null);
  const [gdriveSyncing, setGDriveSyncing] = useState(false);
  const [gdriveError, setGDriveError] = useState("");
  const cloudStatusLoadedRef = useRef(false);
  const lastCloudSyncRef = useRef(0);
  const cloudLifecycleSyncRef = useRef(false);
  const cloudLifecycleSyncAtRef = useRef(0);
  const cloudBackendSyncRunningRef = useRef(false);
  const initialCloudMergeRef = useRef(false);
  const onStorageReloadRef = useRef(onStorageReload);
  const showStatusNoticeRef = useRef(showStatusNotice);

  cloudBackendSyncRunningRef.current = Boolean(gdriveStatus?.sync_running);
  onStorageReloadRef.current = onStorageReload;
  showStatusNoticeRef.current = showStatusNotice;

  const refreshGDriveStatus = useCallback(async () => {
    try {
      setGDriveStatus(await fetchGDriveStatus());
    } catch {
      setGDriveStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshGDriveStatus();
    const timer = window.setInterval(refreshGDriveStatus, 2_500);
    const handleMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === "GDRIVE_AUTH_SUCCESS") {
        void refreshGDriveStatus();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("message", handleMessage);
    };
  }, [refreshGDriveStatus]);

  useEffect(() => {
    const syncedAt = Number(gdriveStatus?.last_sync_at || 0);
    if (!cloudStatusLoadedRef.current) {
      cloudStatusLoadedRef.current = true;
      lastCloudSyncRef.current = syncedAt;
      return;
    }
    if (syncedAt <= lastCloudSyncRef.current) return;
    lastCloudSyncRef.current = syncedAt;
    void onStorageReloadRef.current?.();
    const time = new Date(syncedAt * 1000).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
    showStatusNoticeRef.current({ tone: "success", text: `Облако сохранено · ${time}` });
  }, [gdriveStatus?.last_sync_at]);

  useEffect(() => {
    if (!gdriveStatus?.connected) {
      initialCloudMergeRef.current = false;
      return;
    }
    if (gdriveStatus.choice_pending) return;
    const autoMode = read<"instant" | "interval" | "manual">(
      "animesoul:gdrive-auto-sync-mode",
      "instant",
    );
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
        if (!cancelled) setGDriveError(errorMessage(error, "Ошибка синхронизации"));
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
  }, [gdriveStatus?.connected, gdriveStatus?.choice_pending, refreshGDriveStatus]);

  useEffect(() => {
    if (!gdriveStatus?.connected) return;

    const runIntervalSync = async () => {
      const mode = read<"instant" | "interval" | "manual">(
        "animesoul:gdrive-auto-sync-mode",
        "instant",
      );
      if (mode !== "interval") return;

      const folderMode = read("animesoul:gdrive-folder-mode", "visible");
      const preferWatched = read("animesoul:gdrive-prefer-watched", true);
      try {
        setGDriveSyncing(true);
        showStatusNoticeRef.current({ tone: "loading", text: "Сохраняем в облако…" });
        await syncGDrive("merge", preferWatched, folderMode);
        await onStorageReloadRef.current?.();
        await refreshGDriveStatus();
      } catch {
        showStatusNoticeRef.current({ tone: "error", text: "Не удалось сохранить в облако" });
      } finally {
        setGDriveSyncing(false);
      }
    };

    const minutes = read("animesoul:gdrive-auto-sync-interval", 15);
    const timer = window.setInterval(runIntervalSync, Math.max(1, minutes) * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [gdriveStatus?.connected, refreshGDriveStatus]);

  const needsChoice = Boolean(
    gdriveStatus?.connected
    && (
      gdriveStatus.choice_pending
      || (gdriveStatus.has_cloud_file
        && !read<boolean>("animesoul:gdrive-initial-choice-done", false))
    ),
  );

  const handleGDriveClick = async () => {
    if (gdriveSyncing) return;
    if (!gdriveStatus?.connected) {
      try {
        const { url } = await fetchGDriveAuthUrl();
        window.open(url, "gdrive_auth", "width=600,height=700");
      } catch (error: unknown) {
        alert(errorMessage(error, "Ошибка получения ссылки авторизации Google"));
      }
      return;
    }
    if (needsChoice) {
      emitAppEvent("open-gdrive-choice");
      return;
    }

    setGDriveSyncing(true);
    setGDriveError("");
    showStatusNoticeRef.current({ tone: "loading", text: "Сохраняем в облако…" });
    try {
      const folderMode = read("animesoul:gdrive-folder-mode", "visible");
      const preferWatched = read("animesoul:gdrive-prefer-watched", true);
      await syncGDrive("merge", preferWatched, folderMode);
      await onStorageReloadRef.current?.();
      await refreshGDriveStatus();
    } catch (error: unknown) {
      setGDriveError(errorMessage(error, "Ошибка синхронизации"));
      showStatusNoticeRef.current({ tone: "error", text: "Не удалось сохранить в облако" });
    } finally {
      setGDriveSyncing(false);
    }
  };

  const cloudAutoMode = read<"instant" | "interval" | "manual">(
    "animesoul:gdrive-auto-sync-mode",
    "instant",
  );
  const cloudLastSyncMs = Number(gdriveStatus?.last_sync_at || 0) * 1000;
  const cloudSyncing = gdriveSyncing || gdriveStatus?.sync_state === "syncing";
  const cloudError = gdriveError || gdriveStatus?.last_sync_error || "";
  const cloudHasLocalChanges = Boolean(
    gdriveStatus?.connected
    && diskStatus.state === "saved"
    && diskStatus.at
    && cloudLastSyncMs + 250 < diskStatus.at,
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

  return {
    gdriveStatus,
    cloudSyncing,
    cloudError,
    cloudIndicatorState,
    cloudLabel,
    needsChoice,
    handleGDriveClick,
  };
}
