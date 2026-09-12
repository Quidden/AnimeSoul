export type SettingsTab =
  | "watching"
  | "player"
  | "appearance"
  | "credentials"
  | "offline"
  | "cloud"
  | "party"
  | "profiles"
  | "changelog"
  | "debug";

export type SettingsSearchResult = {
  id: string;
  tab: SettingsTab;
  title: string;
  description: string;
  kind: "section" | "setting";
};

type SettingsSearchEntry = SettingsSearchResult & {
  keywords?: string;
};

export const SETTINGS_SEARCH_TERMS: Record<SettingsTab, string> = {
  watching: "просмотр продолжение автозапуск предпросмотр история сохранять прогресс серия момент переход прокрутка",
  player: "плеер автоскип пропуск опенинг эндинг автосерия карусель миниатюры наведение панель таймкод расположение",
  appearance: "интерфейс оформление тема готовые собственная цвет палитра шрифт размер обложка постер карточка фото",
  credentials: "ключи api token токен yummyanime kodik public private google oauth client id secret подключение доступ",
  offline: "скачанные офлайн загрузки папка диск место качество озвучка серия аниме удалить интернет локально",
  cloud: "облако google drive синхронизация автосохранение выгрузка интервал восстановление папка oauth перенос статус подключение приоритет просмотрено",
  party: "совместно комната hamachi tailscale участник хост озвучка пинг синхронизация имя адрес правило личный догонять положение",
  profiles: "профиль активный переключение перенос резервная копия импорт экспорт загрузить выгрузить json конфиг",
  changelog: "ченжлог changelog история изменений версии релиз обновление новое исправлено улучшено",
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
    id: "credentials",
    icon: "⌘",
    label: "Ключи",
    description: "YummyAnime, Kodik и Google OAuth",
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
    id: "changelog",
    icon: "✦",
    label: "Изменения",
    description: "История версий и список исправлений",
  },
  {
    id: "debug",
    icon: "⌁",
    label: "Дебаг",
    description: "Действия, статусы и ошибки сайта",
  },
];

