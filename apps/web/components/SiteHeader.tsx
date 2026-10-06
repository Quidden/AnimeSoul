"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

export function SiteHeader({ preview }: { preview: boolean }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const isProfile = pathname.startsWith("/users/");
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);
  return (
    <header className={`app-header${isProfile ? " profile-site-header" : ""}`}>
      <Link
        className={isProfile ? "profile-brand" : "brand"}
        href="/"
        aria-label="AnimeSoul — на главную"
      >
        <img src="/animesoul-icon.png" alt="" width="34" height="34" />
        <span>
          Anime<span>Soul</span>
        </span>
      </Link>
      {isProfile ? (
        <nav className="profile-site-navigation" aria-label="Основная навигация">
          <Link href="/catalog">Каталог</Link>
          <Link href="#profile-favorites">Любимое аниме</Link>
        </nav>
      ) : (
        <form className="header-search" action="/catalog" role="search">
          <input
            type="search"
            name="q"
            maxLength={100}
            aria-label="Поиск аниме"
            placeholder="Аниме или название…"
          />
          <button type="submit" aria-label="Найти">
            <Icon name="search" />
          </button>
        </form>
      )}
      <div className="header-end">
        {preview && (
          <Link href="/users/soul" className="account-button" aria-label="Открыть профиль soul">
            <span className="account-avatar">S</span>
            <span>soul</span>
          </Link>
        )}
        <details ref={menu} className="header-menu">
          <summary aria-label="Открыть меню навигации">
            <Icon name="menu" />
          </summary>
          <nav className="header-menu-panel" aria-label="Разделы сайта">
            <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
              <Icon name="home" />
              Главная
            </Link>
            <Link href="/catalog" aria-current={pathname === "/catalog" ? "page" : undefined}>
              <Icon name="catalog" />
              Каталог
            </Link>
            {preview && (
              <Link href="/users/soul" aria-current={isProfile ? "page" : undefined}>
                <Icon name="user" />
                Профиль
              </Link>
            )}
          </nav>
        </details>
      </div>
    </header>
  );
}
