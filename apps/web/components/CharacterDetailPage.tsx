import Link from "next/link";
import type { CharacterDetails } from "@animesoul/contracts";
import { characterAlternateNames, characterRoleLabels } from "../lib/characters";
import { formatLabels } from "../lib/catalog-filters";
import { descriptionGroups } from "../lib/description-text";
import { Icon } from "./Icon";
import { CardRail } from "./CardRail";
import { DetailNavigation } from "./DetailNavigation";

type DescriptionGroup = ReturnType<typeof descriptionGroups>[number];
function descriptionBlocks(groups: DescriptionGroup[], offset = 0) {
  return groups.map((group, position) => {
    const index = offset + position;
    return group.kind === "heading" ? (
      <h3 key={index}>{group.text}</h3>
    ) : group.kind === "list" ? (
      <ul key={index}>
        {group.items.map((item, itemIndex) => (
          <li key={itemIndex}>{item}</li>
        ))}
      </ul>
    ) : (
      <p key={index}>{group.text}</p>
    );
  });
}

export function CharacterDetailPage({ character }: { character: CharacterDetails }) {
  const names = characterAlternateNames(character);
  const groups = descriptionGroups(character.description);
  // The first heading after the opening paragraphs starts the folded part of a long description.
  const firstHeading = groups.findIndex((group, index) => index > 0 && group.kind === "heading");
  const fold =
    firstHeading > 0 && groups.map((group) => JSON.stringify(group)).join("").length > 900
      ? firstHeading
      : groups.length;
  return (
    <div className="character-page-layout">
      <DetailNavigation
        base={`/characters/${character.slug}`}
        label="Разделы персонажа"
        sections={[
          { href: "#character-overview", label: "Персонаж" },
          { href: "#character-description", label: "Описание" },
          ...(character.voiceActors.length
            ? [{ href: "#character-voice-actors", label: "Сэйю" }]
            : []),
          { href: "#character-appearances", label: "Аниме с персонажем" },
        ]}
      />
      <article className="watch-shell character-detail-page">
        <nav className="anime-breadcrumb" aria-label="Навигационная цепочка">
          <Link href="/catalog">Каталог</Link>
          <span>/</span>
          <span>Персонажи</span>
          <span>/</span>
          <span>{character.name}</span>
        </nav>
        <div className="character-hero" id="character-overview">
          <aside className="character-portrait-rail">
            <div className="character-portrait">
              {character.image ? (
                <img src={character.image} alt={character.name} width="260" height="360" />
              ) : (
                <Icon name="user" />
              )}
            </div>
            {character.sourceUrl && (
              <a className="outline" href={character.sourceUrl} target="_blank" rel="noreferrer">
                На Shikimori ↗
              </a>
            )}
          </aside>
          <div className="character-hero-copy">
            <p className="character-type">Персонаж</p>
            <h1>{character.name}</h1>
            {names.length > 0 && <p className="character-alternate-names">{names.join(" · ")}</p>}
            <section
              className="character-description"
              id="character-description"
              aria-labelledby="character-description-title"
            >
              <h2 id="character-description-title">Описание</h2>
              {groups.length ? (
                <>
                  {descriptionBlocks(groups.slice(0, fold))}
                  {fold < groups.length && (
                    <details className="character-description-more">
                      <summary>Показать полностью</summary>
                      {descriptionBlocks(groups.slice(fold), fold)}
                    </details>
                  )}
                </>
              ) : (
                <p>Описание персонажа пока не добавлено.</p>
              )}
            </section>
            {!!character.voiceActors.length && (
              <section
                className="character-voice-actors"
                id="character-voice-actors"
                aria-labelledby="character-voice-title"
              >
                <h2 id="character-voice-title">Сэйю</h2>
                <ul>
                  {character.voiceActors.map((actor) => {
                    const content = (
                      <>
                        <span className="character-voice-image">
                          {actor.image ? (
                            <img src={actor.image} alt="" width="48" height="48" loading="lazy" />
                          ) : (
                            <Icon name="user" />
                          )}
                        </span>
                        <span>{actor.name}</span>
                      </>
                    );
                    return (
                      <li key={actor.id}>
                        {actor.sourceUrl ? (
                          <a href={actor.sourceUrl} target="_blank" rel="noreferrer">
                            {content}
                          </a>
                        ) : (
                          <span className="character-voice-person">{content}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        </div>
        <section
          className="character-appearances"
          id="character-appearances"
          aria-labelledby="character-appearances-title"
        >
          <h2 id="character-appearances-title">
            Аниме с персонажем <span>{character.appearances.length}</span>
          </h2>
          {character.appearances.length ? (
            <CardRail label="Аниме с персонажем" imageSelector=".character-appearance-poster">
              {character.appearances.map(({ anime, role }) => (
                <article key={anime.id} className="character-appearance">
                  <Link
                    className="character-appearance-poster"
                    href={`/anime/${anime.slug}`}
                    aria-label={anime.title}
                  >
                    {anime.poster ? (
                      <img src={anime.poster} alt="" width="184" height="276" loading="lazy" />
                    ) : (
                      <Icon name="image" />
                    )}
                  </Link>
                  <div>
                    <h3>
                      <Link href={`/anime/${anime.slug}`}>{anime.title}</Link>
                    </h3>
                    <p>
                      {[anime.year || null, formatLabels[anime.format ?? "unknown"]]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <span className="character-role" data-role={role}>
                      {characterRoleLabels[role]}
                    </span>
                    <Link className="text-link" href={`/anime/${anime.slug}/franchise`}>
                      Карта франшизы →
                    </Link>
                  </div>
                </article>
              ))}
            </CardRail>
          ) : (
            <p className="empty-state">Связанные аниме ещё не добавлены в каталог.</p>
          )}
        </section>
      </article>
    </div>
  );
}
