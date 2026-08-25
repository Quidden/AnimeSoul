import { useEffect, useState } from "react";

import {
  fetchOfflineSettings,
  KODIK_ACCESS_CHANGED_EVENT,
  updateOfflineSettings,
} from "../../lib/downloads";
import {
  fetchYummyCredentials,
  saveYummyCredentials,
} from "../../lib/apiCredentials";
import type { GoogleDriveSettingsState } from "./useGoogleDriveSettings";

type Props = {
  googleDrive: GoogleDriveSettingsState;
};

type Feedback = {
  tone: "success" | "error";
  text: string;
};

export function CredentialsSettings({ googleDrive }: Props) {
  const [yummyConfigured, setYummyConfigured] = useState(false);
  const [yummyToken, setYummyToken] = useState("");
  const [yummySaving, setYummySaving] = useState(false);
  const [yummyFeedback, setYummyFeedback] = useState<Feedback | null>(null);
  const [directory, setDirectory] = useState("");
  const [kodikPublic, setKodikPublic] = useState("");
  const [kodikPrivate, setKodikPrivate] = useState("");
  const [kodikPublicConfigured, setKodikPublicConfigured] = useState(false);
  const [kodikPrivateConfigured, setKodikPrivateConfigured] = useState(false);
  const [kodikSaving, setKodikSaving] = useState(false);
  const [kodikFeedback, setKodikFeedback] = useState<Feedback | null>(null);

  const loadKodikStatus = async () => {
    try {
      const status = await fetchOfflineSettings();
      setDirectory(status.directory);
      setKodikPublicConfigured(status.kodikPublicKeyConfigured);
      setKodikPrivateConfigured(status.kodikPrivateKeyConfigured);
    } catch {
      setKodikFeedback({ tone: "error", text: "Не удалось проверить ключи Kodik." });
    }
  };

  useEffect(() => {
    void fetchYummyCredentials()
      .then(status => setYummyConfigured(status.configured))
      .catch(() => setYummyFeedback({ tone: "error", text: "Не удалось проверить Public token YummyAnime." }));
    void loadKodikStatus();
    const handleKodikChange = () => { void loadKodikStatus(); };
    window.addEventListener(KODIK_ACCESS_CHANGED_EVENT, handleKodikChange);
    return () => window.removeEventListener(KODIK_ACCESS_CHANGED_EVENT, handleKodikChange);
  }, []);

  const saveYummy = async () => {
    if (!yummyToken.trim()) return;
    setYummySaving(true);
    setYummyFeedback(null);
    try {
      const status = await saveYummyCredentials(yummyToken.trim());
      setYummyConfigured(status.configured);
      setYummyToken("");
      setYummyFeedback({ tone: "success", text: "Public token проверен и сохранён на этом устройстве." });
    } catch (error) {
      setYummyFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Не удалось сохранить Public token.",
      });
    } finally {
      setYummySaving(false);
    }
  };

  const saveKodik = async () => {
    if (!kodikPublic.trim() && !kodikPrivate.trim()) return;
    setKodikSaving(true);
    setKodikFeedback(null);
    try {
      const result = await updateOfflineSettings({
        directory,
        ...(kodikPublic.trim() ? { kodikPublicKey: kodikPublic.trim() } : {}),
        ...(kodikPrivate.trim() ? { kodikPrivateKey: kodikPrivate.trim() } : {}),
      });
      setKodikPublic("");
      setKodikPrivate("");
      setKodikPublicConfigured(result.kodikPublicKeyConfigured);
      setKodikPrivateConfigured(result.kodikPrivateKeyConfigured);
      setKodikFeedback({
        tone: "success",
        text: result.kodikPublicKeyConfigured && result.kodikPrivateKeyConfigured
          ? "Оба ключа сохранены. Собственный плеер и скачивание включены."
          : "Изменения сохранены, но для плеера и скачивания нужны оба ключа Kodik.",
      });
      window.dispatchEvent(new Event(KODIK_ACCESS_CHANGED_EVENT));
    } catch (error) {
      setKodikFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Не удалось сохранить ключи Kodik.",
      });
    } finally {
      setKodikSaving(false);
    }
  };

  const googleConfigured = Boolean(googleDrive.gdriveStatus?.has_credentials);

  return (
    <section className="settings-group credentials-settings" data-settings-tab="credentials">
      <div className="settings-group-title">
        <b>Ключи и подключения</b>
        <span>Все внешние сервисы AnimeSoul собраны в одном месте.</span>
      </div>

      <article className="settings-item credentials-card">
        <div className="credentials-card-heading">
          <span className={`credentials-state ${yummyConfigured ? "ready" : "missing"}`}>
            {yummyConfigured ? "Настроено" : "Нужен ключ"}
          </span>
          <b>YummyAnime Public token</b>
          <p>Каталог, карточки, трейлеры и ссылки обычного онлайн-плеера.</p>
        </div>
        <div className="credentials-card-controls">
          <input
            type="password"
            className="settings-text-input"
            value={yummyToken}
            onChange={event => setYummyToken(event.target.value)}
            placeholder={yummyConfigured ? "Заменить Public token" : "Public token YummyAnime"}
            autoComplete="new-password"
            spellCheck={false}
          />
          <button className="primary" disabled={!yummyToken.trim() || yummySaving} onClick={() => void saveYummy()}>
            {yummySaving ? "Проверяем…" : "Проверить и сохранить"}
          </button>
          {yummyFeedback && <FeedbackLine value={yummyFeedback} />}
        </div>
      </article>

      <article className="settings-item credentials-card">
        <div className="credentials-card-heading">
          <span className={`credentials-state ${kodikPublicConfigured && kodikPrivateConfigured ? "ready" : "missing"}`}>
            {kodikPublicConfigured && kodikPrivateConfigured ? "Оба ключа настроены" : "Нужны два ключа"}
          </span>
          <b>Kodik API</b>
          <p>Прямой поток, собственный плеер AnimeSoul, качество, субтитры и скачивание.</p>
        </div>
        <div className="credentials-card-controls credentials-kodik-grid">
          <input
            className="settings-text-input"
            value={kodikPublic}
            onChange={event => setKodikPublic(event.target.value)}
            placeholder={kodikPublicConfigured ? "Заменить Public key" : "Kodik Public key"}
            autoComplete="off"
            spellCheck={false}
          />
          <input
            type="password"
            className="settings-text-input"
            value={kodikPrivate}
            onChange={event => setKodikPrivate(event.target.value)}
            placeholder={kodikPrivateConfigured ? "Заменить Private key" : "Kodik Private key"}
            autoComplete="new-password"
            spellCheck={false}
          />
          <button
            className="primary"
            disabled={(!kodikPublic.trim() && !kodikPrivate.trim()) || kodikSaving || !directory}
            onClick={() => void saveKodik()}
          >
            {kodikSaving ? "Сохраняем…" : "Сохранить Kodik"}
          </button>
          {kodikFeedback && <FeedbackLine value={kodikFeedback} />}
        </div>
      </article>

      <article className="settings-item credentials-card">
        <div className="credentials-card-heading">
          <span className={`credentials-state ${googleConfigured ? "ready" : "missing"}`}>
            {googleDrive.gdriveStatus?.connected ? "Аккаунт подключён" : googleConfigured ? "OAuth сохранён" : "Нужен OAuth"}
          </span>
          <b>Google Drive OAuth</b>
          <p>Облачная копия профилей, прогресса, статистики и настроек.</p>
        </div>
        <div className="credentials-card-controls credentials-google-grid">
          <input
            className="settings-text-input"
            value={googleDrive.clientIdInput}
            onChange={event => googleDrive.setClientIdInput(event.target.value)}
            placeholder="Client ID · …apps.googleusercontent.com"
            autoComplete="off"
            spellCheck={false}
          />
          <input
            type="password"
            className="settings-text-input"
            value={googleDrive.clientSecretInput}
            onChange={event => googleDrive.setClientSecretInput(event.target.value)}
            placeholder={googleConfigured ? "Оставьте пустым, чтобы сохранить Secret" : "Client Secret"}
            autoComplete="new-password"
            spellCheck={false}
          />
          <div className="credentials-actions">
            <button className="primary" disabled={googleDrive.credentialsSaving} onClick={() => void googleDrive.saveCredentials()}>
              {googleDrive.credentialsSaving ? "Сохраняем…" : "Сохранить OAuth"}
            </button>
            {googleConfigured && !googleDrive.gdriveStatus?.connected && (
              <button className="ghost" onClick={() => void googleDrive.connect()}>Подключить аккаунт</button>
            )}
          </div>
          {googleDrive.credentialsMessage && (
            <FeedbackLine value={{ tone: googleDrive.credentialsTone, text: googleDrive.credentialsMessage }} />
          )}
        </div>
      </article>
    </section>
  );
}

function FeedbackLine({ value }: { value: Feedback }) {
  return (
    <p className={`credentials-feedback ${value.tone}`} role="status" aria-live="polite">
      {value.tone === "success" ? "✓ " : "! "}{value.text}
    </p>
  );
}
