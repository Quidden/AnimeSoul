import { useEffect, useState } from "react";
import type { OfflineAnime } from "../../lib/downloads";
import { lanRequest, type Device, type DeviceStatus, type LanCommand, type RemoteState } from "./api";
import "./devices.css";

const messageOf = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить действие.";
const sizeLabel = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

function PeerSettings({ peer, update, revoke, browse }: {
  peer: Device; update: (peer: Device) => Promise<void>; revoke: () => void; browse: () => void;
}) {
  const [draft, setDraft] = useState(peer);
  const [busy, setBusy] = useState(false);
  return <article className={`device-card device-connection ${peer.online ? "is-online" : "is-offline"}`}>
    <b>{peer.name}</b>
    <strong role="status">{peer.online ? "● Связано · в сети" : "○ Связано · нет связи"}</strong>
    {peer.error && <small>{peer.error}</small>}
    <div className="device-actions"><button type="button" onClick={browse}>Скачанные серии и пульт</button></div>
    <details><summary>Адрес, разрешения и управление связью</summary>
    <fieldset disabled={busy}>
      <label>Адрес в сети<input value={draft.host} onChange={e => setDraft({ ...draft, host: e.target.value })} /></label>
      <label><input type="checkbox" checked={draft.saves} onChange={e => setDraft({ ...draft, saves: e.target.checked })} /> Автоматическая синхронизация сейвов</label>
      <label><input type="checkbox" checked={draft.media} onChange={e => setDraft({ ...draft, media: e.target.checked })} /> Разрешить обмен видео</label>
      <label><input type="checkbox" checked={draft.control} onChange={e => setDraft({ ...draft, control: e.target.checked })} /> Разрешить этому устройству управлять моим плеером</label>
      <label>Приоритет пульта (0–100)<input type="number" min="0" max="100" value={draft.priority} onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })} /></label>
      <div className="device-actions">
        <button type="button" onClick={async () => { setBusy(true); try { await update(draft); } finally { setBusy(false); } }}>Сохранить доступ</button>
        <button type="button" onClick={revoke}>Отвязать</button>
      </div>
    </fieldset>
    </details>
  </article>;
}

