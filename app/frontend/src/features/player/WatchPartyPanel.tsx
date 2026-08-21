import type { PlayerPrefs } from "../../lib/types";
import { formatTime } from "../../lib/anime";
import type { WatchPartyController } from "../../hooks/useWatchParty";

type WatchPartyPanelProps = {
  enabled: boolean;
  panelPosition: PlayerPrefs["watchPartyPanelPosition"];
  personalMode: PlayerPrefs["watchPartyMode"];
  roomMode: PlayerPrefs["watchPartyRoomMode"];
  party: WatchPartyController;
  roomCode: string;
  onRoomCodeChange: (value: string) => void;
  onRoomModeChange: (value: PlayerPrefs["watchPartyRoomMode"]) => void;
  suggestedHostDub: string | null;
  onAcceptHostDub: () => void;
  onDismissHostDub: () => void;
  dubbingNotice: string;
  isKodikSource: boolean;
};

/**
 * Presentation-only room panel. Network polling and player synchronization
 * stay in useWatchParty, so this component can be changed without touching
 * the Watch Party protocol.
 */
export function WatchPartyPanel({
  enabled,
  panelPosition,
  personalMode,
  roomMode,
  party,
  roomCode,
  onRoomCodeChange,
  onRoomModeChange,
  suggestedHostDub,
  onAcceptHostDub,
  onDismissHostDub,
  dubbingNotice,
  isKodikSource,
}: WatchPartyPanelProps) {
  if (!enabled) return null;

  return (
    <section className={`watch-party-panel party-${panelPosition} ${party.session ? "connected" : ""}`}>
      <div className="watch-party-head">
        <b>Совместный просмотр</b>
        {party.session && (
          <span>
            Комната <strong>{party.session.roomId}</strong> · {party.session.role === "host" ? "вы хост" : "участник"} · {personalMode === "follow"
              ? party.party?.roomMode === "shared" ? "общее управление" : "следуете за хостом"
              : "свободный просмотр / медленный интернет"}
          </span>
        )}
      </div>

      {!party.session && (
        <small className="watch-party-notice">
          Совместный просмотр работает только с онлайн-источником. Локальная копия временно отключится после подключения к комнате.
        </small>
      )}

      {!party.session ? (
        <div className="watch-party-connect">
          <button type="button" onClick={() => void party.createRoom()}>Создать комнату</button>
          <label>
            <input
              value={roomCode}
              onChange={event => onRoomCodeChange(event.target.value.toUpperCase())}
              placeholder="Код комнаты"
              maxLength={8}
            />
            <button type="button" disabled={!roomCode.trim()} onClick={() => void party.joinRoom(roomCode)}>
              Подключиться
            </button>
          </label>
        </div>
      ) : (
        <>
          <div className="watch-party-room-rule">
            {party.session.role === "host" ? (
              <label title="Только хост: управляет всеми один хост. Общее управление: любой синхронизированный участник может поставить паузу, запустить или переключить серию.">
                Правило комнаты
                <select value={roomMode} onChange={event => onRoomModeChange(event.target.value as PlayerPrefs["watchPartyRoomMode"])}>
                  <option value="host">Все следуют за хостом</option>
                  <option value="shared">Все управляют на равных</option>
                </select>
              </label>
            ) : (
              <small>Правило комнаты: <b>{party.party?.roomMode === "shared" ? "все управляют на равных" : "все следуют за хостом"}</b></small>
            )}
            <small>Личный свободный режим можно включить в любой момент — он не меняет режим всей комнаты.</small>
          </div>

          <div className="party-participants">
            {party.party?.participants.map(participant => (
              <article key={participant.id} className={participant.online ? "" : "offline"}>
                <i />
                <span>
                  <b>{participant.name}{participant.role === "host" ? " · Хост" : ""}</b>
                  <small>
                    {participant.playback
                      ? `Сезон ${participant.playback.season} · серия ${participant.playback.episode} · ${formatTime(participant.playback.position)}`
                      : "Подключается…"} · {participant.mode === "follow" ? "синхронизирован" : "свободно"}
                  </small>
                </span>
                {participant.buffering && <em>Загрузка</em>}
                {party.session?.role === "host" && participant.role !== "host" && participant.online && (
                  <button type="button" onClick={() => void party.transferHost(participant.id)}>Передать хоста</button>
                )}
              </article>
            ))}
          </div>

          <div className="watch-party-actions">
            {personalMode === "free" && <button type="button" onClick={party.catchUp}>Перейти к общему таймкоду</button>}
            <button type="button" className="danger" onClick={() => void party.leaveRoom()}>Покинуть</button>
          </div>
        </>
      )}

      {suggestedHostDub && (
        <div className="party-dub-suggestion">
          <span>Хост смотрит в озвучке <b>{suggestedHostDub}</b>. Переключиться?</span>
          <button type="button" onClick={onAcceptHostDub}>Переключиться</button>
          <button type="button" onClick={onDismissHostDub}>Оставить мою</button>
        </div>
      )}
      {dubbingNotice && <small className="watch-party-notice">{dubbingNotice}</small>}
      {party.session && !isKodikSource && (
        <small className="watch-party-notice">
          Для этого источника синхронизация серии и озвучки работает, но точные таймкоды, пауза и перемотка могут не поддерживаться. Для полной синхронизации выбери Kodik.
        </small>
      )}
      {party.error && <small className="watch-party-error">{party.error}</small>}
    </section>
  );
}
