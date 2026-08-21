export type SettingsTab =
  | "watching"
  | "player"
  | "appearance"
  | "offline"
  | "cloud"
  | "party"
  | "profiles"
  | "debug";

export const SETTINGS_SEARCH_TERMS: Record<SettingsTab, string> = {
  watching: "просмотр продолжение автозапуск предпросмотр история сохранять прогресс серия момент переход прокрутка",
  player: "плеер автоскип пропуск опенинг эндинг автосерия карусель миниатюры наведение панель таймкод расположение",
  appearance: "интерфейс оформление тема готовые собственная цвет палитра шрифт размер обложка постер карточка фото",
  offline: "скачанные офлайн загрузки папка диск место качество озвучка серия аниме удалить интернет локально",
  cloud: "облако google drive синхронизация автосохранение выгрузка интервал восстановление папка oauth перенос статус подключение приоритет просмотрено",
  party: "совместно комната hamachi tailscale участник хост озвучка пинг синхронизация имя адрес правило личный догонять положение",
  profiles: "профиль активный переключение перенос резервная копия импорт экспорт загрузить выгрузить json конфиг",
  debug: "дебаг отладка журнал лог событие действие статус успешно ошибка предупреждение api сохранение диагностика экспорт",
};

export const SETTINGS_TABS: Array<{
  id: SettingsTab;
  icon: string;
  label: string;
  description: string;
}> = [
  {
    id: "watching",
    icon: "▶",
    label: "Просмотр",
    description: "Продолжение серии, предпросмотр и история",
  },
  {
    id: "player",
    icon: "▣",
    label: "Плеер",
    description: "Автопропуск, автосерия и расположение панели",
  },
  {
    id: "appearance",
    icon: "◐",
    label: "Интерфейс",
    description: "Темы, цвета и размеры элементов",
  },
  {
    id: "offline",
    icon: "⇩",
    label: "Офлайн",
    description: "Папка загрузок, качество и локальная библиотека",
  },
  {
    id: "cloud",
    icon: "☁",
    label: "Облако",
    description: "Google Drive и восстановление сохранений",
  },
  {
    id: "party",
    icon: "◎",
    label: "Совместно",
    description: "Комнаты, синхронизация и режимы участников",
  },
  {
    id: "profiles",
    icon: "◇",
    label: "Профили",
    description: "Переключение, импорт и резервная копия",
  },
  {
    id: "debug",
    icon: "⌁",
    label: "Дебаг",
    description: "Действия, статусы и ошибки сайта",
  },
];

export function matchesSettingsQuery(searchableText: string, rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase("ru");
  if (!query) return true;

  const text = searchableText.toLocaleLowerCase("ru");
  return query.split(/\s+/).every((token) => {
    if (text.includes(token)) return true;

    // Keep common Russian word endings searchable without adding a heavy
    // stemming dependency to the settings screen.
    const stem = token.length >= 6 ? token.slice(0, -1) : token;
    return stem.length >= 4 && text.includes(stem);
  });
}
