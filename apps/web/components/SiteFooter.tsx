import Link from "next/link";

export function SiteFooter({ preview }: { preview: boolean }) {
  return (
    <footer className="site-footer">
      <nav className="footer-sitemap" aria-label="Карта сайта">
        <div className="footer-sitemap-group">
          <h2>Основное</h2>
          <Link href="/">Главная</Link>
          <Link href="/catalog">Каталог</Link>
          <Link href="/search/frame">Поиск аниме по кадру</Link>
          <Link href="/subscription">AnimeSoul Plus</Link>
        </div>
        {preview && (
          <div className="footer-sitemap-group">
            <h2>Аккаунт</h2>
            <Link href="/users/soul">Публичный профиль</Link>
            <Link href="/users/soul#profile-favorites">Любимое аниме</Link>
            <Link href="/users/soul#profile-statistics">Статистика</Link>
          </div>
        )}
        <div className="footer-sitemap-group">
          <h2>AnimeSoul</h2>
          <span>Твоя коллекция. Твои правила.</span>
        </div>
      </nav>
      <div className="footer-meta">
        <Link href="/" className="footer-brand">
          AnimeSoul
        </Link>
        <span>Версия 0.4.0</span>
      </div>
      {preview && (
        <p className="preview-note">
          Тестовый каталог · вход и синхронизация библиотеки ещё переносятся
        </p>
      )}
    </footer>
  );
}
