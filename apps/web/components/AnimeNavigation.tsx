"use client";
import { usePathname } from "next/navigation";
import { DetailNavigation } from "./DetailNavigation";

export function AnimeNavigation({ slug, trailer }: { slug: string; trailer: boolean }) {
  const pathname = usePathname();
  const base = `/anime/${slug}`;
  return (
    <DetailNavigation
      base={base}
      label="Разделы аниме"
      board={pathname === `${base}/franchise`}
      attached={pathname === `${base}/community`}
      sections={[
        { href: "#anime-watch", label: "Смотреть" },
        { href: "#anime-episodes", label: "Сезоны и серии" },
        { href: "#anime-description", label: "Описание" },
        { href: "#anime-characters", label: "Персонажи" },
        ...(trailer ? [{ href: "#anime-trailer", label: "Трейлер" }] : []),
        { href: `${base}/franchise`, label: "Франшиза" },
        { href: `${base}/community`, label: "Обсуждения" },
        { href: "#anime-comments", label: "Комментарии" },
      ]}
    />
  );
}
