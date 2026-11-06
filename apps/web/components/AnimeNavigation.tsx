"use client";
import { usePathname } from "next/navigation";
import { DetailNavigation } from "./DetailNavigation";

// Description, details, cast, frames, trailer and comments share the "О тайтле" tabs under the player.
export function AnimeNavigation({ slug }: { slug: string; trailer?: boolean }) {
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
        { href: "#anime-episodes", label: "Серии" },
        { href: "#anime-information", label: "О тайтле" },
        { href: `${base}/franchise`, label: "Франшиза" },
        { href: `${base}/community`, label: "Обсуждения" },
      ]}
    />
  );
}