function RemoteDevice({ peer, report, transferred }: { peer: Device; report: (text: string) => void; transferred: () => void }) {
  const [state, setState] = useState<RemoteState | null>(null);
  const [library, setLibrary] = useState<OfflineAnime[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ id: string; at: number } | null>(null);
  const [animeId, setAnimeId] = useState("");
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState("1");
  const [seconds, setSeconds] = useState(0);
  const [transferring, setTransferring] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const value = await lanRequest<RemoteState>(`/peers/${peer.id}/state`, "GET", undefined, controller.signal);
        if (!controller.signal.aborted) { setState(value); setError(""); }
      } catch (reason) { if (!controller.signal.aborted) { setError(messageOf(reason)); setState(null); } }
      finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [peer.id]);
  useEffect(() => {
    if (!pending) return;
    if (state && Object.hasOwn(state.results, pending.id)) {
      report(state.results[pending.id] || "Команда выполнена.");
      setPending(null);
    } else {
      const timer = window.setTimeout(() => {
        report("Устройство не подтвердило выполнение команды. Проверьте плеер.");
        setPending(null);
      }, Math.max(0, pending.at + 15_000 - Date.now()));
      return () => window.clearTimeout(timer);
    }
  }, [pending, report, state]);
  const command = async (value: Omit<LanCommand, "id">) => {
    try {
      const result = await lanRequest<{ id: string }>(`/peers/${peer.id}/control`, "POST", value);
      setPending({ id: result.id, at: Date.now() });
      report("Команда отправлена, ждём подтверждения…");
    } catch (reason) { report(messageOf(reason)); }
  };
  const loadLibrary = async () => {
    try {
      const value = await lanRequest<{ anime: OfflineAnime[] }>(`/peers/${peer.id}/library`);
      setLibrary(value.anime); setSelected([]);
      if (!value.anime.length) report("На устройстве нет скачанных серий.");
    } catch (reason) { report(messageOf(reason)); }
  };
  return <article className="device-card device-remote">
    <h3>{peer.name}: видео и управление</h3>
    {error && <p role="alert">{error}</p>}
    <p>{state?.player.title ? `${state.player.title} · сезон ${state.player.season}, серия ${state.player.episode} · ${state.player.dubbing || ""}` : "Плеер не открыт или управление не разрешено."}</p>
    {state?.player.animeId && <p>{state.player.playing ? "Играет" : "Пауза"} · {Math.floor(state.player.position ?? 0)} / {Math.floor(state.player.duration ?? 0)} сек.</p>}
    <fieldset disabled={!state?.control || !!pending}>
      <div className="device-actions">
        <button type="button" onClick={() => void command({ action: "previous" })}>Предыдущая</button>
        <button type="button" onClick={() => void command({ action: "play" })}>Воспроизвести</button>
        <button type="button" onClick={() => void command({ action: "pause" })}>Пауза</button>
        <button type="button" onClick={() => void command({ action: "next" })}>Следующая</button>
      </div>
      <label>Позиция, сек.<input type="number" min="0" max="604800" value={seconds} onChange={e => setSeconds(Number(e.target.value))} /></label>
      <button type="button" onClick={() => void command({ action: "seek", seconds })}>Перемотать</button>
      <label>Выбрать серию в открытом аниме<select value="" onChange={e => {
        const target = state?.player.episodes?.[Number(e.target.value)];
        if (target) void command({ action: "episode", ...target });
      }}><option value="">Сезон / серия / озвучка</option>{state?.player.episodes?.map((item, index) => <option key={index} value={index}>{item.season} / {item.episode} / {item.dubbing}</option>)}</select></label>
      <details><summary>Открыть другое аниме по ID каталога</summary>
        <label>ID аниме<input inputMode="numeric" value={animeId} onChange={e => setAnimeId(e.target.value)} /></label>
        <label>Сезон<input type="number" min="1" max="99" value={season} onChange={e => setSeason(Number(e.target.value))} /></label>
        <label>Серия<input value={episode} onChange={e => setEpisode(e.target.value)} /></label>
        <button type="button" disabled={!Number(animeId)} onClick={() => void command({ action: "open", animeId: Number(animeId), season, episode })}>Открыть на устройстве</button>
      </details>
    </fieldset>
    <div className="device-actions">
      <button type="button" onClick={() => void loadLibrary()}>Показать скачанное на устройстве</button>
      <button type="button" disabled={!selected.length || transferring || !peer.media} onClick={async () => {
        setTransferring(true);
        try {
          await lanRequest("/transfers", "POST", { peerId: peer.id, episodeIds: selected });
          report("Передача добавлена в очередь."); transferred(); setSelected([]);
        } catch (reason) { report(messageOf(reason)); }
        finally { setTransferring(false); }
      }}>Получить выбранные ({selected.length})</button>
    </div>
    <div className="device-library">{library.map(anime => <details key={anime.animeId}>
      <summary>{anime.title} · {anime.episodes.length} серий</summary>
      <button type="button" onClick={() => setSelected(current => [...new Set([...current, ...anime.episodes.map(e => e.id)])])}>Выбрать все серии</button>
      {anime.episodes.map(item => <div className="device-episode" key={item.id}>
        <label><input type="checkbox" checked={selected.includes(item.id)} onChange={e => setSelected(current => e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />
          {item.seasonLabel || `Сезон ${item.season}`} · {item.episode} · {item.dubbing} · {item.quality}p · {sizeLabel(item.sizeBytes)}</label>
        <button type="button" disabled={!state?.control || !!pending} onClick={() => void command({ action: "open", animeId: anime.animeId, season: item.season, episode: item.episode, dubbing: item.dubbing })}>Смотреть на {peer.name}</button>
      </div>)}
    </details>)}</div>
  </article>;
}

export function DeviceSettings() {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [code, setCode] = useState("");
  const [created, setCreated] = useState("");
  const [message, setMessage] = useState("");
  const [selectedPeer, setSelectedPeer] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try { setStatus(await lanRequest<DeviceStatus>("/status")); }
    catch (reason) { setMessage(messageOf(reason)); }
  };
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const value = await lanRequest<DeviceStatus>("/status", "GET", undefined, controller.signal);
        if (!controller.signal.aborted) { setStatus(value); setName(current => current || value.name); }
      } catch (reason) { if (!controller.signal.aborted) setMessage(messageOf(reason)); }
      finally { running = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  const configure = async (enabled: boolean, localPriority = status?.localPriority ?? true) => {
    setBusy(true);
    try {
      setStatus(await lanRequest<DeviceStatus>("/settings", "PUT", { enabled, name: name.trim() || status?.name || "AnimeSoul", localPriority }));
      if (!enabled) { setCreated(""); setSelectedPeer(""); }
    } catch (reason) { setMessage(messageOf(reason)); }
    finally { setBusy(false); }
  };
  const peer = status?.peers.find(p => p.id === selectedPeer);
  const address = status?.addresses.find(value => !value.startsWith("169.254.")) || status?.addresses[0];
  const onlineCount = status?.peers.filter(item => item.online).length || 0;
  return <section className="settings-group device-settings" data-settings-tab="devices">
    <div className="settings-group-title"><b>Устройства в локальной сети</b><span>Сейвы синхронизируются автоматически. Серии выбираются для передачи вручную. Интернет не нужен.</span></div>
    <p role="status" aria-live="polite">{message}</p>
    {!status ? <p>Загрузка настроек…</p> : <>
      <article className="device-card">
        <label><input type="checkbox" disabled={busy} checked={status.enabled} onChange={e => void configure(e.target.checked)} /> Включить локальный обмен</label>
        <p>Это устройство: <b>{status.name}</b></p>
        <strong role="status" className={onlineCount ? "device-online" : ""}>{onlineCount ? `● В сети: ${onlineCount} из ${status.peers.length}` : status.peers.length ? `○ Связано: ${status.peers.length}, сейчас не в сети` : "Устройства ещё не связаны"}</strong>
        {status.enabled && !status.listening && <p role="alert">LAN-сервер ещё не запущен или порт занят. Выключите и снова включите обмен.</p>}
        <details><summary>Имя устройства и приоритет пульта</summary>
        <label>Имя этого устройства<input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
        <button type="button" disabled={busy} onClick={() => void configure(status.enabled)}>Сохранить имя</button>
        <label><input type="checkbox" disabled={busy} checked={status.localPriority} onChange={e => void configure(status.enabled, e.target.checked)} /> Приоритет локального управления</label>
        <small>После действия на этом устройстве пульт ждёт 10 секунд. Между пультами действует приоритет 0–100; при равенстве управление сохраняется у текущего пульта на 15 секунд.</small>
        </details>
      </article>
      {status.enabled && <>
        <article className="device-card">
          <b>1. Покажите код на этом устройстве</b>
          <p>Откройте этот экран на втором устройстве. Передайте ему адрес и четырёхзначный код ниже. Оба устройства должны быть в одной сети.</p>
          <p>IPv4 этого устройства: <strong className="device-ip">{address || "Адрес не найден — проверьте Wi-Fi"}</strong></p>
          <button type="button" disabled={busy} onClick={async () => {
            try { setCreated((await lanRequest<{ code: string }>("/invite", "POST")).code); setMessage("Код готов. Введите его на втором устройстве в течение 5 минут."); }
            catch (reason) { setMessage(messageOf(reason)); }
          }}>Показать код</button>
          {created && <p className="device-code" aria-label={`Код привязки ${created}`}>{created}<small>Действует 5 минут, используется один раз</small></p>}
        </article>
        <article className="device-card">
          <b>2. Подключитесь к другому устройству</b>
          <p>Введите его IPv4 и код, который показан на его экране.</p>
          <label>IPv4 другого устройства<input placeholder="192.168.1.20" value={host} onChange={e => setHost(e.target.value)} /></label>
          <label>Четырёхзначный код<input inputMode="numeric" autoComplete="one-time-code" maxLength={4} pattern="[0-9]{4}" placeholder="1234" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
          <button type="button" disabled={busy || !host.trim() || code.length !== 4} onClick={async () => {
            setBusy(true);
            try {
              setStatus(await lanRequest<DeviceStatus>("/pair", "POST", { host: host.trim(), code }));
              setCode(""); setMessage("✓ Устройства связаны. Сейвы синхронизируются автоматически.");
            } catch (reason) { setMessage(messageOf(reason)); }
            finally { setBusy(false); }
          }}>Связать</button>
        </article>
        <p>Сейвы объединяются по ID профиля, включая «Основной». Разные ID остаются отдельными профилями. Изменения сохраняются обычным способом и отправляются в Google Drive, если он подключён. Ключи API, привязки и настройки пульта по сети не передаются.</p>
        <p>Для работы держите оба приложения открытыми. В гостевой Wi-Fi-сети обмен может блокироваться роутером; на Windows разрешите приложению доступ в частной сети.</p>
        <h3>Связанные устройства</h3>
        {status.peers.length === 0 && <p>После привязки устройство появится здесь со статусом соединения.</p>}
        {status.peers.map(item => <PeerSettings key={`${item.id}:${item.host}:${item.saves}:${item.media}:${item.control}:${item.priority}`} peer={item}
          browse={() => setSelectedPeer(item.id)} revoke={() => {
            void lanRequest<DeviceStatus>(`/peers/${item.id}`, "DELETE").then(setStatus).catch(reason => setMessage(messageOf(reason)));
          }} update={async value => {
            try { setStatus(await lanRequest<DeviceStatus>(`/peers/${item.id}`, "PUT", value)); setMessage("Разрешения сохранены."); }
            catch (reason) { setMessage(messageOf(reason)); }
          }} />)}
        {peer && <RemoteDevice key={peer.id} peer={peer} report={setMessage} transferred={() => void refresh()} />}
      </>}
      {status.transfers.map(transfer => <article className="device-card" key={transfer.id}>
        <b>{transfer.title}</b>
        <span>{{ queued: "В очереди", downloading: "Передача", completed: "Готово", error: "Ошибка", cancelled: "Отменено" }[transfer.status] || transfer.status} · {transfer.completed}/{transfer.total} серий</span>
        {transfer.status === "downloading" && <><progress max={transfer.totalBytes || 1} value={transfer.bytes} /><small>{sizeLabel(transfer.bytes)} / {sizeLabel(transfer.totalBytes)}</small></>}
        {transfer.error && <p role="alert">{transfer.error}</p>}
        {["queued", "downloading"].includes(transfer.status) && <button type="button" onClick={() => { void lanRequest(`/transfers/${transfer.id}`, "DELETE").then(refresh).catch(reason => setMessage(messageOf(reason))); }}>Отменить</button>}
      </article>)}
    </>}
  </section>;
}
