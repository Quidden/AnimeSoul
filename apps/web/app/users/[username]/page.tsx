import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProfile } from "../../../lib/api";
import { safeJsonLd, siteConfiguration } from "../../../lib/site";
import { ProfileHeader } from "../../../components/ProfileHeader";
import {
  getViewerProfile,
  hasProfileSession,
  profileRouteUsername,
} from "../../../lib/profile-viewer";
import { ProfileFriends } from "../../../components/ProfileFriends";
import { PostsPanel, CommentsPanel } from "../../../components/ContentPanels";
import { ProfileLibrary } from "../../../components/ProfileLibrary";
import { ProfileLibraryLoading } from "../../../components/ProfileLibraryLoading";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ username: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const username = profileRouteUsername((await params).username);
  if (!username) return { title: "Профиль не найден", robots: { index: false, follow: false } };
  const personalized = await hasProfileSession();
  const profile = await (personalized ? getViewerProfile(username) : getProfile(username));
  if (!profile) return { title: "Профиль не найден", robots: { index: false, follow: false } };
  return {
    title: `${profile.username} — профиль`,
    description: personalized
      ? "Профиль AnimeSoul"
      : profile.about || `Публичный профиль ${profile.username} в AnimeSoul.`,
    robots: {
      index: !personalized && siteConfiguration().indexable && profile.indexable,
      follow: !personalized && siteConfiguration().indexable && profile.indexable,
    },
    ...(!personalized
      ? { alternates: { canonical: `/users/${encodeURIComponent(profile.username)}` } }
      : {}),
  };
}
export default async function ProfilePage({ params }: Props) {
  const username = profileRouteUsername((await params).username);
  if (!username) notFound();
  const profile = await getViewerProfile(username);
  if (!profile) notFound();
  // Structured data uses only the anonymous projection; private fields never enter it.
  const publicView = (await hasProfileSession()) ? null : profile;
  return (
    <div className="user-profile-page">
      <div className="profile-main">
        <ProfileHeader key={profile.id} profile={profile} />
        <div className="profile-subnav">
          <nav aria-label="Разделы профиля">
            {profile.favoriteIds && <Link href="#profile-favorites">Любимое аниме</Link>}
            {profile.folders && <Link href="#profile-collections">Подборки</Link>}
            {profile.ratings && <Link href="#profile-ratings">Личный рейтинг</Link>}
            {profile.statistics && <Link href="#profile-statistics">Статистика</Link>}
            {profile.friends && <Link href="#profile-friends">Друзья</Link>}
            {profile.contentSections?.includes("posts") && <Link href="#profile-posts">Посты</Link>}
            {profile.contentSections?.includes("reviews") && (
              <Link href="#profile-reviews">Рецензии</Link>
            )}
            {profile.contentSections?.includes("comments") && (
              <Link href="#profile-comments">Комментарии</Link>
            )}
          </nav>
        </div>
        <Suspense fallback={<ProfileLibraryLoading />}>
          <ProfileLibrary profile={profile} />
        </Suspense>
        {profile.friends && (
          <ProfileFriends
            key={JSON.stringify([profile.id, profile.friends, profile.friendsNext])}
            username={profile.username}
            initial={profile.friends}
            next={profile.friendsNext ?? null}
          />
        )}
        {profile.contentSections?.includes("posts") && <PostsPanel authorId={profile.id} />}
        {profile.contentSections?.includes("reviews") && (
          <PostsPanel authorId={profile.id} section="reviews" />
        )}
        {profile.contentSections?.includes("comments") && (
          <CommentsPanel target={{ authorId: profile.id }} title="Комментарии пользователя" />
        )}
        {publicView?.indexable && siteConfiguration().indexable && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: safeJsonLd({
                "@context": "https://schema.org",
                "@type": "ProfilePage",
                mainEntity: {
                  "@type": "Person",
                  name: publicView.username,
                  ...(publicView.about ? { description: publicView.about } : {}),
                },
              }),
            }}
          />
        )}
      </div>
    </div>
  );
}
