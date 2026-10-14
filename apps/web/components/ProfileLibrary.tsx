import Link from "next/link";
import type { PublicProfile } from "@animesoul/contracts";
import { getCatalogByIds } from "../lib/api";
import { Icon } from "./Icon";
import { ProfileFavorites } from "./ProfileFavorites";
import { ProfileRetry } from "./ProfileRetry";
import { ProfileRatings } from "./ProfileRatings";

export async function ProfileLibrary({ profile }: { profile: PublicProfile }) {
  const ids = [
    ...(profile.favoriteIds ?? []),
    ...(profile.ratings ?? []).map((rating) => rating.animeId),
    ...(profile.folders ?? []).flatMap((folder) => folder.animeIds.slice(0, 20)),
  ];
  const catalog = await getCatalogByIds(ids).catch(() => null);
  const animeById = new Map((catalog?.items ?? []).map((anime) => [anime.id, anime]));
  const favorites = (profile.favoriteIds ?? []).flatMap((id) => {
    const anime = animeById.get(id);
    return anime ? [anime] : [];
  });
  const ratings = [...(profile.ratings ?? [])].sort(
    (a, b) => b.score - a.score || a.animeId.localeCompare(b.animeId),
  );
  return (
    <>
      {!catalog && (
        <div className="profile-section-notice" role="status">
          <p>Не удалось загрузить названия и постеры аниме. Остальные разделы профиля доступны.</p>
          <ProfileRetry />
        </div>
      )}
      {profile.favoriteIds && (
        <section className="profile-section" id="profile-favorites">
          <div className="profile-section-heading">
            <h2>
              Любимое аниме <span>{profile.favoriteIds.length}</span>
            </h2>
          </div>
          {!!favorites.length && <ProfileFavorites key={profile.id} items={favorites} />}
          {!profile.favoriteIds.length && (
            <p className="profile-empty">
              Любимых аниме пока нет. Их можно добавить со страницы аниме в каталоге.
            </p>
          )}
          {!!profile.favoriteIds.length && !favorites.length && catalog && (
            <p className="profile-empty">Добавленные аниме пока недоступны в каталоге.</p>
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
              <details className="profile-collection-details" key={folder.name}>
                <summary className="profile-collection">
                  <span className="profile-collection-art">
                    <Icon name="folder" />
                  </span>
                  <span className="profile-collection-info">
                    <strong>{folder.name}</strong>
                    <span>{folder.animeIds.length} аниме</span>
                  </span>
                </summary>
                {!folder.animeIds.length ? (
                  <p className="profile-empty">Подборка пока пуста.</p>
                ) : (
                  <ul className="profile-collection-list">
                    {folder.animeIds.slice(0, 20).map((id) => {
                      const anime = animeById.get(id);
                      return (
                        <li key={id}>
                          {anime ? (
                            <Link href={`/anime/${anime.slug}`}>{anime.title}</Link>
                          ) : (
                            <span>Аниме недоступно</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {folder.animeIds.length > 20 && (
                  <p className="profile-media-help">
                    Показаны первые 20 из {folder.animeIds.length} аниме.
                  </p>
                )}
              </details>
            ))}
          </div>
          {!profile.folders.length && (
            <p className="profile-empty">
              Личных подборок пока нет. Их можно создать в своей библиотеке.
            </p>
          )}
        </section>
      )}
      {(profile.ratings || profile.statistics) && (
        <div className="profile-bottom-grid">
          {profile.ratings && (
            <section className="profile-section" id="profile-ratings">
              <div className="profile-section-heading">
                <h2>
                  Личный рейтинг <span>{ratings.length}</span>
                </h2>
              </div>
              <ProfileRatings key={profile.id} ratings={ratings} items={catalog?.items ?? []} />
              {!ratings.length && (
                <p className="profile-empty">
                  Оценок пока нет. Их можно поставить на странице аниме.
                </p>
              )}
            </section>
          )}
          {profile.statistics && (
            <section className="profile-section" id="profile-statistics">
              <div className="profile-section-heading">
                <h2>Статистика</h2>
              </div>
              <p className="profile-stat-intro">Просмотренные аниме и время просмотра.</p>
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
      )}
    </>
  );
}
