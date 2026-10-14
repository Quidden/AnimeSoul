"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  relationshipSchema,
  type Account,
  type Relationship,
  type SocialAction,
} from "@animesoul/contracts";
import { accountRequest, loadAccount } from "../lib/account-client";

export function SocialActions({
  targetId,
  account: provided,
  compact = false,
}: {
  targetId: string;
  account?: Account;
  compact?: boolean;
}) {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(provided ?? null),
    [relation, setRelation] = useState<Relationship | null>(null),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    if (provided) {
      setAccount(provided);
      setLoaded(true);
    } else
      void loadAccount()
        .then((a) => {
          if (active) setAccount(a);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoaded(true);
        });
    return () => {
      active = false;
    };
  }, [provided]);
  useEffect(() => {
    if (!account) return;
    let active = true;
    void accountRequest("/api/account/social/" + targetId)
      .then((value) => {
        if (active) setRelation(relationshipSchema.parse(value));
      })
      .catch(() => {
        if (active) setNotice("Действия с этим профилем недоступны.");
      });
    return () => {
      active = false;
    };
  }, [account, targetId]);
  async function change(action: SocialAction["action"]) {
    if (!account) return;
    setBusy(true);
    setNotice("");
    try {
      await accountRequest("/api/account/social", { targetId, action }, account.csrfToken);
      router.refresh();
      setRelation(
        relationshipSchema.parse(await accountRequest("/api/account/social/" + targetId)),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось изменить отношения.");
    } finally {
      setBusy(false);
    }
  }
  if (!loaded)
    return (
      <p className="social-notice" role="status">
        Проверяем доступ…
      </p>
    );
  if (!account)
    return (
      <div className="profile-social-actions">
        <Link className="outline" href="/account">
          Войти, чтобы добавить в друзья
        </Link>
      </div>
    );
  if (relation?.state === "self")
    return (
      <div className="profile-social-actions">
        <Link className="outline" href="/account">
          Настройки профиля
        </Link>
        <Link className="outline" href="/friends">
          Мои друзья
        </Link>
      </div>
    );
  const actionButton = (action: SocialAction["action"], label: string) => (
    <button
      type="button"
      className={compact && (action === "request" || action === "accept") ? "primary" : "outline"}
      data-social-action={action}
      disabled={busy}
      onClick={(event) => {
        event.currentTarget.closest("details")?.removeAttribute("open");
        void change(action);
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="profile-social-actions">
      {relation && (
        <>
          {relation.state === "none" &&
            relation.canRequest &&
            actionButton("request", "Добавить в друзья")}
          {relation.state === "outgoing" && actionButton("cancel", "Отменить заявку")}
          {relation.state === "incoming" && (
            <>
              {actionButton("accept", "Принять заявку")}
              {actionButton("decline", "Отклонить")}
            </>
          )}
          {!compact &&
            relation.state === "friends" &&
            actionButton("unfriend", "Удалить из друзей")}
          {relation.state !== "blocked" &&
            (relation.following
              ? actionButton("unfollow", "Отписаться")
              : relation.canFollow
                ? actionButton("follow", "Подписаться")
                : null)}
          {relation.state === "blocked" ? (
            actionButton("unblock", "Разблокировать")
          ) : compact ? (
            <details className="friends-actions-menu">
              <summary aria-label="Другие действия с профилем">Действия</summary>
              <div>
                {relation.state === "friends" && actionButton("unfriend", "Удалить из друзей")}
                {actionButton("block", "Заблокировать")}
              </div>
            </details>
          ) : (
            actionButton("block", "Заблокировать")
          )}
        </>
      )}
      {notice && (
        <p className="social-notice" role="status">
          {notice}
        </p>
      )}
      {compact && !relation && !notice && (
        <span className="social-notice" role="status">
          Проверяем связь…
        </span>
      )}
    </div>
  );
}
