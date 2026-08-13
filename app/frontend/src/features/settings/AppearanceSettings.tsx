import type { PlayerPrefs, Theme } from "../../lib/types";
import { THEMES } from "../../lib/settings";
import { Setting } from "./Setting";

type AppearanceSettingsProps = {
  theme: Theme;
  playerPrefs: PlayerPrefs;
  setTheme: (theme: Theme) => void;
  updatePlayerPrefs: (updates: Partial<PlayerPrefs>) => void;
};

/** Theme and interface-density controls shown in the appearance tab. */
export function AppearanceSettings({
  theme,
  playerPrefs,
  setTheme,
  updatePlayerPrefs,
}: AppearanceSettingsProps) {
  return (
    <>
      <section className="settings-group" data-settings-tab="appearance">
        <div className="settings-group-title">
          <b>Оформление</b>
          <span>Готовые темы и собственные цвета</span>
        </div>
        <Setting
          title="Собственная палитра"
          description="Основной цвет меняет фон интерфейса, акцентный — кнопки, индикаторы и выделения."
        >
          <div className="settings-colors">
            <label>
              Фон
              <input
                type="color"
                value={theme.background}
                onChange={(event) =>
                  setTheme({ ...theme, name: "Своя", background: event.target.value })
                }
              />
            </label>
            <label>
              Акцент
              <input
                type="color"
                value={theme.accent}
                onChange={(event) =>
                  setTheme({ ...theme, name: "Своя", accent: event.target.value })
                }
              />
            </label>
          </div>
        </Setting>
        <Setting
          title="Готовые темы"
          description="Мгновенно применяет заранее подобранную пару основного и акцентного цветов."
        >
          <div className="settings-themes">
            {THEMES.map((preset) => (
              <button
                key={preset.name}
                className={theme.name === preset.name ? "active" : ""}
                onClick={() => setTheme(preset)}
              >
                <i
                  style={{
                    background: `linear-gradient(135deg,${preset.background} 50%,${preset.accent} 50%)`,
                  }}
                />
                {preset.name}
              </button>
            ))}
          </div>
        </Setting>
      </section>

      <section className="settings-group" data-settings-tab="appearance">
        <div className="settings-group-title">
          <b>Персонализация интерфейса</b>
          <span>Размеры элементов и цвет просмотренных серий</span>
        </div>
        <Setting
          title="Цвет просмотренной серии"
          description="Меняет рамку, фон и номер серии, которая уже была просмотрена."
        >
          <div className="settings-color-value">
            <input
              type="color"
              value={playerPrefs.watchedEpisodeColor}
              onChange={(event) => updatePlayerPrefs({ watchedEpisodeColor: event.target.value })}
            />
            <code>{playerPrefs.watchedEpisodeColor}</code>
          </div>
        </Setting>
        <ScaleSetting
          title="Размер обычного текста"
          description="Масштабирует подписи карточек, метаданные, кнопки и вспомогательный текст."
          value={playerPrefs.interfaceFontScale}
          onChange={(value) => updatePlayerPrefs({ interfaceFontScale: value })}
          searchTerms="шрифт шрифта масштаб текста"
        />
        <ScaleSetting
          title="Размер заголовков"
          description="Отдельно изменяет крупные названия страниц, аниме и разделов."
          value={playerPrefs.headingFontScale}
          onChange={(value) => updatePlayerPrefs({ headingFontScale: value })}
          min={80}
          max={125}
        />
        <ScaleSetting
          title="Размер обложек"
          description="Меняет высоту постеров в каталоге, не нарушая сетку карточек."
          value={playerPrefs.posterScale}
          onChange={(value) => updatePlayerPrefs({ posterScale: value })}
          min={80}
          max={130}
        />
        <ScaleSetting
          title="Размер предпросмотра"
          description="Меняет карточку продолжения просмотра на главной странице."
          value={playerPrefs.previewScale}
          onChange={(value) => updatePlayerPrefs({ previewScale: value })}
          min={80}
          max={130}
        />
      </section>
    </>
  );
}

type ScaleSettingProps = {
  title: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  searchTerms?: string;
};

function ScaleSetting({
  title,
  description,
  value,
  onChange,
  min = 85,
  max = 125,
  searchTerms,
}: ScaleSettingProps) {
  const percentage = Math.round(value * 100);
  return (
    <Setting title={title} description={description} searchTerms={searchTerms}>
      <label className="settings-range">
        <input
          type="range"
          min={min}
          max={max}
          step="5"
          value={percentage}
          onChange={(event) => onChange(Number(event.target.value) / 100)}
        />
        <b>{percentage}%</b>
      </label>
    </Setting>
  );
}
