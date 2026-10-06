import type { Folder } from "../../lib/types";

export type Presence = "online" | "offline" | "dnd" | "invisible";
export type ProfileSection = "about" | "favorites" | "collections" | "ratings" | "statistics";
export type ProfileVisibility = Record<ProfileSection, boolean>;
export type UserProfile = {
  id: string;
  username: string;
  avatar: string;
  banner: string;
  about: string | null;
  presence: Presence;
  badges: { id: string; name: string; kind: "admin" | "premium" | "unique" | "member" }[];
  joinedAt: number;
  owner: boolean;
  visibility?: ProfileVisibility;
  sections: {
    favorites?: number[];
    collections?: Pick<Folder, "id" | "name" | "animeIds">[];
    ratings?: { animeId: number; score: number; title: string }[];
    statistics?: { titles: number; episodes: number; watchSeconds: number };
  };
};
export type ProfileChanges = Partial<Pick<UserProfile, "username" | "avatar" | "banner" | "about" | "presence">> & { visibility?: Partial<ProfileVisibility> };

export const PRESENCES: { value: Presence; label: string; description: string }[] = [
  { value: "online", label: "В сети", description: "Показывать, когда вы на сайте" },
  { value: "offline", label: "Не в сети", description: "Отображать статус «Не в сети»" },
  { value: "dnd", label: "Не беспокоить", description: "Вы здесь, но предпочитаете тишину" },
  { value: "invisible", label: "Невидимка", description: "Для других вы будете не в сети" },
];
export const SECTION_LABELS: Record<ProfileSection, string> = {
  about: "Обо мне", favorites: "Любимое аниме", collections: "Подборки", ratings: "Личный рейтинг", statistics: "Статистика",
};
