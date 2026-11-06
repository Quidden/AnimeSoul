"use client";
import { PlayerSelect, type PlayerOption } from "./PlayerSelect";
import { seasonLabel } from "../lib/season-label";
import { AnimePartSwitches, type PartFilter } from "./AnimePartSwitches";
export type { PlayerOption } from "./PlayerSelect";
export type PlayerMenu = {
  onResetDubbing?: () => void;
  preferences?: {
    resume: boolean;
    autoplay: boolean;
    onChange: (update: { resume?: boolean; autoplay?: boolean }) => void;
    notice: string;
  };
  filters?: PartFilter[];
  onFavoriteDubbing?: (value: string, enabled: boolean) => void;
  parts?: PlayerOption[];
  part?: string;
  onPartChange?: (value: string) => void;
  contextLabel?: string;
  seasons: PlayerOption[];
  season: string;
  onSeasonChange: (value: string) => void;
  episodes: PlayerOption[];
  episode: string;
  onEpisodeChange: (value: string) => void;
  dubbings: PlayerOption[];
  dubbing: string;
  onDubbingChange: (value: string) => void;
};
export function PlayerPlaybackSettings({ menu }: { menu: PlayerMenu }) {
  if (!menu.preferences) return null;
  return (
    <div className="player-playback-preferences">
      {menu.onResetDubbing && (
        <button type="button" className="player-reset-dubbing" onClick={menu.onResetDubbing}>
          Выбирать озвучку автоматически
        </button>
      )}
      <label>
        <input
          type="checkbox"
          role="switch"
          checked={menu.preferences.resume}
          onChange={(event) => menu.preferences?.onChange({ resume: event.target.checked })}
        />
        <span>Продолжать с сохранённого момента</span>
      </label>
      <label>
        <input
          type="checkbox"
          role="switch"
          checked={menu.preferences.autoplay}
          onChange={(event) => menu.preferences?.onChange({ autoplay: event.target.checked })}
        />
        <span>Запускать продолжение автоматически</span>
      </label>
      {menu.preferences.notice && <p role="status">{menu.preferences.notice}</p>}
    </div>
  );
}
export function PlayerMenuSelect({
  label,
  ariaLabel = label,
  value,
  options,
  onChange,
  onFavorite,
}: {
  label: string;
  ariaLabel?: string;
  value: string;
  options: PlayerOption[];
  onChange: (value: string) => void;
  onFavorite?: ((value: string, enabled: boolean) => void) | undefined;
}) {
  return (
    <PlayerSelect
      label={label}
      ariaLabel={ariaLabel}
      value={value}
      options={options}
      onChange={onChange}
      onFavorite={onFavorite}
    />
  );
}
export function PlayerEpisodeFields({
  menu,
  settings = false,
}: {
  menu: PlayerMenu;
  settings?: boolean;
}) {
  const hasPart = !!menu.parts?.length && menu.parts.length > 1 && !!menu.onPartChange;
  const hasSeason = !menu.parts?.length || menu.seasons.length > 1;
  return (
    <div className="player-episode-fields">
      {hasPart && menu.onPartChange && (
        <div className="player-episode-part">
          <PlayerMenuSelect
            label="Часть"
            ariaLabel={settings ? "Часть франшизы в настройках" : "Часть франшизы"}
            value={menu.part ?? ""}
            options={menu.parts ?? []}
            onChange={menu.onPartChange}
          />
        </div>
      )}
      {hasSeason && (
        <PlayerMenuSelect
          label="Сезон"
          ariaLabel={settings ? "Сезон в настройках" : "Сезон"}
          value={menu.season}
          options={menu.seasons}
          onChange={menu.onSeasonChange}
        />
      )}
      <div className={hasSeason ? "player-episode-number" : "player-episode-number full-width"}>
        <PlayerMenuSelect
          label="Серия"
          ariaLabel={settings ? "Серия в настройках" : "Серия"}
          value={menu.episode}
          options={menu.episodes}
          onChange={menu.onEpisodeChange}
        />
      </div>
    </div>
  );
}
export function PlayerTopNavigation({
  title,
  menu,
  open,
  onToggle,
}: {
  title: string;
  menu: PlayerMenu;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <div className="animesoul-player-top-navigation">
        <button
          type="button"
          className="animesoul-player-context"
          aria-label="Выбрать сезон и серию"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="animesoul-player-context-copy">
            <strong>
              {menu.contextLabel ?? `${seasonLabel(menu.season)} · Серия ${menu.episode}`}
            </strong>
            <span>{title}</span>
          </span>
          <i aria-hidden="true">⌄</i>
        </button>
        <div className="animesoul-player-voice-pill" title="Быстрый выбор озвучки">
          <span>Озвучка</span>
          <PlayerSelect
            label="Озвучка"
            compact
            value={menu.dubbing}
            options={menu.dubbings}
            onChange={menu.onDubbingChange}
            onFavorite={menu.onFavoriteDubbing}
            onOpen={() => {
              if (open) onToggle();
            }}
          />
        </div>
      </div>
      {open && (
        <div className="animesoul-player-quick-picker" aria-label="Выбор сезона и серии">
          <header className="player-picker-heading">
            <strong>Сезоны и серии</strong>
            <button type="button" aria-label="Закрыть выбор сезона и серии" onClick={onToggle}>
              ×
            </button>
          </header>
          {!!menu.filters?.length && (
            <AnimePartSwitches filters={menu.filters} label="Типы частей в плеере" />
          )}
          <PlayerEpisodeFields menu={menu} />
          <PlayerPlaybackSettings menu={menu} />
        </div>
      )}
    </>
  );
}
