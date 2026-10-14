"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Account } from "@animesoul/contracts";
import { useStored, useData, query } from "./api";
import { Dashboard } from "./Dashboard";
import { Users } from "./Users";
import { Journal } from "./Journal";
import { Messages } from "./Messages";
import { Maintenance } from "./Maintenance";
import { Templates } from "./Templates";
import { Winter } from "./Winter";
import { System } from "./System";
import { CatalogManagement } from "../CatalogManagement";
import { SubscriptionManagement } from "../SubscriptionManagement";
import { UserDiagnostics } from "../UserDiagnostics";
export const navigation = [
  {
    name: "Обзор",
    items: [
      ["", "Главная панель"],
      ["analytics", "Статистика"],
      ["activity", "Активность"],
      ["features", "Использование функций"],
    ],
  },
  {
    name: "Пользователи",
    items: [
      ["users", "Пользователи и доступ"],
      ["journal", "История действий"],
    ],
  },
  {
    name: "Подписки",
    items: [
      ["plans", "Тарифы и цены"],
      ["promotions", "Промоакции"],
      ["subscription-history", "История доступа"],
    ],
  },
  {
    name: "Контент",
    items: [
      ["announcements", "Объявления"],
      ["notifications", "Уведомления"],
      ["templates", "Шаблоны и быстрый доступ"],
      ["anime-notices", "Уведомления аниме"],
      ["catalog", "Каталог и провайдеры"],
    ],
  },
  { name: "Оформление", items: [["winter", "Зимняя тема"]] },
  {
    name: "Система",
    items: [
      ["system", "API, сервисы и лимиты"],
      ["maintenance", "Обновление сайта"],
      ["admin-journal", "Административные действия"],
      ["diagnostics", "Технические ошибки"],
    ],
  },
];
type Search = {
  users: { id: string; email: string | null; profile: { username: string } | null }[];
  plans: { id: string; name: string }[];
  announcements: { id: string; title: string }[];
  anime: { id: string; title: string; slug: string }[];
};
function GlobalSearch({ siteUrl }: { siteUrl: string }) {
  const [input, setInput] = useState(""),
    [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(input), 300);
    return () => clearTimeout(t);
  }, [input]);
  const state = useData<Search>("search?" + query({ q: term }));
  return (
    <div className="global-search">
      <input
        aria-label="Поиск пользователей, тарифов, объявлений и аниме"
        placeholder="Пользователь, тариф, объявление, аниме…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      {term && (
        <div className="search-results">
          {state.loading ? (
            <p>Ищем…</p>
          ) : state.error ? (
            <p role="alert">{state.error}</p>
          ) : (
            <>
              {state.data?.users.map((u) => (
                <Link key={u.id} href={"/users?user=" + u.id} onClick={() => setInput("")}>
                  Пользователь · {u.profile?.username ?? u.email}
                </Link>
              ))}
              {state.data?.plans.map((p) => (
                <Link key={p.id} href="/plans" onClick={() => setInput("")}>
                  Тариф · {p.name}
                </Link>
              ))}
              {state.data?.announcements.map((a) => (
                <Link key={a.id} href={"/announcements?edit=" + a.id} onClick={() => setInput("")}>
                  Объявление · {a.title}
                </Link>
              ))}
              {state.data?.anime.map((a) => (
                <a key={a.id} href={siteUrl + "/anime/" + a.slug} target="_blank" rel="noreferrer">
                  Аниме · {a.title}
                </a>
              ))}
              {state.data && !Object.values(state.data).some((v) => v.length) && (
                <p>Ничего не найдено</p>
              )}
            </>
          )}
          <button
            onClick={() => {
              setInput("");
              setTerm("");
            }}
          >
            Закрыть
          </button>
        </div>
      )}
    </div>
  );
}
export function AdminShell({
  account,
  logout,
  busy,
  siteUrl,
}: {
  account: Account;
  logout: () => void;
  busy: boolean;
  siteUrl: string;
}) {
  const pathname = usePathname(),
    section = pathname.split("/")[1] ?? "",
    full = account.roles.some((r) => ["owner", "admin"].includes(r));
  const [compact, setCompact] = useStored("animesoul:admin:compact", false),
    [theme, setTheme] = useStored("animesoul:admin:theme", "system"),
    [closed, setClosed] = useStored<string[]>("animesoul:admin:groups", []),
    [navSearch, setNavSearch] = useState(""),
    [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: light)");
    const update = () =>
      document.documentElement.setAttribute(
        "data-theme",
        theme === "system" ? (media.matches ? "light" : "dark") : theme,
      );
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  const title =
    navigation.flatMap((g) => g.items).find(([id]) => id === section)?.[1] ??
    "Административная панель";
  return (
    <div className={`admin-shell ${compact ? "is-compact" : ""} ${mobile ? "nav-open" : ""}`}>
      <aside className="sidebar">
        <Link className="brand" href="/" title="AnimeSoul Admin">
          {compact ? "AS" : "ANIMESOUL"}
          <small>ADMIN</small>
        </Link>
        <input
          className="nav-search"
          aria-label="Поиск по разделам"
          placeholder="Найти раздел…"
          value={navSearch}
          onChange={(e) => setNavSearch(e.target.value)}
        />
        {navigation.map((group) => {
          const items = group.items.filter(
            ([id, label]) =>
              (full || id === "catalog") &&
              (label ?? "").toLowerCase().includes(navSearch.toLowerCase()),
          );
          if (!items.length) return null;
          const collapsed = closed.includes(group.name) && !navSearch;
          return (
            <div className="nav-group" key={group.name}>
              <button
                className="group-toggle"
                title={group.name}
                onClick={() =>
                  setClosed((v) =>
                    v.includes(group.name) ? v.filter((n) => n !== group.name) : [...v, group.name],
                  )
                }
              >
                {compact ? group.name.slice(0, 1) : group.name}
                <span>{collapsed ? "+" : "−"}</span>
              </button>
              {!collapsed &&
                items.map(([id, label]) => (
                  <Link
                    key={id}
                    href={"/" + id}
                    className={section === id ? "active" : ""}
                    aria-current={section === id ? "page" : undefined}
                    title={label}
                    onClick={() => setMobile(false)}
                  >
                    {compact ? label?.slice(0, 2) : label}
                  </Link>
                ))}
            </div>
          );
        })}
        <button className="compact-toggle" onClick={() => setCompact(!compact)}>
          {compact ? "→" : "← Свернуть"}
        </button>
      </aside>
      <div className="admin-workspace">
        <header className="admin-header">
          <button
            className="mobile-toggle"
            onClick={() => setMobile(!mobile)}
            aria-label="Навигация"
          >
            ☰
          </button>
          <span>{title}</span>
          {full && <GlobalSearch siteUrl={siteUrl} />}
          <select
            aria-label="Тема админки"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option value="system">Системная</option>
            <option value="dark">Тёмная</option>
            <option value="light">Светлая</option>
          </select>
          <a href={siteUrl} target="_blank" rel="noreferrer">
            Сайт ↗
          </a>
          <button disabled={busy} onClick={logout}>
            Выйти
          </button>
        </header>
        <main className="admin-main">
          <div className="section-heading">
            <h1>{title}</h1>
            <span className="muted">
              {account.username} · {account.roles.join(", ") || "Резерв просмотра"}
            </span>
          </div>
          {!full ? (
            <CatalogManagement csrf={account.csrfToken} siteUrl={siteUrl} />
          ) : section === "users" ? (
            <Users account={account} />
          ) : ["journal", "admin-journal", "subscription-history"].includes(section) ? (
            <Journal
              key={section}
              category={section === "journal" ? "user" : "admin"}
              subscriptions={section === "subscription-history"}
            />
          ) : ["announcements", "notifications", "anime-notices"].includes(section) ? (
            <Messages key={section} section={section} csrf={account.csrfToken} />
          ) : section === "templates" ? (
            <Templates csrf={account.csrfToken} />
          ) : section === "maintenance" ? (
            <Maintenance csrf={account.csrfToken} />
          ) : section === "winter" ? (
            <Winter csrf={account.csrfToken} />
          ) : section === "system" ? (
            <System />
          ) : section === "catalog" ? (
            <CatalogManagement csrf={account.csrfToken} siteUrl={siteUrl} />
          ) : section === "plans" || section === "promotions" ? (
            <SubscriptionManagement csrf={account.csrfToken} mode={section} />
          ) : section === "diagnostics" ? (
            <UserDiagnostics />
          ) : (
            <Dashboard mode={section} />
          )}
        </main>
      </div>
    </div>
  );
}
