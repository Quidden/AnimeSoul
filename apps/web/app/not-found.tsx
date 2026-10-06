import Link from "next/link";
export default function NotFound() {
  return (
    <div className="content empty-state">
      <p className="eyebrow">404</p>
      <h1>Этой страницы нет</h1>
      <Link className="button" href="/catalog">
        Вернуться в каталог
      </Link>
    </div>
  );
}
