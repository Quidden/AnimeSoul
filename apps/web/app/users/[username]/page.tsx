import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCatalog, getProfile } from "../../../lib/api";
import { safeJsonLd, siteConfiguration } from "../../../lib/site";
import { ProfileHeader } from "../../../components/ProfileHeader";
import { AnimeCard } from "../../../components/AnimeCard";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ username: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const profile = await getProfile(username);
  if (!profile) return { title: "Профиль не найден", robots: { index: false, follow: false } };
  return {
    title: `${profile.username} — профиль`,
    description: profile.about ?? `Публичный профиль ${profile.username} в AnimeSoul.`,
    robots: {
      index: siteConfiguration().indexable && profile.indexable,
      follow: siteConfiguration().indexable && profile.indexable,
    },
    alternates: { canonical: `/users/${encodeURIComponent(profile.username)}` },
  };
}
export default async function ProfilePage({ params }: Props) {
  const { username } = await params;
  const profile = await getProfile(username);
  if (!profile) notFound();
  const catalog = await getCatalog();
  return (
    <>
      <ProfileHeader profile={profile} />
      <div className="content profile-content">
        {process.env.DEMO_CATALOG === "true" && (
          <p className="preview-note">
            Пример публичного профиля · папки и оценки скрыты владельцем
          </p>
        )}
        {profile.favoriteIds && (
          <section>
            <div className="section-heading">
              <h2>Любимое аниме</h2>
              <span>{profile.favoriteIds.length} истории</span>
            </div>
            <div className="anime-grid">
              {catalog.items
                .filter((a) => profile.favoriteIds?.includes(a.id))
                .map((anime, i) => (
                  <AnimeCard key={anime.id} anime={anime} index={i} />
                ))}
            </div>
          </section>
        )}
        {profile.folders && (
          <section>
            <h2>Подборки</h2>
            <div className="folder-list">
              {profile.folders.map((folder) => (
                <div key={folder.name}>
                  <h3>{folder.name}</h3>
                  <p>{folder.animeIds.length} аниме</p>
                </div>
              ))}
            </div>
          </section>
        )}
        {profile.ratings && (
          <section>
            <h2>Личные оценки</h2>
            <ul className="ratings-list">
              {profile.ratings.map((rating) => (
                <li key={rating.animeId}>
                  <span>
                    {catalog.items.find((a) => a.id === rating.animeId)?.title ?? "Аниме"}
                  </span>
                  <strong>{rating.score} / 10</strong>
                </li>
              ))}
            </ul>
          </section>
        )}
        {profile.statistics && (
          <section>
            <h2>В историях и цифрах</h2>
            <dl className="statistics">
              <div>
                <dd>{profile.statistics.watched}</dd>
                <dt>Аниме просмотрено</dt>
              </div>
              <div>
                <dd>{Math.round(profile.statistics.minutes / 60)}</dd>
                <dt>Часов в других мирах</dt>
              </div>
            </dl>
          </section>
        )}
        {profile.indexable && siteConfiguration().indexable && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: safeJsonLd({
                "@context": "https://schema.org",
                "@type": "ProfilePage",
                mainEntity: {
                  "@type": "Person",
                  name: profile.username,
                  ...(profile.about ? { description: profile.about } : {}),
                },
              }),
            }}
          />
        )}
      </div>
    </>
  );
}
