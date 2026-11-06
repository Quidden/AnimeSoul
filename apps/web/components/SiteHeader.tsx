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
  // The account pill stays invisible until the first answer, so signed-in readers never see "Войти".
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    let version = 0;
    const refresh = () => {
      const current = ++version;
      void loadAccount()
        .then((value) => {
          if (active && current === version) {
            setAccount(value);
            setReady(true);
          }
        })
        .catch(() => {
          if (active && current === version) {
            setAccount(null);
            setReady(true);
          }
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
      <div className="header-center">
        <UniversalSearch />
        {/* Detail pages move their section tabs here once the page scrolls past them. */}
        <div className="header-context" id="header-context" />
      </div>
      <div className="header-end">
        <DeveloperAccessSwitch />
        {account && <NotificationCenter account={account} />}
        {(account || !preview) && (
          <Link
            href={account ? "/users/" + encodeURIComponent(account.username) : "/account"}
            className="account-button"
            aria-label={account ? `Открыть мой профиль ${account.username}` : "Войти в аккаунт"}
            style={ready ? undefined : { visibility: "hidden" }}
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
            <span>{account?.username ?? "Войти"}</span>
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
            <Link href="/catalog" aria-current={pathname === "/catalog" ? "page" : undefined}>
              <Icon name="catalog" />
              Каталог
            </Link>
            <Link href="/library" aria-current={pathname === "/library" ? "page" : undefined}>
              <Icon name="folder" />
              Моя библиотека
            </Link>
            <Link
              href="/search/frame"
              aria-current={pathname === "/search/frame" ? "page" : undefined}
            >
              <Icon name="image" />
              Поиск по кадру
            </Link>
            <hr />
            <Link href="/friends" aria-current={pathname === "/friends" ? "page" : undefined}>
              <Icon name="users" />
              Друзья и подписки
            </Link>
            <Link href="/community" aria-current={pathname === "/community" ? "page" : undefined}>
              <Icon name="chat" />
              Сообщество
            </Link>
            <hr />
            {(account || (preview && !account)) && (
              <Link
                href={"/users/" + encodeURIComponent(account?.username ?? "soul")}
                aria-current={isProfile ? "page" : undefined}
              >
                <Icon name="user" />
                Мой профиль
              </Link>
            )}
            {isProfile && (
              <Link href="#profile-favorites">
                <Icon name="check" />
                Любимое аниме
              </Link>
            )}
            <Link href="/account" aria-current={pathname === "/account" ? "page" : undefined}>
              <Icon name="settings" />
              {account ? "Настройки" : "Войти"}
            </Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
