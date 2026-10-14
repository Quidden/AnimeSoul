import Link from "next/link";
import type {
  Anime,
  CharacterDetails,
  CharacterRole,
  FranchiseCharacter,
} from "@animesoul/contracts";
import { characterAlternateNames, characterRoleLabels } from "../lib/characters";

export function FranchiseCharacterPanel({
  entry,
  detail,
  loading,
  failed,
  parts,
  onClose,
  onRetry,
  onSelectPart,
}: {
  entry: FranchiseCharacter;
  detail: CharacterDetails | undefined;
  loading: boolean;
  failed: boolean;
  parts: { anime: Anime; role: CharacterRole }[];
  onClose: () => void;
  onRetry: () => void;
  onSelectPart: (id: string) => void;
}) {
  const character = detail ?? entry.character;
  const names = characterAlternateNames(character);
  return (
    <div className="franchise-character-profile">
      <div className="franchise-panel-heading">
        <span>Персонаж · {parts.length} частей</span>
        <button className="outline" aria-label="Закрыть сведения о персонаже" onClick={onClose}>
          ×
        </button>
      </div>
      {character.image && (
        <img
          className="franchise-character-portrait"
          src={character.image}
          alt=""
          width={88}
          height={126}
        />
      )}
      <h1>{character.name}</h1>
      {!!names.length && <p className="franchise-character-aliases">{names.join(" · ")}</p>}
      <Link className="primary" href={`/characters/${character.slug}`}>
        Открыть страницу персонажа →
      </Link>
      <section
        className="franchise-character-biography"
        aria-busy={loading}
        aria-label="Описание персонажа"
      >
        <h2>Описание</h2>
        {loading ? (
          <p role="status">Загружаем описание персонажа…</p>
        ) : failed ? (
          <div className="franchise-cast-error" role="status">
            <p>Не удалось загрузить описание.</p>
            <button className="outline" onClick={onRetry}>
              Повторить
            </button>
          </div>
        ) : (
          <p>{detail?.description || "Описание персонажа пока не добавлено."}</p>
        )}
      </section>
      <section className="franchise-node-relations" aria-label="Связанные части персонажа">
        <h2>Аниме с персонажем · {parts.length}</h2>
        {parts.map(({ anime, role }) => (
          <button key={anime.id} onClick={() => onSelectPart(anime.id)}>
            <span>
              {characterRoleLabels[role]} · {anime.year || "—"}
            </span>
            {anime.title}
          </button>
        ))}
      </section>
    </div>
  );
}
