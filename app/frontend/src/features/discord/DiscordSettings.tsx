import { useEffect, useState } from "react";
import { Toggle } from "../../components/Toggle";
import { Setting } from "../settings/Setting";
import { discordStatus, readDiscordPreferences, saveDiscordPreferences, type DiscordPreferences, type DiscordStatus } from "./presence";

const STATUS: Record<string, string> = {
  connected: "Подключено к Discord", disabled: "Активность выключена или скрыта",
  needs_application_id: "Укажите Application ID приложения AnimeSoul",
  unavailable: "Нет соединения. Проверьте Discord и Application ID — подключение повторится автоматически",
  local_required: "Нужен десктопный клиент или локальный сервер на этом ПК",
  unsupported: "Интеграция недоступна в этой сборке",
};

export function DiscordSettings() {
  const [preferences, setPreferences] = useState(readDiscordPreferences);
  const [status, setStatus] = useState<DiscordStatus>({ available: false, state: "checking" });
  useEffect(() => {
    let active = true;
    const refresh = async () => { const next = await discordStatus(); if (active) setStatus(next); };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const sync = () => setPreferences(readDiscordPreferences());
    window.addEventListener("storage", sync);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("storage", sync); };
  }, []);
  const change = (patch: Partial<DiscordPreferences>) => {
    const next = { ...preferences, ...patch };
    saveDiscordPreferences(next);
    setPreferences(next);
  };
  const parts = [preferences.season && "Сезон 2", preferences.episode && "Серия 5", preferences.time === "text" && "12:34 / 24:10"].filter(Boolean).join(" · ");
  const title = preferences.title ? "Атака титанов" : "Смотрит аниме";
  return <section className="settings-group" data-settings-tab="discord">
    <div className="settings-group-title"><b>Discord Rich Presence</b><span>Параметры сохраняются только на этом устройстве</span></div>
    <p role="status">{status.state === "checking" ? "Проверка подключения…" : !status.available ? "Нужен десктопный клиент Windows или локальный сервер на ПК с Discord." : STATUS[status.state] ?? status.state}</p>
    <Setting title="Показывать активность в Discord" description="Публикует выбранные данные в вашем профиле Discord. Discord должен работать на этом же ПК. Общий сервер не публикует активность посетителей.">
      <Toggle label="Включено" value={preferences.enabled} onChange={enabled => change({ enabled })} />
    </Setting>
    <Setting title="Application ID" description="ID приложения AnimeSoul из Discord Developer Portal. Это публичный ID, не токен бота. Название AnimeSoul и изображение с ключом animesoul задаются в этом приложении. Пустое поле использует ID сборки, если он настроен.">
      <input className="settings-text-input" aria-label="Discord Application ID" placeholder={status.applicationId || "ID приложения Discord"} inputMode="numeric" maxLength={22} value={preferences.applicationId} onChange={event => change({ applicationId: event.target.value.replace(/\D/g, "") })} />
    </Setting>
    {([
      ["logo", "Логотип AnimeSoul", "Показывать логотип рядом с активностью."],
      ["title", "Название аниме", "Показывать название просматриваемого аниме."],
      ["season", "Сезон", "Показывать название или номер сезона."],
      ["episode", "Серия", "Показывать номер серии или обозначение фильма."],
      ["idle", "Активность вне просмотра", "Показывать «В библиотеке», пока приложение открыто без воспроизведения."],
    ] as const).map(([key, label, description]) => <Setting key={key} title={label} description={description}><Toggle label="Показывать" value={preferences[key]} onChange={value => change({ [key]: value })} /></Setting>)}
    <Setting title="Порядок строк" description="Выберите, что будет первой строкой под названием AnimeSoul."><select aria-label="Порядок строк Discord" value={preferences.layout} onChange={event => change({ layout: event.target.value as DiscordPreferences["layout"] })}><option value="title-first">Название → сезон и серия</option><option value="episode-first">Сезон и серия → название</option></select></Setting>
    <Setting title="Время просмотра" description="Текст обновляется примерно раз в 15 секунд. На паузе и при текстовом таймкоде встроенный таймер показывает время в приложении."><select aria-label="Время просмотра Discord" value={preferences.time} onChange={event => change({ time: event.target.value as DiscordPreferences["time"] })}><option value="off">Не показывать</option><option value="elapsed">Прошедшее время</option><option value="remaining">Оставшееся время</option><option value="text">Таймкод / длительность</option></select></Setting>
    <Setting title="На паузе" description="Оставить данные с пометкой «Пауза» или скрыть активность."><select aria-label="Discord на паузе" value={preferences.paused} onChange={event => change({ paused: event.target.value as DiscordPreferences["paused"] })}><option value="show">Показывать паузу</option><option value="hide">Скрывать активность</option></select></Setting>
    <Setting title="Пример отображения" description="Условный пример. Окончательное оформление карточки определяет Discord."><div><b>{preferences.logo ? "◈ " : ""}AnimeSoul</b><p>{preferences.layout === "title-first" ? title : parts || title}</p><p>{preferences.layout === "title-first" ? parts : parts ? title : ""}</p>{preferences.time === "elapsed" && <small>Прошло 12:34</small>}{preferences.time === "remaining" && <small>Осталось 11:36</small>}</div></Setting>
  </section>;
}
