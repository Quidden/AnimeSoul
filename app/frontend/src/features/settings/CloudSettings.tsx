import type { GDriveFolderMode } from "../../lib/gdrive";
import { writeLocal } from "../../lib/storage";
import { Toggle } from "../../components/Toggle";
import type { GoogleDriveSettingsState } from "./useGoogleDriveSettings";
import { GoogleOAuthSetup } from "./GoogleOAuthSetup";

type Props = {
  state: GoogleDriveSettingsState;
};

/**
 * Google Drive presentation only. OAuth, synchronization and persistence live
 * in useGoogleDriveSettings so this component stays easy to change visually.
 */
export function CloudSettings({ state }: Props) {
  const {
    gdriveStatus,
    folderMode,
    setFolderMode,
    preferWatched,
    setPreferWatched,
    autoSyncMode,
    setAutoSyncMode,
    autoSyncInterval,
    setAutoSyncInterval,
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
    credentialsChecks,
    connect,
    disconnect,
    saveCredentials,
    syncNow,
    cloudSyncing,
    cloudError,
    cloudState,
    cloudTitle,
    cloudDetail,
  } = state;

  return (
    <section className="settings-group google-drive-settings" data-settings-tab="cloud">
      <div className="settings-group-title">
        <b>Облачная копия</b>
        <span>Google Drive</span>
      </div>

      <div className={`cloud-settings-card ${cloudState}`} role="status" aria-live="polite">
        <div className="cloud-settings-icon" aria-hidden="true">☁</div>
        <div className="cloud-settings-copy">
          <div className="cloud-settings-heading">
            <b>
              {gdriveStatus?.connected
                ? gdriveStatus.user_email || gdriveStatus.user_name || "Google Drive подключён"
                : "Сохранения на Google Drive"}
            </b>
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
            <button className="primary" onClick={() => syncNow("merge")} disabled={cloudSyncing}>
              {cloudSyncing ? "Сохраняем…" : cloudError ? "Повторить" : "Сохранить сейчас"}
            </button>
          ) : (
            <button className="primary" onClick={connect}>Подключить Google Drive</button>
          )}
        </div>
      </div>

      {gdriveStatus?.connected && (
        <div className="cloud-settings-quick-options">
          <label>
            <span>
              <b>Автосохранение</b>
              <small>Локальная копия сохраняется всегда; здесь выбирается только момент отправки в облако.</small>
            </span>
            <select
              value={autoSyncMode}
              onChange={(event) => {
                const value = event.target.value as "instant" | "interval" | "manual";
                setAutoSyncMode(value);
                writeLocal("animesoul:gdrive-auto-sync-mode", value);
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
                <small>Как часто отправлять накопившиеся изменения в облако.</small>
              </span>
              <select
                value={autoSyncInterval}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setAutoSyncInterval(value);
                  writeLocal("animesoul:gdrive-auto-sync-interval", value);
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
                Обычное сохранение безопасно объединяет прогресс, избранное и папки. Полную замену используйте
                только для восстановления или переноса между устройствами.
              </p>
              <div className="cloud-settings-action-grid">
                <button onClick={() => syncNow("anime_only")} disabled={cloudSyncing}>
                  <b>Только аниме и статистика</b>
                  <small>Перенести прогресс и библиотеку, не меняя тему и настройки плеера.</small>
                </button>
                <button onClick={() => syncNow("cloud")} disabled={cloudSyncing}>
                  <b>Восстановить этот ПК</b>
                  <small>Заменить локальные данные последней облачной копией.</small>
                </button>
                <button onClick={() => syncNow("local")} disabled={cloudSyncing}>
                  <b>Перезаписать облако</b>
                  <small>Заменить облачную копию текущими данными этого ПК.</small>
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
                  <small>Видимую папку можно копировать вручную; скрытое хранилище не засоряет корень Диска.</small>
                </span>
                <select
                  value={folderMode}
                  onChange={(event) => {
                    const value = event.target.value as GDriveFolderMode;
                    setFolderMode(value);
                    writeLocal("animesoul:gdrive-folder-mode", value);
                  }}
                >
                  <option value="visible">Видимая папка «AnimeSoul»</option>
                  <option value="appdata">Скрытое хранилище приложения</option>
                </select>
              </label>
              <label className="cloud-settings-field">
                <span>
                  <b>Приоритет отметки «просмотрено»</b>
                  <small>Объединение не снимет отметку, если серия просмотрена хотя бы на одном устройстве.</small>
                </span>
                <Toggle
                  label="Включено"
                  value={preferWatched}
                  onChange={(value) => {
                    setPreferWatched(value);
                    writeLocal("animesoul:gdrive-prefer-watched", value);
                  }}
                />
              </label>
              <button className="cloud-settings-disconnect" onClick={disconnect}>Отключить Google Drive</button>
            </div>
          </details>
        </>
      ) : null}

      <GoogleOAuthSetup
        expanded={showCredsInput}
        setExpanded={setShowCredsInput}
        hasCredentials={Boolean(gdriveStatus?.has_credentials)}
        clientId={clientIdInput}
        setClientId={setClientIdInput}
        clientSecret={clientSecretInput}
        setClientSecret={setClientSecretInput}
        onSave={saveCredentials}
        saving={credentialsSaving}
        message={credentialsMessage}
        messageTone={credentialsTone}
        checks={credentialsChecks}
      />
    </section>
  );
}
