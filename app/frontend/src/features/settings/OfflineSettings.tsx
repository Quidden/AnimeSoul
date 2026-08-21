import { useEffect, useState } from "react";

import {
  fetchOfflineLibrary,
  fetchOfflineSettings,
  hasKodikSecretAccess,
  KODIK_ACCESS_CHANGED_EVENT,
  updateOfflineSettings,
} from "../../lib/downloads";

export function OfflineSettings() {
  const [directory, setDirectory] = useState("");
  const [savedDirectory, setSavedDirectory] = useState("");
  const [kodikPublicKey, setKodikPublicKey] = useState("");
  const [kodikPrivateKey, setKodikPrivateKey] = useState("");
  const [kodikPublicKeyConfigured, setKodikPublicKeyConfigured] = useState(false);
  const [kodikPrivateKeyConfigured, setKodikPrivateKeyConfigured] = useState(false);
  const [episodes, setEpisodes] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [message, setMessage] = useState("");

  const applyKodikStatus = (settings: { kodikPublicKeyConfigured: boolean; kodikPrivateKeyConfigured: boolean }) => {
    setKodikPublicKeyConfigured(settings.kodikPublicKeyConfigured);
    setKodikPrivateKeyConfigured(settings.kodikPrivateKeyConfigured);
    window.dispatchEvent(new Event(KODIK_ACCESS_CHANGED_EVENT));
  };

  const refresh = async () => {
    try {
      const [settings, library] = await Promise.all([fetchOfflineSettings(), fetchOfflineLibrary()]);
      setDirectory(settings.directory);
      setSavedDirectory(settings.directory);
      applyKodikStatus(settings);
      setEpisodes(library.anime.reduce((total, anime) => total + anime.episodes.length, 0));
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Не удалось открыть офлайн-библиотеку.");
    }
  };

  useEffect(() => { void refresh(); }, []);

  const saveDirectory = async () => {
    setStatus("saving");
    setMessage("");
    try {
      const result = await updateOfflineSettings({ directory });
      setDirectory(result.directory);
      setSavedDirectory(result.directory);
      setStatus("ready");
      setMessage("Папка сохранена. Новые серии будут загружаться сюда.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить путь.");
    }
  };

  const saveKodikKeys = async () => {
    if (!kodikPublicKey.trim() && !kodikPrivateKey.trim()) return;
    setStatus("saving");
    setMessage("");
    try {
      const result = await updateOfflineSettings({
        directory,
        ...(kodikPublicKey.trim() ? { kodikPublicKey: kodikPublicKey.trim() } : {}),
        ...(kodikPrivateKey.trim() ? { kodikPrivateKey: kodikPrivateKey.trim() } : {}),
      });
      setKodikPublicKey("");
      setKodikPrivateKey("");
      applyKodikStatus(result);
      setStatus("ready");
      setMessage("Ключи Kodik сохранены на этом компьютере. Приватный ключ больше не отображается в интерфейсе.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить ключи Kodik.");
    }
  };

  const clearKodikKeys = async () => {
    setStatus("saving");
    setMessage("");
    try {
      const result = await updateOfflineSettings({
        directory,
        clearKodikPublicKey: true,
        clearKodikPrivateKey: true,
      });
      setKodikPublicKey("");
      setKodikPrivateKey("");
      applyKodikStatus(result);
      setStatus("ready");
      setMessage("Ключи Kodik удалены с этого компьютера.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Не удалось удалить ключи Kodik.");
    }
  };

  const keysReady = hasKodikSecretAccess({ kodikPublicKeyConfigured, kodikPrivateKeyConfigured });

  return (
    <section className="settings-group offline-settings" data-settings-tab="offline">
      <div className="settings-group-title">
        <b>Офлайн-библиотека</b>
        <span>Серии, постеры и список загрузок хранятся в выбранной папке и доступны без интернета.</span>
      </div>
      <article className="settings-item offline-directory-setting">
        <div>
          <b>Папка для аниме</b>
          <p>Укажи существующую или новую папку. AnimeSoul создаст внутри неё свой индекс библиотеки.</p>
          <small>{episodes ? `В текущей папке доступно серий: ${episodes}.` : "Здесь пока нет скачанных серий."}</small>
        </div>
        <div>
          <input
            className="settings-text-input"
            value={directory}
            disabled={status === "loading" || status === "saving"}
            onChange={(event) => setDirectory(event.target.value)}
            placeholder="D:\\AnimeSoul"
            aria-label="Папка для офлайн-библиотеки"
          />
          <button className="primary" disabled={!directory.trim() || directory === savedDirectory || status === "saving"} onClick={() => void saveDirectory()}>
            {status === "saving" ? "Сохраняем…" : "Сохранить папку"}
          </button>
        </div>
      </article>
      <article className="settings-item offline-kodik-setting">
        <div>
          <b>Официальный API Kodik</b>
          <p>Собственный плеер и скачивание используют прямые ссылки приватного API Kodik. Запрос и подпись выполняются только локально на этом компьютере.</p>
          <small>{keysReady ? "Оба ключа настроены — собственный плеер и скачивание доступны." : "Добавьте оба ключа из профиля Kodik, чтобы включить собственный плеер и скачивание."}</small>
        </div>
        <div className="offline-kodik-setting-controls">
          <input
            className="settings-text-input"
            value={kodikPublicKey}
            disabled={status === "loading" || status === "saving"}
            onChange={(event) => setKodikPublicKey(event.target.value)}
            placeholder={kodikPublicKeyConfigured ? "Заменить публичный ключ Kodik" : "Публичный ключ Kodik"}
            autoComplete="off"
            spellCheck={false}
            aria-label="Публичный ключ Kodik"
          />
          <input
            className="settings-text-input"
            type="password"
            value={kodikPrivateKey}
            disabled={status === "loading" || status === "saving"}
            onChange={(event) => setKodikPrivateKey(event.target.value)}
            placeholder={kodikPrivateKeyConfigured ? "Заменить приватный ключ Kodik" : "Приватный ключ Kodik"}
            autoComplete="new-password"
            spellCheck={false}
            aria-label="Приватный ключ Kodik"
          />
          <div className="offline-kodik-actions">
            <button className="primary" disabled={(!kodikPublicKey.trim() && !kodikPrivateKey.trim()) || status === "saving"} onClick={() => void saveKodikKeys()}>
              {status === "saving" ? "Сохраняем…" : "Сохранить ключи"}
            </button>
            {(kodikPublicKeyConfigured || kodikPrivateKeyConfigured) && (
              <button className="ghost" disabled={status === "saving"} onClick={() => void clearKodikKeys()}>
                Удалить ключи
              </button>
            )}
          </div>
        </div>
      </article>
      {message && <p className={`offline-settings-message ${status === "error" ? "error" : ""}`}>{message}</p>}
      <p className="offline-settings-note">В совместном просмотре AnimeSoul всегда использует онлайн-источник, чтобы участники видели одну и ту же серию.</p>
    </section>
  );
}
