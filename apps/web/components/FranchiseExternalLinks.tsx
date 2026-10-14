import Link from "next/link";
import type { AnimeFranchise } from "@animesoul/contracts";
import { relationLabels } from "../lib/franchise-graph";

export function FranchiseExternalLinks({
  links,
  label = "Другие франшизы",
}: {
  links: AnimeFranchise["externalLinks"];
  label?: string;
}) {
  const unique = new Map<string, AnimeFranchise["externalLinks"][number]>();
  for (const link of links) {
    if (!unique.has(link.anime.id) || link.relation !== "other") unique.set(link.anime.id, link);
  }
  if (!unique.size) return null;
  return (
    <nav className="franchise-external-links" aria-label={label}>
      <h3>Другие франшизы</h3>
      {[...unique.values()].map(({ anime, relation }) => (
        <Link
          key={anime.id}
          href={`/anime/${anime.slug}/franchise`}
          prefetch={false}
          aria-label={`Карта франшизы: ${anime.title}`}
        >
          {anime.poster ? (
            <img src={anime.poster} alt="" width={32} height={48} loading="lazy" />
          ) : (
            <span className="franchise-external-placeholder">{anime.title.slice(0, 1)}</span>
          )}
          <span>
            <strong>{anime.title}</strong>
            <small>{relationLabels[relation] ?? "Связанное аниме"} · Карта франшизы →</small>
          </span>
        </Link>
      ))}
    </nav>
  );
}
