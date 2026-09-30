import { useEffect, useState } from "react";
import { lanRequest, type Device, type LanCommand, type RemoteState } from "./api";
import "./devices.css";
import { useLanPeers } from "./useLanPeers";
import { emitAppEvent } from "../../lib/events";


function useRemote(peerId: string) {
  const [state, setState] = useState<RemoteState | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<{ id: string; at: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await lanRequest<RemoteState>(`/peers/${peerId}/state`, "GET", undefined, controller.signal);
        if (!controller.signal.aborted) setState(next);
      } catch (error) {
        if (!controller.signal.aborted) { setState(null); setMessage(String(error instanceof Error ? error.message : error)); }
      } finally { busy = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [peerId]);
  useEffect(() => {
    if (!pending) return;
    if (state && Object.hasOwn(state.results, pending.id)) {
      setMessage(state.results[pending.id] || "Команда выполнена."); setPending(null);
    } else {
      const timer = window.setTimeout(() => {
        setMessage("Устройство не подтвердило команду. Проверьте подключение."); setPending(null);
      }, Math.max(0, pending.at + 15000 - Date.now()));
      return () => clearTimeout(timer);
    }
  }, [state, pending]);
  const command = async (value: Omit<LanCommand, "id">) => {
    if (sending || pending) return;
    setSending(true);
    try {
      const result = await lanRequest<{ id: string }>(`/peers/${peerId}/control`, "POST", value);
      setPending({ id: result.id, at: Date.now() }); setMessage("Ожидаем устройство…");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Ошибка управления."); }
    finally { setSending(false); }
  };
  return { state, message, command, loading, busy: sending || !!pending };
}

const time = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
function RemoteControls({ peer }: { peer: Device }) {
  const { state, message, command, busy, loading } = useRemote(peer.id);
  const [seek, setSeek] = useState<number | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  const player = state?.player;
  const duration = player?.duration || 0;
  const position = Math.min(duration, Math.max(0, player?.position || 0));
  const episodes = [...new Map((player?.episodes || []).map(e => [`${e.season}:${e.episode}`, e])).values()];
  const dubs = [...new Set((player?.episodes || []).filter(e => e.season === player?.season && e.episode === player?.episode).map(e => e.dubbing))];
  const commitSeek = () => { if (seek !== null) { void command({ action: "seek", seconds: seek }); setSeek(null); } };
  const commitVolume = () => { if (volume !== null) { void command({ action: "volume", volume }); setVolume(null); } };
  return <section className="device-card lan-remote" aria-label={`Пульт: ${peer.name}`}>
    <h2>{peer.name}</h2>
    <p>{loading ? "Подключаемся к устройству…" : !state ? "Нет связи с устройством" : !state.control ? "На устройстве не разрешено управление" : !player?.animeId ? "Откройте аниме на ПК или нажмите «Включить на устройстве»" : player.title}</p>
    {player?.preview && <img className="lan-preview" src={player.preview} alt={`Превью серии ${player.episode}`} />}
    {player?.animeId && <p>Сезон {player.season} · Серия {player.episode} · {player.dubbing} · {player.playing ? "Воспроизведение" : "Пауза"}</p>}
    <fieldset disabled={!state?.control || !player?.animeId || busy}>
      <label>Позиция · {time(seek ?? position)} / {time(duration)}
        <input aria-label="Позиция воспроизведения" type="range" min="0" max={duration || 1} step="1" disabled={!duration} value={seek ?? position} onChange={e => setSeek(Number(e.target.value))} onPointerUp={commitSeek} onKeyUp={commitSeek} onBlur={commitSeek} onPointerCancel={() => setSeek(null)} />
      </label>
      <div className="device-actions">
        <button onClick={() => void command({ action: "previous" })}>⏮ Предыдущая</button>
        <button disabled={!duration} onClick={() => void command({ action: "seek", seconds: Math.max(0, position - 10) })}>−10 с</button>
        <button onClick={() => void command({ action: player?.playing ? "pause" : "play" })}>{player?.playing ? "⏸ Пауза" : "▶ Играть"}</button>
        <button disabled={!duration} onClick={() => void command({ action: "seek", seconds: Math.min(duration, position + 10) })}>+10 с</button>
        <button onClick={() => void command({ action: "next" })}>Следующая ⏭</button>
      </div>
      <label>Громкость · {Math.round((volume ?? player?.volume ?? 1) * 100)}%
        <input aria-label="Громкость" type="range" min="0" max="1" step="0.01" value={volume ?? player?.volume ?? 1} onChange={e => setVolume(Number(e.target.value))} onPointerUp={commitVolume} onKeyUp={commitVolume} onBlur={commitVolume} onPointerCancel={() => setVolume(null)} />
      </label>
      <label>Серия<select value={`${player?.season}:${player?.episode}`} onChange={e => {
        const target = episodes.find(item => `${item.season}:${item.episode}` === e.target.value);
        if (target) {
          const sameDub = player?.episodes?.find(item => item.season === target.season && item.episode === target.episode && item.dubbing === player.dubbing);
          void command({ action: "episode", ...(sameDub || target) });
        }
      }}><option value="" disabled>Выберите серию</option>{episodes.map(e => <option key={`${e.season}:${e.episode}`} value={`${e.season}:${e.episode}`}>Сезон {e.season} · Серия {e.episode}</option>)}</select></label>
      <label>Озвучка<select value={player?.dubbing || ""} onChange={e => void command({ action: "episode", season: player?.season, episode: player?.episode, dubbing: e.target.value })}><option value="" disabled>Выберите озвучку</option>{dubs.map(d => <option key={d}>{d}</option>)}</select></label>
    </fieldset>
    <p role="status">{message}</p>
  </section>;
}

export function LanRemotePanel({ peers }: { peers: Device[] }) {
  const [selected, setSelected] = useState("");
  const peer = peers.find(p => p.id === selected) || peers.find(p => p.online) || peers[0];
  return <div className="lan-watch-panel">
    {peers.length > 1 && <label>Устройство <select value={peer?.id || ""} onChange={e => setSelected(e.target.value)}>{peers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    {peer ? <RemoteControls key={peer.id} peer={peer} /> : <p>Нет связанных устройств. Подключите устройство в настройках.</p>}
    <button type="button" onClick={() => emitAppEvent("open-settings", { tab: "devices" })}>Подключение и настройки устройств</button>
  </div>;
}

function PlayOnDevice({ peer, selection }: { peer: Device; selection: Omit<LanCommand, "id" | "action"> }) {
  const { state, message, command, busy } = useRemote(peer.id);
  return <div><button type="button" disabled={!state?.control || busy} onClick={() => void command({ action: "open", ...selection })}>Включить на {peer.name}</button>{message && <small role="status">{message}</small>}</div>;
}
export function PlayOnDevices({ selection }: { selection: Omit<LanCommand, "id" | "action"> }) {
  const peers = useLanPeers();
  return peers.length ? <div className="device-card device-actions">{peers.map(peer => <PlayOnDevice key={peer.id} peer={peer} selection={selection} />)}</div> : null;
}
