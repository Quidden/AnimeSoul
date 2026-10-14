"use client";
import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import {
  peopleSchema,
  socialListSchema,
  socialSections,
  type Person,
  type SocialAction,
  type SocialList,
} from "@animesoul/contracts";
import { accountRequest } from "../lib/account-client";
import { useAccountSession } from "./useAccountSession";
import { PersonLink } from "./ProfileFriends";
import { ProfileImage } from "./ProfileImage";
import { SocialActions } from "./SocialActions";
import { Icon } from "./Icon";
import { accountSettingsHref } from "../lib/account-settings";

const sections = {
  friends: {
    label: "Друзья",
    icon: "user",
    description: "Твои друзья и знакомые в AnimeSoul.",
    empty: "Пока нет друзей",
    help: "Найди знакомых через поиск выше и отправь заявку.",
    person: "В друзьях",
  },
  incoming: {
    label: "Входящие заявки",
    icon: "check",
    description: "Приглашения в друзья, которые ждут твоего ответа.",
    empty: "Нет новых заявок",
    help: "Когда кто-то предложит дружбу, заявка появится здесь.",
    person: "Хочет добавить тебя в друзья",
  },
  outgoing: {
    label: "Отправленные заявки",
    icon: "user",
    description: "Твои приглашения в друзья.",
    empty: "Нет отправленных заявок",
    help: "Найди пользователя через поиск выше и предложи дружбу.",
    person: "Заявка ожидает ответа",
  },
  following: {
    label: "Подписки",
    icon: "folder",
    description: "Профили, на которые ты подписан.",
    empty: "Пока нет подписок",
    help: "Найди интересный профиль и подпишись на него.",
    person: "Ты подписан на этот профиль",
  },
  followers: {
    label: "Подписчики",
    icon: "user",
    description: "Люди, которые подписались на твой профиль.",
    empty: "Пока нет подписчиков",
    help: "Здесь появятся люди, которые подпишутся на твой профиль.",
    person: "Подписан на твой профиль",
  },
  blocked: {
    label: "Блокировки",
    icon: "close",
    description: "Профили с ограниченным доступом к общению.",
    empty: "Нет заблокированных пользователей",
    help: "Если заблокируешь пользователя, здесь можно будет снять блокировку.",
    person: "Профиль заблокирован",
  },
} as const;
type Section = (typeof socialSections)[number];
type Notice = { text: string; error: boolean };

