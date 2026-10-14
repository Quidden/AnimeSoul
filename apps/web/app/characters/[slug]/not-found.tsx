import Link from "next/link";

export default function CharacterNotFound() {
  return (
    <div className="content empty-state">
      <h1>Персонаж не найден</h1>
      <p>Попробуйте найти персонажа по другому имени в поиске.</p>
      <Link className="outline" href="/search">
        Открыть поиск
      </Link>
    </div>
  );
}
