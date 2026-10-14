"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  characterDetailsSchema,
  publicProfileSchema,
  type CharacterDetails,
  type PublicProfile,
} from "@animesoul/contracts";
import { characterAlternateNames, characterRoleLabels } from "../lib/characters";
import { formatLabels } from "../lib/catalog-filters";
import { searchWatchView } from "../lib/search-watch";
import {
  searchPreviewPlacement,
  type SearchOption,
  type SearchPreviewSnapshot,
} from "../lib/search-preview";
import { AnimeRatings } from "./AnimeRatings";
import { SearchAnimeProgress } from "./SearchAnimeProgress";
import { ProfileImage } from "./ProfileImage";
import { Icon } from "./Icon";

const actionLabels = {
  anime: "Открыть аниме",
  character: "Открыть страницу персонажа",
  person: "Открыть профиль",
  setting: "Открыть настройку",
  filter: "Добавить фильтр",
};

export function SearchPreview({
  snapshot,
  onChoose,
}: {
  snapshot: SearchPreviewSnapshot;
  onChoose: (option: SearchOption) => void;
}) {
  const { option } = snapshot;
  const surface = useRef<HTMLElement>(null);
  const [character, setCharacter] = useState<CharacterDetails | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState(false);
  const loading =
    (option.kind === "character" && !character) || (option.kind === "person" && !profile);

  useEffect(() => {
    if (!option.character && !option.person) return;
    const controller = new AbortController();
    const url = option.character
      ? "/api/characters/" + option.character.slug
      : "/api/profiles/" + encodeURIComponent(option.person!.username);
    void fetch(url, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Preview unavailable");
        const data: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (option.character) {
          const result = characterDetailsSchema.parse(data);
          if (result.id !== option.character.id) throw new Error("Unexpected character");
          setCharacter(result);
        } else {
          const result = publicProfileSchema.parse(data);
          if (result.id !== option.person!.id) throw new Error("Unexpected profile");
          setProfile(result);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [option.character, option.person]);

  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    const place = () => {
      const placement = searchPreviewPlacement(snapshot, element.offsetHeight);
      element.style.left = placement.left + "px";
      element.style.top = placement.top + "px";
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => observer.disconnect();
  }, [snapshot]);

  const anime = option.anime;
  const description = anime?.description ?? character?.description ?? profile?.about;
  const detail = anime
    ? [anime.originalTitle, anime.year, formatLabels[anime.format ?? "unknown"]]
        .filter(Boolean)
        .join(" · ")
    : option.character
      ? characterAlternateNames(option.character).join(" · ") || option.detail
      : option.kind === "person"
        ? profile?.badge || "Пользователь AnimeSoul"
        : option.detail;
  const watchDetail = anime ? searchWatchView(anime).watch?.detail : null;

  return (
    <aside
      ref={surface}
      id="global-search-preview"
      role="tooltip"
      aria-labelledby="search-preview-title"
      className={"search-preview search-preview-" + option.kind}
      style={searchPreviewPlacement(snapshot, 360)}
      onClick={() => onChoose(option)}
    >
      <div className="search-preview-header">
        <div className="search-preview-art">
          {option.kind === "person" ? (
            <ProfileImage
              value={option.poster ?? null}
              alt=""
              width={136}
              height={136}
              fallback={<Icon name="user" />}
            />
          ) : option.poster ? (
            <img src={option.poster} alt="" width={136} height={204} />
          ) : (
            <Icon
              name={
                option.kind === "setting"
                  ? "settings"
                  : option.kind === "character"
                    ? "user"
                    : "catalog"
              }
            />
          )}
        </div>
        <div className="search-preview-copy">
          <small className="search-preview-kind">{option.group}</small>
          <h2 id="search-preview-title">{option.label}</h2>
          <p className="search-preview-meta">{detail}</p>
          {anime && (
            <>
              <AnimeRatings anime={anime} compact />
              {!!anime.shikimoriVotes && (
                <p className="search-preview-meta">
                  {anime.shikimoriVotes.toLocaleString("ru-RU")} оценок на Shikimori
                </p>
              )}
              <SearchAnimeProgress anime={anime} />
              {watchDetail && <p className="search-preview-meta">{watchDetail}</p>}
              <p className="search-preview-meta">{anime.genres.slice(0, 4).join(" · ")}</p>
            </>
          )}
          {character && (
            <>
              <p className="search-preview-stat">
                Аниме с персонажем: <b>{character.appearances.length}</b>
              </p>
              {!!character.voiceActors.length && (
                <p className="search-preview-meta">
                  Сэйю:{" "}
                  {character.voiceActors
                    .slice(0, 2)
                    .map((actor) => actor.name)
                    .join(", ")}
                </p>
              )}
            </>
          )}
          {profile?.statistics && (
            <dl className="search-preview-stats">
              <div>
                <dt>Просмотрено аниме</dt>
                <dd>{profile.statistics.watched}</dd>
              </div>
              <div>
                <dt>Часов просмотра</dt>
                <dd>{Math.round(profile.statistics.minutes / 60)}</dd>
              </div>
            </dl>
          )}
          {profile?.ratings && (
            <p className="search-preview-meta">Оценок: {profile.ratings.length}</p>
          )}
        </div>
      </div>
      {loading && (
        <p className="search-preview-meta" role="status">
          {error
            ? "Подробности сейчас недоступны. Откройте страницу, чтобы попробовать снова."
            : "Загружаем подробности…"}
        </p>
      )}
      {!!description?.trim() && <p className="search-preview-description">{description}</p>}
      {character && !!character.appearances.length && (
        <ul className="search-preview-appearances">
          {character.appearances.slice(0, 2).map(({ anime: appearance, role }) => (
            <li key={appearance.id}>
              <span>{appearance.title}</span>
              <small>{characterRoleLabels[role]}</small>
            </li>
          ))}
        </ul>
      )}
      {option.kind === "filter" && (
        <code className="search-preview-query">{option.completion}</code>
      )}
      <p className="search-preview-action">
        {actionLabels[option.kind]} <span>· нажмите карточку</span>
        <span aria-hidden="true"> ↗</span>
      </p>
    </aside>
  );
}
