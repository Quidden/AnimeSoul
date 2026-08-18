import { useEffect, useState } from "react";

import { fetchOfflineLibrary, fetchOfflineSettings, updateOfflineSettings } from "../../lib/downloads";

export function OfflineSettings() {
  const [directory, setDirectory] = useState("");
  const [savedDirectory, setSavedDirectory] = useState("");
  const [kodikApiToken, setKodikApiToken] = useState("");
  const [kodikApiTokenConfigured, setKodikApiTokenConfigured] = useState(false);
  const [episodes, setEpisodes] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [message, setMessage] = useState("");

  const refresh = async () => {
    try {
      const [settings, library] = await Promise.all([fetchOfflineSettings(), fetchOfflineLibrary()]);
      setDirectory(settings.directory);
      setSavedDirectory(settings.directory);
      setKodikApiTokenConfigured(settings.kodikApiTokenConfigured);
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

  const saveKodikToken = async () => {
    if (!kodikApiToken.trim()) return;
    setStatus("saving");
    setMessage("");
    try {
      const result = await updateOfflineSettings({ directory, kodikApiToken: kodikApiToken.trim() });
      setKodikApiToken("");
      setKodikApiTokenConfigured(result.kodikApiTokenConfigured);
      setStatus("ready");
      setMessage("Токен Kodik сохранён локально. Его значение больше не показывается в интерфейсе.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить API-токен Kodik.");
    }
  };

  const clearKodikToken = async () => {
    setStatus("saving");
    setMessage("");
    try {
      const result = await updateOfflineSettings({ directory, clearKodikApiToken: true });
      setKodikApiToken("");
      setKodikApiTokenConfigured(result.kodikApiTokenConfigured);
      setStatus("ready");
      setMessage("Токен Kodik удалён с этого компьютера.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Не удалось удалить API-токен Kodik.");
    }
  };

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
          <b>Токен Kodik — необязательно</b>
          <p>Загрузчик использует автоматический публичный механизм Kodik. Свой токен можно указать только для замены автоматически найденного.</p>
          <small>{kodikApiTokenConfigured ? "Личный токен сохранён на этом компьютере и будет использован первым." : "Личный токен не задан — AnimeSoul получит временный токен автоматически."}</small>
        </div>
        <div className="offline-kodik-setting-controls">
          <input
            className="settings-text-input"
            type="password"
            value={kodikApiToken}
            disabled={status === "loading" || status === "saving"}
            onChange={(event) => setKodikApiToken(event.target.value)}
            placeholder={kodikApiTokenConfigured ? "Заменить токен Kodik" : "Необязательно: вставьте личный токен"}
            autoComplete="off"
            spellCheck={false}
            aria-label="API-токен Kodik"
          />
          <div className="offline-kodik-actions">
            <button className="primary" disabled={!kodikApiToken.trim() || status === "saving"} onClick={() => void saveKodikToken()}>
              {status === "saving" ? "Сохраняем…" : "Сохранить токен"}
            </button>
            {kodikApiTokenConfigured && (
              <button className="ghost" disabled={status === "saving"} onClick={() => void clearKodikToken()}>
                Удалить
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
