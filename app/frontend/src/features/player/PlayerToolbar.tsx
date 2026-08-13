import type { PlayerPrefs, ToolbarPosition } from "../../lib/types";
import { Toggle } from "../../components/Toggle";

export type PlayerSelectOption = {
  value: string;
  label: string;
};

type PlayerToolbarProps = {
  dubbings: string[];
  dubbing: string;
  onDubbingChange: (value: string) => void;
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
  onDubbingChange,
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
  return (
    <div className="player-toolbar">
      <label>
        Озвучка
        <select value={dubbing} onChange={event => onDubbingChange(event.target.value)}>
          {dubbings.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>

      <label>
        Серия
        <select value={episode} onChange={event => onEpisodeChange(event.target.value)}>
          {episodes.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <label>
        Источник
        <select value={source} onChange={event => onSourceChange(event.target.value)}>
          {sources.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>

      {openingLabel && <button onClick={onSkipOpening}>{openingLabel}</button>}
      {endingLabel && <button onClick={onSkipEnding}>{endingLabel}</button>}

      <details
        className="compact-options player-options"
        onClick={event => {
          if (event.target === event.currentTarget && event.currentTarget.open) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.open = false;
          }
        }}
      >
        <summary>⚙ Настройки просмотра</summary>
        <div>
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

          <label title="Определяет, с какой стороны плеера расположены выбор озвучки, серии, источника и настройки.">
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
          </label>
        </div>
      </details>
    </div>
  );
}
