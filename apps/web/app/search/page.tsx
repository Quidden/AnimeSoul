import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  globalSearchQuerySchema,
  parseGlobalSearch,
  normalizeSearchText,
  scoreSearchText,
} from "@animesoul/contracts";
import { getCharacterSearch, getGlobalSearch } from "../../lib/api";
import { findSearchSettings } from "../../lib/search-settings";
import { AnimeCard } from "../../components/AnimeCard";
import { CharacterCard } from "../../components/CharacterCard";
import { Icon } from "../../components/Icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Поиск",
  alternates: { canonical: "/search" },
  robots: { index: false, follow: false },
};
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const input = globalSearchQuerySchema.safeParse({ q: search.q ?? "" });
  if (!input.success) notFound();
  const query = input.data.q;
  const parsed = parseGlobalSearch(query);
  const settings = !Object.keys(parsed.filters).length ? findSearchSettings(parsed.text) : [];
  const result = await getGlobalSearch(query).catch(() => null);
  if (
    result &&
    !result.characters.length &&
    result.anime.length &&
    parsed.text.trim().length >= 2 &&
    !parsed.text.startsWith("@") &&
    !parsed.issues.length &&
    !Object.keys(parsed.filters).length &&
    !settings.length
  )
    result.characters = (await getCharacterSearch(parsed.text).catch(() => ({ items: [] }))).items;
  if (parsed.filters.genre && result) {
    const genre = parsed.filters.genre;
    const matched =
      result.genres.find((item) => normalizeSearchText(item.name) === normalizeSearchText(genre)) ??
      result.genres
        .map((item) => ({ ...item, score: scoreSearchText(genre, item.name) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || b.count - a.count)[0];
    if (matched) parsed.filters.genre = matched.name;
  }
  const filters = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.filters))
    if (value !== undefined) filters.set(key, String(value));
  return (
    <div className="search-results-page">
      <p className="eyebrow">ПОИСК ПО ANIMESOUL</p>
      <h1>{query ? `Результаты: ${query}` : "Популярно сейчас"}</h1>
      <p className="account-help">
        Аниме, персонажи, люди и настройки. Поиск в шапке доступен на любой странице.
      </p>
      <Link className="outline frame-search-entry" href="/search/frame">
        <Icon name="image" /> Поиск аниме по кадру
      </Link>
      {parsed.issues.map((issue) => (
        <p className="search-notice" role="alert" key={issue}>
          {issue}
        </p>
      ))}
      {!result && (
        <p className="search-notice" role="alert">
          Поиск временно недоступен. Попробуйте ещё раз.
        </p>
      )}
      {result?.correction && (
        <p className="search-correction">Найдены похожие названия: {result.correction}</p>
      )}
      {!!result?.anime.length && (
        <section aria-label={query ? "Аниме" : "Популярные аниме"}>
          <h2>{query ? "Аниме · лучшие совпадения" : "Топ 3 · смотрят на AnimeSoul"}</h2>
          <div className="cards">
            {result.anime.map((anime) => (
              <AnimeCard key={anime.id} anime={anime} searchProgress={anime} />
            ))}
          </div>
        </section>
      )}
      {!!result?.characters.length && (
        <section aria-label="Персонажи">
          <h2>Персонажи</h2>
          <div className="character-grid search-page-characters">
            {result.characters.map((character) => (
              <CharacterCard key={character.id} character={character} />
            ))}
          </div>
        </section>
      )}
      {!!result?.people.length && (
        <section aria-label="Люди">
          <h2>Люди</h2>
          <div className="search-page-people">
            {result.people.map((person) => (
              <Link key={person.id} href={"/users/" + encodeURIComponent(person.username)}>
                {person.avatar ? (
                  <img src={person.avatar} alt="" width={42} height={42} />
                ) : (
                  <Icon name="user" />
                )}
                <span>
                  <strong>{person.username}</strong>
                  <small>ID: {person.id}</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {!!settings.length && (
        <section aria-label="Настройки">
          <h2>Настройки</h2>
          <div className="search-page-settings">
            {settings.map((setting) => (
              <Link key={setting.id} href={setting.href}>
                <Icon name="menu" />
                <span>
                  <strong>{setting.label}</strong>
                  <small>{setting.description}</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {result &&
        !result.anime.length &&
        !result.characters.length &&
        !result.people.length &&
        !settings.length && (
          <p className="empty-state">
            Ничего не найдено. Попробуйте другое название или уберите один из фильтров.
          </p>
        )}
      {!!filters.size && !parsed.text && !parsed.issues.length && (
        <section>
          <Link className="outline" href={"/catalog/all?" + filters}>
            Открыть весь каталог с этими фильтрами →
          </Link>
        </section>
      )}
    </div>
  );
}
