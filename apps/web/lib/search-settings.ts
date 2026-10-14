import { normalizeSearchText, scoreSearchText } from "@animesoul/contracts";

export type SearchSetting = {
  id: string;
  label: string;
  description: string;
  href: string;
  keywords: string[];
};

export const searchSettings: SearchSetting[] = [
  {
    id: "player",
    label: "Настройки воспроизведения",
    description: "Автозапуск, продолжение просмотра и любимые озвучки",
    href: "/account#player-settings",
    keywords: [
      "плеер",
      "видео",
      "автозапуск",
      "продолжение",
      "таймкод",
      "озвучка",
      "любимые озвучки",
      "player",
      "autoplay",
    ],
  },
  {
    id: "appearance",
    label: "Тема оформления",
    description: "Лиловая или Графит — две тёмные темы на этом устройстве",
    href: "/account#appearance-settings",
    keywords: [
      "тема",
      "оформление",
      "смена темы",
      "сменить тему",
      "цвет",
      "графит",
      "лиловая",
      "theme",
      "appearance",
    ],
  },
  {
    id: "profile",
    label: "Настройки профиля",
    description: "Имя, аватар, обложка, статус и информация о себе",
    href: "/account#profile-settings",
    keywords: [
      "профиль",
      "ник",
      "имя",
      "аватар",
      "обложка",
      "статус",
      "невидимый",
      "не беспокоить",
      "о себе",
      "profile",
      "avatar",
    ],
  },
  {
    id: "privacy",
    label: "Приватность и видимость",
    description: "Кто видит профиль, разделы и может добавлять вас в друзья",
    href: "/account#privacy-settings",
    keywords: [
      "приватность",
      "видимость",
      "скрыть",
      "доступ",
      "друзья",
      "заявки в друзья",
      "индексация",
      "любимое",
      "папки",
      "оценки",
      "статистика",
      "посты",
      "рецензии",
      "комментарии",
      "история комментариев",
      "privacy",
    ],
  },
  {
    id: "security",
    label: "Безопасность аккаунта",
    description: "Пароль и двухфакторная защита административного доступа",
    href: "/account#security-settings",
    keywords: [
      "безопасность",
      "пароль",
      "защита",
      "второй фактор",
      "двухфакторная аутентификация",
      "totp",
      "2fa",
      "mfa",
      "password",
      "security",
    ],
  },
  {
    id: "identity",
    label: "Почта и Google",
    description: "Подтверждение и смена почты, вход через Google, восстановление пароля",
    href: "/account#identity-settings",
    keywords: [
      "почта",
      "email",
      "google",
      "вход",
      "подтверждение",
      "восстановление",
      "привязка",
      "смена",
      "сменить",
    ],
  },
];

/** Common entry points for the empty search preview; no usage telemetry is implied. */
export const popularSearchSettings: readonly SearchSetting[] = [...searchSettings].sort(
  (a, b) => Number(b.id === "appearance") - Number(a.id === "appearance"),
);

export function findSearchSettings(query: string): SearchSetting[] {
  if (!normalizeSearchText(query)) return [];
  return searchSettings
    .map((setting) => ({
      setting,
      score: Math.max(
        scoreSearchText(query, setting.label),
        scoreSearchText(query, setting.description),
        scoreSearchText(query, `настройки settings ${setting.label} ${setting.keywords.join(" ")}`),
        ...setting.keywords.map((keyword) => scoreSearchText(query, keyword)),
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ setting }) => setting);
}
