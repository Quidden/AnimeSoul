"use client";
import type { Account } from "@animesoul/contracts";
import { usePlayerPreferences } from "./usePlayerPreferences";
import { useSettingsAnchor } from "../lib/use-settings-anchor";
export function AccountPlayerSettings({ account }: { account: Account }) {
  const player = usePlayerPreferences(undefined, account, true);
  useSettingsAnchor("player-settings");
  return (
    <section id="player-settings" className="account-card account-settings-anchor">
      <h2>Воспроизведение</h2>
      <div className="account-form">
        <label className="account-check">
          <input
            type="checkbox"
            role="switch"
            checked={player.preferences.resume}
            disabled={!player.ready}
            onChange={(event) => player.edit({ resume: event.target.checked })}
          />
          Продолжать с сохранённого момента
        </label>
        <label className="account-check">
          <input
            type="checkbox"
            role="switch"
            checked={player.preferences.autoplay}
            disabled={!player.ready}
            onChange={(event) => player.edit({ autoplay: event.target.checked })}
          />
          Запускать продолжение автоматически
        </label>
        <p className="account-help">
          Позиция и озвучка синхронизируются между устройствами. Ваш выбор озвучки для конкретного
          аниме имеет приоритет перед избранными.
        </p>
        <h3>Любимые озвучки</h3>
        {player.preferences.favoriteDubbings.length ? (
          <div className="player-favorite-list">
            {player.preferences.favoriteDubbings.map((name) => (
              <button
                type="button"
                className="outline"
                key={name}
                aria-label={`Убрать из избранных озвучек: ${name}`}
                onClick={() => player.favorite(name, false)}
              >
                ★ {name} ×
              </button>
            ))}
          </div>
        ) : (
          <p className="account-help">Добавляйте озвучки звёздочкой в меню плеера.</p>
        )}
        {player.notice && <p role="status">{player.notice}</p>}
      </div>
    </section>
  );
}
