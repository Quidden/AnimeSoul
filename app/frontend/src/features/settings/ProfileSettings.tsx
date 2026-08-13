import type { ConfigProfile } from "../../lib/types";
import { Setting } from "./Setting";

type ProfileSettingsProps = {
  profiles: ConfigProfile[];
  activeProfile: string;
  onSwitchProfile?: (id: string) => void;
  onExport?: () => void;
  onImport?: (file: File) => void;
};

/** Profile switching and portable JSON backup controls. */
export function ProfileSettings({
  profiles,
  activeProfile,
  onSwitchProfile,
  onExport,
  onImport,
}: ProfileSettingsProps) {
  return (
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
        <select value={activeProfile} onChange={(event) => onSwitchProfile?.(event.target.value)}>
          <option value="default">Основной</option>
          {profiles
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
          <button onClick={onExport}>⇩ Выгрузить профиль</button>
          <label>
            ⇧ Загрузить профиль
            <input
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImport?.(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </Setting>
    </section>
  );
}
