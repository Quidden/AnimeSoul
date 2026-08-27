import { useEffect, useRef, useState } from "react";

import {
  fetchOfflineSettings,
  KODIK_ACCESS_CHANGED_EVENT,
  updateOfflineSettings,
  validateKodikCredentials,
} from "../../lib/downloads";
import {
  fetchYummyCredentials,
  saveYummyCredentials,
} from "../../lib/apiCredentials";
import {
  CREDENTIAL_JSON_EXAMPLE,
  CREDENTIAL_TEXT_EXAMPLE,
  parseCredentialImport,
  type CredentialCheck,
  type CredentialSaveOutcome,
  type ImportedCredentials,
} from "./credentialImport";
import { CredentialCheckList } from "./CredentialCheckList";
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
  const [yummyChecks, setYummyChecks] = useState<CredentialCheck[]>([]);
  const [directory, setDirectory] = useState("");
  const [kodikPublic, setKodikPublic] = useState("");
  const [kodikPrivate, setKodikPrivate] = useState("");
  const [kodikPublicConfigured, setKodikPublicConfigured] = useState(false);
  const [kodikPrivateConfigured, setKodikPrivateConfigured] = useState(false);
  const [kodikSaving, setKodikSaving] = useState(false);
  const [kodikFeedback, setKodikFeedback] = useState<Feedback | null>(null);
  const [kodikChecks, setKodikChecks] = useState<CredentialCheck[]>([]);
  const [importing, setImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState<Feedback | null>(null);
  const [importChecks, setImportChecks] = useState<CredentialCheck[]>([]);
  const importInput = useRef<HTMLInputElement>(null);

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

  const saveYummy = async (importedToken?: string): Promise<CredentialSaveOutcome> => {
    const token = (importedToken ?? yummyToken).trim();
    if (!token) return { saved: false, checks: [] };
    setYummySaving(true);
    setYummyFeedback(null);
    setYummyChecks([]);
    try {
      const status = await saveYummyCredentials(token);
      const checks = status.checks ?? [{
        field: "yummyPublicToken" as const,
        label: "YummyAnime Public token",
        status: "valid" as const,
        detail: "YummyAnime принял токен и вернул каталог.",
      }];
      setYummyChecks(checks);
      setYummyConfigured(status.configured);
      setYummyToken("");
      setYummyFeedback({ tone: "success", text: "Public token проверен и сохранён на этом устройстве." });
      return { saved: true, checks };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Не удалось проверить Public token.";
      const checks: CredentialCheck[] = [{
        field: "yummyPublicToken",
        label: "YummyAnime Public token",
        status: /временно|недоступ|подключ/i.test(detail) ? "pending" : "invalid",
        detail,
      }];
      setYummyChecks(checks);
      setYummyFeedback({
        tone: "error",
        text: detail,
      });
      return { saved: false, checks };
    } finally {
      setYummySaving(false);
    }
  };

  const saveKodik = async (imported?: Pick<ImportedCredentials, "kodikPublicKey" | "kodikPrivateKey">): Promise<CredentialSaveOutcome> => {
    const publicKey = (imported?.kodikPublicKey ?? kodikPublic).trim();
    const privateKey = (imported?.kodikPrivateKey ?? kodikPrivate).trim();
    if (!publicKey && !privateKey) return { saved: false, checks: [] };
    setKodikSaving(true);
    setKodikFeedback(null);
    setKodikChecks([]);
    try {
      const validation = await validateKodikCredentials({
        ...(publicKey ? { kodikPublicKey: publicKey } : {}),
        ...(privateKey ? { kodikPrivateKey: privateKey } : {}),
      });
      setKodikChecks(validation.checks);
      if (!validation.canSave) {
        const failed = validation.checks.find(check => check.status !== "valid");
        setKodikFeedback({
          tone: "error",
          text: failed?.detail || "Ключи Kodik не прошли проверку и не были сохранены.",
        });
        return { saved: false, checks: validation.checks };
      }
      const activeDirectory = directory || (await fetchOfflineSettings()).directory;
      const result = await updateOfflineSettings({
        directory: activeDirectory,
        ...(publicKey ? { kodikPublicKey: publicKey } : {}),
        ...(privateKey ? { kodikPrivateKey: privateKey } : {}),
      });
      setDirectory(activeDirectory);
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
      return { saved: true, checks: validation.checks };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Kodik временно недоступен.";
      const checks: CredentialCheck[] = [
        ...(publicKey ? [{
          field: "kodikPublicKey" as const,
          label: "Kodik Public key",
          status: "pending" as const,
          detail,
        }] : []),
        ...(privateKey ? [{
          field: "kodikPrivateKey" as const,
          label: "Kodik Private key",
          status: "pending" as const,
          detail: "Private key не удалось проверить без ответа Kodik.",
        }] : []),
      ];
      setKodikChecks(checks);
      setKodikFeedback({
        tone: "error",
        text: detail,
      });
      return { saved: false, checks };
    } finally {
      setKodikSaving(false);
    }
  };

  const importCredentials = async (file: File) => {
    setImportFeedback(null);
    setImportChecks([]);
    if (file.size > 256 * 1024) {
      setImportFeedback({ tone: "error", text: "Файл ключей слишком большой. Максимум — 256 КБ." });
      return;
    }

    setImporting(true);
    try {
      const credentials = parseCredentialImport(await file.text());
      const tasks: Array<Promise<CredentialSaveOutcome>> = [];

      if (credentials.yummyPublicToken) {
        tasks.push(saveYummy(credentials.yummyPublicToken));
      }
      if (credentials.kodikPublicKey || credentials.kodikPrivateKey) {
        tasks.push(saveKodik(credentials));
      }
      if (credentials.googleClientId || credentials.googleClientSecret) {
        tasks.push(googleDrive.saveCredentials({
          clientId: credentials.googleClientId,
          clientSecret: credentials.googleClientSecret,
        }));
      }

      const results = await Promise.all(tasks);
      const checks = results.flatMap(result => result.checks);
      setImportChecks(checks);
      const saved = results
        .filter(result => result.saved)
        .flatMap(result => result.checks.filter(check => check.status === "valid").map(check => check.label));
      const failed = checks.filter(check => check.status !== "valid").map(check => check.label);
      if (!failed.length) {
        setImportFeedback({ tone: "success", text: `Импортировано: ${saved.join(", ")}.` });
      } else if (saved.length) {
        setImportFeedback({
          tone: "error",
          text: `Сохранено: ${saved.join(", ")}. Не удалось сохранить: ${failed.join(", ")}.`,
        });
      } else {
        setImportFeedback({ tone: "error", text: `Не удалось сохранить: ${failed.join(", ")}.` });
      }
    } catch (error) {
      setImportFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Не удалось прочитать файл ключей.",
      });
    } finally {
      setImporting(false);
      if (importInput.current) importInput.current.value = "";
    }
  };

  const googleConfigured = Boolean(googleDrive.gdriveStatus?.has_credentials);

  return (
    <section className="settings-group credentials-settings" data-settings-tab="credentials">
      <div className="settings-group-title">
        <b>Ключи и подключения</b>
        <span>Все внешние сервисы AnimeSoul собраны в одном месте.</span>
      </div>

      <article className="settings-item credentials-card credentials-import-card">
        <div className="credentials-card-heading">
          <span className="credentials-state ready">Импорт с устройства</span>
          <b>Загрузить все ключи</b>
          <p>Выберите обычный TXT или JSON. Файл читается локально, а значения не выводятся на экран.</p>
        </div>
        <div className="credentials-card-controls credentials-import-controls">
          <input
            ref={importInput}
            type="file"
            hidden
            accept=".json,.txt,application/json,text/plain"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void importCredentials(file);
            }}
          />
          <button
            type="button"
            className="primary"
            disabled={importing || yummySaving || kodikSaving || googleDrive.credentialsSaving}
            onClick={() => importInput.current?.click()}
          >
            {importing ? "Импортируем…" : "Загрузить TXT / JSON"}
          </button>
          <small className="credentials-import-hint">
            Поля: yummyPublicToken, kodikPublicKey, kodikPrivateKey, googleClientId, googleClientSecret.
          </small>
          <details className="credentials-import-guide">
            <summary>Пример файла и важные нюансы</summary>
            <div className="credentials-import-guide-body">
              <b>Пример JSON</b>
              <pre>{CREDENTIAL_JSON_EXAMPLE}</pre>
              <b>Пример TXT</b>
              <pre>{CREDENTIAL_TEXT_EXAMPLE}</pre>
              <ul>
                <li>Замените значения после двоеточия или знака «=» своими ключами. Названия полей оставьте как в примере.</li>
                <li>Можно оставить только нужные поля: отсутствующие и пустые значения не удаляют уже сохранённые ключи.</li>
                <li>После выбора файла каждое поле проверяется у своего сервиса. Неподтверждённые значения не сохраняются как рабочие.</li>
                <li>Поддерживается и исходный OAuth JSON, скачанный из Google Cloud, с разделом <code>installed</code> или <code>web</code>.</li>
                <li>Допустимы файлы .json и .txt размером до 256 КБ. Содержимое не показывается на экране и не записывается в журнал.</li>
                <li>Не пересылайте файл другим людям: Kodik Private key и Google Client Secret являются секретными.</li>
              </ul>
            </div>
          </details>
          <CredentialCheckList checks={importChecks} />
          {importFeedback && <FeedbackLine value={importFeedback} />}
        </div>
      </article>

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
          <CredentialCheckList checks={yummyChecks} />
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
            {kodikSaving ? "Проверяем…" : "Проверить и сохранить"}
          </button>
          <CredentialCheckList checks={kodikChecks} />
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
            name="credentials-google-client-id"
            value={googleDrive.clientIdInput}
            onChange={event => googleDrive.setClientIdInput(event.target.value)}
            placeholder="Client ID · …apps.googleusercontent.com"
            autoComplete="off"
            spellCheck={false}
          />
          <input
            type="password"
            className="settings-text-input"
            name="credentials-google-client-secret"
            value={googleDrive.clientSecretInput}
            onChange={event => googleDrive.setClientSecretInput(event.target.value)}
            placeholder={googleConfigured ? "Оставьте пустым, чтобы сохранить Secret" : "Client Secret"}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="credentials-actions">
            <button className="primary" disabled={googleDrive.credentialsSaving} onClick={() => void googleDrive.saveCredentials()}>
              {googleDrive.credentialsSaving ? "Проверяем…" : "Проверить и сохранить"}
            </button>
            {googleConfigured && !googleDrive.gdriveStatus?.connected && (
              <button className="ghost" onClick={() => void googleDrive.connect()}>Подключить аккаунт</button>
            )}
          </div>
          <CredentialCheckList checks={googleDrive.credentialsChecks} />
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
