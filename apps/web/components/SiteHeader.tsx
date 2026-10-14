"use client";
import { NotificationCenter } from "./NotificationCenter";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Account } from "@animesoul/contracts";
import { loadAccount } from "../lib/account-client";
import { Icon } from "./Icon";
import { UniversalSearch } from "./UniversalSearch";
import { ProfileImage } from "./ProfileImage";
import { DeveloperAccessSwitch } from "./DeveloperAccessSwitch";

export function SiteHeader({ preview }: { preview: boolean }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    let active = true;
    let version = 0;
    const refresh = () => {
      const current = ++version;
      void loadAccount()
        .then((value) => {
          if (active && current === version) setAccount(value);
        })
        .catch(() => {
          if (active && current === version) setAccount(null);
        });
    };
    refresh();
    window.addEventListener("animesoul:account-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("animesoul:account-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [preview]);
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
      <UniversalSearch />
      <div className="header-end">
        <DeveloperAccessSwitch />
        {account && <NotificationCenter account={account} />}
        {(account || !preview) && (
          <Link
            href={account ? "/users/" + encodeURIComponent(account.username) : "/account"}
            className="account-button"
            aria-label={account ? `Открыть мой профиль ${account.username}` : "Войти в аккаунт"}
          >
            {account ? (
              <span className="account-avatar">
                <ProfileImage
                  value={account.avatar}
                  alt=""
                  width={30}
                  height={30}
                  fallback={Array.from(account.username).slice(0, 2).join("").toUpperCase()}
                />
              </span>
            ) : (
              <Icon name="user" />
            )}
            <span>{account?.username ?? "Аккаунт"}</span>
          </Link>
        )}
        {preview && !account && (
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
            <Link href="/friends">
              <Icon name="user" />
              Друзья и подписки
            </Link>
            <Link href="/community">
              <Icon name="user" />
              Сообщество
            </Link>
            <Link href="/library">
              <Icon name="catalog" />
              Моя библиотека
            </Link>
            <Link href="/account">
              <Icon name="user" />
              Аккаунт
            </Link>
            {account && (
              <Link href={"/users/" + encodeURIComponent(account.username)}>
                <Icon name="user" />
                Мой профиль
              </Link>
            )}
            <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
              <Icon name="home" />
              Главная
            </Link>
            <Link href="/catalog" aria-current={pathname === "/catalog" ? "page" : undefined}>
              <Icon name="catalog" />
              Каталог
            </Link>
            <Link
              href="/search/frame"
              aria-current={pathname === "/search/frame" ? "page" : undefined}
            >
              <Icon name="image" />
              Поиск аниме по кадру
            </Link>
            {isProfile && <Link href="#profile-favorites">Любимое аниме</Link>}
            {preview && !account && (
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
