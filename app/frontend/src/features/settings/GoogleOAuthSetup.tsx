import type { CredentialCheck } from "./credentialImport";
import { CredentialCheckList } from "./CredentialCheckList";

type Props = {
  expanded: boolean;
  setExpanded: (value: boolean) => void;
  hasCredentials: boolean;
  clientId: string;
  setClientId: (value: string) => void;
  clientSecret: string;
  setClientSecret: (value: string) => void;
  onSave: () => void;
  saving?: boolean;
  message?: string;
  messageTone?: "success" | "error";
  checks?: CredentialCheck[];
};

/**
 * Self-contained guide for creating and storing a personal Google OAuth
 * desktop client. It stays available after connection so credentials can be
 * replaced without disconnecting the account first.
 */
export function GoogleOAuthSetup({
  expanded,
  setExpanded,
  hasCredentials,
  clientId,
  setClientId,
  clientSecret,
  setClientSecret,
  onSave,
  saving = false,
  message = "",
  messageTone = "success",
  checks = [],
}: Props) {
  return (
    <details
      className="cloud-settings-details cloud-oauth-setup"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Собственные ключи Google OAuth</summary>
      <div className="cloud-settings-details-body">
        <div className="cloud-oauth-intro">
          <b>Зачем это нужно</b>
          <p>
            AnimeSoul работает локально и не распространяет общий OAuth-клиент. Создайте личный клиент один
            раз — после сохранения авторизация будет открываться обычной кнопкой «Подключить Google Drive».
          </p>
        </div>

        <ol className="cloud-oauth-steps">
          <li>
            <b>Создайте или выберите проект</b>
            <span>
              Откройте <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a>.
            </span>
          </li>
          <li>
            <b>Включите Google Drive API</b>
            <span>
              На странице <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">Google Drive API</a> нажмите «Enable».
            </span>
          </li>
          <li>
            <b>Настройте экран согласия OAuth</b>
            <span>
              В <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">Google Auth Platform</a> заполните название приложения. Если статус «Testing», добавьте себя и друзей в Test users.
            </span>
          </li>
          <li>
            <b>Создайте OAuth Client ID</b>
            <span>
              В разделе <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Clients</a> выберите тип приложения <strong>Desktop app</strong> — не Web application.
            </span>
          </li>
          <li>
            <b>Скопируйте оба значения</b>
            <span>Вставьте полученные Client ID и Client Secret в поля ниже и сохраните.</span>
          </li>
          <li>
            <b>Подключите Google Drive</b>
            <span>Нажмите кнопку подключения выше и разрешите AnimeSoul доступ к файлам приложения.</span>
          </li>
        </ol>

        <div className="cloud-oauth-help">
          Подробная официальная инструкция: {" "}
          <a
            href="https://developers.google.com/workspace/guides/create-credentials#desktop-app"
            target="_blank"
            rel="noreferrer"
          >
            создание OAuth-клиента Desktop app
          </a>.
        </div>

        <div className="cloud-settings-credentials">
          <label>
            <span>Client ID</span>
            <input
              className="settings-text-input"
              name="cloud-google-client-id"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="000000000000-xxx.apps.googleusercontent.com"
              autoComplete="off"
            />
            <small>Публичный идентификатор созданного Desktop-приложения.</small>
          </label>
          <label>
            <span>Client Secret</span>
            <input
              type="password"
              className="settings-text-input"
              name="cloud-google-client-secret"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder={hasCredentials ? "Оставьте пустым, чтобы сохранить текущий" : "GOCSPX-…"}
              autoComplete="off"
            />
            <small>
              {hasCredentials
                ? "Пустое поле не удалит уже сохранённый секрет."
                : "Хранится только локально и не добавляется в Git."}
            </small>
          </label>
          <button className="cloud-oauth-save" disabled={saving} onClick={onSave}>
            {saving ? "Проверяем…" : "Проверить и сохранить"}
          </button>
          <CredentialCheckList checks={checks} />
          {message && (
            <p className={`credentials-feedback ${messageTone}`} role="status" aria-live="polite">
              {message}
            </p>
          )}
        </div>

        <p className="cloud-oauth-warning">
          Desktop-приложение технически не может надёжно скрыть Client Secret. Не публикуйте файл настроек и
          не добавляйте его в репозиторий; для друзей лучше создавать отдельные ключи или делиться ими лично.
        </p>
      </div>
    </details>
  );
}
