import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PlayerPrefs, ToolbarPosition } from "../../lib/types";
import { Toggle } from "../../components/Toggle";
import { IS_ANDROID_APP } from "../../lib/platform";
import { useModalAccessibility } from "../../lib/modalAccessibility";

export type PlayerSelectOption = {
  value: string;
  label: string;
};

type PlayerToolbarProps = {
  dubbings: string[];
  dubbing: string;
  favoriteDubbings?: string[];
  preferredDubbing?: string;
  onDubbingChange: (value: string) => void;
  dubbingFavorite: boolean;
  onDubbingFavoriteToggle: () => void;
  dubbingGloballyPreferred: boolean;
  onDubbingGloballyPreferredToggle: () => void;
  episodes: PlayerSelectOption[];
  episode: string;
  onEpisodeChange: (value: string) => void;
  sources: string[];
  source: string;
  onSourceChange: (value: string) => void;
  openingLabel?: string;
  endingLabel?: string;
  onSkipOpening: () => void;
  onSkipEnding: () => void;
  autoSkipOpening: boolean;
  onAutoSkipOpeningChange: (value: boolean) => void;
  autoSkipEnding: boolean;
  onAutoSkipEndingChange: (value: boolean) => void;
  autoNext: boolean;
  onAutoNextChange: (value: boolean) => void;
  autoScrollPlayer: boolean;
  onAutoScrollPlayerChange: (value: boolean) => void;
  episodeCarousel: boolean;
  onEpisodeCarouselChange: (value: boolean) => void;
  episodeHoverPreview: boolean;
  onEpisodeHoverPreviewChange: (value: boolean) => void;
  prefs: PlayerPrefs;
  onPrefsChange: (patch: Partial<PlayerPrefs>) => void;
  position: ToolbarPosition;
  onPositionChange: (position: ToolbarPosition) => void;
};

/**
 * Player controls and preferences shown around the video.
 *
 * This component intentionally contains no player or persistence logic. The
 * parent owns video selection, Kodik commands and settings storage; the
 * toolbar only reports user intent through callbacks.
 */
