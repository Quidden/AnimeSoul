import Link from "next/link";
import type { CharacterRole, CharacterSummary } from "@animesoul/contracts";
import { characterRoleLabels } from "../lib/characters";
import { Icon } from "./Icon";

export function CharacterCard({
  character,
  role,
}: {
  character: CharacterSummary;
  role?: CharacterRole;
}) {
  return (
    <Link className="character-card" href={`/characters/${character.slug}`}>
      <span className="character-card-image">
        {character.image ? (
          <img src={character.image} alt="" width="160" height="220" loading="lazy" />
        ) : (
          <Icon name="user" />
        )}
      </span>
      <strong>{character.name}</strong>
      {role ? (
        <span className="character-role" data-role={role}>
          {characterRoleLabels[role]}
        </span>
      ) : character.originalName && character.originalName !== character.name ? (
        <span>{character.originalName}</span>
      ) : (
        <span>Персонаж</span>
      )}
    </Link>
  );
}
