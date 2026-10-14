"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Account } from "@animesoul/contracts";
import { Icon } from "./Icon";
import { ProfileImage } from "./ProfileImage";
import { accountSectionFromUrl, type AccountSection } from "../lib/account-settings";
export type { AccountSection } from "../lib/account-settings";

export const accountSections = [
  { id: "profile-settings", label: "Профиль", icon: "user" },
  { id: "media-settings", label: "Аватар и обложка", icon: "image" },
  { id: "privacy-settings", label: "Приватность", icon: "settings" },
  { id: "player-settings", label: "Плеер", icon: "catalog" },
  { id: "security-settings", label: "Безопасность", icon: "check" },
  { id: "identity-settings", label: "Почта и Google", icon: "user" },
  { id: "appearance-settings", label: "Оформление", icon: "settings" },
] as const;
function sectionFromLocation() {
  return typeof window === "undefined"
    ? null
    : accountSectionFromUrl(new URL(window.location.href));
}

export function AccountWorkspace({
  account,
  children,
}: {
  account: Account;
  children: (section: AccountSection) => ReactNode;
}) {
  const requestedSection = useSearchParams().get("section");
  const [section, setSection] = useState<AccountSection>(
    () => sectionFromLocation() ?? "profile-settings",
  );
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const synchronize = () => {
      const next = sectionFromLocation();
      if (next) setSection(next);
    };
    synchronize();
    // Next can commit the destination URL after rendering a restored account page.
    const frame = window.requestAnimationFrame(synchronize);
    window.addEventListener("hashchange", synchronize);
    window.addEventListener("popstate", synchronize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", synchronize);
      window.removeEventListener("popstate", synchronize);
    };
  }, [requestedSection]);
  return (
    <div className="account-settings account-workspace">
      <header className="account-workspace-heading">
        <div>
          <h1>Личный кабинет</h1>
          <p>Твой профиль и настройки AnimeSoul.</p>
        </div>
        <Link href="/library" className="outline">
          <Icon name="folder" /> Моя библиотека
        </Link>
      </header>
      <div className="account-workspace-grid">
        <aside className="account-workspace-sidebar">
          <Link
            className="account-workspace-owner"
            href={"/users/" + encodeURIComponent(account.username)}
          >
            <span className="account-owner-avatar">
              <ProfileImage
                value={account.avatar}
                alt=""
                width={42}
                height={42}
                fallback={Array.from(account.username).slice(0, 2).join("").toUpperCase()}
              />
            </span>
            <span>
              <strong>{account.username}</strong>
              <small>Открыть мой профиль</small>
            </span>
          </Link>
          <nav className="account-settings-nav" aria-label="Настройки аккаунта">
            {accountSections.map((item) => (
              <a
                key={item.id}
                href={"#" + item.id}
                aria-current={section === item.id ? "location" : undefined}
                aria-controls={item.id}
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  if (section === item.id) return;
                  const url = new URL(window.location.href);
                  url.searchParams.delete("section");
                  url.hash = item.id;
                  window.history.pushState(null, "", url.pathname + url.search + url.hash);
                  setSection(item.id);
                  // Run after the selected panel is visible, keeping the pinned menu in view.
                  window.requestAnimationFrame(() => {
                    panel.current?.scrollIntoView({
                      block: "start",
                      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                        ? "instant"
                        : "smooth",
                    });
                    panel.current?.focus({ preventScroll: true });
                  });
                }}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </aside>
        <div className="account-workspace-main" ref={panel} tabIndex={-1}>
          {children(section)}
        </div>
      </div>
    </div>
  );
}
