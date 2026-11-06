import type { Metadata } from "next";
import type { Anime, Episode } from "@animesoul/contracts";
import { episodeHref } from "@animesoul/contracts";
import { siteConfiguration } from "./site";
export function animeDescription(anime: Anime) {
  const text = anime.description
    .replace(/<[^>]*>/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = `${anime.title}${anime.year > 0 ? ` (${anime.year})` : ""}. ${anime.genres.join(", ")}. Серии, сезоны, трейлер и обсуждения на AnimeSoul.`;
  const description = text || fallback;
  return description.length > 165
    ? description.slice(0, 162).replace(/\s\S*$/, "") + "…"
    : description;
}
export function animeMetadata(anime: Anime, episode?: Episode): Metadata {
  const site = siteConfiguration();
  const path = episode ? episodeHref(anime.slug, episode.id) : `/anime/${anime.slug}`;
  const title = `${anime.title}${anime.year > 0 ? ` (${anime.year})` : ""} — смотреть онлайн`;
  const description = episode
    ? `Серия ${episode.number} аниме «${anime.title}» на AnimeSoul. ${animeDescription(anime)}`.slice(
        0,
        165,
      )
    : animeDescription(anime);
  const images = anime.poster ? [{ url: anime.poster, alt: `Постер: ${anime.title}` }] : [];
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: {
      index: site.indexable && anime.indexable,
      follow: site.indexable,
      googleBot: {
        index: site.indexable && anime.indexable,
        follow: site.indexable,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    openGraph: {
      title,
      description,
      type: anime.format === "movie" ? "video.movie" : "video.tv_show",
      url: path,
      siteName: "AnimeSoul",
      locale: "ru_RU",
      images,
    },
    twitter: { card: "summary_large_image", title, description, images },
  };
}
export function animeStructuredData(anime: Anime, episode?: Episode) {
  const base = siteConfiguration().url;
  const url = new URL(`/anime/${anime.slug}`, base).href;
  const id = url + "#anime";
  const premiere = anime.details?.airedAt;
  const aired =
    premiere && Number.isFinite(Date.parse(premiere))
      ? new Date(premiere).toISOString().slice(0, 10)
      : undefined;
  const work = {
    "@type": anime.format === "movie" ? "Movie" : "TVSeries",
    "@id": id,
    name: anime.title,
    alternateName: [...new Set([anime.originalTitle, ...anime.aliases].filter(Boolean))],
    description: anime.description || animeDescription(anime),
    url,
    inLanguage: "ja",
    genre: anime.genres,
    ...(anime.poster ? { image: anime.poster } : {}),
    ...(aired ? { datePublished: aired } : {}),
    ...(anime.format !== "movie" && anime.details?.episodesTotal
      ? { numberOfEpisodes: anime.details.episodesTotal }
      : {}),
    ...(anime.details?.studios?.length
      ? {
          productionCompany: anime.details.studios.map((name) => ({
            "@type": "Organization",
            name,
          })),
        }
      : {}),
    ...(anime.communityScore != null && anime.communityVotes
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: anime.communityScore,
            ratingCount: anime.communityVotes,
            bestRating: 10,
            worstRating: 0,
          },
        }
      : {}),
  };
  const crumbs = [
    { "@type": "ListItem", position: 1, name: "Каталог", item: new URL("/catalog", base).href },
    { "@type": "ListItem", position: 2, name: anime.title, item: url },
  ];
  const episodeUrl = episode ? new URL(episodeHref(anime.slug, episode.id), base).href : undefined;
  return {
    "@context": "https://schema.org",
    "@graph": [
      work,
      { "@type": "BreadcrumbList", itemListElement: crumbs },
      ...(episode
        ? [
            {
              "@type": "TVEpisode",
              "@id": episodeUrl + "#episode",
              name: `${anime.title} — серия ${episode.number}`,
              episodeNumber: episode.number,
              partOfSeries: { "@id": id },
              url: episodeUrl,
              ...(anime.poster ? { image: anime.poster } : {}),
            },
          ]
        : []),
    ],
  };
}