export function PlayerToolbar({
  dubbings,
  dubbing,
  favoriteDubbings = [],
  preferredDubbing = "",
  onDubbingChange,
  dubbingFavorite,
  onDubbingFavoriteToggle,
  dubbingGloballyPreferred,
  onDubbingGloballyPreferredToggle,
  episodes,
  episode,
  onEpisodeChange,
  sources,
  source,
  onSourceChange,
  openingLabel,
  endingLabel,
  onSkipOpening,
  onSkipEnding,
  autoSkipOpening,
  onAutoSkipOpeningChange,
  autoSkipEnding,
  onAutoSkipEndingChange,
  autoNext,
  onAutoNextChange,
  autoScrollPlayer,
  onAutoScrollPlayerChange,
  episodeCarousel,
  onEpisodeCarouselChange,
  episodeHoverPreview,
  onEpisodeHoverPreviewChange,
  prefs,
  onPrefsChange,
  position,
  onPositionChange,
}: PlayerToolbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsDialogRef = useRef<HTMLElement>(null);

  useModalAccessibility(settingsOpen, () => setSettingsOpen(false), settingsDialogRef);

  return (
    <div className={`player-toolbar${prefs.toolbarIconOnly ? " is-icon-only" : ""}`}>
      <div className="player-toolbar-controls">
        <label className="toolbar-select toolbar-select-dubbing" data-icon="♫" title="Озвучка">
          <span>Озвучка</span>
          <select aria-label="Озвучка" value={dubbing} onChange={event => onDubbingChange(event.target.value)}>
            {dubbings.map(value => (
              <option key={value} value={value}>
                {preferredDubbing === value ? "♥ " : ""}{favoriteDubbings.includes(value) ? "★ " : ""}{value}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`toolbar-dubbing-action${dubbingFavorite ? " active" : ""}`}
          title={dubbingFavorite ? "Убрать озвучку из общего избранного" : "Добавить озвучку в общее избранное"}
          aria-label={dubbingFavorite ? "Убрать озвучку из избранного" : "Добавить озвучку в избранное"}
          aria-pressed={dubbingFavorite}
          onClick={onDubbingFavoriteToggle}
        >★</button>
        <button
          type="button"
          className={`toolbar-dubbing-action title-default${dubbingGloballyPreferred ? " active" : ""}`}
          title={dubbingGloballyPreferred ? "Снять любимую озвучку для всех тайтлов" : "Сделать любимой озвучкой для всех тайтлов"}
          aria-label={dubbingGloballyPreferred ? "Снять глобальную любимую озвучку" : "Назначить глобальную любимую озвучку"}
          aria-pressed={dubbingGloballyPreferred}
          onClick={onDubbingGloballyPreferredToggle}
        >♥</button>

        <label className="toolbar-select toolbar-select-episode" data-icon="≣" title="Серия">
          <span>Серия</span>
          <select aria-label="Серия" value={episode} onChange={event => onEpisodeChange(event.target.value)}>
            {episodes.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="toolbar-select toolbar-select-source" data-icon="◉" title="Источник">
          <span>Источник</span>
          <select aria-label="Источник" value={source} onChange={event => onSourceChange(event.target.value)}>
            {sources.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>

        {openingLabel && <button className="toolbar-skip toolbar-skip-opening" title={openingLabel} aria-label={openingLabel} onClick={onSkipOpening}><span>{openingLabel}</span></button>}
        {endingLabel && <button className="toolbar-skip toolbar-skip-ending" title={endingLabel} aria-label={endingLabel} onClick={onSkipEnding}><span>{endingLabel}</span></button>}

      </div>

      <div className="player-toolbar-actions">
        <button
          type="button"
          className="player-settings-trigger"
          title="Настройки просмотра"
          aria-label="Настройки просмотра"
          onClick={() => setSettingsOpen(true)}
        />
      </div>

      {settingsOpen && typeof document !== "undefined" && createPortal(
        <div className="player-settings-layer" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section
            ref={settingsDialogRef}
            className="player-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Настройки просмотра"
            tabIndex={-1}
            onMouseDown={event => event.stopPropagation()}
          >
            <header className="player-settings-header">
              <strong>Настройки просмотра</strong>
              <button type="button" aria-label="Закрыть настройки" title="Закрыть" onClick={() => setSettingsOpen(false)}>×</button>
            </header>
            <div className="player-settings-content">
          <div className="player-settings-dubbing-actions">
            <span>Текущая озвучка: <b>{dubbing}</b></span>
            <div>
              <button
                type="button"
                className={dubbingFavorite ? "active" : ""}
                aria-pressed={dubbingFavorite}
                onClick={onDubbingFavoriteToggle}
              >★ Избранная</button>
              <button
                type="button"
                className={dubbingGloballyPreferred ? "active title" : ""}
                aria-pressed={dubbingGloballyPreferred}
                onClick={onDubbingGloballyPreferredToggle}
              >♥ Любимая везде</button>
            </div>
          </div>
          <Toggle label="Автоскип опенинга" value={autoSkipOpening} onChange={onAutoSkipOpeningChange} />
          <Toggle label="Автоскип эндинга" value={autoSkipEnding} onChange={onAutoSkipEndingChange} />
          <Toggle label="Автосерия" value={autoNext} onChange={onAutoNextChange} />
          <Toggle label="Переход к плееру" value={autoScrollPlayer} onChange={onAutoScrollPlayerChange} />
          <Toggle label="Карусель серий" value={episodeCarousel} onChange={onEpisodeCarouselChange} />
          <Toggle
            label="Предпросмотр серии при наведении"
            value={episodeHoverPreview}
            onChange={onEpisodeHoverPreviewChange}
          />
          <Toggle
            label="Компактная панель (только иконки)"
            value={prefs.toolbarIconOnly}
            onChange={toolbarIconOnly => onPrefsChange({ toolbarIconOnly })}
          />
          {!IS_ANDROID_APP && <>
            <Toggle
              label="Совместный режим"
              value={prefs.watchPartyEnabled}
              onChange={watchPartyEnabled => onPrefsChange({ watchPartyEnabled })}
            />

          {prefs.watchPartyEnabled && (
            <label title="Синхронизация подчиняется правилу комнаты. Свободный режим всегда доступен лично тебе, не принимает общие команды и не отправляет твои действия другим.">
              Мой режим
              <select
                value={prefs.watchPartyMode}
                onChange={event => onPrefsChange({ watchPartyMode: event.target.value as "follow" | "free" })}
              >
                <option value="follow">Синхронизироваться с комнатой</option>
                <option value="free">Свободный просмотр / Режим медленного интернета</option>
              </select>
            </label>
          )}

          {prefs.watchPartyEnabled && (
            <label title="Можно оставить свою озвучку, получать предложение при смене озвучки хостом или переключаться автоматически.">
              Озвучка в комнате
              <select
                value={prefs.watchPartyDubMode}
                onChange={event => onPrefsChange({
                  watchPartyDubMode: event.target.value as "own" | "suggest" | "follow",
                })}
              >
                <option value="own">Своя у каждого</option>
                <option value="suggest">Предлагать озвучку хоста</option>
                <option value="follow">Следовать за озвучкой хоста</option>
              </select>
            </label>
          )}

          {prefs.watchPartyEnabled && (
            <label title="Определяет, где рядом с плеером показывается комната и таймкоды участников.">
              Участники
              <select
                value={prefs.watchPartyPanelPosition}
                onChange={event => onPrefsChange({
                  watchPartyPanelPosition: event.target.value as "top" | "bottom" | "overlay",
                })}
              >
                <option value="top">Сверху</option>
                <option value="bottom">Снизу</option>
                <option value="overlay">Поверх плеера</option>
              </select>
            </label>
          )}
          </>}

          {!IS_ANDROID_APP && <label title="Определяет, с какой стороны плеера расположены выбор озвучки, серии, источника и настройки.">
            Панель
            <select
              value={position}
              onChange={event => onPositionChange(event.target.value as ToolbarPosition)}
            >
              <option value="bottom">Снизу</option>
              <option value="top">Сверху</option>
              <option value="left">Слева</option>
              <option value="right">Справа</option>
            </select>
          </label>}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
