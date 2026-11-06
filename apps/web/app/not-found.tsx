import Link from "next/link";
export default function NotFound() {
  return (
    <div className="content empty-state not-found">
      <p className="eyebrow">404</p>
      <h1>Этой страницы нет</h1>
      <p>Возможно, ссылка устарела. Попробуйте найти аниме по названию.</p>
      <form className="not-found-search" action="/search" role="search">
        <input type="search" name="q" placeholder="Название аниме, персонаж или человек" required />
        <button className="primary" type="submit">
          Найти
        </button>
      </form>
      <p className="not-found-links">
        <Link className="text-link" href="/catalog">
          Каталог
        </Link>
        <Link className="text-link" href="/search/frame">
          Поиск по кадру
        </Link>
        <Link className="text-link" href="/">
          На главную
        </Link>
      </p>
    </div>
  );
}
