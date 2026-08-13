"use client";

import { createPortal } from "react-dom";

type SyncMode = "merge" | "anime_only" | "cloud" | "local";

type Props = {
  open: boolean;
  syncing: boolean;
  onClose: () => void;
  onSync: (mode: SyncMode) => void;
};

const overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 100000,
  background: "rgba(8, 6, 14, 0.85)",
  backdropFilter: "blur(10px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px",
  boxSizing: "border-box",
} as const;

const dialogStyle = {
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
} as const;

export function GoogleDriveInitialSyncModal({ open, syncing, onClose, onSync }: Props) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div style={overlayStyle} onMouseDown={onClose} role="presentation">
      <div style={dialogStyle} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="gdrive-sync-choice-title">
        <div className="settings-sync-choice-heading">
          <h3 id="gdrive-sync-choice-title">☁ Подключение Google Drive</h3>
          <button onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        <p className="settings-sync-choice-lead">
          На Google Drive найдены ранее сохранённые данные. Выберите, как объединить их с текущим профилем.
        </p>
        <div className="settings-sync-choice-list">
          <button onClick={() => onSync("merge")} disabled={syncing} className="sync-choice-btn sync-choice-btn-primary">
            <b>Умное объединение — рекомендуется</b>
            <span>Настройки объединятся, а просмотренные серии и прогресс сохранятся с обоих устройств.</span>
          </button>
          <button onClick={() => onSync("anime_only")} disabled={syncing} className="sync-choice-btn sync-choice-btn-purple">
            <b>Только аниме и статистика</b>
            <span>Перенесутся серии, избранное, папки и статистика. Тема и настройки плеера на этом ПК не изменятся.</span>
          </button>
          <button onClick={() => onSync("cloud")} disabled={syncing} className="sync-choice-btn sync-choice-btn-blue">
            <b>Полностью восстановить из облака</b>
            <span>Локальный профиль будет заменён облачной копией, включая тему и настройки.</span>
          </button>
          <button onClick={() => onSync("local")} disabled={syncing} className="sync-choice-btn sync-choice-btn-green">
            <b>Оставить данные этого ПК</b>
            <span>Текущий локальный профиль заменит облачную копию на Google Drive.</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
