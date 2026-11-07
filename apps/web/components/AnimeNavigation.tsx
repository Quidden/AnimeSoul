"use client";
import { usePathname } from "next/navigation";
import { DetailNavigation } from "./DetailNavigation";

// "О тайтле" is the title block with the frames and characters tabs; all of it is above the player.
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
        { href: "#anime-about", label: "О тайтле" },
        { href: "#anime-watch", label: "Смотреть" },
        { href: "#anime-episodes", label: "Серии" },
        { href: `${base}/franchise`, label: "Франшиза" },
        { href: `${base}/community`, label: "Обсуждения" },
      ]}
    />
  );
}
