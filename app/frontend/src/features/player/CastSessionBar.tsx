import { useEffect, useState } from "react";
import { EMPTY_CAST_STATE, sendCastCommand } from "../../lib/cast";
import { listenAppEvent } from "../../lib/events";
import { CastIcon } from "./CastRemotePanel";

/** Keep disconnect/play controls available after leaving the watch page. */
export function CastSessionBar() {
  const [state, setState] = useState(EMPTY_CAST_STATE);
  useEffect(() => {
    const unsubscribe = listenAppEvent("cast-state", setState);
    sendCastCommand("state");
    return unsubscribe;
  }, []);
  if ((!state.connected && !state.suspended) || !state.id.startsWith("animesoul:")) return null;
  return <aside className="animesoul-cast-session" aria-label="Трансляция на телевизор">
    <button type="button" onClick={() => sendCastCommand("choose")}><CastIcon /><span>{state.device || "Google Cast"}</span></button>
    <button type="button" disabled={state.suspended} aria-label={state.playing ? "Пауза на телевизоре" : "Продолжить на телевизоре"} onClick={() => sendCastCommand(state.playing ? "pause" : "play", { id: state.id })}>{state.playing ? "Ⅱ" : "▶"}</button>
    <button type="button" aria-label="Остановить трансляцию" onClick={() => sendCastCommand("stop")}>✕</button>
  </aside>;
}
