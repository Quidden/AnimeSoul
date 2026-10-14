import type { AnimeCharacter } from "@animesoul/contracts";
import { CharacterCard } from "./CharacterCard";
import { CardRail } from "./CardRail";

export function AnimeCharacters({ characters }: { characters: AnimeCharacter[] }) {
  return (
    <section
      className="anime-characters"
      id="anime-characters"
      aria-labelledby="anime-characters-title"
    >
      <h2 id="anime-characters-title">
        Персонажи {!!characters.length && <span>{characters.length}</span>}
      </h2>
      <p>
        {characters.length
          ? "Герои и их роли в этом аниме"
          : "Информация о персонажах пока не добавлена."}
      </p>
      {!!characters.length && (
        <CardRail label="Персонажи" imageSelector=".character-card-image">
          {characters.map((character) => (
            <CharacterCard key={character.id} character={character} role={character.role} />
          ))}
        </CardRail>
      )}
    </section>
  );
}
