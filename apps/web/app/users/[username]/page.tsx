import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalog, getProfile } from "../../../lib/api";
import { safeJsonLd, siteConfiguration } from "../../../lib/site";
import { ProfileHeader } from "../../../components/ProfileHeader";
import { AnimeCard } from "../../../components/AnimeCard";
import { Icon } from "../../../components/Icon";

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
    <div className="user-profile-page">
      <div className="profile-main">
        <ProfileHeader profile={profile} />
        <div className="profile-subnav">
          <nav aria-label="Разделы профиля">
            {profile.favoriteIds && <Link href="#profile-favorites">Любимое аниме</Link>}
            {profile.folders && <Link href="#profile-collections">Подборки</Link>}
            {profile.ratings && <Link href="#profile-ratings">Личный рейтинг</Link>}
            {profile.statistics && <Link href="#profile-statistics">Статистика</Link>}
          </nav>
        </div>
        {profile.favoriteIds && (
          <section className="profile-section" id="profile-favorites">
            <div className="profile-section-heading">
              <h2>
                Любимое аниме <span>{profile.favoriteIds.length}</span>
              </h2>
            </div>
            <div className="profile-anime-grid">
              {catalog.items
                .filter((anime) => profile.favoriteIds?.includes(anime.id))
                .map((anime) => (
                  <AnimeCard key={anime.id} anime={anime} compact />
                ))}
            </div>
            {!profile.favoriteIds.length && (
              <p className="profile-empty">Здесь пока нет любимых аниме.</p>
            )}
          </section>
        )}
        {profile.folders && (
          <section className="profile-section" id="profile-collections">
            <div className="profile-section-heading">
              <h2>
                Личные подборки <span>{profile.folders.length}</span>
              </h2>
            </div>
            <div className="profile-collections">
              {profile.folders.map((folder) => (
                <div className="profile-collection" key={folder.name}>
                  <span className="profile-collection-art">
                    <Icon name="folder" />
                  </span>
                  <span className="profile-collection-info">
                    <strong>{folder.name}</strong>
                    <span>{folder.animeIds.length} аниме</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="profile-bottom-grid">
          {profile.ratings && (
            <section className="profile-section" id="profile-ratings">
              <div className="profile-section-heading">
                <h2>Личный рейтинг</h2>
              </div>
              <div className="profile-rating-list">
                {profile.ratings.map((rating, index) => {
                  const anime = catalog.items.find((item) => item.id === rating.animeId);
                  return (
                    <div className="profile-rating-row" key={rating.animeId}>
                      <span className="profile-rating-position">{index + 1}</span>
                      <span className="profile-rating-info">
                        {anime ? (
                          <Link href={`/anime/${anime.slug}`}>{anime.title}</Link>
                        ) : (
                          <strong>Аниме</strong>
                        )}
                      </span>
                      <span className="profile-rating-score">★ {rating.score} / 10</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {profile.statistics && (
            <section className="profile-section" id="profile-statistics">
              <div className="profile-section-heading">
                <h2>Статистика</h2>
              </div>
              <p className="profile-stat-intro">Время, проведённое в любимых историях.</p>
              <dl className="profile-stats">
                <div>
                  <dd>{profile.statistics.watched}</dd>
                  <dt>Аниме просмотрено</dt>
                </div>
                <div>
                  <dd>
                    {Math.round(profile.statistics.minutes / 60)} <small>ч.</small>
                  </dd>
                  <dt>Время просмотра</dt>
                </div>
              </dl>
            </section>
          )}
        </div>
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
    </div>
  );
}
