import type { CharacterRole, CharacterSummary } from "@animesoul/contracts";

export const characterRoleLabels: Record<CharacterRole, string> = {
  main: "Главная роль",
  supporting: "Второстепенная роль",
  background: "Эпизодическая роль",
};

export function characterAlternateNames(character: CharacterSummary): string[] {
  return [
    ...new Set([character.originalName, character.japaneseName, ...character.aliases]),
  ].filter((name): name is string => Boolean(name?.trim()) && name !== character.name);
}