/** Searchable settings which can be opened directly from the app header. */
export const SETTINGS_SEARCH_ITEMS: SettingsSearchEntry[] = [
  { id: "watching-autoplay", tab: "watching", kind: "setting", title: "Автозапуск продолжения", description: "Запуск серии с сохранённого момента", keywords: "продолжить воспроизведение старт автоматически прогресс таймкод" },
  { id: "watching-preview", tab: "watching", kind: "setting", title: "Предпросмотр на главной", description: "Карточка последней серии на главном экране", keywords: "hero продолжение превью кадры постер" },
  { id: "watching-preview-source", tab: "watching", kind: "setting", title: "Источник предпросмотра", description: "HD-картинка или кадры серии", keywords: "фото изображение видео качество трафик" },
  { id: "watching-scroll", tab: "watching", kind: "setting", title: "Переход к плееру", description: "Плавная прокрутка после выбора серии", keywords: "автопрокрутка экран серия" },
  { id: "watching-history", tab: "watching", kind: "setting", title: "Сохранять историю", description: "Лента недавно просмотренных серий", keywords: "недавнее просмотр приватность отключить очистить" },

  { id: "player-opening", tab: "player", kind: "setting", title: "Автоскип опенинга", description: "Автоматический пропуск вступления по таймкоду", keywords: "пропустить заставка opening intro перемотка" },
  { id: "player-ending", tab: "player", kind: "setting", title: "Автоскип эндинга", description: "Автоматический пропуск титров по таймкоду", keywords: "пропустить ending outro титры перемотка" },
  { id: "player-next", tab: "player", kind: "setting", title: "Автосерия", description: "Автоматически открыть следующую серию", keywords: "следующая серия autoplay автовоспроизведение" },
  { id: "player-carousel", tab: "player", kind: "setting", title: "Карусель серий", description: "Предыдущая и следующая серии возле плеера", keywords: "переключение карточки сбоку" },
  { id: "player-thumbnails", tab: "player", kind: "setting", title: "Миниатюры при наведении", description: "Кадры серии над её карточкой", keywords: "превью скриншот hover мышь" },
  { id: "player-compact-episodes", tab: "player", kind: "setting", title: "Компактный список серий", description: "Более плотные карточки серий под страницей аниме", keywords: "новый вид сетка список снизу компактно плотный" },
  { id: "player-toolbar", tab: "player", kind: "setting", title: "Панель управления", description: "Расположение элементов управления плеером", keywords: "сверху снизу слева справа озвучка источник" },

  { id: "appearance-palette", tab: "appearance", kind: "setting", title: "Собственная палитра", description: "Основной и акцентный цвета интерфейса", keywords: "цвет фон акцент оформление кастомизация" },
  { id: "appearance-themes", tab: "appearance", kind: "setting", title: "Готовые темы", description: "Предустановленные цветовые оформления", keywords: "светлая темная фиолетовая цвет схема" },
  { id: "appearance-watched", tab: "appearance", kind: "setting", title: "Цвет просмотренной серии", description: "Оформление уже просмотренных серий", keywords: "рамка фон номер отметка" },
  { id: "appearance-text", tab: "appearance", kind: "setting", title: "Размер обычного текста", description: "Масштаб подписей, кнопок и метаданных", keywords: "шрифт масштаб интерфейс крупнее мельче" },
  { id: "appearance-headings", tab: "appearance", kind: "setting", title: "Размер заголовков", description: "Масштаб названий страниц и аниме", keywords: "шрифт название крупнее мельче" },
  { id: "appearance-posters", tab: "appearance", kind: "setting", title: "Размер обложек", description: "Высота постеров в каталоге", keywords: "карточка постер фото масштаб" },
  { id: "appearance-preview", tab: "appearance", kind: "setting", title: "Размер предпросмотра", description: "Размер карточки продолжения просмотра", keywords: "превью главная масштаб" },

  { id: "credentials-yummy", tab: "credentials", kind: "setting", title: "YummyAnime Public token", description: "Ключ каталога, карточек и онлайн-плеера", keywords: "api токен yummy ключ доступ" },
  { id: "credentials-kodik", tab: "credentials", kind: "setting", title: "Kodik API", description: "Public и Private ключи прямого видеопотока", keywords: "кодик api key секрет плеер скачивание" },
  { id: "credentials-google", tab: "credentials", kind: "setting", title: "Google Drive OAuth", description: "Client ID и Client Secret для облака", keywords: "гугл авторизация ключ подключение credentials" },

  { id: "offline-storage", tab: "offline", kind: "setting", title: "Папка для аниме", description: "Хранилище скачанных серий на устройстве", keywords: "память приложения диск директория загрузки место локально" },
  { id: "offline-kodik", tab: "offline", kind: "setting", title: "Официальный API Kodik", description: "Доступ к собственному плееру и скачиванию", keywords: "public private ключи прямые ссылки видео" },

  { id: "cloud-drive", tab: "cloud", kind: "setting", title: "Сохранения на Google Drive", description: "Подключение облачной копии прогресса", keywords: "гугл облако аккаунт backup резервная копия" },
  { id: "cloud-autosave", tab: "cloud", kind: "setting", title: "Автосохранение", description: "Когда отправлять изменения в облако", keywords: "сразу интервал расписание вручную синхронизация" },
  { id: "cloud-restore", tab: "cloud", kind: "setting", title: "Перенос и восстановление", description: "Объединить или восстановить данные устройства", keywords: "резервная копия импорт экспорт заменить облако локально" },
  { id: "cloud-folder", tab: "cloud", kind: "setting", title: "Папка на Google Drive", description: "Видимая папка или скрытое хранилище", keywords: "appdata директория диск" },
  { id: "cloud-watched", tab: "cloud", kind: "setting", title: "Приоритет отметки «просмотрено»", description: "Сохранить просмотренный статус при объединении", keywords: "merge прогресс серия синхронизация" },

  { id: "party-enable", tab: "party", kind: "setting", title: "Разрешить совместный режим", description: "Комнаты и синхронный просмотр с друзьями", keywords: "watch party участники вместе" },
  { id: "party-name", tab: "party", kind: "setting", title: "Имя участника", description: "Отображаемое имя в комнате", keywords: "ник nickname пользователь" },
  { id: "party-address", tab: "party", kind: "setting", title: "Адрес комнаты", description: "IP хоста в Hamachi, Tailscale или домашней сети", keywords: "сервер url порт подключение" },
  { id: "party-rule", tab: "party", kind: "setting", title: "Правило комнаты", description: "Управление только хостом или всеми участниками", keywords: "пауза перемотка общий режим" },
  { id: "party-mode", tab: "party", kind: "setting", title: "Мой личный режим", description: "Следовать за хостом или смотреть свободно", keywords: "медленный интернет синхронизация" },
  { id: "party-dubbing", tab: "party", kind: "setting", title: "Озвучка в комнате", description: "Своя озвучка или выбор хоста", keywords: "дуб перевод voice" },
  { id: "party-catchup", tab: "party", kind: "setting", title: "Автоматически догонять хоста", description: "Синхронизация позиции с ведущим", keywords: "таймкод задержка перемотка" },
  { id: "party-position", tab: "party", kind: "setting", title: "Положение участников", description: "Место панели комнаты возле плеера", keywords: "сверху снизу поверх интерфейс" },

  { id: "profiles-active", tab: "profiles", kind: "setting", title: "Активный профиль", description: "Переключение независимых сохранений и настроек", keywords: "пользователь аккаунт конфигурация" },
  { id: "profiles-backup", tab: "profiles", kind: "setting", title: "Резервная копия профиля", description: "Импорт и экспорт профиля в JSON", keywords: "перенос файл загрузить выгрузить восстановить" },
  { id: "changelog-history", tab: "changelog", kind: "setting", title: "История изменений", description: "Новые возможности, исправления и улучшения каждой версии", keywords: "что нового релиз версия changelog ченжлог" },
  { id: "debug-log", tab: "debug", kind: "setting", title: "Локальный журнал", description: "События, предупреждения и ошибки приложения", keywords: "дебаг debug лог диагностика экспорт" },
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

const normalized = (value: string) => value.trim().toLocaleLowerCase("ru");

function settingsSearchScore(entry: SettingsSearchEntry, rawQuery: string) {
  const query = normalized(rawQuery);
  const title = normalized(entry.title);
  const description = normalized(entry.description);
  const keywords = normalized(entry.keywords ?? "");
  const tokens = query.split(/\s+/).filter(Boolean);

  let score = entry.kind === "setting" ? 4 : 0;
  if (title === query) score += 120;
  else if (title.startsWith(query)) score += 70;
  else if (title.includes(query)) score += 45;

  for (const token of tokens) {
    if (title.includes(token)) score += 18;
    else if (description.includes(token)) score += 8;
    else if (keywords.includes(token)) score += 5;
  }
  return score;
}

export function searchSettings(
  rawQuery: string,
  options: { includeParty?: boolean; limit?: number } = {},
): SettingsSearchResult[] {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  const sections: SettingsSearchEntry[] = SETTINGS_TABS.map((tab) => ({
    id: `section-${tab.id}`,
    tab: tab.id,
    title: tab.label,
    description: tab.description,
    keywords: SETTINGS_SEARCH_TERMS[tab.id],
    kind: "section",
  }));
  const generalSettings: SettingsSearchEntry = {
    id: "section-settings",
    tab: "watching",
    title: "Настройки AnimeSoul",
    description: "Все параметры приложения, просмотра и интерфейса",
    keywords: "настройки параметры preferences конфигурация изменить настроить",
    kind: "section",
  };
  const includeParty = options.includeParty ?? true;
  const limit = Math.max(1, options.limit ?? 4);

  return [generalSettings, ...SETTINGS_SEARCH_ITEMS, ...sections]
    .filter((entry) => includeParty || entry.tab !== "party")
    .filter((entry) => matchesSettingsQuery(
      `${entry.title} ${entry.description} ${entry.keywords ?? ""}`,
      query,
    ))
    .sort((left, right) => (
      settingsSearchScore(right, query) - settingsSearchScore(left, query)
      || left.title.localeCompare(right.title, "ru")
    ))
    .slice(0, limit)
    .map(({ keywords: _keywords, ...entry }) => entry);
}
