import type { CastState } from "../../lib/cast";

function clock(seconds: number) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function CastIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 8V5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-8M3 12a8 8 0 0 1 8 8M3 16a4 4 0 0 1 4 4"/><circle cx="3" cy="20" r="1" fill="currentColor" stroke="none"/></svg>;
}

export function CastRemotePanel({ state, preparing, command, choose }: {
  state: CastState;
  preparing: boolean;
  command: (action: string, data?: Record<string, unknown>) => unknown;
  choose: () => void;
}) {
  const busy = preparing || Boolean(state.pendingId) || state.buffering || state.suspended;
  return <section className="animesoul-cast-panel" aria-label="Управление телевизором">
    <div className="animesoul-cast-device"><CastIcon /><b>{state.device || "Телевизор"}</b></div>
    <span role={state.error ? "alert" : "status"}>{state.error || (state.suspended ? "Восстанавливаем связь…" : busy ? "Подготавливаем видео на телевизоре…" : state.finished ? "Серия закончилась" : "Воспроизведение на телевизоре")}</span>
    <div className="animesoul-cast-transport">
      <button type="button" disabled={busy} aria-label="Назад 10 секунд на телевизоре" onClick={() => command("seek", { position: Math.max(0, state.position - 10) })}>−10</button>
      <button type="button" disabled={busy} aria-label={state.playing ? "Пауза на телевизоре" : "Воспроизвести на телевизоре"} onClick={() => command(state.playing ? "pause" : "play")}>{state.playing ? "Ⅱ" : "▶"}</button>
      <button type="button" disabled={busy} aria-label="Вперёд 10 секунд на телевизоре" onClick={() => command("seek", { position: Math.min(state.duration, state.position + 10) })}>+10</button>
    </div>
    <label className="animesoul-cast-timeline"><span>{clock(state.position)} / {clock(state.duration)}</span>
      <input type="range" min="0" max={state.duration || 0} value={Math.min(state.position, state.duration || 0)} step="1" disabled={busy || !state.duration} aria-label="Позиция видео на телевизоре" onChange={event => command("seek", { position: Number(event.target.value) })} />
    </label>
    <div className="animesoul-cast-actions">
      <button type="button" onClick={choose}>Устройство / громкость</button>
      <button type="button" onClick={() => command("stop")}>Вернуть на телефон</button>
    </div>
  </section>;
}