function ListLoading() {
  return (
    <div className="friends-list-loading" role="status">
      <span className="friends-sr-only">Загружаем список…</span>
      {[0, 1, 2].map((key) => (
        <div className="friends-skeleton" key={key} aria-hidden="true">
          <span />
          <div>
            <i />
            <i />
          </div>
        </div>
      ))}
    </div>
  );
}
export function FriendsPanel() {
  const { account, ready: loaded } = useAccountSession();
  const panelId = useId();
  const [section, setSection] = useState<Section>("friends");
  const [page, setPage] = useState<SocialList>({ items: [], next: null });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [reload, setReload] = useState(0);
  const [people, setPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (!account) return;
    let active = true;
    setPage({ items: [], next: null });
    setListLoading(true);
    setListError("");
    setNotice(null);
    void accountRequest("/api/account/social?section=" + section)
      .then((value) => {
        if (active) setPage(socialListSchema.parse(value));
      })
      .catch((error) => {
        if (active)
          setListError(error instanceof Error ? error.message : "Не удалось загрузить список.");
      })
      .finally(() => {
        if (active) setListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [account, section, reload]);
  async function refresh(after?: string) {
    const result = socialListSchema.parse(
      await accountRequest(
        "/api/account/social?section=" + section + (after ? "&after=" + after : ""),
      ),
    );
    setPage((previous) =>
      after
        ? {
            ...result,
            items: [
              ...new Map([...previous.items, ...result.items].map((p) => [p.id, p])).values(),
            ],
          }
        : result,
    );
  }
  async function change(targetId: string, action: SocialAction["action"]) {
    if (!account) return;
    setBusy(true);
    setNotice(null);
    try {
      await accountRequest("/api/account/social", { targetId, action }, account.csrfToken);
      await refresh();
      setNotice({ text: "Изменения сохранены.", error: false });
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : "Не удалось изменить отношения.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    if (q.length < 2) {
      setSearchError("Введите хотя бы два символа имени.");
      return;
    }
    setSearchBusy(true);
    setSearchError("");
    setPeople([]);
    setSearchedQuery("");
    try {
      const result = peopleSchema.parse(
        await accountRequest("/api/account/social/search?q=" + encodeURIComponent(q)),
      );
      setPeople(result.items);
      setSearchedQuery(q);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Не удалось найти профили.");
    } finally {
      setSearchBusy(false);
    }
  }
  const actionButton = (id: string, action: SocialAction["action"], label: string) => (
    <button
      type="button"
      className={action === "accept" ? "primary" : "outline"}
      data-social-action={action}
      disabled={busy || listLoading}
      onClick={(event) => {
        event.currentTarget.closest("details")?.removeAttribute("open");
        void change(id, action);
      }}
    >
      {label}
    </button>
  );
  const selected = sections[section];
  if (!loaded)
    return (
      <div className="friends-session-loading">
        <ListLoading />
      </div>
    );
  if (!account)
    return (
      <section className="friends-guest">
        <span className="friends-empty-icon">
          <Icon name="user" width={28} height={28} />
        </span>
        <h2>Друзья рядом</h2>
        <p>Войди в аккаунт, чтобы искать пользователей и управлять заявками.</p>
        <Link className="primary" href="/account">
          Войти в аккаунт
        </Link>
      </section>
    );
  return (
    <div className="friends-workspace">
      <aside className="friends-sidebar">
        <Link className="friends-owner" href={"/users/" + encodeURIComponent(account.username)}>
          <span className="profile-avatar">
            <ProfileImage
              value={account.avatar}
              alt=""
              width={38}
              height={38}
              fallback={Array.from(account.username).slice(0, 2).join("").toUpperCase()}
            />
          </span>
          <span>
            <strong>{account.username}</strong>
            <small>Мой профиль</small>
          </span>
        </Link>
        <nav className="friends-nav" aria-label="Отношения">
          {socialSections.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={key === section}
              aria-controls={panelId}
              disabled={busy}
              onClick={() => {
                if (key === section) return;
                setPage({ items: [], next: null });
                setListLoading(true);
                setListError("");
                setNotice(null);
                setSection(key);
              }}
            >
              <Icon name={sections[key].icon} />
              <span>{sections[key].label}</span>
            </button>
          ))}
        </nav>
        <Link className="friends-privacy" href={accountSettingsHref("privacy-settings")}>
          <Icon name="settings" />
          Настройки приватности
        </Link>
      </aside>
      <div className="friends-main">
        <section className="friends-search-panel" aria-labelledby={panelId + "-search"}>
          <h2 id={panelId + "-search"}>Найти пользователя</h2>
          <form className="friends-search" onSubmit={search}>
            <label>
              Имя пользователя
              <span className="friends-search-field">
                <Icon name="search" />
                <input
                  name="q"
                  required
                  minLength={2}
                  maxLength={40}
                  type="search"
                  autoComplete="off"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-describedby={panelId + "-search-help"}
                  aria-invalid={!!searchError}
                  placeholder="Имя в AnimeSoul"
                  disabled={searchBusy}
                />
              </span>
            </label>
            <button className="primary" disabled={searchBusy}>
              {searchBusy ? "Ищем…" : "Найти"}
            </button>
          </form>
          <p
            className={"friends-search-help" + (searchError ? " friends-error-text" : "")}
            id={panelId + "-search-help"}
            role={searchError ? "alert" : undefined}
          >
            {searchError || "Поиск по доступным публичным профилям."}
          </p>
          {searchBusy && <ListLoading />}
          {searchedQuery && (
            <div className="friends-search-results" aria-live="polite">
              <div className="friends-results-heading">
                <h3>Результаты поиска</h3>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    setPeople([]);
                    setSearchedQuery("");
                    setQuery("");
                    setSearchError("");
                  }}
                >
                  Сбросить поиск
                </button>
              </div>
              {people.length ? (
                people.map((person) => (
                  <div className="friends-person-row" key={person.id}>
                    <PersonLink person={person} />
                    <SocialActions targetId={person.id} account={account} compact />
                  </div>
                ))
              ) : (
                <p className="friends-search-empty">
                  По запросу «{searchedQuery}» профили не найдены. Попробуй другое имя.
                </p>
              )}
            </div>
          )}
        </section>
        <section
          className="friends-list-panel"
          id={panelId}
          aria-labelledby={panelId + "-title"}
          aria-busy={listLoading}
        >
          <div className="friends-list-heading">
            <div>
              <h2 id={panelId + "-title"}>
                {selected.label}
                {!listLoading && !listError && (
                  <span
                    className="friends-count"
                    aria-label={
                      "Загружено профилей: " + page.items.length + (page.next ? " или больше" : "")
                    }
                  >
                    {page.items.length}
                    {page.next ? "+" : ""}
                  </span>
                )}
              </h2>
              <p>{selected.description}</p>
            </div>
          </div>
          {notice && (
            <p
              className={"friends-feedback" + (notice.error ? " friends-error-text" : "")}
              role="status"
            >
              {notice.text}
            </p>
          )}
          <div key={section} className="friends-list-content">
            {listLoading ? (
              <ListLoading />
            ) : listError ? (
              <div className="friends-empty" role="alert">
                <span className="friends-empty-icon">
                  <Icon name="close" width={26} height={26} />
                </span>
                <h3>Не удалось загрузить список</h3>
                <p>{listError}</p>
                <button
                  type="button"
                  className="outline"
                  onClick={() => setReload((value) => value + 1)}
                >
                  Повторить
                </button>
              </div>
            ) : page.items.length ? (
              <div className="friends-list">
                {page.items.map((person) => (
                  <div className="friends-person-row" key={person.id}>
                    <div className="friends-person-details">
                      <PersonLink person={person} detail={selected.person} />
                    </div>
                    <div className="friends-row-actions">
                      {section === "incoming" && (
                        <>
                          {actionButton(person.id, "accept", "Принять")}
                          {actionButton(person.id, "decline", "Отклонить")}
                        </>
                      )}
                      {section === "outgoing" &&
                        actionButton(person.id, "cancel", "Отменить заявку")}
                      {section === "following" && actionButton(person.id, "unfollow", "Отписаться")}
                      {section === "blocked" ? (
                        actionButton(person.id, "unblock", "Разблокировать")
                      ) : (
                        <details className="friends-actions-menu">
                          <summary aria-label={"Действия с профилем " + person.username}>
                            Действия
                            <Icon name="menu" width={15} height={15} />
                          </summary>
                          <div>
                            {section === "friends" &&
                              actionButton(person.id, "unfriend", "Удалить из друзей")}
                            {actionButton(person.id, "block", "Заблокировать")}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="friends-empty">
                <span className="friends-empty-icon">
                  <Icon name={selected.icon} width={28} height={28} />
                </span>
                <h3>{selected.empty}</h3>
                <p>{selected.help}</p>
              </div>
            )}
          </div>
          {!listLoading && !listError && page.next && (
            <button
              className="outline friends-more"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setNotice(null);
                void refresh(page.next ?? undefined)
                  .catch(() =>
                    setNotice({
                      text: "Не удалось загрузить список. Попробуй ещё раз.",
                      error: true,
                    }),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Загружаем…" : "Показать ещё"}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
